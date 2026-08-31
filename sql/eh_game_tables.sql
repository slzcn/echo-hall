-- ===== 真人联机牌桌 (掼蛋/斗地主) 2026-08-14 =====
-- phase-1「轻联机」: 共享座位大厅 + host 客户端权威开局。
-- 这张表管的是【开局前的座位分配】与【一房一桌的存在性】,以及 host 广播的
-- 最新公开局态快照(late-join/断线重连用)。逐手过程走 realtime broadcast, 不落这张表。
-- 一切写操作统一走 security definer RPC(照抄 eh_dm 命门): 直接表写被 RLS 拒,
-- 座位竞争在 RPC 里 for update 串行化, 杜绝两人抢同一座。
-- phase-2 升级 Edge 权威时, 这张表原样复用, 仅把裁判从 host 挪到 Edge。

create table if not exists public.eh_game_tables (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  game text not null default 'guandan',        -- 'guandan' | 'doudizhu'
  host_uid uuid not null,                       -- 开桌者 = phase-1 裁判
  status text not null default 'lobby',         -- lobby | playing | done | closed
  seats jsonb not null default '[]'::jsonb,     -- [{seat,kind,uid,name,emoji}] kind: human|soul|clone|ai|empty
                                                --   clone=灵魂分身(灵魂不够时借在场灵魂身份补位, uid=原灵魂, name="原名·分身[序号]")
  seat_count int not null default 4,
  msg_id bigint,                                -- 牌桌卡在 eh_messages 的 id(定位刷新)
  seed bigint,                                  -- 开局洗牌种子
  state jsonb,                                  -- host 广播的最新公开局态快照
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists eh_game_tables_room_idx on public.eh_game_tables(room_id, created_at desc);
-- 一房一桌: 同房最多一张"活着"(招募中/进行中)的桌
create unique index if not exists eh_game_tables_one_active
  on public.eh_game_tables(room_id) where status in ('lobby','playing');

alter table public.eh_game_tables enable row level security;

-- 读: 认证用户可读(座位=房内公开信息, 已随牌桌卡展示在聊天里; 客户端按 room_id 过滤订阅)。
drop policy if exists eh_gt_select on public.eh_game_tables;
create policy eh_gt_select on public.eh_game_tables
  for select to public using (true);
-- 写: 无 insert/update/delete policy → 直接表写一律被拒, 只能走下面的 RPC。

-- ---- helper: 按游戏定席位数 ----
-- 斗地主 3 人、掼蛋 4 人(2v2)、德州最多 6 人; 其余按掼蛋 4 席兜底。
-- 前端 p_game 实际取值: 'ddz'(斗地主) / 'guandan'(掼蛋) / 'nlhe'(德州)。
create or replace function public.eh_gt_seat_count(p_game text)
returns int language sql immutable as $$
  select case lower(coalesce(p_game,'guandan'))
    when 'ddz' then 3 when 'doudizhu' then 3
    when 'nlhe' then 6 when 'holdem' then 6 when 'texas' then 6
    else 4 end;
$$;

-- ---- helper: 初始 N 席(0=host, 其余空) ----
create or replace function public.eh_gt_init_seats(p_uid uuid, p_name text, p_emoji text, p_count int)
returns jsonb language sql immutable as $$
  select jsonb_agg(
    case when g.i=0
      then jsonb_build_object('seat',0,'kind','human','uid',p_uid,'name',p_name,'emoji',p_emoji)
      else jsonb_build_object('seat',g.i,'kind','empty') end
    order by g.i)
  from generate_series(0, greatest(coalesce(p_count,4),1)-1) as g(i);
$$;

-- ---- RPC: 陈旧桌回收(任何认证用户可调, 只关"没人玩"的僵尸桌, 幂等安全) ----
-- 「5 分钟没人玩自动解散」的执行器: lobby 开而不打 / playing 房主心跳断, 5 分钟无 updated_at
--   变化即判僵尸桌散掉。host 每 ~90s 用 eh_gt_set_state 空刷 updated_at 当心跳, 真在玩的桌不会误杀。
-- 前端进房时 + 房内定时(每 ~2min)调一次 → 死桌即使没人再开新局也会自动翻成"已散桌"(realtime 推送)。
create or replace function public.eh_gt_reap(p_room uuid)
returns int
language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.eh_game_tables
    set status='closed', updated_at=now()
    where (p_room is null or room_id=p_room)
      and status in ('lobby','playing')
      and updated_at < now() - interval '5 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.eh_gt_reap(uuid) to public;

-- ---- RPC: 开桌(host 坐 0 席; 席位数按游戏来) ----
-- 「游戏随时可开」语义:
--   · 开桌前先回收本房陈旧桌(5min 没人玩): 否则"一房一桌"唯一索引被僵尸桌永久占住, 新局再也开不出来。
--   · 我自己的活桌 + 同一游戏 → 幂等返回那张(双击开局不叠第二张)。
--   · 我自己的活桌 + 换了游戏 → 关掉旧的再开新的(主人反馈: 不能因为有没开始的游戏就开不了另一个)。
--   · 别人的活桌 → 一房一桌语义, 返回那张(引导去加入)。
create or replace function public.eh_gt_open(p_room uuid, p_game text, p_name text, p_emoji text)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_cnt int; v_g text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_room is null then raise exception 'room required'; end if;
  v_g := lower(coalesce(p_game,'guandan'));
  -- 陈旧桌自动作废(仅本房): lobby/playing 5 分钟无活动即判僵尸桌散掉(与 eh_gt_reap 同阈值)。
  update public.eh_game_tables
    set status='closed', updated_at=now()
    where room_id=p_room and status in ('lobby','playing')
      and updated_at < now() - interval '5 minutes';
  select * into v_row from public.eh_game_tables
    where room_id=p_room and status in ('lobby','playing') limit 1;
  if found then
    -- 我自己的桌 + 同游戏 → 幂等复用
    if v_row.host_uid = v_me and lower(coalesce(v_row.game,'')) = v_g then
      return v_row;
    end if;
    -- 我自己的桌 + 换游戏 → 关旧开新(随时另开游戏)
    if v_row.host_uid = v_me then
      update public.eh_game_tables set status='closed', updated_at=now() where id=v_row.id;
    else
      -- 别人的活桌 → 返回让其去加入(一房一桌)
      return v_row;
    end if;
  end if;
  v_cnt := public.eh_gt_seat_count(p_game);
  insert into public.eh_game_tables(room_id, game, host_uid, seats, seat_count)
    values (p_room, coalesce(p_game,'guandan'), v_me,
            public.eh_gt_init_seats(v_me, p_name, p_emoji, v_cnt), v_cnt)
    returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_open(uuid,text,text,text) to public;

-- ---- RPC: 加入一个空座(真人) ----
-- 招募中(lobby)任何桌都可加入; 进行中(playing)【仅德州】放行 —— 桌注制真牌桌, 路人可随时坐下空位,
--   host 下一手把该席从 AI 顶位换成真人上桌(掼蛋/斗地主固定阵型, 开局后不接受加入)。
create or replace function public.eh_gt_join(p_table uuid, p_seat int, p_name text, p_emoji text)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_target jsonb; v_nlhe boolean;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  v_nlhe := lower(coalesce(v_row.game,'')) in ('nlhe','holdem','texas');
  if v_row.status <> 'lobby' and not (v_row.status='playing' and v_nlhe) then
    raise exception 'not joinable';
  end if;
  if p_seat < 0 or p_seat >= v_row.seat_count then raise exception 'bad seat'; end if;
  -- 先把我当前占的座清空(防一人两座)
  update public.eh_game_tables t set seats = (
    select jsonb_agg(
      case when (s->>'kind')='human' and (s->>'uid')=v_me::text
           then jsonb_build_object('seat',(s->>'seat')::int,'kind','empty') else s end
      order by (s->>'seat')::int)
    from jsonb_array_elements(t.seats) s)
  where t.id=p_table;
  select * into v_row from public.eh_game_tables where id=p_table;
  v_target := v_row.seats -> p_seat;
  -- 德州(nlhe): 真人可坐空位, 也可【顶替灵魂/分身/AI 席】—— 真人随时点卡换掉 AI 顶位(设计本意),
  --   只不许顶替另一个真人。灵魂/AI 席手牌只活在 host 引擎、从不落库, 顶替者要到下一手才被发牌, 无偷牌风险。
  --   掼蛋/斗地主(固定阵型, 开局后不接受加入): 仍只允许坐空位。
  if v_nlhe then
    if (v_target->>'kind') = 'human' then raise exception 'seat taken'; end if;
  else
    if (v_target->>'kind') <> 'empty' then raise exception 'seat taken'; end if;
  end if;
  update public.eh_game_tables
    set seats = jsonb_set(seats, array[p_seat::text],
          jsonb_build_object('seat',p_seat,'kind','human','uid',v_me,'name',p_name,'emoji',p_emoji)),
        updated_at=now()
    where id=p_table returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_join(uuid,int,text,text) to public;

-- ---- RPC: 离座 ----
-- host 离座 → 直接关桌(phase-1 不做转移)。其他人离座 → 该座变空。
create or replace function public.eh_gt_leave(p_table uuid)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid = v_me then
    update public.eh_game_tables set status='closed', updated_at=now()
      where id=p_table returning * into v_row;
    return v_row;
  end if;
  update public.eh_game_tables t set seats = (
    select jsonb_agg(
      case when (s->>'kind')='human' and (s->>'uid')=v_me::text
           then jsonb_build_object('seat',(s->>'seat')::int,'kind','empty') else s end
      order by (s->>'seat')::int)
    from jsonb_array_elements(t.seats) s), updated_at=now()
  where t.id=p_table returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_leave(uuid) to public;

-- ---- RPC: 邀请灵魂入座(仅 host) ----
create or replace function public.eh_gt_seat_soul(p_table uuid, p_seat int, p_soul uuid)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_target jsonb;
  v_name text; v_emoji text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  if v_row.status <> 'lobby' then raise exception 'not joinable'; end if;
  if p_seat < 0 or p_seat >= v_row.seat_count then raise exception 'bad seat'; end if;
  v_target := v_row.seats -> p_seat;
  if (v_target->>'kind') <> 'empty' then raise exception 'seat taken'; end if;
  -- 座位名取【房内原名】(eh_members.name = "狼姐"), 不取 eh_users.name ——
  -- 后者全表 UNIQUE, 召唤的灵魂副本存的是内部唯一名"狼姐·<uid前6>", 直接坐进座位会把后缀泄漏到牌桌。
  select m.name, m.emoji into v_name, v_emoji
    from public.eh_members m where m.room_id=v_row.room_id and m.user_id=p_soul;
  if v_name is null then   -- 兜底: 无成员行(异常态)时退回灵魂配置表, 再退回 eh_users
    select s.name, s.emoji into v_name, v_emoji
      from public.eh_souls s where s.auth_uid=p_soul and s.room_id=v_row.room_id limit 1;
  end if;
  if v_name is null then
    select name, emoji into v_name, v_emoji from public.eh_users where id=p_soul;
  end if;
  if v_name is null then raise exception 'soul not found'; end if;
  update public.eh_game_tables
    set seats = jsonb_set(seats, array[p_seat::text],
          jsonb_build_object('seat',p_seat,'kind','soul','uid',p_soul,'name',v_name,'emoji',v_emoji)),
        updated_at=now()
    where id=p_table returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_seat_soul(uuid,int,uuid) to public;

-- ---- RPC: 灵魂分身入座(仅 host) ----
-- 房里真灵魂不够坐满时, 借一位【在场灵魂】的身份克隆出"分身"补位: 顶原灵魂头像、名字标成
-- "原名·分身[序号]"(序号≥2 才带数字, 首个分身只叫"·分身"), 由 host 本机 AI 代打。
-- 与 seat_soul 一样: 名字取【房内原名】(eh_members.name), 绝不取 eh_users 全表唯一名(带·<uid前6>后缀)
-- 以免把内部唯一名泄漏到牌桌。p_seq = 该原灵魂被克隆的第几个分身(客户端从 1 起传)。
create or replace function public.eh_gt_seat_clone(p_table uuid, p_seat int, p_origin uuid, p_seq int)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_target jsonb;
  v_name text; v_emoji text; v_disp text;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  if v_row.status <> 'lobby' then raise exception 'not joinable'; end if;
  if p_seat < 0 or p_seat >= v_row.seat_count then raise exception 'bad seat'; end if;
  v_target := v_row.seats -> p_seat;
  if (v_target->>'kind') <> 'empty' then raise exception 'seat taken'; end if;
  -- 房内原名优先, 逐级兜底(同 seat_soul)
  select m.name, m.emoji into v_name, v_emoji
    from public.eh_members m where m.room_id=v_row.room_id and m.user_id=p_origin;
  if v_name is null then
    select s.name, s.emoji into v_name, v_emoji
      from public.eh_souls s where s.auth_uid=p_origin and s.room_id=v_row.room_id limit 1;
  end if;
  if v_name is null then
    select name, emoji into v_name, v_emoji from public.eh_users where id=p_origin;
  end if;
  if v_name is null then raise exception 'origin soul not found'; end if;
  v_disp := v_name || '·分身' || (case when coalesce(p_seq,1) > 1 then p_seq::text else '' end);
  update public.eh_game_tables
    set seats = jsonb_set(seats, array[p_seat::text],
          jsonb_build_object('seat',p_seat,'kind','clone','uid',p_origin,'name',v_disp,'emoji',v_emoji)),
        updated_at=now()
    where id=p_table returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_seat_clone(uuid,int,uuid,int) to public;

-- ---- RPC: 请离某座(仅 host, 把该座变空; 不能踢自己那种走 leave) ----
create or replace function public.eh_gt_kick(p_table uuid, p_seat int)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  if v_row.status <> 'lobby' then raise exception 'not joinable'; end if;
  if p_seat <= 0 or p_seat >= v_row.seat_count then raise exception 'bad seat'; end if;  -- 0 席=host, 不可踢
  update public.eh_game_tables
    set seats = jsonb_set(seats, array[p_seat::text],
          jsonb_build_object('seat',p_seat,'kind','empty')),
        updated_at=now()
    where id=p_table returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_kick(uuid,int) to public;

-- ---- RPC: 开始(仅 host; 落 seed, 转 playing) ----
-- 空座处理按游戏分:
--   · 德州(nlhe): 空座【保持 empty 不焊死】—— 真牌桌语义, 桌注制, 空位随时可被路人坐下(见 eh_gt_join
--     放行 playing 态加入)。host 本机引擎逐手把 empty 席当 AI 顶位打, 有人坐下则下一手换成真人。
--   · 掼蛋(2v2 固定队)/斗地主(叫地主): 中途加人无意义, 沿用旧语义把空座补成 AI 焊死, 开局即定员。
create or replace function public.eh_gt_start(p_table uuid, p_seed bigint)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_nlhe boolean;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  if v_row.status <> 'lobby' then raise exception 'already started'; end if;
  v_nlhe := lower(coalesce(v_row.game,'')) in ('nlhe','holdem','texas');
  if v_nlhe then
    update public.eh_game_tables set seed=p_seed, status='playing', updated_at=now()
      where id=p_table returning * into v_row;   -- 空座不焊死, 保持 empty
  else
    update public.eh_game_tables t set
      seats = (select jsonb_agg(
        case when (s->>'kind')='empty'
             then jsonb_build_object('seat',(s->>'seat')::int,'kind','ai',
                                     'name','机器人'||((s->>'seat')::int),'emoji','🤖')
             else s end
        order by (s->>'seat')::int)
        from jsonb_array_elements(t.seats) s),
      seed = p_seed, status='playing', updated_at=now()
    where t.id=p_table returning * into v_row;
  end if;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_start(uuid,bigint) to public;

-- ---- RPC: host 写最新公开局态快照(late-join/重连读取) ----
create or replace function public.eh_gt_set_state(p_table uuid, p_state jsonb, p_status text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  update public.eh_game_tables
    set state = coalesce(p_state, state),
        status = coalesce(nullif(p_status,''), status),
        updated_at = now()
    where id=p_table;
end;
$$;
grant execute on function public.eh_gt_set_state(uuid,jsonb,text) to public;

-- ---- RPC: 关桌(仅 host) ----
create or replace function public.eh_gt_close(p_table uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  update public.eh_game_tables set status='closed', updated_at=now() where id=p_table;
end;
$$;
grant execute on function public.eh_gt_close(uuid) to public;

-- ---- RPC: 记牌桌卡消息 id(开桌后回填, 供定位) ----
create or replace function public.eh_gt_set_msg(p_table uuid, p_msg bigint)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  update public.eh_game_tables set msg_id=p_msg where id=p_table;
end;
$$;
grant execute on function public.eh_gt_set_msg(uuid,bigint) to public;

-- ---- 开 Realtime replication (前端订阅座位/局态变化刷牌桌卡) ----
alter publication supabase_realtime add table public.eh_game_tables;

-- 验证:
-- select tablename from pg_tables where tablename='eh_game_tables';
-- select proname from pg_proc where proname like 'eh_gt_%';

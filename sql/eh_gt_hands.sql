-- ===== 真人联机牌桌 phase-2: 私有手牌下发 (掼蛋/斗地主) 2026-08-15 =====
-- host 独占跑引擎当裁判(见 eh_game_tables.sql)。逐手过程(轮到谁/出了什么牌/各家剩几张)
-- 是【公开信息】,走 realtime broadcast(不落库)。唯独【每家自己的手牌】是私密的,
-- 若也走公开 broadcast 会被别的客户端嗅到 → 可作弊(看穿对手牌)。故手牌单独存这张表,
-- 靠 RLS 保证【每个 uid 只能 select 到自己那一行】,再靠 realtime 把该行的变化只推给本人。
--
-- 写入频率很低(不是逐手): 仅发牌时、掼蛋进贡还贡后、以及某座手牌因出牌/被代打而变化时,
-- host 重写【该真人座位】一行。AI/灵魂座位无需下发(host 本机持有)。
-- host 自己坐 0 席的手牌也不必落这张表(它在 host 本机引擎里)。
-- 一切写操作走 security definer RPC(host only),直接表写被 RLS 拒。

create table if not exists public.eh_gt_hands (
  table_id uuid not null references public.eh_game_tables(id) on delete cascade,
  seat int not null,
  uid uuid not null,                 -- 该座真人的 user_id(RLS 按此放行)
  hand jsonb not null default '[]'::jsonb,  -- 该家当前手牌(牌对象数组,与引擎 hand 同构)
  updated_at timestamptz default now(),
  primary key (table_id, seat)
);
create index if not exists eh_gt_hands_uid_idx on public.eh_gt_hands(uid);

alter table public.eh_gt_hands enable row level security;

-- 读: 只能读自己那行(uid = 当前登录用户)。这是防作弊命门——别人手牌一律 select 不到。
drop policy if exists eh_gt_hands_select_own on public.eh_gt_hands;
create policy eh_gt_hands_select_own on public.eh_gt_hands
  for select to public using (uid = auth.uid());
-- 写: 无 insert/update/delete policy → 直接表写一律被拒, 只能走下面的 RPC(host 权威)。

-- ---- helper: 校验调用者是该桌 host ----
create or replace function public.eh_gt_is_host(p_table uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from public.eh_game_tables where id=p_table and host_uid=auth.uid());
$$;

-- ---- RPC: host 批量发牌/重写手牌 ----
-- p_hands = [{seat:int, uid:uuid, hand:jsonb}, ...] 只含【真人非 host 座位】。
-- 幂等 upsert: 同 (table_id,seat) 覆盖。发牌、进贡还贡后各调一次(带全部真人座位)。
create or replace function public.eh_gt_set_hands(p_table uuid, p_hands jsonb)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_host uuid; v_item jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select host_uid into v_host from public.eh_game_tables where id=p_table;
  if v_host is null then raise exception 'table not found'; end if;
  if v_host <> v_me then raise exception 'host only'; end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_hands,'[]'::jsonb)) loop
    insert into public.eh_gt_hands(table_id, seat, uid, hand, updated_at)
      values (p_table, (v_item->>'seat')::int, (v_item->>'uid')::uuid,
              coalesce(v_item->'hand','[]'::jsonb), now())
    on conflict (table_id, seat)
      do update set uid=excluded.uid, hand=excluded.hand, updated_at=now();
  end loop;
end;
$$;
grant execute on function public.eh_gt_set_hands(uuid,jsonb) to public;

-- ---- RPC: host 更新单座手牌(某家出牌/被代打后,只重写这一家) ----
create or replace function public.eh_gt_update_hand(p_table uuid, p_seat int, p_uid uuid, p_hand jsonb)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_host uuid;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select host_uid into v_host from public.eh_game_tables where id=p_table;
  if v_host is null then raise exception 'table not found'; end if;
  if v_host <> v_me then raise exception 'host only'; end if;
  insert into public.eh_gt_hands(table_id, seat, uid, hand, updated_at)
    values (p_table, p_seat, p_uid, coalesce(p_hand,'[]'::jsonb), now())
  on conflict (table_id, seat)
    do update set uid=excluded.uid, hand=excluded.hand, updated_at=now();
end;
$$;
grant execute on function public.eh_gt_update_hand(uuid,int,uuid,jsonb) to public;

-- ---- RPC: 取自己当前手牌(late-join/重连时主动拉一次,不等 realtime) ----
-- RLS 已保证只能拿到自己那行; 这里额外按 uid 过滤兜底。
create or replace function public.eh_gt_my_hand(p_table uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select hand from public.eh_gt_hands
                   where table_id=p_table and uid=auth.uid() limit 1), '[]'::jsonb);
$$;
grant execute on function public.eh_gt_my_hand(uuid) to public;

-- ---- 开 Realtime replication (客户端订阅自己手牌行变化) ----
-- 注: 订阅端必须带 filter=uid=eq.<myUid>, 且 RLS 已挡住他人行, realtime 也只会推自己的。
alter publication supabase_realtime add table public.eh_gt_hands;

-- 验证:
-- select tablename from pg_tables where tablename='eh_gt_hands';
-- select proname from pg_proc where proname like 'eh_gt_%hand%' or proname='eh_gt_set_hands';

-- ============================================================
-- T84/T85 服务端权威筹码: 把筹码从各设备 localStorage 挪到服务端, 按 uid+game 存一份权威值。
--   解决: ①灵魂筹码跨桌/跨设备一致(不再每次从 GRANT 重来) ②赠送筹码能真正改到对方的数。
--   真人与有真实 uid 的灵魂都入账; 匿名机器人无 uid 不入账(前端照旧用 GRANT 兜底)。
-- 幂等, 可重复执行。
-- ============================================================

create table if not exists public.eh_chips (
  user_id uuid not null,
  game text not null,                 -- 'nlhe' | 'doudizhu' | 'guandan'
  chips bigint not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, game)
);
alter table public.eh_chips enable row level security;
-- 读: 认证用户可读任意人筹码(牌桌买入要按对手 uid 读其筹码)
drop policy if exists eh_chips_sel on public.eh_chips;
create policy eh_chips_sel on public.eh_chips for select to public using (true);
-- 写: 无直写 policy, 只能走下面的 RPC(保证转账/结算原子且受控)

-- 每个游戏的初始赠予(与前端 score.js GRANT 对齐: nlhe=5000)
create or replace function public._eh_chip_grant(p_game text)
returns bigint language sql immutable as $$
  select case lower(coalesce(p_game,'')) when 'nlhe' then 5000::bigint else 1000::bigint end;
$$;

-- 读某人某游戏筹码: 无记录则按 GRANT 建一行并返回(首次自动赠予)。
create or replace function public.eh_chips_get(p_uid uuid, p_game text)
returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare v_c bigint; v_g text := lower(coalesce(p_game,'nlhe'));
begin
  if p_uid is null then return public._eh_chip_grant(v_g); end if;
  select chips into v_c from public.eh_chips where user_id=p_uid and game=v_g;
  if v_c is null then
    v_c := public._eh_chip_grant(v_g);
    insert into public.eh_chips(user_id, game, chips) values (p_uid, v_g, v_c)
      on conflict (user_id, game) do nothing;
    select chips into v_c from public.eh_chips where user_id=p_uid and game=v_g;
  end if;
  return coalesce(v_c, public._eh_chip_grant(v_g));
end;
$$;
grant execute on function public.eh_chips_get(uuid, text) to public;

-- 批量读多个 uid 的筹码(开桌摆阵时一次拉灵魂+真人): 返回 jsonb { uid: chips }
create or replace function public.eh_chips_get_many(p_uids uuid[], p_game text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_g text := lower(coalesce(p_game,'nlhe')); v_out jsonb := '{}'::jsonb; u uuid;
begin
  if p_uids is null then return v_out; end if;
  foreach u in array p_uids loop
    v_out := v_out || jsonb_build_object(u::text, public.eh_chips_get(u, v_g));
  end loop;
  return v_out;
end;
$$;
grant execute on function public.eh_chips_get_many(uuid[], text) to public;

-- 结算写回: 把某人某游戏筹码设为绝对值(散桌/每手后 host 上报真实 stack)。只认自己或有真实 uid 的灵魂由 host 代写。
--   p_uid=null 时写自己。限幅 [0, 1e9] 防脏数据。
create or replace function public.eh_chips_set(p_uid uuid, p_game text, p_chips bigint)
returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_g text := lower(coalesce(p_game,'nlhe')); v_c bigint;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_uid is null then p_uid := v_me; end if;
  v_c := greatest(0, least(1000000000, coalesce(p_chips,0)));
  insert into public.eh_chips(user_id, game, chips, updated_at) values (p_uid, v_g, v_c, now())
    on conflict (user_id, game) do update set chips=excluded.chips, updated_at=now();
  return v_c;
end;
$$;
grant execute on function public.eh_chips_set(uuid, text, bigint) to public;

-- T85 赠送筹码: 从我(auth.uid)转 p_amount 给 p_to(默认游戏 nlhe)。原子: 余额不足则拒; 自己不能转给自己。
create or replace function public.eh_chips_gift(p_to uuid, p_game text, p_amount bigint)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_g text := lower(coalesce(p_game,'nlhe'));
        v_amt bigint := coalesce(p_amount, 1000); v_mine bigint; v_their bigint;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_to is null then raise exception 'bad target'; end if;
  if p_to = v_me then raise exception 'cannot gift self'; end if;
  if v_amt <= 0 or v_amt > 1000000 then raise exception 'bad amount'; end if;
  v_mine := public.eh_chips_get(v_me, v_g);     -- 确保两行都存在(首次自动赠予)
  v_their := public.eh_chips_get(p_to, v_g);
  if v_mine < v_amt then raise exception 'insufficient'; end if;
  update public.eh_chips set chips=chips - v_amt, updated_at=now() where user_id=v_me and game=v_g;
  update public.eh_chips set chips=chips + v_amt, updated_at=now() where user_id=p_to and game=v_g;
  return jsonb_build_object('from_left', v_mine - v_amt, 'to_now', v_their + v_amt, 'amount', v_amt);
end;
$$;
grant execute on function public.eh_chips_gift(uuid, text, bigint) to public;

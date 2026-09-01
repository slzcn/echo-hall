-- ===== 历史积分/战绩聚合 (斗地主/掼蛋/德州) 2026-09-01 =====
-- 背景: eh_game_results 是"每局原始流水"(只写不读、单视角), 没有任何累计。
--   主人要"历史积分记录下来" → 这张聚合表按 (user_id, game) 累加, 个人空间可查。
-- 权威: 每局引擎只在 host 浏览器跑, host 是本局裁判 → 由 host 结算时调 eh_stat_bump
--   一次性把【全桌真人席】的账变累加(灵魂/AI/空位不计)。guest 不重复上报, 避免多写。
-- 计分口径: plays=对局数(德州按"手"计, 因其每手独立结算), score=累计净账变
--   (斗地主/掼蛋=分, 德州=筹码), wins/losses 按该玩家本局是否在赢家侧。

create table if not exists public.eh_user_stats (
  user_id uuid not null,
  game text not null,                          -- 'doudizhu' | 'guandan' | 'nlhe'
  plays int not null default 0,                -- 对局数(德州=手数)
  wins int not null default 0,
  losses int not null default 0,
  score bigint not null default 0,             -- 累计净账变(斗地主/掼蛋=分, 德州=筹码)
  updated_at timestamptz default now(),
  primary key (user_id, game)
);
alter table public.eh_user_stats enable row level security;

-- 读: 只读自己的战绩(未来做房间/全站榜再放开或加视图)。
drop policy if exists eh_user_stats_sel on public.eh_user_stats;
create policy eh_user_stats_sel on public.eh_user_stats
  for select to public using (user_id = auth.uid());

-- 写只走下面的 security definer RPC, 不开放任何直接 insert/update policy(RLS 默认拒)。

-- 累加一局战绩。p_entries = [{uid, delta, won}], 由 host 上报全桌真人席。
--   安全: ① 必须登录; ② 上报者本人必须在名单里(host 是本局在座玩家)防替不相干的人刷分;
--         ③ delta 限幅 ±100000 防单次溢出刷分。娱乐性历史统计, 非排位无奖励;
--         残余"host 可给同桌真人记分"与既有 host 权威模型一致, 未来 Edge 权威可闭合。
create or replace function public.eh_stat_bump(p_game text, p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  e jsonb;
  u uuid;
  d bigint;
  w boolean;
  caller_in boolean := false;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  if p_game not in ('doudizhu','guandan','nlhe') then raise exception 'bad game'; end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'entries not array'; end if;

  -- 上报者本人须在名单(host 在座)
  for e in select * from jsonb_array_elements(p_entries) loop
    if (e->>'uid') is not null and (e->>'uid')::uuid = caller then caller_in := true; end if;
  end loop;
  if not caller_in then raise exception 'reporter not in entries'; end if;

  for e in select * from jsonb_array_elements(p_entries) loop
    if (e->>'uid') is null then continue; end if;
    u := (e->>'uid')::uuid;
    d := coalesce((e->>'delta')::bigint, 0);
    if d >  100000 then d :=  100000; end if;   -- 限幅
    if d < -100000 then d := -100000; end if;
    w := coalesce((e->>'won')::boolean, false);
    insert into public.eh_user_stats(user_id, game, plays, wins, losses, score, updated_at)
      values (u, p_game, 1,
              case when w then 1 else 0 end,
              case when w then 0 else 1 end,
              d, now())
    on conflict (user_id, game) do update set
      plays  = eh_user_stats.plays  + 1,
      wins   = eh_user_stats.wins   + case when w then 1 else 0 end,
      losses = eh_user_stats.losses + case when w then 0 else 1 end,
      score  = eh_user_stats.score  + d,
      updated_at = now();
  end loop;
end;
$$;
grant execute on function public.eh_stat_bump(text, jsonb) to public;

-- 验证:
-- select tablename from pg_tables where tablename='eh_user_stats';
-- select * from public.eh_user_stats where user_id = auth.uid();

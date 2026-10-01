-- ============================================================
-- T82 一局一卡 + 动态带: 给牌桌行加 highlights jsonb, 名场面(好牌/大赢)写进来,
--   随现有 realtime(eh_game_tables UPDATE)广播到各端, 卡底渲染"动态带"。
--   取代"每次名场面往聊天流插一条独立战绩卡"的刷屏做法 —— 一局始终只有那一张牌桌卡。
-- 幂等: 可重复执行。
-- 部署: 走 Management API query 或 psql 执行本文件。
-- ============================================================

alter table public.eh_game_tables
  add column if not exists highlights jsonb not null default '[]'::jsonb;

-- RPC: 往牌桌 highlights 追加一条动态(滚动保留最近 5 条)。
--   p_entry 形如 {"t":1730000000,"kind":"win","text":"狼姐 同花顺 通吃 ¥3200","emoji":"🔥"}
--   任何在座真人都能写(名场面由各端引擎在结算时判定并上报); 非在座/桌已关则拒。
create or replace function public.eh_gt_push_highlight(p_table uuid, p_entry jsonb)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_arr jsonb;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if p_entry is null then return; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.status not in ('lobby','playing') then return; end if;   -- 已散桌不再收动态
  -- 在座真人校验(含开桌人): 防任意用户往别人桌刷动态
  perform 1 from jsonb_array_elements(coalesce(v_row.seats,'[]'::jsonb)) s
    where (s->>'kind')='human' and (s->>'uid')=v_me::text;
  if not found and v_row.host_uid <> v_me then raise exception 'not seated'; end if;
  -- 追加并滚动保留最近 5 条(超出截掉最旧, 保持旧→新序)
  v_arr := coalesce(v_row.highlights, '[]'::jsonb) || jsonb_build_array(p_entry);
  if jsonb_array_length(v_arr) > 5 then
    v_arr := (
      select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
      from jsonb_array_elements(v_arr) with ordinality as t(e, ord)
      where ord > jsonb_array_length(v_arr) - 5
    );
  end if;
  update public.eh_game_tables set highlights=v_arr, updated_at=now() where id=p_table;
end;
$$;
grant execute on function public.eh_gt_push_highlight(uuid, jsonb) to public;

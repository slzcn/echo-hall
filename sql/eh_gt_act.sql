-- eh_gt_act.sql — 联机牌桌动作服务端权威(phase-2)
-- 防远程真人互冒: 客户端把动作交给 RPC, 由 JWT 绑定 uid→seat 后再进 host 引擎。
-- 部署: 在 Supabase SQL editor 执行; 前端检测 window 上 EH_GT_ACT 可用则走 RPC, 否则退回 broadcast+uid 校验。

create or replace function public.eh_gt_act(
  p_table uuid,
  p_seat int,
  p_move jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_host uuid;
  v_kind text;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'no_auth');
  end if;
  select host_uid, status into v_host, v_status
    from public.eh_game_tables where id = p_table;
  if v_host is null then
    return jsonb_build_object('ok', false, 'error', 'no_table');
  end if;
  -- 座位必须是本人(uid 匹配)
  perform 1 from jsonb_array_elements(
    coalesce((select seats from public.eh_game_tables where id = p_table), '[]'::jsonb)
  ) e
  where (e->>'seat')::int = p_seat
    and e->>'kind' = 'human'
    and e->>'uid' = v_uid::text;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'seat_mismatch');
  end if;
  -- 写入动作日志(host 客户端可订阅; 亦可由 host 轮询)
  insert into public.eh_logs (kind, payload)
  values ('gt_act', jsonb_build_object(
    'table', p_table, 'seat', p_seat, 'uid', v_uid, 'move', p_move, 'at', now()
  ));
  return jsonb_build_object('ok', true, 'seat', p_seat, 'uid', v_uid);
end;
$$;

grant execute on function public.eh_gt_act(uuid, int, jsonb) to authenticated;

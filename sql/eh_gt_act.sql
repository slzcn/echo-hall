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
  -- 写入动作日志(诊断用)。★必须用 eh_logs 真实列(scope/tag/actor_id/payload):
  --   旧版 insert (kind, payload) 引用不存在的 kind 列 → 整个函数抛错 → 客人 RPC 永远失败,
  --   退回 broadcast 后又被 host 的 requireViaRpc 拒 → 客人彻底不能出牌(2026-09-29 实案)。
  --   日志失败不阻断出牌: 包异常块, 只 debug 级记一笔。
  begin
    insert into public.eh_logs (scope, tag, actor_id, payload)
    values ('user', 'gt_act', v_uid, jsonb_build_object(
      'table', p_table, 'seat', p_seat, 'uid', v_uid, 'move', p_move, 'at', now()
    ));
  exception when others then
    null;
  end;
  return jsonb_build_object('ok', true, 'seat', p_seat, 'uid', v_uid);
end;
$$;

grant execute on function public.eh_gt_act(uuid, int, jsonb) to authenticated;

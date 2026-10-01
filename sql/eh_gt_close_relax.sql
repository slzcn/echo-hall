-- ============================================================
-- T83 托底自动解散: 放宽 eh_gt_close 权限 —— 开桌人 OR 当前在座真人都能散桌。
--   无房主德州里开桌人可能早已离场, 桌卡住又无人能散(host only 卡死)。放宽后桌上任何真人可自救;
--   前端"超时无进展"检测触发 close 时, 调用者只要是在座真人即可成功。
-- 幂等, 可重复执行。
-- ============================================================
create or replace function public.eh_gt_close(p_table uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_seated int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then
    -- 非开桌人: 必须是当前在座真人才允许散(防任意用户散别人的桌)
    select count(*) into v_seated
      from jsonb_array_elements(coalesce(v_row.seats,'[]'::jsonb)) s
      where (s->>'kind')='human' and (s->>'uid')=v_me::text;
    if v_seated = 0 then raise exception 'host only'; end if;
  end if;
  update public.eh_game_tables set status='closed', updated_at=now() where id=p_table;
end;
$$;
grant execute on function public.eh_gt_close(uuid) to public;

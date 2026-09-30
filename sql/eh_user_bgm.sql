
-- 广播曲需要被同房间用户读取：允许读取当前 active 曲对应的行；
-- 用户自己的曲库仍只暴露自己的其它曲目。
drop policy if exists eh_user_bgm_active_select on public.eh_user_bgm;
create policy eh_user_bgm_active_select on public.eh_user_bgm
  for select to authenticated using (
    auth.uid() = auth_uid
    or exists (
      select 1 from public.eh_room_active_bgm a
      where a.bgm_id = eh_user_bgm.id
    )
  );

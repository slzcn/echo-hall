-- ===== EH 私密房准入漏洞修复 (2026-07-14 23:xx) =====
-- 漏洞: eh_members INSERT 策略 WITH CHECK 只校验 (auth.uid()=user_id),
--       不校验目标房是否允许加入 → 任何登录用户(含匿名)能把自己塞进任意私密房.
-- 修复: 1) 新增 SECURITY DEFINER 函数 eh_join_by_code(code): 校验邀请码正确后代插 member.
--       2) 收紧 eh_members INSERT: 仅允许加入 open房(公开/官方) 或 自己已是该房成员(重复upsert/owner建房).
--          私密房首次加入必须走 eh_join_by_code (带码校验), 不能裸 insert.

-- 1) 邀请码加入 RPC: 校验 code 对应私密房后, 以 definer 权限插入成员(绕过收紧后的 INSERT RLS)
create or replace function public.eh_join_by_code(p_code text, p_name text default null, p_emoji text default null, p_color text default null)
returns table(id uuid, name text, emoji text, topic text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_room eh_rooms%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select * into v_room from eh_rooms r where r.invite_code = p_code and r.kind='private' limit 1;
  if not found then
    raise exception 'invalid code';
  end if;
  -- 代插成员(重复靠主键忽略)
  insert into eh_members(room_id, user_id, role, name, emoji, color)
  values (v_room.id, v_uid, 'member', coalesce(p_name,'旅人'), coalesce(p_emoji,'🙂'), coalesce(p_color,'#8B5CFF'))
  on conflict (room_id, user_id) do nothing;
  return query select v_room.id, v_room.name, v_room.emoji, v_room.topic;
end;
$$;

grant execute on function public.eh_join_by_code(text,text,text,text) to public;

-- 2) 收紧 eh_members INSERT: 只允许 open房 / 自己已是成员(含owner) / 自己是房owner(建房首插)
--    私密房陌生人裸 insert 会被 WITH CHECK 挡住; 合法邀请码加入走 eh_join_by_code(definer 绕过).
drop policy if exists members_insert on public.eh_members;
create policy members_insert on public.eh_members
  for insert to public
  with check (
    auth.uid() = user_id
    and (
      eh_room_is_open(room_id)                       -- 公开/官方房: 谁都能进
      or exists (select 1 from eh_rooms r where r.id=room_id and r.owner=auth.uid())  -- 自己是房主(建私密房首插)
      or eh_is_member(room_id)                        -- 已是成员(重复 upsert 幂等)
    )
  );

-- ==========================================================
-- Echo Hall 统一日志表 eh_logs
-- 合并前后台日志，用 scope 区分 admin/user
-- ==========================================================

create table if not exists public.eh_logs (
  id           bigserial primary key,
  scope        text not null check (scope in ('admin','user')),
  tag          text not null,
  actor_id     uuid,
  actor_name   text,
  room_id      uuid,
  room_name    text,
  target_id    uuid,
  target_name  text,
  payload      jsonb,
  ip           text,
  ua           text,
  created_at   timestamptz default now()
);

create index if not exists eh_logs_scope_time_idx on public.eh_logs(scope, created_at desc);
create index if not exists eh_logs_tag_idx on public.eh_logs(tag);
create index if not exists eh_logs_actor_idx on public.eh_logs(actor_id);
create index if not exists eh_logs_room_idx on public.eh_logs(room_id);
create index if not exists eh_logs_time_idx on public.eh_logs(created_at desc);

-- 启用 RLS
alter table public.eh_logs enable row level security;

-- 策略1: anon + authenticated 都可 INSERT（前端写日志）
--        限制只能写 scope='user' 的行 —— admin scope 由 Edge Function 用 service_role 写
create policy "eh_logs anon insert user scope" on public.eh_logs
  for insert to anon, authenticated
  with check (scope = 'user');

-- 策略2: 任何人 SELECT 拒绝（防隐私泄漏）
--        admin 通过 Edge Function 走 service_role 读
--        （不加 select policy 就是默认全部拒绝）

-- 策略3: 无 UPDATE/DELETE 策略 = 日志不可修改
--        service_role 绕过 RLS，需要清理旧日志时用 service_role 手动清

-- ============================================================
-- tag 白名单（应用层约束，DB 不强制）：
-- admin scope:
--   config_update / config_rollback / admin_grant / admin_revoke
--   super_transfer / message_delete / room_dissolve
-- user scope:
--   room_create / room_dissolve / member_kick / room_update
--   room_enter / room_leave / message_send（如启用发言日志）
-- ============================================================

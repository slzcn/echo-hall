-- ============================================================
-- echo-hall 游戏灵魂种子脚本
-- 把德州扑克 BOT_POOL 的8个花名角色升级为 DB 级「游戏灵魂」
-- scope='game' → 只用于游戏场景(牌桌补位), 不会出现在聊天室
-- ============================================================
-- 执行方式: Supabase Dashboard → SQL Editor → 粘贴本文 → Run
-- 可安全重复执行(idempotent): 表/视图/函数均使用 IF NOT EXISTS + ON CONFLICT
-- ============================================================

-- ---- 1. 建表: eh_game_souls ----
-- 与 eh_souls(聊天灵魂) 分离: eh_souls 绑 auth.users + room_id;
-- eh_game_souls 是独立的游戏灵魂定义表, 不依赖 auth.users, scope='game' 标记只用于游戏。
create table if not exists public.eh_game_souls (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  emoji       text        not null,
  archetype   text        not null,           -- cool|sharp|wild|playful|warm (对应 poker-ai.js SOUL_STYLE)
  enabled     boolean     not null default true,
  scope       text        not null default 'game',
  created_at  timestamptz not null default now()
);

-- 唯一约束: (name, scope) 组合唯一, 保证 seed 幂等
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'eh_game_souls_name_scope_key'
  ) then
    alter table public.eh_game_souls add constraint eh_game_souls_name_scope_key unique (name, scope);
  end if;
end $$;

comment on table  public.eh_game_souls is '游戏灵魂定义表(scope=game, 只用于牌桌补位, 不进聊天室)';
comment on column public.eh_game_souls.id        is '游戏灵魂 UUID(伪 auth_uid, 供 eh_room_souls RPC 返回)';
comment on column public.eh_game_souls.name      is '花名(与 poker-ui.js BOT_POOL 一致)';
comment on column public.eh_game_souls.emoji     is '头像 emoji';
comment on column public.eh_game_souls.archetype is '打法原型: cool→rock, sharp→tag, wild→maniac, playful→lag, warm→station';
comment on column public.eh_game_souls.enabled   is '后台开关: false 时 eh_room_souls 不返回此灵魂';
comment on column public.eh_game_souls.scope     is '场景标记: game=仅游戏; 未来可扩展 chat 等';

-- ---- 2. 插入8条游戏灵魂(对应 BOT_POOL) ----
-- 使用固定 UUID(uuid5 基于 DNS 命名空间), 保证脚本幂等可重跑。
insert into public.eh_game_souls (id, name, emoji, archetype, enabled, scope, created_at) values
  ('df60930a-8069-503c-b36a-7894b4cdea55', '阿岩', '🗿', 'cool',    true, 'game', now()),
  ('3a008248-9232-5161-a043-0d2da4d4a0c1', '小凶', '🔥', 'sharp',   true, 'game', now()),
  ('e72c06f8-3508-5de4-b423-91714cdf584a', '疯哥', '🤪', 'wild',    true, 'game', now()),
  ('ed95c0c3-5f07-5246-9d1b-29d6a07b1a73', '冷面', '🥶', 'cool',    true, 'game', now()),
  ('dc481fca-62e0-5f7d-8944-e45a23e4843c', '老练', '🧊', 'sharp',   true, 'game', now()),
  ('3b5e53b4-d503-5fdf-a1f4-9703a47bb283', '莽夫', '😤', 'wild',    true, 'game', now()),
  ('f3d09295-7f3e-579d-a51b-b32d80c5eafa', '狐狸', '🦊', 'playful', true, 'game', now()),
  ('be946f18-c638-5cf3-bcb4-ac30292fd9ce', '铁头', '🐗', 'warm',    true, 'game', now())
on conflict (name, scope) do update set
  emoji     = excluded.emoji,
  archetype = excluded.archetype,
  enabled   = excluded.enabled;

-- ---- 3. 视图: eh_game_souls_for_room ----
-- 供 eh_room_souls RPC 在游戏场景下调用, 返回与 eh_souls 兼容的字段结构:
-- { auth_uid, name, emoji, archetype, scope }
-- eh_room_souls 需要手动修改: 在 game 场景下 union 本视图
create or replace view public.eh_game_souls_for_room as
  select
    id          as auth_uid,
    name,
    emoji,
    archetype,
    scope
  from public.eh_game_souls
  where enabled = true
    and scope = 'game';

comment on view public.eh_game_souls_for_room is '游戏灵魂视图(只返回 enabled+scope=game), 供 eh_room_souls RPC 合并';

-- ---- 4. (可选) 函数: eh_game_souls_for_room_fn ----
-- 如果 eh_room_souls 是 PL/pgSQL 函数而非 view, 可用此函数在函数体内 union
create or replace function public.eh_game_souls_for_room_fn()
returns table (auth_uid uuid, name text, emoji text, archetype text, scope text)
language sql security definer set search_path to 'public' as $$
  select id, name, emoji, archetype, scope
  from public.eh_game_souls
  where enabled = true and scope = 'game';
$$;
grant select on public.eh_game_souls_for_room to public;
grant execute on function public.eh_game_souls_for_room_fn() to public;

-- ---- 验证 ----
-- 执行后运行以下查询确认:
-- select * from public.eh_game_souls order by name;
-- select * from public.eh_game_souls_for_room;
-- select * from public.eh_game_souls_for_room_fn();

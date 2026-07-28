-- ===== B: 首页/大厅展示"全站灵魂曲目",临时(匿名)用户也能听 =====
-- 背景: eh_user_bgm 的 select 策略只放行 "自己的曲" 或 "正在某房 active 的曲",
--       故刚进来的临时用户名下为空 → 看不到任何灵魂曲目 (见前端 bgmMyLibraryForRoom)。
-- 方案: 新增 SECURITY DEFINER 函数, 以定义者权限只读出"公开可听"的最近 N 首灵魂曲,
--       只暴露 title/url/room_name/created_at (不含 auth_uid, 保护隐私), grant 给 public(含匿名)。
--       前端在名下曲库为空时回退拉这个, 让人人都能刷到别人做的灵魂曲并点播。

create or replace function public.eh_public_songs(p_limit int default 30, p_room text default null)
returns table(id bigint, title text, url text, room_name text, created_at timestamptz)
language sql
security definer
set search_path to 'public'
as $$
  select b.id, b.title, b.url, b.room_name, b.created_at
  from public.eh_user_bgm b
  where b.url is not null and b.url <> ''
    and (p_room is null or b.room_name = p_room)
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit,30), 60))
$$;

grant execute on function public.eh_public_songs(int, text) to public;

-- 验证: select * from public.eh_public_songs(10);  -- 应返回最近 10 首(不论作者)

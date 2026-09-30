-- 清零今日(2026-09-30)所有 uid 的输光计数 —— 已满 5 次的玩家恢复可玩
-- 执行: supabase db execute --file sql/reset_daily_plays_20260930.sql
--   或 psql "$DATABASE_URL" -f 本文件
delete from public.eh_game_plays
 where day = to_char(now() at time zone 'utc', 'YYYY-MM-DD');

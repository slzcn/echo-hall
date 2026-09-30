-- Echo Hall — BGM 弹层每组显示条数（后台可配）
-- 用法：Supabase Dashboard → SQL Editor → 粘贴运行

-- 1) 加字段（默认 3）
alter table public.eh_rooms
  add column if not exists bgm_show_official smallint,
  add column if not exists bgm_show_soul     smallint;

comment on column public.eh_rooms.bgm_show_official is 'BGM 弹层每次显示官方曲目数（NULL/未设 → 前端 fallback 3）';
comment on column public.eh_rooms.bgm_show_soul     is 'BGM 弹层每次显示灵魂曲目数（NULL/未设 → 前端 fallback 3）';

-- 2)（可选）给全部房间设为 3；以后按需单独改某房间
--   update public.eh_rooms set bgm_show_official = 3 where bgm_show_official is null;
--   update public.eh_rooms set bgm_show_soul     = 3 where bgm_show_soul     is null;

-- 3) 后台按需修改示例
--   update public.eh_rooms set bgm_show_official = 5, bgm_show_soul = 4
--   where name = '深夜电台';

-- ============================================================
-- T84 一魂一桌: 同一灵魂同时只能在一张活桌(lobby/playing)在座。
--   重定义 eh_gt_seat_soul, 在原逻辑基础上加一道防重: 该灵魂 uid 已在【别的】活桌 seats 里 → 拒(soul busy)。
--   其余逻辑(host only / 留 2 空位 / 取房内原名)保持不变。
-- 幂等, 可重复执行。
-- ============================================================
create or replace function public.eh_gt_seat_soul(p_table uuid, p_seat int, p_soul uuid)
returns public.eh_game_tables
language plpgsql security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_row public.eh_game_tables%rowtype; v_target jsonb;
  v_name text; v_emoji text; v_busy int;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  select * into v_row from public.eh_game_tables where id=p_table for update;
  if not found then raise exception 'table not found'; end if;
  if v_row.host_uid <> v_me then raise exception 'host only'; end if;
  if v_row.status <> 'lobby' then raise exception 'not joinable'; end if;
  if p_seat < 0 or p_seat >= v_row.seat_count then raise exception 'bad seat'; end if;
  v_target := v_row.seats -> p_seat;
  if (v_target->>'kind') <> 'empty' then raise exception 'seat taken'; end if;
  -- ★一魂一桌: 该灵魂已在【别的】活桌(lobby/playing)以 soul/clone 在座 → 拒。防同一灵魂被多桌同时召唤。
  select count(*) into v_busy
    from public.eh_game_tables t, jsonb_array_elements(coalesce(t.seats,'[]'::jsonb)) s
    where t.id <> p_table and t.status in ('lobby','playing')
      and (s->>'uid') = p_soul::text and (s->>'kind') in ('soul','clone');
  if v_busy > 0 then raise exception 'soul busy'; end if;
  -- 德州(nlhe)真牌桌【至少留 2 空位】给真人
  if lower(coalesce(v_row.game,'')) in ('nlhe','holdem','texas')
     and (select count(*) from jsonb_array_elements(v_row.seats) s where (s->>'kind')='empty') <= 2 then
    raise exception 'nlhe keep seats open';
  end if;
  -- 座位名取房内原名
  select m.name, m.emoji into v_name, v_emoji
    from public.eh_members m where m.room_id=v_row.room_id and m.user_id=p_soul;
  if v_name is null then
    select s.name, s.emoji into v_name, v_emoji
      from public.eh_souls s where s.auth_uid=p_soul and s.room_id=v_row.room_id limit 1;
  end if;
  if v_name is null then
    select name, emoji into v_name, v_emoji from public.eh_users where id=p_soul;
  end if;
  if v_name is null then raise exception 'soul not found'; end if;
  update public.eh_game_tables
    set seats = jsonb_set(seats, array[p_seat::text],
          jsonb_build_object('seat',p_seat,'kind','soul','uid',p_soul,'name',v_name,'emoji',v_emoji)),
        updated_at=now()
    where id=p_table returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.eh_gt_seat_soul(uuid,int,uuid) to public;

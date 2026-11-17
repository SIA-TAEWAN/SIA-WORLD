-- 025: 텍사스 홀덤 방 (시아카지노)
-- 방 종류에 holdem 추가 (자리 4개, AI 3명으로 시작 — 세븐포커와 같다. _seat_count는 matgo 말고 모두 4)
alter table public.game_rooms drop constraint if exists game_rooms_game_check;
alter table public.game_rooms add constraint game_rooms_game_check check (game in ('matgo', 'poker', 'blackjack', 'holdem'));

-- 방 만들기: 게임 목록만 바뀜 (나머지는 020과 같다)
create or replace function public.create_room(p_game text, p_name text, p_password text, p_base_unit int, p_avatar text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); nick text; rid uuid; i int; av text;
begin
  if uid is null then raise exception 'need login'; end if;
  perform pg_advisory_xact_lock(hashtext('sia-user:' || uid::text));
  select nickname into nick from public.profiles where id = uid;
  if nick is null then raise exception 'need login'; end if;
  if p_game not in ('matgo', 'poker', 'blackjack', 'holdem') then raise exception 'bad game'; end if;
  if p_base_unit not in (100, 500, 1000) then raise exception 'bad unit'; end if;
  if not (p_avatar = any(public._zodiac())) then raise exception 'bad avatar'; end if;
  if char_length(coalesce(p_password, '')) > 20 then raise exception 'bad password'; end if;
  p_name := trim(coalesce(p_name, ''));
  if p_name = '' then p_name := nick || '의 방'; end if;
  p_name := left(p_name, 20);
  perform public._ensure_wallet(uid);
  if coalesce(public._balance(uid, p_game), 0) < p_base_unit * 50 then raise exception 'not enough money'; end if;
  perform public._leave_all(uid);

  insert into public.game_rooms (game, name, has_password, base_unit, host_id)
  values (p_game, p_name, coalesce(p_password, '') <> '', p_base_unit, uid) returning id into rid;
  if coalesce(p_password, '') <> '' then
    insert into public.room_secrets (room_id, password_hash) values (rid, crypt(p_password, gen_salt('bf', 8)));
  end if;
  insert into public.room_seats (room_id, seat_no, user_id, nickname, avatar, ready)
  values (rid, 0, uid, nick, p_avatar, false);
  for i in 1 .. public._seat_count(p_game) - 1 loop
    av := public._free_animal(rid);
    insert into public.room_seats (room_id, seat_no, user_id, nickname, avatar, ready)
    values (rid, i, null, 'AI ' || public._zodiac_name(av), av, true);
  end loop;
  insert into public.game_states (room_id) values (rid);
  insert into public.game_decks (room_id) values (rid);
  return rid;
end $$;

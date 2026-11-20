-- 065: 시아탱크 방 함수 본인 확인 (036 에서 빠진 세 함수)
--   create_room · join_room · update_player 는 화면이 넘긴 플레이어(p_player->>'id')가 로그인한 본인인지 보지 않아서
--   로그인 없이도, 남의 id로도 방을 만들고 들어가고 남의 탱크·레디를 바꿀 수 있었다.
--   036 과 같은 방식: 예전 함수의 이름을 _..._unchecked 로 바꾸고, 같은 이름의 '본인 확인 후 넘기는' 함수를 새로 만든다.
--   sweep_rooms(text) 도 로그인한 사람만 (화면은 로그인한 뒤에만 부른다. ?local=1 테스트 모드는 서버를 부르지 않는다)
-- 주의: 나중에 이 함수들의 동작을 바꿀 때는 _..._unchecked 쪽을 고친다 (겉 함수를 create or replace 하면 본인 확인이 사라진다).

alter function public.create_room(text, text, jsonb) rename to _create_room_unchecked;
alter function public.join_room(uuid, jsonb) rename to _join_room_unchecked;
alter function public.update_player(uuid, jsonb) rename to _update_player_unchecked;
revoke all on function public._create_room_unchecked(text, text, jsonb) from public, anon, authenticated;
revoke all on function public._join_room_unchecked(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._update_player_unchecked(uuid, jsonb) from public, anon, authenticated;

create function public.create_room(p_lobby text, p_name text, p_player jsonb) returns public.rooms
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player->>'id');
  return public._create_room_unchecked(p_lobby, p_name, p_player);
end $$;

create function public.join_room(p_id uuid, p_player jsonb) returns public.rooms
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player->>'id');
  return public._join_room_unchecked(p_id, p_player);
end $$;

create function public.update_player(p_id uuid, p_player jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._tank_me(p_player->>'id');
  perform public._update_player_unchecked(p_id, p_player);
end $$;

revoke all on function public.create_room(text, text, jsonb), public.join_room(uuid, jsonb), public.update_player(uuid, jsonb),
  public.sweep_rooms(text) from public, anon;
grant execute on function public.create_room(text, text, jsonb), public.join_room(uuid, jsonb), public.update_player(uuid, jsonb),
  public.sweep_rooms(text) to authenticated;

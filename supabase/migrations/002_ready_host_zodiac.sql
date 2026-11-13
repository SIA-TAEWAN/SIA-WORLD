-- 시아탱크 002: 12지신 탱크, 방장(맵·시작 권한), 레디
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run. (001을 이미 실행한 상태에서)

-- 예전 탱크(bolt 등)로 남아 있는 대기 방은 정리
delete from public.rooms where status = 'waiting' and exists (
  select 1 from jsonb_array_elements(players) e where e->>'tank' in ('bolt', 'driller', 'sparrow', 'bubble')
);

-- ---------- 검증 도우미 ----------

create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
begin
  if char_length(coalesce(p->>'id', '')) not between 4 and 64 then raise exception 'bad id'; end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 10 then raise exception 'bad name'; end if;
  if coalesce(p->>'tank', '') not in ('rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig') then
    raise exception 'bad tank';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 3 then raise exception 'bad items'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i where i not in ('double', 'power', 'repair', 'teleport')) then
    raise exception 'bad item';
  end if;
  return jsonb_build_object(
    'id', p->>'id', 'name', p->>'name', 'tank', p->>'tank',
    'team', case when (p->>'team') = '1' then 1 else 0 end,
    'items', items,
    'ready', coalesce((p->>'ready')::boolean, false));
end $$;

-- 방장: host_id가 방에 있으면 그 사람, 아니면 첫 번째 사람
create or replace function public._host_of(r public.rooms) returns text
language sql immutable as $$
  select case
    when r.host_id is not null and exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' = r.host_id) then r.host_id
    else r.players->0->>'id'
  end;
$$;

-- ---------- 게임방 함수 ----------

create or replace function public.create_room(p_lobby text, p_name text, p_player jsonb)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms; p jsonb := public._valid_player(p_player) || '{"team":0,"ready":false}'::jsonb;
begin
  delete from public.rooms where updated_at < now() - interval '3 hours';
  if (select count(*) from public.rooms where lobby = p_lobby) >= 20 then raise exception 'too many rooms'; end if;
  insert into public.rooms (lobby, name, players, host_id)
  values (p_lobby, left(p_name, 24), jsonb_build_array(p), p->>'id')
  returning * into r;
  return r;
end $$;

create or replace function public.join_room(p_id uuid, p_player jsonb)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  p jsonb := public._valid_player(p_player);
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then raise exception 'room not found'; end if;
  if exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' = p->>'id') then return r; end if;
  if r.status <> 'waiting' then raise exception 'room is playing'; end if;
  if jsonb_array_length(r.players) >= 4 then raise exception 'room is full'; end if;
  p := p || jsonb_build_object('team', public._balanced_team(r.players), 'ready', false);
  update public.rooms set players = r.players || jsonb_build_array(p), host_id = public._host_of(r), updated_at = now()
  where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.leave_room(p_id uuid, p_player_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; h text;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then return; end if;
  if r.status = 'playing' then return; end if;
  h := public._host_of(r);
  select coalesce(jsonb_agg(e), '[]'::jsonb) into rest from jsonb_array_elements(r.players) e where e->>'id' <> p_player_id;
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    -- 방장이 나가면 다음 사람이 방장
    update public.rooms set players = rest, host_id = case when h = p_player_id then rest->0->>'id' else h end, updated_at = now()
    where id = p_id;
  end if;
end $$;

create or replace function public.update_player(p_id uuid, p_player jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; p jsonb := public._valid_player(p_player);
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  -- 방장은 레디가 필요 없다
  if p->>'id' = public._host_of(r) then p := p || '{"ready":false}'::jsonb; end if;
  update public.rooms set
    players = (select jsonb_agg(case when e->>'id' = p->>'id' then p else e end) from jsonb_array_elements(r.players) e),
    updated_at = now()
  where id = p_id;
end $$;

drop function if exists public.set_room_map(uuid, text);
create or replace function public.set_room_map(p_id uuid, p_player text, p_map text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  if public._host_of(r) <> p_player then raise exception 'not host'; end if;
  if p_map not in ('random', 'valley', 'sky', 'sphinx') then raise exception 'bad map'; end if;
  update public.rooms set map = p_map, updated_at = now() where id = p_id;
end $$;

create or replace function public.start_game(p_id uuid, p_host text, p_seed bigint)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int; a int; h text;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then raise exception 'room not found'; end if;
  if r.status <> 'waiting' then raise exception 'already playing'; end if;
  h := public._host_of(r);
  if h <> p_host then raise exception 'not host'; end if;
  n := jsonb_array_length(r.players);
  select count(*) into a from jsonb_array_elements(r.players) e where (e->>'team')::int = 0;
  if n < 2 then raise exception 'need 2 players'; end if;
  if a = 0 or a = n then raise exception 'teams'; end if;
  if exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' <> h and coalesce((e->>'ready')::boolean, false) = false) then
    raise exception 'not ready';
  end if;
  update public.rooms set status = 'playing', seed = p_seed, host_id = h, game_no = game_no + 1, updated_at = now()
  where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[])
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  -- 남아 있는 사람만, 아이템·레디는 초기화
  select coalesce(jsonb_agg(e || '{"items":[],"ready":false}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) e where e->>'id' = any(p_present);
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest,
      host_id = case when exists (select 1 from jsonb_array_elements(rest) e where e->>'id' = r.host_id) then r.host_id else rest->0->>'id' end,
      updated_at = now()
    where id = p_id;
  end if;
end $$;

revoke all on function public._valid_player(jsonb) from public, anon, authenticated;
revoke all on function public._host_of(public.rooms) from public, anon, authenticated;
grant execute on function public.create_room(text, text, jsonb) to anon, authenticated;
grant execute on function public.join_room(uuid, jsonb) to anon, authenticated;
grant execute on function public.leave_room(uuid, text) to anon, authenticated;
grant execute on function public.update_player(uuid, jsonb) to anon, authenticated;
grant execute on function public.set_room_map(uuid, text, text) to anon, authenticated;
grant execute on function public.start_game(uuid, text, bigint) to anon, authenticated;
grant execute on function public.end_game(uuid, int, text[]) to anon, authenticated;

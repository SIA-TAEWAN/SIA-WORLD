-- 시아탱크 게임방 테이블
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run.
-- 클라이언트(anon)는 읽기만 하고, 쓰기는 아래 함수로만 한다.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  lobby text not null check (char_length(lobby) between 1 and 32),
  name text not null check (char_length(name) between 1 and 24),
  map text not null default 'random' check (map in ('random', 'valley', 'sky', 'sphinx')),
  status text not null default 'waiting' check (status in ('waiting', 'playing')),
  -- [{id, name, tank, team, items}]
  players jsonb not null default '[]'::jsonb,
  seed bigint,
  host_id text,
  game_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rooms_lobby_idx on public.rooms (lobby);

alter table public.rooms enable row level security;
drop policy if exists "rooms are readable" on public.rooms;
create policy "rooms are readable" on public.rooms for select using (true);
-- insert/update/delete 정책은 두지 않는다 → 직접 쓰기 불가, 함수로만 변경

alter table public.rooms replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;

-- ---------- 검증 도우미 ----------

create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
begin
  if char_length(coalesce(p->>'id', '')) not between 4 and 64 then raise exception 'bad id'; end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 10 then raise exception 'bad name'; end if;
  if coalesce(p->>'tank', '') not in ('bolt', 'driller', 'sparrow', 'bubble') then raise exception 'bad tank'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 3 then raise exception 'bad items'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i where i not in ('double', 'power', 'repair', 'teleport')) then
    raise exception 'bad item';
  end if;
  return jsonb_build_object(
    'id', p->>'id', 'name', p->>'name', 'tank', p->>'tank',
    'team', case when (p->>'team') = '1' then 1 else 0 end,
    'items', items);
end $$;

create or replace function public._balanced_team(players jsonb) returns int
language sql immutable as $$
  select case when
    (select count(*) from jsonb_array_elements(players) e where (e->>'team')::int = 0) <=
    (select count(*) from jsonb_array_elements(players) e where (e->>'team')::int = 1)
  then 0 else 1 end;
$$;

-- ---------- 게임방 함수 ----------

create or replace function public.create_room(p_lobby text, p_name text, p_player jsonb)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  -- 오래 방치된 방 정리
  delete from public.rooms where updated_at < now() - interval '3 hours';
  if (select count(*) from public.rooms where lobby = p_lobby) >= 20 then raise exception 'too many rooms'; end if;
  insert into public.rooms (lobby, name, players)
  values (p_lobby, left(p_name, 24), jsonb_build_array(public._valid_player(p_player) || '{"team":0}'::jsonb))
  returning * into r;
  return r;
end $$;

create or replace function public.join_room(p_id uuid, p_player jsonb)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  p jsonb := public._valid_player(p_player);
  others jsonb;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then raise exception 'room not found'; end if;
  -- 이미 있으면 그대로 (재접속)
  if exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' = p->>'id') then return r; end if;
  if r.status <> 'waiting' then raise exception 'room is playing'; end if;
  if jsonb_array_length(r.players) >= 4 then raise exception 'room is full'; end if;
  others := r.players;
  p := p || jsonb_build_object('team', public._balanced_team(others));
  update public.rooms set players = others || jsonb_build_array(p), updated_at = now() where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.leave_room(p_id uuid, p_player_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then return; end if;
  if r.status = 'playing' then return; end if; -- 게임 중 이탈은 접속 끊김으로 처리
  select coalesce(jsonb_agg(e), '[]'::jsonb) into rest from jsonb_array_elements(r.players) e where e->>'id' <> p_player_id;
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set players = rest, updated_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.update_player(p_id uuid, p_player jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; p jsonb := public._valid_player(p_player);
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  update public.rooms set
    players = (select jsonb_agg(case when e->>'id' = p->>'id' then p else e end) from jsonb_array_elements(r.players) e),
    updated_at = now()
  where id = p_id;
end $$;

create or replace function public.set_room_map(p_id uuid, p_map text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set map = p_map, updated_at = now() where id = p_id and status = 'waiting';
end $$;

create or replace function public.start_game(p_id uuid, p_host text, p_seed bigint)
returns public.rooms language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int; a int;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then raise exception 'room not found'; end if;
  if r.status <> 'waiting' then raise exception 'already playing'; end if;
  n := jsonb_array_length(r.players);
  select count(*) into a from jsonb_array_elements(r.players) e where (e->>'team')::int = 0;
  if n < 2 then raise exception 'need 2 players'; end if;
  if a = 0 or a = n then raise exception 'teams'; end if;
  if not exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' = p_host) then raise exception 'not in room'; end if;
  update public.rooms set status = 'playing', seed = p_seed, host_id = p_host, game_no = game_no + 1, updated_at = now()
  where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[])
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  -- 남아 있는 사람만, 아이템은 초기화 (포인트는 매 판 새로 지급)
  select coalesce(jsonb_agg(e || '{"items":[]}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) e where e->>'id' = any(p_present);
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest, updated_at = now() where id = p_id;
  end if;
end $$;

revoke all on function public._valid_player(jsonb) from public, anon, authenticated;
revoke all on function public._balanced_team(jsonb) from public, anon, authenticated;
grant execute on function public.create_room(text, text, jsonb) to anon, authenticated;
grant execute on function public.join_room(uuid, jsonb) to anon, authenticated;
grant execute on function public.leave_room(uuid, text) to anon, authenticated;
grant execute on function public.update_player(uuid, jsonb) to anon, authenticated;
grant execute on function public.set_room_map(uuid, text) to anon, authenticated;
grant execute on function public.start_game(uuid, text, bigint) to anon, authenticated;
grant execute on function public.end_game(uuid, int, text[]) to anon, authenticated;

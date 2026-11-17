-- 시아탱크 003: 모두 나간 방 정리
-- 1) 게임 중 [나가기]를 누르면 gone 에 기록하고, 모두 나갔으면 방을 지운다
-- 2) 방에 남은 사람이 30초마다 신호(touch)를 보내고, 2분 넘게 신호가 없는 방은 지운다 (브라우저를 그냥 닫은 경우)

alter table public.rooms add column if not exists gone text[] not null default '{}';

create or replace function public.quit_game(p_id uuid, p_player text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; g text[];
begin
  select * into r from public.rooms where id = p_id for update;
  if not found then return; end if;
  if not exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' = p_player) then return; end if;
  if r.status <> 'playing' then
    perform public.leave_room(p_id, p_player);
    return;
  end if;
  g := array(select distinct unnest(r.gone || p_player));
  if not exists (select 1 from jsonb_array_elements(r.players) e where not (e->>'id' = any(g))) then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set gone = g, updated_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.touch_room(p_id uuid, p_player text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.rooms set updated_at = now()
  where id = p_id and exists (select 1 from jsonb_array_elements(players) e where e->>'id' = p_player);
end $$;

create or replace function public.sweep_rooms(p_lobby text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.rooms where lobby = p_lobby and updated_at < now() - interval '2 minutes';
end $$;

-- 새 판을 시작하거나 판이 끝나면 gone 초기화
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
  update public.rooms set status = 'playing', seed = p_seed, host_id = h, game_no = game_no + 1, gone = '{}', updated_at = now()
  where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[])
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  -- 남아 있는 사람만 (중간에 나간 사람 제외), 아이템·레디는 초기화
  select coalesce(jsonb_agg(e || '{"items":[],"ready":false}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) e where e->>'id' = any(p_present) and not (e->>'id' = any(r.gone));
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest, gone = '{}',
      host_id = case when exists (select 1 from jsonb_array_elements(rest) e where e->>'id' = r.host_id) then r.host_id else rest->0->>'id' end,
      updated_at = now()
    where id = p_id;
  end if;
end $$;

grant execute on function public.quit_game(uuid, text) to anon, authenticated;
grant execute on function public.touch_room(uuid, text) to anon, authenticated;
grant execute on function public.sweep_rooms(text) to anon, authenticated;

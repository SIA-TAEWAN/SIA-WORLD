-- 시아탱크 013: '백발백중' 맵(target) + 백발백중 전용 랭킹 (최고 점수)

alter table public.rooms drop constraint if exists rooms_map_check;
alter table public.rooms add constraint rooms_map_check check (map in ('random', 'valley', 'sky', 'sphinx', 'ledge', 'target'));

create or replace function public.set_room_map(p_id uuid, p_player text, p_map text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  if public._host_of(r) <> p_player then raise exception 'not host'; end if;
  if p_map not in ('random', 'valley', 'sky', 'sphinx', 'ledge', 'target') then raise exception 'bad map'; end if;
  update public.rooms set map = p_map, updated_at = now() where id = p_id;
end $$;

-- 백발백중은 개인전이라 팀 나눔을 확인하지 않는다
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
  if r.map <> 'target' and (a = 0 or a = n) then raise exception 'teams'; end if;
  if exists (select 1 from jsonb_array_elements(r.players) e where e->>'id' <> h and coalesce((e->>'ready')::boolean, false) = false) then
    raise exception 'not ready';
  end if;
  update public.rooms set status = 'playing', seed = p_seed, host_id = h, game_no = game_no + 1, gone = '{}', updated_at = now()
  where id = p_id returning * into r;
  return r;
end $$;

-- 백발백중 판은 포인트를 주고받지 않는다
create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[], p_winner int default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; e jsonb; won boolean;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  if p_winner in (0, 1) and r.map <> 'target' then
    for e in select * from jsonb_array_elements(r.players) loop
      won := (e->>'team')::int = p_winner;
      insert into public.player_points as pp (name, points, wins, losses)
      values (e->>'name', case when won then 1100 else 1000 end, case when won then 1 else 0 end, case when won then 0 else 1 end)
      on conflict (name) do update set
        points = greatest(1000, pp.points + case when won then 100 else -100 end),
        wins = pp.wins + case when won then 1 else 0 end,
        losses = pp.losses + case when won then 0 else 1 end,
        updated_at = now();
    end loop;
  end if;
  select coalesce(jsonb_agg(x || '{"items":[],"ready":false}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) x where x->>'id' = any(p_present) and not (x->>'id' = any(r.gone));
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest, gone = '{}',
      host_id = case when exists (select 1 from jsonb_array_elements(rest) x where x->>'id' = r.host_id) then r.host_id else rest->0->>'id' end,
      updated_at = now()
    where id = p_id;
  end if;
end $$;

-- 백발백중 최고 점수 (누구나 읽을 수 있고, 기록은 로그인한 본인만 함수로)
create table if not exists public.target_scores (
  name text primary key,
  best int not null default 0 check (best between 0 and 1000),
  plays int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.target_scores enable row level security;
drop policy if exists "target scores are readable" on public.target_scores;
create policy "target scores are readable" on public.target_scores for select using (true);
revoke insert, update, delete on public.target_scores from anon, authenticated;

create or replace function public.submit_target_score(p_name text, p_token uuid, p_score int)
returns int language plpgsql security definer set search_path = public as $$
declare b int;
begin
  if not exists (select 1 from public.accounts where name = p_name and token = p_token) then raise exception 'need login'; end if;
  if p_score is null or p_score < 0 or p_score > 1000 or p_score % 200 <> 0 then raise exception 'bad score'; end if;
  insert into public.target_scores as ts (name, best, plays) values (p_name, p_score, 1)
  on conflict (name) do update set best = greatest(ts.best, excluded.best), plays = ts.plays + 1, updated_at = now()
  returning best into b;
  return b;
end $$;

grant execute on function public.submit_target_score(text, uuid, int) to anon, authenticated;

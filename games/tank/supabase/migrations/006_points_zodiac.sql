-- 시아탱크 006: ID별 포인트 (기본·최저 1000, 이기면 +100, 지면 -100), 십이지신 탱크 허용

create table if not exists public.player_points (
  name text primary key check (char_length(name) between 2 and 10),
  points int not null default 1000 check (points >= 1000),
  wins int not null default 0,
  losses int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.player_points enable row level security;
drop policy if exists "points are readable" on public.player_points;
create policy "points are readable" on public.player_points for select using (true);

create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
begin
  if char_length(coalesce(p->>'id', '')) not between 4 and 64 then raise exception 'bad id'; end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 10 then raise exception 'bad name'; end if;
  if coalesce(p->>'tank', '') not in ('rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'zodiac') then
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

-- 판 정산: 첫 호출(진행 중 → 대기)일 때만 포인트를 반영한다
drop function if exists public.end_game(uuid, int, text[]);
create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[], p_winner int default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; e jsonb; won boolean;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  if p_winner in (0, 1) then
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

grant execute on function public.end_game(uuid, int, text[], int) to anon, authenticated;

-- 057: 게임 접속 이력 (로비가 '내가 많이 들어간 게임'부터 보여 주는 데 쓴다)
--   게임 페이지가 시작할 때(shared/auth.js requireLogin) log_game_visit 을 부른다.
--   같은 사람·같은 게임은 10분에 한 번만 횟수가 는다 (새로고침·게임 안의 화면 이동으로 부풀지 않게).
--   직접 쓰기는 없다: 기록은 함수로만, 읽기는 자기 것만.

create table if not exists public.game_visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  visits int not null default 1,
  last_at timestamptz not null default now(),     -- 마지막으로 들어간 때 (부를 때마다 갱신)
  counted_at timestamptz not null default now(),  -- 마지막으로 횟수를 올린 때 (10분 제한의 기준)
  primary key (user_id, game)
);
alter table public.game_visits enable row level security;
drop policy if exists game_visits_read_own on public.game_visits;
create policy game_visits_read_own on public.game_visits for select using (auth.uid() = user_id);
revoke all on public.game_visits from anon, authenticated;
grant select on public.game_visits to authenticated;

-- 게임에 들어왔다고 적는다. p_game: shared/games.js 의 id (소문자·숫자·-_ 1~24자)
create or replace function public.log_game_visit(p_game text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then raise exception 'need login'; end if;
  if p_game is null or p_game !~ '^[a-z0-9_-]{1,24}$' then raise exception 'bad game'; end if;
  -- 한 사람이 줄을 끝없이 만들지 못하게: 처음 보는 게임 이름은 50개까지만 (그 뒤는 조용히 넘어간다)
  if not exists (select 1 from public.game_visits where user_id = v_uid and game = p_game)
     and (select count(*) from public.game_visits where user_id = v_uid) >= 50 then
    return;
  end if;
  insert into public.game_visits as g (user_id, game) values (v_uid, p_game)
  on conflict (user_id, game) do update set
    visits = g.visits + case when g.counted_at <= now() - interval '10 minutes' then 1 else 0 end,
    counted_at = case when g.counted_at <= now() - interval '10 minutes' then now() else g.counted_at end,
    last_at = now();
end $$;
revoke all on function public.log_game_visit(text) from public, anon;
grant execute on function public.log_game_visit(text) to authenticated;

-- 내 접속 이력 [{ game, visits, last_at }] (많이 들어간 순)
create or replace function public.my_game_visits() returns table (game text, visits int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.game, g.visits, g.last_at from public.game_visits g
  where g.user_id = auth.uid()
  order by g.visits desc, g.last_at desc, g.game
$$;
revoke all on function public.my_game_visits() from public, anon;
grant execute on function public.my_game_visits() to authenticated;

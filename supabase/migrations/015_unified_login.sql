-- 시아탱크 015: SIA WORLD 통합 로그인 (Supabase Auth)
--  · profiles: 공통 회원 정보 (가입하면 트리거가 자동으로 만든다)
--  · 게임방·랭킹을 기존 accounts(ID+토큰) 대신 auth.uid() 기준으로
--  · 기존 랭킹은 legacy_id로 남기고, 같은 아이디 + 예전 비밀번호로 가입하면 이어받는다
-- 기존 accounts 테이블과 sign_in 함수는 기록 이어받기 확인용으로 남겨 둔다.

-- ---------- 1. 공통 회원 정보 ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text unique not null check (login_id ~ '^[a-z0-9]{4,16}$'),
  nickname text unique not null check (nickname ~ '^[가-힣a-zA-Z0-9]{2,8}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all" on public.profiles for select using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
-- 직접 추가·삭제는 못 하고(가입 트리거만), 고칠 수 있는 건 닉네임뿐
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nickname) on public.profiles to authenticated;

-- 가입(auth.users 추가)과 같은 트랜잭션에서 profiles를 만든다.
-- 아이디는 이메일 앞부분(<아이디>@sia-world.local), 닉네임은 가입 때 보낸 metadata.
-- 닉네임 규칙 위반·중복이면 가입 자체가 실패한다.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email like '%@sia-world.local' then
    insert into public.profiles (id, login_id, nickname)
    values (new.id, split_part(new.email, '@', 1), new.raw_user_meta_data->>'nickname');
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. 랭킹 테이블: name → legacy_id, user_id 추가 ----------

alter table public.player_points drop constraint if exists player_points_pkey;
alter table public.player_points rename column name to legacy_id;
alter table public.player_points alter column legacy_id drop not null;
alter table public.player_points add column id bigint generated always as identity primary key;
alter table public.player_points add constraint player_points_legacy_id_key unique (legacy_id);
alter table public.player_points add column user_id uuid unique references public.profiles(id) on delete cascade;

alter table public.target_scores drop constraint if exists target_scores_pkey;
alter table public.target_scores rename column name to legacy_id;
alter table public.target_scores alter column legacy_id drop not null;
alter table public.target_scores add column id bigint generated always as identity primary key;
alter table public.target_scores add constraint target_scores_legacy_id_key unique (legacy_id);
alter table public.target_scores add column user_id uuid unique references public.profiles(id) on delete cascade;

-- ---------- 3. 게임방: 플레이어 = 로그인한 본인 ----------

-- 예전 방식(기기 ID)으로 들어가 있던 방은 정리한다
delete from public.rooms;

-- 플레이어 id는 auth.uid(), 이름은 profiles.nickname으로 서버가 정한다
create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
  nick text;
begin
  if auth.uid() is null or coalesce(p->>'id', '') <> auth.uid()::text then raise exception 'need login'; end if;
  select nickname into nick from public.profiles where id = auth.uid();
  if nick is null then raise exception 'need login'; end if;
  if coalesce(p->>'tank', '') not in ('rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'zodiac', 'random') then
    raise exception 'bad tank';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 3 then raise exception 'bad items'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i where i not in ('double', 'power', 'repair', 'teleport')) then
    raise exception 'bad item';
  end if;
  return jsonb_build_object(
    'id', auth.uid()::text, 'name', nick, 'tank', p->>'tank',
    'team', case when (p->>'team') = '1' then 1 else 0 end,
    'items', items,
    'ready', coalesce((p->>'ready')::boolean, false));
end $$;
revoke all on function public._valid_player(jsonb) from public, anon, authenticated;

-- 판 정산: 포인트를 user_id 기준으로 (013과 같고 저장 기준만 바뀜)
create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[], p_winner int default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; e jsonb; won boolean;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  if p_winner in (0, 1) and r.map <> 'target' then
    for e in select * from jsonb_array_elements(r.players) loop
      continue when not exists (select 1 from public.profiles pr where pr.id::text = e->>'id');
      won := (e->>'team')::int = p_winner;
      insert into public.player_points as pp (user_id, points, wins, losses)
      values ((e->>'id')::uuid, case when won then 1100 else 1000 end, case when won then 1 else 0 end, case when won then 0 else 1 end)
      on conflict (user_id) do update set
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

-- 백발백중 최고 점수: 로그인한 본인 기록만
drop function if exists public.submit_target_score(text, uuid, int);
create or replace function public.submit_target_score(p_score int)
returns int language plpgsql security definer set search_path = public as $$
declare b int;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_score is null or p_score < 0 or p_score > 2500 or p_score % 50 <> 0 then raise exception 'bad score'; end if;
  insert into public.target_scores as ts (user_id, best, plays) values (auth.uid(), p_score, 1)
  on conflict (user_id) do update set best = greatest(ts.best, excluded.best), plays = ts.plays + 1, updated_at = now()
  returning best into b;
  return b;
end $$;
revoke all on function public.submit_target_score(int) from public, anon;
grant execute on function public.submit_target_score(int) to authenticated;

-- ---------- 4. 기존 랭킹 이어받기 ----------

-- 가입 전에: 이 아이디로 이어받을 기록이 있는지, 예전 비밀번호가 맞는지
--   'none'  이어받을 기록 없음
--   'ok'    예전 비밀번호가 맞음
--   'wrong' 기록은 있는데 비밀번호가 틀림 (빈 비밀번호면 '기록 있음' 확인용)
-- 예전 ID는 대소문자를 구분했으므로 소문자로 비교한다.
create or replace function public.check_legacy(p_login text, p_pw text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts; any_found boolean := false;
begin
  for a in
    select * from public.accounts ac where lower(ac.name) = lower(trim(coalesce(p_login, '')))
      and (exists (select 1 from public.player_points pp where pp.legacy_id = ac.name and pp.user_id is null)
        or exists (select 1 from public.target_scores ts where ts.legacy_id = ac.name and ts.user_id is null))
  loop
    any_found := true;
    if coalesce(p_pw, '') <> '' and a.pw_hash = crypt(p_pw, a.pw_hash) then return 'ok'; end if;
  end loop;
  if not any_found then return 'none'; end if;
  if coalesce(p_pw, '') <> '' then perform pg_sleep(0.3); end if; -- 무작정 대입하기 어렵게
  return 'wrong';
end $$;
revoke all on function public.check_legacy(text, text) from public;
grant execute on function public.check_legacy(text, text) to anon, authenticated;

-- 가입 직후: 내 아이디와 같은(대소문자 무시) 예전 ID의 기록을 가져온다.
-- 예전 비밀번호가 맞아야 하고, 이미 누가 가져간 기록(user_id 있음)은 가져올 수 없다.
-- 돌려주는 값: 이어받은 기록 수
create or replace function public.claim_legacy_records(p_old_pw text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare my_login text; a public.accounts; n int := 0; c int; matched boolean := false;
begin
  select login_id into my_login from public.profiles where id = auth.uid();
  if my_login is null then return 0; end if;
  for a in select * from public.accounts ac where lower(ac.name) = my_login loop
    continue when coalesce(p_old_pw, '') = '' or a.pw_hash <> crypt(p_old_pw, a.pw_hash);
    matched := true;
    update public.player_points set user_id = auth.uid()
     where legacy_id = a.name and user_id is null
       and not exists (select 1 from public.player_points x where x.user_id = auth.uid());
    get diagnostics c = row_count; n := n + c;
    update public.target_scores set user_id = auth.uid()
     where legacy_id = a.name and user_id is null
       and not exists (select 1 from public.target_scores x where x.user_id = auth.uid());
    get diagnostics c = row_count; n := n + c;
  end loop;
  if not matched then perform pg_sleep(0.3); end if;
  return n;
end $$;
revoke all on function public.claim_legacy_records(text) from public, anon;
grant execute on function public.claim_legacy_records(text) to authenticated;

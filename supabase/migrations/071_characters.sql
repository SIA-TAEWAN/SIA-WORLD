-- 071: 추가 캐릭터 (고양이 cat, "13번째 대원") — 게임마다 따로 시아코인으로 연다 (한 게임에서 열어도 다른 게임은 따로)
--   · _character_ids(): 카드 게임 밖에서 고를 수 있는 캐릭터 = 십이지 12 + cat (shared/characters.js 의 ALL_CHARACTER_IDS 와 같게)
--   · _character_price(id): 시아코인으로 여는 캐릭터의 값. 십이지는 null (처음부터 있다). 값을 바꿀 때는 여기와
--     shared/characters.js 의 CHARACTER_PRICE 를 같이 바꾼다 (games/survival/tests/sql.test.ts 가 대조한다)
--   · _character_games(): 추가 캐릭터를 고를 수 있는 게임 (shared/characters.js 의 CHARACTER_GAMES 와 같게)
--   · owned_characters: 연 캐릭터 기록 (사람 · 게임 · 캐릭터)
--   · buy_character(game, id): 각 게임 선택 화면에서 부른다. 잔액 확인 후 차감 (_spend_sia_coin, 050) + 기록. 이미 있으면 다시 빼지 않는다
--   · my_characters(game): 그 게임에서 내가 연 캐릭터 id 목록
--   · _check_character(user, character, game): 게임 시작·캐릭터 목록 검사에서 부른다 (072~).
--       모르는 id → 'bad character', 값이 있는 캐릭터를 그 게임에서 안 열었으면 → 'locked character'
--   · 구매 조건: 게임마다 진행 조건을 넘어야 살 수 있다. 각 게임 마이그레이션이
--       public._cat_progress_<game>(p_user uuid) returns jsonb  {"have": n, "need": n}
--     를 정의한다 (조건 값은 그 함수 안의 상수 = 게임 클라이언트의 상수, 각 게임 tests 가 대조).
--     _character_progress(user, game) 가 그 함수를 찾아 부른다 (없으면 아직 열 수 없음 {have 0, need 1}).
--     판 수 기록이 없는 게임은 character_play_counts 에 판이 끝날 때 _count_play(user, game) 으로 센다 (이 기능을 넣은 뒤부터).
--   · character_progress(game): 화면용 {have, need, owned} — 잠긴 동안 "… 30판을 하면 열 수 있어요 · 지금 12판" 을 보여 준다

-- ---------- 1. 목록 · 값 ----------

create or replace function public._character_ids() returns text[]
language sql immutable as $$
  select array['rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig','cat']::text[]
$$;
revoke all on function public._character_ids() from public, anon, authenticated;

create or replace function public._character_price(p_id text) returns int
language sql immutable as $$
  select case p_id
    when 'cat' then 100
    else null
  end
$$;
revoke all on function public._character_price(text) from public, anon, authenticated;

create or replace function public._character_games() returns text[]
language sql immutable as $$
  select array['tank','race','volleyball','survival','defense','charge','finger','village','twelve']::text[]
$$;
revoke all on function public._character_games() from public, anon, authenticated;

-- ---------- 2. 연 캐릭터 기록 ----------

create table if not exists public.owned_characters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  character_id text not null,
  price int not null check (price >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, game, character_id)
);
alter table public.owned_characters enable row level security;
drop policy if exists owned_characters_read_own on public.owned_characters;
create policy owned_characters_read_own on public.owned_characters for select using (auth.uid() = user_id);
revoke all on public.owned_characters from anon, authenticated;
grant select on public.owned_characters to authenticated;

-- 판 수 (기록이 없는 게임용: 탱크 · 레이스 · 배구). 판이 끝날 때 서버 함수 안에서 _count_play 로 하나씩 센다
create table if not exists public.character_play_counts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  n int not null default 0 check (n >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.character_play_counts enable row level security;
drop policy if exists character_play_counts_read_own on public.character_play_counts;
create policy character_play_counts_read_own on public.character_play_counts for select using (auth.uid() = user_id);
revoke all on public.character_play_counts from anon, authenticated;
grant select on public.character_play_counts to authenticated;

create or replace function public._count_play(p_user uuid, p_game text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_game is null or not exists (select 1 from public.profiles where id = p_user) then return; end if;
  insert into public.character_play_counts (user_id, game, n) values (p_user, p_game, 1)
  on conflict (user_id, game) do update set n = public.character_play_counts.n + 1, updated_at = now();
end $$;
revoke all on function public._count_play(uuid, text) from public, anon, authenticated;

create or replace function public._play_count(p_user uuid, p_game text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select n from public.character_play_counts where user_id = p_user and game = p_game), 0)
$$;
revoke all on function public._play_count(uuid, text) from public, anon, authenticated;

-- 구매 조건 진행: 게임별 _cat_progress_<game>(uuid) → {have, need}. 아직 없으면 열 수 없음
create or replace function public._character_progress(p_user uuid, p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_game is null or not (p_game = any(public._character_games())) then raise exception 'bad game'; end if;
  if to_regprocedure(format('public._cat_progress_%s(uuid)', p_game)) is null then
    return jsonb_build_object('have', 0, 'need', 1);
  end if;
  execute format('select public.%I($1)', '_cat_progress_' || p_game) into r using p_user;
  return jsonb_build_object('have', coalesce((r->>'have')::int, 0), 'need', coalesce((r->>'need')::int, 1));
end $$;
revoke all on function public._character_progress(uuid, text) from public, anon, authenticated;

-- ---------- 3. 검사 (안에서만) ----------

create or replace function public._check_character(p_user uuid, p_character text, p_game text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_character is null or not (p_character = any(public._character_ids())) then raise exception 'bad character'; end if;
  if public._character_price(p_character) is not null
     and not exists (select 1 from public.owned_characters where user_id = p_user and game = p_game and character_id = p_character) then
    raise exception 'locked character';
  end if;
end $$;
revoke all on function public._check_character(uuid, text, text) from public, anon, authenticated;

-- ---------- 4. 사기 · 내 목록 ----------

-- → { ok: true, siaCoins } | { ok: false, reason: 'owned' | 'coin' | 'condition', siaCoins, price, have?, need? }
create or replace function public.buy_character(p_game text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  price int := public._character_price(p_id);
  bal bigint;
  prog jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_game is null or not (p_game = any(public._character_games())) then raise exception 'bad game'; end if;
  if price is null then raise exception 'bad character'; end if;
  perform public._ensure_wallet(me);
  if exists (select 1 from public.owned_characters where user_id = me and game = p_game and character_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'owned', 'siaCoins', (select sia_coins from public.wallets where user_id = me), 'price', price);
  end if;
  -- 이 게임의 진행 조건 (판 수 · 클리어 · 땅 확장 …)
  prog := public._character_progress(me, p_game);
  if (prog->>'have')::int < (prog->>'need')::int then
    return jsonb_build_object('ok', false, 'reason', 'condition', 'have', (prog->>'have')::int, 'need', (prog->>'need')::int,
      'siaCoins', (select sia_coins from public.wallets where user_id = me), 'price', price);
  end if;
  -- 지갑 줄을 먼저 잠가서 같은 사람이 동시에 두 번 눌러도 한 번만 빠진다
  select sia_coins into bal from public.wallets where user_id = me for update;
  if exists (select 1 from public.owned_characters where user_id = me and game = p_game and character_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'owned', 'siaCoins', bal, 'price', price);
  end if;
  if bal < price then
    return jsonb_build_object('ok', false, 'reason', 'coin', 'siaCoins', bal, 'price', price);
  end if;
  perform public._spend_sia_coin(me, price, 'character', p_game || ':' || p_id);
  insert into public.owned_characters (user_id, game, character_id, price) values (me, p_game, p_id, price);
  return jsonb_build_object('ok', true, 'siaCoins', bal - price, 'price', price);
end $$;
revoke all on function public.buy_character(text, text) from public, anon;
grant execute on function public.buy_character(text, text) to authenticated;

create or replace function public.my_characters(p_game text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(character_id order by created_at), '{}'::text[]) from public.owned_characters where user_id = auth.uid() and game = p_game
$$;
revoke all on function public.my_characters(text) from public, anon;
grant execute on function public.my_characters(text) to authenticated;

-- 화면용: 이 게임에서 연 캐릭터와 구매 조건 진행 → { owned: [..], have, need }
create or replace function public.character_progress(p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); prog jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  prog := public._character_progress(me, p_game);
  return prog || jsonb_build_object('owned',
    coalesce((select jsonb_agg(character_id order by created_at) from public.owned_characters where user_id = me and game = p_game), '[]'::jsonb));
end $$;
revoke all on function public.character_progress(text) from public, anon;
grant execute on function public.character_progress(text) to authenticated;

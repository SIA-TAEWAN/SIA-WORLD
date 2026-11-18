-- 038: 시아서바이벌 (1인 생존 게임)
--   survival_profiles : 사용자별 엽전 · 영구 강화 · 해금 · 도감 · 누적 값 (본인만 읽기, 쓰기는 함수만)
--   survival_records  : 사용자·맵별 최고 기록 (누구나 읽기 → survival_ranking 뷰)
--   survival_runs     : 판 한 번 (시작 시각과 결과. 권한 없음: 함수로만 읽고 쓴다)
-- 게임 계산은 기기에서만 돌기 때문에 서버는 보고된 값을 그대로 믿지 않는다:
--   · 판은 survival_start() 로 시작 시각을 남긴 뒤에만 survival_finish() 로 끝낼 수 있다 (주인만, 한 번만)
--   · 서버가 잰 경과 시간이 보고한 생존 시간보다 짧으면 거절 (10분을 2분 만에 끝낼 수 없다)
--   · 처치 수·레벨·엽전·떡은 생존 시간과 맵 배율로 정한 상한을 넘으면 그 판은 valid = false:
--     엽전은 상한까지만 주고, 랭킹·해금·누적 값·도감에는 넣지 않는다
--   · 엽전·강화·해금은 모두 이 파일의 함수가 정한다 (표에 직접 쓰는 권한은 아무에게도 없다)
-- 게임 쪽 값(games/survival/src/data/*.ts, src/game/progress.ts)과 같아야 하는 표는
-- games/survival/tests/sql.test.ts 가 이 파일을 읽어 비교한다 (줄 모양을 바꾸면 그 테스트도 함께 고친다).
-- 시간 단위는 모두 초.

-- ---------- 1. 표 ----------

create table if not exists public.survival_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  -- 영구 강화: { "might": 3, "hp": 1, ... } (없는 항목은 0)
  upgrades jsonb not null default '{}'::jsonb,
  unlocked_characters text[] not null default array['rat', 'ox', 'tiger'],
  unlocked_maps text[] not null default array['field'],
  -- 도감: { "enemies": [...], "bosses": [...], "weapons": [...], "passives": [...] }
  codex jsonb not null default '{"enemies":[],"bosses":[],"weapons":[],"passives":[]}'::jsonb,
  -- 해금 조건용 누적 값: { "kills", "cakes", "bestTime", "bossKills", "clears", "runs" }
  totals jsonb not null default '{"kills":0,"cakes":0,"bestTime":0,"bossKills":0,"clears":0,"runs":0}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.survival_profiles enable row level security;
drop policy if exists survival_profiles_read_own on public.survival_profiles;
create policy survival_profiles_read_own on public.survival_profiles for select using (auth.uid() = user_id);
revoke all on public.survival_profiles from anon, authenticated;
grant select on public.survival_profiles to authenticated;

create table if not exists public.survival_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  map_id text not null check (map_id in ('field', 'bamboo', 'palace', 'underworld')),
  best_time int not null check (best_time between 0 and 600),
  best_kills int not null check (best_kills >= 0),
  cleared boolean not null default false,
  character text not null,
  achieved_at timestamptz not null default now(),
  primary key (user_id, map_id)
);
alter table public.survival_records enable row level security;
drop policy if exists survival_records_read on public.survival_records;
create policy survival_records_read on public.survival_records for select using (true);
revoke all on public.survival_records from anon, authenticated;
grant select on public.survival_records to anon, authenticated;
create index if not exists survival_records_rank_idx on public.survival_records (map_id, best_time desc, cleared desc, best_kills desc, achieved_at);

create table if not exists public.survival_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  map_id text not null,
  character text not null,
  started_at timestamptz not null default now(),
  -- 끝나기 전에는 비어 있다
  time int,
  kills int,
  level int,
  coins_earned int,
  cleared boolean,
  valid boolean,
  -- 끝난 시각 (끝나지 않은 판은 null)
  created_at timestamptz
);
alter table public.survival_runs enable row level security;
-- 정책 없음 + 권한 없음: 함수(security definer)로만 읽고 쓴다
revoke all on public.survival_runs from anon, authenticated;
create index if not exists survival_runs_user_idx on public.survival_runs (user_id, started_at desc);

-- ---------- 2. 기준 값 ----------

-- 판 검증에 쓰는 값. 게임 쪽 값(games/survival/src/game/progress.ts 의 LIMITS)과 맞춘다.
create or replace function public._survival_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_time' then 600            -- 한 판은 최대 10분 (초)
    when 'time_slack' then 5            -- 서버가 잰 경과 시간이 보고한 시간보다 이만큼까지는 짧아도 된다 (시계·통신 오차)
    when 'max_age' then 604800          -- 시작 뒤 7일이 지난 판은 받지 않는다 (일시정지·나중에 다시 보내기 포함)
    when 'kills_base' then 100          -- 처치 수 상한 = kills_base + 생존 시간 × kills_per_sec
    when 'kills_per_sec' then 30
    when 'level_base' then 5            -- 레벨 상한 = level_base + 생존 시간 × level_per_sec
    when 'level_per_sec' then 0.2
    when 'coins_base' then 50           -- 엽전 상한 = (coins_base + 생존 시간 × coins_per_sec) × 맵 엽전 배율
    when 'coins_per_sec' then 3
    when 'cakes_base' then 5            -- 떡 상한 = cakes_base + 생존 시간 × cakes_per_sec
    when 'cakes_per_sec' then 0.1
    when 'boss_max' then 3              -- 한 판의 보스는 셋
    when 'boss1_time' then 180          -- 첫 보스는 3분에 나온다 (그 전에는 보스를 잡을 수 없다)
    when 'coin_min_time' then 60        -- 시아코인은 1분 넘게 버틴 판에만
    when 'codex_max' then 40            -- 한 번에 보내는 도감 id 수 (종류마다)
  end
$$;
revoke all on function public._survival_const(text) from public, anon, authenticated;

-- 맵: 엽전 배율과 순서 (앞 맵을 클리어하면 다음 맵이 열린다). games/survival/src/data/maps.ts
create or replace function public._survival_maps() returns table (map_id text, coin_mul numeric, ord int)
language sql immutable as $$
  values
    ('field', 1.0, 1),
    ('bamboo', 1.5, 2),
    ('palace', 2.0, 3),
    ('underworld', 2.5, 4)
$$;
revoke all on function public._survival_maps() from public, anon, authenticated;

-- 영구 강화: 항목, 최대 레벨, 첫 비용. 레벨 n → n+1 의 비용 = round(첫 비용 × 1.5^n / 5) × 5
-- games/survival/src/data/upgrades.ts
create or replace function public._survival_upgrades() returns table (key text, max_level int, base_cost int)
language sql immutable as $$
  values
    ('might', 10, 100),
    ('hp', 10, 100),
    ('armor', 5, 150),
    ('speed', 5, 100),
    ('xp', 5, 100),
    ('pickup', 5, 100),
    ('coin', 5, 100),
    ('revive', 1, 500),
    ('reroll', 3, 300)
$$;
revoke all on function public._survival_upgrades() from public, anon, authenticated;

create or replace function public._survival_upgrade_cost(p_base int, p_level int) returns bigint
language sql immutable as $$
  select (round(p_base * power(1.5::numeric, p_level) / 5) * 5)::bigint
$$;
revoke all on function public._survival_upgrade_cost(int, int) from public, anon, authenticated;

-- 엽전으로 푸는 캐릭터와 값. games/survival/src/data/characters.ts
create or replace function public._survival_character_prices() returns table (char_id text, price int)
language sql immutable as $$
  values
    ('monkey', 500),
    ('rooster', 1000),
    ('dog', 1500)
$$;
revoke all on function public._survival_character_prices() from public, anon, authenticated;

-- 도감에 넣을 수 있는 id. games/survival/src/data/{enemies,bosses,weapons,passives}.ts
create or replace function public._survival_codex_ids(p_kind text) returns text[]
language sql immutable as $$
  select case p_kind
    when 'enemies' then array['imp','wisp','club','water','fox','bamboo','guard','skeleton','spirit']
    when 'bosses' then array['bigDokkaebi','dueoksini','bulgasal','jangsanbeom','centipede','gumiho','guardCaptain','yagwanggwi','imugi','reaper','gangcheori','yeomra']
    when 'weapons' then array['shuriken','bell','claw','mooncake','pearl','mist','shurikenEvo','pearlEvo','clawEvo','hoof','wool','staff','feather','puppy','piggy']
    when 'passives' then array['might','wind','shell','sleeve','fan','magnet','ginseng','knot']
    else array[]::text[]
  end
$$;
revoke all on function public._survival_codex_ids(text) from public, anon, authenticated;

-- ---------- 3. 안에서만 쓰는 도구 ----------

-- 내 프로필 줄을 (없으면 만들어서) 잠근 채 돌려준다
create or replace function public._survival_profile_row(p_user uuid) returns public.survival_profiles
language plpgsql security definer set search_path = public as $$
declare r public.survival_profiles;
begin
  insert into public.survival_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.survival_profiles where user_id = p_user for update;
  return r;
end $$;
revoke all on function public._survival_profile_row(uuid) from public, anon, authenticated;

-- 화면에 보내는 프로필 모양
create or replace function public._survival_profile_json(r public.survival_profiles) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'coins', r.coins,
    'upgrades', r.upgrades,
    'unlockedCharacters', to_jsonb(r.unlocked_characters),
    'unlockedMaps', to_jsonb(r.unlocked_maps),
    'codex', r.codex,
    'totals', r.totals)
$$;
revoke all on function public._survival_profile_json(public.survival_profiles) from public, anon, authenticated;

-- 도감 한 종류: 지금 목록에 새 id(허용된 것만)를 합친다
create or replace function public._survival_codex_merge(p_old jsonb, p_new jsonb, p_kind text) returns jsonb
language sql immutable as $$
  select coalesce(to_jsonb(array(
    select a from unnest(public._survival_codex_ids(p_kind)) as a
    where a in (select jsonb_array_elements_text(case when jsonb_typeof(p_old->p_kind) = 'array' then p_old->p_kind else '[]'::jsonb end))
       or a in (select x from jsonb_array_elements_text(case when jsonb_typeof(p_new->p_kind) = 'array' then p_new->p_kind else '[]'::jsonb end)
                  with ordinality as t(x, n) where n <= public._survival_const('codex_max'))
  )), '[]'::jsonb)
$$;
revoke all on function public._survival_codex_merge(jsonb, jsonb, text) from public, anon, authenticated;

-- ---------- 4. 서버 시각 · 프로필 ----------

-- 접속 인원(실시간 채널)의 '들어온 시각'을 서버 시각으로 맞추는 용도 (epoch ms)
create or replace function public.survival_now() returns double precision
language sql volatile security definer set search_path = public as $$
  select extract(epoch from clock_timestamp()) * 1000
$$;
revoke all on function public.survival_now() from public;
grant execute on function public.survival_now() to anon, authenticated;

-- 내 프로필 (없으면 만든다: 엽전 0, 쥐·소·호랑이, 들판)
create or replace function public.survival_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  return public._survival_profile_json(public._survival_profile_row(me));
end $$;
revoke all on function public.survival_profile() from public, anon;
grant execute on function public.survival_profile() to authenticated;

-- ---------- 5. 판 시작 ----------

-- 해금된 캐릭터·맵인지 확인하고 시작 시각을 남긴다. 한 사람은 진행 중인 판 하나: 끝나지 않은 이전 판은 버린다.
-- → 판 id (uuid)
create or replace function public.survival_start(p_map text, p_character text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_map is null or not exists (select 1 from public._survival_maps() m where m.map_id = p_map) then raise exception 'bad map'; end if;
  if p_character is null or p_character not in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig') then raise exception 'bad character'; end if;
  pr := public._survival_profile_row(me);
  if not (p_map = any(pr.unlocked_maps)) then raise exception 'map locked'; end if;
  if not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;
  -- 끝나지 않은 이전 판은 버린다 (끝난 판은 기록으로 남긴다)
  delete from public.survival_runs where user_id = me and created_at is null;
  insert into public.survival_runs (user_id, map_id, character, started_at) values (me, p_map, p_character, clock_timestamp()) returning id into rid;
  return rid;
end $$;
revoke all on function public.survival_start(text, text) from public, anon;
grant execute on function public.survival_start(text, text) to authenticated;

-- ---------- 6. 판 끝 ----------

-- 판이 끝날 때 한 번 부른다 (게임 오버·포기·클리어 모두). 포기·게임 오버여도 주운 엽전은 준다.
-- p_codex: 이번 판에 만난 요괴·보스, 얻은 무기·패시브의 id 목록 { enemies, bosses, weapons, passives }
-- → { profile, result: { coins(받은 엽전), valid, newRecord, unlockedCharacters[], unlockedMaps[], siaCoin } }
create or replace function public.survival_finish(
  p_run uuid, p_time int, p_kills int, p_level int, p_coins int, p_cleared boolean, p_boss_kills int, p_cakes int, p_codex jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t timestamptz := clock_timestamp();
  rn public.survival_runs; pr public.survival_profiles; old public.survival_records;
  mul numeric; elapsed numeric; ok boolean := true; coins int; better boolean := false; got_coin boolean := false;
  tot jsonb; new_chars text[] := array[]::text[]; new_maps text[] := array[]::text[]; next_map text; c text;
  n_kills bigint; n_cakes bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.survival_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.created_at is not null then raise exception 'already finished'; end if;
  if p_time is null or p_kills is null or p_level is null or p_coins is null or p_cleared is null or p_boss_kills is null or p_cakes is null then raise exception 'bad result'; end if;
  if p_time < 0 or p_time > public._survival_const('max_time') then raise exception 'bad time'; end if;
  if p_kills < 0 or p_level < 1 or p_coins < 0 or p_boss_kills < 0 or p_cakes < 0 then raise exception 'bad result'; end if;
  -- 클리어는 10분을 채운 판에서만
  if p_cleared and p_time <> public._survival_const('max_time') then raise exception 'bad time'; end if;
  -- 서버가 잰 경과 시간: 보고한 생존 시간보다 짧을 수 없고(여유 5초), 7일이 넘은 판은 받지 않는다
  elapsed := extract(epoch from (t - rn.started_at));
  if elapsed < p_time - public._survival_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._survival_const('max_age') then raise exception 'too late'; end if;

  select m.coin_mul into mul from public._survival_maps() m where m.map_id = rn.map_id;
  mul := coalesce(mul, 1);
  -- 상한을 넘는 값이 하나라도 있으면 비정상 기록
  if p_kills > public._survival_const('kills_base') + p_time * public._survival_const('kills_per_sec') then ok := false; end if;
  if p_level > public._survival_const('level_base') + p_time * public._survival_const('level_per_sec') then ok := false; end if;
  if p_cakes > public._survival_const('cakes_base') + p_time * public._survival_const('cakes_per_sec') then ok := false; end if;
  if p_boss_kills > public._survival_const('boss_max') then ok := false; end if;
  if p_boss_kills > 0 and p_time < public._survival_const('boss1_time') then ok := false; end if;
  if p_cleared and p_boss_kills < 1 then ok := false; end if;
  coins := floor((public._survival_const('coins_base') + p_time * public._survival_const('coins_per_sec')) * mul);
  if p_coins > coins then ok := false; else coins := p_coins; end if;

  update public.survival_runs
    set time = p_time, kills = p_kills, level = p_level, coins_earned = coins, cleared = p_cleared and ok, valid = ok, created_at = t
    where id = p_run;

  pr := public._survival_profile_row(me);
  pr.coins := pr.coins + coins;

  if ok then
    -- 누적 값
    tot := pr.totals;
    n_kills := coalesce((tot->>'kills')::bigint, 0) + p_kills;
    n_cakes := coalesce((tot->>'cakes')::bigint, 0) + p_cakes;
    tot := jsonb_build_object(
      'kills', n_kills,
      'cakes', n_cakes,
      'bestTime', greatest(coalesce((tot->>'bestTime')::int, 0), p_time),
      'bossKills', coalesce((tot->>'bossKills')::bigint, 0) + p_boss_kills,
      'clears', coalesce((tot->>'clears')::bigint, 0) + (case when p_cleared then 1 else 0 end),
      'runs', coalesce((tot->>'runs')::bigint, 0) + 1);
    pr.totals := tot;

    -- 맵별 최고 기록: 생존 시간 → 클리어 → 처치 수 (같으면 먼저 달성한 기록을 그대로 둔다)
    select * into old from public.survival_records where user_id = me and map_id = rn.map_id for update;
    if not found then better := true;
    elsif p_time <> old.best_time then better := p_time > old.best_time;
    elsif p_cleared <> old.cleared then better := p_cleared;
    else better := p_kills > old.best_kills;
    end if;
    if better then
      insert into public.survival_records as r (user_id, map_id, best_time, best_kills, cleared, character, achieved_at)
      values (me, rn.map_id, p_time, p_kills, p_cleared, rn.character, t)
      on conflict (user_id, map_id) do update set
        best_time = excluded.best_time, best_kills = excluded.best_kills, cleared = excluded.cleared,
        character = excluded.character, achieved_at = excluded.achieved_at;
    end if;

    -- 캐릭터 해금 (조건으로 푸는 것만. 원숭이·닭·개는 survival_unlock_character 로 엽전을 내고 푼다)
    foreach c in array array['rabbit', 'dragon', 'snake', 'horse', 'sheep', 'pig'] loop
      continue when c = any(pr.unlocked_characters);
      if (c = 'rabbit' and p_time >= 300)
         or (c = 'dragon' and p_boss_kills >= 1)
         or (c = 'snake' and n_kills >= 1000)
         or (c = 'horse' and p_time >= 480)
         or (c = 'sheep' and n_cakes >= 50)
         or (c = 'pig' and p_cleared) then
        pr.unlocked_characters := pr.unlocked_characters || c;
        new_chars := new_chars || c;
      end if;
    end loop;

    -- 다음 맵 해금: 이 맵을 클리어했을 때
    if p_cleared then
      select m2.map_id into next_map from public._survival_maps() m1 join public._survival_maps() m2 on m2.ord = m1.ord + 1 where m1.map_id = rn.map_id;
      if next_map is not null and not (next_map = any(pr.unlocked_maps)) then
        pr.unlocked_maps := pr.unlocked_maps || next_map;
        new_maps := new_maps || next_map;
      end if;
    end if;

    -- 도감: 허용된 id만 합친다
    if p_codex is not null and jsonb_typeof(p_codex) = 'object' then
      pr.codex := jsonb_build_object(
        'enemies', public._survival_codex_merge(pr.codex, p_codex, 'enemies'),
        'bosses', public._survival_codex_merge(pr.codex, p_codex, 'bosses'),
        'weapons', public._survival_codex_merge(pr.codex, p_codex, 'weapons'),
        'passives', public._survival_codex_merge(pr.codex, p_codex, 'passives'));
    end if;
  end if;

  update public.survival_profiles
    set coins = pr.coins, totals = pr.totals, unlocked_characters = pr.unlocked_characters, unlocked_maps = pr.unlocked_maps,
        codex = pr.codex, updated_at = t
    where user_id = me;

  -- 시아코인: 1분 넘게 버틴 정상 판 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
  if ok and p_time >= public._survival_const('coin_min_time') then
    got_coin := public._grant_sia_coin(me, 'survival', p_run::text);
  end if;

  return jsonb_build_object(
    'profile', public._survival_profile_json(pr),
    'result', jsonb_build_object(
      'coins', coins, 'valid', ok, 'newRecord', ok and better,
      'unlockedCharacters', to_jsonb(new_chars), 'unlockedMaps', to_jsonb(new_maps), 'siaCoin', got_coin));
end $$;
revoke all on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) from public, anon;
grant execute on function public.survival_finish(uuid, int, int, int, int, boolean, int, int, jsonb) to authenticated;

-- ---------- 7. 영구 강화 ----------

-- 한 레벨 산다. 엽전이 모자라거나 최대 레벨이면 거절. → 새 프로필
create or replace function public.survival_buy_upgrade(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; u record; lv int; cost bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into u from public._survival_upgrades() x where x.key = p_key;
  if not found then raise exception 'bad upgrade'; end if;
  pr := public._survival_profile_row(me);
  lv := greatest(0, coalesce((pr.upgrades->>p_key)::int, 0));
  if lv >= u.max_level then raise exception 'max level'; end if;
  cost := public._survival_upgrade_cost(u.base_cost, lv);
  if pr.coins < cost then raise exception 'not enough coins'; end if;
  update public.survival_profiles
    set coins = coins - cost, upgrades = upgrades || jsonb_build_object(p_key, lv + 1), updated_at = now()
    where user_id = me returning * into pr;
  return public._survival_profile_json(pr);
end $$;
revoke all on function public.survival_buy_upgrade(text) from public, anon;
grant execute on function public.survival_buy_upgrade(text) to authenticated;

-- 강화를 모두 되돌리고 쓴 엽전을 전액 돌려받는다. → 새 프로필
create or replace function public.survival_reset_upgrades() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; refund bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  pr := public._survival_profile_row(me);
  -- 항목마다 0 ~ (지금 레벨 - 1) 레벨의 비용을 모두 더한다 (최대 레벨을 넘는 값은 최대 레벨까지만)
  select coalesce(sum(public._survival_upgrade_cost(x.base_cost, g.n)), 0) into refund
  from public._survival_upgrades() x
  cross join lateral generate_series(0, least(x.max_level, greatest(0, coalesce((pr.upgrades->>x.key)::int, 0))) - 1) as g(n);
  update public.survival_profiles
    set coins = coins + refund, upgrades = '{}'::jsonb, updated_at = now()
    where user_id = me returning * into pr;
  return public._survival_profile_json(pr);
end $$;
revoke all on function public.survival_reset_upgrades() from public, anon;
grant execute on function public.survival_reset_upgrades() to authenticated;

-- ---------- 8. 엽전으로 캐릭터 풀기 ----------

-- 원숭이·닭·개만. 이미 풀었거나 엽전이 모자라면 거절. → 새 프로필
create or replace function public.survival_unlock_character(p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; cost int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select x.price into cost from public._survival_character_prices() x where x.char_id = p_character;
  if cost is null then raise exception 'bad character'; end if;
  pr := public._survival_profile_row(me);
  if p_character = any(pr.unlocked_characters) then raise exception 'already unlocked'; end if;
  if pr.coins < cost then raise exception 'not enough coins'; end if;
  update public.survival_profiles
    set coins = coins - cost, unlocked_characters = unlocked_characters || p_character, updated_at = now()
    where user_id = me returning * into pr;
  return public._survival_profile_json(pr);
end $$;
revoke all on function public.survival_unlock_character(text) from public, anon;
grant execute on function public.survival_unlock_character(text) to authenticated;

-- ---------- 9. 랭킹 ----------

-- 맵별 생존 시간 랭킹 (PRD 10장). 각자 맵별 최고 기록 하나, 누적 운영(초기화 없음).
-- 정렬: 생존 시간(최대 10분) → 클리어한 기록이 위 → 처치 수 → 먼저 달성한 순.
-- place·total 은 맵 안에서의 순위와 인원 (상위 100명은 map_id 로 고른 뒤 place <= 100, 내 순위는 user_id 로 조회)
create or replace view public.survival_ranking as
  select r.user_id, p.nickname, r.map_id, r.best_time, r.best_kills, r.cleared, r.character, r.achieved_at,
    (row_number() over (
      partition by r.map_id
      order by r.best_time desc, r.cleared desc, r.best_kills desc, r.achieved_at asc, r.user_id))::int as place,
    (count(*) over (partition by r.map_id))::int as total
  from public.survival_records r join public.profiles p on p.id = r.user_id;
revoke all on public.survival_ranking from anon, authenticated;
grant select on public.survival_ranking to anon, authenticated;

-- ---------- 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:survival', 'false'::jsonb) on conflict (key) do nothing;

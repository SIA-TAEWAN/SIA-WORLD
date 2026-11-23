-- 077: 시아핑거에 고양이(cat, 13번째 대원) 추가
--   · _finger_extra_heroes(): 지역 합류 규칙 밖의 추가 대원 (_shared/finger/heroes.ts 의 EXTRA_HERO_IDS).
--     _finger_heroes()(십이지 12종 · 합류 지역)는 그대로 둔다 — 고양이는 지역을 깨도 합류하지 않는다.
--   · _finger_unlocked(): 합류한 십이지 + 시아코인으로 연 추가 대원 (owned_characters, 071)
--   · _finger_profile_json(): owned (연 추가 대원) 를 더한다 — 화면 잠금 판단 (games/finger progress.ts extraOpen)
--   · finger_start · finger_level_up: 대원마다 public._check_character (071) 를 거친다
--     (안 연 고양이는 'locked character')
-- 마지막 정의: _finger_unlocked · _finger_profile_json · finger_start · finger_level_up 은 067_finger.sql (070 은 이것들을 고치지 않았다)

create or replace function public._finger_extra_heroes() returns text[]
language sql immutable as $$
  select array['cat']::text[]
$$;
revoke all on function public._finger_extra_heroes() from public, anon, authenticated;

-- 판에 데려갈 수 있는 대원 id 인가 (십이지 12 + 추가 대원)
create or replace function public._finger_is_hero(p_hero text) returns boolean
language sql immutable as $$
  select p_hero is not null and (
    exists (select 1 from public._finger_heroes() h where h.id = p_hero) or p_hero = any(public._finger_extra_heroes())
  )
$$;
revoke all on function public._finger_is_hero(text) from public, anon, authenticated;

-- 시아코인으로 연 추가 대원 (_finger_extra_heroes 순서)
create or replace function public._finger_owned(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id order by e.ord), array[]::text[])
  from unnest(public._finger_extra_heroes()) with ordinality as e(id, ord)
  where exists (select 1 from public.owned_characters o where o.user_id = p_user and o.character_id = e.id)
$$;
revoke all on function public._finger_owned(uuid) from public, anon, authenticated;

-- 합류한 대원 (처음 3종 + 합류 지역의 5번째를 클리어한 대원, 십이지 순서) + 시아코인으로 연 추가 대원
create or replace function public._finger_unlocked(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((
    select array_agg(h.id order by h.ord) from (
      select t.id, row_number() over () as ord, t.unlock_region from public._finger_heroes() t
    ) h
    where h.unlock_region = 0 or public._finger_cleared(p_user, h.unlock_region::text || '-5')
  ), array[]::text[]) || public._finger_owned(p_user)
$$;
revoke all on function public._finger_unlocked(uuid) from public, anon, authenticated;

-- 화면에 주는 모양: { coins, upgrades, levels: { "rat": 3 }, heroes: [합류한 대원], owned: [연 추가 대원], stages: { "1-1": 3 }, tower: { floor, turns } | null }
create or replace function public._finger_profile_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'coins', coalesce(p.coins, 0),
    'upgrades', coalesce(p.upgrades, '{}'::jsonb),
    'levels', coalesce((select jsonb_object_agg(h.hero, h.level) from public.finger_heroes h where h.user_id = p_user), '{}'::jsonb),
    'heroes', to_jsonb(public._finger_unlocked(p_user)),
    'owned', to_jsonb(public._finger_owned(p_user)),
    'stages', coalesce((select jsonb_object_agg(s.stage_id, s.stars) from public.finger_stages s where s.user_id = p_user), '{}'::jsonb),
    'tower', (select jsonb_build_object('floor', t.best_floor, 'turns', t.turns) from public.finger_tower t where t.user_id = p_user)
  )
  from (select 1) one left join public.finger_profiles p on p.user_id = p_user
$$;
revoke all on function public._finger_profile_json(uuid) from public, anon, authenticated;

create or replace function public.finger_start(p_stage text, p_party text[], p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid; n int; pr public.finger_profiles; lv jsonb; x text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 'normal' 스테이지 · 'tower' 끝없는 탑 (스테이지 id 는 'tower' 로 남긴다. 1-5 를 깨야 열린다)
  if p_mode is null or p_mode not in ('normal', 'tower') then raise exception 'bad mode'; end if;
  if p_mode = 'tower' then
    p_stage := 'tower';
  elsif p_stage is null or not exists (select 1 from public._finger_stages() t where t.stage_id = p_stage) then raise exception 'bad stage'; end if;
  n := coalesce(array_length(p_party, 1), 0);
  if n < 1 or n > 4 or array_position(p_party, null) is not null
    or (select count(distinct y) from unnest(p_party) y) <> n
    or exists (select 1 from unnest(p_party) y where not public._finger_is_hero(y))
  then raise exception 'bad party'; end if;
  -- 공용 캐릭터 검사 (071: 모르는 id 'bad character', 안 연 고양이 'locked character')
  foreach x in array p_party loop
    perform public._check_character(me, x);
  end loop;
  if p_mode = 'tower' then
    if not public._finger_cleared(me, '1-5') then raise exception 'tower locked'; end if;
  elsif not public._finger_stage_open(me, p_stage) then raise exception 'stage locked'; end if;
  if not (p_party <@ public._finger_unlocked(me)) then raise exception 'hero locked'; end if;
  pr := public._finger_profile_row(me);
  select jsonb_object_agg(y, coalesce(h.level, 1)) into lv
  from unnest(p_party) y left join public.finger_heroes h on h.user_id = me and h.hero = y;
  insert into public.finger_runs (user_id, stage_id, mode, party, levels, upgrades)
  values (me, p_stage, p_mode, p_party, coalesce(lv, '{}'::jsonb), coalesce(pr.upgrades, '{}'::jsonb))
  returning id into rid;
  return rid;
end $$;
revoke all on function public.finger_start(text, text[], text) from public, anon;
grant execute on function public.finger_start(text, text[], text) to authenticated;

create or replace function public.finger_level_up(p_hero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.finger_profiles; lv int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if not public._finger_is_hero(p_hero) then raise exception 'bad hero'; end if;
  perform public._check_character(me, p_hero);
  if not (p_hero = any(public._finger_unlocked(me))) then raise exception 'hero locked'; end if;
  pr := public._finger_profile_row(me);
  select h.level into lv from public.finger_heroes h where h.user_id = me and h.hero = p_hero for update;
  lv := coalesce(lv, 1);
  select l.cost into price from public._finger_levels() l where l.level = lv;
  if price is null then raise exception 'max level'; end if;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.finger_profiles set coins = coins - price, updated_at = now() where user_id = me;
  insert into public.finger_heroes (user_id, hero, level) values (me, p_hero, lv + 1)
  on conflict (user_id, hero) do update set level = excluded.level, updated_at = now();
  return public._finger_profile_json(me);
end $$;
revoke all on function public.finger_level_up(text) from public, anon;
grant execute on function public.finger_level_up(text) to authenticated;

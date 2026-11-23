-- 074: 시아디펜스에 고양이(cat, 13번째 대원) — 048 · 060 은 운영에 적용됨. 바꾸는 함수만 여기서 다시 정의한다 (뒤 파일의 정의가 실제 값이다)
--   · 캐릭터 id 검사는 071 의 _check_character(user, character, 'defense') 로 (모르는 id → 'bad character', 시아디펜스에서 열지 않은 고양이 → 'locked character')
--   · 고양이는 스테이지로 열리지 않는다: defense_profiles.unlocked_characters 에 들어가지 않고, _defense_regions 의 해금 표에도 없다.
--     출전(defense_start)·레벨업(defense_level_up)의 'character locked' 검사는 스테이지로 여는 캐릭터에만 한다 (_defense_extra_ids 는 빼고)
--   · 고양이 구매 조건: 3-5 클리어 (_cat_progress_defense, 맨 끝)
--   · 고양이의 특성(남은 체력이 가장 적은 요괴부터 · 3단계 빈사 요괴 마무리)은 서버 규칙(엽전·별·돼지 보너스)에 영향이 없어 defense_finish 는 그대로
-- games/defense/tests/sql.test.ts 가 이 파일도 읽는다 (060 뒤에).

-- 스테이지로 열리지 않는 캐릭터 (이 게임의 캐릭터 선택 화면에서 시아코인으로 연다 (게임마다 따로)). games/defense/src/data/characters.ts 의 EXTRAS (ROSTER 의 unlockRegion = BOUGHT)
create or replace function public._defense_extra_ids() returns text[]
language sql immutable as $$
  select array['cat']::text[]
$$;
revoke all on function public._defense_extra_ids() from public, anon, authenticated;

-- ---------- 판 시작 (060 과 같고, 캐릭터 검사만 바뀐다) ----------
create or replace function public.defense_start(p_stage text, p_squad text[], p_mode text default 'normal') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; rid uuid; n int; lives int; c text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless') then raise exception 'bad mode'; end if;
  if p_mode = 'endless' then
    if p_stage is distinct from 'endless' then raise exception 'bad stage'; end if;
  elsif p_stage is null or not exists (select 1 from public._defense_stages() s where s.stage_id = p_stage) then raise exception 'bad stage';
  end if;
  n := coalesce(array_length(p_squad, 1), 0);
  if n < 1 or n > public._defense_const('squad_max') or array_position(p_squad, null) is not null
     or (select count(distinct x) from unnest(p_squad) x) <> n then raise exception 'bad squad'; end if;
  -- 캐릭터마다: 아는 id 인가, 시아코인으로 여는 캐릭터면 시아디펜스에서 열었나
  foreach c in array p_squad loop
    perform public._check_character(me, c, 'defense');
  end loop;
  pr := public._defense_profile_row(me);
  if p_mode = 'endless' then
    if not exists (select 1 from public.defense_stages d where d.user_id = me and d.stage_id = '1-5') then raise exception 'endless locked'; end if;
  elsif not public._defense_stage_open(me, p_stage) then raise exception 'stage locked';
  end if;
  -- 스테이지로 여는 캐릭터는 해금했어야 한다 (고양이는 _check_character 가 본다)
  if exists (select 1 from unnest(p_squad) x where not (x = any(pr.unlocked_characters)) and not (x = any(public._defense_extra_ids()))) then
    raise exception 'character locked';
  end if;
  -- 끝나지 않은 이전 판은 지우지 않는다: 통신이 끊겨 결과를 못 보낸 판을 나중에 다시 보낼 수 있다.
  -- (여러 판을 겹쳐 여는 것은 defense_finish 가 막는다.) 7일이 지났거나(어차피 받지 않는다) 20개를 넘게 쌓인 것만 치운다.
  delete from public.defense_runs
    where user_id = me and created_at is null and started_at < clock_timestamp() - make_interval(secs => public._defense_const('max_age')::int);
  delete from public.defense_runs where id in (
    select id from public.defense_runs where user_id = me and created_at is null
    order by started_at desc offset (public._defense_const('open_runs')::int - 1));
  -- 끝난 판은 30일 뒤에 지운다
  delete from public.defense_runs where user_id = me and created_at < clock_timestamp() - interval '30 days';
  lives := public._defense_const('start_lives')::int + least(5, greatest(0, coalesce((pr.upgrades->>'lives')::int, 0)));
  insert into public.defense_runs (user_id, stage_id, squad, mode, start_lives, started_at)
  values (me, p_stage, p_squad, p_mode, lives, clock_timestamp())
  returning id into rid;
  return jsonb_build_object('run', rid, 'startLives', lives, 'upgrades', pr.upgrades, 'levels', pr.character_levels);
end $$;
revoke all on function public.defense_start(text, text[], text) from public, anon;
grant execute on function public.defense_start(text, text[], text) to authenticated;

-- ---------- 캐릭터 레벨업 (048 과 같고, 캐릭터 검사만 바뀐다) ----------
-- 해금한 캐릭터를 한 레벨 올린다 (최대 12). 엽전이 모자라면 거절. → 새 프로필
create or replace function public.defense_level_up(p_character text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.defense_profiles; cur int; price int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._check_character(me, p_character, 'defense');
  pr := public._defense_profile_row(me);
  if not (p_character = any(pr.unlocked_characters)) and not (p_character = any(public._defense_extra_ids())) then raise exception 'character locked'; end if;
  cur := greatest(1, coalesce((pr.character_levels->>p_character)::int, 1));
  if cur >= public._defense_const('char_max_level') then raise exception 'max level'; end if;
  select x.cost into price from public._defense_level_costs() x where x.lv = cur;
  if price is null then raise exception 'max level'; end if;
  if pr.coins < price then raise exception 'not enough coins'; end if;
  update public.defense_profiles
    set coins = coins - price, character_levels = character_levels || jsonb_build_object(p_character, cur + 1), updated_at = now()
    where user_id = me returning * into pr;
  return public._defense_profile_json(pr);
end $$;
revoke all on function public.defense_level_up(text) from public, anon;
grant execute on function public.defense_level_up(text) to authenticated;

-- ---------- 고양이 구매 조건 (071 의 _character_progress 가 이름으로 찾아 부른다) ----------
-- 시아디펜스에서 고양이를 사려면 3-5 스테이지(3지역 보스)를 클리어했어야 한다 → { have: 1|0, need: 1 }
-- 조건 스테이지는 games/defense/src/data/characters.ts 의 CAT_STAGE 와 같다 (tests/sql.test.ts 가 대조)
create or replace function public._cat_progress_defense(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'have', case when exists (select 1 from public.defense_stages d where d.user_id = p_user and d.stage_id = '3-5') then 1 else 0 end,
    'need', 1)
$$;
revoke all on function public._cat_progress_defense(uuid) from public, anon, authenticated;

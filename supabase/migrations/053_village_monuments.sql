-- 시아마을 8단계: 기념물 (games/village/PRD.md 9장).
-- 047 · 049 ~ 052 위에 얹는다. 여러 번 실행해도 안전하다.
--
--   · 다른 게임에서 성과를 내면 마을에 세울 수 있는 기념물(번영도 점수가 높은 장식물)이 열린다.
--     열린 기념물은 보관함으로 들어오고, 다른 장식물처럼 놓고 · 옮기고 · 보관할 수 있다. 지을 수는 없다 (종류 표의 열리는 레벨이 99).
--   · 조건은 각 게임의 기록 표를 "읽기만" 해서 서버가 판정한다 (_village_game_stats). 게임 쪽 표 · 함수는 건드리지 않는다.
--       시아탱크     player_points.wins                          첫 승리 / 10승
--       시아배구     volleyball_rankings.wins                    첫 승리 / 10승
--       시아레이스   race_records.plays (기록이 있으면 완주)     완주 / 다시 달려 기록에 도전 (완주 2번 — 표에는 "기록을 고친 적이 있는지"가 남지 않아 가장 가까운 값)
--       시아서바이벌 _survival_map_cleared (045 의 판정 그대로)  맵 4곳 각각
--       시아디펜스   defense_stages 의 '<지역>-5' (지역의 마지막 스테이지)  지역 3 · 6 · 9 · 12. 표가 아직 없으면 잠긴 채로 둔다
--       시아맞고     wallet_logs 의 맞고 판 정산 기록 중 딴 판 (amount > 0)
--       시아카지노   wallet_logs 의 포커 · 블랙잭 · 홀덤 정산 기록 중 딴 판, 또는 건 돈보다 많이 받은 룰렛 한 판 (roulette_bets)
--   · 판정은 마을에 들어올 때(village_state)와 [기념물] 화면을 열 때(village_monuments) 한다. 한 번 열린 기념물은 다시 잠기지 않는다.
--
-- 화면과 같아야 하는 값: games/village/src/data/monuments.ts · buildings.ts, 규칙은 src/game/rules.ts 의 grantMonuments (tests/sql.test.ts 가 본다)

-- ---------- 1. 표 ----------

-- 열린 기념물 (사람마다 기념물 하나에 한 줄. 건물은 village_buildings 에 따로 들어간다)
create table if not exists public.village_monuments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  monument text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, monument)
);
alter table public.village_monuments enable row level security;
drop policy if exists village_monuments_read_own on public.village_monuments;
create policy village_monuments_read_own on public.village_monuments for select using (auth.uid() = user_id);
revoke all on public.village_monuments from anon, authenticated;
grant select on public.village_monuments to authenticated;

-- ---------- 2. 종류 ----------

-- 건물 · 장식물 · 길 · 주민 선물 + 기념물 16종 (049 와 같은 모양. games/village/src/data/buildings.ts)
create or replace function public._village_types() returns table (type text, kind text, w int, h int, rice int, wood int, stone int, coin int, sia int, up_stone int, build_sec int, product text, rate int, build_exp int, cap int, points int, unlock int[])
language sql immutable as $$
  values
    ('hall', 'main', 2, 2, 40, 40, 0, 0, 0, 30, 0, '', 0, 0, 0, 0, array[1]),
    ('paddy', 'main', 1, 1, 5, 10, 0, 0, 0, 5, 10, 'rice', 60, 10, 0, 0, array[1, 1, 3, 5, 7, 10, 13, 17]),
    ('house', 'main', 1, 1, 10, 20, 0, 0, 0, 5, 30, '', 0, 15, 0, 0, array[1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24]),
    ('lumber', 'main', 1, 1, 30, 10, 0, 0, 0, 5, 20, 'wood', 40, 12, 0, 0, array[2, 2, 4, 6, 8, 11, 14, 18]),
    ('storage', 'main', 1, 1, 30, 40, 0, 0, 0, 10, 60, '', 0, 20, 0, 0, array[2, 4, 7, 10, 14, 18]),
    ('market', 'main', 1, 1, 60, 60, 0, 0, 0, 10, 120, '', 0, 30, 0, 0, array[3]),
    ('quarry', 'main', 1, 1, 50, 50, 0, 0, 0, 5, 60, 'stone', 30, 25, 0, 0, array[4, 4, 6, 9, 12, 16, 20]),
    ('mill', 'main', 1, 1, 40, 80, 20, 0, 0, 10, 180, '', 0, 40, 0, 0, array[5, 8, 12, 16]),
    ('jar', 'main', 1, 1, 0, 100, 60, 50, 0, 15, 300, '', 0, 60, 0, 0, array[8, 12, 17]),
    ('pavilion', 'special', 2, 2, 100, 100, 0, 0, 20, 20, 600, '', 0, 150, 0, 20, array[6]),
    ('feast', 'special', 2, 2, 150, 150, 50, 0, 40, 20, 1800, '', 0, 300, 0, 40, array[10]),
    ('shrine', 'special', 2, 2, 200, 200, 100, 0, 60, 30, 3600, '', 0, 600, 0, 80, array[14]),
    ('tree', 'deco', 1, 1, 0, 0, 0, 20, 0, 0, 0, '', 0, 2, 12, 1, array[1]),
    ('haystack', 'deco', 1, 1, 0, 0, 0, 50, 0, 0, 0, '', 0, 4, 6, 2, array[2]),
    ('flower', 'deco', 1, 1, 0, 0, 0, 30, 0, 0, 0, '', 0, 2, 12, 1, array[2]),
    ('scarecrow', 'deco', 1, 1, 0, 0, 0, 60, 0, 0, 0, '', 0, 4, 4, 2, array[3]),
    ('stonewall', 'deco', 1, 1, 0, 0, 0, 40, 0, 0, 0, '', 0, 4, 16, 2, array[3]),
    ('bench', 'deco', 1, 1, 0, 0, 0, 120, 0, 0, 0, '', 0, 8, 4, 4, array[4]),
    ('lantern', 'deco', 1, 1, 0, 0, 0, 80, 0, 0, 0, '', 0, 6, 8, 3, array[5]),
    ('well', 'deco', 1, 1, 0, 0, 0, 200, 0, 0, 0, '', 0, 12, 2, 6, array[6]),
    ('jangseung', 'deco', 1, 1, 0, 0, 0, 150, 0, 0, 0, '', 0, 10, 4, 5, array[7]),
    ('sotdae', 'deco', 1, 1, 0, 0, 0, 250, 0, 0, 0, '', 0, 12, 4, 6, array[8]),
    ('pond', 'deco', 1, 1, 0, 0, 0, 300, 0, 0, 0, '', 0, 16, 2, 8, array[9]),
    ('stonetower', 'deco', 1, 1, 0, 0, 0, 400, 0, 0, 0, '', 0, 20, 2, 10, array[12]),
    ('road', 'road', 1, 1, 0, 0, 0, 5, 0, 0, 0, '', 0, 0, 80, 0, array[1]),
    ('gift_rat', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_ox', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_tiger', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_rabbit', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_dragon', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_snake', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_horse', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_sheep', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_monkey', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_rooster', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_dog', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('gift_pig', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 12, array[99]),
    ('mon_tank1', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_tank10', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_volley1', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_volley10', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_race1', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_race2', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 30, array[99]),
    ('mon_surv_field', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_surv_bamboo', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 30, array[99]),
    ('mon_surv_palace', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 40, array[99]),
    ('mon_surv_underworld', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 50, array[99]),
    ('mon_def3', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 25, array[99]),
    ('mon_def6', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 35, array[99]),
    ('mon_def9', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 45, array[99]),
    ('mon_def12', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 60, array[99]),
    ('mon_matgo', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99]),
    ('mon_casino', 'deco', 1, 1, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 1, 20, array[99])
$$;
revoke all on function public._village_types() from public, anon, authenticated;

-- 기념물: 종류, 차례, 보는 기록(_village_game_stats 의 이름), 필요한 값. games/village/src/data/monuments.ts
create or replace function public._village_monument_defs() returns table (monument text, ord int, stat text, need int)
language sql immutable as $$
  values
    ('mon_tank1', 1, 'tank_wins', 1),
    ('mon_tank10', 2, 'tank_wins', 10),
    ('mon_volley1', 3, 'volley_wins', 1),
    ('mon_volley10', 4, 'volley_wins', 10),
    ('mon_race1', 5, 'race_plays', 1),
    ('mon_race2', 6, 'race_plays', 2),
    ('mon_surv_field', 7, 'surv_field', 1),
    ('mon_surv_bamboo', 8, 'surv_bamboo', 1),
    ('mon_surv_palace', 9, 'surv_palace', 1),
    ('mon_surv_underworld', 10, 'surv_underworld', 1),
    ('mon_def3', 11, 'def_3', 1),
    ('mon_def6', 12, 'def_6', 1),
    ('mon_def9', 13, 'def_9', 1),
    ('mon_def12', 14, 'def_12', 1),
    ('mon_matgo', 15, 'matgo_wins', 1),
    ('mon_casino', 16, 'casino_wins', 1)
$$;
revoke all on function public._village_monument_defs() from public, anon, authenticated;

-- ---------- 3. 다른 게임의 기록 읽기 ----------

-- 그 사람의 게임 기록 (읽기만 한다). 없는 기록은 0
create or replace function public._village_game_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; maps text[]; def jsonb;
begin
  select s.unlocked_maps into maps from public.survival_profiles s where s.user_id = p_user;
  maps := coalesce(maps, array[]::text[]);
  res := jsonb_build_object(
    'tank_wins', coalesce((select max(pp.wins) from public.player_points pp where pp.user_id = p_user), 0),
    'volley_wins', coalesce((select v.wins from public.volleyball_rankings v where v.user_id = p_user), 0),
    'race_plays', coalesce((select r.plays from public.race_records r where r.user_id = p_user), 0),
    'surv_field', public._survival_map_cleared(p_user, 'field', maps)::int,
    'surv_bamboo', public._survival_map_cleared(p_user, 'bamboo', maps)::int,
    'surv_palace', public._survival_map_cleared(p_user, 'palace', maps)::int,
    'surv_underworld', public._survival_map_cleared(p_user, 'underworld', maps)::int,
    'matgo_wins', (exists (
      select 1 from public.wallet_logs l where l.user_id = p_user and l.reason = 'game' and l.amount > 0 and l.game_id like 'matgo:%'))::int,
    'casino_wins', (exists (
        select 1 from public.wallet_logs l where l.user_id = p_user and l.reason = 'game' and l.amount > 0
          and (l.game_id like 'poker:%' or l.game_id like 'blackjack:%' or l.game_id like 'holdem:%'))
      or exists (select 1 from public.roulette_bets b where b.user_id = p_user and b.payout > b.total))::int,
    'def_3', 0, 'def_6', 0, 'def_9', 0, 'def_12', 0);
  -- 시아디펜스 표는 아직 없을 수 있다 (없으면 잠긴 채로)
  if to_regclass('public.defense_stages') is not null then
    execute 'select jsonb_object_agg(''def_'' || g, (exists (select 1 from public.defense_stages d where d.user_id = $1 and d.stage_id = g || ''-5''))::int)
             from unnest(array[3, 6, 9, 12]) g' into def using p_user;
    res := res || coalesce(def, '{}'::jsonb);
  end if;
  return res;
end $$;
revoke all on function public._village_game_stats(uuid) from public, anon, authenticated;

-- 조건을 채운 기념물을 연다: 한 줄을 적고 보관함에 넣는다. 이미 다 열었으면 기록을 읽지 않는다
create or replace function public._village_monument_sync(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare st jsonb; d record;
begin
  if not exists (select 1 from public._village_monument_defs() x
                 where not exists (select 1 from public.village_monuments m where m.user_id = p_user and m.monument = x.monument)) then
    return;
  end if;
  st := public._village_game_stats(p_user);
  for d in select x.* from public._village_monument_defs() x
           where coalesce((st ->> x.stat)::int, 0) >= x.need
             and not exists (select 1 from public.village_monuments m where m.user_id = p_user and m.monument = x.monument)
           order by x.ord loop
    insert into public.village_monuments (user_id, monument, unlocked_at) values (p_user, d.monument, p_now);
    insert into public.village_buildings (user_id, type, state, last_collected_at) values (p_user, d.monument, 'stored', p_now);
  end loop;
end $$;
revoke all on function public._village_monument_sync(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 4. 상태 ----------

-- 052 와 같고, 열린 기념물(monuments)이 더해진다
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform public._village_refresh(p_user, p_now);
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'sia', coalesce((select w.sia_coins from public.wallets w where w.user_id = p_user), 0),
    'profile', jsonb_build_object(
      'name', p.village_name, 'level', p.level, 'exp', p.exp,
      'resources', jsonb_build_object('special', 0) || p.resources, 'landStage', p.land_stage,
      'prosperity', p.prosperity, 'prosperityAt', public._village_ms(p.prosperity_at), 'praiseCount', p.praise_count,
      'praised', coalesce((select jsonb_agg(x.to_user_id order by x.created_at, x.to_user_id) from public.village_praises x
                           where x.from_user_id = p_user and x.day = public._village_kst_day(p_now)), '[]'::jsonb),
      'goal', p.goal, 'goalProgress', p.goal_progress,
      'marketDay', p.market_day, 'marketSold', p.market_sold,
      'feastFrom', coalesce(public._village_ms(p.feast_from), 0), 'feastUntil', coalesce(public._village_ms(p.feast_until), 0), 'feastPct', p.feast_pct,
      'reqSeq', p.req_seq, 'dailyDay', p.daily_day, 'dailyBonusDay', p.daily_bonus_day, 'roosterDay', p.rooster_day),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'level', b.level, 'x', coalesce(b.x, 0), 'y', coalesce(b.y, 0), 'state', b.state,
        'finishAt', public._village_ms(b.finish_at), 'startAt', public._village_ms(b.started_at),
        'collectedAt', public._village_ms(b.last_collected_at), 'jobN', b.job_n, 'banked', b.banked) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user), '[]'::jsonb),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.resident, 'affinity', r.affinity, 'building', r.building_id, 'gifted', r.gifted) order by d.ord)
      from public.village_residents r join public._village_residents() d on d.id = r.resident where r.user_id = p_user), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(q.content || jsonb_build_object('slot', q.slot, 'state', q.state, 'readyAt', coalesce(public._village_ms(q.ready_at), 0)) order by q.slot)
      from public.village_requests q where q.user_id = p_user and q.kind = 'resident'), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(q.content || jsonb_build_object('slot', q.slot, 'progress', q.progress, 'claimed', q.state = 'claimed') order by q.slot)
      from public.village_requests q where q.user_id = p_user and q.kind = 'daily'), '[]'::jsonb),
    'monuments', coalesce((
      select jsonb_agg(m.monument order by d.ord)
      from public.village_monuments m join public._village_monument_defs() d on d.monument = m.monument where m.user_id = p_user), '[]'::jsonb))
  into res
  from public.village_profiles p where p.user_id = p_user;
  return res;
end $$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- 내 마을 (052 와 같고, 들어올 때 기념물 조건을 본다)
create or replace function public.village_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  update public.village_profiles set last_seen_at = t where user_id = me;
  perform public._village_monument_sync(me, t);
  if exists (select 1 from public.profiles where id = me and is_admin) then
    update public.village_profiles set resources = jsonb_set(resources, '{coin}', '10000'::jsonb) where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_state() from public, anon;
grant execute on function public.village_state() to authenticated;

-- [기념물] 화면: 조건을 다시 보고, 상태와 함께 게임별 기록(stats)을 돌려준다
create or replace function public.village_monuments() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  perform public._village_monument_sync(me, t);
  return public._village_state_json(me, t) || jsonb_build_object('stats', public._village_game_stats(me));
end $$;
revoke all on function public.village_monuments() from public, anon;
grant execute on function public.village_monuments() to authenticated;

-- 052: 시아마을 7단계 — 번영도 · 랭킹 · 다른 마을 구경 · 칭찬 · 마을 이름
--   · 번영도 = 건물 레벨 합 + 놓인 것의 번영도 점수(장식물 · 특별 건물 · 기념물) + 주민 친밀도 단계 × aff_points + 받은 칭찬 × praise_points
--     땅에 놓여 있고 다 지어진 것만 센다. 서버가 답을 보내기 직전(_village_state_json)에 다시 세어
--     village_profiles.prosperity 와 달성 시각(prosperity_at)을 고친다 — 값이 바뀔 때만
--   · village_ranking 뷰: 번영도 높은 순 → 먼저 달성한 순 (누적 운영, 초기화 없음). 다른 랭킹 뷰와 같은 모양(place · total) · 같은 권한
--   · village_visit(user): 다른 사람 마을을 읽기 전용으로 본다 — 건물 · 장식물 · 주민 · 레벨 · 번영도 · 마을 이름만
--     (자원 수량 · 시아코인 잔액 · 부탁 · 오늘의 할 일은 보내지 않는다)
--   · village_praise(user): 칭찬. 하루 praise_per_day 번, 같은 마을은 하루 한 번, 내 마을은 안 된다.
--     받은 사람은 번영도가 오르고 준 사람은 엽전을 조금 받는다. village_praises 에 남긴다
--     두 마을 줄을 잠글 때는 늘 user_id 가 작은 쪽부터 (서로 칭찬해도 물리지 않게)
--   · village_rename(name): 한글 · 영문 · 숫자 · 띄어쓰기, 12자까지 (화면은 글자 그대로 보여 준다: 꺾쇠 같은 글자는 들어올 수 없다)
--   · 관리자 계정(profiles.is_admin)은 시험용으로, 마을에 들어올 때마다(village_state) 엽전과 시아코인이 10,000 으로 맞춰진다.
--     일반 사용자는 영향이 없다. 쌀 · 나무 · 돌 · 떡은 그대로이고, 다른 함수에서는 건드리지 않는다. 번영도에는 엽전이 들어가지 않는다

-- ---------- 1. 표 ----------

alter table public.village_profiles add column if not exists prosperity_at timestamptz not null default now();

create table if not exists public.village_praises (
  from_user_id uuid not null references public.village_profiles(user_id) on delete cascade,
  to_user_id uuid not null references public.village_profiles(user_id) on delete cascade,
  -- 서버 날짜 (한국 시간 2026-01-01 부터 센 날 수)
  day int not null,
  created_at timestamptz not null default now(),
  primary key (from_user_id, to_user_id, day),
  check (from_user_id <> to_user_id)
);
alter table public.village_praises enable row level security;
drop policy if exists village_praises_read_own on public.village_praises;
create policy village_praises_read_own on public.village_praises for select using (auth.uid() = from_user_id or auth.uid() = to_user_id);
revoke all on public.village_praises from anon, authenticated;
grant select on public.village_praises to authenticated;
create index if not exists village_praises_to_idx on public.village_praises (to_user_id);
create index if not exists village_praises_from_day_idx on public.village_praises (from_user_id, day);

-- ---------- 2. 수치 ----------

-- 기준 값 (뜻은 games/village/src/data/balance.ts 의 CONST 와 data/residents.ts 의 REQ 에 적혀 있다)
create or replace function public._village_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_level' then 30
    when 'building_max_level' then 10
    when 'prod_cap_sec' then 43200
    when 'base_slots' then 2
    when 'slots3_hall' then 5
    when 'harvest_exp_div' then 20
    when 'harvest_max' then 64
    when 'hall_sec_mul' then 2
    when 'hall_exp_mul' then 3
    when 'stone_from' then 4
    when 'price_min_pct' then 80
    when 'price_span' then 51
    when 'pavilion_pct' then 10
    when 'pavilion_pct_per' then 2
    when 'pavilion_range' then 1
    when 'feast_cake' then 60
    when 'feast_sec' then 86400
    when 'feast_pct' then 20
    when 'feast_pct_per' then 2
    when 'feast_exp' then 30
    when 'bonus_room_pct' then 40
    when 'req_exp_pct' then 30
    when 'daily_exp_pct' then 1
    when 'aff_points' then 3
    when 'praise_points' then 2
    when 'praise_per_day' then 5
    when 'praise_coin' then 10
    when 'name_max' then 12
    when 'req_slots' then 3
    when 'req_wait_done' then 1200
    when 'req_wait_skip' then 3600
    when 'shrine_pct' then 50
    when 'dog_cap_sec' then 54000
    when 'sheep_range' then 1
  end
$$;
revoke all on function public._village_const(text) from public, anon, authenticated;

-- ---------- 3. 번영도 ----------

create or replace function public._village_prosperity(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select (
    coalesce((select sum(case when t.kind in ('main', 'special') then b.level else 0 end + t.points)
              from public.village_buildings b join public._village_types() t on t.type = b.type
              where b.user_id = p_user and b.state not in ('building', 'stored')), 0)
    + coalesce((select sum(public._village_aff_level(r.affinity)) from public.village_residents r where r.user_id = p_user), 0) * public._village_const('aff_points')::int
    + coalesce((select praise_count from public.village_profiles where user_id = p_user), 0) * public._village_const('praise_points')::int
  )::int
$$;
revoke all on function public._village_prosperity(uuid) from public, anon, authenticated;

-- 번영도를 다시 세어 적는다. 값이 바뀔 때만 달성 시각을 고친다 (같은 번영도는 먼저 달성한 사람이 위)
create or replace function public._village_refresh(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v int := public._village_prosperity(p_user);
begin
  update public.village_profiles set prosperity = v, prosperity_at = p_now where user_id = p_user and prosperity <> v;
end $$;
revoke all on function public._village_refresh(uuid, timestamptz) from public, anon, authenticated;

-- 화면에 보내는 마을 모양 (051 과 같고, 보내기 직전에 번영도를 다시 센다. praised = 오늘 내가 칭찬한 마을들)
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
      from public.village_requests q where q.user_id = p_user and q.kind = 'daily'), '[]'::jsonb))
  into res
  from public.village_profiles p where p.user_id = p_user;
  return res;
end $$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 4. 랭킹 ----------

-- 번영도 랭킹 (PRD 11장): 번영도 높은 순 → 먼저 달성한 순. place · total 은 순위와 마을 수
-- (상위 100곳은 place <= 100, 내 순위는 user_id 로 조회 — shared/ranking-dialog.js 와 게임 안 [랭킹])
create or replace view public.village_ranking as
  select v.user_id, p.nickname, v.village_name, v.level, v.prosperity, v.prosperity_at as achieved_at,
    (row_number() over (order by v.prosperity desc, v.prosperity_at asc, v.user_id))::int as place,
    (count(*) over ())::int as total
  from public.village_profiles v join public.profiles p on p.id = v.user_id;
revoke all on public.village_ranking from anon, authenticated;
grant select on public.village_ranking to anon, authenticated;

-- ---------- 5. 구경 · 칭찬 · 이름 ----------

-- 다른 사람(또는 내) 마을을 읽기 전용으로 본다. 아무것도 바꾸지 않는다
--   끝날 시각이 지난 짓기 · 업그레이드는 끝난 모습으로 보여 준다 (그 마을의 주인이 들어와야 실제로 마무리된다)
create or replace function public._village_visit_json(p_me uuid, p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'userId', v.user_id, 'nickname', p.nickname, 'name', v.village_name, 'level', v.level, 'prosperity', v.prosperity,
    'landStage', v.land_stage, 'mine', v.user_id = p_me,
    'praised', exists (select 1 from public.village_praises x where x.from_user_id = p_me and x.to_user_id = p_user and x.day = public._village_kst_day(p_now)),
    'praiseLeft', greatest(0, public._village_const('praise_per_day')::int
      - (select count(*) from public.village_praises x where x.from_user_id = p_me and x.day = public._village_kst_day(p_now)))::int,
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'x', b.x, 'y', b.y,
        'level', b.level + case when b.state = 'upgrading' and b.finish_at <= p_now then 1 else 0 end,
        'state', case when b.state = 'building' and b.finish_at > p_now then 'building' else 'done' end) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user and b.state <> 'stored'), '[]'::jsonb),
    'residents', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.resident, 'affinity', r.affinity, 'building', r.building_id) order by d.ord)
      from public.village_residents r join public._village_residents() d on d.id = r.resident where r.user_id = p_user), '[]'::jsonb))
  from public.village_profiles v join public.profiles p on p.id = v.user_id where v.user_id = p_user
$$;
revoke all on function public._village_visit_json(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.village_visit(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); res jsonb;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  res := public._village_visit_json(me, p_user, clock_timestamp());
  if res is null then raise exception 'no village'; end if;
  return res;
end $$;
revoke all on function public.village_visit(uuid) from public, anon;
grant execute on function public.village_visit(uuid) to authenticated;

-- 칭찬하기. 답 = 내 마을 상태 + visit(칭찬한 마을의 새 모습)
create or replace function public.village_praise(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; today int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 두 마을 줄을 잠근다: user_id 가 작은 쪽부터 (서로 칭찬해도 물리지 않게)
  if p_user is not null and p_user < me then perform 1 from public.village_profiles where user_id = p_user for update; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  if p_user = me then raise exception 'self'; end if;
  perform 1 from public.village_profiles where user_id = p_user for update;
  if not found then raise exception 'no village'; end if;
  today := public._village_kst_day(t);
  if exists (select 1 from public.village_praises x where x.from_user_id = me and x.to_user_id = p_user and x.day = today) then raise exception 'already praised'; end if;
  if (select count(*) from public.village_praises x where x.from_user_id = me and x.day = today) >= public._village_const('praise_per_day') then raise exception 'praise limit'; end if;
  insert into public.village_praises (from_user_id, to_user_id, day, created_at) values (me, p_user, today, t);
  update public.village_profiles set praise_count = praise_count + 1 where user_id = p_user;
  perform public._village_refresh(p_user, t);
  perform public._village_add(me, 'coin', public._village_const('praise_coin')::bigint);
  return public._village_state_json(me, t) || jsonb_build_object('visit', public._village_visit_json(me, p_user, t));
end $$;
revoke all on function public.village_praise(uuid) from public, anon;
grant execute on function public.village_praise(uuid) to authenticated;

-- 마을 이름 바꾸기: 한글 · 영문 · 숫자 · 띄어쓰기(앞뒤 · 연속 없음), name_max 글자까지
create or replace function public.village_rename(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  if p_name is null or char_length(p_name) < 1 or char_length(p_name) > public._village_const('name_max')
    or p_name !~ '^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$' then raise exception 'bad name'; end if;
  update public.village_profiles set village_name = p_name, updated_at = now() where user_id = me;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_rename(text) from public, anon;
grant execute on function public.village_rename(text) to authenticated;

-- ---------- 6. 관리자 계정: 들어올 때마다 엽전 · 시아코인을 10,000 으로 (시험용) ----------

-- 내 마을 (047 과 같고, 관리자면 엽전과 시아코인을 10,000 으로 맞춘 뒤 돌려준다. 잠금 순서는 마을 줄 → 지갑 줄)
create or replace function public.village_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  update public.village_profiles set last_seen_at = t where user_id = me;
  if exists (select 1 from public.profiles where id = me and is_admin) then
    update public.village_profiles set resources = jsonb_set(resources, '{coin}', '10000'::jsonb) where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_state() from public, anon;
grant execute on function public.village_state() to authenticated;

-- 050: 시아마을 5단계 — 시아코인 (공통 지갑에서 쓰기) · 땅 확장 6단계 · 특별 건물 3종
--   · _spend_sia_coin(user, amount, game, ref): 공통 지갑의 시아코인을 쓴다. 안에서만 부른다 (다른 게임도 쓸 수 있다)
--       - 지갑 줄을 잠그고, 잔액이 모자라면 'not enough coin' (아무것도 바뀌지 않는다)
--       - 쓴 기록은 sia_coin_spends 에 남긴다. sia_coin_logs(받은 기록)에 넣지 않는 까닭: _grant_sia_coin 의 15초 간격 · 하루 100개 한도가
--         그 표의 줄 수로 세기 때문에, 쓴 기록이 섞이면 코인을 쓴 날 받는 코인이 줄어든다
--       - 같은 (user, game, ref) 는 한 번만 ('already spent')
--       - 잠금 순서는 늘 마을 줄(village_profiles) → 지갑 줄(wallets). 받는 쪽(_grant_sia_coin)은 지갑 줄만 잠그므로 서로 물리지 않는다
--   · 땅 확장: village_expand() — 시아코인 + 마을 레벨 조건 (8×8 → 20×20, 6단계)
--   · 특별 건물 (정자 · 잔치 마당 · 십이지 사당): village_build 가 일반 자원과 함께 시아코인을 받는다. 하나씩만, 업그레이드는 일반 자원
--       - 정자: 둘레 한 칸 안의 생산 건물이 10 % (레벨마다 +2) 더 만든다
--       - 잔치 마당: 떡 60개로 잔치를 열면(village_feast) 하루 동안 마을 전체 생산 +20 % (레벨마다 +2)
--       - 십이지 사당: 친밀도 · 번영도 효과는 6 · 7단계에서 잇는다 (지금은 짓고 올릴 수만 있다)
--   · 생산량이 바뀌는 일(정자가 생기거나 옮겨짐 · 건물을 옮김 · 잔치 시작)이 있으면 그때까지 쌓인 양을 건물에 적어 둔다 (banked):
--     보너스는 그 뒤에 쌓이는 것에만 붙는다 (수확 직전에 정자 옆으로 옮겨 보너스를 받는 일이 없다)
--   · 시아코인이 없어도 마을 레벨 30 까지 갈 수 있다: 일반 건물과 그 최대 개수는 처음 땅 8×8 에 다 들어간다
-- 화면에 보내는 상태에 시아코인 잔액(sia)이 실린다.

-- ---------- 1. 시아코인 쓰기 (SIA WORLD 공통) ----------

create table if not exists public.sia_coin_spends (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  ref text not null,
  amount int not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (user_id, game, ref)
);
alter table public.sia_coin_spends enable row level security;
drop policy if exists sia_coin_spends_read_own on public.sia_coin_spends;
create policy sia_coin_spends_read_own on public.sia_coin_spends for select using (auth.uid() = user_id);
revoke all on public.sia_coin_spends from anon, authenticated;
grant select on public.sia_coin_spends to authenticated;
create index if not exists sia_coin_spends_user_time_idx on public.sia_coin_spends (user_id, created_at desc);

create or replace function public._spend_sia_coin(p_user uuid, p_amount int, p_game text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare bal bigint;
begin
  if p_user is null or p_game is null or p_ref is null or p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  perform public._ensure_wallet(p_user);
  select sia_coins into bal from public.wallets where user_id = p_user for update;
  if bal is null or bal < p_amount then raise exception 'not enough coin'; end if;
  if exists (select 1 from public.sia_coin_spends where user_id = p_user and game = p_game and ref = p_ref) then raise exception 'already spent'; end if;
  insert into public.sia_coin_spends (user_id, game, ref, amount) values (p_user, p_game, p_ref, p_amount);
  update public.wallets set sia_coins = sia_coins - p_amount where user_id = p_user;
end $$;
revoke all on function public._spend_sia_coin(uuid, int, text, text) from public, anon, authenticated;

-- ---------- 2. 표 고치기 ----------

-- 생산량이 바뀌기 전까지 쌓인 양
alter table public.village_buildings add column if not exists banked bigint not null default 0 check (banked >= 0);
-- 잔치: 시작 · 끝 · 보너스(%)
alter table public.village_profiles add column if not exists feast_from timestamptz;
alter table public.village_profiles add column if not exists feast_until timestamptz;
alter table public.village_profiles add column if not exists feast_pct int not null default 0 check (feast_pct >= 0);

-- ---------- 3. 수치 ----------

create or replace function public._village_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
    when 'max_level' then 30            -- 마을 레벨 상한
    when 'building_max_level' then 10   -- 건물 레벨 상한
    when 'prod_cap_sec' then 43200      -- 생산 건물이 쌓아 두는 최대 시간 (초): 12시간
    when 'base_slots' then 2            -- 동시에 짓는(업그레이드 포함) 수
    when 'slots3_hall' then 5           -- 마을 회관이 이 레벨이 되면 동시에 3개
    when 'harvest_exp_div' then 20      -- 수확 경험치 = 건물에 쌓여 있던 양 ÷ 이 값 (버림)
    when 'harvest_max' then 64          -- 한 번에 수확을 요청할 수 있는 건물 수
    when 'hall_sec_mul' then 2          -- 마을 회관의 업그레이드 시간 배수
    when 'hall_exp_mul' then 3          -- 마을 회관의 업그레이드 경험치 배수
    when 'stone_from' then 4            -- 건물 레벨이 이 값 이상이면 업그레이드에 돌이 든다
    when 'price_min_pct' then 80        -- 장터 시세: 기준 값의 80 % 부터
    when 'price_span' then 51           -- … 51 가지 (80 ~ 130 %)
    when 'pavilion_pct' then 10         -- 정자: 둘레의 생산 건물 + 10 %
    when 'pavilion_pct_per' then 2      -- … 정자 레벨마다 + 2
    when 'pavilion_range' then 1        -- … 둘레 한 칸
    when 'feast_cake' then 60           -- 잔치를 여는 데 드는 떡
    when 'feast_sec' then 86400         -- 잔치는 하루 (초)
    when 'feast_pct' then 20            -- 잔치: 마을 전체 생산 + 20 %
    when 'feast_pct_per' then 2         -- … 잔치 마당 레벨마다 + 2
    when 'feast_exp' then 30            -- 잔치를 열면 받는 경험치
    when 'bonus_room_pct' then 40       -- 건물에 쌓이는 양의 상한 = 12시간 분량 × 140 % (보너스로 더 쌓이는 만큼의 여유)
  end
$$;
revoke all on function public._village_const(text) from public, anon, authenticated;

create or replace function public._village_table(p_name text) returns int[]
language sql immutable as $$
  select case p_name
    when 'land_sizes' then array[8, 10, 12, 14, 16, 18, 20]
    when 'level_exp' then array[80, 160, 300, 500, 760, 1000, 1300, 1650, 2050, 2500, 3050, 4000, 4950, 5930, 7020, 8230, 9560, 11020, 12610, 14340, 16200, 18220, 20380, 22690, 25170, 27800, 30590, 33560, 36700]
    when 'cost_mul' then array[20, 40, 70, 110, 170, 250, 360, 500, 700]
    when 'upgrade_sec' then array[30, 120, 600, 1800, 3600, 7200, 14400, 21600, 28800]
    when 'upgrade_exp' then array[20, 40, 80, 140, 220, 320, 450, 600, 800]
    when 'rate_mul' then array[10, 13, 16, 20, 24, 29, 34, 40, 47, 55]
    when 'hall_cap' then array[300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200]
    when 'storage_cap' then array[150, 250, 400, 600, 850, 1150, 1500, 1900, 2400, 3000]
    when 'hall_need' then array[2, 4, 6, 9, 12, 15, 19, 23, 27]
    when 'market_limit' then array[300, 450, 650, 900, 1200, 1600, 2100, 2700, 3400, 4200]
    when 'land_price' then array[10, 20, 30, 50, 70, 100]
    when 'land_need' then array[3, 6, 9, 13, 17, 22]
  end
$$;
revoke all on function public._village_table(text) from public, anon, authenticated;

-- ---------- 4. 생산량과 쌓인 양 ----------

-- 정자의 영향이 닿는 거리 (칸). 6단계에서 주민 보너스가 붙는다
create or replace function public._village_pavilion_range(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select public._village_const('pavilion_range')::int
$$;
revoke all on function public._village_pavilion_range(uuid) from public, anon, authenticated;

-- 생산 건물이 쌓아 두는 최대 시간 (초). 6단계에서 주민 보너스가 붙는다
create or replace function public._village_cap_sec(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select public._village_const('prod_cap_sec')::int
$$;
revoke all on function public._village_cap_sec(uuid) from public, anon, authenticated;

-- 그 건물의 생산 보너스 (%): 정자 둘레에 있으면 pavilion_pct + pavilion_pct_per × (정자 레벨 − 1). 생산 건물이 아니면 0
create or replace function public._village_rate_pct(p_user uuid, p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public._village_const('pavilion_pct')::int + public._village_const('pavilion_pct_per')::int * (pv.level - 1)
    from public.village_buildings b
    join public._village_types() d on d.type = b.type
    join public.village_buildings pv on pv.user_id = b.user_id and pv.type = 'pavilion' and pv.state in ('done', 'upgrading')
    join public._village_types() p on p.type = 'pavilion'
    where b.id = p_id and b.user_id = p_user and d.product <> '' and b.state <> 'stored'
      and b.x < pv.x + p.w + public._village_pavilion_range(p_user) and b.x + d.w > pv.x - public._village_pavilion_range(p_user)
      and b.y < pv.y + p.h + public._village_pavilion_range(p_user) and b.y + d.h > pv.y - public._village_pavilion_range(p_user)
    limit 1), 0)
$$;
revoke all on function public._village_rate_pct(uuid, uuid) from public, anon, authenticated;

-- 생산 건물에 지금 쌓여 있는 양 (state 가 'done' 인 생산 건물만 부른다)
--   rate  = floor(기본 생산량 × rate_mul ÷ 10) × (100 + 보너스 %) ÷ 100          (시간당)
--   base  = floor(지난 초 × rate ÷ 3600)                                          (지난 초는 최대 cap_sec)
--   extra = floor(잔치와 겹친 초 × rate × 잔치 % ÷ 360000)
--   units = least(banked + base + extra, floor(cap_sec × rate × (100 + bonus_room_pct) ÷ 360000))
create or replace function public._village_units(p_user uuid, p_id uuid, p_now timestamptz,
  out units bigint, out base bigint, out frm timestamptz, out rate bigint)
language plpgsql stable security definer set search_path = public as $$
declare b public.village_buildings; ty record; p public.village_profiles; cap int; over bigint; extra bigint;
begin
  select * into b from public.village_buildings where id = p_id and user_id = p_user;
  select * into ty from public._village_types() t where t.type = b.type;
  select * into p from public.village_profiles where user_id = p_user;
  cap := public._village_cap_sec(p_user);
  rate := (ty.rate * (public._village_table('rate_mul'))[b.level] / 10)::bigint * (100 + public._village_rate_pct(p_user, p_id)) / 100;
  frm := greatest(b.last_collected_at, p_now - make_interval(secs => cap));
  base := greatest(0, floor(extract(epoch from (p_now - frm)))::bigint) * rate / 3600;
  over := case when p.feast_from is null or p.feast_until is null then 0
          else greatest(0, floor(extract(epoch from (least(p_now, p.feast_until) - greatest(frm, p.feast_from))))::bigint) end;
  extra := over * rate * p.feast_pct / 360000;
  units := least(b.banked + base + extra, cap::bigint * rate * (100 + public._village_const('bonus_room_pct')::int) / 360000);
end $$;
revoke all on function public._village_units(uuid, uuid, timestamptz) from public, anon, authenticated;

-- 쌓인 양을 건물에 적어 둔다 (생산량이 바뀌기 직전에 부른다). 쓴 만큼의 시간만 쓴다
create or replace function public._village_bank(p_user uuid, p_id uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; u record;
begin
  select * into b from public.village_buildings where id = p_id and user_id = p_user for update;
  if not found or b.state <> 'done' or not exists (select 1 from public._village_types() t where t.type = b.type and t.product <> '') then return; end if;
  select * into u from public._village_units(p_user, p_id, p_now);
  update public.village_buildings set banked = u.units,
    last_collected_at = least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))
  where id = p_id;
end $$;
revoke all on function public._village_bank(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public._village_bank_all(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  for bid in select b.id from public.village_buildings b join public._village_types() t on t.type = b.type
             where b.user_id = p_user and b.state = 'done' and t.product <> '' order by b.created_at, b.id loop
    perform public._village_bank(p_user, bid, p_now);
  end loop;
end $$;
revoke all on function public._village_bank_all(uuid, timestamptz) from public, anon, authenticated;

-- 끝난 짓기 · 업그레이드를 마무리한다. 정자가 다 지어지거나 레벨이 오르면 그 전까지 쌓인 양을 먼저 적어 둔다
create or replace function public._village_settle(p_user uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; e bigint;
begin
  for b in select * from public.village_buildings where user_id = p_user and state in ('building', 'upgrading') and finish_at <= p_now order by finish_at, created_at, id loop
    if b.type = 'pavilion' then perform public._village_bank_all(p_user, p_now); end if;
    if b.state = 'building' then
      select t.build_exp into e from public._village_types() t where t.type = b.type;
    else
      e := (public._village_table('upgrade_exp'))[b.level] * case when b.type = 'hall' then public._village_const('hall_exp_mul')::int else 1 end;
    end if;
    update public.village_buildings set
      level = level + case when b.state = 'upgrading' then 1 else 0 end,
      state = 'done', last_collected_at = b.finish_at, finish_at = null, started_at = null
    where id = b.id;
    perform public._village_add_exp(p_user, e);
  end loop;
end $$;
revoke all on function public._village_settle(uuid, timestamptz) from public, anon, authenticated;

-- 건물 하나를 거둔다 (049 와 같고, 생산 건물의 쌓인 양은 _village_units 로 센다)
create or replace function public._village_collect(p_user uuid, p_id uuid, p_now timestamptz, p_cap bigint,
  out got bigint, out have bigint, out product text, out job_exp bigint, out is_job boolean)
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; ty record; rc record; u record; cur bigint; room bigint;
begin
  got := 0; have := 0; product := ''; job_exp := 0; is_job := false;
  select * into b from public.village_buildings where id = p_id and user_id = p_user for update;
  if not found then return; end if;
  if b.state = 'working' then
    select * into rc from public._village_recipes() r where r.type = b.type;
    if not found or b.finish_at is null or b.finish_at > p_now then return; end if;
    product := rc.out_res; have := b.job_n; is_job := true; job_exp := have * rc.exp;
    cur := public._village_res(p_user, product);
    room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;
    got := greatest(0, least(have, room));
    perform public._village_add(p_user, product, got);
    update public.village_buildings set state = 'done', finish_at = null, started_at = null, job_n = 0, last_collected_at = p_now where id = p_id;
    return;
  end if;
  if b.state <> 'done' then return; end if;
  select * into ty from public._village_types() t where t.type = b.type;
  if ty.product = '' then return; end if;
  select * into u from public._village_units(p_user, p_id, p_now);
  have := u.units;
  if have <= 0 then have := 0; return; end if;
  product := ty.product;
  cur := public._village_res(p_user, product);
  room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;
  got := greatest(0, least(have, room));
  perform public._village_add(p_user, product, got);
  -- 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다)
  update public.village_buildings set banked = 0,
    last_collected_at = least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))
  where id = p_id;
end $$;
revoke all on function public._village_collect(uuid, uuid, timestamptz, bigint) from public, anon, authenticated;

-- 화면에 보내는 마을 모양 (시각은 ms). sia = 공통 지갑의 시아코인 잔액
create or replace function public._village_state_json(p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'now', public._village_ms(p_now),
    'sia', coalesce((select w.sia_coins from public.wallets w where w.user_id = p_user), 0),
    'profile', jsonb_build_object(
      'name', p.village_name, 'level', p.level, 'exp', p.exp,
      'resources', jsonb_build_object('special', 0) || p.resources, 'landStage', p.land_stage,
      'prosperity', p.prosperity, 'goal', p.goal, 'goalProgress', p.goal_progress,
      'marketDay', p.market_day, 'marketSold', p.market_sold,
      'feastFrom', coalesce(public._village_ms(p.feast_from), 0), 'feastUntil', coalesce(public._village_ms(p.feast_until), 0), 'feastPct', p.feast_pct),
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'level', b.level, 'x', coalesce(b.x, 0), 'y', coalesce(b.y, 0), 'state', b.state,
        'finishAt', public._village_ms(b.finish_at), 'startAt', public._village_ms(b.started_at),
        'collectedAt', public._village_ms(b.last_collected_at), 'jobN', b.job_n, 'banked', b.banked) order by b.created_at, b.id)
      from public.village_buildings b where b.user_id = p_user), '[]'::jsonb))
  from public.village_profiles p where p.user_id = p_user
$$;
revoke all on function public._village_state_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------- 5. 화면이 부르는 함수 ----------

-- 짓기 (049 와 같고, 특별 건물은 일반 자원과 함께 시아코인을 낸다. 시아코인이 모자라면 'not enough coin')
create or replace function public.village_build(p_type text, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; ty record; lv int; cnt int; mx int; why text; new_id uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into ty from public._village_types() x where x.type = p_type;
  if not found then raise exception 'bad type'; end if;
  select level into lv from public.village_profiles where user_id = me;
  select count(*) into cnt from public.village_buildings where user_id = me and type = p_type;
  mx := case when ty.cap > 0 then case when lv >= ty.unlock[1] then ty.cap else 0 end
        else (select count(*) from unnest(ty.unlock) u where u <= lv)::int end;
  -- 아직 하나도 못 가지는 것은 'locked', 지금 레벨의 개수를 다 가졌으면 'limit'
  if cnt >= mx then raise exception '%', case when cnt = 0 then 'locked' else 'limit' end; end if;
  if ty.build_sec > 0 and not public._village_slot_free(me) then raise exception 'no slot'; end if;
  why := public._village_place_error(me, p_type, p_x, p_y, null);
  if why is not null then raise exception '%', why; end if;
  perform public._village_spend(me, ty.rice, ty.wood, ty.stone, ty.coin);
  -- 마을 줄을 잠근 채로 지갑 줄을 잠근다 (순서: 마을 → 지갑)
  if ty.sia > 0 then perform public._spend_sia_coin(me, ty.sia, 'village', 'special:' || p_type); end if;
  insert into public.village_buildings (user_id, type, x, y, state, started_at, finish_at, last_collected_at)
  values (me, p_type, p_x, p_y, 'building', t, t + make_interval(secs => ty.build_sec), t)
  returning id into new_id;
  -- 0초짜리(장식물 · 길)는 바로 끝난다
  perform public._village_settle(me, t);
  return public._village_state_json(me, t) || jsonb_build_object('id', new_id);
end $$;
revoke all on function public.village_build(text, int, int) from public, anon;
grant execute on function public.village_build(text, int, int) to authenticated;

-- 옮기기: 정자를 옮기면 모든 생산 건물의, 생산 건물을 옮기면 그 건물의 쌓인 양을 먼저 적어 둔다 (보너스가 바뀌므로)
create or replace function public.village_move(p_id uuid, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; why text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  if b.state = 'stored' then raise exception 'stored'; end if;
  why := public._village_place_error(me, b.type, p_x, p_y, b.id);
  if why is not null then raise exception '%', why; end if;
  if b.type = 'pavilion' then perform public._village_bank_all(me, t); else perform public._village_bank(me, b.id, t); end if;
  update public.village_buildings set x = p_x, y = p_y where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_move(uuid, int, int) from public, anon;
grant execute on function public.village_move(uuid, int, int) to authenticated;

-- 보관함에 넣기 (정자를 넣으면 모든 생산 건물의 쌓인 양을 먼저 적어 둔다)
create or replace function public.village_store(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  if b.type = 'hall' then raise exception 'cannot store'; end if;
  if b.state <> 'done' then raise exception '%', case when b.state = 'stored' then 'stored' else 'busy' end; end if;
  if b.type = 'pavilion' then perform public._village_bank_all(me, t); end if;
  perform public._village_collect(me, b.id, t, public._village_cap(me));
  update public.village_buildings set state = 'stored', x = null, y = null, banked = 0 where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_store(uuid) from public, anon;
grant execute on function public.village_store(uuid) to authenticated;

-- 보관함에서 꺼내 놓기 (정자를 놓으면 모든 생산 건물의 쌓인 양을 먼저 적어 둔다)
create or replace function public.village_place(p_id uuid, p_x int, p_y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; b public.village_buildings; why text;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into b from public.village_buildings where id = p_id and user_id = me for update;
  if not found then raise exception 'no building'; end if;
  if b.state <> 'stored' then raise exception 'not stored'; end if;
  why := public._village_place_error(me, b.type, p_x, p_y, b.id);
  if why is not null then raise exception '%', why; end if;
  if b.type = 'pavilion' then perform public._village_bank_all(me, t); end if;
  update public.village_buildings set state = 'done', x = p_x, y = p_y, last_collected_at = t, banked = 0 where id = b.id;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_place(uuid, int, int) from public, anon;
grant execute on function public.village_place(uuid, int, int) to authenticated;

-- 땅 넓히기: 다음 단계로 (시아코인 land_price, 마을 레벨 land_need). 건물 좌표는 그대로다 (땅은 한가운데에서 바깥으로 넓어진다)
create or replace function public.village_expand() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; p public.village_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into p from public.village_profiles where user_id = me;
  if p.land_stage >= 6 then raise exception 'max land'; end if;
  if p.level < (public._village_table('land_need'))[p.land_stage + 1] then raise exception 'village level'; end if;
  perform public._spend_sia_coin(me, (public._village_table('land_price'))[p.land_stage + 1], 'village', 'land:' || (p.land_stage + 1));
  update public.village_profiles set land_stage = p.land_stage + 1, updated_at = now() where user_id = me;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_expand() from public, anon;
grant execute on function public.village_expand() to authenticated;

-- 잔치 열기: 잔치 마당이 있고, 지금 잔치 중이 아니고, 떡 feast_cake 개가 있어야 한다. 하루 동안 마을 전체 생산이 늘어난다
create or replace function public.village_feast() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz; f public.village_buildings; p public.village_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  select * into f from public.village_buildings where user_id = me and type = 'feast' and state = 'done' limit 1;
  if not found then raise exception 'no feast'; end if;
  select * into p from public.village_profiles where user_id = me;
  if p.feast_until is not null and t < p.feast_until then raise exception 'feast active'; end if;
  if public._village_res(me, 'cake') < public._village_const('feast_cake') then raise exception 'not enough'; end if;
  -- 지난 잔치의 몫까지 쌓인 양을 적어 둔 다음에 새 잔치를 연다
  perform public._village_bank_all(me, t);
  perform public._village_add(me, 'cake', -public._village_const('feast_cake')::bigint);
  update public.village_profiles set feast_from = t, feast_until = t + make_interval(secs => public._village_const('feast_sec')::int),
    feast_pct = public._village_const('feast_pct')::int + public._village_const('feast_pct_per')::int * (f.level - 1), updated_at = now()
  where user_id = me;
  perform public._village_add_exp(me, public._village_const('feast_exp')::bigint);
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_feast() from public, anon;
grant execute on function public.village_feast() to authenticated;

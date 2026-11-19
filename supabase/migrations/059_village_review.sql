-- 059: 시아마을 검토 반영 (047 ~ 054 는 운영에 적용됨 — 고치지 않고 여기서 다시 정의한다)
--   1. 쌓이는 양의 상한: 옮기기 · 주민 배치처럼 생산량이 바뀔 때 쌓인 양을 적어 두면(banked) 마지막 수확 시각이 당겨져
--      12시간(개가 있으면 15시간)이 새로 쌓였다 (논 1레벨: 옮기지 않으면 720개, 12시간 뒤 옮기고 다시 12시간이면 1008개).
--      → 수확할 때만 바뀌는 "쌓기 시작한 시각"(acc_from)을 두고, 기본 생산 시간은 그 시각부터 cap_sec 까지로 자른다.
--        적어 둔 양(banked)은 그대로 두므로 합계는 "그 시각부터 cap 까지, 그때그때의 보너스를 넣은 양"을 넘지 않는다.
--        잔치 보너스도 이번에 쓴 시간(거둔 개수만큼의 시간) 안에서만 센다 (남은 몇 초를 다음에 또 세지 않게).
--      acc_from 은 banked > 0 일 때만 뜻이 있다 (banked 를 0 으로 비우는 곳 — 수확 · 보관 · 꺼내 놓기 — 에서는 저절로 버려진다).
--   2. 기념물 판정: 다른 게임의 표 · 함수가 하나라도 없으면 village_state 전체가 실패했다 → 하나씩 감싸 없으면 0 (잠김)
--   3. 관리자 엽전 · 시아코인 10,000: 화면이 1분마다 · 돌아올 때마다 village_state 를 불러 그때마다 10,000 으로 돌아갔다
--      → village_state(p_entry boolean default false): 게임에 들어올 때(p_entry = true) 한 번만 맞춘다
-- 같은 규칙: games/village/src/game/rules.ts

-- ---------- 1. 쌓기 시작한 시각 ----------

alter table public.village_buildings add column if not exists acc_from timestamptz;

-- 생산 건물에 지금 쌓여 있는 양 (state 가 'done' 인 생산 건물만 부른다). 050 과 같은 모양 (units · base · frm · rate)
--   st    = 쌓기 시작한 시각 (적어 둔 양이 있으면 acc_from, 없으면 마지막 수확 시각)
--   fin   = least(지금, st + cap_sec)                                                (이 뒤로는 쌓이지 않는다)
--   rate  = floor(기본 생산량 × rate_mul ÷ 10) × (100 + 보너스 %) ÷ 100              (시간당)
--   base  = floor((fin − 마지막 수확 시각)의 초 × rate ÷ 3600)
--   extra = floor(잔치와 겹친 초 × rate × 잔치 % ÷ 360000)                          (마지막 수확 시각 ~ fin)
--   units = least(banked + base + extra, floor(cap_sec × rate × (100 + bonus_room_pct) ÷ 360000))
--   frm   = 마지막 수확 시각 + (지금 − fin): 부르는 쪽이 frm + ceil(base × 3600 ÷ rate) 초를 다음 마지막 수확 시각으로 적는다
--           (상한에서 잘린 시간 fin ~ 지금은 버린다)
create or replace function public._village_units(p_user uuid, p_id uuid, p_now timestamptz,
  out units bigint, out base bigint, out frm timestamptz, out rate bigint)
language plpgsql stable security definer set search_path = public as $$
declare b public.village_buildings; ty record; p public.village_profiles; cap int; st timestamptz; fin timestamptz; over bigint; extra bigint;
begin
  select * into b from public.village_buildings where id = p_id and user_id = p_user;
  select * into ty from public._village_types() t where t.type = b.type;
  select * into p from public.village_profiles where user_id = p_user;
  cap := public._village_cap_sec(p_user);
  rate := (ty.rate * (public._village_table('rate_mul'))[b.level] / 10)::bigint * (100 + public._village_rate_pct(p_user, p_id)) / 100;
  st := public._village_acc_start(b.banked, b.acc_from, b.last_collected_at);
  fin := least(p_now, st + make_interval(secs => cap));
  base := greatest(0, floor(extract(epoch from (fin - b.last_collected_at)))::bigint) * rate / 3600;
  over := case when p.feast_from is null or p.feast_until is null then 0
          else greatest(0, floor(extract(epoch from (least(fin, p.feast_until) - greatest(b.last_collected_at, p.feast_from))))::bigint) end;
  extra := over * rate * p.feast_pct / 360000;
  units := least(b.banked + base + extra, cap::bigint * rate * (100 + public._village_const('bonus_room_pct')::int) / 360000);
  frm := b.last_collected_at + (p_now - fin);
end $$;
revoke all on function public._village_units(uuid, uuid, timestamptz) from public, anon, authenticated;

-- 쌓기 시작한 시각: 적어 둔 양이 있으면 그때 적어 둔 시작 시각, 없으면 마지막 수확 시각
create or replace function public._village_acc_start(p_banked bigint, p_acc timestamptz, p_last timestamptz) returns timestamptz
language sql immutable as $$
  select case when p_banked > 0 then coalesce(p_acc, p_last) else p_last end
$$;
revoke all on function public._village_acc_start(bigint, timestamptz, timestamptz) from public, anon, authenticated;

-- 쌓인 양을 건물에 적어 둔다 (생산량이 바뀌기 직전에 부른다). 쓴 만큼의 시간만 쓰고, 쌓기 시작한 시각은 그대로 둔다
create or replace function public._village_bank(p_user uuid, p_id uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare b public.village_buildings; u record;
begin
  select * into b from public.village_buildings where id = p_id and user_id = p_user for update;
  if not found or b.state <> 'done' or not exists (select 1 from public._village_types() t where t.type = b.type and t.product <> '') then return; end if;
  select * into u from public._village_units(p_user, p_id, p_now);
  update public.village_buildings set banked = u.units, acc_from = public._village_acc_start(b.banked, b.acc_from, b.last_collected_at),
    last_collected_at = least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))
  where id = p_id;
end $$;
revoke all on function public._village_bank(uuid, uuid, timestamptz) from public, anon, authenticated;

-- 건물 하나를 거둔다 (051 과 같고, 다 거두면 쌓기 시작한 시각을 지운다)
create or replace function public._village_collect(p_user uuid, p_id uuid, p_now timestamptz, p_cap bigint, p_bonus int,
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
  if u.units <= 0 then return; end if;
  have := u.units + u.units * coalesce(p_bonus, 0) / 100;
  product := ty.product;
  cur := public._village_res(p_user, product);
  room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;
  got := greatest(0, least(have, room));
  perform public._village_add(p_user, product, got);
  -- 거둔 만큼의 시간만 쓴다 (1개가 되다 만 시간은 남는다). 넘친 것은 버린다 (창고가 가득 차도 건물은 비워진다)
  update public.village_buildings set banked = 0, acc_from = null,
    last_collected_at = least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))
  where id = p_id;
end $$;
revoke all on function public._village_collect(uuid, uuid, timestamptz, bigint, int) from public, anon, authenticated;

-- 화면에 보내는 마을 모양 (053 과 같고, 건물에 쌓기 시작한 시각 accFrom 이 더해진다. 없으면 0)
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
        'collectedAt', public._village_ms(b.last_collected_at), 'jobN', b.job_n, 'banked', b.banked,
        'accFrom', case when b.banked > 0 then coalesce(public._village_ms(b.acc_from), 0) else 0 end) order by b.created_at, b.id)
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

-- ---------- 2. 다른 게임의 기록 읽기 (읽기만 한다) ----------

-- 053 과 같은 값. 다른 게임의 표 · 함수는 하나씩 감싼다: 없으면(아직 배포 전 · 이름이 바뀜) 그 기록만 0 (잠긴 채로)
create or replace function public._village_game_stats(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; maps text[] := array[]::text[]; def jsonb; m text; v int;
begin
  res := jsonb_build_object('tank_wins', 0, 'volley_wins', 0, 'race_plays', 0, 'surv_field', 0, 'surv_bamboo', 0, 'surv_palace', 0, 'surv_underworld', 0,
    'matgo_wins', 0, 'casino_wins', 0, 'def_3', 0, 'def_6', 0, 'def_9', 0, 'def_12', 0);
  begin
    res := res || jsonb_build_object('tank_wins', coalesce((select max(pp.wins) from public.player_points pp where pp.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('volley_wins', coalesce((select v.wins from public.volleyball_rankings v where v.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    res := res || jsonb_build_object('race_plays', coalesce((select r.plays from public.race_records r where r.user_id = p_user), 0));
  exception when undefined_table or undefined_column then null;
  end;
  begin
    select s.unlocked_maps into maps from public.survival_profiles s where s.user_id = p_user;
  exception when undefined_table or undefined_column then maps := null;
  end;
  maps := coalesce(maps, array[]::text[]);
  if to_regprocedure('public._survival_map_cleared(uuid, text, text[])') is not null then
    foreach m in array array['field', 'bamboo', 'palace', 'underworld'] loop
      begin
        execute 'select public._survival_map_cleared($1, $2, $3)::int' into v using p_user, m, maps;
        res := res || jsonb_build_object('surv_' || m, coalesce(v, 0));
      exception when undefined_table or undefined_column or undefined_function then null;
      end;
    end loop;
  end if;
  begin
    res := res || jsonb_build_object('matgo_wins', (exists (
      select 1 from public.wallet_logs l where l.user_id = p_user and l.reason = 'game' and l.amount > 0 and l.game_id like 'matgo:%'))::int);
  exception when undefined_table or undefined_column then null;
  end;
  -- 카지노: 포커 · 블랙잭 · 홀덤(지갑 기록) 또는 룰렛 (둘 중 있는 표만 본다)
  begin
    if exists (select 1 from public.wallet_logs l where l.user_id = p_user and l.reason = 'game' and l.amount > 0
               and (l.game_id like 'poker:%' or l.game_id like 'blackjack:%' or l.game_id like 'holdem:%')) then
      res := res || jsonb_build_object('casino_wins', 1);
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  begin
    if exists (select 1 from public.roulette_bets b where b.user_id = p_user and b.payout > b.total) then
      res := res || jsonb_build_object('casino_wins', 1);
    end if;
  exception when undefined_table or undefined_column then null;
  end;
  -- 시아디펜스 표는 아직 없을 수 있다 (없으면 잠긴 채로)
  if to_regclass('public.defense_stages') is not null then
    begin
      execute 'select jsonb_object_agg(''def_'' || g, (exists (select 1 from public.defense_stages d where d.user_id = $1 and d.stage_id = g || ''-5''))::int)
               from unnest(array[3, 6, 9, 12]) g' into def using p_user;
      res := res || coalesce(def, '{}'::jsonb);
    exception when undefined_table or undefined_column then null;
    end;
  end if;
  return res;
end $$;
revoke all on function public._village_game_stats(uuid) from public, anon, authenticated;

-- ---------- 3. 내 마을: 관리자는 게임에 들어올 때만 10,000 ----------

-- 053 과 같고, 관리자 계정의 엽전 · 시아코인 10,000 맞추기는 p_entry = true (화면이 게임에 처음 들어올 때 한 번)일 때만 한다.
-- 1분마다 · 화면으로 돌아올 때 · 다시 읽을 때는 p_entry = false (기본값). 잠금 순서는 마을 줄 → 지갑 줄
drop function if exists public.village_state();
create or replace function public.village_state(p_entry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._village_profile_row(me);
  t := clock_timestamp();
  perform public._village_settle(me, t);
  update public.village_profiles set last_seen_at = t where user_id = me;
  perform public._village_monument_sync(me, t);
  if coalesce(p_entry, false) and exists (select 1 from public.profiles where id = me and is_admin) then
    update public.village_profiles set resources = jsonb_set(resources, '{coin}', '10000'::jsonb) where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._village_state_json(me, t);
end $$;
revoke all on function public.village_state(boolean) from public, anon;
grant execute on function public.village_state(boolean) to authenticated;

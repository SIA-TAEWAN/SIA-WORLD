-- 104: 시아의탑 (games/tower, games/tower/PRD.md '서버 약속')
--   1인 탑뷰 액션 RPG. 전투는 기기에서 하고, 서버는 진행 상태(JSON)를 보관한다 (친목용 — 값 범위와 층 건너뛰기만 확인).
--   - tower_state()            내 상태 (처음이면 행을 만든다. 관리자는 엽전·시아코인 1만, 102 와 같은 방식)
--   - tower_set_look(p_look)   외형 정하기: 처음은 무료, 바꾸면 시아코인 30
--   - tower_save(p_data, p_cleared)  진행 저장. p_cleared = 방금 깬 층 → 최고 층 갱신 + 처음 깬 층마다 시아코인 1 (평생 한 번)
--   - tower_ranking 뷰         최고 층 → 레벨 → 먼저 달성한 순
--   표는 클라이언트가 직접 쓰지 않는다 (자기 행 읽기만 RLS 로 허용).

-- ---------- 1. 표 ----------
create table if not exists public.tower_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  look jsonb,                                   -- null = 아직 캐릭터를 만들지 않음
  data jsonb not null default '{}'::jsonb,      -- 클라이언트 진행 (레벨·경험치·엽전·구슬·조각·소지품·층 …)
  level int not null default 1 check (level between 1 and 99),
  best_floor int not null default 0 check (best_floor between 0 and 100),
  best_at timestamptz,
  look_changes int not null default 0 check (look_changes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tower_profiles enable row level security;
drop policy if exists tower_profiles_read_own on public.tower_profiles;
create policy tower_profiles_read_own on public.tower_profiles for select using (auth.uid() = user_id);
revoke all on public.tower_profiles from anon, authenticated;
grant select on public.tower_profiles to authenticated;

-- 외형 변경 값 (시아코인)
create or replace function public._tower_look_price() returns int language sql immutable as $$ select 30 $$;
revoke all on function public._tower_look_price() from public, anon, authenticated;

-- 외형이 맞는 모양인지: { sex: 'm'|'f', hair: 0~3, face: 0~3, outfit: 0~3 } 만
create or replace function public._tower_look_ok(p jsonb) returns boolean
language sql immutable as $$
  select p is not null and jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) = 4
    and p->>'sex' in ('m', 'f')
    and jsonb_typeof(p->'hair') = 'number' and (p->>'hair') in ('0', '1', '2', '3')
    and jsonb_typeof(p->'face') = 'number' and (p->>'face') in ('0', '1', '2', '3')
    and jsonb_typeof(p->'outfit') = 'number' and (p->>'outfit') in ('0', '1', '2', '3')
$$;
revoke all on function public._tower_look_ok(jsonb) from public, anon, authenticated;

create or replace function public._tower_row(p_user uuid) returns public.tower_profiles
language plpgsql security definer set search_path = public as $$
declare r public.tower_profiles;
begin
  insert into public.tower_profiles (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into r from public.tower_profiles where user_id = p_user;
  return r;
end $$;
revoke all on function public._tower_row(uuid) from public, anon, authenticated;

create or replace function public._tower_sia(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sia_coins from public.wallets where user_id = p_user), 0)
$$;
revoke all on function public._tower_sia(uuid) from public, anon, authenticated;

-- 숫자 칸 하나가 정수이고 범위 안인지 (칸이 없거나 숫자가 아니면 false)
create or replace function public._tower_int_ok(p jsonb, p_key text, p_min numeric, p_max numeric) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p->p_key) = 'number'
    then (p->>p_key)::numeric = trunc((p->>p_key)::numeric) and (p->>p_key)::numeric between p_min and p_max
    else false end
$$;
revoke all on function public._tower_int_ok(jsonb, text, numeric, numeric) from public, anon, authenticated;

-- ---------- 2. 내 상태 ----------
create or replace function public.tower_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  r := public._tower_row(me);
  perform public._ensure_wallet(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다 (102 와 같은 방식). 일반 사용자는 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    if jsonb_typeof(r.data) = 'object' and r.data ? 'coins' then
      update public.tower_profiles set data = jsonb_set(data, '{coins}', '10000'::jsonb) where user_id = me returning * into r;
    end if;
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return jsonb_build_object('look', r.look, 'data', r.data, 'bestFloor', r.best_floor,
    'siaCoins', public._tower_sia(me), 'lookPrice', public._tower_look_price());
end $$;
revoke all on function public.tower_state() from public, anon;
grant execute on function public.tower_state() to authenticated;

-- ---------- 3. 외형 ----------
create or replace function public.tower_set_look(p_look jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles; paid boolean := false;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if not public._tower_look_ok(p_look) then raise exception 'bad look'; end if;
  perform public._tower_row(me);
  perform public._ensure_wallet(me);
  -- 같은 사람이 동시에 두 번 눌러도 한 번만 빠지게 행을 잠근다
  select * into r from public.tower_profiles where user_id = me for update;
  if r.look is not null and r.look <> p_look then
    if public._tower_sia(me) < public._tower_look_price() then raise exception 'not enough sia coins'; end if;
    perform public._spend_sia_coin(me, public._tower_look_price(), 'tower', 'look:' || (r.look_changes + 1)::text);
    paid := true;
  end if;
  update public.tower_profiles set look = p_look, look_changes = look_changes + case when paid then 1 else 0 end, updated_at = now()
  where user_id = me;
  return jsonb_build_object('look', p_look, 'siaCoins', public._tower_sia(me), 'paid', paid);
end $$;
revoke all on function public.tower_set_look(jsonb) from public, anon;
grant execute on function public.tower_set_look(jsonb) to authenticated;

-- ---------- 4. 진행 저장 ----------
create or replace function public.tower_save(p_data jsonb, p_cleared int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles; best int; cp int; got boolean := false;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._tower_row(me);
  select * into r from public.tower_profiles where user_id = me for update;
  if r.look is null then raise exception 'no look'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 32768
    or not public._tower_int_ok(p_data, 'level', 1, 99)
    or not public._tower_int_ok(p_data, 'exp', 0, 1e12)
    or not public._tower_int_ok(p_data, 'coins', 0, 1e12)
    or not public._tower_int_ok(p_data, 'floor', 1, 100)
    or not public._tower_int_ok(p_data, 'checkpoint', 1, 91)
    or not public._tower_int_ok(p_data, 'best', 0, 100) then
    raise exception 'bad save';
  end if;
  -- 서버에 이미 더 높이 오른 기록이 있으면 예전 기기·못 보낸 옛 저장이다: 새 진행을 덮어쓰지 않게 거절
  if (p_data->>'best')::int < r.best_floor then raise exception 'old save'; end if;
  -- 층은 건너뛸 수 없다: 깰 수 있는 층은 지금까지 깬 최고 층 + 1 까지
  if p_cleared is not null and (p_cleared < 1 or p_cleared > 100 or p_cleared > r.best_floor + 1) then raise exception 'bad save'; end if;
  best := greatest(r.best_floor, coalesce(p_cleared, 0));
  cp := (p_data->>'checkpoint')::int;
  if (cp - 1) % 10 <> 0 or cp > best + 1 or (p_data->>'floor')::int > best + 1 then raise exception 'bad save'; end if;

  update public.tower_profiles set
    data = p_data,
    level = (p_data->>'level')::int,
    best_floor = best,
    best_at = case when best > r.best_floor then now() else best_at end,
    updated_at = now()
  where user_id = me;
  -- 시아코인: 층마다 평생 한 번 (예전에 15초·하루 한도로 못 받은 층은 다시 깨면 받는다. 한도는 _grant_sia_coin 안에서)
  if p_cleared is not null then
    got := public._grant_sia_coin(me, 'tower', 'floor:' || p_cleared::text);
  end if;
  return jsonb_build_object('bestFloor', best, 'gotCoin', got, 'siaCoins', public._tower_sia(me));
end $$;
revoke all on function public.tower_save(jsonb, int) from public, anon;
grant execute on function public.tower_save(jsonb, int) to authenticated;

-- ---------- 5. 랭킹 ----------
-- 최고 층 → 레벨 → 먼저 달성한 순. 1층이라도 깬 사람만
create or replace view public.tower_ranking as
  select r.user_id, p.nickname, r.best_floor, r.level, r.best_at as achieved_at,
    (row_number() over (order by r.best_floor desc, r.level desc, r.best_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.tower_profiles r join public.profiles p on p.id = r.user_id
  where r.best_floor > 0;
revoke all on public.tower_ranking from anon, authenticated;
grant select on public.tower_ranking to anon, authenticated;

-- ---------- 6. 게임 오픈 여부 ----------
-- 처음에는 닫힌 상태로 추가한다 (관리자만 보이고 들어갈 수 있다. 로비의 오픈 설정에서 연다)
insert into public.app_settings (key, value) values ('game_open:tower', 'false'::jsonb) on conflict (key) do nothing;

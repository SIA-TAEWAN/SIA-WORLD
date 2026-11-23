-- 092: 연속 출석 · 로비 공지 한 줄
--
-- 1) 연속 출석
--    wallets.attendance_streak = 마지막으로 출석을 받은 날까지 이어진 일수.
--    claim_attendance(): 어제도 받았으면 +1, 아니면 1 (날짜는 한국 시간).
--      · 가입한 날은 출석을 받은 것으로 치므로(017 _ensure_wallet) 1일째로 센다 → 다음 날이 2일째.
--      · 이 파일 전에 어제 출석한 사람(칸이 0)도 어제를 1일째로 쳐서 2일째가 된다.
--    보너스 시아코인: 3일째 1개, 7일째와 그 뒤 7일마다(14·21…) 3개.
--      · _grant_sia_coin 을 쓰지 않고 wallets.sia_coins 에 바로 더한다. sia_coin_logs 에 줄을 넣으면
--        그 줄이 '15초에 한 번'·'하루 100개' 확인에 잡혀서 바로 뒤의 게임 한 판 코인을 못 받기 때문이다
--        (050_village_coin.sql 이 쓴 기록을 따로 두는 것과 같은 까닭).
--      · 준 기록은 attendance_logs 에 남긴다 (하루 한 줄: 같은 날 두 번 받지 못하게 하는 두 번째 잠금이기도 하다).
--    _wallet_json 에 streak (지금 이어지고 있는 일수. 어제도 오늘도 안 받았으면 0).
--    claim_attendance 결과에 streak · siaBonus(이번에 받은 보너스 코인) 추가.
--
-- 2) 공지 한 줄
--    app_settings 의 'notice' = 글자(jsonb string, 100자까지. 빈 글자면 로비에서 숨긴다).
--    관리자만 set_app_setting('notice', '"…"') 으로 바꾼다. 읽기는 app_settings 를 누구나 (023).
--
-- 다시 정의하는 함수와 이전 최신 정의:
--   _wallet_json(public.wallets)      ← 033_sia_coin.sql
--   claim_attendance()                ← 017_wallets.sql
--   set_app_setting(text, jsonb)      ← 032_game_open.sql

-- ---------- 1. 표 ----------

alter table public.wallets add column if not exists attendance_streak int not null default 0 check (attendance_streak >= 0);

create table if not exists public.attendance_logs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  streak int not null,
  sia_bonus int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.attendance_logs enable row level security;
drop policy if exists attendance_logs_read_own on public.attendance_logs;
create policy attendance_logs_read_own on public.attendance_logs for select using (auth.uid() = user_id);
revoke all on public.attendance_logs from anon, authenticated;
grant select on public.attendance_logs to authenticated;

-- ---------- 2. 연속 출석 규칙 ----------

-- 그 연속 일수에 주는 보너스 시아코인 (shared/wallet.js 의 attendanceBonus 와 같다)
create or replace function public._attendance_bonus(p_streak int) returns int
language sql immutable as $$
  select case
    when p_streak is null or p_streak <= 0 then 0
    when p_streak % 7 = 0 then 3
    when p_streak = 3 then 1
    else 0 end
$$;
revoke all on function public._attendance_bonus(int) from public, anon, authenticated;

-- 화면에 돌려줄 지갑 정보 (033 과 같고 streak 추가)
create or replace function public._wallet_json(w public.wallets) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'chips', w.chips,
    'nyang', w.nyang,
    'siaCoins', w.sia_coins,
    'chipsRefillsLeft', case when w.refill_date = public._kst_today() then greatest(0, 3 - w.chips_refills_today) else 3 end,
    'nyangRefillsLeft', case when w.refill_date = public._kst_today() then greatest(0, 3 - w.nyang_refills_today) else 3 end,
    'streak', case when w.last_attendance_date >= public._kst_today() - 1 then greatest(w.attendance_streak, 1) else 0 end
  )
$$;

-- 출석 보너스: 오늘(한국 시간) 처음이면 칩·냥 각 +10,000, 연속 일수를 세고 3일째·7일마다 시아코인 보너스
-- → { granted: bool, siaBonus: int, streak, chips, nyang, siaCoins, ... }
create or replace function public.claim_attendance() returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.wallets; today date := public._kst_today(); got boolean := false; st int; bonus int := 0; n int;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  perform public._ensure_wallet(auth.uid());
  select * into w from public.wallets where user_id = auth.uid() for update;
  if w.last_attendance_date is distinct from today then
    st := case when w.last_attendance_date = today - 1 then greatest(w.attendance_streak, 1) + 1 else 1 end;
    insert into public.attendance_logs (user_id, day, streak, sia_bonus)
    values (auth.uid(), today, st, public._attendance_bonus(st))
    on conflict do nothing;
    get diagnostics n = row_count;
    -- 오늘 줄이 이미 있으면(있을 수 없지만) 보너스 코인은 다시 주지 않는다
    if n > 0 then bonus := public._attendance_bonus(st); end if;
    update public.wallets set chips = chips + 10000, nyang = nyang + 10000, sia_coins = sia_coins + bonus,
      last_attendance_date = today, attendance_streak = st
    where user_id = auth.uid() returning * into w;
    insert into public.wallet_logs (user_id, currency, amount, reason)
    values (auth.uid(), 'chips', 10000, 'attendance'), (auth.uid(), 'nyang', 10000, 'attendance');
    got := true;
  end if;
  return public._wallet_json(w) || jsonb_build_object('granted', got, 'siaBonus', bonus);
end $$;
revoke all on function public.claim_attendance() from public, anon;
grant execute on function public.claim_attendance() to authenticated;

-- ---------- 3. 공지 한 줄 ----------

insert into public.app_settings (key, value) values ('notice', '""'::jsonb) on conflict (key) do nothing;

-- 032 와 같고 'notice' 추가
create or replace function public.set_app_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; t text;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'not admin'; end if;
  if p_key = 'tank_lobby_max' then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'bad value'; end if;
    n := (p_value #>> '{}')::numeric::int;
    if n < 2 or n > 200 then raise exception 'bad value'; end if;
    p_value := to_jsonb(n);
  elsif p_key ~ '^game_open:[a-z0-9_-]{1,24}$' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'bad value'; end if;
  elsif p_key = 'notice' then
    if jsonb_typeof(p_value) <> 'string' then raise exception 'bad value'; end if;
    -- 한 줄: 줄바꿈·탭·이어진 빈칸은 빈칸 하나로, 앞뒤 빈칸은 뗀다. 100자까지 (넘으면 거절)
    t := btrim(regexp_replace(p_value #>> '{}', '\s+', ' ', 'g'));
    if char_length(t) > 100 then raise exception 'too long'; end if;
    p_value := to_jsonb(t);
  else
    raise exception 'unknown setting';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return p_value;
end $$;
revoke all on function public.set_app_setting(text, jsonb) from public, anon;
grant execute on function public.set_app_setting(text, jsonb) to authenticated;

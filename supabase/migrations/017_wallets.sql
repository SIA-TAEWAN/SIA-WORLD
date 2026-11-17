-- SIA WORLD 017: 지갑 (카지노 칩 · 맞고 냥), 출석 보너스, 무료 충전, 랭킹
-- 칩·냥은 서버 함수만 바꿀 수 있다 (클라이언트는 자기 지갑 읽기만).
-- 날짜는 한국 시간 자정 기준.

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  chips bigint not null default 10000 check (chips >= 0),
  nyang bigint not null default 10000 check (nyang >= 0),
  chips_refills_today int not null default 0,
  nyang_refills_today int not null default 0,
  refill_date date,
  last_attendance_date date,
  created_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "wallet_read_own" on public.wallets;
create policy "wallet_read_own" on public.wallets for select using (auth.uid() = user_id);
-- insert/update/delete 정책 없음 + 권한 회수: 아래 security definer 함수와 Edge Function(service role)만 바꾼다
revoke insert, update, delete on public.wallets from anon, authenticated;

create table if not exists public.wallet_logs (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  currency text not null check (currency in ('chips', 'nyang')),
  amount bigint not null,
  reason text not null check (reason in ('start', 'attendance', 'refill', 'game')),
  game_id text,
  created_at timestamptz not null default now()
);
create index if not exists wallet_logs_user_idx on public.wallet_logs (user_id, created_at desc);
alter table public.wallet_logs enable row level security;
drop policy if exists "wlog_read_own" on public.wallet_logs;
create policy "wlog_read_own" on public.wallet_logs for select using (auth.uid() = user_id);
revoke insert, update, delete on public.wallet_logs from anon, authenticated;

-- 한국 시간 오늘
create or replace function public._kst_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 지갑이 없으면 만든다 (10,000칩 · 10,000냥). 가입한 날은 출석 보너스를 이미 받은 것으로 친다
-- (처음 들어오면 10,000 / 다음 날부터 출석 +10,000)
create or replace function public._ensure_wallet(p_user uuid) returns public.wallets
language plpgsql security definer set search_path = public as $$
declare w public.wallets; n int;
begin
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'need login'; end if;
  insert into public.wallets (user_id, last_attendance_date, refill_date)
  values (p_user, public._kst_today(), public._kst_today())
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.wallet_logs (user_id, currency, amount, reason)
    values (p_user, 'chips', 10000, 'start'), (p_user, 'nyang', 10000, 'start');
  end if;
  select * into w from public.wallets where user_id = p_user;
  return w;
end $$;
revoke all on function public._ensure_wallet(uuid) from public, anon, authenticated;

-- 화면에 돌려줄 지갑 정보 (오늘 남은 충전 횟수 포함)
create or replace function public._wallet_json(w public.wallets) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'chips', w.chips,
    'nyang', w.nyang,
    'chipsRefillsLeft', case when w.refill_date = public._kst_today() then greatest(0, 3 - w.chips_refills_today) else 3 end,
    'nyangRefillsLeft', case when w.refill_date = public._kst_today() then greatest(0, 3 - w.nyang_refills_today) else 3 end
  )
$$;

-- 로비 진입 시: 지갑 확인/생성
create or replace function public.ensure_wallet() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  return public._wallet_json(public._ensure_wallet(auth.uid()));
end $$;

-- 출석 보너스: 오늘(한국 시간) 처음이면 칩·냥 각 +10,000
-- → { granted: bool, chips, nyang, ... }
create or replace function public.claim_attendance() returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.wallets; today date := public._kst_today(); got boolean := false;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  perform public._ensure_wallet(auth.uid());
  select * into w from public.wallets where user_id = auth.uid() for update;
  if w.last_attendance_date is distinct from today then
    update public.wallets set chips = chips + 10000, nyang = nyang + 10000, last_attendance_date = today
    where user_id = auth.uid() returning * into w;
    insert into public.wallet_logs (user_id, currency, amount, reason)
    values (auth.uid(), 'chips', 10000, 'attendance'), (auth.uid(), 'nyang', 10000, 'attendance');
    got := true;
  end if;
  return public._wallet_json(w) || jsonb_build_object('granted', got);
end $$;

-- 무료 충전: 하루 3번(화폐마다), 10,000으로 채운다.
-- p_min_required = 들어가려는 방의 최소 입장 금액(기본 단위 ×50: 5,000 / 25,000 / 50,000)
-- 잔액이 최소 입장 금액보다 적고, 채워서 늘어날 때(10,000 미만)만 충전된다.
-- → { ok: bool, reason?: 'enough'|'limit', chips, nyang, ... }
create or replace function public.refill(p_currency text, p_min_required bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.wallets; today date := public._kst_today(); bal bigint; used int; added bigint;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  if p_currency not in ('chips', 'nyang') then raise exception 'bad currency'; end if;
  if p_min_required not in (5000, 25000, 50000) then raise exception 'bad min'; end if;
  perform public._ensure_wallet(auth.uid());
  select * into w from public.wallets where user_id = auth.uid() for update;
  -- 날짜가 바뀌었으면 횟수 초기화
  if w.refill_date is distinct from today then
    update public.wallets set chips_refills_today = 0, nyang_refills_today = 0, refill_date = today
    where user_id = auth.uid() returning * into w;
  end if;
  bal := case when p_currency = 'chips' then w.chips else w.nyang end;
  used := case when p_currency = 'chips' then w.chips_refills_today else w.nyang_refills_today end;
  if bal >= p_min_required or bal >= 10000 then
    return public._wallet_json(w) || jsonb_build_object('ok', false, 'reason', 'enough');
  end if;
  if used >= 3 then
    return public._wallet_json(w) || jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  added := 10000 - bal;
  if p_currency = 'chips' then
    update public.wallets set chips = 10000, chips_refills_today = chips_refills_today + 1 where user_id = auth.uid() returning * into w;
  else
    update public.wallets set nyang = 10000, nyang_refills_today = nyang_refills_today + 1 where user_id = auth.uid() returning * into w;
  end if;
  insert into public.wallet_logs (user_id, currency, amount, reason) values (auth.uid(), p_currency, added, 'refill');
  return public._wallet_json(w) || jsonb_build_object('ok', true);
end $$;

revoke all on function public.ensure_wallet() from public, anon;
revoke all on function public.claim_attendance() from public, anon;
revoke all on function public.refill(text, bigint) from public, anon;
grant execute on function public.ensure_wallet() to authenticated;
grant execute on function public.claim_attendance() to authenticated;
grant execute on function public.refill(text, bigint) to authenticated;

-- 랭킹: 닉네임과 보유량만 공개 (지갑 테이블 자체는 본인만 읽음). AI는 지갑이 없어서 빠진다
create or replace view public.casino_ranking as
  select w.user_id, p.nickname, w.chips as amount
  from public.wallets w join public.profiles p on p.id = w.user_id
  order by w.chips desc;
create or replace view public.matgo_ranking as
  select w.user_id, p.nickname, w.nyang as amount
  from public.wallets w join public.profiles p on p.id = w.user_id
  order by w.nyang desc;
revoke all on public.casino_ranking, public.matgo_ranking from anon, authenticated;
grant select on public.casino_ranking, public.matgo_ranking to anon, authenticated;

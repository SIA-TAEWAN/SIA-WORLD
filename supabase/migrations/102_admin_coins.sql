-- 102: 관리자 계정(profiles.is_admin, 시험용)은 시아돌격대 · 시아핑거 · 시아열두길에 들어올 때마다 엽전과 시아코인이 10,000 으로 맞춰진다
--   디펜스(048 defense_profile) · 서바이벌(055 survival_profile) · 마을(099 village_state) 과 같은 방식이다.
--   다시 정의하는 함수와 그 앞의 마지막 정의 (함수 전체를 그대로 옮기고 관리자 갈래만 더한다. 권한 · security definer · search_path 도 같다):
--     charge_profile()   061_charge.sql   — charge_profiles.coins
--     finger_profile()   067_finger.sql   — finger_profiles.coins
--     twelve_state()     078_twelve.sql   — twelve_profiles.coins
--   관리자 갈래는 화면에 주는 JSON 을 읽기 바로 앞에 있어, 들어오자마자 10,000 이 보인다.
--   일반 사용자는 영향이 없고, 바꾸는 것은 엽전 열과 지갑의 시아코인뿐이다 (별 · 기록 · 랭킹 · 진행 · 강화석 등은 그대로).
--   표는 만들지 않는다 (함수만). 여러 번 실행해도 안전하다.

-- ---------- 1. 시아돌격대 프로필 (061 그대로, 관리자 갈래만) ----------
create or replace function public.charge_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다. 일반 사용자는 영향이 없고, 별·기록·랭킹에도 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    perform public._charge_profile_row(me);
    update public.charge_profiles set coins = 10000 where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._charge_profile_json(me);
end $$;
revoke all on function public.charge_profile() from public, anon;
grant execute on function public.charge_profile() to authenticated;

-- ---------- 2. 시아핑거 프로필 (067 그대로, 관리자 갈래만) ----------
create or replace function public.finger_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다. 일반 사용자는 영향이 없고, 별·기록·랭킹에도 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    perform public._finger_profile_row(me);
    update public.finger_profiles set coins = 10000 where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._finger_profile_json(me);
end $$;
revoke all on function public.finger_profile() from public, anon;
grant execute on function public.finger_profile() to authenticated;

-- ---------- 3. 시아열두길 내 상태 (078 그대로, 관리자 갈래만) ----------
-- 내 상태 읽기 (처음이면 프로필을 만든다)
create or replace function public.twelve_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다. 일반 사용자는 영향이 없고, 레벨·장비·기록·랭킹에도 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    update public.twelve_profiles set coins = 10000 where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_state() from public, anon;
grant execute on function public.twelve_state() to authenticated;

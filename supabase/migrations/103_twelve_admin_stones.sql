-- 103: 시아열두길 관리자 계정(profiles.is_admin, 시험용)은 들어올 때마다 강화석도 10,000 으로 맞춰진다
--   102 는 엽전(twelve_profiles.coins)과 시아코인(wallets.sia_coins)만 맞췄다. 장비 강화를 시험하려면 강화석도 넉넉해야 해서 더한다.
--   강화석은 twelve_profiles.stones (078: int not null default 0 check (stones >= 0)) 이고, _twelve_state_json 이 'stones' 로 돌려준다.
--   다시 정의하는 함수와 그 앞의 마지막 정의: twelve_state()  102_admin_coins.sql
--   102 의 함수를 그대로 옮기고 관리자 갈래의 update 에 stones = 10000 만 더한다. 권한 · security definer · search_path 도 같다.
--   일반 사용자는 영향이 없다 (레벨 · 장비 · 기록 · 랭킹도 그대로). 표는 만들지 않는다 (함수만). 여러 번 실행해도 안전하다.

-- ---------- 시아열두길 내 상태 (102 그대로, 관리자 갈래에 강화석만) ----------
-- 내 상태 읽기 (처음이면 프로필을 만든다)
create or replace function public.twelve_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  perform public._twelve_profile_row(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전 · 강화석 · 시아코인을 1만으로 맞춘다. 일반 사용자는 영향이 없고, 레벨·장비·기록·랭킹에도 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    update public.twelve_profiles set coins = 10000, stones = 10000 where user_id = me;
    perform public._ensure_wallet(me);
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return public._twelve_state_json(me);
end $$;
revoke all on function public.twelve_state() from public, anon;
grant execute on function public.twelve_state() to authenticated;

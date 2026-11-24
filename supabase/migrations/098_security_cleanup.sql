-- 098: 2026-11-24 전체검사 반영 (보안 정리)
--
-- 1. 안 쓰는 옛 시아탱크 계정 함수(009: sign_up · sign_in · check_session)의 실행 권한을 거둔다.
--    015 통합 로그인 뒤로 클라이언트도 다른 SQL 함수도 부르지 않는다 (anon 이 옛 accounts 에 가입 줄을 쌓을 수 있었다).
--    기록 이어받기(check_legacy · claim_legacy_records)는 그대로 쓴다.
-- 2. profiles: 누구나(anon 포함) 모든 사람의 login_id · is_admin 을 읽을 수 있던 것을 막는다.
--    읽을 수 있는 열은 id · nickname · created_at 만 (랭킹의 profiles(nickname) 끼워 읽기 · 닉네임 중복 확인).
--    · 아이디 중복 확인은 login_id_taken(p_login) (anon · authenticated)
--    · 내 정보(login_id · nickname · is_admin)는 my_profile() (authenticated)
--    랭킹 뷰는 소유자(postgres) 권한으로 profiles 를 읽어서 영향이 없고, profiles 를 읽는 SQL 함수는 모두 security definer 다.
-- 3. 옛 시아탱크 테이블 rooms · player_points · target_scores 에 남아 있던 쓰기 권한(insert · update · delete · truncate · references · trigger)을 거둔다.
--    읽기(select)는 그대로 (시아탱크 랭킹). 쓰기는 전부 security definer 함수가 한다.
-- 4. 순수 계산 헬퍼(_kst_today · _race_const · _roulette_hit · _roulette_payout · _seat_count · _zodiac · _zodiac_name)의 public 실행 권한을 거둔다.
--    부르는 쪽은 모두 security definer 함수(또는 그 함수만 부르는 헬퍼: _wallet_json · _roulette_payout)라 소유자 권한으로 부른다.
--    뷰 · RLS 정책 · 기본값 · 제약에서는 쓰지 않는다.
--
-- 이 파일이 다시 정의하는 것: 없음 (새 함수 login_id_taken · my_profile 만 만든다)

-- ---------- 1. 옛 계정 함수 ----------

revoke all on function public.sign_up(text, text) from public, anon, authenticated;
revoke all on function public.sign_in(text, text) from public, anon, authenticated;
revoke all on function public.check_session(text, uuid) from public, anon, authenticated;

-- ---------- 2. profiles 열 권한 ----------

create or replace function public.login_id_taken(p_login text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where login_id = lower(trim(coalesce(p_login, ''))));
$$;
revoke all on function public.login_id_taken(text) from public, anon, authenticated;
grant execute on function public.login_id_taken(text) to anon, authenticated;

-- 로그인하지 않았거나 profiles 줄이 없으면 null
create or replace function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('login_id', p.login_id, 'nickname', p.nickname, 'is_admin', p.is_admin)
  from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.my_profile() from public, anon, authenticated;
grant execute on function public.my_profile() to authenticated;

revoke select on public.profiles from anon, authenticated;
grant select (id, nickname, created_at) on public.profiles to anon, authenticated;

-- ---------- 3. 옛 시아탱크 테이블 쓰기 권한 ----------

revoke insert, update, delete, truncate, references, trigger on public.rooms, public.player_points, public.target_scores from anon, authenticated;

-- ---------- 4. 순수 계산 헬퍼 ----------

revoke all on function public._kst_today() from public, anon, authenticated;
revoke all on function public._race_const(text) from public, anon, authenticated;
revoke all on function public._roulette_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public._roulette_payout(jsonb, integer) from public, anon, authenticated;
revoke all on function public._seat_count(text) from public, anon, authenticated;
revoke all on function public._zodiac() from public, anon, authenticated;
revoke all on function public._zodiac_name(text) from public, anon, authenticated;

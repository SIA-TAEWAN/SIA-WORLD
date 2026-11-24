-- 097: 2026-11-23 전체검사 반영 (SQL)
--
-- 1. 시아열두길 레벨 랭킹(twelve_level_ranking)의 region 을 '지금 와 있는 지형' 으로 바로잡는다.
--    078 은 그 모드에서 깬 맵 가운데 가장 큰 지형 번호였다 (2-1 만 깨도 2지형, 1-8 을 깨고 2지형을 아직 못 깼으면 1지형).
--    이제는 화면의 지형 열림 규칙(_twelve_region_open: 앞 지형 보스 N-8 을 깨면 N+1 이 열린다)과 같게:
--    그 모드에서 깬 N-8 가운데 가장 큰 N 의 다음 지형, 하나도 없으면 1, 12 가 상한.
--    나머지 열·순서·조건·권한은 078 과 같다 (094 는 이 뷰를 다시 정의하지 않았다).
-- 2. _wallet_json(public.wallets) 의 실행 권한을 거둔다. 부르는 쪽(get_wallet · claim_attendance · refill_*)은
--    모두 security definer 라 소유자 권한으로 부른다.
--
-- 이 파일이 다시 정의하는 것 (이전 정의):
--   view public.twelve_level_ranking  ← 078_twelve.sql

create or replace view public.twelve_level_ranking as
  select r.user_id, p.nickname, r.level, r.exp, r.mode, r.hero,
    least(12, coalesce((select max(split_part(m.map_id, '-', 1)::int) from public.twelve_maps m
      where m.user_id = r.user_id and m.mode = r.mode and m.clears > 0 and m.map_id ~ '^[0-9]+-8$'), 0) + 1) as region,
    exists (select 1 from public.twelve_maps m where m.user_id = r.user_id and m.mode = 'hard' and m.map_id = 'final') as hard_done,
    r.level_at as achieved_at,
    (row_number() over (order by r.level desc, r.exp desc, r.level_at asc, r.user_id))::int as place,
    (count(*) over ())::int as total
  from public.twelve_profiles r join public.profiles p on p.id = r.user_id
  where r.cleared_maps > 0;
revoke all on public.twelve_level_ranking from anon, authenticated;
grant select on public.twelve_level_ranking to anon, authenticated;

revoke all on function public._wallet_json(public.wallets) from public, anon, authenticated;

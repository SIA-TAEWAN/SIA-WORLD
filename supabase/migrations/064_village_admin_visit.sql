-- 064: 시아마을 관리자 마을 구경 — 063 에서 관리자 계정을 번영도 랭킹에서 뺐으므로, 랭킹 창에서 따로 구경 갈 수 있게 목록을 내준다
--   · village_admin_villages: 관리자 계정의 마을 (랭킹과 같은 칸, 순위 번호는 없다). 구경 · 칭찬은 village_visit · village_praise 그대로
create or replace view public.village_admin_villages as
  select v.user_id, p.nickname, v.village_name, v.level, v.prosperity
  from public.village_profiles v join public.profiles p on p.id = v.user_id
  where coalesce(p.is_admin, false);
revoke all on public.village_admin_villages from anon, authenticated;
grant select on public.village_admin_villages to authenticated;

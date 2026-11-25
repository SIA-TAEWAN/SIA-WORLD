-- 105: 시아의탑 관리자 엽전 — 처음 들어올 때도 1만
--   104 의 tower_state() 는 data 에 coins 칸이 이미 있을 때만 1만으로 맞춰서, 관리자가 처음 들어오면(data = {}) 첫 저장 전까지 엽전 0 으로 보였다.
--   이제 data 가 객체이면 coins 칸이 없어도 1만을 넣는다 (jsonb_set 의 create_missing). 클라이언트 normalize 도 레벨이 없는 처음 상태에서 coins 를 이어받는다.
--   나머지(행 만들기 · 지갑 · 시아코인 1만 · 돌려주는 값)는 104 와 똑같다.

create or replace function public.tower_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.tower_profiles;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  r := public._tower_row(me);
  perform public._ensure_wallet(me);
  -- 관리자 계정(시험용): 들어올 때마다 엽전과 시아코인을 1만으로 맞춘다 (102 와 같은 방식). 일반 사용자는 영향이 없다
  if exists (select 1 from public.profiles where id = me and is_admin) then
    if jsonb_typeof(r.data) = 'object' then
      update public.tower_profiles set data = jsonb_set(data, '{coins}', '10000'::jsonb, true) where user_id = me returning * into r;
    end if;
    update public.wallets set sia_coins = 10000 where user_id = me;
  end if;
  return jsonb_build_object('look', r.look, 'data', r.data, 'bestFloor', r.best_floor,
    'siaCoins', public._tower_sia(me), 'lookPrice', public._tower_look_price());
end $$;
revoke all on function public.tower_state() from public, anon;
grant execute on function public.tower_state() to authenticated;

-- 075: 시아돌격대에 고양이(cat) 대장 추가 (071_characters.sql 의 _check_character 를 쓴다)
--   · _charge_leaders(): cat 줄 추가. unlock_region -1 = 지역으로 열리지 않는 추가 캐릭터 (games/charge/src/data/balance.ts 의 LEADERS)
--   · _charge_unlocked(): 진행으로 열리는 십이지만 (unlock_region >= 0). 고양이는 들어가지 않는다 → 결과의 newLeaders 에도 안 나온다
--   · charge_start(): 대장 검사를 _check_character 로 먼저 하고, 십이지는 그대로 진행 잠금을 본다.
--     고양이는 진행 잠금 대신 _check_character(me, id, 'charge') 에만 맡긴다: 이 게임의 대장 고르기 화면에서 시아코인으로 연다 (게임마다 따로, 071)
--   charge_finish 는 그대로 (_charge_leaders 의 coin_mul 을 읽기만 한다: cat 은 1)
--   · _cat_progress_charge(): 고양이 구매 조건 = 3-5 클리어 (071 buy_character · character_progress 가 부른다)

create or replace function public._charge_leaders() returns table (id text, unlock_region int, coin_mul numeric)
language sql immutable as $$
  select * from (values
    ('rat', 0, 1),
    ('ox', 0, 1),
    ('tiger', 0, 1),
    ('rabbit', 1, 1),
    ('dragon', 2, 1),
    ('snake', 3, 1),
    ('horse', 4, 1),
    ('sheep', 5, 1),
    ('monkey', 6, 1),
    ('rooster', 7, 1),
    ('dog', 8, 1),
    ('pig', 9, 1.1),
    ('cat', -1, 1)
  ) as t(id, unlock_region, coin_mul)
$$;
revoke all on function public._charge_leaders() from public, anon, authenticated;

-- 진행으로 열린 대장 (처음 3종 + 여는 지역의 5번째를 클리어한 대장). 추가 캐릭터(unlock_region < 0)는 빼고
create or replace function public._charge_unlocked(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.id order by l.ord), array[]::text[]) from (
    select t.id, row_number() over () as ord, t.unlock_region from public._charge_leaders() t
  ) l
  where l.unlock_region = 0 or (l.unlock_region > 0 and public._charge_cleared(p_user, l.unlock_region::text || '-5'))
$$;
revoke all on function public._charge_unlocked(uuid) from public, anon, authenticated;

create or replace function public.charge_start(p_stage text, p_leader text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid; extra boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'endless') then raise exception 'bad mode'; end if;
  if p_leader is null or not exists (select 1 from public._charge_leaders() l where l.id = p_leader) then raise exception 'bad leader'; end if;
  perform public._check_character(me, p_leader, 'charge');
  select l.unlock_region < 0 into extra from public._charge_leaders() l where l.id = p_leader;
  if not extra and not (p_leader = any(public._charge_unlocked(me))) then raise exception 'leader locked'; end if;
  if p_mode = 'endless' then
    if p_stage is distinct from 'endless' then raise exception 'bad stage'; end if;
    if not public._charge_cleared(me, '1-5') then raise exception 'endless locked'; end if;
  else
    if p_stage is null or not exists (select 1 from public._charge_stages() t where t.stage_id = p_stage) then raise exception 'bad stage'; end if;
    if not public._charge_stage_open(me, p_stage) then raise exception 'stage locked'; end if;
  end if;
  perform public._charge_profile_row(me);
  insert into public.charge_runs (user_id, stage_id, leader, mode) values (me, p_stage, p_leader, p_mode) returning id into rid;
  return rid;
end $$;
revoke all on function public.charge_start(text, text, text) from public, anon;
grant execute on function public.charge_start(text, text, text) to authenticated;

-- 고양이 구매 조건 (071 의 _character_progress 가 부른다): 3-5 스테이지 클리어 → {have 1/0, need 1}
-- 조건 스테이지는 games/charge/src/game/progress.ts 의 CAT_STAGE 와 같다 (tests/sql.test.ts 가 대조)
create or replace function public._cat_progress_charge(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('have', case when public._charge_cleared(p_user, '3-5') then 1 else 0 end, 'need', 1)
$$;
revoke all on function public._cat_progress_charge(uuid) from public, anon, authenticated;

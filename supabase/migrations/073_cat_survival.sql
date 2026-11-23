-- 073: 시아서바이벌에 고양이(cat, "13번째 대원")
--   · survival_start: 캐릭터 검사를 071 의 _check_character 로 바꾼다 (십이지 12 + cat).
--     고양이는 시아서바이벌의 해금 목록(unlocked_characters)에 들어가지 않는다: 엽전으로도(survival_unlock_character 의 값 표에 없다),
--     판 결과로도(survival_finish 의 해금 목록은 그대로) 풀리지 않고, 로비에서 시아코인으로 연다 (_check_character 가 본다).
--   · 나머지(판 끝 검증 상수·해금 조건·기록)는 055 그대로. 고양이 특성(피해를 일정 간격마다 한 번 피함)은 처치·레벨·엽전 상한에 닿지 않는다.
--   055 의 정의를 그대로 옮기고 위 두 줄만 바꿨다.

create or replace function public.survival_start(p_map text, p_character text, p_mode text default 'normal') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.survival_profiles; rid uuid;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_map is null or not exists (select 1 from public._survival_maps() m where m.map_id = p_map) then raise exception 'bad map'; end if;
  -- 071: 고를 수 있는 캐릭터인지는 공용 함수가 본다 (모르는 id 면 'bad character'. 로비에서 여는 캐릭터의 잠금도 여기서)
  perform public._check_character(me, p_character);
  if p_mode is null or p_mode not in ('normal', 'endless', 'hell') then raise exception 'bad mode'; end if;
  pr := public._survival_profile_row(me);
  if not (p_map = any(pr.unlocked_maps)) then raise exception 'map locked'; end if;
  -- 십이지는 시아서바이벌의 해금 목록으로 본다. 고양이(cat)는 이 목록에 들어가지 않는다 (로비에서 열고, 위의 _check_character 가 본다)
  if p_character <> 'cat' and not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;
  -- 무한 모드는 그 맵을 4분 모드로 클리어했어야 열린다 (클리어 기록이 있거나 다음 맵이 열려 있다)
  if p_mode = 'endless' and not public._survival_map_cleared(me, p_map, pr.unlocked_maps) then
    raise exception 'endless locked';
  end if;
  -- 헬 모드도 같은 조건: **그 맵을** 4분 모드로 클리어했어야 열린다 (다른 맵을 깬 것으로는 열리지 않는다)
  if p_mode = 'hell' and not public._survival_map_cleared(me, p_map, pr.unlocked_maps) then
    raise exception 'hell locked';
  end if;
  -- 끝나지 않은 이전 판은 지우지 않는다: 통신이 끊겨 결과를 못 보낸 판을 나중에 다시 보낼 수 있다.
  -- (여러 판을 겹쳐 여는 것은 survival_finish 가 막는다.) 너무 오래됐거나 많이 쌓인 것만 치운다.
  delete from public.survival_runs
    where user_id = me and created_at is null and started_at < clock_timestamp() - make_interval(secs => public._survival_const('max_age')::int);
  delete from public.survival_runs where id in (
    select id from public.survival_runs where user_id = me and created_at is null
    order by started_at desc offset (public._survival_const('open_runs')::int - 1));
  -- 끝난 판은 30일 뒤에 지운다
  delete from public.survival_runs where user_id = me and created_at < clock_timestamp() - interval '30 days';
  insert into public.survival_runs (user_id, map_id, character, mode, started_at) values (me, p_map, p_character, p_mode, clock_timestamp()) returning id into rid;
  return rid;
end $$;
revoke all on function public.survival_start(text, text, text) from public, anon;
grant execute on function public.survival_start(text, text, text) to authenticated;

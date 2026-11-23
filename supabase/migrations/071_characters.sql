-- 071: 추가 캐릭터 (고양이 cat, "13번째 대원")
--   · _character_ids(): 카드 게임 밖에서 고를 수 있는 캐릭터 = 십이지 12 + cat (shared/characters.js 의 ALL_CHARACTER_IDS 와 같게)
--   · _check_character(user, character): 게임 시작·캐릭터 목록 검사에서 부른다. 모르는 id 면 'bad character'
--     (각 게임 RPC 의 "p_character not in ('rat', … ,'pig')" 줄을 이 함수로 바꾼다: 072~ 게임별 마이그레이션)

create or replace function public._character_ids() returns text[]
language sql immutable as $$
  select array['rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig','cat']::text[]
$$;
revoke all on function public._character_ids() from public, anon, authenticated;

create or replace function public._check_character(p_user uuid, p_character text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_character is null or not (p_character = any(public._character_ids())) then raise exception 'bad character'; end if;
end $$;
revoke all on function public._check_character(uuid, text) from public, anon, authenticated;

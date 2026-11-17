-- 시아탱크 007: 탱크 '랜덤' 선택 허용 (게임 시작 때 정해진다)
create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
begin
  if char_length(coalesce(p->>'id', '')) not between 4 and 64 then raise exception 'bad id'; end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 10 then raise exception 'bad name'; end if;
  if coalesce(p->>'tank', '') not in ('rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'zodiac', 'random') then
    raise exception 'bad tank';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 3 then raise exception 'bad items'; end if;
  if exists (select 1 from jsonb_array_elements_text(items) i where i not in ('double', 'power', 'repair', 'teleport')) then
    raise exception 'bad item';
  end if;
  return jsonb_build_object(
    'id', p->>'id', 'name', p->>'name', 'tank', p->>'tank',
    'team', case when (p->>'team') = '1' then 1 else 0 end,
    'items', items,
    'ready', coalesce((p->>'ready')::boolean, false));
end $$;

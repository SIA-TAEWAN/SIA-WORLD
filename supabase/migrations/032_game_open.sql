-- 032: 게임 오픈 여부 (관리자가 로비에서 켜고 끈다)
--   app_settings 의 'game_open:<게임 ID>' = true | false
--   닫힌 게임은 로비에 보이지 않고 주소로 들어와도 막힌다 (관리자는 닫혀 있어도 들어갈 수 있다).
--   들어올 때만 확인하므로, 닫기 전에 이미 들어와 있던 사람은 그대로 한다.
-- 줄이 없는 게임은 shared/games.js 의 open 값(기본)을 따른다.

insert into public.app_settings (key, value) values
  ('game_open:tank', 'true'::jsonb),
  ('game_open:matgo', 'true'::jsonb),
  ('game_open:casino', 'true'::jsonb),
  ('game_open:race', 'true'::jsonb),
  ('game_open:volleyball', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_app_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'need login'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then raise exception 'not admin'; end if;
  if p_key = 'tank_lobby_max' then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'bad value'; end if;
    n := (p_value #>> '{}')::numeric::int;
    if n < 2 or n > 200 then raise exception 'bad value'; end if;
    p_value := to_jsonb(n);
  elsif p_key ~ '^game_open:[a-z0-9_-]{1,24}$' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'bad value'; end if;
  else
    raise exception 'unknown setting';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return p_value;
end $$;
revoke all on function public.set_app_setting(text, jsonb) from public, anon;
grant execute on function public.set_app_setting(text, jsonb) to authenticated;

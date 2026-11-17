-- 023: 운영 설정 (관리자가 화면에서 바꾼다)
--   tank_lobby_max: 시아탱크 대기실 하나의 최대 동시 접속 인원 (기본 30, 2~200)
-- 누구나 읽을 수 있고, 바꾸기는 관리자(profiles.is_admin)만 set_app_setting()으로.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;

insert into public.app_settings (key, value) values ('tank_lobby_max', '30'::jsonb) on conflict (key) do nothing;

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
  else
    raise exception 'unknown setting';
  end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return p_value;
end $$;
revoke all on function public.set_app_setting(text, jsonb) from public, anon;
grant execute on function public.set_app_setting(text, jsonb) to authenticated;

-- 037: 동시 접속 막기 (한 계정은 한 기기·브라우저에서만) + 시아탱크 정원 30명
--   로그인할 때 그 브라우저가 새 표식(token)을 올린다 → 나중에 로그인한 쪽이 이긴다.
--   먼저 들어와 있던 쪽은 자기 표식이 바뀐 것을 보고(10초마다 · 화면으로 돌아올 때) 스스로 로그아웃한다.
--   같은 브라우저의 여러 탭은 표식을 같이 쓰므로 그대로 쓸 수 있다.

create table if not exists public.user_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid not null,
  updated_at timestamptz not null default now()
);
alter table public.user_sessions enable row level security;
drop policy if exists user_sessions_read_own on public.user_sessions;
create policy user_sessions_read_own on public.user_sessions for select using (auth.uid() = user_id);
revoke all on public.user_sessions from anon, authenticated;
grant select on public.user_sessions to authenticated;

-- 이 브라우저를 내 계정의 '지금 접속한 곳'으로 올린다 (다른 곳은 곧 로그아웃된다)
create or replace function public.claim_session(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_token is null then raise exception 'bad token'; end if;
  insert into public.user_sessions (user_id, token, updated_at) values (auth.uid(), p_token, now())
  on conflict (user_id) do update set token = excluded.token, updated_at = now();
end $$;
revoke all on function public.claim_session(uuid) from public, anon;
grant execute on function public.claim_session(uuid) to authenticated;

-- 시아탱크 대기실 정원도 다른 게임과 같이 30명 (관리자가 화면에서 다시 바꿀 수 있다)
update public.app_settings set value = '30'::jsonb, updated_at = now() where key = 'tank_lobby_max';

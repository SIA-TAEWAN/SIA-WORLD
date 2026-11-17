-- 시아탱크 009: 회원가입 / 로그인 (ID + 비밀번호)
-- 비밀번호는 bcrypt 해시로만 저장하고, 로그인하면 받은 토큰으로 게임방에 들어간다.
-- 가입한 ID는 토큰 없이 게임방에 들어갈 수 없다 (남의 ID로 포인트를 쓰거나 바꾸지 못하게).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.accounts (
  name text primary key check (char_length(name) between 2 and 10),
  pw_hash text not null,
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_login timestamptz not null default now()
);
-- 아무도 직접 읽거나 쓰지 못한다 (아래 함수로만)
alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;

create or replace function public.sign_up(p_name text, p_pw text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare tok uuid;
begin
  p_name := trim(coalesce(p_name, ''));
  if char_length(p_name) not between 2 and 10 then raise exception 'bad id'; end if;
  if char_length(coalesce(p_pw, '')) not between 4 and 40 then raise exception 'bad password'; end if;
  if exists (select 1 from public.accounts where name = p_name) then raise exception 'id taken'; end if;
  insert into public.accounts (name, pw_hash) values (p_name, crypt(p_pw, gen_salt('bf', 8))) returning token into tok;
  return tok;
end $$;

create or replace function public.sign_in(p_name text, p_pw text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare a public.accounts;
begin
  select * into a from public.accounts where name = trim(coalesce(p_name, ''));
  if not found or a.pw_hash <> crypt(coalesce(p_pw, ''), a.pw_hash) then
    perform pg_sleep(0.3); -- 무작정 대입하기 어렵게
    raise exception 'wrong login';
  end if;
  update public.accounts set last_login = now() where name = a.name;
  return a.token;
end $$;

create or replace function public.check_session(p_name text, p_token uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts where name = p_name and token = p_token);
$$;

-- 게임방 입장·정보 변경 때 토큰 확인 (토큰은 방 정보에 저장하지 않는다)
create or replace function public._valid_player(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  items jsonb := coalesce(p->'items', '[]'::jsonb);
begin
  if char_length(coalesce(p->>'id', '')) not between 4 and 64 then raise exception 'bad id'; end if;
  if char_length(coalesce(p->>'name', '')) not between 2 and 10 then raise exception 'bad name'; end if;
  if not exists (select 1 from public.accounts a where a.name = p->>'name' and a.token::text = coalesce(p->>'token', '')) then
    raise exception 'need login';
  end if;
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

revoke all on function public._valid_player(jsonb) from public, anon, authenticated;
grant execute on function public.sign_up(text, text) to anon, authenticated;
grant execute on function public.sign_in(text, text) to anon, authenticated;
grant execute on function public.check_session(text, uuid) to anon, authenticated;

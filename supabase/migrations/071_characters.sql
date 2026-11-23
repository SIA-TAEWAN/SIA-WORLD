-- 071: 추가 캐릭터 (고양이 cat, "13번째 대원") — 시아코인으로 계정마다 한 번 열면 모든 게임에서 쓴다
--   · _character_ids(): 카드 게임 밖에서 고를 수 있는 캐릭터 = 십이지 12 + cat (shared/characters.js 의 ALL_CHARACTER_IDS 와 같게)
--   · _character_price(id): 시아코인으로 여는 캐릭터의 값. 십이지는 null (처음부터 있다). 값을 바꿀 때는 여기와
--     shared/characters.js 의 CHARACTER_PRICE 를 같이 바꾼다 (games/survival/tests/sql.test.ts 가 대조한다)
--   · owned_characters: 연 캐릭터 기록 (계정 단위, 모든 게임 공용)
--   · buy_character(id): 잔액 확인 후 차감 (_spend_sia_coin, 050) + 기록. 이미 있으면 다시 빼지 않는다
--   · my_characters(): 내가 연 캐릭터 id 목록
--   · _check_character(user, character): 게임 시작·캐릭터 목록 검사에서 부른다 (072~077).
--       모르는 id → 'bad character', 값이 있는 캐릭터를 안 열었으면 → 'locked character'

-- ---------- 1. 목록 · 값 ----------

create or replace function public._character_ids() returns text[]
language sql immutable as $$
  select array['rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig','cat']::text[]
$$;
revoke all on function public._character_ids() from public, anon, authenticated;

create or replace function public._character_price(p_id text) returns int
language sql immutable as $$
  select case p_id
    when 'cat' then 300
    else null
  end
$$;
revoke all on function public._character_price(text) from public, anon, authenticated;

-- ---------- 2. 연 캐릭터 기록 ----------

create table if not exists public.owned_characters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_id text not null,
  price int not null check (price >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, character_id)
);
alter table public.owned_characters enable row level security;
drop policy if exists owned_characters_read_own on public.owned_characters;
create policy owned_characters_read_own on public.owned_characters for select using (auth.uid() = user_id);
revoke all on public.owned_characters from anon, authenticated;
grant select on public.owned_characters to authenticated;

-- ---------- 3. 검사 (안에서만) ----------

create or replace function public._check_character(p_user uuid, p_character text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_character is null or not (p_character = any(public._character_ids())) then raise exception 'bad character'; end if;
  if public._character_price(p_character) is not null
     and not exists (select 1 from public.owned_characters where user_id = p_user and character_id = p_character) then
    raise exception 'locked character';
  end if;
end $$;
revoke all on function public._check_character(uuid, text) from public, anon, authenticated;

-- ---------- 4. 사기 · 내 목록 ----------

-- → { ok: true, siaCoins } | { ok: false, reason: 'owned' | 'coin', siaCoins, price }
create or replace function public.buy_character(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  price int := public._character_price(p_id);
  bal bigint;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if price is null then raise exception 'bad character'; end if;
  perform public._ensure_wallet(me);
  -- 지갑 줄을 먼저 잠가서 같은 사람이 동시에 두 번 눌러도 한 번만 빠진다
  select sia_coins into bal from public.wallets where user_id = me for update;
  if exists (select 1 from public.owned_characters where user_id = me and character_id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'owned', 'siaCoins', bal, 'price', price);
  end if;
  if bal < price then
    return jsonb_build_object('ok', false, 'reason', 'coin', 'siaCoins', bal, 'price', price);
  end if;
  perform public._spend_sia_coin(me, price, 'character', p_id);
  insert into public.owned_characters (user_id, character_id, price) values (me, p_id, price);
  return jsonb_build_object('ok', true, 'siaCoins', bal - price, 'price', price);
end $$;
revoke all on function public.buy_character(text) from public, anon;
grant execute on function public.buy_character(text) to authenticated;

create or replace function public.my_characters() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(character_id order by created_at), '{}'::text[]) from public.owned_characters where user_id = auth.uid()
$$;
revoke all on function public.my_characters() from public, anon;
grant execute on function public.my_characters() to authenticated;

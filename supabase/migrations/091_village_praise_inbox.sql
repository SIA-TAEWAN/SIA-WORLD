-- 091: 시아마을 — 받은 칭찬 알림과 답방
--   · village_profiles.praise_seen_at: 받은 칭찬을 마지막으로 본 시각 (기기를 바꿔도 같은 알림이 다시 뜨지 않게 서버에 둔다).
--     이미 있는 마을은 이 파일이 들어가는 때로 채워진다 → 예전에 받은 칭찬이 한꺼번에 "새 칭찬"으로 뜨지 않는다 (목록에는 나온다)
--   · village_praise_inbox(): 내가 받은 칭찬 최근 20개를 준 사람의 닉네임 · 마을 이름과 함께.
--     village_praises 는 본인 줄만 읽을 수 있고(052 RLS) 닉네임은 profiles 에 있어서, security definer 함수가 묶어서 준다 — 내가 받은 것만
--     답: { now, seenAt, fresh(새로 받은 수), freshUsers(새로 칭찬한 사람 수), rows: [{ userId, nickname, name, at, fresh }] }
--   · village_praise_seen(p_at): "다 봤음". p_at = 목록을 받았을 때의 서버 시각(inbox 의 now, ms) — 목록을 받은 뒤에 온 칭찬은 새 것으로 남는다.
--     뒤로는 가지 않고, 서버의 지금보다 앞설 수도 없다. p_at 이 없거나 이상하면 지금
--   아무것도 다시 정의하지 않는다 (새 칸 하나 · 새 인덱스 하나 · 새 함수 둘)

alter table public.village_profiles add column if not exists praise_seen_at timestamptz not null default now();
create index if not exists village_praises_to_at_idx on public.village_praises (to_user_id, created_at desc);

create or replace function public.village_praise_inbox() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz := clock_timestamp(); seen timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 아직 마을이 없으면 받은 칭찬도 없다 (마을은 village_state 가 만든다)
  select praise_seen_at into seen from public.village_profiles where user_id = me;
  if not found then seen := t; end if;
  return jsonb_build_object(
    'now', public._village_ms(t),
    'seenAt', public._village_ms(seen),
    'fresh', (select count(*) from public.village_praises x where x.to_user_id = me and x.created_at > seen)::int,
    'freshUsers', (select count(distinct x.from_user_id) from public.village_praises x where x.to_user_id = me and x.created_at > seen)::int,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', r.from_user_id, 'nickname', r.nickname, 'name', r.village_name,
        'at', public._village_ms(r.created_at), 'fresh', r.created_at > seen) order by r.created_at desc, r.from_user_id)
      from (
        select x.from_user_id, x.created_at, p.nickname, v.village_name
        from public.village_praises x
          join public.village_profiles v on v.user_id = x.from_user_id
          join public.profiles p on p.id = x.from_user_id
        where x.to_user_id = me
        order by x.created_at desc, x.from_user_id
        limit 20) r), '[]'::jsonb));
end $$;
revoke all on function public.village_praise_inbox() from public, anon;
grant execute on function public.village_praise_inbox() to authenticated;

create or replace function public.village_praise_seen(p_at double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t timestamptz := clock_timestamp(); want timestamptz; seen timestamptz;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  -- 화면이 받은 시각은 ms 로 내림한 값이라 1ms 를 더해 그 ms 안의 칭찬까지 본 것으로 친다
  want := case when p_at is null or not (p_at >= 0 and p_at <= 1e14) then t else least(t, to_timestamp((floor(p_at) + 1) / 1000.0)) end;
  update public.village_profiles set praise_seen_at = greatest(praise_seen_at, want) where user_id = me returning praise_seen_at into seen;
  return jsonb_build_object('now', public._village_ms(t), 'seenAt', public._village_ms(coalesce(seen, t)));
end $$;
revoke all on function public.village_praise_seen(double precision) from public, anon;
grant execute on function public.village_praise_seen(double precision) to authenticated;

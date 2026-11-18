-- 030: race_go 빈도 제한을 방 기준 → 부른 사람 기준으로 (다른 사람이 남의 방 GO를 'too soon'으로 막지 못하게)
create index if not exists race_rounds_creator_idx on public.race_rounds (created_by, created_at);

create or replace function public.race_go(p_room_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; last_at timestamptz; t timestamptz := clock_timestamp(); r_at timestamptz; g_at timestamptz;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'need login'; end if;
  if p_room_key is null or p_room_key !~ '^[a-z0-9]{4,24}$' then raise exception 'bad room'; end if;
  -- 같은 방의 요청은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtext('race:' || p_room_key));
  -- 오래된 판 정리 (기록 올릴 시간이 지난 것)
  delete from public.race_rounds where created_at < t - interval '1 hour';
  -- 너무 자주 부르지 못하게: 같은 사람 기준 (방 기준이면 남이 다른 방의 GO를 계속 막을 수 있다)
  select max(created_at) into last_at from public.race_rounds where created_by = auth.uid();
  if last_at is not null and last_at > t - make_interval(secs => public._race_const('gap_ms') / 1000.0) then raise exception 'too soon'; end if;
  select max(round) into n from public.race_rounds where room_key = p_room_key;
  n := coalesce(n, 0) + 1;
  r_at := t + make_interval(secs => public._race_const('lead_ms') / 1000.0);
  g_at := r_at + make_interval(secs => 1 + random() * 2);
  insert into public.race_rounds (room_key, round, ready_at, go_at, created_by, created_at) values (p_room_key, n, r_at, g_at, auth.uid(), t);
  return jsonb_build_object(
    'round', n,
    'ready_at', round(extract(epoch from r_at) * 1000),
    'go_at', round(extract(epoch from g_at) * 1000),
    'now', round(extract(epoch from clock_timestamp()) * 1000));
end $$;

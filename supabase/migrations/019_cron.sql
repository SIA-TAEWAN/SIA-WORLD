-- SIA WORLD 019: 턴 시간 초과 처리 + 방 정리 (pg_cron + pg_net)
-- 5초마다 SQL로만 확인하고, 마감이 지난 방이 있을 때만 Edge Function(game-timeout)을 부른다.
-- (Edge Function 호출 수를 아끼기 위해: 무료 플랜 월 50만 회)

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 서버끼리만 쓰는 설정값 (클라이언트 접근 불가)
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
-- game-timeout 호출 확인용 비밀값: DB 안에서만 만들어지고, Edge Function은 service role로 읽어서 비교한다
insert into public.app_config (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;
insert into public.app_config (key, value) values ('functions_url', 'https://ssbopykmgqrjrrtfespm.supabase.co/functions/v1')
on conflict (key) do update set value = excluded.value;

create or replace function public.cron_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare due jsonb; sec text; url text;
begin
  perform public.sweep_rooms();
  -- 마감이 지난 진행 중인 방 (그 시점의 상태 버전과 함께 → 그 사이 누가 두었으면 game-timeout이 건너뛴다)
  select jsonb_agg(jsonb_build_object('id', gs.room_id, 'version', d.version)) into due
  from public.game_states gs
  join public.game_rooms r on r.id = gs.room_id
  join public.game_decks d on d.room_id = gs.room_id
  where r.status = 'playing' and gs.turn_deadline is not null and gs.turn_deadline <= now();
  if due is null then return; end if;
  -- 처리하는 동안 같은 방을 또 보내지 않도록 마감을 잠깐 미룬다 (처리되면 새 마감으로 바뀐다)
  update public.game_states set turn_deadline = now() + interval '15 seconds'
  where room_id in (select (x->>'id')::uuid from jsonb_array_elements(due) x);
  select value into sec from public.app_config where key = 'cron_secret';
  select value into url from public.app_config where key = 'functions_url';
  perform net.http_post(
    url := url || '/game-timeout',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', sec),
    body := jsonb_build_object('rooms', due)
  );
end $$;
revoke all on function public.cron_tick() from public, anon, authenticated;

-- 같은 이름이면 새 일정으로 바뀐다
select cron.schedule('sia-world-tick', '5 seconds', 'select public.cron_tick()');

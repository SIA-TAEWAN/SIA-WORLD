-- 시아핑거: 스테이지별 최소 턴 기록 + 친구 1등 표시
--   finger_stages.best_turns (067·070 이 이미 저장) 를 스테이지 목록 · 결과 화면에 "내 최소 12턴 · 1등 ○○ 10턴" 으로 보여 준다.
--   finger_stages 는 본인 줄만 읽을 수 있어서(RLS), 남의 기록은 security definer 읽기 함수로만 준다 (닉네임과 턴 수뿐).
--   동점은 먼저 달성한 사람: 최소 턴을 줄인 때를 best_at 에 남긴다 (finger_finish_verified 는 고치지 않고 트리거로).

-- ---------- 1. 최소 턴을 달성한 때 ----------
alter table public.finger_stages add column if not exists best_at timestamptz;
update public.finger_stages set best_at = cleared_at where best_at is null;
alter table public.finger_stages alter column best_at set default now();
alter table public.finger_stages alter column best_at set not null;

-- 최소 턴이 줄어든 때에만 best_at 을 새로 적는다 (같은 턴으로 다시 깨면 그대로 → 먼저 달성한 사람이 앞)
create or replace function public._finger_stage_best_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.best_turns < old.best_turns then new.best_at := now();
  else new.best_at := old.best_at;
  end if;
  return new;
end;
$$;
revoke all on function public._finger_stage_best_at() from public, anon, authenticated;

drop trigger if exists finger_stage_best_at on public.finger_stages;
create trigger finger_stage_best_at before update on public.finger_stages
  for each row execute function public._finger_stage_best_at();

-- 스테이지별 1등 찾기 (stage_id 로 묶어 턴 → 달성한 때 순)
create index if not exists finger_stages_best_idx on public.finger_stages (stage_id, best_turns, best_at);

-- ---------- 2. 읽기: 모든 스테이지의 내 최소 턴 + 1등 ----------
-- 기록이 하나라도 있는 스테이지만 한 줄씩. my_turns 는 내가 아직 못 깬 스테이지면 null.
-- 1등: 턴이 적은 순 → 먼저 달성한 순 → user_id (결정적).
create or replace function public.finger_stage_bests()
returns table (stage_id text, my_turns int, top_turns int, top_nickname text, top_is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'need login'; end if;
  return query
    select t.stage_id,
      (select m.best_turns from public.finger_stages m where m.user_id = me and m.stage_id = t.stage_id),
      t.best_turns, t.nickname, t.user_id = me
    from (
      select distinct on (s.stage_id) s.stage_id, s.best_turns, s.user_id, p.nickname
      from public.finger_stages s join public.profiles p on p.id = s.user_id
      order by s.stage_id, s.best_turns asc, s.best_at asc, s.user_id
    ) t;
end;
$$;
revoke all on function public.finger_stage_bests() from public, anon;
grant execute on function public.finger_stage_bests() to authenticated;

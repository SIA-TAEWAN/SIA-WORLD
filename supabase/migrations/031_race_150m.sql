-- 031: 시아레이스 트랙 100m → 150m (그냥 달리면 약 30초)
--   기록 검증 기준을 새 길이에 맞추고, 100m 때의 기록은 길이가 달라 비교할 수 없으므로 지운다.
create or replace function public._race_const(p_name text) returns int
language sql immutable as $$
  select case p_name
    when 'min_ms' then 28000        -- 이보다 빠른 기록은 없다 (150m: 그냥 달리면 30.2초)
    when 'max_ms' then 90000        -- 출발 90초 뒤에는 경기가 끝난다
    when 'early_ms' then 400        -- 기기 시계 오차: 기록이 (지금 - GO)보다 이만큼까지는 커도 된다
    when 'late_ms' then 6000        -- 도착 뒤 이 시간 안에 올려야 한다 (통신 지연)
    when 'lead_ms' then 1200        -- GO 요청부터 '준비' 표시까지 (모든 기기에 전달될 시간)
    when 'gap_ms' then 4000         -- 같은 방에서 다음 판을 열 수 있는 최소 간격
  end
$$;

delete from public.race_runs;
delete from public.race_records;
alter table public.race_records drop constraint if exists race_records_best_ms_check;
alter table public.race_records add constraint race_records_best_ms_check check (best_ms >= 28000);

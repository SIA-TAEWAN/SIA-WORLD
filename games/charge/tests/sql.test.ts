import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { METER, RUN_SPEED } from '../src/data/balance';
import { leaderRows, stageRows, upgradeRows } from '../src/data/sqlrows';
import { ENDLESS_SEG } from '../src/data/stages';
import { CAT_STAGE, LIMITS } from '../src/game/progress';

/**
 * 서버(061_charge.sql)의 표와 기준 값이 게임 데이터와 같은지 확인한다.
 * 다르면 npm run sqlrows 로 줄을 만들어 새 마이그레이션에 넣는다 (이미 올라간 파일은 고치지 않는다).
 */
const mig = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const sql = mig('061_charge.sql');
/** 함수를 다시 정의한 뒤 마이그레이션 (뒤 파일이 이긴다). 함수를 다시 정의하는 파일을 더하면 여기에 넣는다 */
const LATER = ['075_cat_charge.sql', '085_charge_daily.sql', '088_charge_daily_day.sql', '101_overlap_village_fix.sql'].map(mig);
const block = (fn: string) => {
  const src = [...LATER].reverse().find((t) => t.includes(`function public.${fn}(`)) ?? sql;
  const i = src.indexOf(`function public.${fn}(`);
  return src.slice(i, src.indexOf('$$;', i));
};
const rowsIn = (fn: string) => block(fn).split('\n').map((l) => l.trim().replace(/,$/, '')).filter((l) => l.startsWith("('"));

describe('SQL 표', () => {
  it('스테이지 60줄이 같다', () => expect(rowsIn('_charge_stages')).toEqual(stageRows()));
  it('강화가 같다', () => expect(rowsIn('_charge_upgrades')).toEqual(upgradeRows()));
  it('대장이 같다', () => expect(rowsIn('_charge_leaders')).toEqual(leaderRows()));

  it('검증 기준 값이 같다', () => {
    const c = (name: string) => Number(block('_charge_const').match(new RegExp(`when '${name}' then ([0-9.]+)`))?.[1]);
    expect(c('max_time')).toBe(LIMITS.maxTime);
    expect(c('endless_max_time')).toBe(LIMITS.endlessMaxTime);
    expect(c('clear_min_time')).toBe(LIMITS.clearMinTime);
    expect(c('time_slack')).toBe(LIMITS.timeSlack);
    expect(c('max_troops')).toBe(LIMITS.maxTroops);
    expect(c('coin_min_time')).toBe(LIMITS.coinMinTime);
    expect(c('run_speed')).toBe(RUN_SPEED);
    expect(c('meter')).toBe(METER);
    expect(c('endless_seg')).toBe(ENDLESS_SEG);
  });

  it('엽전 식이 growth.ts 와 같다 (최신 charge_finish · _charge_region_open)', () => {
    const fin = block('charge_finish');
    expect(fin).toContain('raw := 15 + 5 * st.region + 5 * n_stars + (case when first then 20 + 10 * st.region else 0 end);');
    expect(fin).toContain('raw := floor((15 + 5 * st.region) * 0.3 * least(1, greatest(0, p_progress)));');
    expect(fin).toContain('raw := floor(p_meters / 20.0) + 5 * p_bosses;');
    expect(fin).toContain('crate := least(p_crate, round(st.crate_coins * 1.2));');
    expect(fin).toContain("coin_mul := 1 + 0.05 * least(5, greatest(0, coalesce((pr.upgrades ->> 'coin')::int, 0)));");
    expect(block('_charge_region_open')).toContain('(p_region - 1) * 9');
  });

  it('판 끝 겹침은 두 판의 최소 판 시간이 실제로 겹칠 때만 (101 — 보관했다 늦게 보낸 판을 거절하지 않는다)', () => {
    const fin = block('charge_finish').replace(/\r\n/g, '\n');
    expect(LATER[LATER.length - 1]).toContain('create or replace function public.charge_finish(');
    expect(fin).toContain("if elapsed < p_time - public._charge_const('time_slack') then raise exception 'too early'; end if;");
    expect(fin).not.toContain("o.finished_at > rn.started_at + interval '2 seconds'");
    expect(fin).toContain("(o.started_at > rn.started_at\n          and rn.started_at + make_interval(secs => p_time - public._charge_const('time_slack')) > o.started_at)");
    expect(fin).toContain("or (o.started_at <= rn.started_at\n          and o.started_at + make_interval(secs => coalesce(o.time, 0) - public._charge_const('time_slack')) > rn.started_at)");
  });

  it('charge_finish 101 은 088 을 그대로 옮기고 겹침 조건과 그 주석만 다르다 (권한 줄까지 같다)', () => {
    const fnOf = (f: string) => {
      const t = mig(f).replace(/\r\n/g, '\n');
      const i = t.indexOf('create or replace function public.charge_finish(');
      const end = 'grant execute on function public.charge_finish(uuid, int, boolean, int, int, numeric, int, int, int) to authenticated;';
      const fn = t.slice(i, t.indexOf(end, i) + end.length);
      const a = fn.indexOf("  if elapsed > public._charge_const('max_age')");
      const b = fn.indexOf("  ) then raise exception 'overlap'; end if;");
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(a);
      return fn.slice(0, a) + fn.slice(b);
    };
    expect(fnOf('101_overlap_village_fix.sql')).toBe(fnOf('088_charge_daily_day.sql'));
    expect(fnOf('101_overlap_village_fix.sql')).toContain('language plpgsql security definer set search_path = public as $$');
    expect(fnOf('101_overlap_village_fix.sql')).toContain('revoke all on function public.charge_finish(uuid, int, boolean, int, int, numeric, int, int, int) from public, anon;');
  });

  it('대장 검사는 공용 _check_character 를 쓴다 (075)', () => {
    expect(block('charge_start')).toContain("perform public._check_character(me, p_leader, 'charge');");
  });

  it('고양이 구매 조건(_cat_progress_charge)이 CAT_STAGE 클리어', () => {
    const f = block('_cat_progress_charge');
    expect(f).toContain(`public._charge_cleared(p_user, '${CAT_STAGE}')`);
    expect(f).toContain("'need', 1");
  });

  it('게임 오픈 여부는 닫힌 채로 추가', () => expect(sql).toContain("('game_open:charge', 'false'::jsonb)"));
});

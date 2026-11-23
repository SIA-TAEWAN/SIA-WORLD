import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { METER, RUN_SPEED } from '../src/data/balance';
import { leaderRows, stageRows, upgradeRows } from '../src/data/sqlrows';
import { ENDLESS_SEG } from '../src/data/stages';
import { LIMITS } from '../src/game/progress';

/**
 * 서버(061_charge.sql)의 표와 기준 값이 게임 데이터와 같은지 확인한다.
 * 다르면 npm run sqlrows 로 줄을 만들어 새 마이그레이션에 넣는다 (이미 올라간 파일은 고치지 않는다).
 */
const mig = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const sql = mig('061_charge.sql');
/** 함수를 다시 정의한 뒤 마이그레이션 (뒤 파일이 이긴다). 함수를 다시 정의하는 파일을 더하면 여기에 넣는다 */
const LATER = ['076_cat_charge.sql'].map(mig);
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

  it('엽전 식이 growth.ts 와 같다', () => {
    expect(sql).toContain('raw := 15 + 5 * st.region + 5 * n_stars + (case when first then 20 + 10 * st.region else 0 end);');
    expect(sql).toContain('raw := floor((15 + 5 * st.region) * 0.3 * least(1, greatest(0, p_progress)));');
    expect(sql).toContain('raw := floor(p_meters / 20.0) + 5 * p_bosses;');
    expect(sql).toContain('crate := least(p_crate, round(st.crate_coins * 1.2));');
    expect(sql).toContain("coin_mul := 1 + 0.05 * least(5, greatest(0, coalesce((pr.upgrades ->> 'coin')::int, 0)));");
    expect(sql).toContain('(p_region - 1) * 9');
  });

  it('대장 검사는 공용 _check_character 를 쓴다 (076)', () => {
    expect(block('charge_start')).toContain('perform public._check_character(me, p_leader);');
  });

  it('게임 오픈 여부는 닫힌 채로 추가', () => expect(sql).toContain("('game_open:charge', 'false'::jsonb)"));
});

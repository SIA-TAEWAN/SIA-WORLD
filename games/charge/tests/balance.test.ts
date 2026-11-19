import { describe, expect, it } from 'vitest';
import { expectedUpgrades } from '../src/data/calibrate';
import { modsOf } from '../src/data/growth';
import { STAGES } from '../src/data/stages';
import { greedy, simulate } from './policy';

/**
 * 밸런스 지킴이 (PRD 9장): 그 지역까지 보통만큼 강화하면 잘 고르는 사람은 클리어하고,
 * 뒤 지역 보스는 강화 없이 깨기 어렵다. 수치를 고치다가 크게 벗어났을 때만 걸리도록 넉넉하게.
 */
describe('밸런스', () => {
  it('보통 강화 + 잘 고르면 60스테이지 모두 클리어', () => {
    const fails = STAGES.filter((st) => !simulate(st.id, 'rat', greedy, modsOf(expectedUpgrades((st.region - 1) / 11))).cleared).map((s) => s.id);
    expect(fails).toEqual([]);
  }, 120_000);

  it('6지역부터는 강화 없이 깨기 어려운 스테이지가 있다', () => {
    const late = STAGES.filter((st) => st.region >= 6);
    const fails = late.filter((st) => !simulate(st.id, 'rat', greedy).cleared).length;
    expect(fails).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it('1분 안팎 (보스 지역은 조금 더)', () => {
    for (const st of STAGES.filter((s) => s.no !== 5)) {
      const r = simulate(st.id, 'rat', greedy, modsOf(expectedUpgrades((st.region - 1) / 11)));
      expect(r.time, st.id).toBeLessThan(90);
    }
  }, 120_000);
});

import { describe, expect, it } from 'vitest';
import { STARTERS } from '../src/data/characters';
import { stagesOf } from '../src/data/stages';
import { SKILLS, simulate, skillPolicy } from '../src/game/policy';

/**
 * 밸런스 지킴이 (PRD 7장: 1지역은 강화 없이도 클리어 가능, 별 3개는 조금 어렵다).
 * 정확한 비율은 npm run balance 로 본다. 여기서는 수치를 고치다가 크게 벗어났을 때만 걸리도록 넉넉하게 잡는다.
 * 판 번호마다 시드가 정해져 있어서 결과는 늘 같다.
 */
const RUNS = 30;

function sweep(stage: string, skill: keyof typeof SKILLS) {
  let clears = 0;
  let three = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = simulate({ seed: 1 + i * 7919, stage, squad: [...STARTERS] }, skillPolicy(31 + i * 104729, SKILLS[skill])).summary;
    clears += r.cleared ? 1 : 0;
    three += r.stars === 3 ? 1 : 0;
  }
  return { clears: clears / RUNS, three: three / RUNS };
}

describe('1지역 밸런스 (강화 없음, 기본 4종)', () => {
  for (const st of stagesOf(1)) {
    it(`${st.id}: 보통 실력으로 대부분 클리어하지만 별 3개는 늘 따지는 못하고, 능숙하면 별 3개를 딸 수 있다`, { timeout: 180_000 }, () => {
      const normal = sweep(st.id, 'normal');
      const expert = sweep(st.id, 'expert');
      expect(normal.clears).toBeGreaterThanOrEqual(0.8);
      expect(normal.three).toBeLessThanOrEqual(0.8);
      expect(expert.three).toBeGreaterThan(0);
      expect(expert.clears).toBeGreaterThanOrEqual(0.9);
    });
  }
});

import { describe, expect, it } from 'vitest';
import { regionTier } from '../src/data/economy';
import { MAPS } from '../src/data/maps';
import { mapLevel } from '../src/data/regions';
import { tierAtk } from '../src/data/weapons';
import { createRun } from '../src/game/sim';
import { autoplay } from './bot';
import { lo } from './helpers';

/**
 * 맵을 자동 조종으로 끝까지 깨 본다 (무적). 맵이 96개라 한 파일에 두면 그 파일만 1분 넘게 걸려서
 * (느린 기계에서는 vitest 가 '응답 없음'으로 본다) 지형 넷씩 세 파일로 나눴다: play1 · play2 · play3.
 */
export function playMaps(from: number, to: number) {
  const list = MAPS.filter((m) => m.region >= from && m.region <= to);
  describe(`맵 한 판 (자동 조종) — ${from}~${to}지형`, () => {
    // 준비된 지형이 없으면 빈 묶음이 되지 않게
    it('준비된 맵만 본다', () => expect(list.length % 8).toBe(0));
    if (!list.length) return;
    it.each(list.map((m) => [m.id, m] as const))('%s: 끝까지 깰 수 있다 (무적 자동 조종, 숨은 상자 포함)', { timeout: 30000 }, (_id, m) => {
      const s = createRun(m, 'normal', { ...lo('ox', 'sword', mapLevel(m.region, m.no, 'normal')), weaponAtk: tierAtk(regionTier(m.region, 'normal')) }, { seed: 11, god: true });
      const r = autoplay(s, 1500, { chest: true });
      expect(r.phase).toBe('clear');
      expect(s.chest).toBe(true);
      if (m.boss) expect(s.bossDead).toBe(true);
      // 서툰 자동 조종으로도 별 기준 시간의 세 배 안에는 끝난다
      expect(r.time).toBeLessThan(m.par * 3);
    });
  });
}

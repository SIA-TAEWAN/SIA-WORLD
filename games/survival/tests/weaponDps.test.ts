import { describe, expect, it } from 'vitest';
import { EVOLUTIONS } from '../src/data/evolutions';
import { WEAPONS } from '../src/data/weapons';
import { weaponDps } from '../src/game/policy';
import { breathe } from './helpers';

/**
 * 무기의 세기 (PRD 4장: 캐릭터끼리 같은 시간에 주는 피해가 비슷해야 한다).
 * 허수아비 판을 수백 번 돌리는 오래 걸리는 시험이라 tests/weapons.test.ts 에서 떼어 냈고, 무기 하나를 잴 때마다 한 번 쉰다 (helpers.ts 의 breathe).
 */

/** 캐릭터 12종의 시작 무기 */
const SIX = ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist', 'hoof', 'wool', 'staff', 'feather', 'puppy', 'piggy'];

/** 무기 하나의 초당 피해를 재고 한 번 쉰다 */
async function dpsOf(id: string, lv: number): Promise<number> {
  const d = weaponDps(id, lv);
  await breathe();
  return d;
}

describe('무기 12종의 세기', () => {
  it('시작 무기(1레벨)가 같은 시간에 주는 피해는 서로 ±15% 안이다', async () => {
    const dps: number[] = [];
    for (const id of SIX) dps.push(await dpsOf(id, 1));
    const mean = dps.reduce((a, b) => a + b, 0) / dps.length;
    for (const d of dps) expect(Math.abs(d / mean - 1)).toBeLessThan(0.15);
  }, 120000);

  it('레벨마다 세지고, 같은 레벨끼리도 ±15% 안이다', async () => {
    // policy.ts 의 dpsTable() 과 같은 표 (준비된 무기 전부 × 모든 레벨)를 무기·레벨마다 쉬어 가며 만든다
    const all: { id: string; dps: number[] }[] = [];
    for (const w of WEAPONS.filter((x) => x.ready)) {
      const dps: number[] = [];
      for (let lv = 1; lv <= w.levels.length; lv++) dps.push(await dpsOf(w.id, lv));
      all.push({ id: w.id, dps });
    }
    const table = all.filter((r) => SIX.includes(r.id));
    expect(table.length).toBe(SIX.length);
    for (const r of table) for (let i = 1; i < 5; i++) expect(r.dps[i]).toBeGreaterThan(r.dps[i - 1] * 1.2);
    for (let lv = 0; lv < 5; lv++) {
      const col = table.map((r) => r.dps[lv]);
      const mean = col.reduce((a, b) => a + b, 0) / col.length;
      for (const d of col) expect(Math.abs(d / mean - 1)).toBeLessThan(0.15);
    }
  }, 240000);

  it('진화 무기 7종은 5레벨보다 두 배 넘게 세고, 2차 4종의 세기는 처음 3종의 범위 안이다', async () => {
    const dps: Record<string, number> = {};
    for (const e of EVOLUTIONS) {
      dps[e.result] = await dpsOf(e.result, 1);
      expect(dps[e.result], e.result).toBeGreaterThan((await dpsOf(e.weapon, 5)) * 2);
    }
    const first = ['shurikenEvo', 'pearlEvo', 'clawEvo'].map((id) => dps[id]);
    for (const e of EVOLUTIONS.slice(3)) {
      expect(dps[e.result], e.result).toBeGreaterThanOrEqual(Math.min(...first));
      expect(dps[e.result], e.result).toBeLessThanOrEqual(Math.max(...first));
    }
  }, 240000);
});

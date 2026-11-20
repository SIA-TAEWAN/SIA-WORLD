import { describe, expect, it } from 'vitest';
import { CALIB_PILOT, EXPECT_LEVEL, expectLevel, partyFor, testLevel } from '../src/data/balance';
import { autoPlay } from '../src/data/calibrate';
import { levelCost, rewardOf } from '../src/data/growth';
import { HEROES, buildConfig, createRun, stageOf, type StageDef } from '../src/sim';
import { choose } from '../src/game/autopilot';

/**
 * 밸런스 곡선 (PRD "밸런스 목표"). 60스테이지 전체는 npm run calib 이 돌리고 표를 찍는다 (몇 분).
 * 여기서는 지역마다 대표 스테이지 두 개(앞쪽 하나 + 보스)를 자동 플레이어로 둔다.
 *  · 1~5지역: 강화 0, 레벨 1~3 (testLevel) 으로 깬다
 *  · 6지역부터: 예상 레벨보다 3레벨 낮은 testLevel 로 깬다 (예상 레벨은 그때까지 모을 수 있는 엽전으로 정함)
 *  · 늦은 지역은 레벨 1로는 못 깬다 (레벨을 올려야 하는 곡선)
 */
const pick = (r: number): StageDef[] => [stageOf(`${r}-${(r % 4) + 1}`)!, stageOf(`${r}-5`)!];
const cases = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((r) => pick(r).map((st) => [st.id, st] as const));

describe('밸런스: 지역 대표 스테이지를 자동 플레이어가 깬다', () => {
  it.each(cases)('%s', (_, st) => {
    const lv = testLevel(st.region);
    if (st.region <= 5) expect(lv).toBeLessThanOrEqual(3);
    const r = autoPlay(st, { level: lv, party: partyFor(st.region) });
    expect(r.cleared).toBe(true);
    expect(r.fallen).toBeLessThanOrEqual(1);
    expect(r.turns).toBeLessThanOrEqual(st.par);
  }, 60_000);

  // 밸런스 기준인 보정용 자동 플레이어(사람에 가까운 30° 탐색)로 잰다. 10° 탐색 자동 플레이어는 앞을 다 보는 거의 완벽한 수라 11-5 를 레벨 1로도 깬다
  it('늦은 지역 보스는 레벨 1로 못 깬다', () => {
    for (const id of ['11-5', '12-5']) expect(autoPlay(stageOf(id)!, { level: 1, party: partyFor(12), pilot: CALIB_PILOT }).cleared, id).toBe(false);
  }, 60_000);
});

describe('밸런스 곡선 데이터', () => {
  it('파티는 그 지역을 할 때 합류해 있는 대원 4명 (1지역은 처음 3명)', () => {
    expect(partyFor(1)).toEqual(['rat', 'ox', 'tiger']);
    for (let r = 2; r <= 12; r++) {
      expect(partyFor(r).length).toBe(4);
      for (const id of partyFor(r)) expect(HEROES[id].unlockRegion).toBeLessThan(r);
    }
  });

  it('예상 레벨은 오르기만 하고, 1~5지역은 초반 레벨', () => {
    for (let r = 2; r <= 12; r++) expect(expectLevel(r)).toBeGreaterThan(expectLevel(r - 1));
    expect(EXPECT_LEVEL.slice(0, 5).every((l) => l <= 5)).toBe(true);
    expect(expectLevel(12)).toBeLessThanOrEqual(30);
  });

  it('예상 레벨은 그 지역까지 첫 클리어(별 2개)로 모은 엽전 + 다시하기 몇 판으로 닿는다', () => {
    // 4명을 예상 레벨까지 올리는 값 − 앞 지역들을 별 2개로 처음 깬 엽전 = 다시하기로 모을 몫
    const firstClear = (r: number) => [1, 2, 3, 4, 5].reduce((a, n) => {
      const rw = rewardOf(r, n);
      return a + rw.clear + rw.star * 2 + rw.first;
    }, 0);
    let earned = 0;
    for (let r = 1; r <= 12; r++) {
      let cost = 0;
      for (let lv = 1; lv < expectLevel(r); lv++) cost += levelCost(lv) * 4;
      const replays = Math.max(0, cost - earned) / (rewardOf(Math.max(1, r - 1), 5).clear + 16);
      if (r <= 7) expect(replays, `지역 ${r}`).toBeLessThanOrEqual(5);
      expect(replays, `지역 ${r}`).toBeLessThan(90);
      earned += firstClear(r);
    }
  });

  it('자동 플레이어 한 수는 수백 ms 안 (늦은 보스 스테이지)', () => {
    const s = createRun(buildConfig({ stage: '12-5', party: partyFor(12), levels: Object.fromEntries(partyFor(12).map((id) => [id, 20])) }));
    const t0 = performance.now();
    choose(s);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

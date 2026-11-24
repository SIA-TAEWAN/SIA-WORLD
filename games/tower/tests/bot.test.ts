/**
 * 자동 조종 봇으로 1→10층을 실제로 오른다 (PRD 'MVP 완료 기준' + 밸런스 숫자).
 * 숫자를 보려면: npm run bot -- 10   (씨앗 10개, 층마다 레벨·엽전·시간·타수·보스 시간)
 */
import { describe, expect, it } from 'vitest';
import { newData } from '../src/game/progress';
import { botTower } from './bot';

const SEEDS = [1000, 1001, 1002, 1003, 1004, 1005];

describe('봇: 1층 → 10층 골렘 → 체크포인트 11', () => {
  const logs = SEEDS.map((seed) => ({ seed, log: botTower(newData(seed), 10, 4) }));

  it('끊김 없이 끝까지 (갇히지 않고 계단·골렘까지, 체크포인트 11)', () => {
    for (const { seed, log } of logs) {
      expect(log.floors.every((f) => f.result !== 'timeout'), `씨앗 ${seed} 시간 초과`).toBe(true);
      expect(log.data.checkpoint, `씨앗 ${seed}`).toBe(11);
      expect(log.data.best).toBe(10);
    }
    // 대부분은 한 번도 쓰러지지 않는다 (골렘은 2~3분 싸움이라 가끔 진다)
    expect(logs.filter((l) => l.log.deaths === 0).length).toBeGreaterThanOrEqual(SEEDS.length / 2);
  });

  it('2층 쥐 구슬, 7층 소 구슬', () => {
    for (const { log } of logs) {
      const first = log.floors.filter((f) => f.result === 'clear');
      expect(first.find((f) => f.floor === 2)!.orbs).toContain('rat');
      expect(first.find((f) => f.floor === 6)!.orbs).not.toContain('ox');
      expect(first.find((f) => f.floor === 7)!.orbs).toContain('ox');
    }
  });

  it('경험치: 평균 한 층에 1레벨 (첫 도전 10층을 깬 뒤 Lv 10~13)', () => {
    for (const { seed, log } of logs) {
      if (log.deaths) continue;
      const lv = log.floors.find((f) => f.floor === 10)!.level;
      expect(lv, `씨앗 ${seed}`).toBeGreaterThanOrEqual(10);
      expect(lv, `씨앗 ${seed}`).toBeLessThanOrEqual(13);
      // 9층을 깬 뒤 (= 10층 들어갈 때) Lv 9~11
      const lv9 = log.floors.find((f) => f.floor === 9)!.level;
      expect(lv9).toBeGreaterThanOrEqual(9);
      expect(lv9).toBeLessThanOrEqual(11);
    }
  });

  it('일반 적은 기본 공격 3~5번 (봇이 실제로 때린 평균)', () => {
    const hits = logs.flatMap((l) => l.log.floors.flatMap((f) => f.killHits));
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
    expect(hits.length).toBeGreaterThan(20);
    expect(avg).toBeGreaterThanOrEqual(3);
    expect(avg).toBeLessThanOrEqual(5);
  });

  it('엽전: 한 구역에서 회복약(대) 10개쯤 (번 엽전 550~900냥)', () => {
    for (const { seed, log } of logs) {
      if (log.deaths) continue;
      // 상점에서 쓴 것까지 더한 번 엽전 = 마지막 엽전 + 5층에서 쓴 엽전
      const at4 = log.floors.find((f) => f.floor === 4)!.coins;
      const at5 = log.floors.find((f) => f.floor === 5)!.coins;
      const earned = log.data.coins + Math.max(0, at4 - at5);
      expect(earned, `씨앗 ${seed}`).toBeGreaterThanOrEqual(550);
      expect(earned, `씨앗 ${seed}`).toBeLessThanOrEqual(900);
    }
  });

  it('문지기 골렘: Lv10 안팎 캐릭터로 2~3분 (봇 기준 90~200초)', () => {
    const times = logs.flatMap((l) => l.log.floors.filter((f) => f.floor === 10 && f.result === 'clear').map((f) => f.bossTime));
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(90);
      expect(t).toBeLessThanOrEqual(200);
    }
  });
});

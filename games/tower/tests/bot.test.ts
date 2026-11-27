/**
 * 자동 조종 봇으로 1→10층, 이어서 11→20층을 실제로 오른다 (PRD 완료 기준 + 밸런스 숫자).
 * 숫자를 보려면: npm run bot -- 6 20   (씨앗 6개, 층마다 레벨·엽전·시간·타수·보스 시간, 끝에 층마다 평균 분)
 */
import { describe, expect, it } from 'vitest';
import { clone, newData } from '../src/game/progress';
import { botTower } from './bot';

const SEEDS = [1000, 1001, 1002, 1003, 1004, 1005];
/** 2구역까지 오르는 씨앗 (시간이 오래 걸려 넷만) */
const SEEDS2 = SEEDS.slice(0, 4);

const zone1 = SEEDS.map((seed) => ({ seed, log: botTower(newData(seed), 10, 4) }));
const zone2 = zone1.filter((z) => SEEDS2.includes(z.seed)).map(({ seed, log }) => ({ seed, log: botTower(clone(log.data), 20, 4) }));
const firstTry = (log: (typeof zone1)[number]['log'], floor: number) => log.floors.find((f) => f.floor === floor)!;

describe('봇: 1층 → 10층 골렘 → 체크포인트 11', () => {
  it('끊김 없이 끝까지 (갇히지 않고 계단·골렘까지, 체크포인트 11)', () => {
    for (const { seed, log } of zone1) {
      expect(log.floors.every((f) => f.result !== 'timeout'), `씨앗 ${seed} 시간 초과`).toBe(true);
      expect(log.data.checkpoint, `씨앗 ${seed}`).toBe(11);
      expect(log.data.best).toBe(10);
    }
    // 대부분은 한 번도 쓰러지지 않는다 (골렘은 2~3분 싸움이라 가끔 진다)
    expect(zone1.filter((l) => l.log.deaths === 0).length).toBeGreaterThanOrEqual(SEEDS.length / 2);
  });

  it('2층 쥐 구슬, 7층 소 구슬', () => {
    for (const { log } of zone1) {
      const first = log.floors.filter((f) => f.result === 'clear');
      expect(first.find((f) => f.floor === 2)!.orbs).toContain('rat');
      expect(first.find((f) => f.floor === 6)!.orbs).not.toContain('ox');
      expect(first.find((f) => f.floor === 7)!.orbs).toContain('ox');
    }
  });

  it('경험치: 평균 한 층에 1레벨 (첫 도전 10층을 깬 뒤 Lv 10~14)', () => {
    for (const { seed, log } of zone1) {
      if (log.deaths) continue;
      const lv = log.floors.find((f) => f.floor === 10)!.level;
      expect(lv, `씨앗 ${seed}`).toBeGreaterThanOrEqual(10);
      expect(lv, `씨앗 ${seed}`).toBeLessThanOrEqual(14);
      // 9층을 깬 뒤 (= 10층 들어갈 때) Lv 9~12
      const lv9 = log.floors.find((f) => f.floor === 9)!.level;
      expect(lv9).toBeGreaterThanOrEqual(9);
      expect(lv9).toBeLessThanOrEqual(12);
    }
  });

  it('일반 적은 기본 공격 3~5번 (봇이 실제로 때린 평균)', () => {
    const hits = zone1.flatMap((l) => l.log.floors.filter((f) => f.result === 'clear').flatMap((f) => f.killHits));
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
    expect(hits.length).toBeGreaterThan(100);
    expect(avg).toBeGreaterThanOrEqual(3);
    expect(avg).toBeLessThanOrEqual(5);
  });

  it('엽전: 한 구역에서 회복약(대) 10개쯤 (번 엽전 550~950냥)', () => {
    for (const { seed, log } of zone1) {
      if (log.deaths) continue;
      // 상점에서 쓴 것까지 더한 번 엽전 = 마지막 엽전 + 5층에서 쓴 엽전
      const at4 = log.floors.find((f) => f.floor === 4)!.coins;
      const at5 = log.floors.find((f) => f.floor === 5)!.coins;
      const earned = log.data.coins + Math.max(0, at4 - at5);
      expect(earned, `씨앗 ${seed}`).toBeGreaterThanOrEqual(550);
      expect(earned, `씨앗 ${seed}`).toBeLessThanOrEqual(950);
    }
  });

  it('문지기 골렘: Lv10 안팎 캐릭터로 2~3분 (봇 기준 90~200초)', () => {
    const times = zone1.flatMap((l) => l.log.floors.filter((f) => f.floor === 10 && f.result === 'clear').map((f) => f.bossTime));
    expect(times.length).toBe(SEEDS.length);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(80);
      expect(t).toBeLessThanOrEqual(200);
    }
  });

  it('한 층 (일반·정예): 봇 첫 도전 평균 1.5~3.5분 (사람은 더 느리다 — PROGRESS.md)', () => {
    for (const f of [1, 2, 3, 4, 6, 7, 8, 9]) {
      const ts = zone1.map((z) => firstTry(z.log, f).time);
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
      expect(avg, `${f}층`).toBeGreaterThanOrEqual(90);
      expect(avg, `${f}층`).toBeLessThanOrEqual(210);
    }
  });
});

describe('봇: 11층 → 20층 이끼 이무기 → 체크포인트 21', () => {
  it('끊김 없이 끝까지 (체크포인트 21)', () => {
    for (const { seed, log } of zone2) {
      expect(log.floors.every((f) => f.result !== 'timeout'), `씨앗 ${seed} 시간 초과`).toBe(true);
      expect(log.data.checkpoint, `씨앗 ${seed}`).toBe(21);
      expect(log.data.best).toBe(20);
    }
  });

  it('12층 용 구슬, 17층 뱀 구슬', () => {
    for (const { log } of zone2) {
      expect(firstTry(log, 11).orbs).not.toContain('dragon');
      expect(firstTry(log, 12).orbs).toContain('dragon');
      expect(firstTry(log, 16).orbs).not.toContain('snake');
      expect(firstTry(log, 17).orbs).toContain('snake');
    }
  });

  it('경험치: 19층을 깬 뒤 Lv 19~24, 2구역 일반 적도 3~5타', () => {
    for (const { seed, log } of zone2) {
      const lv = firstTry(log, 19).level;
      expect(lv, `씨앗 ${seed}`).toBeGreaterThanOrEqual(19);
      expect(lv, `씨앗 ${seed}`).toBeLessThanOrEqual(24);
    }
    const hits = zone2.flatMap((l) => l.log.floors.filter((f) => f.floor > 10).flatMap((f) => f.killHits));
    const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
    expect(avg).toBeGreaterThanOrEqual(2.5);
    expect(avg).toBeLessThanOrEqual(5);
  });

  it('이끼 이무기: 2~3분 싸움 (봇 기준 80~240초 — 쓰러지면 같은 레벨로 그 층을 바로 다시)', () => {
    const times = zone2.flatMap((l) => l.log.floors.filter((f) => f.floor === 20 && f.result === 'clear').map((f) => f.bossTime));
    expect(times.length).toBe(SEEDS2.length);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(80);
      expect(t).toBeLessThanOrEqual(240);
    }
  });

  it('한 층 (일반·정예): 봇 첫 도전 평균 1.5~3.5분', () => {
    for (const f of [11, 12, 13, 14, 16, 17, 18, 19]) {
      const ts = zone2.map((z) => firstTry(z.log, f).time);
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
      expect(avg, `${f}층`).toBeGreaterThanOrEqual(90);
      expect(avg, `${f}층`).toBeLessThanOrEqual(210);
    }
  });
});

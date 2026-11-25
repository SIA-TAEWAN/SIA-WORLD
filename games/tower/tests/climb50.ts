/**
 * 봇이 1층부터 50층까지 (3차: 21~50층 · 3~5구역) 실제로 오르며 확인하는 것들. 씨앗마다 시험 파일을 나눠 따로따로 돌린다 (한 씨앗 1~2분).
 * 숫자를 보려면: npm run bot -- 3 50
 */
import { describe, expect, it } from 'vitest';
import { priceOf } from '../src/data';
import { newData } from '../src/game/progress';
import { botTower, type TowerLog } from './bot';

export function climb50(seed: number) {
  const log: TowerLog = botTower(newData(seed), 50, 8);
  const first = (floor: number) => log.floors.find((f) => f.floor === floor)!;
  const cleared = (floor: number) => log.floors.find((f) => f.floor === floor && f.result === 'clear')!;

  describe(`봇 씨앗 ${seed}: 1층 → 50층 불가사리 → 체크포인트 51`, () => {
    it('끊김 없이 끝까지 (갇혀서 시간이 다 되는 층이 없다, 체크포인트 51)', () => {
      expect(log.floors.filter((f) => f.result === 'timeout').map((f) => f.floor)).toEqual([]);
      expect(log.data.checkpoint).toBe(51);
      expect(log.data.best).toBe(50);
    });

    it('구슬: 22 토끼 · 27 원숭이 · 30 현무(보스 뒤) · 32 닭 · 37 양 · 42 개 · 47 호랑이 · 50 주작(보스 뒤)', () => {
      const at: [number, string][] = [[22, 'rabbit'], [27, 'monkey'], [30, 'turtle'], [32, 'rooster'], [37, 'sheep'], [42, 'dog'], [47, 'tiger'], [50, 'phoenix']];
      for (const [f, id] of at) {
        expect(first(f - 1).orbs.split(','), `${f - 1}층`).not.toContain(id);
        expect(cleared(f).orbs.split(','), `${f}층`).toContain(id);
      }
      // 구슬 16개 중 50층까지 12개
      expect(log.data.orbs).toMatchObject({ rat: 1, ox: 1, dragon: 1, snake: 1, rabbit: 1, monkey: 1, turtle: 1, rooster: 1, sheep: 1, dog: 1, tiger: 1, phoenix: 1 });
    });

    it('경험치: 한 층에 1레벨 안팎 (첫 도전 29층 뒤 Lv 28~38, 39층 뒤 Lv 38~50, 49층 뒤 Lv 48~62)', () => {
      for (const [f, lo, hi] of [[29, 28, 38], [39, 38, 50], [49, 48, 62]]) {
        expect(first(f).level, `${f}층`).toBeGreaterThanOrEqual(lo);
        expect(first(f).level, `${f}층`).toBeLessThanOrEqual(hi);
      }
      const hits = log.floors.filter((f) => f.floor > 20).flatMap((f) => f.killHits);
      const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
      expect(avg).toBeGreaterThanOrEqual(3);
      expect(avg).toBeLessThanOrEqual(5);
    });

    it('엽전: 구역마다 그 구역 값으로 회복약(대) 8~18개쯤', () => {
      for (const zone of [3, 4, 5]) {
        const base = zone * 10 - 10;
        // 휴식층(x5)에서 쓴 것까지 더한 번 엽전 = (x4 뒤 - x0 뒤) + (x0 뒤 - x5 뒤)
        const c = (f: number) => first(f).coins;
        const earned = c(base + 4) - c(base) + (c(base + 10) - c(base + 5));
        const n = earned / priceOf('potionL', base + 5);
        expect(n, `${zone}구역`).toBeGreaterThanOrEqual(8);
        expect(n, `${zone}구역`).toBeLessThanOrEqual(18);
      }
    });

    it('보스: 동장군 · 영등할미 · 불가사리 모두 2~4분 싸움 (봇 기준 80~260초)', () => {
      for (const f of [30, 40, 50]) {
        const t = cleared(f).bossTime;
        expect(t, `${f}층`).toBeGreaterThanOrEqual(80);
        expect(t, `${f}층`).toBeLessThanOrEqual(260);
      }
    });

    it('한 층 (일반·정예, 21~49층): 봇 첫 도전 평균 1.5~4분 (사람은 더 느리다 — PROGRESS.md)', () => {
      const ts = log.floors.filter((f) => f.floor > 20 && f.floor % 10 !== 0 && f.floor % 10 !== 5 && log.floors.find((g) => g.floor === f.floor) === f).map((f) => f.time);
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
      expect(avg).toBeGreaterThanOrEqual(90);
      expect(avg).toBeLessThanOrEqual(240);
    });
  });
}

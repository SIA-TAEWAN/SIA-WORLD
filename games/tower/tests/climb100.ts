/**
 * 봇이 체크포인트 51(또는 71)에서 100층 엔딩까지 실제로 오르며 확인하는 것들 (4차: 51~100층 · 6~10구역).
 * 1층부터 씨앗 여럿으로 다 오르면 CI 가 너무 오래 걸려, 체크포인트 상태(tests/start.ts)에서 씨앗 하나로 나눠 오른다.
 * 숫자를 보려면: npm run bot -- 2 100 1000 51
 */
import { describe, expect, it } from 'vitest';
import { priceOf } from '../src/data';
import { checkSave } from '../src/net/api';
import { botTower, type TowerLog } from './bot';
import { startData } from './start';

const ORB_AT: [number, string][] = [[52, 'horse'], [57, 'pig'], [70, 'whiteTiger'], [90, 'blueDragon']];
/** 그 층(첫 도전)을 깬 뒤 레벨 범위 — 100층 무렵 Lv 95~99, 95층 전에는 99가 되지 않는다 */
const LEVEL_AT: [number, number, number][] = [[59, 58, 70], [69, 65, 78], [79, 73, 86], [89, 81, 94], [94, 85, 98], [99, 91, 99]];

export function climbFrom(seed: number, from: number, last: number) {
  const start = startData(seed, from);
  const log: TowerLog = botTower(startData(seed, from), last, 6);
  const first = (floor: number) => log.floors.find((f) => f.floor === floor)!;
  const cleared = (floor: number) => log.floors.find((f) => f.floor === floor && f.result === 'clear')!;
  const zones = Array.from({ length: (last - from + 1) / 10 }, (_, i) => Math.ceil(from / 10) + i);

  describe(`봇 씨앗 ${seed}: 체크포인트 ${from} → ${last}층`, () => {
    it(`끊김 없이 끝까지 (갇혀서 시간이 다 되는 층이 없다${last === 100 ? ', 100층 소원 · 엔딩' : `, 체크포인트 ${last + 1}`})`, () => {
      expect(log.floors.filter((f) => f.result === 'timeout').map((f) => f.floor)).toEqual([]);
      expect(log.data.best).toBe(last);
      if (last === 100) {
        // 다 오른 뒤의 저장: 층 100 · 체크포인트 91 (104 의 tower_save 확인 그대로)
        expect(log.data).toMatchObject({ floor: 100, checkpoint: 91, best: 100 });
        expect(checkSave(log.data, 100, 99)).toBeNull();
        expect(checkSave(log.data, null, 100)).toBeNull();
      } else expect(log.data.checkpoint).toBe(last + 1);
    });

    it('구슬: 52 말 · 57 돼지 (받침대), 70 백호 · 90 청룡 (보스 뒤 전설 구슬)', () => {
      for (const [f, id] of ORB_AT) {
        if (f < from || f > last) continue;
        if (f > from) expect(first(f - 1).orbs.split(','), `${f - 1}층`).not.toContain(id);
        expect(cleared(f).orbs.split(','), `${f}층`).toContain(id);
      }
      if (last === 100) expect(Object.keys(log.data.orbs)).toHaveLength(16);
    });

    it('경험치: 6구역부터 한 층에 0.8레벨 안팎 — 100층 무렵 Lv 95~99, 95층 전에는 99가 되지 않는다', () => {
      for (const [f, lo, hi] of LEVEL_AT) {
        if (f < from || f > last) continue;
        expect(first(f).level, `${f}층`).toBeGreaterThanOrEqual(lo);
        expect(first(f).level, `${f}층`).toBeLessThanOrEqual(hi);
      }
      const hits = log.floors.flatMap((f) => f.killHits);
      const avg = hits.reduce((a, b) => a + b, 0) / hits.length;
      expect(avg).toBeGreaterThanOrEqual(3);
      expect(avg).toBeLessThanOrEqual(5);
    });

    it('엽전: 구역마다 그 구역 값으로 회복약(대) 8~16개쯤', () => {
      for (const zone of zones) {
        const base = zone * 10 - 10;
        const c = (f: number) => (f === from - 1 ? start.coins : first(f).coins);
        const earned = c(base + 4) - c(base) + (c(base + 10) - c(base + 5));
        const n = earned / priceOf('potionL', base + 5);
        expect(n, `${zone}구역`).toBeGreaterThanOrEqual(8);
        expect(n, `${zone}구역`).toBeLessThanOrEqual(16);
      }
    });

    it('보스: 2~4분 싸움 (봇 기준 80~260초, 마지막 어둑시니는 3~4분 — 130~300초)', () => {
      for (const zone of zones) {
        const f = zone * 10;
        const t = cleared(f).bossTime;
        expect(t, `${f}층`).toBeGreaterThanOrEqual(f === 100 ? 130 : 80);
        expect(t, `${f}층`).toBeLessThanOrEqual(f === 100 ? 300 : 260);
      }
    });

    it('한 층 (일반·정예): 봇 첫 도전 평균 1.5~3분, 전투방이 많은 x4·x8 층도 평균 3분 안쪽', () => {
      const firsts = log.floors.filter((f) => f.floor % 10 !== 0 && f.floor % 10 !== 5 && log.floors.find((g) => g.floor === f.floor) === f);
      const avg = (fs: typeof firsts) => fs.reduce((a, b) => a + b.time, 0) / fs.length;
      expect(avg(firsts)).toBeGreaterThanOrEqual(90);
      expect(avg(firsts)).toBeLessThanOrEqual(180);
      expect(avg(firsts.filter((f) => f.floor % 10 === 4 || f.floor % 10 === 8))).toBeLessThanOrEqual(185);
    });
  });
}

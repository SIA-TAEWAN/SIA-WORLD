import { describe, expect, it } from 'vitest';
import { T, TILE, flyable, generateFloor, type FloorMap } from '../src/game/floorgen';

/** 시작 자리부터 걸어 닿는 칸 (opened = 철문·바위를 연 뒤) */
function reach(m: FloorMap, opened = false) {
  const ok = (t: number) => t === T.FLOOR || t === T.DOOR || t === T.STAIRS || t === T.RUBBLE || (opened && (t === T.GATE || t === T.ROCK));
  const s = Math.floor(m.start.y / TILE) * m.w + Math.floor(m.start.x / TILE);
  const seen = new Set<number>([s]);
  const q = [s];
  while (q.length) {
    const c = q.pop()!;
    const x = c % m.w;
    const y = (c - x) / m.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + dy) * m.w + x + dx;
      if (x + dx < 0 || y + dy < 0 || x + dx >= m.w || y + dy >= m.h || seen.has(n) || !ok(m.tiles[n])) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}
const nextTo = (m: FloorMap, seen: Set<number>, x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((y + dy) * m.w + x + dx));

describe('층 만들기', () => {
  it('같은 씨앗·같은 층이면 같은 층, 층·씨앗마다 다르다', () => {
    const a = generateFloor(77, 3);
    expect(generateFloor(77, 3)).toEqual(a);
    expect(generateFloor(77, 4).tiles).not.toEqual(a.tiles);
    expect(generateFloor(78, 3).tiles).not.toEqual(a.tiles);
  });

  it('층 구성: 2층 쥐 구슬, 5층 상점, 7층 소 구슬, 9층 정예, 10층 골렘 (보스 뒤 계단)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (let f = 1; f <= 10; f++) {
        const m = generateFloor(seed, f);
        const kind = m.kind;
        // 방 3~5개 + 계단 (휴식층 3 · 보스층 2)
        const n = m.rooms.length;
        if (kind === 'normal' || kind === 'elite') expect(n, `${seed}:${f}`).toBeGreaterThanOrEqual(4), expect(n).toBeLessThanOrEqual(6);
        expect(m.objs.find((o) => o.kind === 'pedestal')?.orb).toBe(f === 2 ? 'rat' : f === 7 ? 'ox' : undefined);
        expect(m.objs.some((o) => o.kind === 'shop')).toBe(f === 5);
        expect(m.rooms.some((r) => r.kind === 'elite')).toBe(f === 9);
        expect(m.rooms.some((r) => r.spawns.some((s) => s.def === 'golem'))).toBe(f === 10);
        expect(m.stairsHidden).toBe(f === 10);
      }
    }
  });

  it('갇히는 곳이 없다: 계단·구슬·상점·상자에 닿고, 스위치는 참격으로 맞힐 자리가 있다 (1~10층 × 씨앗 60개)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (let f = 1; f <= 10; f++) {
        const m = generateFloor(seed * 7919, f);
        const walk = reach(m);
        const all = reach(m, true);
        for (const o of m.objs) {
          const at = o.y * m.w + o.x;
          if (o.kind === 'stairs') expect(walk.has(at), `${seed}:${f} 계단`).toBe(true);
          if (o.kind === 'pedestal' || o.kind === 'shop' || o.kind === 'fountain') expect(nextTo(m, walk, o.x, o.y), `${seed}:${f} ${o.kind}`).toBe(true);
          if (o.kind === 'chest') expect(nextTo(m, o.table === 'puzzle' ? all : walk, o.x, o.y), `${seed}:${f} 상자`).toBe(true);
          if (o.kind === 'switch') {
            let ok = false;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              for (let d = 2; d <= 7 && !ok; d++) {
                if (!walk.has((o.y + dy * d) * m.w + o.x + dx * d)) continue;
                let clear = true;
                for (let k = 1; k < d; k++) if (!flyable(m.tiles[(o.y + dy * k) * m.w + o.x + dx * k])) clear = false;
                ok ||= clear;
              }
            }
            expect(ok, `${seed}:${f} 스위치`).toBe(true);
          }
        }
      }
    }
  });

  it('11층부터는 구조만 (적 데이터가 없어도 층은 만들어진다)', () => {
    for (const f of [11, 15, 20, 55, 100]) {
      const m = generateFloor(5, f);
      expect(m.rooms.length).toBeGreaterThanOrEqual(2);
      expect(m.rooms.every((r) => r.spawns.length === 0)).toBe(true);
    }
  });
});

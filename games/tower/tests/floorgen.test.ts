import { describe, expect, it } from 'vitest';
import { T, TILE, flyable, generateFloor, walkable, type FloorMap } from '../src/game/floorgen';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** 시작 자리부터 걸어 닿는 칸 (opened = 철문·바위를 연 뒤, grapple = 뱀 구슬로 말뚝을 감아 건넌다) */
function reach(m: FloorMap, opened = false, grapple = false) {
  const ok = (t: number) => walkable(t) || (opened && (t === T.GATE || t === T.ROCK));
  const s = Math.floor(m.start.y / TILE) * m.w + Math.floor(m.start.x / TILE);
  const seen = new Set<number>([s]);
  const q = [s];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? T.VOID : m.tiles[y * m.w + x]);
  const add = (x: number, y: number) => {
    const n = y * m.w + x;
    if (seen.has(n) || !ok(at(x, y))) return;
    seen.add(n);
    q.push(n);
  };
  while (q.length) {
    const c = q.pop()!;
    const x = c % m.w;
    const y = (c - x) / m.w;
    for (const [dx, dy] of DIRS) {
      add(x + dx, y + dy);
      if (!grapple) continue;
      // 말뚝: 사이가 물·바닥이고 2~7칸 앞에 있으면 그 너머로
      for (let d = 1; d <= 7; d++) {
        const k = at(x + dx * d, y + dy * d);
        if (k === T.POST) {
          if (d >= 2) add(x + dx * (d + 1), y + dy * (d + 1));
          break;
        }
        if (!flyable(k)) break;
      }
    }
  }
  return seen;
}
const nextTo = (m: FloorMap, seen: Set<number>, x: number, y: number) => DIRS.some(([dx, dy]) => seen.has((y + dy) * m.w + x + dx));

describe('층 만들기', () => {
  it('같은 씨앗·같은 층이면 같은 층, 층·씨앗마다 다르다', () => {
    const a = generateFloor(77, 3);
    expect(generateFloor(77, 3)).toEqual(a);
    expect(generateFloor(77, 4).tiles).not.toEqual(a.tiles);
    expect(generateFloor(78, 3).tiles).not.toEqual(a.tiles);
  });

  it('층 구성: 2층 쥐 · 7층 소 · 12층 용 · 17층 뱀 구슬, 5·15층 상점, 9·19층 정예, 10층 골렘 · 20층 이무기 (보스 뒤 계단)', () => {
    const orbs: Record<number, string> = { 2: 'rat', 7: 'ox', 12: 'dragon', 17: 'snake' };
    for (let seed = 1; seed <= 30; seed++) {
      for (let f = 1; f <= 20; f++) {
        const m = generateFloor(seed, f);
        const kind = m.kind;
        const n = m.rooms.length;
        // 큰 길(시작 + 전투 3~4 + 구슬 + 계단) + 곁방 2~3
        if (kind === 'normal' || kind === 'elite') expect(n, `${seed}:${f}`).toBeGreaterThanOrEqual(7), expect(n).toBeLessThanOrEqual(10);
        if (kind === 'normal') expect(m.rooms.filter((r) => r.side).length, `${seed}:${f} 곁방`).toBeGreaterThanOrEqual(2);
        expect(m.objs.find((o) => o.kind === 'pedestal')?.orb).toBe(orbs[f]);
        expect(m.objs.some((o) => o.kind === 'shop')).toBe(f % 10 === 5);
        expect(m.rooms.some((r) => r.kind === 'elite')).toBe(f % 10 === 9);
        expect(m.rooms.some((r) => r.spawns.some((s) => s.def === 'golem'))).toBe(f === 10);
        expect(m.rooms.some((r) => r.spawns.some((s) => s.def === 'imugi'))).toBe(f === 20);
        expect(m.stairsHidden).toBe(f % 10 === 0);
        // 전투방은 무리가 여럿 (한 무리 3~6마리)
        for (const r of m.rooms.filter((x) => x.kind === 'combat')) {
          const waves = new Set(r.spawns.map((s) => s.wave));
          expect(waves.size, `${seed}:${f} 무리`).toBeGreaterThanOrEqual(2);
          for (const w of waves) {
            const k = r.spawns.filter((s) => s.wave === w).length;
            expect(k).toBeGreaterThanOrEqual(3);
            expect(k).toBeLessThanOrEqual(6);
          }
        }
      }
    }
  });

  it('2구역 적은 2구역 것만 (이끼 낀 회랑)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (let f = 11; f <= 19; f++) {
        const ids = new Set(generateFloor(seed, f).rooms.flatMap((r) => r.spawns.map((s) => s.def)));
        for (const id of ids) expect(['sprout', 'moth', 'lizard', 'toad', 'treant']).toContain(id);
      }
    }
  });

  it('갇히는 곳이 없다: 계단·구슬·상점·상자에 닿고, 스위치는 참격으로 맞힐 자리가, 말뚝 너머 상자는 감아 건널 자리가 있다 (1~20층 × 씨앗 40개)', () => {
    let posts = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let f = 1; f <= 20; f++) {
        const m = generateFloor(seed * 7919, f);
        const walk = reach(m);
        const all = reach(m, true, true);
        for (const o of m.objs) {
          const at = o.y * m.w + o.x;
          if (o.kind === 'stairs') expect(walk.has(at), `${seed}:${f} 계단`).toBe(true);
          if (o.kind === 'pedestal' || o.kind === 'shop' || o.kind === 'fountain') expect(nextTo(m, walk, o.x, o.y), `${seed}:${f} ${o.kind}`).toBe(true);
          if (o.kind === 'chest') expect(nextTo(m, o.table === 'puzzle' ? all : walk, o.x, o.y), `${seed}:${f} 상자`).toBe(true);
          if (o.kind === 'plate') expect(walk.has(at), `${seed}:${f} 발판`).toBe(true);
          if (o.kind === 'brazier') expect(nextTo(m, walk, o.x, o.y), `${seed}:${f} 화로`).toBe(true);
          if (o.kind === 'post') posts++;
          if (o.kind === 'switch') {
            let ok = false;
            for (const [dx, dy] of DIRS) {
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
        // 말뚝으로 건너간 곳에서도 다시 돌아올 수 있다 (계단에 닿는다)
        const stairs = m.objs.find((o) => o.kind === 'stairs')!;
        expect(all.has(stairs.y * m.w + stairs.x)).toBe(true);
      }
    }
    expect(posts).toBeGreaterThan(0);
  });

  it('21층부터는 구조만 (적 데이터가 없어도 층은 만들어진다)', () => {
    for (const f of [21, 25, 30, 55, 100]) {
      const m = generateFloor(5, f);
      expect(m.rooms.length).toBeGreaterThanOrEqual(2);
      expect(m.rooms.every((r) => r.spawns.length === 0)).toBe(true);
    }
  });
});

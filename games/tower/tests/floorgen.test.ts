import { describe, expect, it } from 'vitest';
import { zoneData } from '../src/data';
import { T, TILE, flyable, generateFloor, walkable, type FloorMap } from '../src/game/floorgen';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** 시작 자리부터 걸어 닿는 칸 (opened = 철문·바위를 연 뒤, grapple = 뱀 구슬로 말뚝을 감아 건넌다) */
function reach(m: FloorMap, opened = false, grapple = false) {
  // opened: 철문·바위를 열고, 찬물을 얼리고, 구덩이를 메운 뒤
  const ok = (t: number) => walkable(t) || (opened && (t === T.GATE || t === T.ROCK || t === T.COLD_WATER || t === T.PIT));
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

  it('층 구성: 구슬 받침대(2·7·12·17·22·27·32·37·42·47층, 30·50층은 보스방에 숨은 전설 구슬), 휴식층 상점, 정예, 보스 (보스 뒤 계단)', () => {
    const orbs: Record<number, string> = { 2: 'rat', 7: 'ox', 12: 'dragon', 17: 'snake', 22: 'rabbit', 27: 'monkey', 30: 'turtle', 32: 'rooster', 37: 'sheep', 42: 'dog', 47: 'tiger', 50: 'phoenix' };
    const bosses: Record<number, string> = { 10: 'golem', 20: 'imugi', 30: 'winterGeneral', 40: 'yeongdeung', 50: 'bulgasari' };
    for (let seed = 1; seed <= 30; seed++) {
      for (let f = 1; f <= 50; f++) {
        const m = generateFloor(seed, f);
        const kind = m.kind;
        const n = m.rooms.length;
        // 큰 길(시작 + 전투 3~4 + 구슬 + 계단) + 곁방 2~3
        if (kind === 'normal' || kind === 'elite') expect(n, `${seed}:${f}`).toBeGreaterThanOrEqual(7), expect(n).toBeLessThanOrEqual(10);
        if (kind === 'normal') expect(m.rooms.filter((r) => r.side).length, `${seed}:${f} 곁방`).toBeGreaterThanOrEqual(2);
        const ped = m.objs.find((o) => o.kind === 'pedestal');
        expect(ped?.orb, `${seed}:${f}`).toBe(orbs[f]);
        // 보스층 받침대는 숨어 있다 (보스를 쓰러뜨리면 솟아오른다)
        if (ped) expect(!!ped.hidden).toBe(kind === 'boss');
        if (ped?.hidden) expect(m.tiles[ped.y * m.w + ped.x]).toBe(T.FLOOR);
        expect(m.objs.some((o) => o.kind === 'shop')).toBe(f % 10 === 5);
        expect(m.rooms.some((r) => r.kind === 'elite')).toBe(f % 10 === 9);
        for (const [bf, id] of Object.entries(bosses)) expect(m.rooms.some((r) => r.spawns.some((s) => s.def === id)), `${seed}:${f} ${id}`).toBe(f === Number(bf));
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

  it('구역마다 그 구역 적만 (2~5구역), 정예는 x9층에만', () => {
    for (let zone = 2; zone <= 5; zone++) {
      const z = zoneData(zone * 10)!;
      for (let seed = 1; seed <= 10; seed++) {
        for (let f = zone * 10 - 9; f <= zone * 10 - 1; f++) {
          const ids = new Set(generateFloor(seed, f).rooms.flatMap((r) => r.spawns.map((s) => s.def)));
          for (const id of ids) expect([...z.enemies, ...(f % 10 === 9 ? [z.elite] : [])], `${f}층`).toContain(id);
          if (f % 10 === 9) expect(ids.has(z.elite)).toBe(true);
        }
      }
    }
  });

  it('구역 전투방 템플릿은 그 구역에서만 (이끼 · 서리 · 구름 · 잿불)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (let f = 11; f <= 50; f++) {
        const zone = Math.ceil(f / 10);
        for (const r of generateFloor(seed, f).rooms) {
          const m = r.tpl.match(/^combat-(moss|frost|cloud|ember)-/);
          if (m) expect({ moss: 2, frost: 3, cloud: 4, ember: 5 }[m[1]], `${f}층 ${r.tpl}`).toBe(zone);
        }
      }
    }
  });

  it('갇히는 곳이 없다: 계단·구슬·상점·상자에 닿고, 스위치·풍경·징은 쏠 자리가, 말뚝 너머 상자는 감아 건널 자리가, 구덩이는 굴릴 바위가 있다 (1~50층 × 씨앗 40개)', () => {
    let posts = 0;
    const seen = { bell: 0, gong: 0, pit: 0, cold: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      for (let f = 1; f <= 50; f++) {
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
          if (o.kind === 'bell' || o.kind === 'gong') {
            // 줄을 맞춰 쏠 자리 (풍경 4~5칸 · 징 1~8칸), 사이는 날아갈 수 있는 칸 또는 같은 징
            seen[o.kind]++;
            let ok = false;
            for (const [dx, dy] of DIRS) {
              for (let d = 1; d <= 8 && !ok; d++) {
                if (!walk.has((o.y + dy * d) * m.w + o.x + dx * d)) continue;
                let clear = true;
                for (let k = 1; k < d; k++) {
                  const t = m.tiles[(o.y + dy * k) * m.w + o.x + dx * k];
                  if (!flyable(t) && t !== T.GONG) clear = false;
                }
                ok ||= clear;
              }
            }
            expect(ok, `${seed}:${f} ${o.kind}`).toBe(true);
          }
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
        // 구덩이: 같은 줄에 바닥만 사이에 둔 둥근 바위가 있고, 바위 뒤에 설 자리가 있다
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            const t = m.tiles[y * m.w + x];
            if (t === T.COLD_WATER) seen.cold++;
            if (t !== T.PIT) continue;
            seen.pit++;
            let ok = false;
            for (const [dx, dy] of DIRS) {
              let k = 1;
              while (m.tiles[(y + dy * k) * m.w + x + dx * k] === T.FLOOR) k++;
              if (m.tiles[(y + dy * k) * m.w + x + dx * k] === T.BOULDER && walk.has((y + dy * (k + 1)) * m.w + x + dx * (k + 1))) ok = true;
            }
            expect(ok, `${seed}:${f} 구덩이`).toBe(true);
          }
        }
        // 말뚝으로 건너간 곳에서도 다시 돌아올 수 있다 (계단에 닿는다)
        const stairs = m.objs.find((o) => o.kind === 'stairs')!;
        expect(all.has(stairs.y * m.w + stairs.x)).toBe(true);
      }
    }
    expect(posts).toBeGreaterThan(0);
    for (const k of Object.keys(seen) as (keyof typeof seen)[]) expect(seen[k], k).toBeGreaterThan(0);
  }, 60_000);

  it('51층부터는 구조만 (적 데이터가 없어도 층은 만들어진다)', () => {
    for (const f of [51, 55, 60, 75, 100]) {
      const m = generateFloor(5, f);
      expect(m.rooms.length).toBeGreaterThanOrEqual(2);
      expect(m.rooms.every((r) => r.spawns.length === 0)).toBe(true);
    }
  });
});

/**
 * 층 갇힘 검사 (tests/floorgen*.test.ts 가 나눠 쓴다): 시작 자리부터 걸어 닿는 칸, 퍼즐을 다 푼 뒤 닿는 칸, 퍼즐마다 풀 자리가 있는지.
 */
import { expect } from 'vitest';
import { T, TILE, flyable, walkable, type FloorMap } from '../src/game/floorgen';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const at = (m: FloorMap, x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? T.VOID : m.tiles[y * m.w + x]);

/** 시작 자리부터 걸어 닿는 칸 (opened = 철문·바위·쇠창살을 열고, 찬물을 얼리고, 구름을 걷고, 구름 덩이를 밀어 구덩이를 메운 뒤 · grapple = 뱀 구슬로 말뚝을 감아 건넌다) */
export function reach(m: FloorMap, opened = false, grapple = false) {
  const ok = (t: number) => walkable(t) || (opened && (t === T.GATE || t === T.ROCK || t === T.COLD_WATER || t === T.PIT || t === T.BARS || t === T.FOG || t === T.PUFF));
  const s = Math.floor(m.start.y / TILE) * m.w + Math.floor(m.start.x / TILE);
  const seen = new Set<number>([s]);
  const q = [s];
  const add = (x: number, y: number) => {
    const n = y * m.w + x;
    if (seen.has(n) || !ok(at(m, x, y))) return;
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
        const k = at(m, x + dx * d, y + dy * d);
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
export const nextTo = (m: FloorMap, seen: Set<number>, x: number, y: number) => DIRS.some(([dx, dy]) => seen.has((y + dy) * m.w + x + dx));

/** 스위치에서 거꾸로 빛을 따라가 (거울에서 꺾으며) 걸어 닿는 칸에 이르나 — 거울 없이 곧게는 2~7칸, 거울을 거치면 12칸 안 */
function switchShootable(m: FloorMap, walk: Set<number>, sx: number, sy: number): boolean {
  for (const [ddx, ddy] of DIRS) {
    let [dx, dy] = [ddx, ddy];
    let x = sx;
    let y = sy;
    let mirrors = 0;
    for (let i = 1; i <= 12; i++) {
      x += dx;
      y += dy;
      const t = at(m, x, y);
      if (t === T.MIRROR_A) {
        [dx, dy] = [-dy, -dx];
        mirrors++;
        continue;
      }
      if (t === T.MIRROR_B) {
        [dx, dy] = [dy, dx];
        mirrors++;
        continue;
      }
      if (!flyable(t)) break;
      if (walk.has(y * m.w + x) && (mirrors > 0 || (i >= 2 && i <= 7))) return true;
    }
  }
  return false;
}

/** 한 층의 갇힘 검사. 센 것 (풍경·징·구덩이·찬물·뇌석·구름 덩이·거울·짙은 구름·쇠창살·말뚝) 을 seen 에 더한다 */
export function checkFloor(m: FloorMap, tag: string, seen: Record<string, number>) {
  const walk = reach(m);
  const all = reach(m, true, true);
  const inc = (k: string) => (seen[k] = (seen[k] ?? 0) + 1);
  for (const o of m.objs) {
    const idx = o.y * m.w + o.x;
    if (o.kind === 'stairs') expect(walk.has(idx), `${tag} 계단`).toBe(true);
    if (o.kind === 'pedestal' || o.kind === 'shop' || o.kind === 'fountain' || o.kind === 'wish') expect(nextTo(m, walk, o.x, o.y), `${tag} ${o.kind}`).toBe(true);
    if (o.kind === 'chest') expect(nextTo(m, o.table === 'puzzle' ? all : walk, o.x, o.y), `${tag} 상자`).toBe(true);
    if (o.kind === 'plate') expect(walk.has(idx), `${tag} 발판`).toBe(true);
    if (o.kind === 'brazier') expect(nextTo(m, walk, o.x, o.y), `${tag} 화로`).toBe(true);
    if (o.kind === 'post') inc('post');
    if (o.kind === 'bell' || o.kind === 'gong') {
      // 줄을 맞춰 쏠 자리 (풍경 4~5칸 · 징 1~8칸), 사이는 날아갈 수 있는 칸 또는 같은 징
      inc(o.kind);
      let ok = false;
      for (const [dx, dy] of DIRS) {
        for (let d = 1; d <= 8 && !ok; d++) {
          if (!walk.has((o.y + dy * d) * m.w + o.x + dx * d)) continue;
          let clear = true;
          for (let k = 1; k < d; k++) {
            const t = at(m, o.x + dx * k, o.y + dy * k);
            if (!flyable(t) && t !== T.GONG) clear = false;
          }
          ok ||= clear;
        }
      }
      expect(ok, `${tag} ${o.kind}`).toBe(true);
    }
    if (o.kind === 'switch') {
      if (m.rooms[o.room].tpl.includes('-mirror')) inc('mirror');
      expect(switchShootable(m, walk, o.x, o.y), `${tag} 스위치`).toBe(true);
    }
  }
  // 뇌석: 방마다 셋이 한 사슬(가장 가까운 것으로 56 안)로 이어지는 첫 뇌석이 있고, 그 둘레 80 안에 설 자리가 있다
  for (const room of new Set(m.objs.filter((o) => o.kind === 'rod').map((o) => o.room))) {
    inc('rod');
    const rods = m.objs.filter((o) => o.kind === 'rod' && o.room === room).map((o) => ({ x: o.x * TILE + 8, y: o.y * TILE + 8 }));
    const chainFrom = (r0: { x: number; y: number }) => {
      const hit = [r0];
      let cur = r0;
      for (let i = 0; i < 2; i++) {
        const nx = rods.filter((q) => !hit.includes(q) && Math.hypot(q.x - cur.x, q.y - cur.y) <= 56).sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y))[0];
        if (!nx) break;
        hit.push(nx);
        cur = nx;
      }
      return hit.length === rods.length;
    };
    const ok = rods.some((r0) => chainFrom(r0) && [...walk].some((c) => {
      const x = (c % m.w) * TILE + 8;
      const y = Math.floor(c / m.w) * TILE + 4;
      const d = Math.hypot(x - r0.x, y - r0.y);
      return d <= 80 && d >= 20 && rods.every((q) => q === r0 || Math.hypot(x - q.x, y - q.y) > d);
    }));
    expect(ok, `${tag} 뇌석`).toBe(true);
  }
  // 구덩이: 같은 줄에 바닥만 사이에 둔 둥근 바위(뒤에 설 자리) 또는 구름 덩이(뒤로 1~5칸 날아갈 수 있는 칸 너머에 설 자리)
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const t = m.tiles[y * m.w + x];
      if (t === T.COLD_WATER) inc('cold');
      if (t === T.FOG) inc('fog');
      if (t === T.BARS) inc('bars');
      if (t !== T.PIT) continue;
      inc('pit');
      let ok = false;
      for (const [dx, dy] of DIRS) {
        let k = 1;
        while (at(m, x + dx * k, y + dy * k) === T.FLOOR) k++;
        const b = at(m, x + dx * k, y + dy * k);
        if (b === T.BOULDER && walk.has((y + dy * (k + 1)) * m.w + x + dx * (k + 1))) ok = true;
        if (b === T.PUFF) {
          inc('puff');
          for (let d = 1; d <= 5; d++) {
            const tx = x + dx * (k + d);
            const ty = y + dy * (k + d);
            if (walk.has(ty * m.w + tx)) ok = true;
            if (!flyable(at(m, tx, ty))) break;
          }
        }
      }
      expect(ok, `${tag} 구덩이`).toBe(true);
    }
  }
  // 말뚝으로 건너간 곳에서도 다시 돌아올 수 있다 (계단에 닿는다)
  const stairs = m.objs.find((o) => o.kind === 'stairs')!;
  expect(all.has(stairs.y * m.w + stairs.x)).toBe(true);
}

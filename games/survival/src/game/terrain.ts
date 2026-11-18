/**
 * 지형 (PRD 6장): 대나무가 길을 막는 숲 · 담으로 길이 좁은 궁궐 · 삼도천 물길이 흐르는 황천길.
 * 필드는 끝없이 넓으므로 장애물을 미리 만들어 두지 않고, 칸 좌표와 판의 시드로 "이 칸에 무엇이 있나" 를 그때그때 계산한다
 * (같은 시드면 언제나 같은 자리에 같은 장애물). 장애물은 모두 원이고, 한 칸의 장애물은 칸 가장자리에서 떨어져 있어
 * 일반 요괴·내 캐릭터는 자기가 있는 칸만 보면 된다.
 */
import type { TerrainDef } from '../data/maps';

/** 장애물이 칸 가장자리에서 떨어져 있는 거리 (가장 큰 일반 요괴의 반지름보다 크게) */
export const EDGE = 40;
/** 시작 자리 둘레에는 장애물을 두지 않는다 */
const CLEAR = 220;
/** 한 칸의 장애물 수 상한 */
export const CELL_MAX = 4;

/** 칸 하나의 장애물을 담는 통: x, y, r 가 차례로 */
export const OBS = new Float32Array(CELL_MAX * 3);

function hash(cx: number, cy: number, seed: number, salt: number): number {
  let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(seed + salt, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** 칸 (cx, cy) 의 장애물을 out 에 담고 개수를 돌려준다 */
export function cellObstacles(t: TerrainDef, seed: number, cx: number, cy: number, out: Float32Array = OBS): number {
  if (t.kind === 'none') return 0;
  if (hash(cx, cy, seed, 1) >= t.chance) return 0;
  const C = t.cell;
  const mx = cx * C + C / 2;
  const my = cy * C + C / 2;
  let n = 0;
  const put = (x: number, y: number, r: number) => {
    // 시작 자리 둘레는 비운다
    if (x * x + y * y < (CLEAR + r) * (CLEAR + r)) return;
    out[n * 3] = x;
    out[n * 3 + 1] = y;
    out[n * 3 + 2] = r;
    n++;
  };
  if (t.kind === 'scatter') {
    // 대나무: 한 칸에 1~3포기가 흩어져 있다
    const count = 1 + Math.floor(hash(cx, cy, seed, 2) * 3);
    for (let i = 0; i < count; i++) {
      const r = t.r * (0.85 + hash(cx, cy, seed, 10 + i) * 0.3);
      const room = C / 2 - EDGE - r;
      put(mx + (hash(cx, cy, seed, 20 + i) * 2 - 1) * room, my + (hash(cx, cy, seed, 30 + i) * 2 - 1) * room, r);
    }
  } else if (t.kind === 'walls') {
    // 담: 원 네 개가 한 줄로 이어진다 (가로 또는 세로). 담 사이로 좁은 길이 난다
    const horizontal = hash(cx, cy, seed, 2) < 0.5;
    const gap = t.r * 1.7;
    for (let i = 0; i < CELL_MAX; i++) {
      const o = (i - (CELL_MAX - 1) / 2) * gap;
      put(mx + (horizontal ? o : 0), my + (horizontal ? 0 : o), t.r);
    }
  } else {
    // 물길: 크기가 다른 원 세 개가 겹쳐 웅덩이 하나가 된다
    for (let i = 0; i < 3; i++) {
      const r = t.r * (0.8 + hash(cx, cy, seed, 10 + i) * 0.35);
      const a = hash(cx, cy, seed, 20 + i) * Math.PI * 2;
      const d = i === 0 ? 0 : t.r * 0.75;
      put(mx + Math.cos(a) * d, my + Math.sin(a) * d, r);
    }
  }
  return n;
}

/** 마지막으로 밀려난 방향 (장애물 → 몸) */
export const PUSH = { x: 0, y: 0 };
const POS = { x: 0, y: 0 };

/**
 * 원(x, y, r)이 장애물과 겹치면 밖으로 밀어낸다. 결과 자리는 OUT 에, 닿았으면 true (PUSH 에 밀려난 방향).
 * 자기가 있는 칸만 본다 (장애물이 칸 가장자리에서 EDGE 만큼 떨어져 있어서, 반지름이 EDGE 보다 작은 몸은 이것으로 충분하다).
 *
 * smooth (내 캐릭터): 담처럼 원이 줄지어 이어진 곳에서 원과 원 사이의 오목한 틈에 걸려 멈추지 않게 한다.
 *   · 이어진 담의 두 원 사이는 곧은 벽(두 원을 감싼 알약 모양)으로 보고 밀어낸다 → 담을 따라 미끄러진다
 *   · 가장 깊이 겹친 것부터 밀어내고, 밀려난 자리가 옆 장애물에 다시 겹칠 수 있으므로 세 번까지 되풀이한다
 * 요괴는 smooth 없이 예전과 같이 움직인다 (돌아가는 길 찾기는 enemies.ts 의 avoid).
 */
export function pushOut(t: TerrainDef, seed: number, x: number, y: number, r: number, smooth = false): boolean {
  POS.x = x;
  POS.y = y;
  if (t.kind === 'none') return false;
  const n = cellObstacles(t, seed, Math.floor(x / t.cell), Math.floor(y / t.cell));
  let hit = false;
  if (smooth) {
    const chain = t.kind === 'walls';
    for (let pass = 0; pass < 3; pass++) {
      // 가장 깊이 겹친 장애물 하나에서만 밀어낸다 (차례대로 밀면 옆 원의 둥근 끝에 밀려 뒤로 물러난다)
      let depth = 0;
      let bx = 0;
      let by = 0;
      let bd = 0;
      let brr = 0;
      for (let i = 0; i < n; i++) {
        let ox = OBS[i * 3];
        let oy = OBS[i * 3 + 1];
        const rr = r + OBS[i * 3 + 2];
        if (chain && i + 1 < n) {
          // 다음 원과 이어져 있으면(겹치면) 두 원의 가운데를 잇는 선분에서 가장 가까운 점을 장애물의 가운데로 본다
          const ex = OBS[i * 3 + 3] - ox;
          const ey = OBS[i * 3 + 4] - oy;
          const len2 = ex * ex + ey * ey;
          const reach = OBS[i * 3 + 2] + OBS[i * 3 + 5];
          if (len2 > 0 && len2 < reach * reach) {
            const k = Math.max(0, Math.min(1, ((POS.x - ox) * ex + (POS.y - oy) * ey) / len2));
            ox += ex * k;
            oy += ey * k;
          }
        }
        const dx = POS.x - ox;
        const dy = POS.y - oy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        if (rr - d <= depth) continue;
        depth = rr - d;
        bx = ox;
        by = oy;
        bd = d;
        brr = rr;
      }
      if (depth <= 0) break;
      // 정확히 한가운데면 오른쪽으로
      const nx = bd > 0.001 ? (POS.x - bx) / bd : 1;
      const ny = bd > 0.001 ? (POS.y - by) / bd : 0;
      POS.x = bx + nx * brr;
      POS.y = by + ny * brr;
      PUSH.x = nx;
      PUSH.y = ny;
      hit = true;
    }
    return hit;
  }
  for (let i = 0; i < n; i++) {
    const dx = POS.x - OBS[i * 3];
    const dy = POS.y - OBS[i * 3 + 1];
    const rr = r + OBS[i * 3 + 2];
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    // 정확히 한가운데면 오른쪽으로
    const nx = d > 0.001 ? dx / d : 1;
    const ny = d > 0.001 ? dy / d : 0;
    POS.x = OBS[i * 3] + nx * rr;
    POS.y = OBS[i * 3 + 1] + ny * rr;
    PUSH.x = nx;
    PUSH.y = ny;
    hit = true;
  }
  return hit;
}
export const OUT = POS;

/** 그 자리가 장애물 안인가 (반지름 r 의 몸이 겹치는가) */
export function blocked(t: TerrainDef, seed: number, x: number, y: number, r = 0): boolean {
  if (t.kind === 'none') return false;
  const n = cellObstacles(t, seed, Math.floor(x / t.cell), Math.floor(y / t.cell));
  for (let i = 0; i < n; i++) {
    const dx = x - OBS[i * 3];
    const dy = y - OBS[i * 3 + 1];
    const rr = r + OBS[i * 3 + 2];
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

const EACH = new Float32Array(CELL_MAX * 3);

/**
 * 사각형(가운데 x, y · 반너비 hw · 반높이 hh) 안팎의 장애물을 모두 돌며 fn 을 부른다 (화면 그리기·조작 정책용).
 */
export function eachObstacle(t: TerrainDef, seed: number, x: number, y: number, hw: number, hh: number, fn: (ox: number, oy: number, r: number, id: number) => void) {
  if (t.kind === 'none') return;
  const c0 = Math.floor((x - hw) / t.cell);
  const c1 = Math.floor((x + hw) / t.cell);
  const r0 = Math.floor((y - hh) / t.cell);
  const r1 = Math.floor((y + hh) / t.cell);
  const buf = EACH;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const n = cellObstacles(t, seed, cx, cy, buf);
      for (let i = 0; i < n; i++) fn(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2], ((cx * 31 + cy) * CELL_MAX + i) | 0);
    }
  }
}

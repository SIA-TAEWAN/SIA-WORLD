import { CELL } from '../data/balance';
import type { Cell, RouteDef } from '../data/stages';

/**
 * 길 계산. 길(route) = 꺾이는 점들을 잇는 선. 요괴의 위치는 '길을 따라 온 거리(d)' 하나로 정해진다.
 * 여러 입구·갈림·합류는 길 여러 개로, 공중 직선 경로는 air 길로 표현한다 (data/stages.ts).
 */
export interface Route {
  id: string;
  air: boolean;
  /** 꺾이는 점 (px) */
  xs: number[];
  ys: number[];
  /** 점까지의 누적 거리 (acc[0] = 0) */
  acc: number[];
  /** 전체 길이 */
  len: number;
}

/** 칸 좌표 → 칸 가운데의 px */
export const cellX = (c: number) => (c + 0.5) * CELL;
export const cellY = (r: number) => (r + 0.5) * CELL;

export function buildRoute(def: RouteDef): Route {
  const xs = def.pts.map((p: Cell) => cellX(p[0]));
  const ys = def.pts.map((p: Cell) => cellY(p[1]));
  const acc = [0];
  for (let i = 1; i < xs.length; i++) acc.push(acc[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  return { id: def.id, air: !!def.air, xs, ys, acc, len: acc[acc.length - 1] };
}

/** 길 위의 한 점 (routePos 가 채운다) */
export interface PathPoint {
  x: number;
  y: number;
  /** 진행 방향 (단위 벡터) */
  dx: number;
  dy: number;
  /** 지금 있는 구간 번호 (다음에 찾을 때의 시작점) */
  seg: number;
}

export const makePoint = (): PathPoint => ({ x: 0, y: 0, dx: 1, dy: 0, seg: 0 });

/** 길을 따라 d 만큼 온 자리. seg 는 지난번 구간(없으면 0): 요괴는 앞으로만 가므로 거기서부터 찾는다 */
export function routePos(r: Route, d: number, seg: number, out: PathPoint): PathPoint {
  const last = r.xs.length - 2;
  let i = seg < 0 || seg > last || r.acc[seg] > d ? 0 : seg;
  while (i < last && r.acc[i + 1] <= d) i++;
  const span = r.acc[i + 1] - r.acc[i] || 1;
  const k = Math.max(0, Math.min(1, (d - r.acc[i]) / span));
  const ax = r.xs[i];
  const ay = r.ys[i];
  const bx = r.xs[i + 1];
  const by = r.ys[i + 1];
  out.x = ax + (bx - ax) * k;
  out.y = ay + (by - ay) * k;
  out.dx = (bx - ax) / span;
  out.dy = (by - ay) / span;
  out.seg = i;
  return out;
}

/** 점에서 선분까지의 거리 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** 점에서 가장 가까운 땅 위 길까지의 거리 (배치 칸이 길을 밟지 않는지 확인할 때) */
export function distToRoad(routes: readonly Route[], x: number, y: number): number {
  let best = Infinity;
  for (const r of routes) {
    if (r.air) continue;
    for (let i = 0; i + 1 < r.xs.length; i++) best = Math.min(best, segDist(x, y, r.xs[i], r.ys[i], r.xs[i + 1], r.ys[i + 1]));
  }
  return best;
}

/**
 * (x, y) 에서 사거리 range 안에 들어오는 길의 길이 (px). 배치 칸이 얼마나 좋은 자리인지 잴 때 쓴다 (자동 배치 정책).
 * 판 안(0 ≤ x ≤ w, 0 ≤ y ≤ h)의 길만 센다.
 */
export function coverage(routes: readonly Route[], x: number, y: number, range: number, w: number, h: number): number {
  const STEP = 8;
  const p = makePoint();
  let sum = 0;
  for (const r of routes) {
    for (let d = 0; d <= r.len; d += STEP) {
      routePos(r, d, p.seg, p);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= range * range) sum += STEP;
    }
  }
  return sum;
}

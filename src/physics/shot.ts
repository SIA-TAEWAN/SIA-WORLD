import type { WeaponDef } from '../game/data';
import type { ShellTrack, SimEvent, TankState } from '../game/types';
import { Terrain } from './terrain';

export const DT = 1 / 60;
export const GRAVITY = 320;
export const WIND_K = 6;
export const TANK_HIT_R = 13;
export const MAX_FRAMES = 60 * 14;
const OWNER_ARM_FRAMES = 25;
const PROXIMITY = 26;

export function tankCenter(t: TankState): { x: number; y: number } {
  return { x: t.x, y: t.y - 11 };
}

/** 포신 끝 좌표 (angleDeg = 실제 발사각, tiltDeg = 몸체 기울기) */
export function muzzle(t: { x: number; y: number }, facing: number, angleDeg: number, tiltDeg = 0) {
  const a = (angleDeg * Math.PI) / 180;
  const k = (tiltDeg * Math.PI) / 180;
  const px = t.x - Math.sin(k) * 14;
  const py = t.y - Math.cos(k) * 14;
  return { x: px + facing * Math.cos(a) * 20, y: py - Math.sin(a) * 20 };
}

export interface ShotWorld {
  terrain: Terrain;
  tanks: TankState[];
  wind: number;
}

export interface Volley {
  /** 몇 프레임 뒤에 발사되는지 */
  at: number;
}

export interface ShotParams {
  owner: number;
  facing: 1 | -1;
  angle: number;
  power: number;
  weapon: WeaponDef;
  damageMul: number;
  /** 같은 무기를 몇 번 발사하는지 (더블샷이면 2) */
  volleys: number;
  /** 몸체 기울기 (포신 받침 위치) */
  tilt?: number;
  /** 필살기 (화면 표시용) */
  big?: boolean;
}

interface Shell {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  bounces: number;
  drillLeft: number;
  drilling: boolean;
  dropped: boolean;
  /** 분열탄에서 갈라져 나온 탄 */
  child: boolean;
  alive: boolean;
  track: ShellTrack;
}

export interface ImpactHandler {
  /** 폭발 처리. 실제 시뮬레이션에서만 호출된다. */
  explode(f: number, x: number, y: number, directTarget: number | null): void;
  build(f: number, x: number, y: number): void;
  carveLine(f: number, x1: number, y1: number, x2: number, y2: number, r: number): void;
  /** 착탄 지점에 하늘에서 수직 레이저 */
  laser(f: number, x: number, y: number): void;
}

export interface FlightOutcome {
  frames: number;
  shells: ShellTrack[];
  impacts: { x: number; y: number; target: number | null }[];
}

/**
 * 포탄 비행 시뮬레이션. 고정 프레임(60fps)으로 계산하므로 같은 입력이면 항상 같은 결과가 나온다.
 * handler가 없으면 지형을 바꾸지 않는 '미리보기'로, 첫 착탄에서 멈춘다 (AI 조준용).
 */
export function fly(world: ShotWorld, p: ShotParams, handler: ImpactHandler | null): FlightOutcome {
  const { terrain, tanks } = world;
  const w = p.weapon;
  const owner = tanks[p.owner];
  const start = muzzle(owner, p.facing, p.angle, p.tilt ?? 0);
  const a = (p.angle * Math.PI) / 180;
  const speed = (Math.max(0, Math.min(100, p.power)) / 100) * w.speed;

  const pending: number[] = [];
  for (let v = 0; v < p.volleys; v++) {
    for (let c = 0; c < w.count; c++) pending.push(v * 36 + c * 14);
  }
  pending.sort((x, y) => x - y);

  const shells: Shell[] = [];
  const impacts: FlightOutcome['impacts'] = [];
  let nextId = 0;
  let f = 0;
  const windAcc = world.wind * WIND_K;

  const end = (s: Shell) => {
    s.alive = false;
  };

  const hitTank = (x: number, y: number, s: Shell): number | null => {
    for (const t of tanks) {
      if (!t.alive) continue;
      if (t.idx === p.owner && s.age < OWNER_ARM_FRAMES) continue;
      const c = tankCenter(t);
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy <= TANK_HIT_R * TANK_HIT_R) return t.idx;
    }
    return null;
  };

  // 드릴·바운스탄은 적 탱크 가까이 가면 바로 터진다
  const nearEnemy = (x: number, y: number, r: number): number | null => {
    for (const t of tanks) {
      if (!t.alive || t.team === owner.team) continue;
      const c = tankCenter(t);
      if ((x - c.x) ** 2 + (y - c.y) ** 2 <= r * r) return t.idx;
    }
    return null;
  };

  const impact = (s: Shell, x: number, y: number, target: number | null) => {
    impacts.push({ x, y, target });
    end(s);
    if (!handler) return;
    if (w.behavior === 'build') handler.build(f, x, y);
    else if (w.behavior === 'laser') handler.laser(f, x, y);
    else handler.explode(f, x, y, target);
  };

  while (f < MAX_FRAMES) {
    while (pending.length && pending[0] <= f) {
      pending.shift();
      const s: Shell = {
        id: nextId++,
        x: start.x,
        y: start.y,
        vx: p.facing * Math.cos(a) * speed,
        vy: -Math.sin(a) * speed,
        age: 0,
        bounces: w.bounces ?? 0,
        drillLeft: w.drillDistance ?? 0,
        drilling: false,
        dropped: false,
        child: false,
        alive: true,
        track: { id: 0, spawn: f, path: [start.x, start.y], behavior: w.behavior, look: w.look, big: p.big },
      };
      s.track.id = s.id;
      shells.push(s);
    }

    let anyAlive = false;
    const born: Shell[] = [];
    for (const s of shells) {
      if (!s.alive) continue;
      s.age++;

      // 분열탄: 꼭대기에서 여러 발로 갈라진다
      if (w.behavior === 'split' && !s.child && s.vy >= 0 && s.age > 8) {
        const n = w.split ?? 3;
        for (let i = 0; i < n; i++) {
          const k = i - (n - 1) / 2;
          const c: Shell = {
            ...s,
            id: nextId++,
            vx: s.vx + k * (w.spread ?? 40),
            vy: s.vy - Math.abs(k) * 6,
            child: true,
            track: { id: 0, spawn: f, path: [s.x, s.y], behavior: 'split', look: w.look, big: p.big },
          };
          c.track.id = c.id;
          born.push(c);
        }
        s.track.path.push(s.x, s.y);
        end(s);
        anyAlive = true;
        continue;
      }

      if (s.drilling) {
        // 드릴: 중력 없이 직진하며 굴을 판다
        const sp = Math.hypot(s.vx, s.vy) || 1;
        const step = Math.min(s.drillLeft, sp * DT);
        const nx = s.x + (s.vx / sp) * step;
        const ny = s.y + (s.vy / sp) * step;
        handler?.carveLine(f, s.x, s.y, nx, ny, w.drillWidth ?? 8);
        s.x = nx;
        s.y = ny;
        s.drillLeft -= step;
        const t = hitTank(s.x, s.y, s) ?? nearEnemy(s.x, s.y, PROXIMITY);
        if (t !== null || s.drillLeft <= 0.01 || s.y > terrain.h || s.x < 0 || s.x > terrain.w) {
          impact(s, s.x, s.y, t);
        }
        s.track.path.push(s.x, s.y);
        if (s.alive) anyAlive = true;
        continue;
      }

      if (w.behavior === 'drop' && !s.dropped && s.vy >= 0) {
        s.dropped = true;
        s.vx = 0;
      }
      const wm = s.dropped ? 0 : w.wind;
      s.vx += windAcc * wm * DT;
      s.vy += GRAVITY * DT;

      const dx = s.vx * DT;
      const dy = s.vy * DT;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
      for (let i = 0; i < n && s.alive; i++) {
        const px = s.x;
        const py = s.y;
        s.x += dx / n;
        s.y += dy / n;
        const t = hitTank(s.x, s.y, s);
        if (t !== null) {
          impact(s, s.x, s.y, t);
          break;
        }
        if (w.behavior === 'bounce' && s.bounces < (w.bounces ?? 0) && nearEnemy(s.x, s.y, PROXIMITY) !== null) {
          impact(s, s.x, s.y, null);
          break;
        }
        if (terrain.solid(s.x, s.y)) {
          if (w.behavior === 'bounce' && s.bounces > 0) {
            const nrm = terrain.normal(s.x, s.y);
            const dot = s.vx * nrm.nx + s.vy * nrm.ny;
            if (dot < 0) {
              s.vx = (s.vx - 2 * dot * nrm.nx) * 0.62;
              s.vy = (s.vy - 2 * dot * nrm.ny) * 0.62;
            }
            s.x = px;
            s.y = py;
            s.bounces--;
            if (Math.hypot(s.vx, s.vy) < 70) impact(s, px, py, null);
            break;
          }
          if (w.behavior === 'drill' && handler) {
            s.drilling = true;
            break;
          }
          impact(s, s.x, s.y, null);
          break;
        }
        if (s.x < -150 || s.x > terrain.w + 150 || s.y > terrain.h + 60) {
          end(s);
        }
      }
      s.track.path.push(s.x, s.y);
      if (s.alive) anyAlive = true;
    }

    shells.push(...born);
    f++;
    if (!handler && impacts.length) break;
    if (!anyAlive && pending.length === 0) break;
  }

  return { frames: f, shells: shells.map((s) => s.track), impacts };
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const l2 = vx * vx + vy * vy;
  let t = l2 ? ((px - x1) * vx + (py - y1) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

export type { SimEvent };

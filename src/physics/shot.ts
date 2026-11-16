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
/** 굴러가는 탄: 프레임당 굴러가는 칸 수, 오를 수 있는 턱, 떨어져도 계속 구르는 높이 */
const ROLL_STEPS = 3;
const ROLL_CLIMB = 6;
const ROLL_DROP = 8;

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
  /** 굴러가는 탄 상태 */
  rolling: boolean;
  rolled: boolean;
  rollDir: number;
  rollLeft: number;
  /** 물수제비: 남은 튐 횟수, 지금까지 터진 횟수 */
  hopsLeft: number;
  hopN: number;
  alive: boolean;
  track: ShellTrack;
}

export interface ImpactHandler {
  /** 폭발 처리. 실제 시뮬레이션에서만 호출된다. */
  explode(f: number, x: number, y: number, directTarget: number | null, craterScale?: number): void;
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

  // 물수제비탄은 튈 때마다 구덩이가 작아진다
  const HOP_SCALE = [1, 0.65, 0.4, 0.3];
  /** 절구처럼 나중에 하늘에서 떨어지는 탄 */
  const later: Shell[] = [];
  const impact = (s: Shell, x: number, y: number, target: number | null) => {
    impacts.push({ x, y, target });
    end(s);
    if (!handler) return;
    if (w.behavior === 'meteor' && !s.child) {
      // 맞은 자리 위 하늘에서 큰 절구가 떨어진다
      const m: Shell = { ...s, id: nextId++, x, y: -90, vx: 0, vy: 260, age: 99, child: true, alive: true, track: { id: 0, spawn: f + 1, path: [x, -90], behavior: 'meteor', look: w.look, big: p.big } };
      m.track.id = m.id;
      later.push(m);
      return;
    }
    if (w.behavior === 'firework') {
      // 폭죽: 맞은 자리 주변에서 다섯 번 (위치는 좌표로 정해지는 의사난수 → 모든 기기에서 같다)
      handler.explode(f, x, y, target);
      for (let i = 1; i < 5; i++) {
        const h = Math.sin(x * 12.9898 + y * 78.233 + i * 37.719) * 43758.5453;
        const r1 = h - Math.floor(h);
        const h2 = Math.sin(x * 39.346 + y * 11.135 + i * 83.155) * 24634.6345;
        const r2 = h2 - Math.floor(h2);
        handler.explode(f + i * 9, x + (r1 - 0.5) * 130, y - 10 + (r2 - 0.5) * 70, null);
      }
      return;
    }
    if (w.behavior === 'build') handler.build(f, x, y);
    else if (w.behavior === 'laser') {
      handler.laser(f, x, y);
      // 열두빛: 주변에 무작위로 더 내리꽂는다 (좌표로 정해지는 의사난수 → 모든 기기에서 같다)
      for (let i = 1; i < (w.lasers ?? 1); i++) {
        const h = Math.sin(x * 12.9898 + y * 78.233 + i * 51.17) * 43758.5453;
        const r = h - Math.floor(h);
        const lx = Math.max(4, Math.min(terrain.w - 4, x + (r - 0.5) * 220));
        let ly = 0;
        while (ly < terrain.h && !terrain.solid(Math.round(lx), ly)) ly++;
        handler.laser(f + i * 14, lx, ly);
      }
    }
    else handler.explode(f, x, y, target, HOP_SCALE[Math.min(s.hopN, 3)]);
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
        rolling: false,
        rolled: false,
        rollDir: p.facing,
        rollLeft: 0,
        hopsLeft: w.hops ?? 0,
        hopN: 0,
        alive: true,
        track: { id: 0, spawn: f, path: [start.x, start.y], behavior: w.behavior, look: w.look, big: p.big && w.behavior !== 'firework' },
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

      if (s.rolling) {
        // 땅 위를 굴러간다: 작은 턱은 넘고, 벽에 막히거나 거리를 다 가면 터진다
        for (let i = 0; i < ROLL_STEPS && s.alive && s.rolling; i++) {
          const nx = s.x + s.rollDir;
          let ny = s.y;
          let k = 0;
          while (k <= ROLL_CLIMB && terrain.solid(nx, ny)) {
            ny--;
            k++;
          }
          if (k > ROLL_CLIMB || nx < 0 || nx > terrain.w) {
            impact(s, s.x, s.y, null);
            break;
          }
          let dd = 0;
          while (dd <= ROLL_DROP && !terrain.solid(nx, ny + 1) && ny < terrain.h) {
            ny++;
            dd++;
          }
          s.x = nx;
          s.y = ny;
          if (dd > ROLL_DROP) {
            // 낭떠러지: 다시 날아서 떨어진다 (다음 착지에 터짐)
            s.rolling = false;
            s.rolled = true;
            s.vx = s.rollDir * 90;
            s.vy = 0;
            break;
          }
          s.rollLeft--;
          const t = hitTank(s.x, s.y - 3, s);
          if (t !== null || nearEnemy(s.x, s.y - 3, PROXIMITY) !== null || s.rollLeft <= 0) {
            impact(s, s.x, s.y, t);
            break;
          }
        }
        s.track.path.push(s.x, s.y);
        if (s.alive) anyAlive = true;
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

      // 유도탄: 꼭대기를 지나면 가장 가까운 적 쪽으로 조금씩 꺾는다
      if (w.behavior === 'homing' && s.vy >= 0) {
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        for (const t of tanks) {
          if (!t.alive || t.team === owner.team) continue;
          const c = tankCenter(t);
          const d = (c.x - s.x) ** 2 + (c.y - s.y) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        if (best) {
          const cur = Math.atan2(s.vy, s.vx);
          let diff = Math.atan2(best.y - s.y, best.x - s.x) - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const max = (((w.homing ?? 45) * Math.PI) / 180) * DT;
          const na = cur + Math.max(-max, Math.min(max, diff));
          const sp = Math.hypot(s.vx, s.vy);
          s.vx = Math.cos(na) * sp;
          s.vy = Math.sin(na) * sp;
        }
      }

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
          if (w.behavior === 'skip' && s.hopsLeft > 0) {
            // 터지고 앞으로 다시 튀어 오른다
            impacts.push({ x: s.x, y: s.y, target: null });
            if (!handler) {
              end(s);
              break;
            }
            handler.explode(f, s.x, s.y, null, HOP_SCALE[Math.min(s.hopN, 3)]);
            s.hopsLeft--;
            s.hopN++;
            s.x = px;
            s.y = py - 3;
            const dir = s.vx > 0 ? 1 : s.vx < 0 ? -1 : p.facing;
            s.vx = dir * Math.max(110, Math.abs(s.vx) * 0.7);
            s.vy = -175;
            break;
          }
          if (w.behavior === 'drill' && handler) {
            s.drilling = true;
            break;
          }
          if (w.behavior === 'roll' && !s.rolled) {
            s.rolling = true;
            s.rollDir = s.vx > 0 ? 1 : s.vx < 0 ? -1 : p.facing;
            s.rollLeft = w.rollDistance ?? 120;
            s.x = px;
            s.y = py;
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

    shells.push(...born, ...later.splice(0));
    f++;
    if (!handler && impacts.length) break;
    if (!anyAlive && pending.length === 0 && shells.every((s) => !s.alive)) break;
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

import { ENEMY_LEAK, LIMIT } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import { makePoint, routePos } from './path';
import { EV, FX, addFx, emit, type Enemy, type State } from './state';

/** 계산의 기본 동작: 요괴 내보내기 · 과녁 찾기 · 피해 주기 (공격 방식·보스 행동이 함께 쓴다) */

const P = makePoint();

/** 요괴의 자리를 길 위의 거리(d)에 맞춘다 */
export function placeOnRoute(s: State, e: Enemy) {
  routePos(s.routes[e.route], e.d, e.seg, P);
  e.x = P.x;
  e.y = P.y;
  e.dx = P.dx;
  e.dy = P.dy;
  e.seg = P.seg;
}

/**
 * 요괴(kind) 또는 보스(boss)를 길(route)의 d 지점에 내보낸다. 자리가 없으면 null.
 * 보스의 졸개 소환도 이 함수를 쓴다.
 */
export function spawnEnemy(s: State, kind: number, boss: number, route: number, hpMul: number, d = 0): Enemy | null {
  let i = 0;
  while (i < s.enemyHi && s.enemies[i].alive) i++;
  if (i >= LIMIT.enemies) return null;
  const e = s.enemies[i];
  if (i >= s.enemyHi) s.enemyHi = i + 1;
  s.enemyN++;
  e.alive = true;
  e.uid = ++s.uid;
  e.kind = kind;
  e.boss = boss;
  e.route = route;
  e.d = d;
  e.seg = 0;
  e.mul = 1;
  e.stun = e.guard = e.flash = e.t = 0;
  e.a = e.b = e.c = 0;
  if (boss >= 0) {
    const def = BOSSES[boss];
    e.hp = e.maxHp = Math.round(def.hp * hpMul);
    e.speed = def.speed;
    e.r = def.r;
    e.bounty = def.bounty;
    e.leak = def.leak;
    e.air = false;
  } else {
    const def = ENEMIES[kind];
    e.hp = e.maxHp = Math.round(def.hp * hpMul);
    // 같은 무리라도 걸음이 조금씩 다르다 (±5%, 시드 난수)
    e.speed = def.speed * (0.95 + s.rng() * 0.1);
    e.r = def.r;
    e.bounty = def.bounty;
    e.leak = ENEMY_LEAK;
    e.air = !!def.air;
  }
  placeOnRoute(s, e);
  return e;
}

/** 출구까지 남은 거리 (작을수록 앞선 요괴) */
export const remaining = (s: State, e: Enemy) => s.routes[e.route].len - e.d;

/**
 * (x, y) 에서 사거리 안에 있는 요괴 가운데 출구에 가장 가까운 것 → 요괴 칸 번호 (없으면 -1).
 * skip: 이 uid 의 요괴는 뺀다 (두 번째 과녁을 고를 때)
 */
export function findTarget(s: State, x: number, y: number, range: number, skip = -1): number {
  const r2 = range * range;
  let best = -1;
  let bestRem = Infinity;
  for (let i = 0; i < s.enemyHi; i++) {
    const e = s.enemies[i];
    if (!e.alive || e.uid === skip) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy > r2) continue;
    const rem = s.routes[e.route].len - e.d;
    if (rem < bestRem) {
      bestRem = rem;
      best = i;
    }
  }
  return best;
}

/** 피해를 준다. 쓰러지면 기운을 얻는다 */
export function hurt(s: State, e: Enemy, dmg: number) {
  if (!e.alive) return;
  e.hp -= dmg;
  e.flash = 0.12;
  if (e.hp > 0) return;
  e.hp = 0;
  e.alive = false;
  s.enemyN--;
  s.kills++;
  s.energy += e.bounty;
  addFx(s, FX.pop, e.x, e.y, e.r * 1.6, 0.3);
  if (e.boss >= 0) {
    s.bossDown = true;
    emit(s, EV.bossDown, e.boss, 0, e.x, e.y);
  } else emit(s, EV.kill, e.kind, e.bounty, e.x, e.y);
}

/** (x, y) 둘레 radius 안의 모든 요괴에게 피해 (요괴의 몸 크기만큼 넉넉하게) */
export function hurtAround(s: State, x: number, y: number, radius: number, dmg: number) {
  for (let i = 0; i < s.enemyHi; i++) {
    const e = s.enemies[i];
    if (!e.alive) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const rr = radius + e.r;
    if (dx * dx + dy * dy <= rr * rr) hurt(s, e, dmg);
  }
}

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
  e.look = -1;
  e.route = route;
  e.d = d;
  e.seg = 0;
  e.mul = 1;
  e.stun = e.guard = e.flash = e.t = 0;
  e.slowT = e.vuln = e.dotT = e.dot = e.rush = e.seen = e.down = e.gone = e.armor = e.cyc = 0;
  e.slow = 1;
  e.on = false;
  e.a = e.b = e.c = 0;
  if (boss >= 0) {
    const def = BOSSES[boss];
    e.hp = e.maxHp = Math.round(def.hp * hpMul);
    e.speed = def.speed;
    e.r = def.r;
    e.bounty = def.bounty * s.gain;
    e.leak = def.leak;
    e.air = false;
    e.regen = 0;
    e.shield = def.shield ?? 1;
    e.stealth = e.ghost = false;
    e.revive = 0;
  } else {
    const def = ENEMIES[kind];
    e.hp = e.maxHp = Math.round(def.hp * hpMul);
    // 같은 무리라도 걸음이 조금씩 다르다 (±5%, 시드 난수)
    e.speed = def.speed * (0.95 + s.rng() * 0.1);
    e.r = def.r;
    e.bounty = def.bounty * s.gain;
    e.leak = ENEMY_LEAK;
    e.air = !!def.air;
    e.regen = def.regen ?? 0;
    e.shield = def.shield ?? 1;
    e.stealth = !!def.stealth;
    e.ghost = !!def.ghost;
    e.revive = def.revive ?? 0;
    // 주기 특성: 무리가 한꺼번에 켜지고 꺼지지 않게 시작을 어긋나게 한다
    if (def.cycle) {
      e.on = true;
      e.cyc = def.cycle.on * (0.4 + s.rng() * 0.6);
    }
  }
  placeOnRoute(s, e);
  return e;
}

/** 출구까지 남은 거리 (작을수록 앞선 요괴) */
export const remaining = (s: State, e: Enemy) => s.routes[e.route].len - e.d;

/** 지금 노릴 수 있는 요괴인가. air: 공중 요괴를 맞힐 수 있는 캐릭터인가 */
export function canTarget(e: Enemy, air: boolean): boolean {
  // (다치지 않는 동안의 요괴 — 마디가 남은 왕지네의 머리 — 는 노리지 않는다: 헛공격을 하지 않게)
  return e.alive && e.down <= 0 && e.gone <= 0 && e.armor < 1 && (air || !e.air) && !(e.stealth && e.on && e.seen <= 0);
}

/** 과녁 고르는 방식: 출구에 가장 가까운 요괴 · 체력이 가장 많은 요괴 · 공중 요괴 먼저 */
export const AIM = { first: 0, strong: 1, air: 2 } as const;

/**
 * (x, y) 에서 사거리 안에 있는, 노릴 수 있는 요괴 가운데 하나 → 요괴 칸 번호 (없으면 -1).
 * skip: 이 uid 의 요괴는 뺀다 (두 번째 과녁을 고를 때)
 */
export function findTarget(s: State, x: number, y: number, range: number, air = true, aim = 0, skip = -1): number {
  const r2 = range * range;
  let best = -1;
  let bestV = Infinity;
  for (let i = 0; i < s.enemyHi; i++) {
    const e = s.enemies[i];
    if (e.uid === skip || !canTarget(e, air)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy > r2) continue;
    // 값이 작을수록 먼저: 남은 거리 / (체력이 많을수록 작게) / (공중이면 크게 당긴다)
    let v = s.routes[e.route].len - e.d;
    if (aim === AIM.strong) v = -e.hp;
    else if (aim === AIM.air && e.air) v -= 1e6;
    if (v < bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

/** 요괴가 쓰러졌다: 되살아나는 요괴는 잠깐 누웠다가 일어나고, 아니면 사라지며 기운을 준다 */
function fall(s: State, e: Enemy) {
  if (e.revive > 0) {
    e.revive--;
    e.down = 2;
    e.hp = e.maxHp * 0.5;
    e.dotT = e.stun = 0;
    addFx(s, FX.puff, e.x, e.y, e.r * 1.4, 0.3);
    return;
  }
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

/**
 * 피해를 준다. 쓰러지면 기운을 얻는다.
 * fx · fy: 공격이 온 자리 (정면 방패 계산). 적지 않으면 방패를 무시한다 (관통·범위 폭발·독)
 */
export function hurt(s: State, e: Enemy, dmg: number, fx = NaN, fy = NaN) {
  if (!e.alive || e.down > 0 || e.gone > 0) return;
  // 무적인 동안 · 다치지 않는 동안(armor 1)에는 피해가 없다
  if ((e.ghost && e.on) || e.armor >= 1) return;
  let v = dmg * (1 - e.armor);
  if (e.slowT > 0 && e.vuln > 0) v *= 1 + e.vuln;
  // 정면 방패: 요괴가 가는 쪽에 있는 캐릭터의 공격은 덜 받는다
  if (e.shield < 1 && fx === fx && (fx - e.x) * e.dx + (fy - e.y) * e.dy > 0) v *= e.shield;
  e.hp -= v;
  e.flash = 0.12;
  if (e.hp <= 0) fall(s, e);
}

/** 독·불: 걸음마다 조금씩. 방패를 무시하고, 번쩍이지 않는다 */
export function burn(s: State, e: Enemy, dmg: number) {
  if ((e.ghost && e.on) || e.armor >= 1 || e.gone > 0 || e.down > 0) return;
  e.hp -= dmg * (1 - e.armor);
  if (e.hp <= 0) fall(s, e);
}

/** (x, y) 둘레 radius 안의 모든 요괴에게 피해 (요괴의 몸 크기만큼 넉넉하게). air: 공중 요괴도 맞나 */
export function hurtAround(s: State, x: number, y: number, radius: number, dmg: number, air = false) {
  for (let i = 0; i < s.enemyHi; i++) {
    const e = s.enemies[i];
    if (!e.alive || (e.air && !air)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const rr = radius + e.r;
    if (dx * dx + dy * dy <= rr * rr) hurt(s, e, dmg);
  }
}

/** 독·불을 건다: 초당 dps 로 sec 초 (더 센 것이 남는다) */
export function ignite(e: Enemy, dps: number, sec: number) {
  if (e.dotT <= 0 || dps >= e.dot) e.dot = dps;
  if (sec > e.dotT) e.dotT = sec;
}

/** 멈춘다 (멈춤이 풀린 직후의 요괴는 다시 멈추지 않는다. 보스는 짧게) */
export function stunEnemy(e: Enemy, sec: number, bossMul: number) {
  if (e.stun <= 0 && e.guard <= 0) e.stun = sec * (e.boss >= 0 ? bossMul : 1);
}

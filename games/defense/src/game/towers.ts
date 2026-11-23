import { BOSS_STUN_MUL } from '../data/balance';
import { TOWERS, type AttackKind, type TowerLevel } from '../data/characters';
import { AIM, canTarget, findTarget, hurt, hurtAround, ignite, stunEnemy } from './core';
import { makePoint, routePos } from './path';
import { FX, PROJ, addFx, take, type Enemy, type State, type Tower } from './state';

/**
 * 공격 방식 표 (data/characters.ts 의 kind). 함수 하나 = 공격 한 번: 사거리 안에 노릴 요괴가 없으면 false 를 돌려주고 아무것도 하지 않는다.
 * 새 공격 방식은 여기에 함수를 더한다. 수치는 모두 L(그 캐릭터의 지금 단계, 영구 레벨이 반영된 값)에서 읽는다.
 */
export type Attack = (s: State, slot: number, tw: Tower, L: TowerLevel) => boolean;

/** 투사체가 나는 빠르기 (px/초, PROJ 순서) · 달떡이 날아가는 시간 (초) · 감속이 이어지는 시간 */
const PROJ_SPEED = [640, 0, 520, 1200, 620, 520, 420];
const LOB_SEC = 0.5;
const SLOW_SEC = 0.75;

const P = makePoint();
const aimOf = (char: number) => {
  const t = TOWERS[char].target;
  return t === 'strong' ? AIM.strong : t === 'air' ? AIM.air : t === 'weak' ? AIM.weak : AIM.first;
};

function face(s: State, slot: number, tw: Tower, e: Enemy) {
  const dx = e.x - s.slotX[slot];
  if (dx > 2) tw.face = 1;
  else if (dx < -2) tw.face = -1;
}

function shoot(s: State, slot: number, tw: Tower, target: number, side: number) {
  const p = take(s.projectiles);
  if (!p) return;
  const e = s.enemies[target];
  p.kind = TOWERS[tw.char].proj ?? PROJ.shuriken;
  p.x = p.sx = s.slotX[slot] + side * 10;
  p.y = p.sy = s.slotY[slot] - 14;
  p.target = target;
  p.uid = e.uid;
  p.tx = e.x;
  p.ty = e.y;
  p.speed = PROJ_SPEED[p.kind] ?? 640;
  p.char = tw.char;
  p.lv = tw.lv - 1;
  p.t = 0;
  p.dur = 0;
}

/** 던지는 공격 (표창·독·화살·돌·깃털·강아지): 과녁에게 날아가 맞으면 그 캐릭터의 효과를 준다 */
const shot: Attack = (s, slot, tw, L) => {
  const x = s.slotX[slot];
  const y = s.slotY[slot];
  const def = TOWERS[tw.char];
  const first = findTarget(s, x, y, L.range, def.air, aimOf(tw.char));
  if (first < 0) return false;
  face(s, slot, tw, s.enemies[first]);
  const n = L.count ?? 1;
  shoot(s, slot, tw, first, n > 1 ? -1 : 0);
  // 둘째부터는 다음 요괴에게 (하나뿐이면 같은 요괴에게)
  for (let k = 1; k < n; k++) {
    const other = findTarget(s, x, y, L.range, def.air, aimOf(tw.char), s.enemies[first].uid);
    shoot(s, slot, tw, other >= 0 ? other : first, 1);
  }
  return true;
};

export const ATTACKS: Record<AttackKind, Attack> = {
  shot,
  poison: shot,

  /** 소: 방울을 울려 사거리 안의 땅 위 요괴를 모두 잠깐 멈춘다 (멈춤이 풀린 직후의 요괴는 다시 멈추지 않는다) */
  stun(s, slot, _tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    if (findTarget(s, x, y, L.range, false) < 0) return false;
    const r2 = L.range * L.range;
    for (let i = 0; i < s.enemyHi; i++) {
      const e = s.enemies[i];
      if (!canTarget(e, false)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      stunEnemy(e, L.stun ?? 0, BOSS_STUN_MUL);
      hurt(s, e, L.dmg);
    }
    addFx(s, FX.pulse, x, y, L.range, 0.4);
    return true;
  },

  /** 호랑이: 가장 앞선 요괴를 크게 벤다. splash 가 있으면 그 둘레의 요괴도 함께 */
  melee(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const i = findTarget(s, x, y, L.range, false);
    if (i < 0) return false;
    const e = s.enemies[i];
    face(s, slot, tw, e);
    const ex = e.x;
    const ey = e.y;
    addFx(s, FX.slash, ex, ey, L.splash ? L.splash : 34, 0.22, Math.atan2(ey - y, ex - x));
    hurt(s, e, L.dmg, x, y);
    if (L.splash) {
      for (let k = 0; k < s.enemyHi; k++) {
        const o = s.enemies[k];
        if (k === i || !o.alive || o.air) continue;
        const rr = L.splash + o.r;
        if ((o.x - ex) * (o.x - ex) + (o.y - ey) * (o.y - ey) <= rr * rr) hurt(s, o, L.dmg, x, y);
      }
    }
    return true;
  },

  /** 토끼: 가장 앞선 요괴가 갈 자리로 달떡을 던진다. 떨어진 자리 둘레에 피해 */
  lob(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const i = findTarget(s, x, y, L.range, false);
    if (i < 0) return false;
    const e = s.enemies[i];
    face(s, slot, tw, e);
    const p = take(s.projectiles);
    if (!p) return true;
    // 떡이 떨어질 때 요괴가 있을 자리를 겨눈다 (멈춰 있는 요괴는 그 자리)
    const route = s.routes[e.route];
    const ahead = e.stun > 0 ? 0 : e.speed * e.mul * (e.slowT > 0 ? e.slow : 1) * LOB_SEC;
    routePos(route, Math.min(route.len, e.d + ahead), e.seg, P);
    p.kind = PROJ.cake;
    p.x = p.sx = x;
    p.y = p.sy = y - 14;
    p.target = -1;
    p.uid = 0;
    p.tx = P.x;
    p.ty = P.y;
    p.speed = 0;
    p.char = tw.char;
    p.lv = tw.lv - 1;
    p.t = 0;
    p.dur = LOB_SEC;
    return true;
  },

  /** 용: 가장 앞선 요괴 쪽으로 사거리 끝까지 광선을 쏜다. 광선에 닿은 요괴가 모두 맞는다 (방패를 무시한다) */
  beam(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const i = findTarget(s, x, y, L.range, true);
    if (i < 0) return false;
    const t = s.enemies[i];
    face(s, slot, tw, t);
    const len = Math.hypot(t.x - x, t.y - y) || 1;
    const ux = (t.x - x) / len;
    const uy = (t.y - y) / len;
    const w = L.width ?? 20;
    for (let k = 0; k < s.enemyHi; k++) {
      const e = s.enemies[k];
      if (!e.alive) continue;
      // 광선(길이 = 사거리) 위에 내린 발과 그 거리
      const along = (e.x - x) * ux + (e.y - y) * uy;
      if (along < 0 || along > L.range + e.r) continue;
      const side = Math.abs((e.x - x) * uy - (e.y - y) * ux);
      if (side > w + e.r) continue;
      hurt(s, e, L.dmg);
      if (L.burn && e.alive) ignite(e, L.burn, L.burnSec ?? 2);
    }
    addFx(s, FX.beam, x, y - 10, L.range, 0.22, Math.atan2(uy, ux));
    return true;
  },

  /** 양: 사거리 안의 요괴를 느리게 한다 (공중 요괴도). vuln 이 있으면 느려진 동안 피해를 더 받는다 */
  slow(s, slot, _tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const r2 = L.range * L.range;
    let any = false;
    for (let i = 0; i < s.enemyHi; i++) {
      const e = s.enemies[i];
      if (!e.alive || e.gone > 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      any = true;
      // 더 센 감속이 남는다
      if (e.slowT <= 0 || (L.slow ?? 1) < e.slow) e.slow = L.slow ?? 1;
      e.slowT = SLOW_SEC;
      if ((L.vuln ?? 0) > e.vuln) e.vuln = L.vuln ?? 0;
    }
    if (any) addFx(s, FX.cloud, x, y, L.range, 0.5);
    return any;
  },

  /** 돼지: 공격하지 않는다 (웨이브가 시작될 때 기운을 번다 — sim.ts) */
  bank: () => false,

  /**
   * 고양이: 사거리 안에서 남은 체력이 가장 적은 요괴에게 달려들어 바로 할퀸다 (투사체 없음, 공중 요괴도).
   * execute 가 있으면 할퀸 뒤 체력이 그 비율 이하로 남은 요괴(보스·보스의 분신 제외)는 바로 쓰러진다 (쓰러진 자리는 FX.pop)
   */
  pounce(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const i = findTarget(s, x, y, L.range, TOWERS[tw.char].air, aimOf(tw.char));
    if (i < 0) return false;
    const e = s.enemies[i];
    face(s, slot, tw, e);
    addFx(s, FX.slash, e.x, e.y, 30, 0.18, Math.atan2(e.y - y, e.x - x));
    hurt(s, e, L.dmg, x, y);
    if (L.execute && e.alive && e.down <= 0 && e.boss < 0 && e.look < 0 && e.hp <= e.maxHp * L.execute) hurt(s, e, Infinity);
    return true;
  },
};

/** 투사체가 맞았다: 던진 캐릭터의 효과를 준다 */
function land(s: State, e: Enemy, char: number, lv: number, sx: number, sy: number) {
  const L = s.lv[char][lv];
  let dmg = L.dmg;
  if (e.boss >= 0 && L.bossMul) dmg *= L.bossMul;
  if (e.air && L.airMul) dmg *= L.airMul;
  if (L.stun) stunEnemy(e, L.stun, BOSS_STUN_MUL);
  hurt(s, e, dmg, sx, sy);
  if (!L.poison) return;
  // 독: 초당 피해 + 최대 체력에 비례 (보스는 1/4). 3단계는 둘레의 요괴에게도 번진다
  const dur = L.dur ?? 4;
  const venom = (o: Enemy) => ignite(o, L.poison! + o.maxHp * (L.poisonPct ?? 0) * (o.boss >= 0 || o.look >= 0 ? 0.25 : 1), dur);
  if (e.alive) venom(e);
  if (L.splash) {
    for (let k = 0; k < s.enemyHi; k++) {
      const o = s.enemies[k];
      if (o === e || !o.alive || o.gone > 0) continue;
      const rr = L.splash + o.r;
      if ((o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y) <= rr * rr) venom(o);
    }
    addFx(s, FX.puff, e.x, e.y, L.splash, 0.3);
  }
}

/** 투사체 한 걸음. 다 됐으면(맞았거나 사라졌으면) true */
export function stepProjectile(s: State, i: number, dt: number): boolean {
  const p = s.projectiles.items[i];
  if (p.kind === PROJ.cake) {
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * k;
    p.y = p.sy + (p.ty - p.sy) * k;
    if (k < 1) return false;
    const L = s.lv[p.char][p.lv];
    hurtAround(s, p.tx, p.ty, L.splash ?? 0, L.dmg);
    addFx(s, FX.burst, p.tx, p.ty, L.splash ?? 0, 0.3);
    return true;
  }
  // 쫓아가는 투사체: 과녁이 살아 있으면 그 자리로, 사라졌으면 마지막으로 본 자리까지 날아가 없어진다
  const e = s.enemies[p.target];
  const live = e.alive && e.uid === p.uid && e.gone <= 0 && e.down <= 0;
  if (live) {
    p.tx = e.x;
    p.ty = e.y;
  }
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dist = Math.hypot(dx, dy);
  const move = p.speed * dt;
  if (dist <= move + (live ? e.r * 0.5 : 0)) {
    if (live) land(s, e, p.char, p.lv, p.sx, p.sy);
    return true;
  }
  p.x += (dx / dist) * move;
  p.y += (dy / dist) * move;
  return false;
}

import { BOSS_STUN_MUL } from '../data/balance';
import type { AttackKind, TowerLevel } from '../data/characters';
import { findTarget, hurt, hurtAround } from './core';
import { makePoint, routePos } from './path';
import { FX, PROJ, addFx, take, type Enemy, type State, type Tower } from './state';

/**
 * 공격 방식 표 (data/characters.ts 의 kind). 함수 하나 = 공격 한 번: 사거리 안에 요괴가 없으면 false 를 돌려주고 아무것도 하지 않는다.
 * 새 공격 방식(관통 광선·독·감속 구름 …)은 여기에 함수를 더한다.
 */
export type Attack = (s: State, slot: number, tw: Tower, L: TowerLevel) => boolean;

/** 표창이 나는 빠르기 (px/초) · 달떡이 날아가는 시간 (초) */
const SHOT_SPEED = 640;
const LOB_SEC = 0.5;

const P = makePoint();

function face(s: State, slot: number, tw: Tower, e: Enemy) {
  const dx = e.x - s.slotX[slot];
  if (dx > 2) tw.face = 1;
  else if (dx < -2) tw.face = -1;
}

function shoot(s: State, slot: number, target: number, dmg: number, side: number) {
  const p = take(s.projectiles);
  if (!p) return;
  const e = s.enemies[target];
  p.kind = PROJ.shuriken;
  p.x = p.sx = s.slotX[slot] + side * 10;
  p.y = p.sy = s.slotY[slot] - 14;
  p.target = target;
  p.uid = e.uid;
  p.tx = e.x;
  p.ty = e.y;
  p.speed = SHOT_SPEED;
  p.dmg = dmg;
  p.splash = 0;
  p.t = 0;
  p.dur = 0;
}

export const ATTACKS: Record<AttackKind, Attack> = {
  /** 쥐: 가장 앞선 요괴에게 표창. count 가 2면 다음 요괴에게도 (하나뿐이면 둘 다 그 요괴에게) */
  shot(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const first = findTarget(s, x, y, L.range);
    if (first < 0) return false;
    face(s, slot, tw, s.enemies[first]);
    const n = L.count ?? 1;
    shoot(s, slot, first, L.dmg, n > 1 ? -1 : 0);
    for (let k = 1; k < n; k++) {
      const other = findTarget(s, x, y, L.range, s.enemies[first].uid);
      shoot(s, slot, other >= 0 ? other : first, L.dmg, 1);
    }
    return true;
  },

  /** 소: 방울을 울려 사거리 안의 모든 요괴를 잠깐 멈춘다 (멈춤이 풀린 직후의 요괴는 다시 멈추지 않는다) */
  stun(s, slot, _tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    if (findTarget(s, x, y, L.range) < 0) return false;
    const r2 = L.range * L.range;
    for (let i = 0; i < s.enemyHi; i++) {
      const e = s.enemies[i];
      if (!e.alive) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      if (e.stun <= 0 && e.guard <= 0) e.stun = (L.stun ?? 0) * (e.boss >= 0 ? BOSS_STUN_MUL : 1);
      hurt(s, e, L.dmg);
    }
    addFx(s, FX.pulse, x, y, L.range, 0.4);
    return true;
  },

  /** 호랑이: 가장 앞선 요괴를 크게 벤다. splash 가 있으면 그 둘레의 요괴도 함께 */
  melee(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const i = findTarget(s, x, y, L.range);
    if (i < 0) return false;
    const e = s.enemies[i];
    face(s, slot, tw, e);
    const ex = e.x;
    const ey = e.y;
    addFx(s, FX.slash, ex, ey, L.splash ? L.splash : 34, 0.22, Math.atan2(ey - y, ex - x));
    if (L.splash) hurtAround(s, ex, ey, L.splash, L.dmg);
    else hurt(s, e, L.dmg);
    return true;
  },

  /** 토끼: 가장 앞선 요괴가 갈 자리로 달떡을 던진다. 떨어진 자리 둘레에 피해 */
  lob(s, slot, tw, L) {
    const x = s.slotX[slot];
    const y = s.slotY[slot];
    const i = findTarget(s, x, y, L.range);
    if (i < 0) return false;
    const e = s.enemies[i];
    face(s, slot, tw, e);
    const p = take(s.projectiles);
    if (!p) return true;
    // 떡이 떨어질 때 요괴가 있을 자리를 겨눈다 (멈춰 있는 요괴는 그 자리)
    const route = s.routes[e.route];
    const ahead = e.stun > 0 ? 0 : e.speed * e.mul * LOB_SEC;
    routePos(route, Math.min(route.len, e.d + ahead), e.seg, P);
    p.kind = PROJ.cake;
    p.x = p.sx = x;
    p.y = p.sy = y - 14;
    p.target = -1;
    p.uid = 0;
    p.tx = P.x;
    p.ty = P.y;
    p.speed = 0;
    p.dmg = L.dmg;
    p.splash = L.splash ?? 0;
    p.t = 0;
    p.dur = LOB_SEC;
    return true;
  },
};

/** 투사체 한 걸음. 다 됐으면(맞았거나 사라졌으면) true */
export function stepProjectile(s: State, i: number, dt: number): boolean {
  const p = s.projectiles.items[i];
  if (p.kind === PROJ.cake) {
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * k;
    p.y = p.sy + (p.ty - p.sy) * k;
    if (k < 1) return false;
    hurtAround(s, p.tx, p.ty, p.splash, p.dmg);
    addFx(s, FX.burst, p.tx, p.ty, p.splash, 0.3);
    return true;
  }
  // 쫓아가는 투사체: 과녁이 살아 있으면 그 자리로, 사라졌으면 마지막으로 본 자리까지 날아가 없어진다
  const e = s.enemies[p.target];
  const live = e.alive && e.uid === p.uid;
  if (live) {
    p.tx = e.x;
    p.ty = e.y;
  }
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dist = Math.hypot(dx, dy);
  const move = p.speed * dt;
  if (dist <= move + (live ? e.r * 0.5 : 0)) {
    if (live) hurt(s, e, p.dmg);
    return true;
  }
  p.x += (dx / dist) * move;
  p.y += (dy / dist) * move;
  return false;
}

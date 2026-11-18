/**
 * 보스 공통 뼈대: 패턴을 적힌 순서대로 되풀이한다 (data/bosses.ts 의 patterns).
 * 패턴 종류마다 함수 하나를 PATTERNS 에 등록한다. 함수는 그 패턴이 끝났으면 true 를 돌려준다.
 * 체력 바·등장 경고·보물상자는 종류와 상관없이 같다 (core.ts 의 spawnBoss·killEnemy, sim.ts 의 등장 처리).
 */
import { LIMIT, TICK } from '../data/balance';
import { BOSSES, type BossPattern } from '../data/bosses';
import { ENEMY_INDEX } from '../data/enemies';
import { addZone, rand, spawnEnemy } from './core';
import { ZONE, type Enemy, type State } from './state';

/** dx, dy, d: 보스에서 내 캐릭터까지 */
export type BossPatternFn = (s: State, e: Enemy, p: BossPattern, dx: number, dy: number, d: number) => boolean;

function walk(e: Enemy, dx: number, dy: number, d: number, mul = 1) {
  if (d < 1) return;
  const v = (e.speed * mul * TICK) / d;
  e.x += dx * v;
  e.y += dy * v;
}

/** 미리 보여 준 뒤 터지는 범위 공격 (적의 지대) */
function blast(s: State, x: number, y: number, r: number, windup: number, dmg: number) {
  addZone(s, ZONE.warn, 1, 7, -1, x, y, r, windup, 0.25, 9, dmg);
}

/** 쫓아온다 */
const chase: BossPatternFn = (_s, e, p, dx, dy, d) => {
  walk(e, dx, dy, d);
  return e.patT >= (p.dur ?? 3);
};

/** 돌진: 잠깐 멈춰 겨눈 뒤 곧게 내달린다 */
const charge: BossPatternFn = (_s, e, p, dx, dy, d) => {
  const windup = p.windup ?? 0.8;
  if (e.patT < windup) {
    // 겨누는 동안 방향을 계속 맞추다가, 달리기 직전에 굳힌다
    if (d > 1) {
      e.ax = dx / d;
      e.ay = dy / d;
    }
    return false;
  }
  const v = (p.speed ?? 500) * TICK;
  e.x += e.ax * v;
  e.y += e.ay * v;
  return e.patT >= windup + (p.dur ?? 0.6);
};

/** 주변 충격파: 제자리에서 힘을 모았다가 자기 둘레를 터뜨린다 */
const shockwave: BossPatternFn = (s, e, p) => {
  const windup = p.windup ?? 1;
  if (e.sub === 0) {
    e.sub = 1;
    blast(s, e.x, e.y, p.r ?? 200, windup, p.dmg ?? 20);
  }
  return e.patT >= windup + 0.35;
};

/** 내려찍기: 내 자리에 여러 번 내려찍는다 */
const slam: BossPatternFn = (s, e, p, dx, dy, d) => {
  const count = p.count ?? 3;
  const gap = p.gap ?? 0.5;
  walk(e, dx, dy, d, 0.35);
  if (e.sub < count && e.patT >= e.sub * gap) {
    e.sub++;
    blast(s, s.player.x, s.player.y, p.r ?? 120, p.windup ?? 0.9, p.dmg ?? 24);
  }
  return e.patT >= (count - 1) * gap + (p.windup ?? 0.9) + 0.3;
};

/** 소환: 요괴를 내 둘레에 불러낸다 */
const summon: BossPatternFn = (s, e, p) => {
  const windup = p.windup ?? 0.8;
  if (e.sub === 0 && e.patT >= windup) {
    e.sub = 1;
    const kind = ENEMY_INDEX[p.enemy ?? 'imp'] ?? 0;
    const n = p.count ?? 8;
    const spread = p.spread ?? 240;
    const a0 = rand(s) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      // 풀에 보스가 들어올 자리는 남겨 둔다
      if (s.enemies.n >= LIMIT.enemyPool - 6) break;
      const a = a0 + (i * Math.PI * 2) / n;
      spawnEnemy(s, kind, s.player.x + Math.cos(a) * spread, s.player.y + Math.sin(a) * spread);
    }
  }
  return e.patT >= windup + 0.5;
};

/** 여러 곳 폭격: 내 자리와 그 둘레 여러 곳을 한꺼번에 터뜨린다 */
const barrage: BossPatternFn = (s, e, p, dx, dy, d) => {
  const windup = p.windup ?? 1.1;
  walk(e, dx, dy, d, 0.3);
  if (e.sub === 0) {
    e.sub = 1;
    const n = p.count ?? 5;
    const spread = p.spread ?? 300;
    blast(s, s.player.x, s.player.y, p.r ?? 140, windup, p.dmg ?? 26);
    for (let i = 1; i < n; i++) {
      const a = rand(s) * Math.PI * 2;
      const r = spread * (0.45 + rand(s) * 0.55);
      blast(s, s.player.x + Math.cos(a) * r, s.player.y + Math.sin(a) * r, p.r ?? 140, windup + i * 0.12, p.dmg ?? 26);
    }
  }
  return e.patT >= windup + 0.12 * (p.count ?? 5) + 0.3;
};

export const PATTERNS: Record<string, BossPatternFn> = { chase, charge, shockwave, slam, summon, barrage, nova: shockwave };

/** 걸음마다: 지금 패턴을 한 걸음 진행하고, 끝났으면 다음 패턴으로 */
export function updateBoss(s: State, e: Enemy, dx: number, dy: number, d: number) {
  const def = BOSSES[e.boss];
  const list = def.patterns;
  if (list.length === 0) {
    // 패턴이 아직 없는 보스(6단계): 쫓아오기만 한다
    walk(e, dx, dy, d);
    return;
  }
  const p = list[e.pat % list.length];
  const done = (PATTERNS[p.kind] ?? chase)(s, e, p, dx, dy, d);
  e.patT += TICK;
  if (done) {
    e.pat = (e.pat + 1) % list.length;
    e.patT = 0;
    e.sub = 0;
  }
}

/** 지금 보스가 힘을 모으는 중인가 (화면에서 떨리게 보여 준다) */
export function bossWinding(e: Enemy): boolean {
  if (e.boss < 0) return false;
  const list = BOSSES[e.boss].patterns;
  if (list.length === 0) return false;
  const p = list[e.pat % list.length];
  return p.windup !== undefined && p.kind !== 'slam' && p.kind !== 'barrage' && e.patT < p.windup;
}

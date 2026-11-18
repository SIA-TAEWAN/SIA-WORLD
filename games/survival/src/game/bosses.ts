/**
 * 보스 공통 뼈대: 패턴을 적힌 순서대로 되풀이한다 (data/bosses.ts 의 patterns).
 * 패턴 종류마다 함수 하나를 PATTERNS 에 등록한다. 함수는 그 패턴이 끝났으면 true 를 돌려준다.
 * 체력 바·등장 경고·보물상자는 종류와 상관없이 같다 (core.ts 의 spawnBoss·killEnemy, sim.ts 의 등장 처리).
 * 패턴이 쓰는 칸: e.patT 패턴 안에서 흐른 시간, e.sub 패턴 안의 단계, e.ax·e.ay 겨눈 방향.
 */
import { LIMIT, TICK, TICKS_PER_SEC } from '../data/balance';
import { BOSSES, BOSS_INDEX, type BossPattern } from '../data/bosses';
import { ENEMY_INDEX } from '../data/enemies';
import { addFx, addProjectile, addZone, dmgGrowth, rand, spawnEnemy } from './core';
import { FX, MODE, PROJ, ZONE, ZONE_OF, type Enemy, type State } from './state';

/** dx, dy, d: 보스에서 내 캐릭터까지 */
export type BossPatternFn = (s: State, e: Enemy, p: BossPattern, dx: number, dy: number, d: number) => boolean;

function walk(e: Enemy, dx: number, dy: number, d: number, mul = 1) {
  if (d < 1) return;
  const v = (e.speed * mul * TICK) / d;
  e.x += dx * v;
  e.y += dy * v;
}

/**
 * 미리 보여 준 뒤 터지는 범위 공격 (적의 지대).
 * 패턴에 linger·tick 이 있으면 터진 뒤에도 바닥에 남아 계속 피해를 주고(불길·독), slow 가 있으면 맞은 나를 느리게 한다.
 */
function blast(s: State, p: BossPattern, x: number, y: number, r: number, windup: number, dmg: number) {
  const z = addZone(s, ZONE_OF[p.zone ?? 'warn'] ?? ZONE.warn, 1, 7, -1, x, y, r, windup, p.linger ?? 0.25, 0.5, dmg);
  if (!z) return;
  z.tick = p.tick ?? 0;
  z.slow = Math.round((p.slow ?? 0) * TICKS_PER_SEC);
}

/** 쫓아온다 */
const chase: BossPatternFn = (_s, e, p, dx, dy, d) => {
  walk(e, dx, dy, d);
  return e.patT >= (p.dur ?? 3);
};

/** 돌진: 잠깐 멈춰 겨눈 뒤 곧게 내달린다. shield 가 있으면 방패를 들어 그동안 받는 피해가 줄어든다 */
const charge: BossPatternFn = (_s, e, p, dx, dy, d) => {
  const windup = p.windup ?? 0.8;
  if (p.shield !== undefined) e.guard = p.shield;
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
    blast(s, p, e.x, e.y, p.r ?? 200, windup, p.dmg ?? 20);
  }
  return e.patT >= windup + 0.35;
};

/** 내려찍기·표식: 내 자리에 여러 번 찍는다. 찍힌 자리는 잠시 뒤 터진다 */
const slam: BossPatternFn = (s, e, p, dx, dy, d) => {
  const count = p.count ?? 3;
  const gap = p.gap ?? 0.5;
  walk(e, dx, dy, d, 0.35);
  if (e.sub < count && e.patT >= e.sub * gap) {
    e.sub++;
    blast(s, p, s.player.x, s.player.y, p.r ?? 120, p.windup ?? 0.9, p.dmg ?? 24);
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

/** 여러 곳 폭격: 내 자리와 그 둘레 여러 곳을 한꺼번에 터뜨린다 (물기둥·독 뿌리기·판결 장판도 이것) */
const barrage: BossPatternFn = (s, e, p, dx, dy, d) => {
  const windup = p.windup ?? 1.1;
  walk(e, dx, dy, d, 0.3);
  if (e.sub === 0) {
    e.sub = 1;
    const n = p.count ?? 5;
    const spread = p.spread ?? 300;
    blast(s, p, s.player.x, s.player.y, p.r ?? 140, windup, p.dmg ?? 26);
    for (let i = 1; i < n; i++) {
      const a = rand(s) * Math.PI * 2;
      const r = spread * (0.45 + rand(s) * 0.55);
      blast(s, p, s.player.x + Math.cos(a) * r, s.player.y + Math.sin(a) * r, p.r ?? 140, windup + i * 0.12, p.dmg ?? 26);
    }
  }
  return e.patT >= windup + 0.12 * (p.count ?? 5) + 0.3;
};

/** 숨기(장산범): 보이지 않고 맞지 않는 채로 사라졌다가, 내 옆(r 거리)에 다시 나타난다 */
const hide: BossPatternFn = (s, e, p) => {
  if (e.sub === 0) {
    e.sub = 1;
    e.hidden = true;
    addFx(s, FX.puff, e.x, e.y, e.r * 1.3, 0, 0, 0.35);
  }
  if (e.patT < (p.dur ?? 1.5)) return false;
  const a = rand(s) * Math.PI * 2;
  e.x = s.player.x + Math.cos(a) * (p.r ?? 240);
  e.y = s.player.y + Math.sin(a) * (p.r ?? 240);
  e.hidden = false;
  addFx(s, FX.puff, e.x, e.y, e.r * 1.3, 0, 0, 0.35);
  return true;
};

/** 탄막(구미호): 사방으로 구슬을 여러 번 쏟아낸다. 쏠 때마다 방향이 조금씩 돈다 */
const bullets: BossPatternFn = (s, e, p) => {
  const windup = p.windup ?? 0.7;
  const waves = p.waves ?? 2;
  const gap = p.gap ?? 0.5;
  if (e.sub < waves && e.patT >= windup + e.sub * gap) {
    const n = p.count ?? 12;
    const speed = p.speed ?? 220;
    const a0 = e.sub * 0.26 + (e.uid % 7) * 0.1;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * Math.PI * 2) / n;
      addProjectile(s, PROJ.orb, MODE.enemy, 7, -1, e.x, e.y, Math.cos(a) * speed, Math.sin(a) * speed, 11, (p.dmg ?? 16) * dmgGrowth(s) * 0.6, 4.2);
    }
    e.sub++;
  }
  return e.patT >= windup + (waves - 1) * gap + 0.4;
};

/** 분신·부하(구미호의 분신, 염라대왕의 저승사자): 보스 모습의 작은 요괴가 쫓아온다 */
const clones: BossPatternFn = (s, e, p) => {
  const windup = p.windup ?? 0.8;
  if (e.sub === 0 && e.patT >= windup) {
    e.sub = 1;
    const n = p.count ?? 3;
    const def = BOSSES[e.boss];
    const look = p.look !== undefined ? (BOSS_INDEX[p.look] ?? e.boss) : e.boss;
    for (let i = 0; i < n; i++) {
      if (s.enemies.n >= LIMIT.enemyPool - 6) break;
      const a = (i * Math.PI * 2) / n + rand(s);
      const c = spawnEnemy(s, ENEMY_INDEX[p.enemy ?? 'wisp'] ?? 0, s.player.x + Math.cos(a) * (p.spread ?? 240), s.player.y + Math.sin(a) * (p.spread ?? 240));
      if (!c) break;
      c.look = look;
      c.maxHp = c.hp = e.maxHp * (p.hp ?? 0.03);
      c.r = 26;
      c.speed = e.speed * 1.15;
      c.dmg = def.dmg * 0.6;
      c.xp = 8;
    }
  }
  return e.patT >= windup + 0.5;
};

/** 순간이동(야광귀): 내 옆으로 번쩍 옮겨 가 그 자리를 터뜨리기를 되풀이한다 */
const blink: BossPatternFn = (s, e, p) => {
  const count = p.count ?? 3;
  const gap = p.gap ?? 1;
  if (e.sub < count && e.patT >= e.sub * gap) {
    e.sub++;
    addFx(s, FX.puff, e.x, e.y, e.r * 1.2, 0, 0, 0.3);
    const a = rand(s) * Math.PI * 2;
    e.x = s.player.x + Math.cos(a) * 70;
    e.y = s.player.y + Math.sin(a) * 70;
    blast(s, p, e.x, e.y, p.r ?? 130, p.windup ?? 0.75, p.dmg ?? 24);
  }
  return e.patT >= (count - 1) * gap + (p.windup ?? 0.75) + 0.35;
};

/**
 * 가로지르기(이무기): 화면 밖으로 물러났다가 내 자리를 지나는 곧은 길을 따라 화면을 가로지른다.
 * 지나갈 길이 범위 공격의 줄로 미리 보이고, 보스가 지나가는 차례대로 터진다.
 */
const sweep: BossPatternFn = (s, e, p) => {
  const windup = p.windup ?? 1.2;
  const speed = p.speed ?? 1100;
  const len = p.spread ?? 1040;
  if (e.sub === 0) {
    e.sub = 1;
    // 가로 또는 세로, 어느 쪽에서 올지
    const horizontal = rand(s) < 0.5;
    const dir = rand(s) < 0.5 ? 1 : -1;
    e.ax = horizontal ? dir : 0;
    e.ay = horizontal ? 0 : dir;
    e.x = s.player.x - e.ax * (len / 2);
    e.y = s.player.y - e.ay * (len / 2);
    const n = p.count ?? 8;
    for (let i = 0; i < n; i++) {
      const along = ((i + 0.5) / n) * len;
      blast(s, p, e.x + e.ax * along, e.y + e.ay * along, p.r ?? 86, windup + along / speed, p.dmg ?? 30);
    }
  }
  if (e.patT < windup) return false;
  e.x += e.ax * speed * TICK;
  e.y += e.ay * speed * TICK;
  return e.patT >= windup + (p.dur ?? len / speed);
};

/** 불 뿜기(강철이): 보스에서 내 쪽으로 곧게 뻗는 불길. 불이 지나간 자리에는 불길 지대가 남는다 */
const breath: BossPatternFn = (s, e, p, dx, dy, d) => {
  const windup = p.windup ?? 0.8;
  if (e.sub === 0) {
    e.sub = 1;
    const n = p.count ?? 6;
    const step = (p.spread ?? 540) / n;
    const ux = d > 1 ? dx / d : 1;
    const uy = d > 1 ? dy / d : 0;
    for (let i = 1; i <= n; i++) blast(s, p, e.x + ux * step * i, e.y + uy * step * i, p.r ?? 70, windup + i * 0.07, p.dmg ?? 24);
  }
  return e.patT >= windup + 0.07 * (p.count ?? 6) + 0.4;
};

/** 길 막기(왕지네): 내가 가는 쪽 앞을 가로지르는 독 지대의 줄 (긴 몸으로 길을 막는다) */
const wallLine: BossPatternFn = (s, e, p, dx, dy, d) => {
  const windup = p.windup ?? 0.9;
  walk(e, dx, dy, d, 0.4);
  if (e.sub === 0) {
    e.sub = 1;
    const pl = s.player;
    const n = p.count ?? 7;
    const len = p.spread ?? 600;
    // 내가 가는 쪽 170 앞에, 가는 방향에 수직으로
    const cx = pl.x + pl.fx * 170;
    const cy = pl.y + pl.fy * 170;
    for (let i = 0; i < n; i++) {
      const o = ((i + 0.5) / n - 0.5) * len;
      blast(s, p, cx - pl.fy * o, cy + pl.fx * o, p.r ?? 60, windup + Math.abs(o) * 0.0006, p.dmg ?? 20);
    }
  }
  return e.patT >= windup + 0.6;
};

export const PATTERNS: Record<string, BossPatternFn> = {
  chase, charge, shockwave, slam, summon, barrage, nova: shockwave, hide, bullets, clones, blink, sweep, breath, wallLine,
};

/** 걸음마다: 지금 패턴을 한 걸음 진행하고, 끝났으면 다음 패턴으로 */
export function updateBoss(s: State, e: Enemy, dx: number, dy: number, d: number) {
  const def = BOSSES[e.boss];
  const list = def.patterns;
  if (list.length === 0) {
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
    // 패턴이 끝나면 방패·숨기도 끝난다
    e.guard = 1;
    e.hidden = false;
  }
}

/** 지금 보스가 힘을 모으는 중인가 (화면에서 떨리게 보여 준다) */
export function bossWinding(e: Enemy): boolean {
  if (e.boss < 0) return false;
  const list = BOSSES[e.boss].patterns;
  if (list.length === 0) return false;
  const p = list[e.pat % list.length];
  return p.windup !== undefined && ['charge', 'shockwave', 'nova', 'summon', 'clones', 'bullets', 'breath'].includes(p.kind) && e.patT < p.windup;
}

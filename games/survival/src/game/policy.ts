/**
 * 밸런스 시험 틀: 사람 대신 조작하는 '정책' 으로 화면 없이 판을 끝까지 돌린다.
 * PRD 7장의 밸런스 목표(강화 수준별로 어느 맵을 깰 수 있나)는 8단계에서 이 틀로 수천 판을 돌려 맞춘다.
 *   npm run balance            → 무기 피해 표, 캐릭터별·강화 수준별 생존 시간
 */
import { RUN_SEC, TICKS_PER_SEC } from '../data/balance';
import { ITEM } from '../data/items';
import { MAPS } from '../data/maps';
import { WEAPONS, WEAPON_INDEX } from '../data/weapons';
import { spawnEnemy } from './core';
import { addWeapon } from './levelup';
import { makeRng } from './rng';
import { createRun, makeInput, step, summarize, type RunSummary } from './sim';
import { MODE, type Input, type RunConfig, type State } from './state';
import { eachObstacle } from './terrain';

/** 정책: 지금 상태를 보고 조작을 정한다 */
export type Policy = (s: State, input: Input) => void;

/** 가만히 서 있기 (레벨업 카드는 첫 장) */
export const idlePolicy: Policy = (s, input) => {
  input.mx = input.my = 0;
  input.pick = s.phase === 'levelup' ? 0 : -1;
};

/**
 * '보통 실력': 가까운 요괴에게서 멀어지고, 위험하지 않으면 가까운 구슬을 주우러 간다.
 * 사람처럼 0.2초마다 한 번씩만 방향을 다시 정하고, 가끔은 하던 대로 간다. 레벨업 카드는 아무거나 고른다.
 */
export function normalPolicy(seed: number): Policy {
  const rng = makeRng(seed);
  let mx = 0;
  let my = 0;
  let wait = 0;
  return (s, input) => {
    input.reroll = false;
    if (s.phase === 'levelup') {
      input.pick = Math.floor(rng() * s.cardN);
      return;
    }
    input.pick = -1;
    if (--wait > 0) {
      input.mx = mx;
      input.my = my;
      return;
    }
    wait = 12;
    if (rng() < 0.15) return; // 가끔은 하던 대로
    const p = s.player;
    let ax = 0;
    let ay = 0;
    let nearest = 1e9;
    // 가까운 요괴에게서 멀어진다 (가까울수록 세게)
    for (let i = 0; i < s.enemies.n; i++) {
      const e = s.enemies.items[i];
      if (e.hidden) continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.max(1, Math.hypot(dx, dy) - e.r);
      if (d < nearest) nearest = d;
      if (d > 190) continue;
      const w = (70 / d) * (70 / d) * (e.boss >= 0 ? 3 : 1);
      ax += (dx / (d + e.r)) * w;
      ay += (dy / (d + e.r)) * w;
    }
    // 적이 쏜 것도 피한다
    for (let i = 0; i < s.projectiles.n; i++) {
      const pr = s.projectiles.items[i];
      if (pr.mode !== MODE.enemy) continue;
      const dx = p.x - pr.x;
      const dy = p.y - pr.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (d > 140) continue;
      ax += (dx / d) * (80 / d) * 2;
      ay += (dy / d) * (80 / d) * 2;
    }
    // 곧 터질 범위 공격 안에 있으면 밖으로
    for (let i = 0; i < s.zones.n; i++) {
      const z = s.zones.items[i];
      if (z.owner !== 1 || z.delay <= 0) continue;
      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (d > z.r + 50) continue;
      ax += (dx / d) * 6;
      ay += (dy / d) * 6;
    }
    // 장애물(대나무·담·물길)에 바짝 붙지 않는다
    eachObstacle(s.map.terrain, s.terrainSeed, p.x, p.y, 150, 150, (ox, oy, r) => {
      const dx = p.x - ox;
      const dy = p.y - oy;
      const d = Math.max(1, Math.hypot(dx, dy) - r);
      if (d > 70) return;
      ax += (dx / (d + r)) * (30 / d) * 1.5;
      ay += (dy / (d + r)) * (30 / d) * 1.5;
    });
    // 위험하지 않으면 가장 가까운 구슬·아이템을 주우러 간다
    if (nearest > 60) {
      let best = -1;
      let bd = 420 * 420;
      for (let i = 0; i < s.pickups.n; i++) {
        const it = s.pickups.items[i];
        const dx = it.x - p.x;
        const dy = it.y - p.y;
        const d2 = (dx * dx + dy * dy) / (it.kind >= ITEM.cake ? 4 : 1);
        if (d2 < bd) {
          bd = d2;
          best = i;
        }
      }
      if (best >= 0) {
        const it = s.pickups.items[best];
        const dx = it.x - p.x;
        const dy = it.y - p.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const pull = nearest > 130 ? 2.5 : 0.9;
        ax += (dx / d) * pull;
        ay += (dy / d) * pull;
      }
    }
    const len = Math.hypot(ax, ay);
    if (len < 0.15) mx = my = 0;
    else {
      mx = ax / len;
      my = ay / len;
    }
    input.mx = mx;
    input.my = my;
  };
}

export interface SimResult extends RunSummary {
  /** 최종 보스 싸움까지 포함한 실제 걸린 시간 (초) */
  elapsed: number;
  state: State;
}

/** 한 판을 끝까지 돌린다 (maxSec: 이 시간이 지나도 안 끝나면 그만둔다) */
export function simulate(cfg: RunConfig, policy: Policy, maxSec = RUN_SEC + 240): SimResult {
  const s = createRun({ numbers: false, ...cfg });
  const input = makeInput();
  const limit = maxSec * TICKS_PER_SEC;
  let guard = limit * 2;
  while ((s.phase === 'play' || s.phase === 'levelup') && s.tick < limit && guard-- > 0) {
    policy(s, input);
    step(s, input);
  }
  return { ...summarize(s), elapsed: s.time, state: s };
}

export interface Average {
  runs: number;
  /** 평균 생존 시간 (초) */
  time: number;
  minTime: number;
  maxTime: number;
  kills: number;
  level: number;
  coins: number;
  /** 클리어한 판의 비율 (0~1) */
  clearRate: number;
}

/** 같은 설정으로 여러 판(시드만 다르게)을 돌려 평균을 낸다 */
export function average(cfg: Omit<RunConfig, 'seed'>, runs: number, seed0 = 1): Average {
  const a: Average = { runs, time: 0, minTime: 1e9, maxTime: 0, kills: 0, level: 0, coins: 0, clearRate: 0 };
  for (let i = 0; i < runs; i++) {
    const r = simulate({ ...cfg, seed: seed0 + i * 7919 }, normalPolicy(seed0 * 31 + i));
    a.time += r.time / runs;
    a.kills += r.kills / runs;
    a.level += r.level / runs;
    a.coins += r.coins / runs;
    a.clearRate += (r.cleared ? 1 : 0) / runs;
    a.minTime = Math.min(a.minTime, r.time);
    a.maxTime = Math.max(a.maxTime, r.time);
  }
  return a;
}

// ───────────────────────── 무기 피해 재기 ─────────────────────────
/** 허수아비 배치: 내 둘레 반지름 300 안에 40마리를 고르게 흩어 놓는다 (가운데 50 안은 비움). 여러 배치의 평균을 낸다 */
export const BENCH = { radius: 300, count: 40, hole: 50, sec: 60, layouts: 6 };

/**
 * 무기 하나가 같은 시간에 주는 피해 (초당). 움직이지 않고 죽지 않는 허수아비를 흩어 놓고 가만히 서서 잰다.
 * 캐릭터끼리 시작 무기의 세기가 비슷한지(±15%) 보는 기준이다 (PRD 4장).
 */
export function weaponDps(weaponId: string, lv = 1, sec = BENCH.sec): number {
  let sum = 0;
  for (let k = 0; k < BENCH.layouts; k++) sum += benchOnce(weaponId, lv, sec, 1000 + k * 77);
  return sum / BENCH.layouts;
}

function benchOnce(weaponId: string, lv: number, sec: number, seed: number): number {
  const s = createRun({ seed, char: 'rat', map: MAPS[0].id, numbers: false });
  // 요괴가 새로 나오지 않게 등장 표를 비운다 (쥐의 특성은 경험치라 피해와 상관없다)
  s.map = { ...s.map, spawns: [], swarms: [], bosses: [] };
  s.weapons.length = 0;
  const def = WEAPON_INDEX[weaponId];
  addWeapon(s, def, lv);
  const rng = makeRng(seed);
  for (let i = 0; i < BENCH.count; i++) {
    // 넓이에 고르게: 반지름은 제곱근으로
    const d = Math.sqrt(BENCH.hole * BENCH.hole + rng() * (BENCH.radius * BENCH.radius - BENCH.hole * BENCH.hole));
    const a = rng() * Math.PI * 2;
    const e = spawnEnemy(s, 0, Math.cos(a) * d, Math.sin(a) * d);
    if (!e) continue;
    e.hp = e.maxHp = 1e12;
    e.speed = 0;
    e.dmg = 0;
    e.r = 15;
  }
  const input = makeInput();
  const ticks = sec * TICKS_PER_SEC;
  for (let i = 0; i < ticks; i++) {
    s.player.inv = 10; // 허수아비에게 맞지 않는다
    step(s, input);
  }
  return s.dmgByWeapon[def] / sec;
}

/** 무기 6종(진화 포함)의 레벨별 초당 피해 표 */
export function dpsTable(): { id: string; name: string; dps: number[] }[] {
  return WEAPONS.filter((w) => w.ready).map((w) => ({ id: w.id, name: w.name, dps: w.levels.map((_, i) => weaponDps(w.id, i + 1)) }));
}

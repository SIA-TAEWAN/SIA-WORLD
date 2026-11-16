import type { Match } from '../game/match';
import type { Difficulty, TankState, TurnInput } from '../game/types';
import { Rng } from '../game/rng';
import { fly, tankCenter, type ShotWorld } from '../physics/shot';
import type { WeaponDef } from '../game/data';

interface Skill {
  angleErr: number;
  powerErr: number;
  knowsWind: boolean;
  ultChance: number;
  special: number;
  items: boolean;
}

export const SKILL: Record<Difficulty, Skill> = {
  easy: { angleErr: 6, powerErr: 9, knowsWind: false, ultChance: 0.5, special: 0.15, items: false },
  normal: { angleErr: 2.6, powerErr: 4.2, knowsWind: true, ultChance: 0.9, special: 0.25, items: true },
  hard: { angleErr: 0.9, powerErr: 1.6, knowsWind: true, ultChance: 1, special: 0.3, items: true },
};

export interface Aim {
  angle: number;
  power: number;
  facing: 1 | -1;
  score: number;
}

/** 각도·파워를 시뮬레이션해서 목표에 가장 가까이 떨어지는 조합을 찾는다 */
export function bestAim(match: Match, shooter: TankState, target: TankState, w: WeaponDef, wind: number): Aim {
  const world: ShotWorld = { terrain: match.terrain, tanks: match.tanks, wind };
  const tc = tankCenter(target);
  const facing: 1 | -1 = target.x >= shooter.x ? 1 : -1;
  const { angleMin, angleMax } = shooter.def;

  const tilt = match.tilt(shooter);
  const evalShot = (angle: number, power: number) => {
    const out = fly(world, { owner: shooter.idx, facing, angle: angle + facing * tilt, power, weapon: w, damageMul: 1, volleys: 1, tilt }, null);
    const hit = out.impacts[0];
    if (!hit) return 1e6;
    if (hit.target === target.idx) return 0;
    const d = Math.hypot(hit.x - tc.x, hit.y - tc.y);
    // 같은 팀 근처는 피한다 (피해는 없지만 낭비)
    return d;
  };

  let best: Aim = { angle: angleMin, power: 50, facing, score: Infinity };
  for (let a = angleMin; a <= angleMax; a += 2) {
    for (let p = 12; p <= 100; p += 2.5) {
      const s = evalShot(a, p);
      if (s < best.score) best = { angle: a, power: p, facing, score: s };
    }
  }
  const coarse = { ...best };
  for (let a = coarse.angle - 2; a <= coarse.angle + 2; a += 0.5) {
    if (a < angleMin || a > angleMax) continue;
    for (let p = coarse.power - 3; p <= coarse.power + 3; p += 0.5) {
      if (p < 0 || p > 100) continue;
      const s = evalShot(a, p);
      if (s < best.score) best = { angle: a, power: p, facing, score: s };
    }
  }
  return best;
}

function pickTarget(match: Match, me: TankState): TankState {
  const enemies = match.tanks.filter((t) => t.alive && t.team !== me.team);
  enemies.sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x));
  return enemies[0];
}

/** 이동할 거리(부호 = 방향). 조준이 잘 안 나오면 조금 움직인다. */
export function decideMove(match: Match, diff: Difficulty, rng: Rng): number {
  const me = match.cur;
  if (diff === 'easy') return rng.next() < 0.3 ? Math.round(rng.range(-25, 25)) : 0;
  const target = pickTarget(match, me);
  if (!target) return 0;
  const aim = bestAim(match, me, target, match.weaponOf(me, 0), match.wind);
  if (aim.score < 40) return 0;
  const toward = target.x >= me.x ? 1 : -1;
  return Math.round(toward * rng.range(20, match.moveLeft));
}

export function decideShot(match: Match, diff: Difficulty, rng: Rng): TurnInput {
  const sk = SKILL[diff];
  const me = match.cur;
  const target = pickTarget(match, me);
  const wind = sk.knowsWind ? match.wind : 0;

  let weapon: 0 | 1 | 2 = 0;
  if (match.canUseUlt(me) && rng.next() < sk.ultChance) weapon = 2;
  else if (rng.next() < sk.special && match.weaponOf(me, 1).behavior !== 'build') weapon = 1;
  if (match.weaponLock !== undefined) weapon = match.weaponLock;
  let aim = bestAim(match, me, target, match.weaponOf(me, weapon), wind);
  if (weapon !== 0 && aim.score > 40 && match.weaponLock === undefined) {
    // 이 무기로는 닿지 않으면 기본 무기로
    const base = bestAim(match, me, target, match.weaponOf(me, 0), wind);
    if (base.score < aim.score) {
      aim = base;
      weapon = 0;
    }
  }

  let itemSlot: number | null = null;
  const has = (id: string) => me.items.findIndex((i) => i === id);
  if (sk.items || diff === 'easy') {
    const r = has('repair');
    if (r >= 0 && me.hp < me.maxHp * 0.55) itemSlot = r;
  }
  if (sk.items && itemSlot === null && aim.score < 30) {
    for (const id of ['power', 'double']) {
      const i = has(id);
      if (i >= 0 && rng.next() < 0.6) {
        itemSlot = i;
        break;
      }
    }
  }

  const angle = Math.max(me.def.angleMin, Math.min(me.def.angleMax, aim.angle + rng.range(-sk.angleErr, sk.angleErr)));
  const power = Math.max(5, Math.min(100, aim.power + rng.range(-sk.powerErr, sk.powerErr)));
  return { angle: Math.round(angle * 2) / 2, power: Math.round(power * 2) / 2, facing: aim.facing, weapon, itemSlot };
}

/** AI가 대기실에서 아이템을 산다 */
export function aiItems(diff: Difficulty, rng: Rng) {
  if (diff === 'easy') return [];
  const pool = ['repair', 'power', 'double', 'repair'] as const;
  const picks: string[] = [];
  let pts = 1000;
  const prices: Record<string, number> = { repair: 300, power: 300, double: 400 };
  for (let i = 0; i < 3; i++) {
    const it = rng.pick(pool);
    if (prices[it] <= pts) {
      picks.push(it);
      pts -= prices[it];
    }
  }
  return picks as ('repair' | 'power' | 'double')[];
}

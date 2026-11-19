import { BOARD_H, BOARD_W, MAX_LV, SQUAD_SIZE, type ZodiacId } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { ROSTER, TOWERS, towerOf, type TowerDef } from '../data/characters';
import { ENEMIES, ENEMY_INDEX } from '../data/enemies';
import { stageEnemies, type StageDef } from '../data/stages';
import { coverage, makePoint, routePos } from './path';
import { makeRng } from './rng';
import { canPlace, command, createGame, isOver, step, summarize, upgradeCost, type RunSummary } from './sim';
import type { GameConfig, State } from './state';

/**
 * 자동 배치 정책 (밸런스 시뮬레이션용). 사람 대신 명령(배치·강화·시작)을 낸다 — 계산은 실제 판과 똑같은 sim.ts 가 한다.
 * '보통 실력'은 이렇게 논다:
 *   · 길이 사거리에 많이 들어오는 칸을 고르지만 가장 좋은 칸을 늘 찾지는 못한다 (좋은 칸 몇 개 가운데 하나, 가끔은 엉뚱한 칸)
 *   · 다음에 할 일(누구를 놓을지 / 누구를 강화할지)을 정해 두고 기운이 모이면 한다. 모이자마자가 아니라 조금 뒤에 알아챈다
 *   · 돕는 캐릭터(소·양·닭)는 다른 캐릭터를 몇 놓은 뒤에 그 곁에, 범위 캐릭터만 둘을 먼저 놓지는 않는다. 돼지는 일찍 구석에 놓는다
 *   · 기운을 모으는 사이에 요괴가 새어 나가면 급한 대로 가장 싼 공격 캐릭터를 놓는다
 *   · 되팔기는 하지 않는다
 * 정책의 난수는 판의 시드와 따로다 (같은 판이라도 사람마다 다르게 두는 것을 흉내 낸다).
 */
export interface Policy {
  /** 걸음마다 한 번 불린다 (시작 전에는 [시작]을 누를 때까지) */
  act(s: State): void;
}

export interface Skill {
  name: string;
  /** 좋은 칸 몇 개 가운데서 고르나 */
  topK: number;
  /** 엉뚱한 칸을 고를 확률 */
  slip: number;
  /** 할 일을 살피는 간격 (초): 최소 ~ 최대 */
  think: [number, number];
  /** 캐릭터 3개가 놓인 뒤, 새로 놓기보다 강화를 고를 확률 */
  upgrade: number;
}

export const SKILLS: Record<'novice' | 'normal' | 'expert', Skill> = {
  novice: { name: '서툰', topK: 6, slip: 0.3, think: [2, 4.5], upgrade: 0.25 },
  normal: { name: '보통', topK: 3, slip: 0.12, think: [1, 2.4], upgrade: 0.45 },
  expert: { name: '능숙', topK: 1, slip: 0, think: [0.3, 0.6], upgrade: 0.55 },
};

/** 캐릭터를 고르는 비중 (공격 방식별) */
const WEIGHT: Record<TowerDef['kind'], number> = { shot: 2.6, lob: 2.5, melee: 2.5, beam: 2.4, poison: 2.2, stun: 1.2, slow: 1.3, bank: 0 };
/** 돕는 캐릭터인가: 직접 잡지 못하므로 다른 캐릭터를 몇 놓은 뒤에 그 곁에 둔다 (소·양·닭) */
const helper = (c: number) => TOWERS[c].kind === 'stun' || TOWERS[c].kind === 'slow' || !!TOWERS[c].levels[0].haste;
/** 한 마리씩 확실히 잡는 캐릭터인가 */
const single = (c: number) => (TOWERS[c].kind === 'shot' && !TOWERS[c].levels[0].haste) || TOWERS[c].kind === 'melee' || TOWERS[c].kind === 'poison';

type Goal = { op: 'place'; slot: number; char: number } | { op: 'upgrade'; slot: number } | null;

export function skillPolicy(seed: number, skill: Skill): Policy {
  const rng = makeRng(seed);
  /** 캐릭터별 · 칸별 점수 (사거리에 들어오는 길의 길이). 판마다 한 번 계산한다 */
  let score: number[][] | null = null;
  /** 길 위의 점들 (x, y 가 번갈아. 판 안의 땅 위 길, 16px 간격) · 이 판에 공중·은신 요괴가 나오나 */
  let road: number[] | null = null;
  let hasAir = false;
  let hasStealth = false;
  let goal: Goal = null;
  let nextThink = 0;
  /** 지난번에 살폈을 때의 생명 (줄었으면 급하다는 뜻) */
  let seenLives = 0;

  const pickChar = (s: State): number => {
    let placed = 0;
    let singles = 0;
    let lobs = 0;
    let banks = 0;
    let helpers = 0;
    /** 나는 요괴를 칠 수 있는 공격 캐릭터 수 */
    let airs = 0;
    const have = new Map<number, number>();
    for (const t of s.towers) {
      if (t.char < 0) continue;
      placed++;
      if (helper(t.char)) helpers++;
      if (TOWERS[t.char].air && TOWERS[t.char].kind !== 'slow') airs++;
      have.set(t.char, (have.get(t.char) ?? 0) + 1);
      if (single(t.char)) singles++;
      if (TOWERS[t.char].kind === 'lob' || TOWERS[t.char].kind === 'beam') lobs++;
      if (TOWERS[t.char].kind === 'bank') banks++;
    }
    // 돼지: 처음 두세 번째로 하나만 (일찍 놓아야 번 기운이 값을 넘는다)
    const pig = s.squad.find((c) => TOWERS[c].kind === 'bank');
    if (pig !== undefined && placed >= 1 && banks === 0 && s.time < 45) return pig;
    let total = 0;
    const w = s.squad.map((c) => {
      const k = TOWERS[c].kind;
      let v = WEIGHT[k];
      // 돕는 캐릭터는 셋을 놓은 뒤에, 공격 캐릭터 셋에 하나꼴로, 같은 것을 여럿 두지 않는다 (공격 속도·감속은 겹치지 않는다)
      if (helper(c)) v = placed < 3 || helpers * 3 >= placed - helpers ? 0 : (v * 1.6) / (1 + 2 * (have.get(c) ?? 0));
      // 원숭이는 공중·은신 요괴가 나오는 판에서, 개는 은신 요괴가 나오는 판에서 자주 고른다
      if (TOWERS[c].target === 'air') v = hasAir || hasStealth ? 3.2 : 1.2;
      if (TOWERS[c].levels[0].detect) v = hasStealth ? 3 : 1.4;
      // 나는 요괴가 나오는 판인데 아직 칠 캐릭터가 없으면 칠 수 있는 공격 캐릭터를 먼저 (길을 가로질러 일찍 온다)
      if (hasAir && airs === 0 && placed >= 1 && TOWERS[c].air && !helper(c)) v *= 3;
      // 한 마리씩 잡는 캐릭터가 아직 없으면 범위 캐릭터를 또 고르지 않는다
      if ((k === 'lob' || k === 'beam') && lobs > 0 && singles === 0) v = 0;
      total += v;
      return v;
    });
    if (total <= 0) return s.squad[0];
    let x = rng() * total;
    for (let i = 0; i < w.length; i++) {
      x -= w[i];
      if (x < 0) return s.squad[i];
    }
    return s.squad[0];
  };

  const pickSlot = (s: State, char: number): number => {
    const empty: number[] = [];
    for (let i = 0; i < s.towers.length; i++) if (s.towers[i].char < 0 && s.towers[i].off <= 0) empty.push(i);
    if (!empty.length) return -1;
    if (rng() < skill.slip) return empty[Math.floor(rng() * empty.length)];
    const sc = score![char];
    // 돼지는 길이 가장 덜 보이는 칸에 (좋은 칸을 아낀다)
    if (TOWERS[char].kind === 'bank') return empty.sort((a, b) => score![0][a] - score![0][b] || a - b)[0];
    if (helper(char)) {
      // 돕는 캐릭터는 화력이 모인 곳에 둔다: 닭은 많이 키운 캐릭터들의 곁, 소·양은 여러 캐릭터가 함께 때리는 길목
      const L = s.lv[char][0];
      const help = (i: number) => {
        let v = 0;
        if (L.haste) {
          for (let j = 0; j < s.towers.length; j++) {
            const t = s.towers[j];
            if (t.char < 0 || helper(t.char) || TOWERS[t.char].kind === 'bank') continue;
            if (Math.hypot(s.slotX[i] - s.slotX[j], s.slotY[i] - s.slotY[j]) <= L.range) v += t.spent;
          }
          return v;
        }
        for (let k = 0; k < road!.length; k += 2) {
          const dx = road![k] - s.slotX[i];
          const dy = road![k + 1] - s.slotY[i];
          if (dx * dx + dy * dy > L.range * L.range) continue;
          for (let j = 0; j < s.towers.length; j++) {
            const t = s.towers[j];
            if (t.char < 0 || helper(t.char) || TOWERS[t.char].kind === 'bank') continue;
            const r = s.lv[t.char][t.lv - 1].range;
            if ((road![k] - s.slotX[j]) ** 2 + (road![k + 1] - s.slotY[j]) ** 2 <= r * r) v += t.spent;
          }
        }
        return v;
      };
      const best = empty.map((i) => ({ i, v: help(i) })).sort((a, b) => b.v - a.v || a.i - b.i)[0];
      // 도울 캐릭터가 아직 곁에 없으면 놓지 않는다
      return best.v > 0 ? best.i : -1;
    }
    empty.sort((a, b) => sc[b] - sc[a] || a - b);
    const k = Math.min(skill.topK, empty.length);
    // 앞 순위일수록 자주 고른다 (3 : 2 : 1 …)
    const total = (k * (k + 1)) / 2;
    let x = rng() * total;
    for (let i = 0; i < k; i++) {
      x -= k - i;
      if (x < 0) return empty[i];
    }
    return empty[0];
  };

  /** 지금 놓을 수 있는 가장 싼 공격 캐릭터 */
  const cheapest = (s: State) => s.squad.filter((c) => !helper(c) && TOWERS[c].kind !== 'bank').sort((a, b) => s.cost[a] - s.cost[b])[0] ?? s.squad[0];

  const pickGoal = (s: State): Goal => {
    const placed: number[] = [];
    let empty = 0;
    for (let i = 0; i < s.towers.length; i++) {
      if (s.towers[i].char < 0) empty++;
      else if (s.towers[i].lv < MAX_LV) placed.push(i);
    }
    const total = s.towers.length - empty;
    const wantUp = placed.length > 0 && (empty === 0 || (total >= 3 && rng() < skill.upgrade));
    if (wantUp) {
      // 강화는 공격 캐릭터부터 (돕는 캐릭터·돼지는 다른 것이 다 올랐을 때)
      const main = placed.filter((i) => !helper(s.towers[i].char) && TOWERS[s.towers[i].char].kind !== 'bank');
      const from = main.length && rng() < 0.85 ? main : placed;
      return { op: 'upgrade', slot: from[Math.floor(rng() * from.length)] };
    }
    if (empty === 0) return null;
    let char = pickChar(s);
    let slot = pickSlot(s, char);
    // 돕는 캐릭터를 놓을 만한 자리가 없으면 공격 캐릭터를 놓는다
    if (slot < 0 && helper(char)) {
      char = cheapest(s);
      slot = pickSlot(s, char);
    }
    return slot < 0 ? null : { op: 'place', slot, char };
  };

  const cost = (s: State, g: Exclude<Goal, null>) => (g.op === 'place' ? s.cost[g.char] : (upgradeCost(s, g.slot) ?? Infinity));
  const run = (s: State, g: Exclude<Goal, null>) => (g.op === 'place' ? command(s, 'place', g.slot, g.char) : command(s, 'upgrade', g.slot));

  return {
    act(s) {
      score ??= TOWERS.map((t) => s.slotX.map((x, i) => coverage(s.routes, x, s.slotY[i], t.levels[0].range, BOARD_W, BOARD_H)));
      if (!road) {
        road = [];
        const p = makePoint();
        for (const r of s.routes) {
          if (r.air) continue;
          for (let d = 0; d <= r.len; d += 16) {
            routePos(r, d, p.seg, p);
            if (p.x >= 0 && p.x <= BOARD_W && p.y >= 0 && p.y <= BOARD_H) road.push(p.x, p.y);
          }
        }
        const foes = s.endless ? ENEMIES : stageEnemies(s.stage).map((id) => ENEMIES[ENEMY_INDEX[id]]);
        hasAir = foes.some((f) => f.air);
        hasStealth = foes.some((f) => f.stealth);
      }
      if (s.phase === 'prep') {
        // 처음 배치: 시작 기운으로 놓을 수 있는 만큼 놓고 시작한다
        for (let guard = 0; guard < 20; guard++) {
          const g = pickGoal(s);
          if (!g || g.op !== 'place') break;
          if (s.energy >= cost(s, g)) run(s, g);
          else {
            // 고른 캐릭터를 놓을 기운이 없으면, 놓을 수 있는 가장 싼 캐릭터를 같은 칸에
            const cheap = s.squad.filter((c) => canPlace(s, g.slot, c) && !helper(c)).sort((a, b) => s.cost[a] - s.cost[b])[0];
            if (cheap === undefined) break;
            command(s, 'place', g.slot, cheap);
          }
        }
        command(s, 'start');
        seenLives = s.lives;
        nextThink = skill.think[0] + rng() * (skill.think[1] - skill.think[0]);
        return;
      }
      if (s.phase !== 'play' || s.time < nextThink) return;
      nextThink = s.time + skill.think[0] + rng() * (skill.think[1] - skill.think[0]);
      // 할 일이 없거나 할 수 없게 됐으면(칸이 찼다 등) 새로 정한다
      if (goal && (goal.op === 'place' ? s.towers[goal.slot].char >= 0 : upgradeCost(s, goal.slot) === null)) goal = null;
      goal ??= pickGoal(s);
      if (goal && s.energy >= cost(s, goal)) {
        run(s, goal);
        goal = null;
      } else if (goal && s.lives < seenLives) {
        // 기운을 모으는 사이에 요괴가 새어 나갔다: 급한 대로 지금 놓을 수 있는 가장 싼 공격 캐릭터를 놓는다
        const cheap = cheapest(s);
        const slot = cheap !== undefined && s.energy >= s.cost[cheap] ? pickSlot(s, cheap) : -1;
        if (slot >= 0) command(s, 'place', slot, cheap);
      }
      seenLives = s.lives;
    },
  };
}

export const normalPolicy = (seed: number): Policy => skillPolicy(seed, SKILLS.normal);

/** 캐릭터의 기본 쓸모 (명단을 고를 때의 바탕 점수) */
const BASE: Record<string, number> = { rat: 2.4, ox: 1.4, tiger: 3, rabbit: 3, dragon: 2.8, snake: 2.6, horse: 2.4, sheep: 1.8, monkey: 1.4, rooster: 2, dog: 1.6, pig: 2.2 };

/**
 * 그 스테이지에 데려갈 5종을 고른다 (보통 실력의 선택): 바탕 점수 + 그 스테이지에 나오는 요괴에 잘 듣는 캐릭터에 가산점.
 * unlocked: 쓸 수 있는 캐릭터
 */
export function pickSquad(stage: StageDef, unlocked: readonly ZodiacId[], must?: ZodiacId, size = SQUAD_SIZE): ZodiacId[] {
  const foes = stageEnemies(stage).map((id) => ENEMIES[ENEMY_INDEX[id]]);
  const bossHere = stage.boss ? BOSSES[BOSS_INDEX[stage.boss.id]] : null;
  // 요괴마다 이 스테이지에서 차지하는 몫 (마릿수 × 체력)
  const weight = new Map<string, number>();
  let all = 0;
  for (const w of stage.waves) {
    for (const g of w.groups) {
      const v = g.count * ENEMIES[ENEMY_INDEX[g.enemy]].hp;
      weight.set(g.enemy, (weight.get(g.enemy) ?? 0) + v);
      all += v;
    }
  }
  const share = (pred: (f: (typeof foes)[number]) => unknown) => foes.reduce((a, f) => a + (pred(f) ? (weight.get(f.id) ?? 0) : 0), 0) / Math.max(1, all);
  const stealth = share((f) => f.stealth);
  const air = share((f) => f.air);
  const ghost = share((f) => f.ghost);
  const score = (id: ZodiacId) => {
    let v = BASE[id] ?? 1;
    // 잘 듣는 요괴가 많이 나올수록 가산점
    for (const f of foes) if (f.weak.includes(id)) v += 0.5 + (3 * (weight.get(f.id) ?? 0)) / Math.max(1, all);
    if (bossHere && (id === 'horse' || id === 'snake' || id === 'tiger')) v += 0.6;
    // 꼭 필요한 짝: 숨는 요괴에는 개, 나는 요괴에는 원숭이, 무적인 요괴에는 소 (붙잡아 둔다)
    if (id === 'dog' && stealth >= 0.08) v += 2.5;
    // 나는 요괴는 체력이 낮아 몫이 작게 잡히지만 길을 가로질러 와서 자주 샌다: 한 무리라도 나오면 원숭이를 데려간다
    if (id === 'monkey' && (air >= 0.06 || foes.some((f) => f.air))) v += 2.5;
    if (id === 'ox' && ghost >= 0.08) v += 2;
    return v;
  };
  const able = ROSTER.map((r) => r.id).filter((id) => unlocked.includes(id) && !!towerOf(id));
  // must: 꼭 데려갈 캐릭터 (점수와 상관없이 넣는다 — 밸런스 표에서 캐릭터의 쓸모를 볼 때)
  const ranked = able.map((id, i) => ({ id, v: id === must ? 99 : score(id), i })).sort((a, b) => b.v - a.v || a.i - b.i);
  // 공격 캐릭터가 셋은 있어야 한다: 돕는 캐릭터(소·양·닭·돼지)는 둘까지만
  const picked: typeof ranked = [];
  let helpers = 0;
  for (const x of ranked) {
    if (picked.length >= size) break;
    const t = towerOf(x.id)!;
    const isHelper = t.kind === 'stun' || t.kind === 'slow' || t.kind === 'bank' || !!t.levels[0].haste;
    if (isHelper && x.id !== must && helpers >= 2) continue;
    if (isHelper) helpers++;
    picked.push(x);
  }
  return picked.sort((a, b) => a.i - b.i).map((x) => x.id);
}

/** 정책으로 한 판을 끝까지 돌린다 */
export function simulate(cfg: GameConfig, policy: Policy, maxSec = 900, stage?: StageDef): { state: State; summary: RunSummary } {
  const s = createGame(cfg, stage);
  const maxTick = maxSec * 60;
  while (!isOver(s) && s.tick < maxTick) {
    policy.act(s);
    if (s.phase === 'prep') break; // 시작하지 못했다 (일어나지 않는다)
    step(s);
  }
  return { state: s, summary: summarize(s) };
}

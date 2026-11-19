import { BOARD_H, BOARD_W, MAX_LV } from '../data/balance';
import { TOWERS, type TowerDef } from '../data/characters';
import { coverage } from './path';
import { makeRng } from './rng';
import { canPlace, command, createGame, isOver, step, summarize, upgradeCost, type RunSummary } from './sim';
import type { GameConfig, State } from './state';

/**
 * 자동 배치 정책 (밸런스 시뮬레이션용). 사람 대신 명령(배치·강화·시작)을 낸다 — 계산은 실제 판과 똑같은 sim.ts 가 한다.
 * '보통 실력'은 이렇게 논다:
 *   · 길이 사거리에 많이 들어오는 칸을 고르지만 가장 좋은 칸을 늘 찾지는 못한다 (좋은 칸 몇 개 가운데 하나, 가끔은 엉뚱한 칸)
 *   · 다음에 할 일(누구를 놓을지 / 누구를 강화할지)을 정해 두고 기운이 모이면 한다. 모이자마자가 아니라 조금 뒤에 알아챈다
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

/** 캐릭터를 고르는 비중 (공격 방식별). 소는 다른 캐릭터가 몇 놓인 뒤에만 고른다 */
const WEIGHT: Record<TowerDef['kind'], number> = { shot: 3, lob: 2.5, melee: 2.5, stun: 1.2 };

type Goal = { op: 'place'; slot: number; char: number } | { op: 'upgrade'; slot: number } | null;

export function skillPolicy(seed: number, skill: Skill): Policy {
  const rng = makeRng(seed);
  /** 캐릭터별 · 칸별 점수 (사거리에 들어오는 길의 길이). 판마다 한 번 계산한다 */
  let score: number[][] | null = null;
  let goal: Goal = null;
  let nextThink = 0;
  /** 지난번에 살폈을 때의 생명 (줄었으면 급하다는 뜻) */
  let seenLives = 0;

  const pickChar = (s: State): number => {
    const placed = s.towers.reduce((n, t) => n + (t.char >= 0 ? 1 : 0), 0);
    let total = 0;
    const w = s.squad.map((c) => {
      const k = TOWERS[c].kind;
      const v = k === 'stun' && placed < 3 ? 0 : WEIGHT[k];
      total += v;
      return v;
    });
    let x = rng() * total;
    for (let i = 0; i < w.length; i++) {
      x -= w[i];
      if (x < 0) return s.squad[i];
    }
    return s.squad[0];
  };

  const pickSlot = (s: State, char: number): number => {
    const empty: number[] = [];
    for (let i = 0; i < s.towers.length; i++) if (s.towers[i].char < 0) empty.push(i);
    if (!empty.length) return -1;
    if (rng() < skill.slip) return empty[Math.floor(rng() * empty.length)];
    const sc = score![char];
    // 소는 다른 캐릭터 곁에 둔다 (세워 둔 요괴를 때려 줄 캐릭터가 있어야 한다)
    const near = (i: number) => {
      if (TOWERS[char].kind !== 'stun') return 0;
      let n = 0;
      for (let j = 0; j < s.towers.length; j++) {
        if (s.towers[j].char >= 0 && Math.hypot(s.slotX[i] - s.slotX[j], s.slotY[i] - s.slotY[j]) < 200) n++;
      }
      return n * 120;
    };
    empty.sort((a, b) => sc[b] + near(b) - (sc[a] + near(a)) || a - b);
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

  const pickGoal = (s: State): Goal => {
    const placed: number[] = [];
    let empty = 0;
    for (let i = 0; i < s.towers.length; i++) {
      if (s.towers[i].char < 0) empty++;
      else if (s.towers[i].lv < MAX_LV) placed.push(i);
    }
    const total = s.towers.length - empty;
    const wantUp = placed.length > 0 && (empty === 0 || (total >= 3 && rng() < skill.upgrade));
    if (wantUp) return { op: 'upgrade', slot: placed[Math.floor(rng() * placed.length)] };
    if (empty === 0) return null;
    const char = pickChar(s);
    const slot = pickSlot(s, char);
    return slot < 0 ? null : { op: 'place', slot, char };
  };

  const cost = (s: State, g: Exclude<Goal, null>) => (g.op === 'place' ? TOWERS[g.char].cost : (upgradeCost(s, g.slot) ?? Infinity));
  const run = (s: State, g: Exclude<Goal, null>) => (g.op === 'place' ? command(s, 'place', g.slot, g.char) : command(s, 'upgrade', g.slot));

  return {
    act(s) {
      score ??= TOWERS.map((t) => s.slotX.map((x, i) => coverage(s.routes, x, s.slotY[i], t.levels[0].range, BOARD_W, BOARD_H)));
      if (s.phase === 'prep') {
        // 처음 배치: 시작 기운으로 놓을 수 있는 만큼 놓고 시작한다
        for (let guard = 0; guard < 20; guard++) {
          const g = pickGoal(s);
          if (!g || g.op !== 'place') break;
          if (s.energy >= cost(s, g)) run(s, g);
          else {
            // 고른 캐릭터를 놓을 기운이 없으면, 놓을 수 있는 가장 싼 캐릭터를 같은 칸에
            const cheap = s.squad.filter((c) => canPlace(s, g.slot, c)).sort((a, b) => TOWERS[a].cost - TOWERS[b].cost)[0];
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
        // 기운을 모으는 사이에 요괴가 새어 나갔다: 급한 대로 지금 놓을 수 있는 가장 싼 캐릭터를 놓는다
        const cheap = [...s.squad].sort((a, b) => TOWERS[a].cost - TOWERS[b].cost)[0];
        const slot = cheap !== undefined && s.energy >= TOWERS[cheap].cost ? pickSlot(s, cheap) : -1;
        if (slot >= 0) command(s, 'place', slot, cheap);
      }
      seenLives = s.lives;
    },
  };
}

export const normalPolicy = (seed: number): Policy => skillPolicy(seed, SKILLS.normal);

/** 정책으로 한 판을 끝까지 돌린다 */
export function simulate(cfg: GameConfig, policy: Policy, maxSec = 900): { state: State; summary: RunSummary } {
  const s = createGame(cfg);
  const maxTick = maxSec * 60;
  while (!isOver(s) && s.tick < maxTick) {
    policy.act(s);
    if (s.phase === 'prep') break; // 시작하지 못했다 (일어나지 않는다)
    step(s);
  }
  return { state: s, summary: summarize(s) };
}

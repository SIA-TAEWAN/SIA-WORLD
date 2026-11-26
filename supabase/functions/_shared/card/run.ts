/**
 * 한 판(run) 진행. apply(run, input) 하나로 모든 입력을 받는다 — 받아들인 입력만 run.log 에 쌓이고,
 * replay(seed, hero, log) 로 처음부터 다시 돌리면 같은 상태가 된다 (서버 검증 = 이것).
 */
import { endTurn, playCard, startBattle, usePotion } from './battle.ts';
import { cardDef, heroDef } from './data.ts';
import { hashSeed } from './rng.ts';
import type { DeckCard, Input, RunState, SimEvent } from './state.ts';

export const RULES_VERSION = 1;

export interface NewRunOpts {
  seed: number;
  hero: string;
}

export function newRun(o: NewRunOpts): RunState {
  const h = heroDef(o.hero);
  const deck: DeckCard[] = [];
  let uid = 1;
  for (let i = 0; i < 5; i++) deck.push({ uid: uid++, id: 'slash' });
  for (let i = 0; i < 4; i++) deck.push({ uid: uid++, id: 'guard' });
  deck.push({ uid: uid++, id: h.cards[0] });
  for (const c of deck) cardDef(c.id);
  return {
    v: 1,
    seed: o.seed >>> 0,
    mode: 'normal',
    hero: h.id,
    hp: h.hp,
    maxHp: h.hp,
    gold: 99,
    deck,
    relics: [],
    potions: [],
    act: 1,
    row: -1,
    col: 0,
    map: { region: 'bamboo', boss: '', elites: [], rows: [] },
    phase: 'map',
    battle: null,
    reward: null,
    shop: null,
    event: null,
    treasure: null,
    rest: null,
    nextUid: uid,
    removes: 0,
    seenEvents: [],
    flags: { nextEnergy: 0, ironUsed: false, catUsed: false },
    stats: { floors: 0, elites: 0, bosses: 0, battles: 0 },
    log: [],
    actStart: [0],
  };
}

/** 연습·개발용: 지금 판에서 바로 전투 하나 (지도 없이) */
export function enterTestBattle(run: RunState, foes: string[], kind: 'battle' | 'elite' | 'boss' = 'battle'): SimEvent[] {
  const ev: SimEvent[] = [];
  run.phase = 'battle';
  startBattle(run, { kind, foes, seed: hashSeed(run.seed, 'test', foes.join(',')) }, ev);
  return ev;
}

export interface ApplyResult {
  ok: boolean;
  ev: SimEvent[];
}

/** 입력 하나 처리. ok=false 면 상태는 그대로이고 기록에도 남지 않는다 */
export function apply(run: RunState, input: Input): ApplyResult {
  const ev: SimEvent[] = [];
  const ok = step(run, input, ev);
  if (ok) run.log.push(input);
  return { ok, ev };
}

function step(run: RunState, i: Input, ev: SimEvent[]): boolean {
  switch (run.phase) {
    case 'battle':
      return battleStep(run, i, ev);
    default:
      return false;
  }
}

function battleStep(run: RunState, i: Input, ev: SimEvent[]): boolean {
  const b = run.battle;
  if (!b) return false;
  let ok = false;
  if (i.t === 'play') ok = playCard(run, i.uid, i.target, ev);
  else if (i.t === 'potion') ok = usePotion(run, i.slot, i.target, ev);
  else if (i.t === 'dropPotion') ok = i.slot >= 0 && i.slot < run.potions.length && !!run.potions.splice(i.slot, 1).length;
  else if (i.t === 'end') ok = endTurn(run, i.keep, ev);
  if (ok && b.over) afterBattle(run, ev);
  return ok;
}

function afterBattle(run: RunState, _ev: SimEvent[]) {
  const b = run.battle!;
  if (b.over === 'lose') {
    run.phase = 'dead';
    return;
  }
  run.phase = 'won';
}

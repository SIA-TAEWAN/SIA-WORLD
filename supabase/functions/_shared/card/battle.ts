/**
 * 전투 규칙 (PRD [전투 규칙]). 순수 함수 — run.battle 을 바꾸고 연출용 사건(SimEvent)을 ev 에 쌓는다.
 *
 * 한 턴의 순서
 *  내 턴 시작: 방어 사라짐(얼음 항아리면 3 남김) → 지난 턴 예약 방어 → 독 피해(방어 무시)·1 감소 → 기력 3 → 5장 뽑기(진흙이면 -1)
 *  내 턴 끝: 손에 남은 저승 사슬 피해 → 손패 버림 → 화상 피해(강철이 2단계면 2배)·1 감소 → 젖음·약화 1 감소
 *  요괴 차례(왼쪽부터): 방어 사라짐 → 독 → (시간 멈춤이면 건너뜀) → 매 턴 행동 → 행동 → 화상 → 젖음·약화 감소. 다 끝나면 행동한 요괴의 다음 의도를 정한다.
 *  보스 단계: 체력 50% (어둑시니는 66%·33%) 에서 다음 단계로 — 행동 목록 교체.
 *
 * 난수는 b.rng 의 세 줄기(draw 섞기 · ai 의도 · fx 무작위 대상)로만 뽑는다.
 */
import { cardCost, cardDef, cardExhaust, cardOps, enemyDef, moveDef, phaseAt, phaseOf, potionDef } from './data.ts';
import { Rng } from './rng.ts';
import type { Battle, BCard, Foe, FoeMods, RunState, SimEvent, Statuses } from './state.ts';
import type { EnemyDef, EOp, MoveDef, Op, StatusId } from './types.ts';

export const BASE_ENERGY = 3;
export const BASE_DRAW = 5;
export const HAND_MAX = 10;
export const MAX_POTIONS = 3;

const has = (run: RunState, relic: string) => run.relics.includes(relic);
const rngOf = (b: Battle, k: 'draw' | 'ai' | 'fx') => new Rng(b.rng as unknown as Record<string, number>, k);
export const aliveFoes = (b: Battle) => b.foes.filter((f) => !f.dead);
export const handMax = (run: RunState) => (has(run, 'imugiScale') ? 7 : HAND_MAX);

// ---------- 전투 시작 ----------

export interface StartOpts {
  kind: Battle['kind'];
  foes: string[];
  seed: number;
  double?: boolean;
  /** 요괴 강해짐 (끝없는 모드 · 숙련 단계) — 없으면 그대로 */
  mods?: FoeMods;
}

export function startBattle(run: RunState, o: StartOpts, ev: SimEvent[]): Battle {
  const s1 = o.seed >>> 0;
  const b: Battle = {
    kind: o.kind,
    double: o.double || undefined,
    turn: 0,
    energy: 0,
    hand: [],
    draw: run.deck.map((c) => ({ uid: c.uid, id: c.id, up: c.up })),
    discard: [],
    exhaust: [],
    block: 0,
    st: {},
    thorns: 0,
    nextBlock: 0,
    discardNext: 0,
    foxShield: has(run, 'foxOrb'),
    powers: {},
    foes: [],
    rng: { draw: s1 ^ 0x1234567, ai: (s1 * 31 + 7) >>> 0, fx: (s1 ^ 0x9e3779b9) >>> 0 },
    nextFoe: 1,
    t: { played: 0, attacks: 0 },
    b: { attacks: 0, whet: false, beoseon: false, sorghum: false, gold: 0 },
    e1: 0,
    over: null,
  };
  if (o.mods) b.mods = o.mods;
  run.battle = b;
  rngOf(b, 'draw').shuffle(b.draw);
  for (const id of o.foes) addFoe(b, id, o.kind === 'elite');
  // 첫 턴 추가 기력: 도깨비 방망이 · 탁발승 · 용(여의룡) 패시브
  b.e1 = (has(run, 'goblinClub') ? 1 : 0) + run.flags.nextEnergy + (run.hero === 'dragon' ? 1 : 0);
  run.flags.nextEnergy = 0;
  // 전투 시작 효과
  if (has(run, 'woodShield')) gainBlock(b, 8, ev);
  if (run.hero === 'sheep') gainBlock(b, 6, ev);
  if (has(run, 'yeomraLedger')) addCurse(b, 'chain', 1, 'draw', ev);
  if (run.hero === 'tiger') for (const f of aliveFoes(b)) applyFoeStatus(run, b, f, 'weak', 1, ev);
  if (has(run, 'janggu')) for (const f of aliveFoes(b)) applyFoeStatus(run, b, f, 'weak', 1, ev);
  if (has(run, 'snakeFang')) for (const f of aliveFoes(b)) applyFoeStatus(run, b, f, 'poison', 2, ev);
  for (const f of b.foes) rollIntent(b, f);
  startTurn(run, b, ev);
  return b;
}

function addFoe(b: Battle, id: string, elite: boolean): Foe {
  const d = enemyDef(id);
  const r = rngOf(b, 'ai');
  let hp = d.hp[0] === d.hp[1] ? d.hp[0] : r.int(d.hp[0], d.hp[1]);
  if (elite && d.boss) hp = Math.round(hp * 0.6);
  // 끝없는 모드 막마다 · 숙련 1(정예) · 숙련 5(막 보스)
  const m = b.mods;
  if (m) {
    let k = m.hp;
    if (elite) k *= m.eliteHp;
    else if (d.boss && !d.minion) k *= m.bossHp;
    if (k !== 1) hp = Math.max(1, Math.round(hp * k));
  }
  const f: Foe = { uid: b.nextFoe++, id, hp, maxHp: hp, block: 0, st: {}, str: 0, phase: 1, intent: null, cyc: 0, last: null, dodge: 0, minion: !!d.minion, dead: false };
  // 정예 전투의 요괴 (그 지역 다른 보스 · 갈림길의 여우의 천년 여우) / 막 보스
  if (elite) f.elite = true;
  else if (d.boss) f.boss = true;
  b.foes.push(f);
  return f;
}

// ---------- 내 턴 ----------

/** 내 턴 시작에 남는 방어: 보통 0 · 얼음 항아리 3까지 · 소(우직이) 패시브 절반 */
export function keptBlock(run: RunState, block: number): number {
  let keep = 0;
  if (has(run, 'iceJar')) keep = Math.min(block, 3);
  if (run.hero === 'ox') keep = Math.max(keep, Math.floor(block / 2));
  return keep;
}

function startTurn(run: RunState, b: Battle, ev: SimEvent[]) {
  b.turn++;
  ev.push({ e: 'turn', who: 'hero', turn: b.turn });
  // 첫 턴은 전투 시작에 얻은 방어(나무 방패 · 양 패시브)를 그대로 둔다
  if (b.turn > 1) b.block = keptBlock(run, b.block);
  b.thorns = 0;
  b.ward = 0;
  b.cutNext = 0;
  b.freeAtk = !!b.nextFreeAtk;
  b.nextFreeAtk = false;
  if (b.nextBlock > 0) {
    gainBlock(b, b.nextBlock, ev);
    b.nextBlock = 0;
  }
  // 독: 방어 무시
  const p = b.st.poison ?? 0;
  if (p > 0) {
    loseHp(run, b, p, ev, 'status');
    dec(b.st, 'poison');
    if (b.over) return;
  }
  // 기력: 3 + 보스 부적 + 십이지 대진 + 첫 턴 덤 + 깡충(+) · 야광귀 신발 훔치기(-)
  b.energy = Math.max(
    0,
    BASE_ENERGY + (has(run, 'dragonPearl') ? 1 : 0) + (has(run, 'yeomraLedger') ? 1 : 0) + (b.powers.energyUp ?? 0) + (b.turn === 1 ? b.e1 : 0) + (b.nextEnergy ?? 0),
  );
  b.nextEnergy = 0;
  ev.push({ e: 'energy', n: b.energy });
  if (b.powers.regen) heal(run, b.powers.regen, ev);
  if (b.powers.guard) gainBlock(b, b.powers.guard, ev);
  if (has(run, 'rope') && b.turn % 3 === 0) gainBlock(b, 6, ev);
  b.t = { played: 0, attacks: 0, drawn: 0 };
  let n = BASE_DRAW + (has(run, 'imugiScale') ? 1 : 0) + (b.turn === 1 && has(run, 'strawShoes') ? 2 : 0) + (b.powers.drawUp ?? 0) + (b.nextDraw ?? 0);
  b.nextDraw = 0;
  // 쥐(찍찍이): 턴 시작 1장 더 · 닭(꼬꼬댁): 전투 첫 턴 2장 더
  if (run.hero === 'rat') n += 1;
  if (run.hero === 'rooster' && b.turn === 1) n += 2;
  if ((b.st.mud ?? 0) > 0) {
    n -= 1;
    dec(b.st, 'mud');
  }
  drawCards(run, b, n, ev);
  if (b.discardNext > 0) {
    const r = rngOf(b, 'fx');
    for (let i = 0; i < b.discardNext && b.hand.length; i++) {
      const [c] = b.hand.splice(r.int(0, b.hand.length - 1), 1);
      b.discard.push(c);
      ev.push({ e: 'discard', uid: c.uid });
    }
    b.discardNext = 0;
  }
}

export function drawCards(run: RunState, b: Battle, n: number, ev: SimEvent[]) {
  for (let i = 0; i < n; i++) {
    if (!b.draw.length) {
      if (!b.discard.length) return;
      b.draw = rngOf(b, 'draw').shuffle(b.discard);
      b.discard = [];
      ev.push({ e: 'shuffle' });
    }
    const c = b.draw.pop()!;
    if (b.hand.length >= handMax(run)) {
      b.discard.push(c);
      ev.push({ e: 'discard', uid: c.uid });
    } else {
      b.hand.push(c);
      b.t.drawn = (b.t.drawn ?? 0) + 1;
      ev.push({ e: 'draw', uid: c.uid });
      // 무한 부채: 카드 뽑을 때마다 방어
      if (b.powers.drawBlock) gainBlock(b, b.powers.drawBlock, ev);
    }
  }
}

/** 이 카드를 지금 쓰는 데 드는 기력 */
export function playCost(run: RunState, b: Battle, c: BCard): number {
  if (c.free) return 0;
  if (b.freeAtk && cardDef(c.id).kind === 'atk') return 0;
  let cost = cardCost(c.id, c.up) - (c.cut ?? 0) - (b.cutNext ?? 0);
  if (has(run, 'beoseon') && !b.b.beoseon) cost -= 1;
  return Math.max(0, cost);
}

export function canPlay(run: RunState, c: BCard): boolean {
  const b = run.battle;
  if (!b || b.over) return false;
  return playCost(run, b, c) <= b.energy;
}

/** 카드 사용. 받아들여지지 않으면 false (상태는 그대로) */
export function playCard(run: RunState, uid: number, target: number | undefined, ev: SimEvent[]): boolean {
  const b = run.battle;
  if (!b || b.over || b.pending) return false;
  const idx = b.hand.findIndex((c) => c.uid === uid);
  if (idx < 0) return false;
  const c = b.hand[idx];
  const d = cardDef(c.id);
  const cost = playCost(run, b, c);
  if (cost > b.energy) return false;
  let foe: Foe | undefined;
  if (d.target === 'enemy') {
    foe = b.foes.find((f) => f.uid === target && !f.dead);
    if (!foe) return false;
  }
  b.energy -= cost;
  if (has(run, 'beoseon') && !b.b.beoseon) b.b.beoseon = true;
  // 그림자 걸음: 다음 카드 한 장에만
  b.cutNext = 0;
  b.hand.splice(idx, 1);
  b.t.played++;
  ev.push({ e: 'play', uid, id: c.id, target: foe?.uid });
  const firstDraw = b.t.played === 1 ? (b.powers.firstDraw ?? 0) : 0;
  let bonus = 0;
  let mult = 1;
  const firstAtk = d.kind === 'atk' && b.t.attacks === 0;
  if (d.kind === 'atk') {
    if (b.freeAtk) b.freeAtk = false;
    b.t.attacks++;
    b.b.attacks++;
    // 겨누기: 다음 공격카드 피해 2배
    if ((b.aim ?? 0) > 0) {
      b.aim!--;
      mult = 2;
    }
    // 어둑시니: 내가 공격카드를 쓸 때마다 힘 +1
    for (const f of aliveFoes(b)) {
      const rage = enemyDef(f.id).rage;
      if (rage) {
        f.str += rage;
        ev.push({ e: 'status', to: f.uid, id: 'str', n: rage });
      }
    }
    if (has(run, 'whetstone') && !b.b.whet) {
      b.b.whet = true;
      bonus += 4;
    }
    // 말(따각이): 턴마다 첫 공격카드 +3
    if (firstAtk && run.hero === 'horse') bonus += 3;
  }
  const ops = cardOps(c.id, c.up);
  const cx: OpCtx = { card: d.kind === 'atk', bonus, mult, hits: [] };
  runOps(run, b, ops, foe, ev, cx);
  // 천리마: 매 턴 첫 공격카드 한 번 더 발동
  if (firstAtk && b.powers.echoAtk && !b.over) {
    for (let k = 0; k < b.powers.echoAtk && !b.over; k++) {
      ev.push({ e: 'echo', id: c.id });
      runOps(run, b, ops, foe, ev, cx);
    }
  }
  // 뱀(스르르): 턴마다 첫 공격카드에 독1 (맞은 적)
  if (firstAtk && run.hero === 'snake' && !b.over) {
    for (const f of b.foes.filter((x) => cx.hits!.includes(x.uid) && !x.dead)) applyFoeStatus(run, b, f, 'poison', 1, ev);
  }
  // 홰치기: 매 턴 첫 카드를 쓰면 뽑기
  if (firstDraw && !b.over) drawCards(run, b, firstDraw, ev);
  if (!ops.some((o) => o.op === 'mimic')) b.lastCard = { id: c.id, up: c.up, target: foe?.uid };
  // 쓴 카드는 소멸 / 부적술(전투 내내 효과)은 덱에서 빠짐 / 나머지는 버린 더미
  c.free = undefined;
  c.cut = undefined;
  if (cardExhaust(c.id, c.up) || d.kind === 'curse') {
    b.exhaust.push(c);
    ev.push({ e: 'exhaust', uid });
    if (has(run, 'bambooTube') && !b.over) gainBlock(b, 4, ev);
  } else if (d.kind === 'power') {
    b.exhaust.push(c);
  } else {
    b.discard.push(c);
  }
  return true;
}

export function usePotion(run: RunState, slot: number, target: number | undefined, ev: SimEvent[]): boolean {
  const b = run.battle;
  if (!b || b.over || b.pending) return false;
  const id = run.potions[slot];
  if (!id) return false;
  const d = potionDef(id);
  let foe: Foe | undefined;
  if (d.target === 'enemy') {
    foe = b.foes.find((f) => f.uid === target && !f.dead);
    if (!foe) return false;
  }
  run.potions.splice(slot, 1);
  runOps(run, b, d.ops, foe, ev, { card: false, bonus: 0 });
  return true;
}

/** 손패에서 카드 고르기 (쥐구멍: 버리기 · 분신술: 복사본) */
export function pickHand(run: RunState, uid: number, ev: SimEvent[]): boolean {
  const b = run.battle;
  const p = b?.pending;
  if (!b || b.over || !p) return false;
  const idx = b.hand.findIndex((c) => c.uid === uid);
  if (idx < 0) return false;
  const c = b.hand[idx];
  if (p.kind === 'discard') {
    b.hand.splice(idx, 1);
    c.free = undefined;
    c.cut = undefined;
    b.discard.push(c);
    ev.push({ e: 'discard', uid: c.uid });
    p.n--;
    if (p.n <= 0 || !b.hand.length) b.pending = null;
  } else {
    for (let k = 0; k < p.n; k++) {
      const copy: BCard = { uid: nextTmpUid(b), id: c.id, tmp: true };
      if (c.up) copy.up = true;
      if (b.hand.length >= handMax(run)) b.discard.push(copy);
      else b.hand.push(copy);
    }
    ev.push({ e: 'clone', uid: c.uid, n: p.n });
    b.pending = null;
  }
  return true;
}

/** 턴 끝 (keep: 달빛 구슬로 손에 남길 카드) */
export function endTurn(run: RunState, keep: number | undefined, ev: SimEvent[]): boolean {
  const b = run.battle;
  if (!b || b.over || b.pending) return false;
  if (keep !== undefined && (!has(run, 'moonOrb') || !b.hand.some((c) => c.uid === keep))) return false;
  for (const c of b.hand) {
    const hurt = cardDef(c.id).endTurnHurt;
    if (hurt) hurtHero(run, b, hurt, ev);
    if (b.over) return true;
  }
  const kept: BCard[] = [];
  for (const c of b.hand) {
    c.free = undefined;
    c.cut = undefined;
    if (c.uid === keep) kept.push(c);
    else {
      b.discard.push(c);
      ev.push({ e: 'discard', uid: c.uid });
    }
  }
  b.hand = kept;
  const fire = b.st.fire ?? 0;
  if (fire > 0) {
    loseHp(run, b, fire * (scorching(b) ? 2 : 1), ev, 'status');
    dec(b.st, 'fire');
    if (b.over) return true;
  }
  dec(b.st, 'weak');
  foesTurn(run, b, ev);
  if (b.over) return true;
  startTurn(run, b, ev);
  return true;
}

// ---------- 요괴 차례 ----------

function foesTurn(run: RunState, b: Battle, ev: SimEvent[]) {
  ev.push({ e: 'turn', who: 'foes', turn: b.turn });
  // 영웅의 젖음은 요괴 차례가 끝날 때 1 줄어든다 — 이 차례에 새로 걸린 젖음은 줄지 않아 '젖음 n = 받는 요괴 공격 차례 n 번'
  const wetAtStart = (b.st.wet ?? 0) > 0;
  // 행동한 요괴와 그 행동 때의 단계 — 행동 뒤(반격·화상)에 단계가 바뀌었으면 새 단계 첫 의도가 이미 정해져 있어 다시 뽑지 않는다
  const acted: [Foe, number][] = [];
  for (const f of [...b.foes]) {
    if (f.dead) continue;
    f.block = 0;
    // 어둠 속은 다음 행동까지
    if (f.dark) {
      f.dark = false;
      ev.push({ e: 'dark', uid: f.uid, on: false });
    }
    const p = f.st.poison ?? 0;
    if (p > 0) {
      foeLoseHp(run, b, f, p, ev);
      dec(f.st, 'poison');
      if (b.over) return;
      if (f.dead) continue;
    }
    const d = enemyDef(f.id);
    const phaseBefore = f.phase;
    if (f.stun) {
      // 시간 멈춤: 이번 행동을 건너뜀
      f.stun = false;
      ev.push({ e: 'stunned', uid: f.uid });
    } else {
      const ph = phaseOf(d, f.phase);
      if (ph.turnOps) runFoeOps(run, b, f, ph.turnOps, ev);
      if (b.over) return;
      if (f.intent && !f.dead) {
        const m = moveDef(d, f.phase, f.intent);
        ev.push({ e: 'foeMove', uid: f.uid, move: m.id, name: m.name });
        f.last = m.id;
        // 예고(charge)가 아닌 행동을 하면 예고는 끝 (대해일을 쏟았거나 단계가 바뀜)
        if (!m.ops.some((o) => o.op === 'charge')) f.charge = null;
        runFoeOps(run, b, f, m.ops, ev);
        if (b.over) return;
      }
    }
    acted.push([f, phaseBefore]);
    if (f.dead) continue;
    const fire = f.st.fire ?? 0;
    if (fire > 0) {
      foeLoseHp(run, b, f, fire, ev);
      dec(f.st, 'fire');
      if (b.over) return;
    }
    dec(f.st, 'wet');
    dec(f.st, 'weak');
  }
  for (const [f, ph] of acted) if (!f.dead && f.phase === ph) rollIntent(b, f);
  if (wetAtStart) dec(b.st, 'wet');
}

function runFoeOps(run: RunState, b: Battle, f: Foe, ops: EOp[], ev: SimEvent[]) {
  for (const o of ops) {
    if (b.over || f.dead) return;
    switch (o.op) {
      case 'dmg':
        for (let i = 0; i < (o.times ?? 1) && !b.over && !f.dead; i++) hitHero(run, b, f, o.n, ev);
        break;
      case 'block':
        f.block += o.n;
        ev.push({ e: 'block', to: f.uid, n: o.n });
        break;
      case 'str':
        f.str += o.n;
        ev.push({ e: 'status', to: f.uid, id: 'str', n: o.n });
        break;
      case 'status':
        applyHeroStatus(run, b, o.id, o.n, ev);
        break;
      case 'curse':
        addCurse(b, o.id, o.n, o.pile, ev);
        break;
      case 'summon': {
        const have = b.foes.filter((x) => !x.dead && x.id === o.id).length;
        for (let i = 0; i < o.n && have + i < o.max; i++) {
          const m = addFoe(b, o.id, false);
          rollIntent(b, m);
          ev.push({ e: 'summon', uid: m.uid });
        }
        break;
      }
      case 'discardNext':
        b.discardNext += o.n;
        break;
      case 'dodge':
        f.dodge += o.n;
        ev.push({ e: 'hide', uid: f.uid });
        break;
      case 'halveBlock': {
        const cut = Math.ceil(b.block / 2);
        if (cut > 0) {
          b.block -= cut;
          ev.push({ e: 'block', to: 'hero', n: -cut });
        }
        break;
      }
      case 'drain':
        b.nextEnergy = (b.nextEnergy ?? 0) - o.n;
        ev.push({ e: 'drain', n: o.n });
        break;
      case 'karma':
        hitHero(run, b, f, b.b.attacks * o.k, ev);
        break;
      case 'charge':
        if (f.charge == null) f.charge = o.n;
        break;
      case 'dark':
        f.dark = true;
        ev.push({ e: 'dark', uid: f.uid, on: true });
        break;
    }
  }
}

/** 다음 의도 정하기 */
export function rollIntent(b: Battle, f: Foe) {
  if (f.next) {
    // 냄새 추적으로 미리 정해 둔 행동
    f.intent = f.next;
    f.next = null;
    return;
  }
  f.intent = nextMove(b, f, f.last);
}

/** 다음 행동 하나 뽑기 (last = 바로 앞 행동, 되풀이 금지용) */
function nextMove(b: Battle, f: Foe, last: string | null): string {
  const ai = phaseOf(enemyDef(f.id), f.phase).ai;
  if (ai.type === 'cycle') {
    const m = ai.order[f.cyc % ai.order.length];
    f.cyc++;
    return m;
  }
  const list = ai.noRepeat && ai.weights.length > 1 ? ai.weights.filter(([id]) => id !== last) : ai.weights;
  return rngOf(b, 'ai').weighted(list);
}

// ---------- 효과 ----------

interface OpCtx {
  /** 공격 카드 (담금질·숫돌·번개 부채·약화가 붙는 피해) */
  card: boolean;
  bonus: number;
  /** 피해 배수 (겨누기 2배) */
  mult?: number;
  /** 이 카드에 맞은 적 (뱀 패시브) */
  hits?: number[];
}

function runOps(run: RunState, b: Battle, ops: Op[], foe: Foe | undefined, ev: SimEvent[], cx: OpCtx) {
  for (const o of ops) {
    if (b.over) return;
    switch (o.op) {
      case 'dmg': {
        const to = o.to ?? 'target';
        const times = o.times ?? 1;
        const base = o.n + (o.per ? Math.floor((o.k ?? 1) * perValue(run, b, o.per) + 1e-9) : 0);
        let dealt = 0;
        for (let i = 0; i < times && !b.over; i++) {
          for (const f of targets(b, to, foe)) {
            const on = !!o.ifSt && (f.st[o.ifSt] ?? 0) > 0;
            const n = (base + (on ? (o.ifN ?? 0) : 0)) * (on && o.ifK ? o.ifK : 1);
            cx.hits?.push(f.uid);
            dealt += hitFoe(run, b, f, n, ev, cx, !!o.pierce);
          }
        }
        // 흡혈 베기: 준 피해(체력에서 깎인 만큼)의 일부 회복
        if (o.steal && dealt > 0 && !b.over) heal(run, Math.floor(dealt * o.steal), ev);
        break;
      }
      case 'block':
        gainBlock(b, o.n, ev);
        break;
      case 'clearBlock':
        if (b.block > 0) {
          ev.push({ e: 'block', to: 'hero', n: -b.block });
          b.block = 0;
        }
        break;
      case 'cleanse':
        for (const id of Object.keys(b.st) as StatusId[]) {
          ev.push({ e: 'status', to: 'hero', id, n: -(b.st[id] ?? 0) });
          delete b.st[id];
        }
        break;
      case 'mulSt': {
        const f = foe && !foe.dead ? foe : null;
        const v = f?.st[o.id] ?? 0;
        if (f && v > 0) {
          f.st[o.id] = v * o.k;
          ev.push({ e: 'status', to: f.uid, id: o.id, n: v * (o.k - 1) });
        }
        break;
      }
      case 'maxHp':
        run.maxHp += o.n;
        run.hp += o.n;
        ev.push({ e: 'heal', n: o.n });
        break;
      case 'nextEnergy':
        b.nextEnergy = (b.nextEnergy ?? 0) + o.n;
        break;
      case 'discount':
        for (const c of b.hand) if (cardDef(c.id).kind === o.kind) c.cut = (c.cut ?? 0) + o.n;
        break;
      case 'nextFreeAtk':
        b.nextFreeAtk = true;
        break;
      case 'peek':
        if (foe && !foe.dead && foe.intent && !foe.next) {
          foe.next = nextMove(b, foe, foe.intent);
          ev.push({ e: 'peek', uid: foe.uid });
        }
        break;
      case 'mimic': {
        const last = b.lastCard;
        if (!last) break;
        const ld = cardDef(last.id);
        let t: Foe | undefined;
        if (ld.target === 'enemy') {
          t = b.foes.find((f) => f.uid === last.target && !f.dead) ?? aliveFoes(b)[0];
          if (!t) break;
        }
        ev.push({ e: 'mimic', id: last.id });
        runOps(run, b, cardOps(last.id, last.up), t, ev, { card: ld.kind === 'atk', bonus: 0, hits: cx.hits });
        break;
      }
      case 'pick':
        if (b.hand.length) b.pending = { kind: o.kind, n: o.n };
        break;
      case 'draw':
        drawCards(run, b, o.n, ev);
        break;
      case 'energy':
        b.energy += o.n;
        ev.push({ e: 'energy', n: b.energy });
        break;
      case 'status': {
        const to = o.to ?? 'target';
        if (to === 'self') applyHeroStatus(run, b, o.id, o.n, ev);
        else for (const f of targets(b, to, foe)) applyFoeStatus(run, b, f, o.id, o.n + (o.plus && (f.st[o.id] ?? 0) > 0 ? o.plus : 0), ev);
        break;
      }
      case 'spread': {
        const v = foe && !foe.dead ? (foe.st[o.id] ?? 0) : 0;
        if (v > 0) for (const f of targets(b, 'others', foe)) applyFoeStatus(run, b, f, o.id, v, ev);
        break;
      }
      case 'winGold':
        b.b.gold = (b.b.gold ?? 0) + o.n;
        break;
      case 'nextCut':
        b.cutNext = (b.cutNext ?? 0) + o.n;
        break;
      case 'aim':
        b.aim = (b.aim ?? 0) + 1;
        break;
      case 'freeRandom': {
        const r = rngOf(b, 'fx');
        for (let k = 0; k < o.n; k++) {
          const list = b.hand.filter((c) => !c.free);
          if (!list.length) break;
          const c = r.pick(list);
          c.free = true;
          ev.push({ e: 'free', uid: c.uid });
        }
        break;
      }
      case 'nextDraw':
        b.nextDraw = (b.nextDraw ?? 0) + o.n;
        break;
      case 'ward':
        b.ward = (b.ward ?? 0) + o.n;
        break;
      case 'stun':
        for (const f of aliveFoes(b)) f.stun = true;
        ev.push({ e: 'stunned', uid: 0 });
        break;
      case 'heal':
        heal(run, o.n, ev);
        break;
      case 'nextBlock':
        b.nextBlock += o.n;
        break;
      case 'thorns':
        b.thorns += o.n;
        break;
      case 'power':
        b.powers[o.id] = (b.powers[o.id] ?? 0) + o.n;
        break;
    }
  }
}

/** 피해에 더하는 '무엇 1당' 값 */
export function perValue(run: RunState, b: Battle, per: string): number {
  switch (per) {
    case 'drawn':
      return b.t.drawn ?? 0;
    case 'played':
      // 이 카드 앞에 쓴 카드 (쓰는 중인 카드는 이미 셌다)
      return Math.max(0, b.t.played - 1);
    case 'block':
      return b.block;
    case 'energy':
      return b.energy;
    case 'maxHp':
      return run.maxHp;
    case 'battleAtk':
      return b.b.attacks;
    default:
      return 0;
  }
}

function targets(b: Battle, to: string, foe: Foe | undefined): Foe[] {
  const alive = aliveFoes(b);
  if (to === 'all') return alive;
  if (to === 'others') return alive.filter((f) => f !== foe);
  if (to === 'random') return alive.length ? [rngOf(b, 'fx').pick(alive)] : [];
  return foe && !foe.dead ? [foe] : [];
}

/** 영웅이 요괴에게 주는 피해 계산 (화면 미리보기에도 쓴다) */
export function heroDamage(run: RunState, b: Battle, f: Foe, base: number, cx: OpCtx): number {
  let n = base;
  if (cx.card) {
    n += (b.powers.atkUp ?? 0) + cx.bonus;
    if (has(run, 'thunderFan') && (f.st.wet ?? 0) > 0) n += 3;
  }
  let mult = 1;
  if (cx.card && (b.st.weak ?? 0) > 0) mult *= 0.75;
  // 개(멍뭉이): 체력 50% 이하면 피해 +25%
  if (cx.card && run.hero === 'dog' && run.hp * 2 <= run.maxHp) mult *= 1.25;
  if ((f.st.wet ?? 0) > 0) mult *= 1.5;
  if (cx.card && b.powers.weakBonus && (f.st.weak ?? 0) > 0) mult *= 1 + b.powers.weakBonus / 100;
  if (has(run, 'tigerWhisker') && (f.boss || f.elite)) mult *= 1.2;
  const ph = phaseOf(enemyDef(f.id), f.phase);
  if (ph.passive === 'cloneShield' && b.foes.some((x) => !x.dead && x.minion)) mult *= 0.5;
  // 야광귀 어둠 속: 받는 피해 -75%
  if (f.dark) mult *= 0.25;
  if (cx.mult) mult *= cx.mult;
  return Math.max(0, Math.floor(n * mult + 1e-9));
}

/** 영웅의 공격 한 번 (돌려줌: 체력에서 깎인 피해) */
function hitFoe(run: RunState, b: Battle, f: Foe, base: number, ev: SimEvent[], cx: OpCtx, pierce: boolean): number {
  if (f.dead) return 0;
  if (f.dodge > 0) {
    f.dodge--;
    ev.push({ e: 'dodge', to: f.uid });
    return 0;
  }
  const n = heroDamage(run, b, f, base, cx);
  const blocked = pierce ? 0 : Math.min(f.block, n);
  f.block -= blocked;
  ev.push({ e: 'hit', to: f.uid, n: n - blocked, blocked, from: 'hero' });
  const before = f.hp;
  foeLoseHp(run, b, f, n - blocked, ev, true);
  return Math.min(before, n - blocked);
}

function foeLoseHp(run: RunState, b: Battle, f: Foe, n: number, ev: SimEvent[], already = false) {
  if (!already) ev.push({ e: 'hit', to: f.uid, n, blocked: 0, from: 'status' });
  if (n <= 0) return;
  f.hp -= n;
  const d = enemyDef(f.id);
  let revived = false;
  if (f.hp <= 0) {
    // 불가살(2단계 특성): 한 번 체력 30% 로 부활 (화상이 걸려 있으면 못 함) — 1단계에서 한 번에 쓰러뜨려도 부활하고 2단계로 넘어간다
    if (canRevive(d) && !f.revived && !((f.st.fire ?? 0) > 0)) {
      f.revived = true;
      revived = true;
      f.hp = Math.round(f.maxHp * 0.3);
      ev.push({ e: 'foeRevive', uid: f.uid, hp: f.hp });
    } else {
      f.hp = 0;
      f.dead = true;
      ev.push({ e: 'die', uid: f.uid });
      checkWin(run, b, ev);
      return;
    }
  }
  // 이무기 승천 예고 중: 피해가 쌓이면 취소 (떨어짐)
  if (!revived && f.charge != null) {
    f.charge -= n;
    if (f.charge <= 0) {
      f.charge = null;
      const ph = phaseOf(d, f.phase);
      if (ph.moves.some((m) => m.id === 'fall') && ph.ai.type === 'cycle') {
        f.intent = 'fall';
        f.next = null;
        const wave = ph.ai.order.indexOf('wave');
        f.cyc = wave >= 0 ? wave + 1 : 0;
      }
      ev.push({ e: 'cancel', uid: f.uid });
    }
  }
  // 단계 바꾸기 (2단계 50% · 어둑시니 66%·33%)
  const at = phaseAt(d);
  while (f.phase - 1 < at.length && f.hp <= f.maxHp * at[f.phase - 1] + 1e-9) {
    f.phase = (f.phase + 1) as 2 | 3;
    f.cyc = 0;
    f.last = null;
    f.next = null;
    f.charge = null;
    f.dark = false;
    const ph = phaseOf(d, f.phase);
    ev.push({ e: 'phase', uid: f.uid, text: ph.shout ?? '', n: f.phase });
    rollIntent(b, f);
  }
}

/** 어느 단계든 부활 특성이 있는 요괴 (불가살) */
const canRevive = (d: EnemyDef): boolean => [d.phase1, d.phase2, d.phase3].some((ph) => ph?.passive === 'revive');

function checkWin(run: RunState, b: Battle, ev: SimEvent[]) {
  if (b.foes.some((f) => !f.dead && !f.minion)) return;
  for (const f of b.foes) {
    if (!f.dead) {
      f.dead = true;
      ev.push({ e: 'die', uid: f.uid });
    }
  }
  b.over = 'win';
  ev.push({ e: 'win' });
  void run;
}

/** 요괴가 영웅에게 주는 피해 (의도 숫자에도 쓴다). run 이 있으면 저승사자 2단계(내 체력 30% 이하면 2배)까지 */
export function foeDamage(b: Battle, f: Foe, base: number, run?: RunState): number {
  const m = b.mods;
  // 숙련 2: 일반 전투 요괴 공격 +1 (공격 한 번마다)
  let n = base + f.str + (m && b.kind === 'battle' && base > 0 ? m.add : 0);
  let mult = m ? m.dmg : 1;
  if ((f.st.weak ?? 0) > 0) mult *= 0.75;
  if ((b.st.wet ?? 0) > 0) mult *= 1.5;
  if (run && phaseOf(enemyDef(f.id), f.phase).passive === 'execute' && run.hp * 10 <= run.maxHp * 3) mult *= 2;
  n = Math.floor(n * mult + 1e-9);
  return Math.max(0, n);
}

/** 요괴 행동 하나의 공격 (피해 × 횟수) — 업보는 지금까지 쓴 공격카드 수로 계산 */
export function moveHits(run: RunState, b: Battle, f: Foe, ops: EOp[]): { n: number; times: number }[] {
  const out: { n: number; times: number }[] = [];
  for (const o of ops) {
    if (o.op === 'dmg') out.push({ n: foeDamage(b, f, o.n, run), times: o.times ?? 1 });
    else if (o.op === 'karma') out.push({ n: foeDamage(b, f, b.b.attacks * o.k, run), times: 1 });
  }
  return out;
}

/** 이 요괴가 다음 차례에 줄 공격 (매 턴 행동 + 의도). 시간 멈춤이면 없음 */
export function foeHits(run: RunState, b: Battle, f: Foe): { n: number; times: number }[] {
  if (f.dead || f.stun) return [];
  const d = enemyDef(f.id);
  const ph = phaseOf(d, f.phase);
  const m: MoveDef | null = f.intent ? moveDef(d, f.phase, f.intent) : null;
  return [...moveHits(run, b, f, ph.turnOps ?? []), ...(m ? moveHits(run, b, f, m.ops) : [])];
}

function hitHero(run: RunState, b: Battle, f: Foe, base: number, ev: SimEvent[]) {
  const n = foeDamage(b, f, base, run);
  if (b.foxShield) {
    b.foxShield = false;
    ev.push({ e: 'relic', id: 'foxOrb' });
    ev.push({ e: 'hit', to: 'hero', n: 0, blocked: n, from: f.uid });
    return;
  }
  const blocked = Math.min(b.block, n);
  b.block -= blocked;
  ev.push({ e: 'hit', to: 'hero', n: n - blocked, blocked, from: f.uid });
  if (n - blocked > 0) loseHp(run, b, n - blocked, ev, f.uid);
  if (b.over) return;
  if (b.thorns > 0 && !f.dead) {
    const t = Math.min(f.block, b.thorns);
    f.block -= t;
    ev.push({ e: 'hit', to: f.uid, n: b.thorns - t, blocked: t, from: 'hero' });
    foeLoseHp(run, b, f, b.thorns - t, ev, true);
  }
}

/** 방어로 막히는 공격 아닌 피해 (저승 사슬) */
function hurtHero(run: RunState, b: Battle, n: number, ev: SimEvent[]) {
  const blocked = Math.min(b.block, n);
  b.block -= blocked;
  ev.push({ e: 'hit', to: 'hero', n: n - blocked, blocked, from: 'status' });
  if (n - blocked > 0) loseHp(run, b, n - blocked, ev, 'status');
}

function loseHp(run: RunState, b: Battle, n: number, ev: SimEvent[], from: 'status' | number) {
  if (from === 'status') ev.push({ e: 'hit', to: 'hero', n, blocked: 0, from: 'status' });
  const before = run.hp;
  run.hp -= n;
  if (run.hp <= 0) {
    // 부활 순서: 고양이 패시브 → 불사조 깃 → 불가살 쇠조각
    // 고양이(야옹이): 한 판에 한 번 체력1로 버티고 방어10
    if (run.hero === 'cat' && !run.flags.catUsed) {
      run.flags.catUsed = true;
      run.hp = 1;
      ev.push({ e: 'revive', who: 'cat' });
      gainBlock(b, 10, ev);
      return;
    }
    // 불사조 깃: 이 전투에서 한 번 체력 n% 로 일어남
    if (b.powers.phoenix && !b.b.phoenix) {
      b.b.phoenix = true;
      run.hp = Math.max(1, Math.floor((run.maxHp * b.powers.phoenix) / 100));
      ev.push({ e: 'revive', who: 'phoenix' });
      return;
    }
    if (has(run, 'bulgasalIron') && !run.flags.ironUsed) {
      run.flags.ironUsed = true;
      run.hp = Math.max(1, Math.floor(run.maxHp * 0.2));
      ev.push({ e: 'revive', who: 'bulgasalIron' });
      return;
    }
    run.hp = 0;
    b.over = 'lose';
    ev.push({ e: 'lose' });
    return;
  }
  if (has(run, 'sorghum') && !b.b.sorghum && before * 2 > run.maxHp && run.hp * 2 <= run.maxHp) {
    b.b.sorghum = true;
    ev.push({ e: 'relic', id: 'sorghum' });
    heal(run, 10, ev);
  }
}

export function heal(run: RunState, n: number, ev: SimEvent[]) {
  const h = Math.min(n, run.maxHp - run.hp);
  if (h <= 0) return;
  run.hp += h;
  ev.push({ e: 'heal', n: h });
}

function gainBlock(b: Battle, n: number, ev: SimEvent[]) {
  // 우직함: 방어 얻을 때마다 +n
  n += b.powers.blockUp ?? 0;
  b.block += n;
  ev.push({ e: 'block', to: 'hero', n });
}

function applyFoeStatus(run: RunState, b: Battle, f: Foe, id: StatusId, n: number, ev: SimEvent[]) {
  if (f.dead) return;
  if (id === 'fire' && has(run, 'emberCharm')) n += 1;
  if (id === 'poison' && b.powers.poisonUp) n += b.powers.poisonUp;
  f.st[id] = (f.st[id] ?? 0) + n;
  ev.push({ e: 'status', to: f.uid, id, n });
  // 야광귀: 화상을 걸면 어둠 속이 풀린다
  if (id === 'fire' && f.dark) {
    f.dark = false;
    ev.push({ e: 'dark', uid: f.uid, on: false });
  }
  // 강철이 2단계: 젖음을 걸면 내 화상이 (젖음 1당 2) 줄어든다
  if (id === 'wet' && phaseOf(enemyDef(f.id), f.phase).passive === 'scorch' && (b.st.fire ?? 0) > 0) {
    const cut = Math.min(b.st.fire ?? 0, n * SCORCH_QUENCH);
    b.st.fire = (b.st.fire ?? 0) - cut;
    if (!b.st.fire) delete b.st.fire;
    ev.push({ e: 'status', to: 'hero', id: 'fire', n: -cut });
  }
}

/** 강철이: 젖음 1을 걸 때 줄어드는 내 화상 (정한 값) */
export const SCORCH_QUENCH = 2;

/** 강철이 2단계가 살아 있으면 내 화상 피해 2배 */
const scorching = (b: Battle) => aliveFoes(b).some((f) => phaseOf(enemyDef(f.id), f.phase).passive === 'scorch');

function applyHeroStatus(run: RunState, b: Battle, id: StatusId, n: number, ev: SimEvent[]) {
  if (id === 'wet' && has(run, 'umbrella')) return;
  // 거울 부채: 이번에 받는 상태이상 막기
  if ((b.ward ?? 0) > 0) {
    b.ward!--;
    ev.push({ e: 'ward' });
    return;
  }
  b.st[id] = (b.st[id] ?? 0) + n;
  ev.push({ e: 'status', to: 'hero', id, n });
}

function addCurse(b: Battle, id: string, n: number, pile: 'draw' | 'discard', ev: SimEvent[]) {
  const r = rngOf(b, 'fx');
  for (let i = 0; i < n; i++) {
    // 전투에서 생긴 카드 번호는 덱(1~)과 겹치지 않게 90000~
    const c: BCard = { uid: nextTmpUid(b), id, tmp: true };
    if (pile === 'draw') b.draw.splice(r.int(0, b.draw.length), 0, c);
    else b.discard.push(c);
  }
  ev.push({ e: 'curse', id, n });
}

function nextTmpUid(b: Battle): number {
  let m = 90000;
  for (const pile of [b.hand, b.draw, b.discard, b.exhaust]) for (const c of pile) if (c.uid >= m) m = c.uid + 1;
  return m;
}

function dec(st: Statuses, id: StatusId) {
  const v = st[id] ?? 0;
  if (v <= 1) delete st[id];
  else st[id] = v - 1;
}

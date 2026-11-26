/**
 * '그럴듯한 사람' 봇 (6단계 밸런스용). 화면과 같은 입력(apply)만 쓴다 — 판 규칙을 몰래 바꾸지 않는다.
 *
 * 전투: 이번 턴에 쓸 수 있는 카드·물약을 하나씩(그리고 그 뒤 한 장 더) 복사본에서 실제로 써 보고, 턴을 끝내
 *   요괴 차례까지 돌린 뒤의 상태를 점수로 매겨 가장 좋은 것을 쓴다(아무것도 나아지지 않으면 턴 끝).
 *   점수 = 내 체력 − 요괴 체력 + 쓰러뜨린 요괴 + 걸어 둔 독·화상·약화·젖음 + 부적술 + 다음 턴 방어·기력·손패 − 내 상태이상 − 내림카드
 *   (요괴 의도는 사람도 보는 정보. 복사본에서 뽑기 카드를 쓰면 실제로 뽑히는 카드를 미리 보는 셈이라 아주 조금 유리하다.)
 *   물약은 '남겨 두는 값'이 있어 일반 전투에서는 아껴 쓰고, 정예·보스나 쓰러지기 직전에는 쓴다.
 * 판: 지도는 남은 길을 모두 따져 체력·엽전 흐름으로 고르고, 카드 보상은 카드 값표 + 덱 구성(공격·방어 비율, 독·화상·젖음 짝)으로
 *   덱 평균보다 충분히 좋을 때만 받는다. 상점은 카드 없애기(내림카드 → 베기 → 막기) · 좋은 부적 · 좋은 카드 · 물약,
 *   쉼터는 체력이 낮거나 보스 앞이면 회복 아니면 강화, 이야기는 사건마다 정한 규칙.
 */
import {
  BASE_ENERGY,
  aliveFoes,
  apply,
  canChoose,
  canUpgrade,
  cardDef,
  choices,
  endTurn,
  enemyDef,
  eventDef,
  foeHits,
  pickHand,
  playCard,
  playCost,
  potionDef,
  reachable,
  removePrice,
  restHeal,
  restUpgrades,
  upgradable,
  usePotion,
  type Battle,
  type BCard,
  type DeckCard,
  type Input,
  type RunState,
  type SimEvent,
} from '../src/game/rules';

// ---------------- 카드·부적 값표 (사람 감각으로 정한 값, 0~10) ----------------

export const CARD_VALUE: Record<string, number> = {
  slash: 1, guard: 1.2,
  arrowRain: 5, spin: 5.5, thrust: 5.5, doubleSlash: 4, smash: 4.5, rake: 5.5, ember: 4.5, shieldUp: 5, crouch: 5.5, counter: 4,
  poisonFog: 5, spearThrow: 5, bowShot: 4.5, windCut: 5.5, coinThrow: 3.5, sling: 3.5, tripleStab: 4.5, trident: 4.5, endure: 4.5,
  shadowStep: 3.5, stoneWall: 5, fanWind: 5, rainDrop: 3, herb: 2, aim: 3.5, stickyBurr: 4.5, pollen: 4.5, breathe: 4.5,
  fireTalisman: 6, ironWall: 6.5, temper: 7, gather: 5.5, boltTalisman: 6, whirlwind: 6.5, arrowStorm: 5.5, shockwave: 7,
  poisonSpear: 6.5, vampSlash: 5.5, foxBead: 5, boneBreak: 6.5, roll: 5.5, mirrorFan: 5.5, wisdomOrb: 6, spreadPoison: 3,
  wildfire: 5, viperPath: 4, swiftBody: 6, guardian: 6.5,
  diamond: 7.5, twelveArray: 8, thunderGeneral: 8.5, dragonRise: 7, meteor: 8, infiniteFan: 6, myriadPoison: 5, timeStop: 6.5,
  phoenixFeather: 6.5, haetae: 7,
  ratHole: 3, ratFire: 6.5, headbutt: 4, steadfast: 6, tigerClaw: 4.5, tigerMajesty: 5, hop: 4.5, mortar: 5.5, dragonBreath: 6,
  ascend: 7, coil: 3, shed: 5, charge: 5, galloper: 7, woolShield: 5, shear: 6, mimic: 2, cloneArt: 6, peck: 4.5, crow: 5.5,
  watchdog: 5.5, track: 4.5, bellyFlop: 4.5, gluttony: 6, scratch: 3.5, sneak: 4.5,
  prank: -3, chain: -4,
};

export const RELIC_VALUE: Record<string, number> = {
  gourd: 6, luckyPouch: 3, goblinClub: 5, woodShield: 6, cairnStone: 6, whetstone: 5, strawShoes: 4, rope: 5, sorghum: 5,
  emberCharm: 3, snakeFang: 5, umbrella: 4, janggu: 6, coinPurse: 4,
  tigerWhisker: 7, smithHammer: 5, treasureMap: 4, moonOrb: 3, beoseon: 4.5, bambooTube: 3, magpieFeather: 5, wildGinseng: 5,
  iceJar: 5, thunderFan: 4,
  dragonPearl: 9, yeomraLedger: 8, foxOrb: 5, bulgasalIron: 6.5, imugiScale: 6, dokkaebiClub: 3,
};

const has = (run: RunState, id: string) => run.relics.includes(id);
const cv = (id: string) => CARD_VALUE[id] ?? 4;

/** 덱 구성 (공격·방어·짝 카드 수) */
function deckInfo(deck: DeckCard[]) {
  let atk = 0;
  let def = 0;
  let poison = 0;
  let fire = 0;
  let wet = 0;
  let block = 0;
  let aoe = 0;
  for (const c of deck) {
    const d = cardDef(c.id);
    if (d.kind === 'atk') atk++;
    for (const o of d.ops) {
      if (o.op === 'block') {
        def++;
        block += o.n;
      }
      if (o.op === 'status' && o.id === 'poison') poison++;
      if (o.op === 'status' && o.id === 'fire') fire++;
      if (o.op === 'status' && o.id === 'wet') wet++;
      if (o.op === 'dmg' && (o.to === 'all' || o.to === 'random')) aoe++;
    }
  }
  return { atk, def, poison, fire, wet, block, aoe, n: deck.length };
}

/** 이 덱에 이 카드를 넣었을 때의 값 */
export function cardWorth(run: RunState, id: string, up = false): number {
  const d = cardDef(id);
  const info = deckInfo(run.deck);
  let v = cv(id) + (up ? 1 : 0);
  // 짝: 독·화상·젖음을 키우는 카드는 그 상태를 거는 카드가 있어야 값이 있다
  if (id === 'coil' || id === 'myriadPoison' || id === 'spreadPoison') v += Math.min(3, info.poison * 1.2) + (run.hero === 'snake' ? 1 : 0);
  if (id === 'viperPath') v += Math.min(3, info.poison);
  if (id === 'ascend' || id === 'wildfire') v += Math.min(2, info.fire * 0.7);
  if (id === 'boltTalisman') v += Math.min(2, info.wet * 0.7) + (has(run, 'thunderFan') ? 1 : 0);
  if ((id === 'headbutt' || id === 'shear') && info.def >= 6) v += 1;
  if (id === 'temper' || id === 'dragonRise') v += Math.min(1.5, info.atk * 0.1);
  // 공격·방어 균형: 모자란 쪽 카드가 더 좋다
  const atkShare = info.atk / Math.max(1, info.n);
  if (d.kind === 'atk' && atkShare < 0.45) v += 0.8;
  if (d.kind === 'def' && info.def < info.n * 0.35) v += 0.8;
  if (d.ops.some((o) => o.op === 'dmg' && (o.to === 'all' || o.to === 'random')) && info.aoe < 2) v += 0.7;
  // 같은 카드가 이미 많으면 덜
  const same = run.deck.filter((c) => c.id === id).length;
  v -= same * 0.6;
  if (d.kind === 'power') v -= run.deck.filter((c) => cardDef(c.id).kind === 'power').length * 0.4;
  return v;
}

/** 지금 덱 평균 값 (받을지 말지의 기준) */
function deckAvg(run: RunState): number {
  let s = 0;
  for (const c of run.deck) s += cv(c.id) + (c.up ? 1 : 0);
  return s / Math.max(1, run.deck.length);
}

/** 카드를 덱에 넣을 만한가 — 덱 평균보다 충분히 좋고, 덱이 커질수록 더 까다롭게 */
function takeBar(run: RunState): number {
  return Math.max(3, deckAvg(run) + OPT.bar + Math.max(0, run.deck.length - 18) * 0.25);
}

/** 없앨 카드 (내림카드 → 베기 → 막기 → 가장 값 낮은 것) */
function worstCard(run: RunState): DeckCard {
  const sorted = [...run.deck].sort((a, b) => cv(a.id) + (a.up ? 1 : 0) - (cv(b.id) + (b.up ? 1 : 0)));
  return sorted[0];
}

/** 강화할 카드 (값 높은 것, 기본 카드는 뒤로) */
function bestUpgrades(run: RunState, n: number): DeckCard[] {
  return upgradable(run)
    .sort((a, b) => upWorth(b.id) - upWorth(a.id))
    .slice(0, n);
}
function upWorth(id: string): number {
  const d = cardDef(id);
  let v = cv(id);
  // 기력이 줄어드는 강화(부적술 등)는 크다
  if (d.up?.cost !== undefined && d.up.cost < d.cost) v += 1.5;
  return v;
}

// ---------------- 전투 ----------------

export interface BotOpts {
  /** 내 체력 1의 값 (요괴 체력 1 = 1) */
  wHp: number;
  /** 물약 남겨 두는 값: 일반 전투 / 정예·보스 */
  potionKeep: number;
  potionKeepBig: number;
  /** 두 걸음 앞을 볼 후보 수 */
  deep: number;
  /** 지도에서 정예 칸 값 (체력 75% 넘을 때) */
  eliteV: number;
  /** 카드 보상 받는 기준 (덱 평균보다 이만큼 좋아야) */
  bar: number;
}
export const DEFAULT_OPTS: BotOpts = { wHp: 1.4, potionKeep: 24, potionKeepBig: 6, deep: 5, eliteV: 3, bar: 1.2, ...envOpts() };
/** 실험용: BOT_OPTS='{"wHp":2}' */
function envOpts(): Partial<BotOpts> {
  try {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
    const s = g.process?.env?.BOT_OPTS;
    return s ? (JSON.parse(s) as Partial<BotOpts>) : {};
  } catch {
    return {};
  }
}

/** 지도·보상 쪽에서 쓰는 설정 (전투 쪽은 인자로) */
let OPT: BotOpts = DEFAULT_OPTS;

const cp = (c: BCard): BCard => ({ ...c });
function cloneBattle(b: Battle): Battle {
  return {
    ...b,
    hand: b.hand.map(cp),
    draw: b.draw.map(cp),
    discard: b.discard.map(cp),
    exhaust: b.exhaust.map(cp),
    st: { ...b.st },
    powers: { ...b.powers },
    foes: b.foes.map((f) => ({ ...f, st: { ...f.st } })),
    rng: { ...b.rng },
    t: { ...b.t },
    b: { ...b.b },
    lastCard: b.lastCard ? { ...b.lastCard } : b.lastCard,
    pending: b.pending ? { ...b.pending } : b.pending,
  };
}
function cloneRun(run: RunState): RunState {
  return { ...run, battle: cloneBattle(run.battle!), potions: [...run.potions], flags: { ...run.flags } };
}

type Act = { k: 'play'; uid: number; target?: number } | { k: 'potion'; slot: number; target?: number };
const noEv: SimEvent[] = [];

/** 쥐구멍(버리기)·분신술(복사) 고르기 */
function pickFor(run: RunState): number {
  const b = run.battle!;
  const val = (c: BCard) => cv(c.id) + (c.up ? 1 : 0);
  const sorted = [...b.hand].sort((x, y) => val(x) - val(y));
  if (b.pending!.kind === 'discard') return sorted[0].uid;
  // 복사: 쓸 수 있는 가장 좋은 공격·방어 카드 (내림카드·분신술 제외)
  const good = sorted.filter((c) => cardDef(c.id).kind !== 'curse' && c.id !== 'cloneArt');
  return (good[good.length - 1] ?? sorted[sorted.length - 1]).uid;
}

function doAct(sim: RunState, a: Act): boolean {
  noEv.length = 0;
  const ok = a.k === 'play' ? playCard(sim, a.uid, a.target, noEv) : usePotion(sim, a.slot, a.target, noEv);
  if (!ok) return false;
  let guard = 0;
  while (sim.battle!.pending && !sim.battle!.over && guard++ < 10) pickHand(sim, pickFor(sim), noEv);
  noEv.length = 0;
  return true;
}

function candidates(run: RunState): Act[] {
  const b = run.battle!;
  const out: Act[] = [];
  const foes = aliveFoes(b);
  const seenFoe = new Set<string>();
  const tgts = foes.filter((f) => {
    const k = `${f.id}|${f.hp}|${f.block}|${JSON.stringify(f.st)}|${f.intent}|${f.dodge}|${f.str}`;
    if (seenFoe.has(k)) return false;
    seenFoe.add(k);
    return true;
  });
  const seen = new Set<string>();
  for (const c of b.hand) {
    const cost = playCost(run, b, c);
    if (cost > b.energy) continue;
    const key = `${c.id}${c.up ? '+' : ''}/${cost}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cardDef(c.id).target === 'enemy') for (const f of tgts) out.push({ k: 'play', uid: c.uid, target: f.uid });
    else out.push({ k: 'play', uid: c.uid });
  }
  const seenP = new Set<string>();
  run.potions.forEach((id, slot) => {
    if (seenP.has(id)) return;
    seenP.add(id);
    if (potionDef(id).target === 'enemy') for (const f of tgts) out.push({ k: 'potion', slot, target: f.uid });
    else out.push({ k: 'potion', slot });
  });
  return out;
}

const tri = (n: number) => (n * (n + 1)) / 2;

/** 이 요괴 차례에 들어올 피해 합 (지금 의도 기준) */
function incoming(run: RunState, b: Battle): number {
  let n = 0;
  for (const f of aliveFoes(b)) for (const h of foeHits(run, b, f)) n += h.n * h.times;
  return n;
}

/** 상태 점수 (sim = 턴을 끝내고 요괴 차례가 지난 뒤, 또는 전투가 끝난 상태) */
function value(sim: RunState, base: RunState, o: BotOpts): number {
  const b = sim.battle!;
  let v = 0;
  // 한 번 쓰는 부활은 아깝다
  if (sim.flags.catUsed && !base.flags.catUsed) v -= 80;
  if (sim.flags.ironUsed && !base.flags.ironUsed) v -= 80;
  if (b.b.phoenix && !base.battle!.b.phoenix) v -= 40;
  if (b.over === 'lose') return -1e7 + v;
  const keep = b.kind === 'battle' ? o.potionKeep : o.potionKeepBig;
  v += sim.potions.length * keep;
  // 체력: 낮을수록 1의 값이 크다
  const low = sim.maxHp * 0.35;
  v += o.wHp * sim.hp + o.wHp * 0.6 * Math.min(sim.hp, low) + (sim.maxHp - base.maxHp) * 0.5;
  v += (b.b.gold ?? 0) * 0.3;
  if (b.over === 'win') return 1e6 + v;
  const foes = aliveFoes(b);
  const bossHp = foes.filter((f) => !f.minion).reduce((s, f) => s + f.hp, 0);
  const T = Math.max(1, Math.min(10, bossHp / 18));
  for (const f of b.foes) {
    if (f.dead) {
      v += f.minion ? 3 : 10;
      continue;
    }
    const k = f.minion ? 0.6 : 1;
    v -= f.hp * k;
    const p = f.st.poison ?? 0;
    const fi = f.st.fire ?? 0;
    v += Math.min(f.hp, tri(p)) * 0.75 + Math.min(f.hp, tri(fi)) * 0.7;
    v += Math.min(3, f.st.weak ?? 0) * 2.5 + Math.min(3, f.st.wet ?? 0) * 2.5;
    v -= f.str * 1.0 * T;
    v -= f.dodge * 4;
    // 불가살: 아직 부활하지 않았으면 쓰러뜨려도 30% 로 일어난다 — 그만큼을 남은 체력으로 본다(그래야 마무리를 망설이지 않는다)
    const ed = enemyDef(f.id);
    if (!f.revived && (ed.phase2?.passive === 'revive' || ed.phase1.passive === 'revive') && !((f.st.fire ?? 0) > 0)) v -= Math.round(f.maxHp * 0.3) + 1;
  }
  // 내 상태이상
  const st = b.st;
  v -= o.wHp * (tri(st.poison ?? 0) + tri(st.fire ?? 0) * 1.2);
  v -= (st.wet ?? 0) * 3 + (st.weak ?? 0) * 2.5 + (st.mud ?? 0) * 3;
  // 다음 내 턴: 남은 방어(들어올 피해까지) · 기력 · 손패
  const inc = incoming(sim, b);
  v += Math.min(b.block, inc) * o.wHp * 0.9;
  v += (b.energy - BASE_ENERGY) * 5 + (b.hand.length - 5) * 2.5;
  // 부적술 (남은 턴 수만큼)
  const pw = b.powers;
  v += T * ((pw.atkUp ?? 0) * 3 + (pw.regen ?? 0) * o.wHp + (pw.guard ?? 0) * 0.8 * o.wHp + (pw.energyUp ?? 0) * 8 + (pw.drawUp ?? 0) * 4);
  v += T * ((pw.blockUp ?? 0) * 1.5 + (pw.echoAtk ?? 0) * 7 + (pw.firstDraw ?? 0) * 3 + (pw.poisonUp ?? 0) * 2 + (pw.drawBlock ?? 0) * 3 + (pw.weakBonus ?? 0) * 0.06);
  if (pw.phoenix && !b.b.phoenix) v += 25;
  v += (b.aim ?? 0) * 5 + (b.nextFreeAtk || b.freeAtk ? 3 : 0);
  // 내림카드
  for (const pile of [b.hand, b.draw, b.discard]) for (const c of pile) if (cardDef(c.id).kind === 'curse') v -= cardDef(c.id).endTurnHurt ? 5 : 3;
  return v;
}

/** 지금 턴을 끝냈을 때의 점수 */
function endValue(sim: RunState, base: RunState, o: BotOpts): number {
  const s = cloneRun(sim);
  noEv.length = 0;
  endTurn(s, undefined, noEv);
  noEv.length = 0;
  return value(s, base, o);
}

function actValue(sim: RunState, base: RunState, o: BotOpts): number {
  return sim.battle!.over ? value(sim, base, o) : endValue(sim, base, o);
}

/** 전투 한 걸음 */
export function smartBattleInput(run: RunState, o: BotOpts = DEFAULT_OPTS): Input {
  const b = run.battle!;
  if (b.pending) return { t: 'pick', uid: pickFor(run) };
  // 기력 없이 도는 카드(0기력 뽑기 등)로 한 턴이 끝없이 이어지지 않게 · 너무 긴 전투는 턴만 넘긴다
  if (b.t.played >= 25 || b.turn > 80) return { t: 'end' };
  const endV = endValue(run, run, o);
  const first: { a: Act; v: number; s: RunState }[] = [];
  for (const a of candidates(run)) {
    const s = cloneRun(run);
    if (!doAct(s, a)) continue;
    first.push({ a, v: actValue(s, run, o), s });
  }
  if (!first.length) return { t: 'end' };
  first.sort((x, y) => y.v - x.v);
  for (const f of first.slice(0, o.deep)) {
    if (f.s.battle!.over) continue;
    for (const a2 of candidates(f.s)) {
      const s2 = cloneRun(f.s);
      if (!doAct(s2, a2)) continue;
      const v2 = actValue(s2, run, o);
      if (v2 > f.v) f.v = v2;
    }
  }
  first.sort((x, y) => y.v - x.v);
  const best = first[0];
  if (best.v <= endV + 0.01) return { t: 'end' };
  return best.a.k === 'play' ? { t: 'play', uid: best.a.uid, target: best.a.target } : { t: 'potion', slot: best.a.slot, target: best.a.target };
}

// ---------------- 지도 ----------------

function nodeScore(t: string, st: { hp: number; max: number; gold: number; act: number }, rowsLeft: number): { v: number; hp: number; gold: number } {
  const r = st.hp / st.max;
  switch (t) {
    case 'battle':
      return { v: r < 0.35 ? -2 : 3, hp: -0.08 - 0.02 * st.act, gold: 15 };
    case 'elite':
      return { v: r > 0.75 ? OPT.eliteV : r > 0.6 ? 2 : -10, hp: -0.22 - 0.03 * st.act, gold: 30 };
    case 'rest':
      return { v: r < 0.5 ? 9 : r < 0.7 ? 6 : 3 + (rowsLeft <= 2 ? 2 : 0), hp: r < 0.7 ? 0.3 : 0, gold: 0 };
    case 'shop':
      return { v: st.gold >= 150 ? 7 : st.gold >= 90 ? 4 : 0.5, hp: 0, gold: -st.gold * 0.8 };
    case 'treasure':
      return { v: 7, hp: 0, gold: 0 };
    case 'event':
      return { v: 3.5, hp: -0.02, gold: 0 };
    default:
      return { v: 0, hp: 0, gold: 0 };
  }
}

function pickPath(run: RunState): number {
  const cols = choices(run);
  if (cols.length === 1) return cols[0];
  const map = run.map;
  const last = map.rows.length - 1;
  let best = -Infinity;
  let bestCol = cols[0];
  const walk = (row: number, col: number, st: { hp: number; max: number; gold: number; act: number }, acc: number): number => {
    const n = map.rows[row][col];
    if (n.type === 'boss') return acc + (st.hp / st.max) * 30;
    const s = nodeScore(n.type, st, last - row);
    const ns = { ...st, hp: Math.max(1, Math.min(st.max, st.hp + s.hp * st.max)), gold: Math.max(0, st.gold + s.gold) };
    let m = -Infinity;
    for (const c of reachable(map, row, col)) m = Math.max(m, walk(row + 1, c, ns, acc + s.v));
    return m === -Infinity ? acc + s.v : m;
  };
  for (const c of cols) {
    const v = walk(run.row + 1, c, { hp: run.hp, max: run.maxHp, gold: run.gold, act: run.act }, 0);
    if (v > best) {
      best = v;
      bestCol = c;
    }
  }
  return bestCol;
}

// ---------------- 이야기 ----------------

function eventChoice(run: RunState): number {
  const e = run.event!;
  const def = eventDef(e.id);
  const r = run.hp / run.maxHp;
  const ok = (i: number) => !!def.choices[i] && canChoose(run, def.choices[i].ops, def.choices[i].needGold);
  const pick = (...list: number[]) => list.find((i) => ok(i)) ?? def.choices.findIndex((c) => canChoose(run, c.ops, c.needGold));
  switch (e.id) {
    case 'jangseung':
      return pick(r > 0.5 && upgradable(run).length ? 0 : 1, 1);
    case 'ssireum':
      return pick(r > 0.55 ? 0 : 1);
    case 'jumak':
      return pick(run.hp < run.maxHp - 12 ? 0 : -1, run.hp < run.maxHp * 0.45 ? 1 : 0, 0, 1);
    case 'well':
      return pick(r < 0.45 ? 1 : 0, 1);
    case 'painter':
      return pick(cv([...run.deck].sort((a, b) => cv(b.id) - cv(a.id))[0].id) >= 6 ? 0 : 1, 1);
    case 'seonang':
      return pick(run.act <= 2 ? 0 : 1, 1);
    case 'ginseng':
      return pick(0);
    case 'gut':
      return pick(1, r > 0.6 ? 0 : 2, 2);
    case 'foxFork':
      return pick(r > 0.72 ? 0 : 1, 1);
    case 'smith':
      return pick(upgradable(run).length >= 2 ? 0 : 1, 1);
    case 'monk':
      return pick(0, 1);
    case 'gatekeeper':
      return pick(r > 0.6 && run.maxHp >= 66 ? 0 : 1, 1);
    default:
      return pick(0);
  }
}

// ---------------- 판 한 걸음 ----------------

const POTION_PREF = ['fire', 'block', 'heal', 'energy', 'swift'];

export function smartRunInput(run: RunState, o: BotOpts = DEFAULT_OPTS): Input {
  OPT = o;
  switch (run.phase) {
    case 'battle':
      return smartBattleInput(run, o);
    case 'map':
      return { t: 'go', col: pickPath(run) };
    case 'reward': {
      const rw = run.reward!;
      for (let i = 0; i < rw.items.length; i++) {
        const it = rw.items[i];
        if (it.taken) continue;
        if (it.k === 'potion') {
          if (run.potions.length >= 3) continue;
          return { t: 'take', i };
        }
        if (it.k === 'card') {
          let best = -1;
          let bv = -Infinity;
          it.options.forEach((c, k) => {
            const v = cardWorth(run, c.id, c.up);
            if (v > bv) {
              bv = v;
              best = k;
            }
          });
          // 넘어가면 무작위 1장을 받게 되어(11-26) 건너뛰기가 없다 → 늘 가장 좋은 카드
          if (best < 0) continue;
          return { t: 'take', i, pick: best };
        }
        if (it.k === 'bossRelic') {
          let best = 0;
          it.options.forEach((id, k) => {
            if ((RELIC_VALUE[id] ?? 4) > (RELIC_VALUE[it.options[best]] ?? 4)) best = k;
          });
          return { t: 'take', i, pick: best };
        }
        return { t: 'take', i };
      }
      return { t: 'leave' };
    }
    case 'shop': {
      const s = run.shop!;
      if (!s.removed && run.gold >= removePrice(run) && run.deck.length > 5) {
        const bad = worstCard(run);
        if (cv(bad.id) <= 1.5) return { t: 'remove', uid: bad.uid };
      }
      // 부적 → 카드 → 물약 (값 대비)
      const relic = s.relics
        .map((x, i) => ({ i, v: RELIC_VALUE[x.id] ?? 4, x }))
        .filter((r) => !r.x.sold && r.x.price <= run.gold && r.v >= 4.5 && !(r.x.id === 'wildGinseng' && has(run, 'dragonPearl')))
        .sort((a, b) => b.v - a.v)[0];
      if (relic) return { t: 'buy', kind: 'relic', i: relic.i };
      const bar = takeBar(run) + 0.3;
      const card = s.cards
        .map((x, i) => ({ i, v: cardWorth(run, x.id, x.up), x }))
        .filter((c) => !c.x.sold && c.x.price <= run.gold && c.v >= bar)
        .sort((a, b) => b.v - a.v)[0];
      if (card) return { t: 'buy', kind: 'card', i: card.i };
      const pot = s.potions
        .map((x, i) => ({ i, x }))
        .filter((p) => !p.x.sold && p.x.price <= run.gold)
        .sort((a, b) => POTION_PREF.indexOf(a.x.id) - POTION_PREF.indexOf(b.x.id))[0];
      if (pot && run.potions.length < 3) return { t: 'buy', kind: 'potion', i: pot.i };
      return { t: 'leave' };
    }
    case 'rest': {
      if (run.rest!.done) return { t: 'leave' };
      const r = run.hp / run.maxHp;
      const bossNext = run.row >= run.map.rows.length - 3;
      const heal = restHeal(run);
      if (heal > 0 && (r < 0.5 || (bossNext && r < 0.8) || (r < 0.65 && heal >= run.maxHp - run.hp))) return { t: 'heal' };
      const ups = bestUpgrades(run, restUpgrades(run));
      if (ups.length) return { t: 'upgrade', uids: ups.map((c) => c.uid) };
      return heal > 0 ? { t: 'heal' } : { t: 'leave' };
    }
    case 'treasure':
      return run.treasure!.opened ? { t: 'leave' } : { t: 'open' };
    case 'event': {
      const e = run.event!;
      if (e.chosen < 0) return { t: 'choose', i: eventChoice(run) };
      if (e.need) {
        const k = e.need.kind;
        const c =
          k === 'upgrade'
            ? (bestUpgrades(run, 1)[0] ?? run.deck.find((x) => canUpgrade(x.id, x.up))!)
            : k === 'remove'
              ? worstCard(run)
              : [...run.deck].sort((a, b) => cv(b.id) - cv(a.id))[0];
        return { t: 'pickCard', uid: c.uid };
      }
      return { t: 'leave' };
    }
    default:
      throw new Error(`no input for phase ${run.phase}`);
  }
}

/** 한 판의 기록 (밸런스 출력용) */
export interface RunTrace {
  battles: number;
  turns: number;
  plays: number;
  inputs: number;
  nodes: number;
  /** 전투마다 [막, 지역, 종류, 잃은 체력(쓰러지면 -1)] */
  fights: [number, string, string, number][];
}

/** 판이 끝날 때까지 (죽음·클리어) */
export function smartPlayRun(run: RunState, o: BotOpts = DEFAULT_OPTS, limit = 60000): RunTrace {
  const tr: RunTrace = { battles: 0, turns: 0, plays: 0, inputs: 0, nodes: 0, fights: [] };
  let hp0 = run.hp;
  let n = 0;
  while (run.phase !== 'dead' && run.phase !== 'won' && n < limit) {
    const i = smartRunInput(run, o);
    const b = run.battle;
    if (i.t === 'go' || i.t === 'choose') hp0 = run.hp;
    const r = apply(run, i);
    if (!r.ok) throw new Error(`smart bot input refused in ${run.phase}: ${JSON.stringify(i)}`);
    n++;
    if (i.t === 'go') tr.nodes++;
    if (i.t === 'play' || i.t === 'potion') tr.plays++;
    if (b && (i.t === 'play' || i.t === 'potion' || i.t === 'end' || i.t === 'pick') && b.over) {
      tr.battles++;
      tr.turns += b.turn;
      tr.fights.push([run.act, run.map.region, b.kind === 'battle' ? 'battle' : `${b.kind}:${(b.foes.find((f) => !f.minion) ?? b.foes[0]).id}`, b.over === 'lose' ? -1 : Math.max(0, hp0 - run.hp)]);
    }
  }
  tr.inputs = n;
  return tr;
}

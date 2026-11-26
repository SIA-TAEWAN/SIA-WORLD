/**
 * 한 판(run) 진행. apply(run, input) 하나로 모든 입력을 받는다 — 받아들인 입력만 run.log 에 쌓이고,
 * replay(seed, hero, log) 로 처음부터 다시 돌리면 같은 상태가 된다 (서버 검증 = 이것).
 *
 * 칸마다 쓰는 난수는 hashSeed(판 씨앗, 종류, 막, 줄, 칸) 로 따로 만든다 — 그래서 한 칸에서 무엇을 골랐는지가
 * 다른 칸의 지도·보상·상점 내용을 바꾸지 않는다 (오늘의 도전: 모두 같은 지도·보상).
 */
import { MAX_POTIONS, endTurn, heal, playCard, startBattle, usePotion } from './battle.ts';
import { CARD_ODDS, CARD_ODDS_MAGPIE, GOLD, PRICES } from './data/acts.ts';
import { ACTS, CARDS, EVENTS, POTIONS, RELICS, RELIC_READY, canUpgrade, cardDef, eventDef, heroDef, regionDef } from './data.ts';
import { genMap, reachable } from './map.ts';
import { Rng, hashSeed } from './rng.ts';
import type { DeckCard, Input, RewardItem, RunState, Shop, SimEvent } from './state.ts';
import type { EvOp, NodeType } from './types.ts';

export const RULES_VERSION = 1;
/** 덱 최소 장수 (그 아래로 없애기 불가) */
export const MIN_DECK = 5;
/** 일반 전투 중 앞쪽 몇 번은 쉬운 조합 */
export const EASY_BATTLES = 3;
/** 전투 보상에 물약이 나올 확률 (정한 값) */
export const POTION_DROP = 0.4;

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
  const seed = o.seed >>> 0;
  return {
    v: 1,
    seed,
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
    path: [],
    map: genMap(seed, 1),
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

/** 씨앗·영웅·입력 기록으로 처음부터 다시 돌린다. 받아들여지지 않는 입력이 있으면 그 위치를 알려 준다 */
export function replay(seed: number, hero: string, log: Input[]): { run: RunState; bad: number } {
  const run = newRun({ seed, hero });
  for (let i = 0; i < log.length; i++) {
    if (!apply(run, log[i]).ok) return { run, bad: i };
  }
  return { run, bad: -1 };
}

/** 연습·개발용: 지금 판에서 바로 전투 하나 (끝나면 판도 끝) */
export function enterTestBattle(run: RunState, foes: string[], kind: 'battle' | 'elite' | 'boss' = 'battle'): SimEvent[] {
  const ev: SimEvent[] = [];
  run.phase = 'battle';
  run.practice = true;
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
  // 물약 버리기는 언제든 (판이 끝나지 않았으면)
  if (i.t === 'dropPotion') {
    if (run.phase === 'dead' || run.phase === 'won' || i.slot < 0 || i.slot >= run.potions.length) return false;
    run.potions.splice(i.slot, 1);
    return true;
  }
  switch (run.phase) {
    case 'map':
      return i.t === 'go' && go(run, i.col, ev);
    case 'battle':
      return battleStep(run, i, ev);
    case 'reward':
      return rewardStep(run, i);
    case 'shop':
      return shopStep(run, i);
    case 'rest':
      return restStep(run, i);
    case 'treasure':
      return treasureStep(run, i);
    case 'event':
      return eventStep(run, i, ev);
    default:
      return false;
  }
}

const has = (run: RunState, relic: string) => run.relics.includes(relic);
const nodeRng = (run: RunState, tag: string) => new Rng({ s: hashSeed(run.seed, tag, run.act, run.row, run.col) }, 's');

// ---------- 지도 ----------

export function nodeAt(run: RunState) {
  return run.row >= 0 ? run.map.rows[run.row][run.col] : null;
}

/** 지금 고를 수 있는 다음 칸 */
export function choices(run: RunState): number[] {
  if (run.phase !== 'map') return [];
  return reachable(run.map, run.row, run.col);
}

function go(run: RunState, col: number, ev: SimEvent[]): boolean {
  if (!choices(run).includes(col)) return false;
  run.row++;
  run.col = col;
  run.path.push(col);
  run.stats.floors++;
  enterNode(run, run.map.rows[run.row][col].type, ev);
  return true;
}

function enterNode(run: RunState, type: NodeType, ev: SimEvent[]) {
  run.reward = run.shop = run.event = run.treasure = run.rest = null;
  run.battle = null;
  const r = nodeRng(run, 'node');
  switch (type) {
    case 'battle': {
      const reg = regionDef(run.map.region);
      const pool = run.stats.battles < EASY_BATTLES || !reg.normal.length ? reg.easy : reg.normal;
      fight(run, 'battle', r.pick(pool), ev);
      break;
    }
    case 'elite':
      fight(run, 'elite', [r.pick(run.map.elites)], ev);
      break;
    case 'boss':
      fight(run, 'boss', [run.map.boss], ev);
      break;
    case 'shop':
      run.phase = 'shop';
      run.shop = makeShop(run);
      break;
    case 'rest':
      run.phase = 'rest';
      run.rest = { done: false };
      break;
    case 'treasure':
      run.phase = 'treasure';
      run.treasure = { relic: randomRelic(run, nodeRng(run, 'treasure')), opened: false };
      break;
    case 'event': {
      run.phase = 'event';
      const id = pickEvent(run, nodeRng(run, 'event'));
      run.seenEvents.push(id);
      run.event = { id, chosen: -1 };
      break;
    }
  }
}

function fight(run: RunState, kind: 'battle' | 'elite' | 'boss', foes: string[], ev: SimEvent[], double = false) {
  run.phase = 'battle';
  startBattle(run, { kind, foes, seed: hashSeed(run.seed, 'battle', run.act, run.row, run.col), double }, ev);
}

// ---------- 전투 ----------

function battleStep(run: RunState, i: Input, ev: SimEvent[]): boolean {
  const b = run.battle;
  if (!b) return false;
  let ok = false;
  if (i.t === 'play') ok = playCard(run, i.uid, i.target, ev);
  else if (i.t === 'potion') ok = usePotion(run, i.slot, i.target, ev);
  else if (i.t === 'end') ok = endTurn(run, i.keep, ev);
  if (ok && b.over) afterBattle(run, ev);
  return ok;
}

function afterBattle(run: RunState, ev: SimEvent[]) {
  const b = run.battle!;
  if (b.over === 'lose') {
    run.phase = 'dead';
    return;
  }
  if (run.practice) {
    run.phase = 'won';
    return;
  }
  if (has(run, 'gourd')) heal(run, 6, ev);
  const r = nodeRng(run, 'reward');
  const items: RewardItem[] = [];
  const goldOf = (range: readonly number[]) => Math.floor(r.int(range[0], range[1]) * (has(run, 'luckyPouch') ? 1.3 : 1));
  const mult = b.double ? 2 : 1;
  if (b.kind === 'boss') {
    run.stats.bosses++;
    heal(run, Math.floor(run.maxHp / 2), ev);
    items.push({ k: 'gold', n: goldOf(GOLD.boss) });
    items.push({ k: 'card', options: rewardCards(run, r, true) });
    const boss = bossRelics(run, r);
    if (boss.length) items.push({ k: 'bossRelic', options: boss });
    run.reward = { items, boss: true };
  } else {
    run.stats.battles++;
    if (b.kind === 'elite') run.stats.elites++;
    items.push({ k: 'gold', n: goldOf(b.kind === 'elite' ? GOLD.elite : GOLD.battle) * mult });
    for (let k = 0; k < mult; k++) items.push({ k: 'card', options: rewardCards(run, r, false) });
    if (b.kind === 'elite') {
      for (let k = 0; k < mult; k++) {
        const id = randomRelic(run, r, items);
        if (id) items.push({ k: 'relic', id });
      }
    }
    if (r.chance(POTION_DROP)) items.push({ k: 'potion', id: r.pick(POTIONS).id });
    run.reward = { items };
  }
  run.phase = 'reward';
}

// ---------- 보상 ----------

function rarityOf(run: RunState, r: Rng): string {
  return r.weighted(has(run, 'magpieFeather') ? CARD_ODDS_MAGPIE : CARD_ODDS);
}

/** 이 영웅이 보상·상점에서 볼 수 있는 카드 (그 등급) */
export function cardPool(run: RunState, rarity: string, reward = true): string[] {
  const hero = heroDef(run.hero);
  return CARDS.filter((c) => {
    if (c.rarity === rarity) return !c.hero || c.hero === run.hero;
    // 2번째 전용카드(고급)는 그 영웅 보상에서만 (상점에는 없음)
    return reward && rarity === 'uncommon' && c.rarity === 'hero2' && c.id === hero.cards[1];
  }).map((c) => c.id);
}

function rewardCards(run: RunState, r: Rng, boss: boolean): DeckCard[] {
  const n = run.hero === 'monkey' ? 4 : 3;
  const out: DeckCard[] = [];
  for (let k = 0; k < n * 4 && out.length < n; k++) {
    const rar = boss ? 'legend' : rarityOf(run, r);
    const pool = cardPool(run, rar).filter((id) => !out.some((c) => c.id === id));
    if (!pool.length) continue;
    out.push({ uid: 0, id: r.pick(pool) });
  }
  return out;
}

function relicPool(run: RunState, rarity: string, also: string[] = []) {
  return RELICS.filter((x) => x.rarity === rarity && RELIC_READY.has(x.id) && !run.relics.includes(x.id) && !also.includes(x.id)).map((x) => x.id);
}

function randomRelic(run: RunState, r: Rng, pending: RewardItem[] = []): string | null {
  const also = pending.flatMap((it) => (it.k === 'relic' ? [it.id] : []));
  const first = r.weighted([
    ['common', 65],
    ['uncommon', 35],
  ] as const);
  const pool = relicPool(run, first, also);
  const alt = relicPool(run, first === 'common' ? 'uncommon' : 'common', also);
  const list = pool.length ? pool : alt;
  return list.length ? r.pick(list) : null;
}

function bossRelics(run: RunState, r: Rng): string[] {
  const pool = relicPool(run, 'boss');
  r.shuffle(pool);
  return pool.slice(0, 3);
}

export function gainRelic(run: RunState, id: string) {
  if (run.relics.includes(id)) return;
  run.relics.push(id);
  if (id === 'cairnStone') {
    run.maxHp += 8;
    run.hp += 8;
  }
  if (id === 'coinPurse') run.gold += 100;
}

function addCard(run: RunState, id: string, up?: boolean): DeckCard {
  const c: DeckCard = { uid: run.nextUid++, id };
  if (up) c.up = true;
  run.deck.push(c);
  return c;
}

function rewardStep(run: RunState, i: Input): boolean {
  const rw = run.reward;
  if (!rw) return false;
  if (i.t === 'leave') {
    run.reward = null;
    run.battle = null;
    if (rw.boss) nextAct(run);
    else run.phase = 'map';
    return true;
  }
  if (i.t !== 'take') return false;
  const it = rw.items[i.i];
  if (!it || it.taken) return false;
  switch (it.k) {
    case 'gold':
      run.gold += it.n;
      break;
    case 'card': {
      const c = it.options[i.pick ?? -1];
      if (!c) return false;
      addCard(run, c.id, c.up);
      break;
    }
    case 'relic':
      gainRelic(run, it.id);
      break;
    case 'potion':
      if (run.potions.length >= MAX_POTIONS) return false;
      run.potions.push(it.id);
      break;
    case 'bossRelic': {
      const id = it.options[i.pick ?? -1];
      if (!id) return false;
      gainRelic(run, id);
      break;
    }
  }
  it.taken = true;
  return true;
}

function nextAct(run: RunState) {
  const next = run.act + 1;
  const def = ACTS[next - 1];
  if (!def || !def.regions.some((id) => regionDef(id).ready)) {
    run.phase = 'won';
    return;
  }
  run.act = next;
  run.row = -1;
  run.col = 0;
  run.path = [];
  run.map = genMap(run.seed, next, has(run, 'treasureMap') ? 2 : 0);
  run.actStart.push(run.log.length + 1);
  run.phase = 'map';
}

// ---------- 상점 ----------

function makeShop(run: RunState): Shop {
  const r = nodeRng(run, 'shop');
  const price = (range: readonly number[]) => r.int(range[0], range[1]);
  const cards: Shop['cards'] = [];
  for (let k = 0; k < 20 && cards.length < 5; k++) {
    const rar = rarityOf(run, r);
    const pool = cardPool(run, rar, false).filter((id) => !cards.some((c) => c.id === id));
    if (!pool.length) continue;
    const id = r.pick(pool);
    const pr = PRICES.card[cardDef(id).rarity as keyof typeof PRICES.card] ?? PRICES.card.common;
    cards.push({ id, price: price(pr) });
  }
  const relics: Shop['relics'] = [];
  for (let k = 0; k < 2; k++) {
    const id = randomRelic(run, r, relics.map((x) => ({ k: 'relic' as const, id: x.id })));
    if (!id) break;
    const rar = RELICS.find((x) => x.id === id)!.rarity as 'common' | 'uncommon';
    relics.push({ id, price: price(PRICES.relic[rar]) });
  }
  const potions: Shop['potions'] = [];
  for (let k = 0; k < 2; k++) potions.push({ id: r.pick(POTIONS).id, price: price(PRICES.potion) });
  return { cards, relics, potions, removed: false };
}

export const removePrice = (run: RunState) => PRICES.remove + PRICES.removeStep * run.removes;

function spend(run: RunState, n: number): boolean {
  if (run.gold < n) return false;
  run.gold -= n;
  // 큰도깨비 방망이: 쓴 엽전의 25% 돌려받음
  if (has(run, 'dokkaebiClub')) run.gold += Math.floor(n * 0.25);
  return true;
}

export const removableCards = (run: RunState) => (run.deck.length > MIN_DECK ? run.deck : []);

function shopStep(run: RunState, i: Input): boolean {
  const s = run.shop;
  if (!s) return false;
  if (i.t === 'leave') {
    run.shop = null;
    run.phase = 'map';
    return true;
  }
  if (i.t === 'buy') {
    const list = i.kind === 'card' ? s.cards : i.kind === 'relic' ? s.relics : s.potions;
    const it = list[i.i];
    if (!it || it.sold || run.gold < it.price) return false;
    if (i.kind === 'potion' && run.potions.length >= MAX_POTIONS) return false;
    spend(run, it.price);
    it.sold = true;
    if (i.kind === 'card') addCard(run, it.id, it.up);
    else if (i.kind === 'relic') gainRelic(run, it.id);
    else run.potions.push(it.id);
    return true;
  }
  if (i.t === 'remove') {
    if (s.removed || run.deck.length <= MIN_DECK) return false;
    const idx = run.deck.findIndex((c) => c.uid === i.uid);
    const price = removePrice(run);
    if (idx < 0 || run.gold < price) return false;
    spend(run, price);
    run.deck.splice(idx, 1);
    run.removes++;
    s.removed = true;
    return true;
  }
  return false;
}

// ---------- 쉼터 ----------

export function restHeal(run: RunState): number {
  if (has(run, 'dragonPearl')) return 0;
  return Math.floor(run.maxHp * 0.3) + (run.hero === 'rabbit' ? 10 : 0) + (has(run, 'wildGinseng') ? 15 : 0);
}
export const restUpgrades = (run: RunState) => (has(run, 'smithHammer') ? 2 : 1);
export const upgradable = (run: RunState) => run.deck.filter((c) => canUpgrade(c.id, c.up));

function restStep(run: RunState, i: Input): boolean {
  const rs = run.rest;
  if (!rs) return false;
  if (i.t === 'leave') {
    run.rest = null;
    run.phase = 'map';
    return true;
  }
  if (rs.done) return false;
  if (i.t === 'heal') {
    if (has(run, 'dragonPearl')) return false;
    run.hp = Math.min(run.maxHp, run.hp + restHeal(run));
    rs.done = true;
    return true;
  }
  if (i.t === 'upgrade') {
    const can = upgradable(run);
    const need = Math.min(restUpgrades(run), can.length);
    if (need === 0 || i.uids.length !== need || new Set(i.uids).size !== need) return false;
    if (!i.uids.every((u) => can.some((c) => c.uid === u))) return false;
    for (const u of i.uids) run.deck.find((c) => c.uid === u)!.up = true;
    rs.done = true;
    return true;
  }
  return false;
}

// ---------- 보물 ----------

function treasureStep(run: RunState, i: Input): boolean {
  const t = run.treasure;
  if (!t) return false;
  if (i.t === 'open' && !t.opened) {
    t.opened = true;
    if (t.relic) gainRelic(run, t.relic);
    else run.gold += 50;
    return true;
  }
  if (i.t === 'leave') {
    run.treasure = null;
    run.phase = 'map';
    return true;
  }
  return false;
}

// ---------- 이야기 ----------

function pickEvent(run: RunState, r: Rng): string {
  const ok = EVENTS.filter((e) => !e.acts.length || e.acts.includes(run.act));
  const fresh = ok.filter((e) => !run.seenEvents.includes(e.id));
  return r.pick(fresh.length ? fresh : ok).id;
}

/** 이 선택지를 지금 고를 수 있나 */
export function canChoose(run: RunState, ops: EvOp[], needGold?: number): boolean {
  if (needGold && run.gold < needGold) return false;
  for (const o of ops) {
    if (o.t === 'remove' && run.deck.length - o.n < MIN_DECK) return false;
  }
  return true;
}

function eventStep(run: RunState, i: Input, ev: SimEvent[]): boolean {
  const e = run.event;
  if (!e) return false;
  const def = eventDef(e.id);
  if (i.t === 'choose') {
    if (e.chosen >= 0) return false;
    const ch = def.choices[i.i];
    if (!ch || !canChoose(run, ch.ops, ch.needGold)) return false;
    e.chosen = i.i;
    e.text = ch.after;
    runEvOps(run, ch.ops, nodeRng(run, 'eventChance'), ev);
    return true;
  }
  if (i.t === 'pickCard') {
    const need = e.need;
    if (!need) return false;
    const c = run.deck.find((x) => x.uid === i.uid);
    if (!c) return false;
    if (need.kind === 'upgrade') {
      if (!canUpgrade(c.id, c.up)) return false;
      c.up = true;
    } else if (need.kind === 'remove') {
      if (run.deck.length <= MIN_DECK) return false;
      run.deck.splice(run.deck.indexOf(c), 1);
    } else {
      addCard(run, c.id, c.up);
    }
    need.left--;
    if (need.left <= 0 || (need.kind === 'upgrade' && !upgradable(run).length) || (need.kind === 'remove' && run.deck.length <= MIN_DECK)) e.need = undefined;
    return true;
  }
  if (i.t === 'leave') {
    if (e.chosen < 0 || e.need) return false;
    run.event = null;
    run.phase = 'map';
    return true;
  }
  return false;
}

function runEvOps(run: RunState, ops: EvOp[], r: Rng, ev: SimEvent[]) {
  const e = run.event!;
  for (const o of ops) {
    switch (o.t) {
      case 'hp':
        if (o.n >= 0) run.hp = Math.min(run.maxHp, run.hp + o.n);
        else run.hp = Math.max(1, run.hp + o.n);
        break;
      case 'maxHp':
        run.maxHp += o.n;
        run.hp += o.n;
        break;
      case 'maxHpPct': {
        const cut = Math.floor((run.maxHp * o.n) / 100);
        run.maxHp -= cut;
        run.hp = Math.min(run.hp, run.maxHp);
        break;
      }
      case 'gold':
        if (o.n < 0) spend(run, -o.n);
        else run.gold += o.n;
        break;
      case 'upgrade':
        if (upgradable(run).length) e.need = { kind: 'upgrade', left: o.n };
        break;
      case 'remove':
        if (run.deck.length > MIN_DECK) e.need = { kind: 'remove', left: o.n };
        break;
      case 'copy':
        e.need = { kind: 'copy', left: o.n };
        break;
      case 'relic': {
        const id = randomRelic(run, r);
        if (id) gainRelic(run, id);
        e.text = (e.text ? e.text + ' ' : '') + (id ? `부적을 얻었다.` : '');
        e.gotRelic = id ?? undefined;
        break;
      }
      case 'curse':
        for (let k = 0; k < o.n; k++) addCard(run, o.id);
        break;
      case 'card': {
        const pool = cardPool(run, o.rarity);
        if (pool.length) {
          const c = addCard(run, r.pick(pool));
          e.gotCard = c.id;
        }
        break;
      }
      case 'elite': {
        e.fought = true;
        const id = r.pick(run.map.elites);
        run.event = null;
        fight(run, 'elite', [id], ev, o.double);
        return;
      }
      case 'chance': {
        const win = r.chance(o.p);
        e.text = win ? o.winText : o.loseText;
        runEvOps(run, win ? o.win : o.lose, r, ev);
        break;
      }
      case 'nextEnergy':
        run.flags.nextEnergy += o.n;
        break;
    }
  }
}

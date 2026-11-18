/**
 * 판 안 성장 (PRD 3장): 레벨업 카드 3장 뽑기·적용, 보물상자와 진화.
 * 규칙: 무기 최대 6개 · 패시브 최대 6개 · 각각 최대 5레벨. 진화 무기는 카드에 나오지 않는다.
 */
import { BONUS, CARD_COUNT, CHEST_COINS, LIMIT, xpNeed } from '../data/balance';
import { EVOLUTIONS } from '../data/evolutions';
import { PASSIVES, PASSIVE_INDEX } from '../data/passives';
import { WEAPONS, WEAPON_INDEX } from '../data/weapons';
import { emit, gainCoins, healPlayer, rand, recalcStats } from './core';
import { CARD, EV, type Card, type State } from './state';
import { weaponReady } from './weapons';

const MAX_CAND = WEAPONS.length + PASSIVES.length;
/** 후보 목록 (뽑을 때마다 다시 채운다) */
const candType = new Int32Array(MAX_CAND);
const candDef = new Int32Array(MAX_CAND);
const candLv = new Int32Array(MAX_CAND);
const candNew = new Uint8Array(MAX_CAND);

const hasWeapon = (s: State, def: number) => s.weapons.some((w) => w.def === def);

/** 진화해서 사라진 원래 무기인가 (다시 카드에 나오지 않게) */
function evolvedAway(s: State, def: number): boolean {
  for (const ev of EVOLUTIONS) if (WEAPON_INDEX[ev.weapon] === def && hasWeapon(s, WEAPON_INDEX[ev.result])) return true;
  return false;
}

/** 지금 고를 수 있는 것을 모은다. upgradesOnly: 이미 가진 것의 강화만 (보물상자용) */
function candidates(s: State, upgradesOnly: boolean): number {
  let n = 0;
  const add = (type: number, def: number, lv: number, isNew: boolean) => {
    candType[n] = type;
    candDef[n] = def;
    candLv[n] = lv;
    candNew[n] = isNew ? 1 : 0;
    n++;
  };
  for (const w of s.weapons) if (!WEAPONS[w.def].evolved && w.lv < LIMIT.level) add(CARD.weapon, w.def, w.lv + 1, false);
  for (const p of s.passives) if (p.lv < LIMIT.level) add(CARD.passive, p.def, p.lv + 1, false);
  if (upgradesOnly) return n;
  if (s.weapons.length < LIMIT.weapons) {
    for (let i = 0; i < WEAPONS.length; i++) {
      const def = WEAPONS[i];
      if (def.evolved || !weaponReady(def) || hasWeapon(s, i) || evolvedAway(s, i)) continue;
      add(CARD.weapon, i, 1, true);
    }
  }
  if (s.passives.length < LIMIT.passives) {
    for (let i = 0; i < PASSIVES.length; i++) if (!s.passives.some((p) => p.def === i)) add(CARD.passive, i, 1, true);
  }
  return n;
}

function setCard(c: Card, type: number, def: number, lv: number, isNew: boolean) {
  c.type = type;
  c.def = def;
  c.lv = lv;
  c.isNew = isNew;
}

/** 카드 3장을 뽑아 s.cards 에 담는다. 고를 것이 모자라면 떡·엽전 카드로 채운다 */
export function drawCards(s: State) {
  let n = candidates(s, false);
  let k = 0;
  while (k < CARD_COUNT && n > 0) {
    const i = Math.floor(rand(s) * n);
    setCard(s.cards[k++], candType[i], candDef[i], candLv[i], candNew[i] === 1);
    // 뽑은 것은 맨 뒤 것으로 덮어 다시 나오지 않게
    n--;
    candType[i] = candType[n];
    candDef[i] = candDef[n];
    candLv[i] = candLv[n];
    candNew[i] = candNew[n];
  }
  if (k < CARD_COUNT) setCard(s.cards[k++], CARD.heal, 0, 0, false);
  if (k < CARD_COUNT) setCard(s.cards[k++], CARD.coins, 0, 0, false);
  s.cardN = k;
}

export function addWeapon(s: State, def: number, lv = 1) {
  const w = s.weapons.find((x) => x.def === def);
  if (w) w.lv = Math.min(LIMIT.level, Math.max(w.lv, lv));
  else if (s.weapons.length < LIMIT.weapons) s.weapons.push({ def, lv, cd: 0.3, a: 0, view: 0 });
  else return;
  s.gotWeapon[def] = 1;
}

export function addPassive(s: State, def: number, lv = 1) {
  const p = s.passives.find((x) => x.def === def);
  if (p) p.lv = Math.min(LIMIT.level, Math.max(p.lv, lv));
  else if (s.passives.length < LIMIT.passives) s.passives.push({ def, lv });
  else return;
  s.gotPassive[def] = 1;
  recalcStats(s);
}

export function applyCard(s: State, type: number, def: number, lv: number) {
  if (type === CARD.weapon) addWeapon(s, def, lv);
  else if (type === CARD.passive) addPassive(s, def, lv);
  else if (type === CARD.heal) healPlayer(s, BONUS.heal);
  else gainCoins(s, BONUS.coins);
}

/** 경험치가 찼으면 레벨을 올리고 카드를 뽑는다 (게임이 멈춘다) */
export function checkLevelUp(s: State): boolean {
  if (s.xp < s.xpNext) return false;
  s.xp -= s.xpNext;
  s.level++;
  s.xpNext = xpNeed(s.level);
  drawCards(s);
  s.phase = 'levelup';
  emit(s, EV.levelup, s.level);
  return true;
}

/** 레벨업 화면에서 카드를 고른다 */
export function pickCard(s: State, i: number) {
  if (s.phase !== 'levelup' || i < 0 || i >= s.cardN) return;
  const c = s.cards[i];
  applyCard(s, c.type, c.def, c.lv);
  emit(s, EV.chosen, c.type, c.def);
  s.phase = 'play';
  // 한꺼번에 여러 레벨이 올랐으면 이어서 또 고른다
  checkLevelUp(s);
}

/** 진화할 수 있는 무기 칸 (없으면 -1). 조건: 무기 5레벨 + 짝 패시브 보유 */
export function evolvable(s: State): number {
  for (let slot = 0; slot < s.weapons.length; slot++) {
    const w = s.weapons[slot];
    if (w.lv < LIMIT.level) continue;
    for (const ev of EVOLUTIONS) {
      if (WEAPON_INDEX[ev.weapon] !== w.def) continue;
      const pi = PASSIVE_INDEX[ev.passive];
      if (s.passives.some((p) => p.def === pi)) return slot;
    }
  }
  return -1;
}

/** 보물상자를 연다: 진화할 수 있으면 진화, 아니면 가진 것 하나를 강화, 그것도 없으면 엽전 */
export function openChest(s: State) {
  const slot = evolvable(s);
  if (slot >= 0) {
    const w = s.weapons[slot];
    const ev = EVOLUTIONS.find((x) => WEAPON_INDEX[x.weapon] === w.def)!;
    w.def = WEAPON_INDEX[ev.result];
    w.lv = 1;
    w.cd = 0;
    w.view = 0;
    s.gotWeapon[w.def] = 1;
    emit(s, EV.evolve, w.def);
    return;
  }
  const n = candidates(s, true);
  if (n > 0) {
    const i = Math.floor(rand(s) * n);
    applyCard(s, candType[i], candDef[i], candLv[i]);
    emit(s, EV.chestGain, candType[i], candDef[i]);
    return;
  }
  gainCoins(s, CHEST_COINS);
  emit(s, EV.chestGain, CARD.coins, 0);
}

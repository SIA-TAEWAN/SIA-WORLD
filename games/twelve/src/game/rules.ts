/**
 * 쉼터 규칙 (PRD '장비' · '마을·상점·대장간'): 착용·잠금·보관함, 상점(사기·팔기·물약·가방), 대장간(강화·분해).
 * 모든 함수는 프로필을 고치고, 할 수 없으면 까닭(글자)을, 됐으면 null 을 돌려준다.
 * 테스트 모드(?local=1)는 이 규칙으로 기기에 저장하고, 서버(078_twelve.sql)는 같은 규칙의 RPC 다 — 한쪽을 바꾸면 다른 쪽도 바꾼다.
 */
import { BAG, MAX_PLUS, POTION, POTION_SIZES, bagPrice, enhanceCost, regionTier } from '../data/economy';
import { canEnhance, itemDef, itemLevel, type Item, type ItemDef } from '../data/items';
import { HARD_READY, MODES, REGIONS, REGIONS_READY } from '../data/regions';
import { addItem, bagCount, isEquipped, itemOf, regionOpen, type TwelveProfile } from './progress';

/** 상점이 파는 가장 높은 등급: 열린 지형까지 (PRD: 열린 지형까지의 등급) */
export function shopTier(p: TwelveProfile): number {
  let t = 0;
  for (const mode of MODES) {
    if (mode === 'hard' && !HARD_READY) continue;
    for (let r = 1; r <= Math.min(REGIONS, REGIONS_READY); r++) if (regionOpen(p, r, mode)) t = Math.max(t, regionTier(r, mode));
  }
  return t;
}
/** 상점에서 살 수 있는 장비인지 (일반 무기·방어구, 열린 등급까지) */
export const forSale = (p: TwelveProfile, d: ItemDef) => d.buy > 0 && d.tier <= shopTier(p);

const find = (p: TwelveProfile, id: string): { it: Item; d: ItemDef } | null => {
  const it = itemOf(p, id);
  const d = it && itemDef(it.base);
  return it && d ? { it, d } : null;
};

/** 착용 (보관함에 있는 것은 먼저 가방으로) */
export function equip(p: TwelveProfile, id: string): string | null {
  const f = find(p, id);
  if (!f) return 'no item';
  if (f.it.box) return 'bad item';
  if (p.level < itemLevel(f.d)) return 'low level';
  p.eq[f.d.slot] = id;
  return null;
}
/** 벗기 (무기는 벗을 수 없다 — 다른 무기로 바꾼다) */
export function unequip(p: TwelveProfile, slot: string): string | null {
  if (slot !== 'armor' && slot !== 'acc') return 'bad slot';
  p.eq[slot] = null;
  return null;
}
export function setLock(p: TwelveProfile, id: string, on: boolean): string | null {
  const it = itemOf(p, id);
  if (!it) return 'no item';
  it.lock = !!on;
  return null;
}
/** 보관함 → 가방 (ids 가 비었으면 들어가는 만큼 전부). 자리가 없으면 'bag full' */
export function claim(p: TwelveProfile, ids: string[] = []): string | null {
  const list = ids.length ? ids.map((id) => itemOf(p, id)) : p.items.filter((it) => it.box);
  if (list.some((it) => !it || !it.box)) return 'no item';
  let moved = 0;
  for (const it of list as Item[]) {
    if (bagCount(p) >= p.bag) break;
    it.box = false;
    moved++;
  }
  return moved || !list.length ? null : 'bag full';
}

/** 팔거나 분해할 수 있는지 */
const loose = (p: TwelveProfile, ids: string[]): string | null => {
  if (!ids.length || new Set(ids).size !== ids.length) return 'bad item';
  for (const id of ids) {
    const f = find(p, id);
    if (!f) return 'no item';
    if (isEquipped(p, id)) return 'equipped';
    if (f.it.lock) return 'locked item';
  }
  return null;
};
/** 팔기 (가방·보관함 어디에 있든) */
export function sell(p: TwelveProfile, ids: string[]): string | null {
  const why = loose(p, ids);
  if (why) return why;
  for (const id of ids) p.coins += find(p, id)!.d.sell;
  p.items = p.items.filter((it) => !ids.includes(it.id));
  return null;
}
/** 분해 → 강화석 (강화한 단계마다 +1) */
export const scrapOf = (d: ItemDef, plus: number) => d.scrap + plus;
export function scrap(p: TwelveProfile, ids: string[]): string | null {
  const why = loose(p, ids);
  if (why) return why;
  for (const id of ids) {
    const f = find(p, id)!;
    p.stones += scrapOf(f.d, f.it.plus);
  }
  p.items = p.items.filter((it) => !ids.includes(it.id));
  return null;
}
/** 강화 +1 (항상 성공) */
export function enhance(p: TwelveProfile, id: string): string | null {
  const f = find(p, id);
  if (!f) return 'no item';
  if (!canEnhance(f.d)) return 'bad item';
  if (f.it.plus >= MAX_PLUS) return 'max plus';
  const cost = enhanceCost(f.d.tier, f.it.plus + 1);
  if (p.coins < cost.coins) return 'not enough coins';
  if (p.stones < cost.stones) return 'not enough stones';
  p.coins -= cost.coins;
  p.stones -= cost.stones;
  f.it.plus++;
  return null;
}

/**
 * 사기. what = 장비 id('w-sword-1') · 물약('potion:<0 체력|1 마력>:<0 소|1 중|2 대>') · 가방 늘리기('bag'). n = 물약 수
 * 장비는 가방이 꽉 찼으면 살 수 없다 (보관함은 드랍만 받는다).
 */
export function buy(p: TwelveProfile, what: string, n = 1): string | null {
  if (!Number.isInteger(n) || n < 1 || n > POTION.max) return 'bad count';
  if (what === 'bag') {
    if (p.bag >= BAG.max) return 'max bag';
    const price = bagPrice(p.bag);
    if (p.coins < price) return 'not enough coins';
    p.coins -= price;
    p.bag += BAG.step;
    return null;
  }
  const m = /^potion:([01]):(\d)$/.exec(what);
  if (m) {
    const slot = Number(m[1]);
    const size = Number(m[2]);
    if (size >= POTION_SIZES) return 'bad item';
    if (p.potions[slot][size] + n > POTION.max) return 'max potions';
    const price = POTION.price[slot][size] * n;
    if (p.coins < price) return 'not enough coins';
    p.coins -= price;
    p.potions[slot][size] += n;
    return null;
  }
  const d = itemDef(what);
  if (!d) return 'bad item';
  if (n !== 1) return 'bad count';
  if (!forSale(p, d)) return 'not for sale';
  if (bagCount(p) >= p.bag) return 'bag full';
  if (p.coins < d.buy) return 'not enough coins';
  p.coins -= d.buy;
  addItem(p, what);
  return null;
}

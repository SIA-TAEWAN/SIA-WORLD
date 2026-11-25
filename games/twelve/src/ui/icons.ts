/**
 * 아이콘 그림 (ASSETS.md): 장비 · 물약 · 스킬의 글자 그림(이모지)을 전용 그림 public/art/ic-<이름>.png 로 바꿔 보여 준다.
 * 그림이 없거나(ART_FILES 에 없음) 짝이 없는 글자 그림은 그대로 글자로 나온다 — 자료(data)의 icon 값은 바꾸지 않는다.
 */
import { artUrl } from '../assets';
import { HEROES } from '../data/heroes';
import { ITEMS, type ItemDef } from '../data/items';
import { WEAPONS } from '../data/weapons';
import { hasArt, type OptionalArt } from '../scenes/art';

type IconName =
  | 'sword' | 'spear' | 'bow' | 'fan' | 'armor' | 'acc-mp' | 'acc-speed' | 'acc-crit' | 'acc-potion' | 'acc-coin' | 'star'
  | 'hp' | 'mp' | 'stone' | 'key' | 'coin'
  | 'sk-triple' | 'sk-dash' | 'sk-spin' | 'sk-throw' | 'sk-rain' | 'sk-fork' | 'sk-tornado' | 'sk-bolt'
  | 'roll' | `u-${string}` | `w-${string}`;

/** 글자 그림 → 아이콘 이름. 자료에 적힌 글자를 그대로 읽어 짝을 짓는다 (글자를 바꿔도 따라간다) */
const BY_EMOJI = new Map<string, IconName>();
for (const k of ['sword', 'spear', 'bow', 'fan'] as const) BY_EMOJI.set(WEAPONS[k].icon, k);
const SKILLS: [keyof typeof WEAPONS, IconName, IconName][] = [['sword', 'sk-triple', 'sk-dash'], ['spear', 'sk-spin', 'sk-throw'], ['bow', 'sk-rain', 'sk-fork'], ['fan', 'sk-tornado', 'sk-bolt']];
for (const [k, a, b] of SKILLS) {
  BY_EMOJI.set(WEAPONS[k].skills[0].icon, a);
  BY_EMOJI.set(WEAPONS[k].skills[1].icon, b);
}
for (const d of ITEMS) {
  if (d.slot === 'armor') BY_EMOJI.set(d.icon, 'armor');
  else if (d.slot === 'acc') BY_EMOJI.set(d.icon, d.id.startsWith('s-') ? 'star' : (`acc-${d.stat!}` as IconName));
}

// 고유 스킬: 대원마다 하나 (글자 그림은 동물 얼굴)
for (const h of HEROES) BY_EMOJI.set(h.unique.icon, `u-${h.id}`);

const img = (name: IconName, fallback: string) => {
  const art: OptionalArt = `ic-${name}`;
  return hasArt(art) ? `<img class="ic-img" src="${artUrl(art)}" alt="${fallback}" draggable="false" />` : fallback;
};

/** 자료의 글자 그림(장비 · 무기 · 무기 스킬)을 아이콘 그림으로 */
export const icon = (emoji: string) => {
  const name = BY_EMOJI.get(emoji);
  return name ? img(name, emoji) : emoji;
};

/** 장비 아이콘: 무기는 등급마다 다른 그림(ic-w-<종류>-<등급>), 없으면 종류 그림 → 글자 그림 */
export const itemIcon = (d: ItemDef) => {
  if (d.slot === 'weapon' && d.kind && hasArt(`ic-w-${d.kind}-${d.tier}`)) return img(`w-${d.kind}-${d.tier}`, d.icon);
  return icon(d.icon);
};

/** 화면 곳곳의 공용 아이콘: 엽전 · 강화석 · 열쇠 · 체력 물약 · 마력 물약 · 구르기 */
export const IC = {
  coin: img('coin', '🪙'),
  stone: img('stone', '💎'),
  key: img('key', '🗝️'),
  hp: img('hp', '❤️'),
  mp: img('mp', '💧'),
  roll: img('roll', '🌀'),
} as const;

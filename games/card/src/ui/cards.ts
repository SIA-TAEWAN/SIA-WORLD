/** HTML 카드·부적·물약 모양 (보상·상점·덱 보기). 색은 shared/theme.js 값 (전투 캔버스의 카드와 같은 색) */
import { KIND_NAME, RARITY_NAME, cardCost, cardDef, cardName, cardText, potionDef, relicDef } from '../game/rules';
import { COLOR, css } from '../theme';

const KIND_CSS: Record<string, string> = {
  atk: css(COLOR.cardRed),
  def: css(COLOR.teamA),
  skill: css(COLOR.win),
  power: css(COLOR.accent),
  curse: css(COLOR.draw),
};
const RING_CSS: Record<string, string> = {
  basic: css(COLOR.lineSoft),
  common: css(COLOR.white),
  uncommon: css(COLOR.teamA),
  legend: css(COLOR.primary),
  hero: css(COLOR.pink),
  hero2: css(COLOR.pink),
  curse: css(COLOR.draw),
};
const KIND_GLYPH: Record<string, string> = { atk: '⚔️', def: '🛡️', skill: '✨', power: '☀️', curse: '💀' };

export function cardHtml(id: string, up?: boolean, extra = ''): string {
  const d = cardDef(id);
  const cost = cardCost(id, up);
  const costCls = up && cost < d.cost ? ' down' : '';
  return `<div class="gcard${up ? ' up' : ''}" style="--kind:${KIND_CSS[d.kind]};--ring:${RING_CSS[d.rarity]}" ${extra}>
    <span class="gc-cost${costCls}">${cost}</span>
    <span class="gc-name">${cardName(id, up)}</span>
    <span class="gc-art">${KIND_GLYPH[d.kind]}</span>
    <span class="gc-kind">${KIND_NAME[d.kind]} · ${RARITY_NAME[d.rarity]}</span>
    <span class="gc-text">${cardText(id, up)}</span>
  </div>`;
}

export function relicHtml(id: string, extra = ''): string {
  const r = relicDef(id);
  const tag = r.rarity === 'boss' ? '<em class="tag">보스</em>' : r.rarity === 'uncommon' ? '<em class="tag blue">고급</em>' : '';
  return `<div class="item" ${extra}><span class="relic-dot">${r.name.slice(0, 1)}</span><span class="item-main"><b>${r.name} ${tag}</b><small>${r.text}</small></span></div>`;
}

export function potionHtml(id: string, extra = ''): string {
  const p = potionDef(id);
  return `<div class="item" ${extra}><span class="potion-dot">🧪</span><span class="item-main"><b>${p.name}</b><small>${p.text}</small></span></div>`;
}

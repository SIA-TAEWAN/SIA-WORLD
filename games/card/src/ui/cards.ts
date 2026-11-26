/**
 * HTML 카드·부적·물약 모양 (보상·상점·덱 보기). 색은 shared/theme.js 값 (전투 캔버스의 카드와 같은 색).
 * 카드 틀(card-frame)을 읽었으면: 카드 그림 → 틀(그림 칸은 투명) → 종류색 곱하기 → 설명 칸·기력 구슬·글자 순서로 겹친다.
 * 틀을 못 읽었으면 코드 카드(종류색 바탕 + 글자 그림). 그림 하나하나도 못 읽으면 글자로 바뀐다.
 */
import { KIND_NAME, RARITY_NAME, cardCost, cardDef, cardName, cardText, potionDef, relicDef } from '../game/rules';
import { artState, artUrl, hasArt } from '../art';
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

/** 그림 한 장 (못 읽으면 대신 글자) */
export function artImg(name: string | null | undefined, fallback: string, cls = ''): string {
  if (!hasArt(name)) return `<span class="art-box noimg ${cls}"><i class="fb">${fallback}</i></span>`;
  return `<span class="art-box ${cls}"><img src="${artUrl(name)}" alt="" draggable="false" onerror="this.parentNode.classList.add('noimg')"><i class="fb">${fallback}</i></span>`;
}

export function cardHtml(id: string, up?: boolean, extra = ''): string {
  const d = cardDef(id);
  const cost = cardCost(id, up);
  const costCls = up && cost < d.cost ? ' down' : '';
  const style = `--kind:${KIND_CSS[d.kind]};--ring:${RING_CSS[d.rarity]}`;
  const name = cardName(id, up);
  if (artState.frame) {
    const frame = artUrl('card-frame');
    return `<div class="gcard framed${up ? ' up' : ''}${d.rarity === 'legend' ? ' legend' : ''}" style="${style};--frame:url('${frame}')" ${extra}>
      <span class="gc-pic">${artImg(d.art, KIND_GLYPH[d.kind])}</span>
      <img class="gc-frame" src="${frame}" alt="" draggable="false">
      <span class="gc-tint"></span>
      <span class="gc-desc"></span>
      <span class="gc-cost${costCls}">${hasArt('energy') ? `<img src="${artUrl('energy')}" alt="" draggable="false">` : ''}<b>${cost}</b></span>
      <span class="gc-name${name.length > 5 ? ' long' : ''}">${name}</span>
      <span class="gc-kind">${KIND_NAME[d.kind]} · ${RARITY_NAME[d.rarity]}</span>
      <span class="gc-text">${cardText(id, up)}</span>
    </div>`;
  }
  return `<div class="gcard${up ? ' up' : ''}" style="${style}" ${extra}>
    <span class="gc-cost${costCls}">${cost}</span>
    <span class="gc-name">${name}</span>
    <span class="gc-art">${artImg(d.art, KIND_GLYPH[d.kind])}</span>
    <span class="gc-kind">${KIND_NAME[d.kind]} · ${RARITY_NAME[d.rarity]}</span>
    <span class="gc-text">${cardText(id, up)}</span>
  </div>`;
}

/** 부적 동그라미 (그림 · 못 읽으면 첫 글자) */
export function relicIcon(id: string, cls = 'relic-dot'): string {
  const r = relicDef(id);
  return `<span class="${cls} has-art">${artImg(r.art, r.name.slice(0, 1))}</span>`;
}

export function relicHtml(id: string, extra = ''): string {
  const r = relicDef(id);
  const tag = r.rarity === 'boss' ? '<em class="tag">보스</em>' : r.rarity === 'uncommon' ? '<em class="tag blue">고급</em>' : '';
  return `<div class="item" ${extra}>${relicIcon(id)}<span class="item-main"><b>${r.name} ${tag}</b><small>${r.text}</small></span></div>`;
}

export function potionIcon(id: string, cls = 'potion-dot'): string {
  return `<span class="${cls} has-art">${artImg(potionDef(id).art, '🧪')}</span>`;
}

export function potionHtml(id: string, extra = ''): string {
  const p = potionDef(id);
  return `<div class="item" ${extra}>${potionIcon(id)}<span class="item-main"><b>${p.name}</b><small>${p.text}</small></span></div>`;
}

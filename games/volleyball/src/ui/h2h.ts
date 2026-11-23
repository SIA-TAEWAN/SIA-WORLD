import { h2hText, h2hView, type H2h } from '../net/h2h';
import { esc, state } from './app';

/**
 * 맞대결 전적 한 줄 (게임방 · 결과 화면): "○○와 7승 4패 · 최근 2연승".
 * 이름은 길면 줄이고(…) 숫자는 줄이지 않는다. 읽지 못하면 빈 글 → 그 줄은 보이지 않는다 (.h2h:empty).
 */
export function h2hHtml(name: string, h: H2h): string {
  const v = h2hView(name, h);
  return `<span class="h2h-nm">${esc(v.name)}</span><span class="h2h-rest">${v.particle} <b>${v.record}</b>${v.streak ? ` · <i class="${h.streakWon ? 'up' : 'down'}">${v.streak}</i>` : ''}</span>`;
}

/** 그 줄을 비운다 (안 보인다) */
export function clearH2h(el: HTMLElement) {
  el.innerHTML = '';
  el.removeAttribute('aria-label');
}

/**
 * el 에 그 상대와의 맞대결 전적을 채운다. 실패하면 조용히 비운다.
 * showZero: 아직 경기가 없을 때 '첫 맞대결'을 보일지. still: 답이 왔을 때 아직 이 상대를 보고 있는지.
 */
export async function fillH2h(el: HTMLElement, opp: { id: string; name: string }, showZero: boolean, still: () => boolean = () => true): Promise<void> {
  let h: H2h | null = null;
  try {
    h = (await state.api?.h2h(opp.id)) ?? null;
  } catch {
    h = null;
  }
  if (!el.isConnected || !still()) return;
  if (!h || (!showZero && h.wins + h.losses === 0)) return clearH2h(el);
  el.innerHTML = h2hHtml(opp.name, h);
  el.setAttribute('aria-label', `맞대결 전적: ${h2hText(opp.name, h)}`);
}

import { EMOTES, EMOTE_GAP_MS } from '../game/emote';
import type { RaceRoom } from '../net/room';
import { sfx } from './sfx';

/** 열어 둔 말 목록이 저절로 닫히는 시간 (ms) */
const AUTO_CLOSE_MS = 4000;

/**
 * 짧은 말 버튼 줄.
 * fold: 말풍선 버튼 하나로 접어 두고 누르면 펼친다 (경기 화면: 트랙 위쪽 구석). 아니면 늘 펼쳐 둔다 (결과 화면)
 */
export function emoteBarHtml(fold: boolean): string {
  // tabindex -1: 키보드(스페이스·엔터 = 점프)가 이 버튼을 누르지 않게
  const chips = EMOTES.map((t, i) => `<button class="emo-chip" type="button" tabindex="-1" data-emo="${i}">${t}</button>`).join('');
  return `<div class="emo-bar ${fold ? 'fold' : ''}" data-emo-bar>${
    fold ? '<button class="icon-btn emo-toggle" type="button" tabindex="-1" data-emo-toggle aria-label="짧은 말 보내기" aria-expanded="false">💬</button>' : ''
  }<div class="emo-list">${chips}</div></div>`;
}

/**
 * 버튼 줄을 방에 잇는다: 누르면 보내고(1.5초에 한 번), 누가 보낸 말은 onSay 로 알린다 (내 것 포함).
 * 돌려주는 함수를 부르면 끊는다.
 */
export function wireEmoteBar(root: HTMLElement, room: RaceRoom, onSay: (id: string, text: string) => void): () => void {
  const bar = root.querySelector('[data-emo-bar]') as HTMLElement | null;
  const toggle = bar?.querySelector('[data-emo-toggle]') as HTMLElement | null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let coolTimer: ReturnType<typeof setTimeout> | null = null;

  const setOpen = (open: boolean) => {
    if (!bar || !toggle) return;
    bar.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = open ? setTimeout(() => setOpen(false), AUTO_CLOSE_MS) : null;
  };

  const onClick = (e: Event) => {
    const el = e.target as HTMLElement;
    // 눌린 버튼에 초점이 남지 않게 (키보드 조작이 버튼으로 가지 않도록)
    (el.closest('button') as HTMLElement | null)?.blur();
    if (el.closest('[data-emo-toggle]')) {
      sfx('click');
      setOpen(!bar!.classList.contains('open'));
      return;
    }
    const chip = el.closest('[data-emo]') as HTMLElement | null;
    if (!chip) return;
    if (!room.sendEmote(Number(chip.dataset.emo))) return; // 아직 1.5초가 안 지났다
    sfx('click');
    setOpen(false);
    // 다시 보낼 수 있을 때까지 흐리게
    bar!.classList.add('cool');
    if (coolTimer) clearTimeout(coolTimer);
    coolTimer = setTimeout(() => bar!.classList.remove('cool'), EMOTE_GAP_MS);
  };
  bar?.addEventListener('click', onClick);

  const off = room.onEmote((id, i) => onSay(id, EMOTES[i]));
  return () => {
    off();
    bar?.removeEventListener('click', onClick);
    if (closeTimer) clearTimeout(closeTimer);
    if (coolTimer) clearTimeout(coolTimer);
  };
}

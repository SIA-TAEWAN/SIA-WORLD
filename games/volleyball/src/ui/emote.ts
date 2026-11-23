/**
 * 이모티콘 화면 쪽: 버튼 줄(칩) · 말풍선 · 방 채널로 보내고 받기. 경기 화면과 결과 화면이 함께 쓴다.
 * 규칙(말 목록·간격 제한·메시지 검사)은 game/emote.ts.
 */
import { EMOTES, EMOTE_RECV_GAP_MS, EMOTE_SHOW_MS, EmoteGate, emoteMsg, emoteText, readEmote } from '../game/emote';
import type { Side } from '../game/sim';
import type { NetMsg } from '../net/channel';
import { esc } from './app';
import { sfx } from './sfx';

/** 방 채널에서 이모티콘이 쓰는 부분 (VolleyRoom) */
export interface EmoteLink {
  send(m: NetMsg): void;
  onMsg(fn: (m: NetMsg) => void): () => void;
}

/** 버튼 줄. 포커스를 받지 않게 한다 (스페이스=점프가 버튼을 다시 누르지 않도록) */
export const emoteChips = () => EMOTES.map((t, i) => `<button type="button" class="emo-chip" data-emo="${i}" tabindex="-1">${esc(t)}</button>`).join('');

/** 보내기 간격 제한은 화면이 바뀌어도(경기 → 결과) 이어진다 */
const sendGate = new EmoteGate();

export interface EmoteHub {
  /** i번 말을 보낸다. 간격 제한에 걸리면 false (아무 일도 없다) */
  send(i: number): boolean;
  /** 다음 것을 보낼 수 있을 때까지 남은 시간 (ms) */
  leftMs(): number;
  dispose(): void;
}

/**
 * link: 온라인이면 방, AI 대전이면 null (내 쪽에만 뜬다). oppId: 상대의 사용자 ID (그 사람이 보낸 것만 받는다).
 * show(side, 말): 그 자리 캐릭터 위에 말풍선을 띄운다.
 */
export function emoteHub(o: { link: EmoteLink | null; myId: string; oppId?: string; mySide: Side; show: (side: Side, text: string) => void }): EmoteHub {
  const recvGate = new EmoteGate(EMOTE_RECV_GAP_MS);
  const oppSide: Side = o.mySide === 0 ? 1 : 0;
  const off = o.link?.onMsg((m) => {
    const i = readEmote(m, o.oppId);
    if (i < 0 || !recvGate.pass(performance.now())) return;
    o.show(oppSide, emoteText(i)!);
    sfx('toggle', { volume: 0.5 });
  });
  return {
    send(i) {
      const text = emoteText(i);
      if (text === null || !sendGate.pass(performance.now())) return false;
      o.show(o.mySide, text);
      o.link?.send(emoteMsg(o.myId, i));
      sfx('click');
      return true;
    },
    leftMs: () => sendGate.leftMs(performance.now()),
    dispose: () => void off?.(),
  };
}

/** 말풍선 하나: say(말)로 띄우면 2.5초 뒤 사라진다 */
export function bubble(el: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    el,
    get on() {
      return timer !== null;
    },
    say(text: string) {
      if (timer) clearTimeout(timer);
      el.textContent = text;
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
      timer = setTimeout(() => {
        timer = null;
        el.classList.remove('on');
      }, EMOTE_SHOW_MS);
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      el.classList.remove('on');
    },
  };
}

/**
 * 버튼 줄을 잇는다: 누르면 보내고, 간격 제한 동안 box 에 'cool' 을 붙여 흐리게 한다.
 * pointerdown 으로 받는다 — 다른 손가락으로 조작 버튼을 누른 채여도 바로 눌리고(아이폰은 그럴 때 click 을 안 낸다), 포커스도 옮겨 가지 않는다.
 * sync(): 다른 길(숫자 키)로 보낸 뒤 흐림 표시를 맞춘다.
 */
export function wireChips(box: HTMLElement, hub: EmoteHub, onSent?: () => void): { sync(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cool = () => {
    if (timer) clearTimeout(timer);
    const left = hub.leftMs();
    box.classList.toggle('cool', left > 0);
    timer = left > 0 ? setTimeout(cool, left + 20) : null;
  };
  const onDown = (e: PointerEvent) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-emo]');
    if (!chip) return;
    e.preventDefault();
    if (hub.send(Number(chip.dataset.emo))) onSent?.();
    cool();
  };
  box.addEventListener('pointerdown', onDown);
  cool();
  return {
    sync: cool,
    dispose() {
      if (timer) clearTimeout(timer);
      box.removeEventListener('pointerdown', onDown);
    },
  };
}

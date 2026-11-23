/**
 * 경기 중 이모티콘 (순수 모듈: 화면·통신을 모른다).
 * 버튼을 누르면 내 캐릭터 머리 위에 말풍선이 뜨고, 온라인이면 방 채널로 상대에게도 보낸다 (메시지 종류 'emo').
 */

/** 보낼 수 있는 말 (번호 = 배열 순서. 통신에는 번호만 보낸다) */
export const EMOTES = ['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ'] as const;
/** 한 번 보낸 뒤 다음 것을 보낼 수 있을 때까지 (ms) */
export const EMOTE_GAP_MS = 1500;
/** 말풍선이 떠 있는 시간 (ms) */
export const EMOTE_SHOW_MS = 2500;
/** 받는 쪽 간격 제한 (ms): 통신 지연으로 간격이 조금 좁혀져 도착하는 것은 봐주되, 마구 보내는 것은 버린다 */
export const EMOTE_RECV_GAP_MS = 1000;

/** 방 채널로 보내는 이모티콘 메시지 */
export interface EmoteMsg {
  t: 'emo';
  /** 보낸 사람 */
  from: string;
  /** EMOTES 번호 */
  i: number;
}

/** 번호 → 말 (없는 번호·숫자가 아닌 값은 null) */
export function emoteText(i: unknown): string | null {
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < EMOTES.length ? EMOTES[i] : null;
}

export const emoteMsg = (from: string, i: number): EmoteMsg => ({ t: 'emo', from, i });

/**
 * 받은 메시지가 상대(oppId)가 보낸 쓸 만한 이모티콘이면 그 번호, 아니면 -1.
 * 같은 방 채널의 다른 사람(구경꾼)이나 내가 보낸 것, 없는 번호는 버린다.
 */
export function readEmote(m: unknown, oppId: string | undefined): number {
  const v = m as Partial<EmoteMsg> | null;
  if (!v || typeof v !== 'object' || v.t !== 'emo' || !oppId || v.from !== oppId) return -1;
  return emoteText(v.i) === null ? -1 : (v.i as number);
}

/** 간격 제한: 마지막으로 통과한 뒤 gapMs 가 지나야 다음 것이 통과한다 */
export class EmoteGate {
  private last = -Infinity;
  constructor(private readonly gapMs = EMOTE_GAP_MS) {}

  /** 지금 통과할 수 있으면 true (그리고 지금을 마지막 시각으로 적는다) */
  pass(nowMs: number): boolean {
    if (this.leftMs(nowMs) > 0) return false;
    this.last = nowMs;
    return true;
  }

  /** 다음 것을 보낼 수 있을 때까지 남은 시간 (ms). 시계가 거꾸로 가면 막히지 않게 0 */
  leftMs(nowMs: number): number {
    if (nowMs < this.last) return 0;
    return Math.max(0, this.last + this.gapMs - nowMs);
  }
}

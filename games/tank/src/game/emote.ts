/** 빠른 감정 표현: 버튼 한 번으로 내 탱크 위에 말풍선 */
export const EMOTES = ['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ'] as const;
/** 보내기 간격 제한 (ms) */
export const EMOTE_COOLDOWN_MS = 1500;
/** 말풍선이 떠 있는 시간 (ms) */
export const EMOTE_SHOW_MS = 2500;

/** 다른 기기에서 받은 번호 확인 (모르는 번호는 null) */
export function parseEmote(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < EMOTES.length ? v : null;
}

/** 보내기 간격 제한. try(now) 가 true 면 보내도 된다 (그 시각을 기억한다) */
export class EmoteGate {
  private last = -Infinity;
  constructor(private gap = EMOTE_COOLDOWN_MS) {}
  /** 다음에 보낼 수 있을 때까지 남은 시간 (ms) */
  left(now: number): number {
    return Math.max(0, this.last + this.gap - now);
  }
  try(now: number): boolean {
    if (this.left(now) > 0) return false;
    this.last = now;
    return true;
  }
}

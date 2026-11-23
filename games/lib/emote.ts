/**
 * 카드 5종 공통 한마디(이모티콘): 자리 위 말풍선. 방 채널(Realtime broadcast)로 번호만 보낸다.
 * 순수 계산만 둔다 (검사: _shared/card-extras.test.ts). 화면은 shell.ts
 */

// ───────────────────────── 한마디 (카드 5종 공통) ─────────────────────────

/** 보낼 수 있는 한마디 (방 채널로는 번호만 오간다 → 받은 쪽이 아무 글이나 띄우게 되지 않는다) */
export const EMOTES = ['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ'] as const;
/** 보내기 간격 제한 (ms) */
export const EMOTE_GAP_MS = 1500;
/** 말풍선이 떠 있는 시간 (ms) */
export const EMOTE_SHOW_MS = 2500;

/** 지금 보내도 되는가 (마지막으로 보낸 시각에서 간격이 지났는가) */
export const emoteReady = (lastAt: number, now: number, gap = EMOTE_GAP_MS) => now - lastAt >= gap;

/**
 * 방 채널로 받은 한마디 검사. 누구나 보낼 수 있는 길이라 믿지 않는다:
 * 모양이 맞고, 지금 사람이 앉아 있는 자리이고, 내 자리가 아닌 것만 → { seat, text } (아니면 null)
 */
export function parseEmote(msg: unknown, humanSeats: readonly number[], mySeat: number | null): { seat: number; text: string } | null {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const m = msg as { seat?: unknown; i?: unknown };
  if (typeof m.seat !== 'number' || typeof m.i !== 'number' || !Number.isInteger(m.seat) || !Number.isInteger(m.i)) return null;
  if (m.i < 0 || m.i >= EMOTES.length) return null;
  if (m.seat === mySeat || !humanSeats.includes(m.seat)) return null;
  return { seat: m.seat, text: EMOTES[m.i] };
}

/**
 * 기준점이 없을 때(룰렛 · 자리 줄을 숨긴 낮은 화면) 말풍선 자리: 자리 순서대로 가운데에서 옆으로 벌리고,
 * 이웃끼리 겹치지 않게 한 칸씩 번갈아 내린다 → { x: 화면 x, dy: 아래로 내릴 높이 }
 */
export function emoteSpread(seatNos: readonly number[], seat: number, width: number): { x: number; dy: number } {
  const order = [...new Set(seatNos)].sort((a, b) => a - b);
  const n = Math.max(1, order.length);
  const i = Math.max(0, order.indexOf(seat));
  const step = Math.min(170, Math.max(0, width - 120) / n);
  return { x: width / 2 + (i - (n - 1) / 2) * step, dy: (i % 2) * 40 };
}

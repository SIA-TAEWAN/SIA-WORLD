/** 경기 중·결과 화면에서 보내는 짧은 말 (번호로 주고받는다: 순서를 바꾸지 않고 뒤에 붙인다) */
export const EMOTES: readonly string[] = ['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ'];
/** 한 번 보내면 이만큼 지나야 다시 보낼 수 있다 (ms) */
export const EMOTE_GAP_MS = 1500;
/** 말풍선이 떠 있는 시간 (ms) */
export const EMOTE_SHOW_MS = 2500;
/** 받는 쪽에서 같은 사람 것을 다시 받아 주는 최소 간격 (전송이 조금 몰려 와도 받게 보내는 간격보다 짧다) */
export const EMOTE_RECV_GAP_MS = 1000;

/** 번호가 맞는가 (네트워크로 온 값 검사) */
export function validEmote(i: unknown): i is number {
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < EMOTES.length;
}

/** 지금 보낼 수 있는가. last: 마지막으로 보낸 시각 (없으면 0) */
export function emoteReady(last: number, now: number, gap = EMOTE_GAP_MS): boolean {
  return !last || now - last >= gap;
}

import type { Member } from './channel';

/**
 * 시아서바이벌 접속 인원과 정원 (순수 모듈). 시아탱크 대기실(games/tank/src/net/lobby.ts 의 enter)과 같은 방식:
 * 대기실 채널(survival-lobby)의 Presence 인원이 접속 인원이고, 같은 계정은 한 번만 센다 (key = 사용자 ID).
 * 게임을 하는 동안에도 채널에 남아 있으므로 포함된다.
 */

/** 시아서바이벌에 한 번에 들어와 있을 수 있는 사람 수 */
export const LOBBY_MAX = 30;

/** 먼저 온 순서: 대기실에 들어온 시각(seen) 순, 같으면 사용자 ID 순. 같은 계정(여러 탭)은 가장 이른 것 하나만 */
export function lobbyOrder(members: readonly Member<{ seen?: unknown }>[]): string[] {
  const first = new Map<string, number>();
  for (const m of members) {
    if (!m || typeof m.key !== 'string' || !m.key) continue;
    const raw = Number(m.meta?.seen);
    // 들어온 시각이 없는(이상한) 정보는 맨 뒤로
    const seen = Number.isFinite(raw) && raw > 0 ? raw : Number.MAX_SAFE_INTEGER;
    const old = first.get(m.key);
    if (old === undefined || seen < old) first.set(m.key, seen);
  }
  return [...first].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k]) => k);
}

/** 접속 인원 (같은 계정은 한 번만) */
export const lobbyCount = (members: readonly Member<{ seen?: unknown }>[]) => lobbyOrder(members).length;

/** 내 순번 (0부터). 정원(LOBBY_MAX) 이상이면 들어갈 수 없다. 목록에 없으면 맨 뒤 */
export function lobbyPlace(members: readonly Member<{ seen?: unknown }>[], myKey: string): number {
  const order = lobbyOrder(members);
  const i = order.indexOf(myKey);
  return i < 0 ? order.length : i;
}

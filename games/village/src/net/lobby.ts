import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * 시아마을 접속 인원과 정원 (시아서바이벌 net/capacity.ts · lobby.ts 와 같은 방식).
 * 실시간 채널 하나(village-lobby, Presence key = 사용자 ID)에 들어와 있는 사람이 접속 인원이고, 같은 계정은 한 번만 센다.
 * SIA WORLD 로비도 이 채널을 구독해 게임 카드에 접속 인원을 보여 주므로(shared/presence.js 의 GAME_CHANNELS) 이름을 바꾸지 않는다.
 * 마을에 있는 동안 채널에 남아 있는다. 채널에 연결하지 못하면 인원 확인 없이 들어간다 (마을은 서버 RPC 로 돌아간다).
 */

/** 한 번에 들어와 있을 수 있는 사람 수 */
export const LOBBY_MAX = 30;
export const LOBBY_CHANNEL = 'village-lobby';

export interface Member {
  key: string;
  meta?: { seen?: unknown };
}

/** 먼저 온 순서: 들어온 시각(seen) 순, 같으면 사용자 ID 순. 같은 계정(여러 탭)은 가장 이른 것 하나만 */
export function lobbyOrder(members: readonly Member[]): string[] {
  const first = new Map<string, number>();
  for (const m of members) {
    if (!m || typeof m.key !== 'string' || !m.key) continue;
    const raw = Number(m.meta?.seen);
    const seen = Number.isFinite(raw) && raw > 0 ? raw : Number.MAX_SAFE_INTEGER;
    const old = first.get(m.key);
    if (old === undefined || seen < old) first.set(m.key, seen);
  }
  return [...first].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k]) => k);
}

/** 내 순번 (0부터). 정원 이상이면 들어갈 수 없다. 목록에 없으면 맨 뒤 */
export function lobbyPlace(members: readonly Member[], myKey: string): number {
  const order = lobbyOrder(members);
  const i = order.indexOf(myKey);
  return i < 0 ? order.length : i;
}

export class LobbyFullError extends Error {
  constructor(readonly max: number) {
    super('lobby full');
  }
}

/** 다른 사람 정보가 도착하기를 기다리는 시간 (ms) */
const SETTLE_MS = 900;
/** 채널 연결을 기다리는 최대 시간 (ms): 넘으면 인원 확인 없이 들어간다 */
const JOIN_MS = 6000;

/**
 * 채널에 들어가 정원을 확인한다. 정원 밖이면 채널에서 나오고 LobbyFullError.
 * seen: 들어온 시각 (서버 시각 ms)
 */
export async function enterLobby(sb: SupabaseClient, me: { id: string; name: string }, seen: number, max = LOBBY_MAX): Promise<RealtimeChannel | null> {
  const ch = sb.channel(LOBBY_CHANNEL, { config: { presence: { key: me.id } } });
  let members: Member[] = [];
  ch.on('presence', { event: 'sync' }, () => {
    members = Object.entries(ch.presenceState<{ meta: { seen: number } }>()).map(([key, metas]) => ({ key, meta: metas[metas.length - 1]?.meta }));
  });
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), JOIN_MS);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        void ch.track({ meta: { name: me.name, seen } }).then(() => resolve(true), () => resolve(false));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
  if (!ok) {
    void sb.removeChannel(ch).catch(() => undefined);
    return null;
  }
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  if (lobbyPlace(members, me.id) >= max) {
    await sb.removeChannel(ch).catch(() => undefined);
    throw new LobbyFullError(max);
  }
  return ch;
}

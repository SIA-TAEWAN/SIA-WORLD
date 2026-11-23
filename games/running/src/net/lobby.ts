import { LANES, isCharId, type ZodiacId } from '../game/constants';
import type { RaceApi } from './api';
import type { Channel, Member } from './channel';

/** 대기실 채널에 올리는 내 정보 (Presence). 방에 들어가 있으면 그 방 정보도 같이 올린다 */
export interface LobbyMeta {
  name: string;
  /** 지금 있는 방 코드 (대기실에만 있으면 null) */
  room: string | null;
  /** 그 방에 들어간 시각 (서버 시각 ms) — 가장 먼저 들어간 사람이 방장 */
  at: number;
  /** 그 방에서 고른 캐릭터 */
  char: ZodiacId;
  /** 그 방이 경기 중인가 */
  busy: boolean;
  /** 대기실에 들어온 시각 (ms) — 정원을 넘으면 늦게 온 사람이 못 들어온다 */
  seen?: number;
}

/** 시아레이스에 동시에 들어올 수 있는 사람 수 (shared/presence.js 의 GAME_MAX 와 같은 값) */
export const LOBBY_MAX = 30;

/** 들어온 순서 (seen이 같으면 key 순). 같은 계정은 한 번만 */
export function lobbyOrder(members: readonly Member<LobbyMeta>[]): string[] {
  const seen = new Map<string, number>();
  for (const m of members) if (!seen.has(m.key)) seen.set(m.key, Number(m.meta?.seen) || 0);
  return [...seen].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
}

/** 방 목록 한 줄 */
export interface RoomInfo {
  code: string;
  /** 방장 이름 → "○○의 방" */
  host: string;
  hostChar: ZodiacId;
  /** 지금 있는 사람 수 (4명까지 달린다) */
  count: number;
  busy: boolean;
  /** 방이 생긴 시각 (방장이 들어간 시각) */
  at: number;
}

/** 대기실 사람들의 정보에서 방 목록을 만든다: 같은 방 코드끼리 묶고, 가장 먼저 들어간 사람이 방장 */
export function roomsFrom(members: readonly Member<LobbyMeta>[]): RoomInfo[] {
  const by = new Map<string, Member<LobbyMeta>[]>();
  for (const m of members) {
    const code = m.meta?.room;
    if (typeof code !== 'string' || !/^[a-z0-9]{4,24}$/.test(code)) continue;
    const list = by.get(code) ?? [];
    list.push(m);
    by.set(code, list);
  }
  const rooms: RoomInfo[] = [];
  for (const [code, list] of by) {
    list.sort((a, b) => (Number(a.meta.at) || 0) - (Number(b.meta.at) || 0) || (a.key < b.key ? -1 : 1));
    const host = list[0].meta;
    rooms.push({
      code,
      host: String(host.name ?? '').slice(0, 12) || '이름 없음',
      hostChar: isCharId(host.char) ? host.char : 'tiger',
      count: list.length,
      busy: list.some((m) => m.meta.busy === true),
      at: Number(host.at) || 0,
    });
  }
  // 들어갈 수 있는 방(대기 중·자리 있음)이 위로, 그다음 먼저 생긴 순
  const rank = (r: RoomInfo) => (r.count >= LANES ? 2 : r.busy ? 1 : 0);
  return rooms.sort((a, b) => rank(a) - rank(b) || a.at - b.at || (a.code < b.code ? -1 : 1));
}

/**
 * 시아레이스 대기실: 실시간 채널 하나(race-lobby)에 모두 들어와 있고, 방에 들어간 사람은 방 정보를 Presence로 알린다.
 * (시아탱크의 대기실 채널과 같은 방식. 방 자체가 실시간 채널이라 따로 서버 표를 두지 않는다)
 */
export class RaceLobby {
  private ch: Channel<LobbyMeta> | null = null;
  private meta: LobbyMeta;
  private fns = new Set<() => void>();
  private joining: Promise<void> | null = null;
  rooms: RoomInfo[] = [];
  /** 지금 시아레이스에 들어와 있는 사람 수 (방에 있는 사람 포함) */
  count = 0;
  private order: string[] = [];
  private readonly seen = Date.now();
  /** connecting 연결 중 · ok 목록을 받고 있음 · error 연결 실패 · full 정원(30명)이 차서 못 들어옴 */
  status: 'connecting' | 'ok' | 'error' | 'full' = 'connecting';

  constructor(
    private api: RaceApi,
    readonly me: { id: string; name: string },
  ) {
    this.meta = { name: me.name, room: null, at: 0, char: 'tiger', busy: false, seen: this.seen };
  }

  /** 대기실 채널에 들어간다 (한 번만. 실패하면 다음에 다시 부를 수 있다) */
  join(): Promise<void> {
    if (this.status === 'ok') return Promise.resolve();
    this.joining ??= (async () => {
      this.status = 'connecting';
      const ch = this.api.channel<LobbyMeta>('race-lobby', this.me.id);
      ch.onPresence((list) => {
        this.rooms = roomsFrom(list);
        this.order = lobbyOrder(list);
        this.count = this.order.length;
        this.emit();
      });
      try {
        await ch.join(this.meta);
        // 먼저 와 있던 사람들의 정보가 도착할 시간을 잠깐 주고 정원을 확인한다 (시아탱크 대기실과 같은 방식)
        await new Promise((r) => setTimeout(r, 900));
        if (this.order.indexOf(this.me.id) >= LOBBY_MAX) {
          void ch.leave().catch(() => undefined);
          this.rooms = [];
          this.status = 'full';
          return;
        }
        this.ch = ch;
        this.status = 'ok';
        // 들어오는 사이에 방에 들어갔으면 그 정보를 다시 올린다
        void ch.track(this.meta);
      } catch {
        void ch.leave().catch(() => undefined);
        this.status = 'error';
      } finally {
        this.joining = null;
        this.emit();
      }
    })();
    return this.joining;
  }

  /** 내가 있는 방을 알린다 (나오면 null). 바뀐 것이 없으면 보내지 않는다 */
  setRoom(room: { code: string; at: number; char: ZodiacId; busy: boolean } | null) {
    const next: LobbyMeta = room
      ? { name: this.me.name, room: room.code, at: room.at, char: room.char, busy: room.busy, seen: this.seen }
      : { name: this.me.name, room: null, at: 0, char: this.meta.char, busy: false, seen: this.seen };
    if (JSON.stringify(next) === JSON.stringify(this.meta)) return;
    this.meta = next;
    void this.ch?.track(next);
  }

  onChange(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  private emit() {
    this.fns.forEach((f) => f());
  }
}

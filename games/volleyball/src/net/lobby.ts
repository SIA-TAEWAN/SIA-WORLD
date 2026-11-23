import { isCharId, type ZodiacId } from '../game/constants';
import type { VolleyApi } from './api';
import type { Channel, Member } from './channel';
import { LOBBY_MAX, lobbyCount, lobbyPlace } from './capacity';
import { SEATS, cleanTitle } from './seats';

/** 대기실 채널에 올리는 내 정보 (Presence). 방에 들어가 있으면 그 방 정보도 같이 올린다 */
export interface LobbyMeta {
  name: string;
  /**
   * 대기실에 들어온 시각 (서버 시각 ms) — 먼저 온 순서로 정원을 센다.
   * SIA WORLD 로비도 이 채널(volley-lobby, key = 사용자 ID)을 구독해 게임별 접속 인원을 세므로 이름을 바꾸지 않는다.
   */
  seen: number;
  /** 지금 있는 방 코드 (대기실에만 있으면 null) */
  room: string | null;
  /** 내가 방을 만들 때 적은 방 이름 (없으면 '') */
  title: string;
  /** 그 방에 들어간 시각 (서버 시각 ms) — 가장 먼저 들어간 사람이 방장 */
  at: number;
  /** 그 방에서 고른 캐릭터 */
  char: ZodiacId;
  /** 그 방이 경기 중인가 */
  busy: boolean;
}

export { LOBBY_MAX, lobbyCount, lobbyOrder, lobbyPlace } from './capacity';

/** 대기실이 가득 찼다 (최대 30명) */
export class LobbyFullError extends Error {
  constructor() {
    super('lobby full');
  }
}

/** 다른 사람 정보가 도착하기를 기다리는 시간 (ms). 그 뒤에 내 순번을 본다 */
const SETTLE_MS = 900;

/** 방 목록 한 줄 */
export interface RoomInfo {
  code: string;
  /** 방 이름 (방장이 비워 두면 '○○의 방') */
  title: string;
  /** 방장 이름 */
  host: string;
  hostChar: ZodiacId;
  /** 지금 있는 사람 수 (2명까지) */
  count: number;
  /** 경기 중 */
  busy: boolean;
  /** 들어갈 수 있는가: 대기 중이면서 1/2 */
  open: boolean;
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
    const name = String(host.name ?? '').slice(0, 12) || '이름 없음';
    const count = Math.min(SEATS, list.length);
    const busy = list.some((m) => m.meta.busy === true);
    rooms.push({
      code,
      title: cleanTitle(host.title) || `${name}의 방`,
      host: name,
      hostChar: isCharId(host.char) ? host.char : 'tiger',
      count,
      busy,
      open: !busy && count < SEATS,
      at: Number(host.at) || 0,
    });
  }
  // 들어갈 수 있는 방이 위로, 그다음 먼저 생긴 순
  const rank = (r: RoomInfo) => (r.open ? 0 : r.busy ? 1 : 2);
  return rooms.sort((a, b) => rank(a) - rank(b) || a.at - b.at || (a.code < b.code ? -1 : 1));
}

/**
 * 시아배구 대기실: 실시간 채널 하나(volley-lobby)에 모두 들어와 있고, 방에 들어간 사람은 방 정보를 Presence로 알린다.
 * 방 자체가 실시간 채널이라 따로 서버 표를 두지 않는다 → 아무도 없는 방은 목록에서 저절로 사라진다.
 */
export class VolleyLobby {
  private ch: Channel<LobbyMeta> | null = null;
  private meta: LobbyMeta;
  private fns = new Set<() => void>();
  private joining: Promise<void> | null = null;
  rooms: RoomInfo[] = [];
  /** 지금 시아배구에 들어와 있는 사람 수 (같은 계정은 한 번만. 방에 들어가 있는 사람도 포함) */
  count = 0;
  /** 정원 (테스트 모드에서는 ?lobbymax= 로 줄여 볼 수 있다) */
  readonly max: number;
  private members: Member<LobbyMeta>[] = [];
  /** connecting 연결 중 · ok 목록을 받고 있음 · error 연결 실패 */
  status: 'connecting' | 'ok' | 'error' = 'connecting';

  constructor(
    private api: VolleyApi,
    readonly me: { id: string; name: string },
    max = LOBBY_MAX,
    /** 지금 시각 (서버 시각 ms) */
    private now: () => number = () => Date.now(),
  ) {
    this.meta = { name: me.name, seen: 0, room: null, title: '', at: 0, char: 'tiger', busy: false };
    this.max = max;
  }

  /** 대기실 채널에 들어간다 (한 번만. 실패하면 다음에 다시 부를 수 있다) */
  join(): Promise<void> {
    if (this.status === 'ok') return Promise.resolve();
    this.joining ??= (async () => {
      this.status = 'connecting';
      const ch = this.api.channel<LobbyMeta>('volley-lobby', this.me.id);
      ch.onPresence((list) => {
        this.members = list;
        this.count = lobbyCount(list);
        this.rooms = roomsFrom(list);
        this.emit();
      });
      try {
        if (!this.meta.seen) this.meta = { ...this.meta, seen: this.now() };
        await ch.join(this.meta);
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

  /**
   * 처음 들어올 때: 대기실 채널에 들어가 정원(최대 30명)을 확인한다.
   * 들어온 뒤 잠깐 기다려 먼저 온 순서(seen)로 줄 세웠을 때 내 순번이 정원 밖이면 채널에서 나오고 LobbyFullError.
   * 채널 연결 자체가 안 된 경우는 그냥 돌아온다 (status 'error' — 방 목록에서 다시 시도).
   */
  async enter(): Promise<void> {
    await this.api.syncClock().catch(() => undefined);
    await this.join();
    if (this.status !== 'ok' || !this.ch) return;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    if (lobbyPlace(this.members, this.me.id) >= this.max) {
      const ch = this.ch;
      this.ch = null;
      this.status = 'error';
      await ch.leave().catch(() => undefined);
      throw new LobbyFullError();
    }
  }

  /** 내가 있는 방을 알린다 (나오면 null). 바뀐 것이 없으면 보내지 않는다 */
  setRoom(room: { code: string; title: string; at: number; char: ZodiacId; busy: boolean } | null) {
    const next: LobbyMeta = room
      ? { name: this.me.name, seen: this.meta.seen, room: room.code, title: room.title, at: room.at, char: room.char, busy: room.busy }
      : { name: this.me.name, seen: this.meta.seen, room: null, title: '', at: 0, char: this.meta.char, busy: false };
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

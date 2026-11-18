import type { Channel, Member } from './channel';
import { LOBBY_MAX, lobbyCount, lobbyPlace } from './capacity';

/**
 * 접속 인원 채널에 올리는 내 정보 (Presence).
 * SIA WORLD 로비도 이 채널(survival-lobby, key = 사용자 ID)을 구독해 게임별 접속 인원을 세므로 이름을 바꾸지 않는다.
 */
export interface LobbyMeta {
  name: string;
  /** 들어온 시각 (서버 시각 ms) — 먼저 온 순서로 정원을 센다 */
  seen: number;
}

export { LOBBY_MAX, lobbyCount, lobbyOrder, lobbyPlace } from './capacity';

/** 가득 찼다 (최대 30명) */
export class LobbyFullError extends Error {
  constructor() {
    super('lobby full');
  }
}

/** 다른 사람 정보가 도착하기를 기다리는 시간 (ms). 그 뒤에 내 순번을 본다 */
const SETTLE_MS = 900;

/** 채널을 만드는 쪽 (net/api.ts): 실시간 채널과 서버 시각 */
export interface LobbyNet {
  channel<M>(name: string, key: string): Channel<M>;
  /** 지금 서버 시각 (ms). 못 물어보면 기기 시각 */
  now(): Promise<number>;
}

/**
 * 시아서바이벌 접속 인원: 실시간 채널 하나(survival-lobby)에 모두 들어와 있다 (시아배구 net/lobby.ts 와 같은 방식).
 * 1인 게임이라 방 목록은 없고, 사람 수만 센다. 게임을 하는 동안에도 채널에 남아 있는다.
 */
export class SurvivalLobby {
  private ch: Channel<LobbyMeta> | null = null;
  private meta: LobbyMeta;
  private fns = new Set<() => void>();
  private joining: Promise<void> | null = null;
  private members: Member<LobbyMeta>[] = [];
  /** 지금 들어와 있는 사람 수 (같은 계정은 한 번만) */
  count = 0;
  readonly max: number;
  /** connecting 연결 중 · ok 인원을 받고 있음 · error 연결 실패 */
  status: 'connecting' | 'ok' | 'error' = 'connecting';

  constructor(
    private net: LobbyNet,
    readonly me: { id: string; name: string },
    max = LOBBY_MAX,
  ) {
    this.meta = { name: me.name, seen: 0 };
    this.max = max;
  }

  /** 채널에 들어간다 (한 번만. 실패하면 다음에 다시 부를 수 있다) */
  join(): Promise<void> {
    if (this.status === 'ok') return Promise.resolve();
    this.joining ??= (async () => {
      this.status = 'connecting';
      const ch = this.net.channel<LobbyMeta>('survival-lobby', this.me.id);
      ch.onPresence((list) => {
        this.members = list;
        this.count = lobbyCount(list);
        this.emit();
      });
      try {
        if (!this.meta.seen) this.meta = { ...this.meta, seen: await this.net.now().catch(() => Date.now()) };
        await ch.join(this.meta);
        this.ch = ch;
        this.status = 'ok';
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
   * 처음 들어올 때: 채널에 들어가 정원(최대 30명)을 확인한다.
   * 잠깐 기다려 먼저 온 순서(seen)로 줄 세웠을 때 내 순번이 정원 밖이면 채널에서 나오고 LobbyFullError.
   * 채널 연결 자체가 안 된 경우는 그냥 돌아온다 (status 'error' — 인원 표시만 없이 게임은 할 수 있다).
   */
  async enter(): Promise<void> {
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

  onChange(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  private emit() {
    this.fns.forEach((f) => f());
  }
}

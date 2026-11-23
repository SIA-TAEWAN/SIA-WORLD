import type { Backend, Channel, Member, NetMsg } from './backend';
import type { ChatMsg } from './lobby';

/**
 * 이 기기의 판본. 기기끼리 주고받는 내용(새 탱크 등)이 바뀌면 올린다.
 * 방에 더 새 판본의 기기가 있으면 새로고침을 권한다 (예: 고양이 탱크를 모르는 예전 탭).
 * 1: 고양이(cat) 탱크 추가
 */
export const CLIENT_VERSION = 1;

export interface RoomMeta {
  name: string;
  /** 게임 중 화면을 가림 (기준 기기에서 빠진다) */
  away?: boolean;
  /** 기기 판본 (CLIENT_VERSION). 예전 기기에는 없다 */
  ver?: number;
}

/** 다른 기기들 중 나보다 새 판본이 있는가 */
export const hasNewerVersion = (metas: readonly (Partial<RoomMeta> | null | undefined)[], mine = CLIENT_VERSION): boolean =>
  metas.some((m) => typeof m?.ver === 'number' && m.ver > mine);

/** 게임방 채널: 누가 접속해 있는지(Presence)와 게임 메시지(Broadcast) */
export class RoomSession {
  private ch: Channel<RoomMeta>;
  readonly present = new Set<string>();
  /** 게임 중 화면을 가린 다른 사람 */
  readonly away = new Set<string>();
  private awayMe = false;
  private msgFns = new Set<(m: NetMsg) => void>();
  private presFns = new Set<() => void>();
  private chatFns = new Set<() => void>();
  private reconnFns = new Set<() => void>();
  private joined = false;
  /** 이 방 사람끼리만 보는 채팅 */
  chat: ChatMsg[] = [];
  private names = new Map<string, string>();
  private seen = false;
  private toldNewer = false;
  /** 방에 더 새 판본의 기기가 있을 때 (한 번) */
  onNewerVersion: (() => void) | null = null;

  constructor(
    backend: Backend,
    readonly roomId: string,
    readonly me: { id: string; name: string },
  ) {
    this.ch = backend.channel<RoomMeta>(`room:${roomId}`, me.id);
    this.ch.onMessage((m) => {
      if (m.t === 'chat') {
        this.push({ name: String(m.name).slice(0, 10), text: String(m.text).slice(0, 120), at: Date.now() });
        return;
      }
      this.msgFns.forEach((f) => f(m));
    });
    this.ch.onPresence((list: Member<RoomMeta>[]) => {
      const before = new Set(this.present);
      this.present.clear();
      this.away.clear();
      list.forEach((m) => {
        this.present.add(m.key);
        if (m.meta?.away && m.key !== me.id) this.away.add(m.key);
        this.names.set(m.key, m.meta.name);
      });
      this.present.add(me.id);
      // 들고 나는 사람 알림 (처음 목록을 받을 때는 생략)
      if (this.seen) {
        for (const k of this.present) if (!before.has(k)) this.push({ name: '', text: `${this.names.get(k) ?? '누군가'} 님이 들어왔어요`, at: Date.now(), system: true });
        for (const k of before) if (!this.present.has(k)) this.push({ name: '', text: `${this.names.get(k) ?? '누군가'} 님이 나갔어요`, at: Date.now(), system: true });
      }
      this.seen = true;
      // 더 새 판본의 기기가 들어왔다: 한 번만 새로고침을 권한다 (게임은 막지 않는다)
      if (!this.toldNewer && hasNewerVersion(list.filter((m) => m.key !== me.id).map((m) => m.meta))) {
        this.toldNewer = true;
        this.onNewerVersion?.();
      }
      this.presFns.forEach((f) => f());
    });
    this.ch.onReconnect?.(() => this.reconnFns.forEach((f) => f()));
  }

  async join() {
    if (this.joined) return;
    this.joined = true;
    this.present.add(this.me.id);
    await this.ch.join(this.meta());
  }

  private meta(): RoomMeta {
    return this.awayMe ? { name: this.me.name, away: true, ver: CLIENT_VERSION } : { name: this.me.name, ver: CLIENT_VERSION };
  }

  /** 게임 중 화면을 가렸다/다시 본다 (접속 정보에 올린다) */
  async setAway(away: boolean) {
    if (this.awayMe === away) return;
    this.awayMe = away;
    if (this.joined) await this.ch.track(this.meta());
  }

  on(fn: (m: NetMsg) => void) {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  onPresence(fn: () => void) {
    this.presFns.add(fn);
    return () => this.presFns.delete(fn);
  }

  /** 연결이 끊겼다 다시 이어졌을 때 (남들은 내가 나갔다 들어온 것으로 봤다) */
  onReconnect(fn: () => void) {
    this.reconnFns.add(fn);
    return () => this.reconnFns.delete(fn);
  }

  send(m: NetMsg) {
    this.ch.send(m);
  }

  private push(c: ChatMsg) {
    this.chat.push(c);
    if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
    this.chatFns.forEach((f) => f());
  }

  sendChat(text: string) {
    const t = text.trim().slice(0, 120);
    if (!t) return;
    this.ch.send({ t: 'chat', name: this.me.name, text: t });
    this.push({ name: this.me.name, text: t, at: Date.now() });
  }

  onChat(fn: () => void) {
    this.chatFns.add(fn);
    return () => this.chatFns.delete(fn);
  }

  async leave() {
    this.msgFns.clear();
    this.presFns.clear();
    this.chatFns.clear();
    this.reconnFns.clear();
    await this.ch.leave();
  }
}

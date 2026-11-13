import type { Backend, Channel, Member, NetMsg } from './backend';
import type { ChatMsg } from './lobby';

export interface RoomMeta {
  name: string;
}

/** 게임방 채널: 누가 접속해 있는지(Presence)와 게임 메시지(Broadcast) */
export class RoomSession {
  private ch: Channel<RoomMeta>;
  readonly present = new Set<string>();
  private msgFns = new Set<(m: NetMsg) => void>();
  private presFns = new Set<() => void>();
  private chatFns = new Set<() => void>();
  private joined = false;
  /** 이 방 사람끼리만 보는 채팅 */
  chat: ChatMsg[] = [];
  private names = new Map<string, string>();
  private seen = false;

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
      list.forEach((m) => {
        this.present.add(m.key);
        this.names.set(m.key, m.meta.name);
      });
      this.present.add(me.id);
      // 들고 나는 사람 알림 (처음 목록을 받을 때는 생략)
      if (this.seen) {
        for (const k of this.present) if (!before.has(k)) this.push({ name: '', text: `${this.names.get(k) ?? '누군가'} 님이 들어왔어요`, at: Date.now(), system: true });
        for (const k of before) if (!this.present.has(k)) this.push({ name: '', text: `${this.names.get(k) ?? '누군가'} 님이 나갔어요`, at: Date.now(), system: true });
      }
      this.seen = true;
      this.presFns.forEach((f) => f());
    });
  }

  async join() {
    if (this.joined) return;
    this.joined = true;
    this.present.add(this.me.id);
    await this.ch.join({ name: this.me.name });
  }

  on(fn: (m: NetMsg) => void) {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  onPresence(fn: () => void) {
    this.presFns.add(fn);
    return () => this.presFns.delete(fn);
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
    await this.ch.leave();
  }
}

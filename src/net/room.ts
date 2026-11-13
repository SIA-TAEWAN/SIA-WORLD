import type { Backend, Channel, Member, NetMsg } from './backend';

export interface RoomMeta {
  name: string;
}

/** 게임방 채널: 누가 접속해 있는지(Presence)와 게임 메시지(Broadcast) */
export class RoomSession {
  private ch: Channel<RoomMeta>;
  readonly present = new Set<string>();
  private msgFns = new Set<(m: NetMsg) => void>();
  private presFns = new Set<() => void>();
  private joined = false;

  constructor(
    backend: Backend,
    readonly roomId: string,
    readonly me: { id: string; name: string },
  ) {
    this.ch = backend.channel<RoomMeta>(`room:${roomId}`, me.id);
    this.ch.onMessage((m) => this.msgFns.forEach((f) => f(m)));
    this.ch.onPresence((list: Member<RoomMeta>[]) => {
      this.present.clear();
      list.forEach((m) => this.present.add(m.key));
      this.present.add(me.id);
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

  async leave() {
    this.msgFns.clear();
    this.presFns.clear();
    await this.ch.leave();
  }
}

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface Member<M> {
  key: string;
  meta: M;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NetMsg = { t: string; [k: string]: any };

/** 실시간 채널 하나 (Presence + Broadcast). 시아레이스(games/running/src/net/channel.ts)에서 가져옴 */
export interface Channel<M> {
  onPresence(cb: (members: Member<M>[]) => void): void;
  onMessage(cb: (msg: NetMsg) => void): void;
  /** 구독하고 내 정보를 올린다 */
  join(meta: M): Promise<void>;
  track(meta: M): Promise<void>;
  send(msg: NetMsg): void;
  leave(): Promise<void>;
  /** 지금 채널이 이어져 있는가 (끊겼거나 다시 잇는 중이면 false) */
  connected(): boolean;
}

/** Supabase Realtime 채널 */
export class SupaChannel<M> implements Channel<M> {
  private ch: RealtimeChannel;
  private presenceCbs: ((m: Member<M>[]) => void)[] = [];
  private msgCbs: ((m: NetMsg) => void)[] = [];

  constructor(sb: SupabaseClient, name: string, key: string) {
    this.ch = sb.channel(name, { config: { presence: { key }, broadcast: { self: false, ack: false } } });
    this.ch.on('presence', { event: 'sync' }, () => {
      const state = this.ch.presenceState<{ meta: M }>();
      const list: Member<M>[] = [];
      for (const [k, metas] of Object.entries(state)) {
        const last = metas[metas.length - 1];
        if (last) list.push({ key: k, meta: last.meta });
      }
      this.presenceCbs.forEach((cb) => cb(list));
    });
    this.ch.on('broadcast', { event: 'm' }, ({ payload }) => this.msgCbs.forEach((cb) => cb(payload as NetMsg)));
  }

  onPresence(cb: (m: Member<M>[]) => void) {
    this.presenceCbs.push(cb);
  }
  onMessage(cb: (m: NetMsg) => void) {
    this.msgCbs.push(cb);
  }

  join(meta: M): Promise<void> {
    this.lastMeta ??= meta;
    return new Promise((resolve, reject) => {
      let done = false;
      this.ch.subscribe(async (status) => {
        // 채널 상태를 적어 둔다: SUBSCRIBED 면 이어져 있고, CHANNEL_ERROR · TIMED_OUT · CLOSED 면 끊긴 것
        this.up = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          // 다시 연결됐을 때도 내 정보를 다시 올린다
          await this.ch.track({ meta: this.lastMeta ?? meta });
          if (!done) {
            done = true;
            resolve();
          }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !done) {
          done = true;
          reject(new Error(status));
        }
      });
    });
  }

  private up = false;
  connected() {
    return this.up;
  }

  private lastMeta: M | null = null;
  async track(meta: M) {
    this.lastMeta = meta;
    await this.ch.track({ meta });
  }

  send(msg: NetMsg) {
    void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }

  async leave() {
    this.presenceCbs = [];
    this.msgCbs = [];
    await this.ch.unsubscribe();
  }
}

const HEARTBEAT = 700;
const TIMEOUT = 2500;

/** 서버 없이 같은 브라우저의 탭끼리 통신하는 테스트용 채널 (?local=1) */
export class LocalChannel<M> implements Channel<M> {
  private bc: BroadcastChannel;
  private members = new Map<string, { meta: M; seen: number }>();
  private presenceCbs: ((m: Member<M>[]) => void)[] = [];
  private msgCbs: ((m: NetMsg) => void)[] = [];
  private meta: M | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastJson = '';

  /** lagMs: 받은 메시지를 이만큼 늦게 전달한다 (테스트용 ?lag=150 — 통신 지연 흉내) */
  constructor(
    name: string,
    private key: string,
    private lagMs = 0,
  ) {
    this.bc = new BroadcastChannel(`siavolley:${name}`);
    this.bc.onmessage = (e) => {
      const d = e.data as { type: string };
      if (this.lagMs > 0 && d.type === 'msg') setTimeout(() => this.closed || this.handle(e.data), this.lagMs);
      else this.handle(e.data);
    };
  }
  private closed = false;

  private handle(d: { k: string; type: string; meta?: M; msg?: NetMsg }) {
    if (d.type === 'hb' || d.type === 'hello') {
      this.members.set(d.k, { meta: d.meta!, seen: Date.now() });
      if (d.type === 'hello' && this.meta) this.bc.postMessage({ k: this.key, type: 'hb', meta: this.meta });
      this.emitIfChanged();
    } else if (d.type === 'bye') {
      if (this.members.delete(d.k)) this.emitIfChanged();
    } else if (d.type === 'msg') {
      this.msgCbs.forEach((cb) => cb(d.msg!));
    }
  }

  private list(): Member<M>[] {
    const list: Member<M>[] = [...this.members].map(([key, v]) => ({ key, meta: v.meta }));
    if (this.meta) list.push({ key: this.key, meta: this.meta });
    return list;
  }

  private emitIfChanged() {
    const list = this.list();
    const json = JSON.stringify(list.map((m) => [m.key, m.meta]).sort());
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.presenceCbs.forEach((cb) => cb(list));
  }

  onPresence(cb: (m: Member<M>[]) => void) {
    this.presenceCbs.push(cb);
  }
  onMessage(cb: (m: NetMsg) => void) {
    this.msgCbs.push(cb);
  }

  async join(meta: M) {
    this.meta = meta;
    this.bc.postMessage({ k: this.key, type: 'hello', meta });
    this.timer = setInterval(() => {
      this.bc.postMessage({ k: this.key, type: 'hb', meta: this.meta });
      const now = Date.now();
      for (const [k, v] of this.members) if (now - v.seen > TIMEOUT) this.members.delete(k);
      this.emitIfChanged();
    }, HEARTBEAT);
    // 먼저 있던 사람들의 답을 잠깐 기다린다
    await new Promise((r) => setTimeout(r, 250));
    this.emitIfChanged();
  }

  async track(meta: M) {
    this.meta = meta;
    this.bc.postMessage({ k: this.key, type: 'hb', meta });
    this.emitIfChanged();
  }

  send(msg: NetMsg) {
    this.bc.postMessage({ k: this.key, type: 'msg', msg });
  }

  /** 같은 브라우저의 탭끼리라 언제나 이어져 있다 */
  connected() {
    return !this.closed;
  }

  async leave() {
    if (this.timer) clearInterval(this.timer);
    this.closed = true;
    this.bc.postMessage({ k: this.key, type: 'bye' });
    this.bc.close();
    this.presenceCbs = [];
    this.msgCbs = [];
  }
}

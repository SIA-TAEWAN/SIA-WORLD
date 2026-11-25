import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface Member<M> {
  key: string;
  meta: M;
}

/**
 * 방 채널로 오가는 메시지. t = 종류:
 * - 방(net/room.ts): start · over · hello · state
 * - 경기(match/online.ts, n: 경기 번호): pos · snap(hl: 하이라이트) · quit · taken
 * - 이모티콘(game/emote.ts EmoteMsg): emo { from, i } — 경기 중·결과 화면에서 상대 캐릭터 위 말풍선
 */
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

/** 채널에 들어가는 데 이보다 오래 걸리면 실패로 끝낸다 (화면이 "들어가는 중…"에 멈추지 않게) */
const JOIN_TIMEOUT_MS = 15000;
/**
 * 이름별로 아직 끝나지 않은 나가기. supabase-js 의 sb.channel(이름)은 같은 이름의 채널이 남아 있으면 그것을 돌려주는데,
 * 나가는 중('leaving')인 채널에 subscribe 하면 아무 일도 일어나지 않아 join 이 끝나지 않는다.
 * 그래서 같은 이름으로 다시 들어갈 때는 앞의 나가기가 끝나기를 기다리고, 남은 채널을 치운 뒤 새로 만든다.
 */
const leaving = new Map<string, Promise<void>>();

/** Supabase Realtime 채널 (실제 채널은 join 때 만든다) */
export class SupaChannel<M> implements Channel<M> {
  private ch: RealtimeChannel | null = null;
  private presenceCbs: ((m: Member<M>[]) => void)[] = [];
  private msgCbs: ((m: NetMsg) => void)[] = [];
  private closed = false;

  constructor(
    private sb: SupabaseClient,
    private name: string,
    private key: string,
  ) {}

  onPresence(cb: (m: Member<M>[]) => void) {
    this.presenceCbs.push(cb);
  }
  onMessage(cb: (m: NetMsg) => void) {
    this.msgCbs.push(cb);
  }

  /** 앞의 나가기를 기다리고, 같은 이름으로 남아 있는 채널을 치운 뒤 새 채널을 만든다 */
  private async open(): Promise<RealtimeChannel> {
    const prev = leaving.get(this.name);
    if (prev) await prev.catch(() => undefined);
    const topic = `realtime:${this.name}`;
    for (const old of this.sb.getChannels().filter((c) => c.topic === topic)) await this.sb.removeChannel(old).catch(() => undefined);
    const ch = this.sb.channel(this.name, { config: { presence: { key: this.key }, broadcast: { self: false, ack: false } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ meta: M }>();
      const list: Member<M>[] = [];
      for (const [k, metas] of Object.entries(state)) {
        const last = metas[metas.length - 1];
        if (last) list.push({ key: k, meta: last.meta });
      }
      this.presenceCbs.forEach((cb) => cb(list));
    });
    ch.on('broadcast', { event: 'm' }, ({ payload }) => this.msgCbs.forEach((cb) => cb(payload as NetMsg)));
    return ch;
  }

  join(meta: M): Promise<void> {
    this.lastMeta ??= meta;
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (why: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail('JOIN_TIMEOUT'), JOIN_TIMEOUT_MS);
      void this.open().then(
        (ch) => {
          // 기다리는 사이에 나갔거나 시간이 다 됐으면 만든 채널을 바로 치운다
          if (this.closed || done) {
            void this.sb.removeChannel(ch).catch(() => undefined);
            return fail('CLOSED');
          }
          this.ch = ch;
          ch.subscribe(async (status) => {
            // 채널 상태를 적어 둔다: SUBSCRIBED 면 이어져 있고, CHANNEL_ERROR · TIMED_OUT · CLOSED 면 끊긴 것
            this.up = status === 'SUBSCRIBED';
            if (status === 'SUBSCRIBED') {
              // 다시 연결됐을 때도 내 정보를 다시 올린다
              await ch.track({ meta: this.lastMeta ?? meta }).catch(() => undefined);
              if (!done) {
                done = true;
                clearTimeout(timer);
                resolve();
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              // 이어지기 전에 닫혀도(CLOSED) 실패로 끝낸다 (안 그러면 "방에 들어가는 중…"에 멈추고 [다시 시도]도 듣지 않는다)
              fail(status);
            }
          });
        },
        () => fail('CHANNEL_ERROR'),
      );
    });
  }

  private up = false;
  connected() {
    return this.up;
  }

  private lastMeta: M | null = null;
  async track(meta: M) {
    this.lastMeta = meta;
    // 아직 채널이 없으면 join 때 이 정보를 올린다
    if (this.ch) await this.ch.track({ meta });
  }

  send(msg: NetMsg) {
    if (this.ch) void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }

  async leave() {
    this.closed = true;
    this.up = false;
    this.presenceCbs = [];
    this.msgCbs = [];
    const ch = this.ch;
    this.ch = null;
    if (!ch) return;
    // 나가기가 끝날 때까지 같은 이름으로 다시 들어오는 쪽이 기다린다 (removeChannel: 나가고 목록에서도 뺀다)
    const p: Promise<void> = this.sb
      .removeChannel(ch)
      .then(() => undefined, () => undefined)
      .finally(() => {
        if (leaving.get(this.name) === p) leaving.delete(this.name);
      });
    leaving.set(this.name, p);
    await p;
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

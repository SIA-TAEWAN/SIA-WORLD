import { END_AFTER_GO, type ZodiacId } from '../game/constants';
import { EMOTE_RECV_GAP_MS, emoteReady, validEmote } from '../game/emote';
import type { RankedEntry } from '../game/ranking';
import { addRound, cleanSeries, newSeries, shouldAdopt, type Series } from '../game/series';
import { GO_GAP_MS, GoTooSoonError, serverNow, type RaceApi } from './api';
import type { Channel, Member, NetMsg } from './channel';
import { CLIENT_VERSION, allReady, hostOf, makeSeats, players, resolveChar, sortMembers, type MemberInfo, type PlayerMeta, type Seat } from './seats';

/** 출전 명단 한 줄 (시작할 때 방장이 정해서 보낸다) */
export interface RosterEntry {
  slot: number;
  /** 사람이면 사용자 ID, AI면 null */
  id: string | null;
  name: string;
  char: ZodiacId;
}

/** 경기 시작 알림: 맵 시드와 준비·GO 시각(서버 시각), 출전 명단 */
export interface StartMsg {
  t: 'start';
  round: number;
  seed: number;
  readyAt: number;
  goAt: number;
  roster: RosterEntry[];
}

/** 방 코드: 영문 소문자·숫자 6자 (주소 ?room=코드) */
export function newRoomCode(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export const cleanRoomCode = (raw: string | null) => (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
export const validRoomCode = (c: string) => /^[a-z0-9]{4,24}$/.test(c);

/**
 * 경주 방: 실시간 채널 하나 (방 코드마다).
 * - Presence: 누가 있는지, 캐릭터, 레디. 가장 먼저 들어온 사람이 방장.
 * - Broadcast: 시작 알림(start), 경기 중 위치(pos), 연속전 점수판(gp), 짧은 말(emo) 등.
 */
export class RaceRoom {
  private ch: Channel<PlayerMeta>;
  members: MemberInfo[] = [];
  readonly present = new Set<string>();
  private meta: PlayerMeta;
  private changeFns = new Set<() => void>();
  private msgFns = new Set<(m: NetMsg) => void>();
  private startFns = new Set<(s: StartMsg) => void>();
  private joined = false;
  private left = false;
  /** 지금 진행 중인 판 (끝나면 null) */
  current: StartMsg | null = null;
  private starting = false;
  private lastRound = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 'too soon' 으로 거절된 GO 요청을 다시 할 때까지 기다리는 타이머 */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 내가 마지막으로 서버에서 GO 를 받은 시각 (서버 시각 ms, 없으면 0) */
  private lastGoAt = 0;
  /** 같은 방에 더 새 판본의 기기가 있다 (한 번만 부른다) */
  onNewerVersion: (() => void) | null = null;
  private toldNewer = false;
  /** 연속전 점수판 (이 방에 있는 동안만. 나가면 사라진다) */
  series: Series = newSeries();
  /** 오늘의 도전: 이 방의 판은 이 시드(날짜로 만든 트랙)로 연다. 보통 방은 null (판마다 무작위) */
  fixedSeed: number | null = null;
  private emoteFns = new Set<(id: string, i: number) => void>();
  /** 내가 마지막으로 짧은 말을 보낸 시각 (기기 시각 ms) */
  private lastEmote = 0;
  /** 사람마다 마지막으로 짧은 말을 받은 시각 */
  private emoteSeen = new Map<string, number>();

  constructor(
    private api: RaceApi,
    readonly key: string,
    readonly me: { id: string; name: string },
    char: ZodiacId,
  ) {
    this.meta = { name: me.name, char, ready: false, at: 0, pickAt: 0, ver: CLIENT_VERSION };
    this.ch = api.channel<PlayerMeta>(`race:${key}`, me.id);
    this.ch.onPresence((list) => this.onPresence(list));
    this.ch.onMessage((m) => this.onMessage(m));
  }

  async join() {
    if (this.joined) return;
    this.joined = true;
    await this.api.syncClock().catch(() => undefined);
    const now = serverNow();
    this.meta = { ...this.meta, at: now, pickAt: now };
    this.members = [{ id: this.me.id, ...this.meta }];
    this.present.add(this.me.id);
    await this.ch.join(this.meta);
    // 먼저 있던 사람에게 지금 경기 중인지 묻는다
    this.ch.send({ t: 'hello', from: this.me.id });
    this.timer = setInterval(() => this.tick(), 500);
  }

  private onPresence(list: Member<PlayerMeta>[]) {
    if (this.left) return;
    const others = list.filter((m) => m.key !== this.me.id && m.meta && typeof m.meta.at === 'number').map((m) => ({ id: m.key, ...m.meta }));
    this.members = sortMembers([...others, { id: this.me.id, ...this.meta }]);
    this.present.clear();
    this.members.forEach((m) => this.present.add(m.id));
    // 다른 기기가 더 새 판본이면 새로고침을 권한다 (경기는 막지 않는다)
    if (!this.toldNewer && others.some((m) => typeof m.ver === 'number' && m.ver > CLIENT_VERSION)) {
      this.toldNewer = true;
      this.onNewerVersion?.();
    }
    // 캐릭터가 겹치면 늦게 고른 쪽이 다음 빈 캐릭터로
    const mine = this.members.find((m) => m.id === this.me.id)!;
    const char = resolveChar(mine, this.members);
    if (char !== this.meta.char) {
      this.meta = { ...this.meta, char, pickAt: serverNow() };
      void this.ch.track(this.meta);
      this.members = sortMembers([...others, { id: this.me.id, ...this.meta }]);
    }
    this.emit();
    this.tick();
  }

  private onMessage(m: NetMsg) {
    if (this.left) return;
    if (m.t === 'start') this.applyStart(m as StartMsg, true);
    else if (m.t === 'hello') {
      // 가장 먼저 들어온 사람이 답한다 (경기 중이면 그 판 정보)
      if (this.isHost() && m.from !== this.me.id) this.ch.send({ t: 'state', to: m.from, f: this.me.id, start: this.current, gp: this.series });
    } else if (m.t === 'state') {
      // 늦게 들어왔으면 그 판에는 끼지 않고, 끝날 때까지 기다린다
      if (m.to === this.me.id) {
        // 늦게 들어와도 지금까지의 연속전 점수판을 받는다
        if (m.gp) this.adoptSeries(m.gp, m.f);
        if (m.start && !this.current) this.applyStart(m.start as StartMsg, false);
      }
    } else if (m.t === 'end') {
      if (this.current && m.round === this.current.round) this.raceOver(m.round);
    } else if (m.t === 'gp') {
      if (typeof m.f === 'string' && m.f !== this.me.id && this.present.has(m.f)) this.adoptSeries(m.gp, m.f);
    } else if (m.t === 'emo') {
      // 방에 있는 사람이 보낸, 정해진 번호만. 한 사람이 너무 자주 보내면 버린다
      const now = Date.now();
      if (typeof m.f === 'string' && m.f !== this.me.id && this.present.has(m.f) && validEmote(m.i) && emoteReady(this.emoteSeen.get(m.f) ?? 0, now, EMOTE_RECV_GAP_MS)) {
        this.emoteSeen.set(m.f, now);
        this.emoteFns.forEach((f) => f(m.f, m.i));
      }
    }
    this.msgFns.forEach((f) => f(m));
  }

  private applyStart(s: StartMsg, live: boolean) {
    if (!s || typeof s.round !== 'number' || !Array.isArray(s.roster)) return;
    if (this.current?.round === s.round || s.round === this.lastRound) return;
    // 이미 끝났을 시간이면 무시
    if (serverNow() > s.goAt + (END_AFTER_GO + 5) * 1000) return;
    // 이미 판이 있는데 다른 시작이 왔다 (두 기기가 잠깐 서로 방장이라고 본 경우):
    // 모두 같은 판으로 모이도록 번호가 작은 쪽만 받는다. 지금 판이 이미 GO 했으면 바꾸지 않는다
    if (this.current && (s.round > this.current.round || serverNow() >= this.current.goAt)) return;
    this.current = s;
    this.lastRound = s.round;
    this.starting = false;
    if (this.meta.ready) this.setReady(false);
    this.emit();
    if (live) this.startFns.forEach((f) => f(s));
  }

  /** 판이 끝났다 (결과가 정해졌거나 시간이 지났다) */
  raceOver(round: number) {
    if (this.current?.round !== round) return;
    this.current = null;
    this.emit();
  }

  // ───────────── 연속전 점수판 ─────────────

  /** 받은 점수판: 더 많은 판을 센 것이면 받고, 같은 판 수면 방장 것을 따른다 */
  private adoptSeries(raw: unknown, from: unknown) {
    const s = cleanSeries(raw);
    if (!s || !shouldAdopt(this.series, s, from === hostOf(this.members))) return;
    this.series = s;
    this.emit();
  }

  /**
   * 한 판이 끝났다: 순위별 점수를 더하고 알린다 (같은 판은 한 번만).
   * 달린 기기마다 자기 것에 더해 두고, 방장이 보낸 것이 기준이 된다 (방장이 그 판을 달리지 않았으면 달린 기기 것이 방장에게 간다)
   */
  addResult(round: number, roster: readonly RosterEntry[], results: readonly RankedEntry[], taken: readonly boolean[]) {
    if (this.left) return;
    const next = addRound(this.series, round, roster, results, taken);
    if (next === this.series) return;
    this.series = next;
    const send = () => !this.left && this.series === next && this.ch.send({ t: 'gp', f: this.me.id, gp: next });
    send();
    // 놓친 기기를 위해 방장은 한 번 더 보낸다
    if (this.isHost()) setTimeout(send, 800);
    this.emit();
  }

  // ───────────── 짧은 말 (이모티콘) ─────────────

  /** 짧은 말을 보낸다 (1.5초에 한 번). 보냈으면 true */
  sendEmote(i: number): boolean {
    const now = Date.now();
    if (this.left || !validEmote(i) || !emoteReady(this.lastEmote, now)) return false;
    this.lastEmote = now;
    this.ch.send({ t: 'emo', f: this.me.id, i });
    this.emoteFns.forEach((f) => f(this.me.id, i));
    return true;
  }

  /** 누가 짧은 말을 보냈다 (내가 보낸 것도 온다) */
  onEmote(fn: (id: string, i: number) => void) {
    this.emoteFns.add(fn);
    return () => this.emoteFns.delete(fn);
  }

  private tick() {
    if (this.left) return;
    const cur = this.current;
    if (cur) {
      // 끝 알림을 못 받았어도 시간이 지났거나, 달리던 사람이 아무도 없으면 끝난 것으로 본다
      const late = serverNow() > cur.goAt + (END_AFTER_GO + 5) * 1000;
      const nobody = !cur.roster.some((r) => r.id && this.present.has(r.id));
      if (late || nobody) this.raceOver(cur.round);
      return;
    }
    if (this.isHost() && !this.starting && allReady(this.members)) void this.start();
  }

  /** 방장: 모두 레디하면 서버에서 GO 시각을 받아 시작을 알린다 */
  private async start() {
    this.starting = true;
    let wait = 0;
    try {
      const go = await this.api.go(this.key);
      this.lastGoAt = serverNow();
      if (this.left || this.current || !this.isHost() || !allReady(this.members)) return;
      const roster: RosterEntry[] = makeSeats(this.key, this.members).map((s) => ({ slot: s.slot, id: s.id, name: s.name, char: s.char }));
      const msg: StartMsg = { t: 'start', round: go.round, seed: this.fixedSeed ?? Math.floor(Math.random() * 0x7fffffff), readyAt: go.readyAt, goAt: go.goAt, roster };
      this.ch.send(msg);
      this.applyStart(msg, true);
    } catch (e) {
      if (!(e instanceof GoTooSoonError)) {
        console.warn('[시아레이스] GO 요청 실패', e);
        wait = 1000; // 바로 다시 두드리지 않게 잠깐 쉰다
      } else {
        // 서버가 '너무 빨리'라고 했다: 남은 시간(약 4초)만큼 기다렸다가 다시 묻는다.
        // 그동안 starting 을 유지해 다른 요청을 막고, 다시 물을 때 tick() 이 방 상태(방장·모두 레디·판 없음)를 새로 확인한다
        const left = this.lastGoAt ? this.lastGoAt + GO_GAP_MS - serverNow() : GO_GAP_MS;
        // 남은 시간을 모르거나(새로 들어옴) 계산이 어긋나면 4초를 통째로 기다린다 (짧은 간격으로 계속 두드리지 않게)
        wait = (left > 0 && left <= GO_GAP_MS ? left : GO_GAP_MS) + 300;
      }
    } finally {
      if (wait > 0 && !this.left) {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.starting = false;
          this.tick();
        }, wait);
      } else this.starting = false;
    }
  }

  isHost(): boolean {
    return hostOf(this.members) === this.me.id;
  }

  /** 자리가 없어서 달릴 수 없는가 (5번째로 들어옴) */
  isFull(): boolean {
    return !players(this.members).some((m) => m.id === this.me.id);
  }

  seats(): Seat[] {
    return makeSeats(this.key, this.members);
  }

  get char(): ZodiacId {
    return this.meta.char;
  }
  /** 내가 이 방에 들어온 시각 (서버 시각 ms) */
  get joinedAt(): number {
    return this.meta.at;
  }
  get ready(): boolean {
    return this.meta.ready;
  }

  /** 다른 사람이 이미 고른 캐릭터인가 */
  isTaken(c: ZodiacId): boolean {
    return this.members.some((m) => m.id !== this.me.id && m.char === c);
  }

  setChar(c: ZodiacId) {
    if (c === this.meta.char || this.isTaken(c)) return;
    this.update({ char: c, pickAt: serverNow() });
  }

  setReady(ready: boolean) {
    if (ready === this.meta.ready) return;
    this.update({ ready });
  }

  private update(patch: Partial<PlayerMeta>) {
    this.meta = { ...this.meta, ...patch };
    this.members = sortMembers(this.members.map((m) => (m.id === this.me.id ? { id: m.id, ...this.meta } : m)));
    void this.ch.track(this.meta);
    this.emit();
    this.tick();
  }

  private emit() {
    this.changeFns.forEach((f) => f());
  }

  /** 사람이 들고 나거나 캐릭터·레디가 바뀌면 */
  onChange(fn: () => void) {
    this.changeFns.add(fn);
    return () => this.changeFns.delete(fn);
  }
  /** 경기 시작 알림 */
  onStart(fn: (s: StartMsg) => void) {
    this.startFns.add(fn);
    return () => this.startFns.delete(fn);
  }
  /** 경기 중 메시지 (pos, takeover, end …) */
  onMsg(fn: (m: NetMsg) => void) {
    this.msgFns.add(fn);
    return () => this.msgFns.delete(fn);
  }

  send(m: NetMsg) {
    if (!this.left) this.ch.send(m);
  }

  /** 실시간 채널로 지금 받을 수 있는가 (다시 연결하는 중이면 false) */
  connected(): boolean {
    return !this.left && this.ch.connected();
  }

  async leave() {
    if (this.left) return;
    this.left = true;
    if (this.timer) clearInterval(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.changeFns.clear();
    this.msgFns.clear();
    this.startFns.clear();
    this.emoteFns.clear();
    await this.ch.leave().catch(() => undefined);
  }
}

import { END_AFTER_GO, type ZodiacId } from '../game/constants';
import { serverNow, type RaceApi } from './api';
import type { Channel, Member, NetMsg } from './channel';
import { allReady, hostOf, makeSeats, players, resolveChar, sortMembers, type MemberInfo, type PlayerMeta, type Seat } from './seats';

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
 * - Broadcast: 시작 알림(start), 경기 중 위치(pos) 등.
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

  constructor(
    private api: RaceApi,
    readonly key: string,
    readonly me: { id: string; name: string },
    char: ZodiacId,
  ) {
    this.meta = { name: me.name, char, ready: false, at: 0, pickAt: 0 };
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
      if (this.isHost() && m.from !== this.me.id) this.ch.send({ t: 'state', to: m.from, start: this.current });
    } else if (m.t === 'state') {
      // 늦게 들어왔으면 그 판에는 끼지 않고, 끝날 때까지 기다린다
      if (m.to === this.me.id && m.start && !this.current) this.applyStart(m.start as StartMsg, false);
    } else if (m.t === 'end') {
      if (this.current && m.round === this.current.round) this.raceOver(m.round);
    }
    this.msgFns.forEach((f) => f(m));
  }

  private applyStart(s: StartMsg, live: boolean) {
    if (!s || typeof s.round !== 'number' || !Array.isArray(s.roster)) return;
    if (this.current?.round === s.round || s.round === this.lastRound) return;
    // 이미 끝났을 시간이면 무시
    if (serverNow() > s.goAt + (END_AFTER_GO + 5) * 1000) return;
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
    try {
      const go = await this.api.go(this.key);
      if (this.left || this.current || !this.isHost() || !allReady(this.members)) return;
      const roster: RosterEntry[] = makeSeats(this.key, this.members).map((s) => ({ slot: s.slot, id: s.id, name: s.name, char: s.char }));
      const msg: StartMsg = { t: 'start', round: go.round, seed: Math.floor(Math.random() * 0x7fffffff), readyAt: go.readyAt, goAt: go.goAt, roster };
      this.ch.send(msg);
      this.applyStart(msg, true);
    } finally {
      this.starting = false;
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

  async leave() {
    if (this.left) return;
    this.left = true;
    if (this.timer) clearInterval(this.timer);
    this.changeFns.clear();
    this.msgFns.clear();
    this.startFns.clear();
    await this.ch.leave().catch(() => undefined);
  }
}

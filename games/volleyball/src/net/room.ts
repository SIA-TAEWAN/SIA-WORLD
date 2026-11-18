import { COUNTDOWN_SEC, type ZodiacId } from '../game/constants';
import { serverNow, type VolleyApi } from './api';
import type { Channel, Member, NetMsg } from './channel';
import { bothReady, cleanTitle, hostOf, players, roomTitle, seatOf, sortMembers, type MemberInfo, type PlayerMeta } from './seats';

/** 경기에 나서는 사람 (시작할 때 방장이 정해서 보낸다) */
export interface StartPlayer {
  id: string;
  name: string;
  char: ZodiacId;
}

/** 경기 시작 알림 */
export interface StartMsg {
  t: 'start';
  /** 경기 번호: 방장이 서버 시각(ms)으로 만든 숫자. 결과 저장 때 방 코드와 함께 이 경기를 가리킨다 */
  matchNo: number;
  /** 첫 서브를 정하는 시드 */
  seed: number;
  /** 배경 번호 0~2 */
  bg: number;
  /** 카운트다운이 끝나고 경기가 시작되는 시각 (서버 시각 ms) — 두 기기가 같은 순간에 시작한다 */
  startAt: number;
  /** [왼쪽(방장), 오른쪽] */
  players: [StartPlayer, StartPlayer];
}

/** 시작 알림이 두 기기에 닿을 시간 (ms). 그 뒤 3초 카운트다운 */
const LEAD_MS = 700;
/** 한 경기가 이보다 길어지면 끝난 것으로 본다 (끝 알림을 못 받았을 때) */
const MATCH_MAX_MS = 35 * 60 * 1000;

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
 * 게임방: 실시간 채널 하나 (방 코드마다). 시아레이스 RaceRoom 을 2인용으로 바꾼 것.
 * - Presence: 누가 있는지, 캐릭터, 레디, 방 이름. 가장 먼저 들어온 사람이 방장(왼쪽).
 * - Broadcast: 시작 알림(start) · 끝 알림(over) · 늦게 온 사람용(hello/state) · 경기 중 메시지(pos · snap · quit · end).
 */
export class VolleyRoom {
  private ch: Channel<PlayerMeta>;
  members: MemberInfo[] = [];
  readonly present = new Set<string>();
  private meta: PlayerMeta;
  private changeFns = new Set<() => void>();
  private msgFns = new Set<(m: NetMsg) => void>();
  private startFns = new Set<(s: StartMsg) => void>();
  private joined = false;
  private left = false;
  /** 지금 진행 중인 경기 (끝나면 null) */
  current: StartMsg | null = null;
  private lastNo = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: VolleyApi,
    readonly key: string,
    readonly me: { id: string; name: string },
    char: ZodiacId,
    title = '',
  ) {
    this.meta = { name: me.name, char, ready: false, at: 0, title: cleanTitle(title) };
    this.ch = api.channel<PlayerMeta>(`volley:${key}`, me.id);
    this.ch.onPresence((list) => this.onPresence(list));
    this.ch.onMessage((m) => this.onMessage(m));
  }

  async join() {
    if (this.joined) return;
    this.joined = true;
    await this.api.syncClock().catch(() => undefined);
    this.meta = { ...this.meta, at: serverNow() };
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
    this.emit();
    this.tick();
  }

  private onMessage(m: NetMsg) {
    if (this.left) return;
    if (m.t === 'start') this.applyStart(m as StartMsg, true);
    else if (m.t === 'hello') {
      // 방장이 답한다 (경기 중이면 그 경기 정보)
      if (this.isHost() && m.from !== this.me.id) this.ch.send({ t: 'state', to: m.from, start: this.current });
    } else if (m.t === 'state') {
      if (m.to === this.me.id && m.start && !this.current) this.applyStart(m.start as StartMsg, false);
    } else if (m.t === 'over') {
      // 경기하던 사람이 끝을 알림 (구경만 하던 사람도 대기 상태로 돌아간다)
      this.matchOver(Number(m.n), false);
    }
    this.msgFns.forEach((f) => f(m));
  }

  private applyStart(s: StartMsg, live: boolean) {
    if (!s || typeof s.matchNo !== 'number' || !Array.isArray(s.players) || s.players.length !== 2) return;
    if (this.current?.matchNo === s.matchNo || s.matchNo <= this.lastNo) return;
    if (serverNow() > s.startAt + MATCH_MAX_MS) return;
    this.current = s;
    this.lastNo = s.matchNo;
    if (this.meta.ready) this.setReady(false);
    this.emit();
    if (live && s.players.some((p) => p.id === this.me.id)) this.startFns.forEach((f) => f(s));
  }

  /** 경기가 끝났다 (결과가 정해졌다) */
  matchOver(matchNo: number, tell = true) {
    if (this.current?.matchNo !== matchNo) return;
    this.current = null;
    if (tell) this.ch.send({ t: 'over', n: matchNo });
    this.emit();
    this.tick();
  }

  private tick() {
    if (this.left) return;
    const cur = this.current;
    if (cur) {
      // 끝 알림을 못 받았어도: 너무 오래됐거나, 경기하던 사람이 아무도 없으면 끝난 것으로 본다
      const late = serverNow() > cur.startAt + MATCH_MAX_MS;
      const nobody = !cur.players.some((p) => this.present.has(p.id));
      if (late || nobody) this.matchOver(cur.matchNo, false);
      return;
    }
    if (this.isHost() && bothReady(this.members)) this.start();
  }

  /** 방장: 둘 다 레디하면 시작을 알린다 (3초 카운트다운 뒤 같은 순간에 시작) */
  private start() {
    const [l, r] = players(this.members);
    const now = serverNow();
    const msg: StartMsg = {
      t: 'start',
      matchNo: Math.max(Math.floor(now), this.lastNo + 1),
      seed: Math.floor(Math.random() * 0x7fffffff),
      bg: Math.floor(Math.random() * 3),
      startAt: Math.round(now + LEAD_MS + COUNTDOWN_SEC * 1000),
      players: [
        { id: l.id, name: l.name, char: l.char },
        { id: r.id, name: r.name, char: r.char },
      ],
    };
    this.ch.send(msg);
    this.applyStart(msg, true);
  }

  isHost(): boolean {
    return hostOf(this.members) === this.me.id;
  }
  /** 내 자리: 0 왼쪽(방장) · 1 오른쪽 · -1 자리 없음 */
  seat(): 0 | 1 | -1 {
    return seatOf(this.members, this.me.id);
  }
  /** 자리가 없는가 (세 번째로 들어옴) */
  isFull(): boolean {
    return this.seat() < 0;
  }
  /** [왼쪽, 오른쪽] (오른쪽이 비었으면 한 명만) */
  players(): MemberInfo[] {
    return players(this.members);
  }
  /** 상대 (없으면 undefined) */
  opponent(): MemberInfo | undefined {
    return this.players().find((m) => m.id !== this.me.id);
  }
  title(): string {
    return roomTitle(this.members);
  }

  get char(): ZodiacId {
    return this.meta.char;
  }
  /** 내가 방을 만들 때 적은 이름 */
  get myTitle(): string {
    return this.meta.title;
  }
  /** 내가 이 방에 들어온 시각 (서버 시각 ms) */
  get joinedAt(): number {
    return this.meta.at;
  }
  get ready(): boolean {
    return this.meta.ready;
  }

  /** 같은 캐릭터를 골라도 된다 (좌우는 이름표·테두리 색으로 구분) */
  setChar(c: ZodiacId) {
    if (c === this.meta.char) return;
    this.update({ char: c });
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
  /** 경기 시작 알림 (내가 나서는 경기만) */
  onStart(fn: (s: StartMsg) => void) {
    this.startFns.add(fn);
    return () => this.startFns.delete(fn);
  }
  /** 경기 중 메시지 (pos · snap · quit · end) */
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

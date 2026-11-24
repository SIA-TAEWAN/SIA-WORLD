import type { Backend, Channel, Member, NetMsg } from './backend';
import type { ChatMsg } from './lobby';
import { EMOTE_COOLDOWN_MS, EmoteGate, parseEmote } from '../game/emote';

/**
 * 이 기기의 판본. 기기끼리 주고받는 내용(새 탱크 등)이 바뀌면 올린다.
 * 방에 더 새 판본의 기기가 있으면 새로고침을 권한다 (예: 고양이 탱크를 모르는 예전 탭).
 * 1: 고양이(cat) 탱크 추가
 * 2: 서든데스 (30턴 뒤 물이 차오른다) — 방의 모든 기기가 2 이상일 때만 켠다
 */
export const CLIENT_VERSION = 2;
/** 서든데스를 아는 판본 */
export const SUDDEN_VERSION = 2;

/**
 * 이 사람들(ids)의 기기가 모두 need 판본 이상인가. 나(me)는 지금 판본이고,
 * 접속 정보가 안 보이거나 판본을 모르는(예전) 기기가 하나라도 있으면 false.
 * 판 규칙이 바뀌는 기능은 이걸로 켠다 — 예전 기기는 그 규칙을 계산하지 못해 화면이 어긋난다.
 */
export const allAtLeast = (ids: readonly string[], vers: ReadonlyMap<string, number>, me: string, need: number): boolean =>
  ids.every((id) => id === me || (vers.get(id) ?? 0) >= need);

export interface RoomMeta {
  name: string;
  /** 게임 중 화면을 가림 (기준 기기에서 빠진다) */
  away?: boolean;
  /** 기기 판본 (CLIENT_VERSION). 예전 기기에는 없다 */
  ver?: number;
  /** 게임방 화면(대기 중)을 보고 있음 — 숨은 탭·결과 화면·게임 중에는 없다. 예전 기기에는 없다 */
  watch?: boolean;
}

/**
 * 대기방에서 접속이 끊긴 사람을 빼는 일을 맡을 기기: 방 명단 순서로, 접속해 있고 방 화면을 보고 있는 첫 사람.
 * (예전에는 접속한 첫 사람이 맡아서, 결과 화면에 머물거나 숨은 아이폰 탭이 첫 자리면 아무도 빼지 않았다.)
 * 그런 사람이 없으면 null — 예전 판본 기기(watch 를 모른다)는 따로 자기 규칙대로 맡는다.
 */
export function roomSweeper(players: readonly string[], v: { me: string; meWatching: boolean; present: ReadonlySet<string>; watching: ReadonlySet<string> }): string | null {
  return players.find((id) => (id === v.me ? v.meWatching : v.present.has(id) && v.watching.has(id))) ?? null;
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
  /** 게임방 화면을 보고 있는 다른 사람 (meta.watch) */
  readonly watching = new Set<string>();
  private watchMe = false;
  /** 접속해 있는 다른 기기의 판본 (모르면 0) */
  readonly vers = new Map<string, number>();
  private msgFns = new Set<(m: NetMsg) => void>();
  private presFns = new Set<() => void>();
  private chatFns = new Set<() => void>();
  private emoteFns = new Set<(from: string, i: number) => void>();
  /** 감정 표현 보내기 간격 제한 (받는 쪽도 사람마다 같은 간격으로 거른다) */
  private emoteGate = new EmoteGate(EMOTE_COOLDOWN_MS - 100);
  private emoteSeen = new Map<string, EmoteGate>();
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
      if (m.t === 'emote') {
        // 빠른 감정 표현: 누가(from) 몇 번 문구(i)를 눌렀는지만 온다. 모르는 번호·너무 잦은 것은 버린다
        const i = parseEmote(m.i);
        const from = typeof m.from === 'string' ? m.from : '';
        if (i === null || !from || from === me.id) return;
        let gate = this.emoteSeen.get(from);
        if (!gate) this.emoteSeen.set(from, (gate = new EmoteGate(1000)));
        if (gate.try(Date.now())) this.emoteFns.forEach((f) => f(from, i));
        return;
      }
      this.msgFns.forEach((f) => f(m));
    });
    this.ch.onPresence((list: Member<RoomMeta>[]) => {
      const before = new Set(this.present);
      this.present.clear();
      this.away.clear();
      this.watching.clear();
      this.vers.clear();
      list.forEach((m) => {
        this.present.add(m.key);
        this.vers.set(m.key, typeof m.meta?.ver === 'number' ? m.meta.ver : 0);
        if (m.meta?.away && m.key !== me.id) this.away.add(m.key);
        if (m.meta?.watch && m.key !== me.id) this.watching.add(m.key);
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
    const m: RoomMeta = { name: this.me.name, ver: CLIENT_VERSION };
    if (this.awayMe) m.away = true;
    if (this.watchMe) m.watch = true;
    return m;
  }

  /** 내가 게임방 화면을 보고 있는가 */
  get meWatching() {
    return this.watchMe;
  }

  /** 게임방 화면을 보고 있다/아니다 (숨은 탭·결과 화면·게임 중이면 false). 접속 정보에 올린다 */
  async setWatching(watch: boolean) {
    if (this.watchMe === watch) return;
    this.watchMe = watch;
    if (this.joined) await this.ch.track(this.meta());
  }

  /** 대기방에서 접속이 끊긴 사람을 빼는 일을 내가 맡는가 (roomSweeper) */
  isSweeper(players: readonly string[]): boolean {
    return roomSweeper(players, { me: this.me.id, meWatching: this.watchMe, present: this.present, watching: this.watching }) === this.me.id;
  }

  /** 게임 중 화면을 가렸다/다시 본다 (접속 정보에 올린다) */
  async setAway(away: boolean) {
    if (this.awayMe === away) return;
    this.awayMe = away;
    if (this.joined) await this.ch.track(this.meta());
  }

  /** 이 사람들의 기기가 모두 need 판본 이상인가 (allAtLeast) */
  allAtLeast(ids: readonly string[], need: number): boolean {
    return allAtLeast(ids, this.vers, this.me.id, need);
  }

  /** 이 사람들 가운데 접속 정보가 아직 안 보이는 사람이 있는가 (막 들어왔거나 연결이 끊긴 사람 — 예전 판본과는 다르다) */
  anyUnseen(ids: readonly string[]): boolean {
    return ids.some((id) => id !== this.me.id && !this.vers.has(id));
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

  /** 빠른 감정 표현을 방 사람들에게 보낸다. 간격 제한에 걸리면 false (보내지 않는다) */
  sendEmote(i: number): boolean {
    if (parseEmote(i) === null || !this.emoteGate.try(Date.now())) return false;
    this.ch.send({ t: 'emote', from: this.me.id, i });
    return true;
  }

  /** 다른 사람의 감정 표현 (from = 보낸 사람 ID) */
  onEmote(fn: (from: string, i: number) => void) {
    this.emoteFns.add(fn);
    return () => this.emoteFns.delete(fn);
  }

  async leave() {
    this.msgFns.clear();
    this.presFns.clear();
    this.chatFns.clear();
    this.emoteFns.clear();
    this.reconnFns.clear();
    await this.ch.leave();
  }
}

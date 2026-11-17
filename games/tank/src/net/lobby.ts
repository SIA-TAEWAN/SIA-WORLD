import type { Backend, Channel, Member, Room, RoomPlayer } from './backend';

export const LOBBY_MAX = 30;

export interface LobbyMeta {
  name: string;
  /** 들어온 시각 (먼저 온 사람이 우선) */
  at: number;
  room: string | null;
}

export interface ChatMsg {
  name: string;
  text: string;
  at: number;
  system?: boolean;
}

export class LobbyFullError extends Error {}

/** 대기실 하나 = 실시간 채널 lobby:{코드}. 접속자 목록, 채팅, 게임방 목록 */
export class LobbySession {
  private ch: Channel<LobbyMeta>;
  members: Member<LobbyMeta>[] = [];
  rooms: Room[] = [];
  chat: ChatMsg[] = [];
  private meta: LobbyMeta;
  private listeners = new Set<() => void>();
  private unwatch: (() => void) | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private known = new Set<string>();

  constructor(
    readonly backend: Backend,
    readonly code: string,
    readonly me: { id: string; name: string },
  ) {
    this.meta = { name: me.name, at: Date.now(), room: null };
    this.ch = backend.channel<LobbyMeta>(`lobby:${code}`, me.id);
    this.ch.onPresence((list) => {
      const sorted = [...list].sort((a, b) => a.meta.at - b.meta.at || a.key.localeCompare(b.key));
      // 들고 나는 사람 알림
      const keys = new Set(sorted.map((m) => m.key));
      if (this.known.size) {
        for (const m of sorted) if (!this.known.has(m.key) && m.key !== me.id) this.system(`${m.meta.name} 님이 들어왔어요`);
        for (const k of this.known) if (!keys.has(k)) {
          const old = this.members.find((m) => m.key === k);
          if (old) this.system(`${old.meta.name} 님이 나갔어요`);
        }
      }
      this.known = keys;
      this.members = sorted;
      this.emit();
    });
    this.ch.onMessage((m) => {
      if (m.t === 'chat') {
        this.chat.push({ name: String(m.name).slice(0, 10), text: String(m.text).slice(0, 120), at: Date.now() });
        this.trimChat();
        this.emit();
      }
    });
  }

  private system(text: string) {
    this.chat.push({ name: '', text, at: Date.now(), system: true });
    this.trimChat();
  }

  private trimChat() {
    if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
  }

  /** 들어가서 정원(30명)을 확인한다 (사람은 계정 ID로 구분하므로 이름 중복은 없다) */
  async enter() {
    await this.ch.join(this.meta);
    // 다른 사람 정보가 도착할 시간을 잠깐 준다
    await new Promise((r) => setTimeout(r, 900));
    const idx = this.members.findIndex((m) => m.key === this.me.id);
    if (idx >= LOBBY_MAX) {
      await this.ch.leave();
      throw new LobbyFullError();
    }
    this.system(`대기실에 들어왔어요 (${this.code === 'main' ? '기본 대기실' : this.code})`);
    this.unwatch = this.backend.watchRooms(this.code, () => this.refetchSoon());
    this.poll = setInterval(() => this.refetch(), 8000);
    await this.refetch();
  }

  private refetchSoon() {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => this.refetch(), 120);
  }

  private lastSweep = 0;

  async refetch() {
    // 오래 비어 있는 방은 가끔 서버에서 정리한다
    if (Date.now() - this.lastSweep > 30_000) {
      this.lastSweep = Date.now();
      await this.backend.sweepRooms(this.code).catch(() => undefined);
    }
    try {
      this.rooms = await this.backend.listRooms(this.code);
      this.emit();
    } catch {
      /* 다음 갱신 때 다시 */
    }
  }

  /** 그 방에 아직 들어가 있는 사람이 하나도 없는 방(모두 나갔거나 브라우저를 닫은 경우)은 숨긴다 */
  visibleRooms(): Room[] {
    const inRoom = new Map(this.members.map((m) => [m.key, m.meta.room]));
    return this.rooms.filter((r) => r.players.some((p) => inRoom.get(p.id) === r.id && !(r.gone ?? []).includes(p.id)));
  }

  room(id: string): Room | undefined {
    return this.rooms.find((r) => r.id === id);
  }

  myRoom(): Room | undefined {
    return this.meta.room ? this.room(this.meta.room) : undefined;
  }

  async setMyRoom(id: string | null) {
    this.meta = { ...this.meta, room: id };
    await this.ch.track(this.meta);
  }

  async createRoom(player: RoomPlayer): Promise<Room> {
    const r = await this.backend.createRoom(this.code, `${this.me.name}의 방`, player);
    await this.setMyRoom(r.id);
    await this.refetch();
    return r;
  }

  async joinRoom(id: string, player: RoomPlayer): Promise<Room> {
    const r = await this.backend.joinRoom(id, player);
    await this.setMyRoom(r.id);
    await this.refetch();
    return r;
  }

  async leaveRoom() {
    const id = this.meta.room;
    if (!id) return;
    await this.setMyRoom(null);
    await this.backend.leaveRoom(id, this.me.id).catch(() => undefined);
    await this.refetch();
  }

  sendChat(text: string) {
    const t = text.trim().slice(0, 120);
    if (!t) return;
    this.ch.send({ t: 'chat', name: this.me.name, text: t });
    this.chat.push({ name: this.me.name, text: t, at: Date.now() });
    this.trimChat();
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }

  async leave() {
    await this.leaveRoom();
    this.unwatch?.();
    if (this.poll) clearInterval(this.poll);
    this.listeners.clear();
    await this.ch.leave();
  }
}

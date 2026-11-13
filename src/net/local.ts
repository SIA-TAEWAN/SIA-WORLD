import { allReady, hostOf, type Backend, type Channel, type Member, type NetMsg, type Room, type RoomPlayer } from './backend';

/**
 * 서버 없이 같은 브라우저의 탭끼리 통신하는 테스트용 백엔드.
 * Supabase와 같은 규칙(supabase/migrations/001_rooms.sql)을 흉내 낸다.
 * 주소에 ?local=1 을 붙이면 쓴다.
 */
const DB_KEY = 'siatank:localdb';
const HEARTBEAT = 1000;
const TIMEOUT = 3500;

class LocalChannel<M> implements Channel<M> {
  private bc: BroadcastChannel;
  private members = new Map<string, { meta: M; seen: number }>();
  private presenceCbs: ((m: Member<M>[]) => void)[] = [];
  private msgCbs: ((m: NetMsg) => void)[] = [];
  private meta: M | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    name: string,
    private key: string,
  ) {
    this.bc = new BroadcastChannel(`siatank:${name}`);
    this.bc.onmessage = (e) => this.handle(e.data);
  }

  private handle(d: { k: string; type: string; meta?: M; msg?: NetMsg }) {
    if (d.type === 'hb' || d.type === 'hello') {
      const isNew = !this.members.has(d.k);
      this.members.set(d.k, { meta: d.meta!, seen: Date.now() });
      if (d.type === 'hello' && this.meta) this.bc.postMessage({ k: this.key, type: 'hb', meta: this.meta });
      if (isNew || d.type === 'hello') this.emitPresence();
      else this.emitPresenceIfChanged(d.k, d.meta!);
    } else if (d.type === 'bye') {
      if (this.members.delete(d.k)) this.emitPresence();
    } else if (d.type === 'msg') {
      this.msgCbs.forEach((cb) => cb(d.msg!));
    }
  }

  private lastJson = new Map<string, string>();
  private emitPresenceIfChanged(k: string, meta: M) {
    const j = JSON.stringify(meta);
    if (this.lastJson.get(k) !== j) {
      this.lastJson.set(k, j);
      this.emitPresence();
    }
  }

  private emitPresence() {
    const list: Member<M>[] = [...this.members].map(([key, v]) => ({ key, meta: v.meta }));
    if (this.meta) list.push({ key: this.key, meta: this.meta });
    list.forEach((m) => this.lastJson.set(m.key, JSON.stringify(m.meta)));
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
      let changed = false;
      for (const [k, v] of this.members) {
        if (now - v.seen > TIMEOUT) {
          this.members.delete(k);
          changed = true;
        }
      }
      if (changed) this.emitPresence();
    }, HEARTBEAT);
    await new Promise((r) => setTimeout(r, 250));
    this.emitPresence();
  }

  async track(meta: M) {
    this.meta = meta;
    this.bc.postMessage({ k: this.key, type: 'hb', meta });
    this.emitPresence();
  }

  send(msg: NetMsg) {
    this.bc.postMessage({ k: this.key, type: 'msg', msg });
  }

  async leave() {
    if (this.timer) clearInterval(this.timer);
    this.bc.postMessage({ k: this.key, type: 'bye' });
    this.bc.close();
    this.presenceCbs = [];
    this.msgCbs = [];
  }
}

function readDb(): Room[] {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY) ?? '[]') as Room[];
  } catch {
    return [];
  }
}

const dbBus = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('siatank:db') : null;
const dbListeners = new Set<() => void>();
dbBus?.addEventListener('message', () => dbListeners.forEach((l) => l()));

function writeDb(rooms: Room[]) {
  localStorage.setItem(DB_KEY, JSON.stringify(rooms));
  dbBus?.postMessage('changed');
  // 같은 탭에도 알림
  setTimeout(() => dbListeners.forEach((l) => l()), 0);
}

type LocalRoom = Room;

function mutate<T>(fn: (rooms: LocalRoom[]) => T): T {
  const rooms = readDb();
  const out = fn(rooms);
  writeDb(rooms);
  return out;
}

function readPoints(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('siatank:localpoints') ?? '{}');
  } catch {
    return {};
  }
}

const fail = (m: string): never => {
  throw new Error(m);
};

const clean = (p: RoomPlayer): RoomPlayer => ({ id: p.id, name: p.name, tank: p.tank, team: p.team === 1 ? 1 : 0, items: [...p.items].slice(0, 3), ready: !!p.ready });

export function createLocalBackend(): Backend {
  return {
    kind: 'local',
    channel: <M>(name: string, key: string) => new LocalChannel<M>(name, key),
    async listRooms(lobby) {
      return readDb().filter((r) => r.lobby === lobby);
    },
    watchRooms(_lobby, cb) {
      dbListeners.add(cb);
      return () => dbListeners.delete(cb);
    },
    async createRoom(lobby, name, player) {
      return mutate((rooms) => {
        const r: LocalRoom = {
          id: crypto.randomUUID(),
          lobby,
          name: name.slice(0, 24),
          map: 'random',
          status: 'waiting',
          players: [{ ...clean(player), team: 0, ready: false }],
          seed: null,
          host_id: player.id,
          game_no: 0,
          created_at: new Date().toISOString(),
          updated_at: Date.now(),
        };
        rooms.push(r);
        return r;
      });
    },
    async joinRoom(id, player) {
      return mutate((rooms) => {
        const r = rooms.find((x) => x.id === id) ?? fail('room not found');
        if (r.players.some((p) => p.id === player.id)) return r;
        if (r.status !== 'waiting') fail('room is playing');
        if (r.players.length >= 4) fail('room is full');
        const a = r.players.filter((p) => p.team === 0).length;
        const b = r.players.length - a;
        r.host_id = hostOf(r) ?? null;
        r.players.push({ ...clean(player), team: a <= b ? 0 : 1, ready: false });
        return r;
      });
    },
    async leaveRoom(id, playerId) {
      mutate((rooms) => {
        const i = rooms.findIndex((x) => x.id === id);
        if (i < 0 || rooms[i].status === 'playing') return;
        const h = hostOf(rooms[i]);
        rooms[i].players = rooms[i].players.filter((p) => p.id !== playerId);
        rooms[i].host_id = h === playerId ? (rooms[i].players[0]?.id ?? null) : (h ?? null);
        if (!rooms[i].players.length) rooms.splice(i, 1);
      });
    },
    async updatePlayer(id, player) {
      mutate((rooms) => {
        const r = rooms.find((x) => x.id === id);
        if (!r || r.status !== 'waiting') return;
        const p2 = clean(player);
        if (p2.id === hostOf(r)) p2.ready = false;
        r.players = r.players.map((p) => (p.id === player.id ? p2 : p));
      });
    },
    async setMap(id, playerId, map) {
      mutate((rooms) => {
        const r = rooms.find((x) => x.id === id);
        if (!r || r.status !== 'waiting') return;
        if (hostOf(r) !== playerId) fail('not host');
        r.map = map;
      });
    },
    async setOptions(id, playerId, speed, wind) {
      mutate((rooms) => {
        const r = rooms.find((x) => x.id === id);
        if (!r || r.status !== 'waiting') return;
        if (hostOf(r) !== playerId) fail('not host');
        r.speed = speed === 1.5 ? 1.5 : 1;
        r.wind = wind;
      });
    },
    async startGame(id, host, seed) {
      return mutate((rooms) => {
        const r = rooms.find((x) => x.id === id) ?? fail('room not found');
        if (r.status !== 'waiting') fail('already playing');
        const a = r.players.filter((p) => p.team === 0).length;
        if (r.players.length < 2) fail('need 2 players');
        if (hostOf(r) !== host) fail('not host');
        if (a === 0 || a === r.players.length) fail('teams');
        if (!allReady(r)) fail('not ready');
        r.status = 'playing';
        r.gone = [];
        r.updated_at = Date.now();
        r.seed = seed;
        r.host_id = host;
        r.game_no++;
        return r;
      });
    },
    async getPoints(name) {
      return readPoints()[name] ?? 1000;
    },
    async endGame(id, gameNo, present, winner) {
      mutate((rooms) => {
        const i = rooms.findIndex((x) => x.id === id);
        if (i < 0) return;
        const r = rooms[i];
        if (r.status !== 'playing' || r.game_no !== gameNo) return;
        if (winner === 0 || winner === 1) {
          const pts = readPoints();
          for (const p of r.players) pts[p.name] = Math.max(1000, (pts[p.name] ?? 1000) + (p.team === winner ? 100 : -100));
          localStorage.setItem('siatank:localpoints', JSON.stringify(pts));
        }
        r.players = r.players.filter((p) => present.includes(p.id) && !(r.gone ?? []).includes(p.id)).map((p) => ({ ...p, items: [], ready: false }));
        r.gone = [];
        if (!r.players.some((p) => p.id === r.host_id)) r.host_id = r.players[0]?.id ?? null;
        r.status = 'waiting';
        if (!r.players.length) rooms.splice(i, 1);
      });
    },
    async quitGame(id, playerId) {
      const r0 = readDb().find((x) => x.id === id);
      if (r0 && r0.status !== 'playing') return this.leaveRoom(id, playerId);
      mutate((rooms) => {
        const i = rooms.findIndex((x) => x.id === id);
        if (i < 0 || !rooms[i].players.some((p) => p.id === playerId)) return;
        const r = rooms[i];
        r.gone = [...new Set([...(r.gone ?? []), playerId])];
        if (r.players.every((p) => r.gone!.includes(p.id))) rooms.splice(i, 1);
        else r.updated_at = Date.now();
      });
    },
    async touchRoom(id, playerId) {
      mutate((rooms) => {
        const r = rooms.find((x) => x.id === id);
        if (r && r.players.some((p) => p.id === playerId)) r.updated_at = Date.now();
      });
    },
    async sweepRooms() {
      const now = Date.now();
      mutate((rooms) => {
        for (let i = rooms.length - 1; i >= 0; i--) {
          const r = rooms[i];
          r.updated_at ??= now;
          if (now - Number(r.updated_at) > 120_000) rooms.splice(i, 1);
        }
      });
    },
  };
}

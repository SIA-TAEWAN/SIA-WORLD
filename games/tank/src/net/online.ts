import type { Match, MatchSnapshot } from '../game/match';
import type { NetMsg, Room } from './backend';
import { BACKUP_OVERDUE, type LiveState, type NetHooks, type SceneApi, type TurnRecord } from './protocol';
import type { RoomSession } from './room';

export const DISCONNECT_GRACE = 30;
/** 화면을 이만큼 넘게 가리면 자리 비움(away)으로 알리고, 돌아오면 판 상태를 다시 받는다 */
export const AWAY_AFTER_MS = 2000;

export interface HostView {
  me: string;
  /** 내 화면이 가려져 있는가 */
  meAway: boolean;
  present: ReadonlySet<string>;
  away: ReadonlySet<string>;
  taken: ReadonlySet<string>;
}

/**
 * 기준 기기 후보를 순서대로 (첫째 = 기준 기기, 둘째 = 기준 기기가 멈췄을 때 대신할 기기).
 * 접속해 있고 화면을 보고 있는 기기만 고른다. 모두 화면을 가렸으면 접속해 있는 기기 중에서.
 */
export function hostCandidates(order: readonly string[], v: HostView): string[] {
  const live = order.filter((id) => !v.taken.has(id) && (id === v.me || v.present.has(id)));
  const active = live.filter((id) => !(id === v.me ? v.meAway : v.away.has(id)));
  if (active.length) return active;
  return live.length ? live : [v.me];
}

/** 자리를 비우거나 끊긴 기기는 순서 맨 뒤로 (돌아와도 기준 기기 자리를 다시 빼앗지 않게) */
export function demote(order: readonly string[], id: string): string[] {
  if (!order.includes(id) || order[order.length - 1] === id) return [...order];
  return [...order.filter((x) => x !== id), id];
}

/** 다른 기기가 보낸 순서를 받아들인다 (모르는 사람은 빼고, 빠진 사람은 뒤에 붙인다) */
export function adoptOrder(mine: readonly string[], theirs: unknown): string[] {
  if (!Array.isArray(theirs)) return [...mine];
  const known = new Set(mine);
  const out = [...new Set(theirs.filter((x): x is string => typeof x === 'string' && known.has(x)))];
  for (const id of mine) if (!out.includes(id)) out.push(id);
  return out;
}

interface SnapReply {
  snap: MatchSnapshot;
  records: TurnRecord[];
  elapsed: number;
}

/**
 * 온라인 대전 한 판의 동기화.
 * - 턴마다 이동 기록·발사 입력만 주고받고, 모든 기기가 같은 물리로 계산한다.
 * - 기준 기기(host)는 턴 결과 지문을 보내고, 다른 기기는 자기 지문과 다르면 전체 상태를 받아 맞춘다.
 * - 접속이 끊기면 30초 기다린 뒤 기준 기기가 그 탱크를 AI로 넘긴다.
 * - 화면을 가린 기기(다른 탭·창 내리기)는 Phaser가 멈추므로 자리 비움(away)으로 알리고 기준 기기에서 빠진다.
 *   자리를 비우거나 끊긴 기기는 순서 맨 뒤로 가고, 돌아오면 판 상태를 다시 받은 뒤에야 움직인다.
 * - sync·snap·takeover·AI 턴 기록은 기준 기기(또는 바뀌는 순간의 다음 후보)가 보낸 것만 받는다.
 */
export class OnlineGame implements NetHooks {
  readonly myIdx: number;
  readonly gameNo: number;
  private ids: string[];
  private hostOrder: string[];
  private scene: SceneApi | null = null;
  private records = new Map<number, TurnRecord>();
  private myHashes = new Map<number, string>();
  private hostHashes = new Map<number, string>();
  private lastSnap: { snap: MatchSnapshot; at: number } | null = null;
  private takenOver = new Set<string>();
  private goneAt = new Map<string, number>();
  private lastSnapReq = 0;
  private timer: ReturnType<typeof setInterval>;
  private off: (() => void)[] = [];
  private waitingSnap: ((r: SnapReply | 'denied') => void) | null = null;
  /** 지난번에 화면을 보고 있던(접속 + away 아님) 다른 기기 */
  private wasActive: Set<string>;
  /** 내 화면이 가려져 있다고 알렸는가 */
  private away = false;
  private hiddenAt = 0;
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  /** 돌아와서 판 상태를 다시 받는 중 (그동안 화면 진행·전송을 멈춘다) */
  private resyncing = false;
  private kicked = false;
  private disposed = false;
  private onKicked: (() => void) | null = null;
  desyncs = 0;

  constructor(
    private session: RoomSession,
    room: Room,
    private me: string,
  ) {
    this.ids = room.players.map((p) => p.id);
    this.myIdx = this.ids.indexOf(me);
    this.gameNo = room.game_no;
    this.hostOrder = [...new Set([room.host_id ?? this.ids[0], ...this.ids])];
    this.off.push(session.on((m) => this.onMsg(m)));
    this.off.push(session.onPresence(() => this.onPresence()));
    this.timer = setInterval(() => this.tick(), 500);
    this.wasActive = this.activeIds();
    if (typeof document !== 'undefined') {
      const onVis = () => this.onVisibility(document.hidden);
      document.addEventListener('visibilitychange', onVis);
      this.off.push(() => document.removeEventListener('visibilitychange', onVis));
      // 화면을 가린 채로 시작했으면(새로고침 직후 다른 탭) 바로 자리 비움 준비
      if (document.hidden) this.onVisibility(true);
    }
  }

  /** 지금 기준 기기인가 (끊기거나 화면을 가리면 다음 사람이 이어받는다) */
  isHost(): boolean {
    return this.currentHost() === this.me;
  }

  /** 기준 기기가 멈췄을 때 대신 턴을 넘길 기기인가 (후보 둘째) */
  isBackup(): boolean {
    return this.candidates()[1] === this.me;
  }

  /** 판 상태를 다시 받는 중이면 게임 화면은 진행하지 않는다 */
  frozen(): boolean {
    return this.resyncing || this.kicked;
  }

  /** 기준 기기만 보내는 것(sync·snap·takeover·AI 턴)을 믿을 수 있는 보낸 사람인가 */
  trusted(from?: string): boolean {
    if (from === undefined) return true;
    const c = this.candidates();
    // 기준 기기가 바뀌는 순간이나 대신 넘길 때는 둘째 후보가 보낸 것도 받는다
    return from === c[0] || from === c[1];
  }

  private candidates(): string[] {
    return hostCandidates(this.hostOrder, { me: this.me, meAway: this.away, present: this.session.present, away: this.session.away, taken: this.takenOver });
  }

  private currentHost(): string {
    return this.candidates()[0];
  }

  private activeIds(): Set<string> {
    return new Set(this.ids.filter((id) => id !== this.me && this.session.present.has(id) && !this.session.away.has(id)));
  }

  private onPresence() {
    // 화면을 가렸거나 끊긴 기기는 순서 맨 뒤로
    const now = this.activeIds();
    for (const id of this.wasActive) if (!now.has(id)) this.hostOrder = demote(this.hostOrder, id);
    this.wasActive = now;
    this.tick();
  }

  /** 화면이 가려지면 잠시 뒤 자리 비움으로 알리고, 돌아오면 판 상태를 다시 받는다 */
  private onVisibility(hidden: boolean) {
    if (this.kicked || this.disposed) return;
    if (hidden) {
      this.hiddenAt = Date.now();
      if (this.awayTimer) clearTimeout(this.awayTimer);
      this.awayTimer = setTimeout(() => this.goAway(), AWAY_AFTER_MS);
      return;
    }
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.awayTimer = null;
    // 아이폰은 잠그는 순간 타이머가 멈춰 away를 못 보낼 수 있어 가려져 있던 시간으로도 판단한다
    const long = this.hiddenAt > 0 && Date.now() - this.hiddenAt >= AWAY_AFTER_MS;
    this.hiddenAt = 0;
    if (!this.scene) {
      // 아직 게임 화면 전(재접속 중)이면 판 상태는 resume()이 받아오므로 자리 비움만 푼다
      if (this.away) {
        this.away = false;
        void this.session.setAway(false).catch(() => undefined);
      }
      return;
    }
    if (this.away || long) void this.rejoin();
  }

  private goAway() {
    this.awayTimer = null;
    if (this.away || this.kicked || this.disposed) return;
    this.away = true;
    this.hostOrder = demote(this.hostOrder, this.me);
    void this.session.setAway(true).catch(() => undefined);
  }

  /** 돌아왔다: 기준 기기의 판 상태로 맞춘 뒤에야 다시 움직이고 away를 푼다 */
  private async rejoin() {
    if (this.resyncing) return;
    this.resyncing = true;
    if (!this.away) {
      this.away = true;
      this.hostOrder = demote(this.hostOrder, this.me);
    }
    const r = await this.resume(10000);
    if (this.disposed || this.kicked) return;
    if (r === 'denied') return this.kick();
    if (r !== 'timeout' && this.scene) {
      this.myHashes.clear();
      this.scene.loadSnapshot(r.snap, r.records, r.elapsed);
    }
    // 아무도 답하지 않으면(혼자 남았거나 판이 끝남) 가진 상태로 이어 간다
    this.resyncing = false;
    this.away = false;
    void this.session.setAway(false).catch(() => undefined);
  }

  /** 내 탱크를 AI가 넘겨받았을 때 (자리를 오래 비움) → 화면이 판에서 나간다. 이미 그랬으면 바로 부른다 */
  whenKicked(fn: () => void) {
    this.onKicked = fn;
    if (this.kicked && !this.disposed) fn();
  }

  private kick() {
    if (this.kicked || this.disposed) return;
    this.kicked = true;
    this.resyncing = false;
    this.onKicked?.();
  }

  attach(scene: SceneApi) {
    this.scene = scene;
    // 게임을 불러오는 동안 도착한 턴 기록을 넘겨준다
    for (const r of this.records.values()) scene.onRemoteTurn(r);
    this.tick();
  }

  private send(m: NetMsg) {
    this.session.send({ ...m, g: this.gameNo });
  }

  /** 화면을 가렸거나 다시 맞추는 중이면 보내지 않는다 (오래된 상태로 남을 되돌리지 않게) */
  private get stale() {
    return this.away || this.resyncing || this.kicked;
  }

  sendLive(l: LiveState) {
    if (this.stale) return;
    this.send({ t: 'live', l });
  }

  sendTurn(r: TurnRecord) {
    if (this.stale) return;
    const rec: TurnRecord = { ...r, from: this.me };
    this.records.set(rec.turn, rec);
    this.send({ t: 'turn', r: rec });
  }

  turnStarted(m: Match) {
    this.lastSnap = { snap: m.snapshot(), at: Date.now() };
    // 오래된 기록 정리
    for (const k of this.records.keys()) if (k < m.turn - 2) this.records.delete(k);
  }

  turnDone(turn: number, hash: string) {
    this.myHashes.set(turn, hash);
    if (this.stale) return;
    // 넘겨받은 탱크 목록도 함께 보낸다 (오래 자리를 비웠다 돌아온 기기가 알 수 있게)
    if (this.isHost()) this.send({ t: 'sync', turn, hash, from: this.me, taken: [...this.takenOver] });
    else this.compare(turn);
  }

  private compare(turn: number) {
    const mine = this.myHashes.get(turn);
    const host = this.hostHashes.get(turn);
    if (mine === undefined || host === undefined || mine === host) return;
    this.desyncs++;
    console.warn(`[시아탱크] ${turn}턴 화면이 기준 기기와 달라 다시 맞춥니다`);
    this.requestSnap();
  }

  private requestSnap() {
    const now = Date.now();
    if (now - this.lastSnapReq < 2500) return;
    this.lastSnapReq = now;
    this.send({ t: 'snapreq', from: this.me });
  }

  /** 재접속: 기준 기기에게 판 상태를 받아온다 */
  resume(timeoutMs = 15000): Promise<SnapReply | 'denied' | 'timeout'> {
    return new Promise((resolve) => {
      const iv = setInterval(() => {
        this.lastSnapReq = 0;
        this.requestSnap();
      }, 1500);
      const to = setTimeout(() => {
        clearInterval(iv);
        this.waitingSnap = null;
        resolve('timeout');
      }, timeoutMs);
      this.waitingSnap = (r) => {
        clearInterval(iv);
        clearTimeout(to);
        this.waitingSnap = null;
        resolve(r);
      };
      this.lastSnapReq = 0;
      this.requestSnap();
    });
  }

  private onMsg(m: NetMsg) {
    if (m.g !== this.gameNo) return;
    switch (m.t) {
      case 'live':
        this.scene?.onRemoteLive(m.l as LiveState);
        break;
      case 'turn': {
        const r = m.r as TurnRecord;
        this.records.set(r.turn, r);
        this.scene?.onRemoteTurn(r);
        break;
      }
      case 'sync':
        // 넘겨받은 탱크는 늘어나기만 하므로 누가 보냈든 합친다 (내가 들어 있으면 판에서 나간다)
        this.mergeTaken(m.taken);
        if (m.from === this.me || !this.trusted(m.from)) break;
        this.hostHashes.set(m.turn, m.hash);
        this.compare(m.turn);
        break;
      case 'snapreq': {
        if (!this.isHost() || m.from === this.me || this.stale) break;
        if (this.takenOver.has(m.from)) {
          this.send({ t: 'snap', to: m.from, from: this.me, denied: true });
          break;
        }
        const s = this.lastSnap;
        if (!s) break;
        const rec = this.records.get(s.snap.turn);
        this.send({ t: 'snap', to: m.from, from: this.me, order: this.hostOrder, taken: [...this.takenOver], snap: s.snap, records: rec ? [rec] : [], elapsed: (Date.now() - s.at) / 1000 });
        break;
      }
      case 'snap': {
        if (m.to !== this.me) break;
        if (m.denied) {
          // 다시 들어오려다 거절됐거나, 판 중간에 거절됐으면(내 탱크를 AI가 넘겨받음) 판에서 나간다
          if (this.waitingSnap) this.waitingSnap('denied');
          else this.kick();
          break;
        }
        const reply: SnapReply = { snap: m.snap, records: m.records ?? [], elapsed: m.elapsed ?? 0 };
        if (this.waitingSnap) {
          // 내가 청한 답: 보낸 기기가 아는 순서·넘겨받은 목록으로 맞춘다
          this.hostOrder = adoptOrder(this.hostOrder, m.order);
          this.mergeTaken(m.taken, false);
          this.waitingSnap(reply);
        } else if (this.scene && !this.stale && this.trusted(m.from)) {
          this.myHashes.clear();
          this.scene.loadSnapshot(reply.snap, reply.records, reply.elapsed);
        }
        break;
      }
      case 'takeover':
        if (m.id === this.me) this.kick();
        else if (this.trusted(m.from)) this.applyTakeover(m.id);
        break;
    }
  }

  private mergeTaken(list: unknown, kickMe = true) {
    if (!Array.isArray(list)) return;
    for (const id of list) {
      if (typeof id !== 'string' || !this.ids.includes(id)) continue;
      if (id !== this.me) this.applyTakeover(id);
      else if (kickMe) this.kick();
    }
  }

  private applyTakeover(id: string) {
    if (this.takenOver.has(id)) return;
    this.takenOver.add(id);
    this.goneAt.delete(id);
    const idx = this.ids.indexOf(id);
    if (idx >= 0) this.scene?.takeover(idx);
  }

  /** 접속 끊김 확인 (0.5초마다) */
  private tick() {
    if (!this.scene) return;
    const now = Date.now();
    const match = this.scene.matchState;
    this.ids.forEach((id, idx) => {
      if (id === this.me || this.takenOver.has(id)) return;
      const tank = match.tanks[idx];
      if (this.session.present.has(id) || !tank?.alive) {
        if (this.goneAt.delete(id)) this.scene!.setConn(idx, null);
        return;
      }
      if (!this.goneAt.has(id)) this.goneAt.set(id, now);
      const left = Math.ceil(DISCONNECT_GRACE - (now - this.goneAt.get(id)!) / 1000);
      if (left > 0) this.scene!.setConn(idx, `연결 끊김 ${left}초`);
      // 기준 기기가 멈춰 있으면 BACKUP_OVERDUE초 더 기다렸다 다음 후보가 넘긴다
      else if (!this.stale && (this.isHost() || (left <= -BACKUP_OVERDUE && this.isBackup()))) {
        this.send({ t: 'takeover', id, from: this.me });
        this.applyTakeover(id);
      }
    });
  }

  presentIds(): string[] {
    return this.ids.filter((id) => id === this.me || this.session.present.has(id));
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.onKicked = null;
    // 게임방 채널은 대기방에서도 쓰므로 자리 비움 표시를 지운다
    void this.session.setAway(false).catch(() => undefined);
    this.off.forEach((f) => f());
    this.scene = null;
  }
}

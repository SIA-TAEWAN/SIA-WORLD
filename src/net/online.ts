import type { Match, MatchSnapshot } from '../game/match';
import type { NetMsg, Room } from './backend';
import type { LiveState, NetHooks, SceneApi, TurnRecord } from './protocol';
import type { RoomSession } from './room';

export const DISCONNECT_GRACE = 30;

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
    this.off.push(session.onPresence(() => this.tick()));
    this.timer = setInterval(() => this.tick(), 500);
  }

  /** 지금 기준 기기인가 (끊기면 다음 사람이 이어받는다) */
  isHost(): boolean {
    return this.currentHost() === this.me;
  }

  private currentHost(): string {
    for (const id of this.hostOrder) {
      if (this.takenOver.has(id)) continue;
      if (id === this.me || this.session.present.has(id)) return id;
    }
    return this.me;
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

  sendLive(l: LiveState) {
    this.send({ t: 'live', l });
  }

  sendTurn(r: TurnRecord) {
    this.records.set(r.turn, r);
    this.send({ t: 'turn', r });
  }

  turnStarted(m: Match) {
    this.lastSnap = { snap: m.snapshot(), at: Date.now() };
    // 오래된 기록 정리
    for (const k of this.records.keys()) if (k < m.turn - 2) this.records.delete(k);
  }

  turnDone(turn: number, hash: string) {
    this.myHashes.set(turn, hash);
    if (this.isHost()) this.send({ t: 'sync', turn, hash });
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
        this.hostHashes.set(m.turn, m.hash);
        this.compare(m.turn);
        break;
      case 'snapreq': {
        if (!this.isHost() || m.from === this.me) break;
        if (this.takenOver.has(m.from)) {
          this.send({ t: 'snap', to: m.from, denied: true });
          break;
        }
        const s = this.lastSnap;
        if (!s) break;
        const rec = this.records.get(s.snap.turn);
        this.send({ t: 'snap', to: m.from, snap: s.snap, records: rec ? [rec] : [], elapsed: (Date.now() - s.at) / 1000 });
        break;
      }
      case 'snap': {
        if (m.to !== this.me) break;
        if (m.denied) {
          this.waitingSnap?.('denied');
          break;
        }
        const reply: SnapReply = { snap: m.snap, records: m.records ?? [], elapsed: m.elapsed ?? 0 };
        if (this.waitingSnap) this.waitingSnap(reply);
        else if (this.scene) {
          this.myHashes.clear();
          this.scene.loadSnapshot(reply.snap, reply.records, reply.elapsed);
        }
        break;
      }
      case 'takeover':
        this.applyTakeover(m.id);
        break;
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
      else if (this.isHost()) {
        this.send({ t: 'takeover', id });
        this.applyTakeover(id);
      }
    });
  }

  presentIds(): string[] {
    return this.ids.filter((id) => id === this.me || this.session.present.has(id));
  }

  dispose() {
    clearInterval(this.timer);
    this.off.forEach((f) => f());
    this.scene = null;
  }
}

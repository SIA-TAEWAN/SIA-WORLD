import { STEP_MS } from '../game/constants';
import { setPlayer, step, type Input, type Side, type SimEvent } from '../game/sim';
import {
  POS_EVERY, REPREDICT_MAX, SNAP_DIST, SNAP_EVERY, carryOffset, decayOffset, extrapolatePlayer, linkState, makeSnapshot, repredict, snapshotEvents, validSnapshot,
  type OwnFrame, type PlayerPacket, type Pos, type Snapshot,
} from '../game/sync';
import type { NetMsg } from '../net/channel';
import { Match, type MatchSetup } from './game';

/** 방 채널에서 경기가 쓰는 부분 */
export interface NetLink {
  send(m: NetMsg): void;
  onMsg(fn: (m: NetMsg) => void): () => void;
}

/** 한 번에 따라잡는 틱 한도 (탭을 내려 두었다 돌아온 경우: 10초) */
const CATCH_UP_MAX = 600;
/** 기다리는 동안 '나 여기 있어요' 소식을 보내는 간격 (ms) */
const KEEPALIVE_MS = 250;
/** 상대 기기의 틱이 스냅샷보다 이만큼까지 뒤처진 것은 기다린다 (그보다 크면 방장 틱에 맞춘다) */
const LAG_BEHIND_MAX = 6;
/** 상대 캐릭터의 화면 차이가 이보다 크면 바로 맞춘다 (px) */
const PLAYER_SNAP = 60;

const ZERO: Pos = { x: 0, y: 0 };
const inKey = (i: Input) => `${+i.left}${+i.right}${+i.jump}`;

/**
 * 온라인 대전 한 경기.
 * - 두 기기의 틱 시계는 같은 시작 시각(서버 시각)에서 흐른다: 틱 = (지금 − 시작) ÷ (1/60초).
 * - 방장(왼쪽): 공·득점을 계산하고 스냅샷을 초당 약 20번 보낸다. 상대 캐릭터는 받은 위치를 지금 틱까지 이어 움직여 쓴다.
 * - 상대(오른쪽): 같은 계산을 돌려 미리 보여 주고, 스냅샷이 오면 그 틱부터 다시 계산해 맞춘다. 점수·서브·끝은 방장 값만 따른다.
 * - 메시지: pos(내 캐릭터, 초당 약 30번) · snap(방장 스냅샷) · quit(나감) · end(이탈 승리 알림)
 */
export class OnlineMatch extends Match {
  private readonly host: boolean;
  private readonly no: number;
  /** 지금까지 계산한 틱 */
  private done = 0;
  /** 0번 틱의 시각 (서버 시각 ms). 기다리느라 멈춘 만큼 뒤로 민다 */
  private anchor = 0;
  private lastNow = 0;
  private started = false;
  /** 마지막으로 상대 소식을 들은 시각 */
  private lastHeard = 0;
  private oppQuit = false;
  private lastSendMs = 0;
  private lastSentIn = '';
  /** 방장: 상대(오른쪽)가 보낸 최신 소식 */
  private remote: PlayerPacket | null = null;
  /** 상대: 방장의 최신 스냅샷과 조작 */
  private snap: Snapshot | null = null;
  /** 상대: 받았지만 아직 적용하지 않은 스냅샷 (내 틱이 그 틱에 닿으면 적용한다) */
  private pending: Snapshot | null = null;
  private hostIn: Input = { left: false, right: false, jump: false };
  /** 상대: 틱 → 내 캐릭터·조작 기록 (다시 계산할 때 쓴다) */
  private own = new Map<number, OwnFrame>();
  /** 캐릭터가 공을 친 횟수 [왼쪽, 오른쪽] */
  private hits: [number, number] = [0, 0];
  /** 상대: 내 기기가 미리 낸 타격 소리 (방장 확인을 기다리는 틱) */
  private guessed: [number[], number[]] = [[], []];
  /** 화면에 보이는 자리와 계산 자리의 차이 (조금씩 줄인다) */
  private offBall: Pos = ZERO;
  private offP: [Pos, Pos] = [ZERO, ZERO];
  private offMsg: () => void;
  private bgTimer: ReturnType<typeof setInterval>;
  private endTimers: ReturnType<typeof setTimeout>[] = [];
  /** 점검용 수치: 스냅샷 수, 보정 크기(px) 합·최대, 바로 맞춘 횟수, 보낸 메시지 수 */
  readonly stats = { snaps: 0, corrSum: 0, corrMax: 0, corrOver10: 0, hardSnaps: 0, resimTicks: 0, sentSnap: 0, sentPos: 0, gotPos: 0 };

  constructor(
    setup: MatchSetup,
    private link: NetLink,
    private now: () => number,
  ) {
    super(setup);
    this.host = setup.mySide === 0;
    this.no = setup.matchNo ?? 0;
    this.offMsg = link.onMsg((m) => this.onMsg(m));
    // 탭이 가려지면 화면 프레임이 멈춘다 → 타이머로 계속 계산하고 소식을 보낸다
    this.bgTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) this.update();
    }, 200);
  }

  dispose() {
    this.offMsg();
    clearInterval(this.bgTimer);
  }

  /** 경기 중에 내가 나간다: 상대에게 바로 알린다 (상대 승리) */
  quit() {
    if (this.phase === 'over') return;
    this.link.send({ t: 'quit', n: this.no });
    this.phase = 'over';
  }

  private onMsg(m: NetMsg) {
    if (m.n !== this.no || this.phase === 'over') return;
    if (m.t === 'quit') {
      this.oppQuit = true;
      return;
    }
    if (m.t === 'end') {
      // 상대가 '내가 이겼다(상대 이탈)'고 알림: 내가 잠깐 끊겼다 돌아온 경우
      if (Array.isArray(m.score)) this.state.score = [Number(m.score[0]) || 0, Number(m.score[1]) || 0];
      this.finish(m.reason === 'leave' ? 'leave' : 'normal', m.winner === 0 ? 0 : 1);
      return;
    }
    if (m.t === 'pos' && this.host) {
      const k = m.k as PlayerPacket;
      if (!k || typeof k.tick !== 'number' || !k.p || !k.in) return;
      this.lastHeard = this.now();
      this.stats.gotPos++;
      if (!this.remote || k.tick >= this.remote.tick) this.remote = k;
    } else if (m.t === 'snap' && !this.host) {
      this.lastHeard = this.now();
      if (validSnapshot(m.s) && (!this.pending || m.s.tick >= this.pending.tick)) this.pending = m.s;
    }
  }

  update() {
    const now = this.now();
    if (this.phase === 'over') return;
    if (this.phase === 'countdown') {
      if (!this.countdown((this.setup.startAt ?? now) - now)) return;
    }
    if (!this.started) {
      this.started = true;
      this.anchor = this.setup.startAt ?? now;
      this.lastHeard = now;
      this.lastNow = now;
    }
    if (this.oppQuit) return this.leaveWin();
    const link = linkState(now, this.lastHeard);
    if (link.state === 'lost') return this.leaveWin();
    if (link.state === 'waiting') {
      // 상대 연결을 기다리는 중: 경기를 멈추고(시계를 그만큼 뒤로) 내 소식만 계속 보낸다
      this.waitingSec = link.leftSec;
      this.anchor += now - this.lastNow;
      this.lastNow = now;
      if (now - this.lastSendMs >= KEEPALIVE_MS) this.sendState();
      return;
    }
    this.waitingSec = 0;
    this.lastNow = now;
    let n = Math.floor((now - this.anchor) / STEP_MS) - this.done;
    if (n > CATCH_UP_MAX) {
      this.anchor += (n - CATCH_UP_MAX) * STEP_MS;
      n = CATCH_UP_MAX;
    }
    for (; n > 0 && this.phase === 'play'; n--) {
      if (this.host) this.hostTick();
      else this.guestTick();
    }
    this.applyPending();
    this.frac = Math.max(0, Math.min(1, (now - this.anchor) / STEP_MS - this.done));
  }

  /**
   * 상대: 받아 둔 스냅샷을 적용한다. 내 틱이 스냅샷 틱에 아직 못 미쳤으면(화면 프레임이 조금 늦은 것) 다음 프레임까지 기다린다.
   * 많이 뒤처졌거나 경기가 끝났다는 스냅샷이면 바로 적용한다 (onSnap 이 틱 시계를 방장에 맞춘다).
   */
  private applyPending() {
    const p = this.pending;
    if (!p || this.host || this.phase !== 'play') return;
    if (this.done < p.tick && p.tick - this.done <= LAG_BEHIND_MAX && p.winner === -1) return;
    this.pending = null;
    this.onSnap(p);
  }

  private sendState() {
    this.lastSendMs = this.now();
    this.lastSentIn = inKey(this.input);
    if (this.host) {
      this.stats.sentSnap++;
      this.link.send({ t: 'snap', n: this.no, s: makeSnapshot(this.state, this.input, this.hits) });
    } else {
      this.stats.sentPos++;
      const k: PlayerPacket = { tick: this.done, p: { ...this.state.players[1] }, in: { ...this.input } };
      this.link.send({ t: 'pos', n: this.no, k });
    }
  }

  private decay() {
    this.offBall = decayOffset(this.offBall);
    this.offP = [decayOffset(this.offP[0]), decayOffset(this.offP[1])];
  }

  // ---------- 방장 ----------

  private hostTick() {
    const s = this.state;
    let remoteIn: Input = { left: false, right: false, jump: false };
    if (this.remote) {
      // 상대 캐릭터: 받은 위치를 지금 틱까지 이어 움직인 자리로 (보이던 자리와의 차이는 조금씩 줄인다)
      const shown = { x: s.players[1].x + this.offP[1].x, y: s.players[1].y + this.offP[1].y };
      setPlayer(s, 1, extrapolatePlayer(this.remote, 1, this.done));
      this.offP[1] = carryOffset(shown, s.players[1], PLAYER_SNAP);
      remoteIn = this.remote.in;
    }
    this.savePrev();
    const evs: SimEvent[] = [];
    step(s, [this.input, remoteIn], evs);
    this.done++;
    this.decay();
    let important = inKey(this.input) !== this.lastSentIn;
    for (const e of evs) {
      if (e.t === 'hit') this.hits[e.side]++;
      if (e.t === 'hit' || e.t === 'point' || e.t === 'serve' || e.t === 'speedup' || e.t === 'over') important = true;
      this.events.push(e);
    }
    if (important || this.done % SNAP_EVERY === 0) this.sendState();
    if (s.phase === 'over') {
      // 끝 스냅샷은 몇 번 더 보낸다 (하나쯤 못 받아도 되게)
      for (const ms of [250, 700]) this.endTimers.push(setTimeout(() => this.sendState(), ms));
      this.finish('normal', s.winner as Side);
    }
  }

  // ---------- 상대(오른쪽) ----------

  private guestTick() {
    const s = this.state;
    this.own.set(this.done, { p: { ...s.players[1] }, in: { ...this.input } });
    if (this.own.size > 240) for (const k of this.own.keys()) if (k < this.done - 180) this.own.delete(k);
    this.savePrev();
    const evs: SimEvent[] = [];
    step(s, [this.hostIn, this.input], evs);
    this.done++;
    this.decay();
    // 점수·서브·가속·끝은 방장 스냅샷으로만 알린다. 여기서는 소리·이펙트가 필요한 것만
    for (const e of evs) {
      if (e.t === 'hit') {
        this.guessed[e.side].push(this.done);
        this.events.push(e);
      } else if (e.t === 'jump' || e.t === 'land' || e.t === 'wall' || e.t === 'net') this.events.push(e);
    }
    if (inKey(this.input) !== this.lastSentIn || this.done % POS_EVERY === 0) this.sendState();
  }

  private onSnap(snap: Snapshot) {
    if (this.snap && snap.tick <= this.snap.tick) return;
    if (!this.started) return;
    const changes = snapshotEvents(this.snap, snap);
    this.snap = snap;
    this.hostIn = { left: !!snap.in.left, right: !!snap.in.right, jump: !!snap.in.jump };
    this.stats.snaps++;

    // 내 틱 시계가 방장보다 뒤처졌거나 너무 앞서 있으면 방장 틱에 맞춘다
    if (this.done < snap.tick || this.done - snap.tick > REPREDICT_MAX) {
      this.done = snap.tick;
      this.anchor = this.now() - this.done * STEP_MS;
    }

    const old = this.state;
    const shownBall = { x: old.ball.x + this.offBall.x, y: old.ball.y + this.offBall.y };
    const shownHost = { x: old.players[0].x + this.offP[0].x, y: old.players[0].y + this.offP[0].y };
    const next = repredict(snap, this.own, old.players[1], this.done);
    this.stats.resimTicks += this.done - snap.tick;

    if (changes.length > 0) {
      // 득점·서브 같은 상태 변화: 바로 맞춘다
      this.offBall = ZERO;
      this.offP = [ZERO, ZERO];
    } else {
      const corr = Math.hypot(shownBall.x - next.ball.x, shownBall.y - next.ball.y);
      this.stats.corrSum += corr;
      this.stats.corrMax = Math.max(this.stats.corrMax, corr);
      if (corr > 10) this.stats.corrOver10++;
      if (corr > SNAP_DIST) this.stats.hardSnaps++;
      this.offBall = carryOffset(shownBall, next.ball);
      this.offP[0] = carryOffset(shownHost, next.players[0], PLAYER_SNAP);
    }
    this.state = next;
    this.prevBall = { x: next.ball.x - next.ball.vx, y: next.ball.y - next.ball.vy };
    this.prevPlayers = [
      { x: next.players[0].x - next.players[0].vx, y: next.players[0].y - next.players[0].vy },
      { x: next.players[1].x - next.players[1].vx, y: next.players[1].y - next.players[1].vy },
    ];

    // 방장이 센 타격 수와 맞춘다: 내 기기가 미리 소리 낸 것은 빼고, 놓친 것만 지금 소리 낸다
    for (const side of [0, 1] as const) {
      const g = this.guessed[side].filter((t) => t >= this.done - 60);
      for (let k = Number(snap.hits[side]) - this.hits[side]; k > 0; k--) {
        if (g.length > 0) g.shift();
        else this.events.push({ t: 'hit', side, x: next.ball.x, y: next.ball.y, power: Math.hypot(next.ball.vx, next.ball.vy) });
      }
      this.guessed[side] = g;
      this.hits[side] = Math.max(this.hits[side], Number(snap.hits[side]) || 0);
    }
    for (const e of changes) this.events.push(e);
    if (snap.winner !== -1) this.finish('normal', snap.winner);
  }

  // ---------- 이탈 ----------

  /** 상대가 나갔거나 10초 넘게 끊겼다: 남은 내가 이긴다 */
  private leaveWin() {
    if (this.phase === 'over') return;
    const s = this.state;
    this.waitingSec = 0;
    s.winner = this.mySide;
    this.link.send({ t: 'end', n: this.no, winner: this.mySide, score: [s.score[0], s.score[1]], reason: 'leave' });
    this.finish('leave', this.mySide);
  }

  ballView(): Pos {
    const p = super.ballView();
    return { x: p.x + this.offBall.x, y: p.y + this.offBall.y };
  }
  playerView(side: Side): Pos {
    const p = super.playerView(side);
    return { x: p.x + this.offP[side].x, y: p.y + this.offP[side].y };
  }
}

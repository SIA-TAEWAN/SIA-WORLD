import { makeAi, aiInput } from '../game/ai';
import { STEP_MS, WIN_SCORE } from '../game/constants';
import { setPlayer, step, type Input, type Side, type SimEvent } from '../game/sim';
import { copyHighlight, packHighlight, tally, unpackHighlight, type Highlight } from '../game/highlight';
import {
  LINK_WAIT_MS, POS_EVERY, REPREDICT_MAX, SNAP_DIST, SNAP_EVERY, carryOffset, decayOffset, extrapolatePlayer, linkState, makeSnapshot, repredict, snapshotEvents, validPacket,
  validSnapshot, type OwnFrame, type PlayerPacket, type Pos, type Snapshot,
} from '../game/sync';
import type { NetMsg } from '../net/channel';
import { Match, type MatchSetup } from './game';

/** 방 채널에서 경기가 쓰는 부분 */
export interface NetLink {
  send(m: NetMsg): void;
  onMsg(fn: (m: NetMsg) => void): () => void;
  /** 내 기기의 연결이 살아 있는가 (채널이 끊겼거나 기기가 오프라인이면 false). 없으면 알 수 없는 것으로 본다 */
  online?(): boolean;
}

/** 한 번에 따라잡는 틱 한도 (탭을 내려 두었다 돌아온 경우: 10초) */
const CATCH_UP_MAX = 600;
/** 기다리는 동안 '나 여기 있어요' 소식을 보내는 간격 (ms) */
const KEEPALIVE_MS = 250;
/** AI가 이어받은 뒤 '이어받았음'을 알리는 간격 (ms) */
const TAKEN_MS = 1000;
/** 상대 기기의 틱이 스냅샷보다 이만큼까지 뒤처진 것은 기다린다 (그보다 크면 방장 틱에 맞춘다) */
const LAG_BEHIND_MAX = 6;
/** 상대 캐릭터의 화면 차이가 이보다 크면 바로 맞춘다 (px) */
const PLAYER_SNAP = 60;
/** update 사이가 이만큼 벌어졌으면 '내 기기가 멈춰 있었다'(앱을 내렸다 돌아옴)고 본다 (ms) */
export const STALL_MS = 2000;
/** 방장의 첫 계산이 시작 시각보다 이만큼 넘게 늦으면, 지나간 시간을 몰아서 계산하지 않고 지금부터 시작한다 (ms) */
const LATE_START_MS = 200;
/** 상대(오른쪽): 첫 스냅샷이 예정보다 이만큼(틱) 안쪽으로 늦은 것은 정상 지연으로 본다 */
const FIRST_SNAP_SLACK = 30;
/** 방장이 '경기 끝'만 알리고 결과를 주지 않았을 때, 끝 스냅샷을 다시 달라고 하며 기다리는 시간 (ms) */
const END_WAIT_MS = 5000;
/** 방장: 끝난 뒤 받은 소식에 끝 스냅샷으로 답하는 최소 간격 (ms) */
const END_REPLY_MS = 200;
/** 틱이 이만큼 넘게 작아진 소식은 '상대 시계가 다시 맞춰진 것'으로 보고 받아들인다 */
const TICK_RESET = 20;

const ZERO: Pos = { x: 0, y: 0 };
const inKey = (i: Input) => `${+i.left}${+i.right}${+i.jump}`;

/** 방장이 알린 경기 결과(over 메시지의 r)가 쓸 만한가: 정확히 한쪽만 3점 */
function validEnd(r: unknown): r is { score: [number, number]; winner: Side } {
  const v = r as { score?: unknown; winner?: unknown };
  if (!v || !Array.isArray(v.score) || v.score.length !== 2) return false;
  const [l, rr] = v.score as unknown[];
  if (!Number.isInteger(l) || !Number.isInteger(rr) || (l as number) < 0 || (rr as number) < 0 || (l as number) > WIN_SCORE || (rr as number) > WIN_SCORE) return false;
  if ((l === WIN_SCORE) === (rr === WIN_SCORE)) return false;
  return v.winner === (l === WIN_SCORE ? 0 : 1);
}

/**
 * 온라인 대전 한 경기.
 * - 두 기기의 틱 시계는 같은 시작 시각(서버 시각)에서 흐른다: 틱 = (지금 − 시작) ÷ (1/60초).
 *   방장이 늦게 시작하면 그 순간부터 0틱으로 시작하고, 상대는 방장의 스냅샷 틱에 맞춘다 (지나간 시간을 몰아서 계산하지 않는다).
 * - 방장(왼쪽): 공·득점을 계산하고 스냅샷을 초당 약 20번 보낸다. 상대 캐릭터는 받은 위치를 지금 틱까지 이어 움직여 쓴다.
 * - 상대(오른쪽): 같은 계산을 돌려 미리 보여 주고, 스냅샷이 오면 그 틱부터 다시 계산해 맞춘다. 점수·서브·끝은 방장 값만 따른다.
 * - 이탈: 상대가 나가거나(quit) 소식이 10초 넘게 끊기면, 남은 내 기기가 계산 권한을 갖고 상대 캐릭터를 AI가 이어받아
 *   같은 점수에서 끝까지 한다 (takeover). 한번 AI로 바뀌면 그 경기 끝까지 AI다 (돌아온 사람은 그 경기에 못 낀다).
 *   두 기기가 서로 '상대가 나갔다'고 보지 않도록: 내 기기가 멈춰 있었거나 내 연결이 끊겼던 쪽이 '나간 사람'이 되고,
 *   그래도 둘 다 이어받았으면 더 늦게 이어받은 쪽(같으면 오른쪽)이 양보한다.
 * - 메시지(모두 n: 경기 번호, from: 보낸 사람): pos(내 캐릭터, 초당 약 30번) · snap(방장 스냅샷) · quit(나감)
 *   · taken(AI가 이어받았음, at: 이어받은 시각) · over(방 채널의 경기 끝 알림, r: 방장이 정한 결과)
 * - 하이라이트(최장 랠리·최고 가속·터치 수)는 방장이 모은 값이 기준: snap 메시지의 hl 과 over 의 r.hl 로 함께 보내고,
 *   상대는 받은 값을 그대로 쓴다 (받은 적이 없으면 — 예전 버전 방장 — 자기 기기에서 본 값). AI가 이어받은 뒤에는 남은 기기가 이어서 모은다.
 */
export class OnlineMatch extends Match {
  private readonly host: boolean;
  private readonly no: number;
  private readonly myId: string | undefined;
  private readonly oppId: string | undefined;
  /** 지금까지 계산한 틱 */
  private done = 0;
  /** 0번 틱의 시각 (서버 시각 ms). 기다리느라 멈춘 만큼 뒤로 민다 */
  private anchor = 0;
  private lastNow = 0;
  private started = false;
  /** 마지막으로 상대 소식을 들은 시각 */
  private lastHeard = 0;
  private oppQuit = false;
  /** 상대가 나가서 AI가 그 자리를 이어받았는가 (이 경기 끝까지) */
  solo = false;
  /** 내가 이어받은 시각 (서버 시각 ms) */
  private takenAt = 0;
  /** 내 연결이 끊겨 있는 것을 마지막으로 본 시각 (-1: 본 적 없음) */
  private myDownAt = -1;
  /** 상대: 방장의 첫 스냅샷을 받을 때까지 계산을 시작하지 않는다 */
  private frozen = false;
  /** 상대: 방장이 '경기 끝'만 알리고 결과를 못 받은 시각 (0: 아님) */
  private hostEndedAt = 0;
  /** 방장: 경기가 끝났을 때의 마지막 스냅샷 (끝난 뒤에도 달라고 하면 다시 보낸다) */
  private finalSnap: Snapshot | null = null;
  private lastReplyMs = 0;
  private lastSendMs = 0;
  private lastSentIn = '';
  /** 방장: 상대(오른쪽)가 보낸 최신 소식과 그 일련번호 */
  private remote: PlayerPacket | null = null;
  private remoteSeq = -1;
  private posSeq = 0;
  /** 상대: 방장의 최신 스냅샷과 조작 */
  private snap: Snapshot | null = null;
  /** 상대: 받았지만 아직 적용하지 않은 스냅샷 (내 틱이 그 틱에 닿으면 적용한다) */
  private pending: Snapshot | null = null;
  private hostIn: Input = { left: false, right: false, jump: false };
  /** 상대: 틱 → 내 캐릭터·조작 기록 (다시 계산할 때 쓴다) */
  private own = new Map<number, OwnFrame>();
  /** 캐릭터가 공을 친 횟수 [왼쪽, 오른쪽] */
  private hits: [number, number] = [0, 0];
  /** 상대: 방장이 보낸 최신 하이라이트 (받은 적 없으면 null) */
  private hostHl: Highlight | null = null;
  /** 상대: 내 기기가 미리 낸 타격 소리 (방장 확인을 기다리는 틱) */
  private guessed: [number[], number[]] = [[], []];
  /** 화면에 보이는 자리와 계산 자리의 차이 (조금씩 줄인다) */
  private offBall: Pos = ZERO;
  private offP: [Pos, Pos] = [ZERO, ZERO];
  private offMsg: () => void;
  private bgTimer: ReturnType<typeof setInterval>;
  private endTimers: ReturnType<typeof setTimeout>[] = [];
  private disposed = false;
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
    this.myId = setup.fighters[setup.mySide].id;
    this.oppId = setup.fighters[setup.mySide === 0 ? 1 : 0].id;
    this.offMsg = link.onMsg((m) => this.onMsg(m));
    // 탭이 가려지면 화면 프레임이 멈춘다 → 타이머로 계속 계산하고 소식을 보낸다
    this.bgTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) this.update();
    }, 200);
  }

  dispose() {
    this.disposed = true;
    this.offMsg();
    clearInterval(this.bgTimer);
    this.endTimers.forEach((t) => clearTimeout(t));
  }

  private send(m: NetMsg) {
    this.link.send({ ...m, n: this.no, from: this.myId });
  }

  /** 경기 중에 내가 나간다: 상대에게 바로 알린다 (내 자리는 AI가 이어받고, 나는 패배로 기록된다) */
  quit() {
    if (this.phase === 'over') return;
    this.send({ t: 'quit' });
    this.phase = 'over';
  }

  /** 하이라이트: 방장은 자기가 모은 값, 상대는 방장이 보낸 값 (없으면 자기 기기에서 본 값 + 방장이 센 타격 수) */
  highlight(): Highlight {
    if (this.host || this.solo) return copyHighlight(this.hl);
    if (this.hostHl) return copyHighlight(this.hostHl);
    return { longest: this.hl.longest, maxStage: this.hl.maxStage, touches: [this.hits[0], this.hits[1]] };
  }

  /** 방장: 스냅샷 메시지 (하이라이트를 함께 싣는다) */
  private snapMsg(s: Snapshot): NetMsg {
    return { t: 'snap', s, hl: packHighlight(this.hl) };
  }

  private get oppSide(): Side {
    return this.mySide === 0 ? 1 : 0;
  }

  /** 이 경기에서 나는 '나간 사람'이다 (내가 끊겼거나, 상대가 먼저 이어받았다) */
  private leaveAsMe() {
    this.waitingSec = 0;
    this.finish('leave', this.oppSide, this.mySide);
  }

  private onMsg(m: NetMsg) {
    if (!m || m.n !== this.no || this.disposed) return;
    // 상대가 보낸 것만 듣는다 (같은 방 채널의 다른 사람이 보낸 것은 버린다)
    if (this.oppId && m.from !== this.oppId) return;
    const now = this.now();

    if (this.phase === 'over') {
      // 방장: 경기가 끝난 뒤에도 상대가 계속 소식을 보내면 끝 스냅샷을 못 받은 것 → 다시 보낸다
      if (this.host && m.t === 'pos' && this.finalSnap && now - this.lastReplyMs >= END_REPLY_MS) {
        this.lastReplyMs = now;
        this.send(this.snapMsg(this.finalSnap));
      }
      return;
    }
    if (m.t === 'quit') {
      this.oppQuit = true;
      return;
    }
    if (m.t === 'taken') {
      // 상대가 '네 자리는 AI가 이어받았다'고 알림.
      if (!this.solo) return this.leaveAsMe(); // 내가 끊겼다 돌아온 경우 → 이 경기에는 못 낀다
      // 둘 다 이어받았다: 두 기기가 같은 결론을 내도록, 더 늦게 이어받은 쪽(같으면 오른쪽 자리)이 양보한다
      const at = Number(m.at);
      const later = Number.isFinite(at) ? this.takenAt > at || (this.takenAt === at && this.mySide === 1) : this.mySide === 1;
      if (later) this.leaveAsMe();
      return;
    }
    if (m.t === 'over') {
      // 방 채널의 '경기 끝' 알림 (상대가 보냄). 오른쪽: 끝 스냅샷을 못 받았어도 방장이 정한 결과로 끝낸다
      if (this.host || this.solo) return;
      if (validEnd(m.r)) {
        this.hostHl = unpackHighlight((m.r as { hl?: unknown }).hl) ?? this.hostHl;
        this.state.score = [m.r.score[0], m.r.score[1]];
        this.state.winner = m.r.winner;
        this.state.phase = 'over';
        this.events.push({ t: 'over', winner: m.r.winner });
        this.finish('normal', m.r.winner);
      } else if (!this.hostEndedAt) this.hostEndedAt = now;
      return;
    }
    if (this.solo) return;
    if (m.t === 'pos' && this.host) {
      const k = m.k;
      if (!validPacket(k)) return;
      this.lastHeard = now;
      this.stats.gotPos++;
      // 순서: 보낸 쪽 일련번호가 있으면 그것으로, 없으면 틱으로 (틱이 크게 작아진 것은 상대 시계가 다시 맞춰진 것)
      const q = Number(m.q);
      const newer = Number.isFinite(q) ? q > this.remoteSeq : !this.remote || k.tick >= this.remote.tick || this.remote.tick - k.tick > TICK_RESET;
      if (newer) {
        this.remote = k;
        if (Number.isFinite(q)) this.remoteSeq = q;
      }
    } else if (m.t === 'snap' && !this.host) {
      this.lastHeard = now;
      // 하이라이트는 늘기만 하는 값이라 순서가 뒤바뀌어 온 옛 소식은 버린다
      const hl = unpackHighlight(m.hl);
      const old = this.hostHl;
      if (hl && (!old || (hl.longest >= old.longest && hl.touches[0] + hl.touches[1] >= old.touches[0] + old.touches[1]))) this.hostHl = hl;
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
      const startAt = this.setup.startAt ?? now;
      // 방장이 늦게 시작했으면(그림을 늦게 받음·탭이 가려져 있었음) 지나간 시간을 몰아서 계산하지 않고 지금부터
      this.anchor = this.host && now > startAt + LATE_START_MS ? now : startAt;
      // 오른쪽은 방장의 첫 스냅샷을 받고 나서 계산을 시작한다 (방장이 늦으면 그 틱에 맞춘다)
      this.frozen = !this.host;
      this.lastHeard = now;
      this.lastNow = now;
    }
    // 내 기기가 멈춰 있었다(앱을 내렸다 돌아옴): 그동안 소식을 못 들은 것은 내 탓이다.
    // 바로 '상대가 나갔다'고 보지 않고 기다리는 상태로 두어, 상대가 보낸 소식(taken 포함)을 받을 시간을 준다
    const gap = now - this.lastNow;
    if (gap >= STALL_MS) this.lastHeard = Math.max(this.lastHeard, now - LINK_WAIT_MS);
    if (this.link.online && !this.link.online()) this.myDownAt = now;

    if (this.solo) return this.soloUpdate(now);
    if (this.oppQuit) return this.takeover(now);
    if (this.hostEndedAt) {
      // 방장은 경기가 끝났다고 했는데 결과를 못 받았다: 끝 스냅샷을 다시 달라고 하며 기다린다 (이어받지 않는다)
      this.waitingSec = 0;
      this.anchor += gap;
      this.lastNow = now;
      if (this.pending && this.pending.winner !== -1) return this.applyPending();
      if (now - this.lastSendMs >= KEEPALIVE_MS) this.sendState();
      if (now - this.hostEndedAt > END_WAIT_MS) this.leaveAsMe();
      return;
    }
    const link = linkState(now, this.lastHeard);
    if (link.state === 'lost') {
      // 침묵 동안 내 연결이 끊겨 있었으면 '내가 나간 사람'이다 (상대가 이어받았을 것이다)
      if (this.myDownAt >= this.lastHeard) return this.leaveAsMe();
      return this.takeover(now);
    }
    if (link.state === 'waiting') {
      // 상대 연결을 기다리는 중: 경기를 멈추고(시계를 그만큼 뒤로) 내 소식만 계속 보낸다
      this.waitingSec = link.leftSec;
      this.anchor += gap;
      this.lastNow = now;
      if (now - this.lastSendMs >= KEEPALIVE_MS) this.sendState();
      return;
    }
    this.waitingSec = 0;
    this.lastNow = now;
    if (this.frozen) {
      const p = this.pending;
      if (!p) {
        if (now - this.lastSendMs >= KEEPALIVE_MS) this.sendState();
        return;
      }
      // 첫 스냅샷: 예정된 틱과 비슷하면 시작 시각 기준 그대로, 아니면(방장이 늦게 시작) 방장 틱에 맞춘다
      const startAt = this.setup.startAt ?? now;
      const ahead = Math.floor((now - startAt) / STEP_MS) - p.tick;
      this.anchor = ahead >= 0 && ahead <= FIRST_SNAP_SLACK ? startAt : now - p.tick * STEP_MS;
      this.frozen = false;
    }
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
      this.send(this.snapMsg(makeSnapshot(this.state, this.input, this.hits)));
    } else {
      this.stats.sentPos++;
      const k: PlayerPacket = { tick: this.done, p: { ...this.state.players[1] }, in: { ...this.input } };
      this.send({ t: 'pos', k, q: ++this.posSeq });
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
    tally(this.hl, s, evs);
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
      // 끝 스냅샷은 몇 번 더 보낸다. 그래도 못 받은 상대가 소식을 보내오면 그때마다 다시 보낸다 (onMsg)
      this.finalSnap = makeSnapshot(s, this.input, this.hits);
      for (const ms of [250, 700]) this.endTimers.push(setTimeout(() => this.disposed || !this.finalSnap || this.send(this.snapMsg(this.finalSnap)), ms));
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
    // 방장 값을 못 받았을 때만 쓰는 값 (터치 수는 방장이 센 hits 를 쓴다)
    tally(this.hl, s);
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
    if (this.snap && snap.tick <= this.snap.tick && snap.winner === -1) return;
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
      for (let k = Math.min(4, Number(snap.hits[side]) - this.hits[side]); k > 0; k--) {
        if (g.length > 0) g.shift();
        else this.events.push({ t: 'hit', side, x: next.ball.x, y: next.ball.y, power: Math.hypot(next.ball.vx, next.ball.vy) });
      }
      this.guessed[side] = g;
      this.hits[side] = Math.max(this.hits[side], Number(snap.hits[side]) || 0);
    }
    for (const e of changes) this.events.push(e);
    if (snap.winner !== -1) this.finish('normal', snap.winner);
  }

  // ---------- 이탈: AI가 이어받는다 ----------

  /**
   * 상대가 나갔거나 10초 넘게 끊겼다: 남은 내 기기가 계산 권한을 갖고, 상대 캐릭터는 AI가 이어받아 같은 점수에서 계속한다.
   * (내가 오른쪽이었으면 지금까지 미리 계산해 보여 주던 상태가 그대로 진짜 상태가 된다)
   */
  private takeover(now: number) {
    if (this.solo || this.phase === 'over') return;
    const opp = this.oppSide;
    // 하이라이트: 지금까지의 값(상대 기기였으면 방장이 보낸 값)에서 이어서 이 기기가 모은다
    this.hl = this.highlight();
    this.solo = true;
    this.takenAt = now;
    this.frozen = false;
    this.waitingSec = 0;
    this.pending = null;
    this.offBall = ZERO;
    this.offP = [ZERO, ZERO];
    this.ai = makeAi(opp, ((this.setup.seed ^ 0x51a7) + this.done) >>> 0);
    // 멈춰 있던 만큼 시계를 당겨 지금부터 이어 간다
    this.anchor = now - this.done * STEP_MS;
    this.lastNow = now;
    // 방장이 확인해 주지 못한 득점(내가 미리 계산한 것)이 있으면 이제 알린다
    if (!this.host) {
      const known = this.snap?.score ?? [0, 0];
      for (const side of [0, 1] as const) if (this.state.score[side] > known[side]) this.events.push({ t: 'point', side, x: this.state.ball.x });
    }
    this.events.push({ t: 'takeover', side: opp });
    this.sendTaken(now);
    // 내가 미리 계산한 상태에서 이미 경기가 끝나 있었으면(마지막 점수 직후 상대가 끊김) 그대로 끝낸다
    if (this.state.phase === 'over' && this.state.winner !== -1) this.finish('leave', this.state.winner, opp);
  }

  private sendTaken(now: number) {
    this.lastSendMs = now;
    this.send({ t: 'taken', at: this.takenAt });
  }

  /** AI가 이어받은 뒤: 내 기기 혼자 계산한다 (AI 대전과 같다) */
  private soloUpdate(now: number) {
    const s = this.state;
    const opp = this.oppSide;
    let n = Math.floor((now - this.anchor) / STEP_MS) - this.done;
    if (n > CATCH_UP_MAX) {
      this.anchor += (n - CATCH_UP_MAX) * STEP_MS;
      n = CATCH_UP_MAX;
    }
    for (; n > 0 && this.phase === 'play'; n--) {
      this.savePrev();
      const other = this.ai ? aiInput(this.ai, s) : { left: false, right: false, jump: false };
      const from = this.events.length;
      step(s, this.mySide === 0 ? [this.input, other] : [other, this.input], this.events as SimEvent[]);
      tally(this.hl, s, this.events, from);
      this.done++;
      if (s.phase === 'over') this.finish('leave', s.winner as Side, opp);
    }
    this.lastNow = now;
    this.frac = Math.max(0, Math.min(1, (now - this.anchor) / STEP_MS - this.done));
    // 돌아온 상대에게 '이 경기는 AI가 이어받았다'고 계속 알린다
    if (this.phase === 'play' && now - this.lastSendMs >= TAKEN_MS) this.sendTaken(now);
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

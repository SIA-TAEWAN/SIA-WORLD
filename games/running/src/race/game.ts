import { makeAiPlan, aiPress, type AiPlan } from '../game/ai';
import { BOOST_FACTOR, DT, END_AFTER_FIRST, END_AFTER_GO, LANES, MUD_FACTOR, NET_INTERVAL_MS, TOP_SPEED, TRACK_LEN, type ZodiacId } from '../game/constants';
import { rankResults, type RaceEntry, type RankedEntry } from '../game/ranking';
import { foul, newRunner, stepRunner, type Press, type RunState, type Runner, type SimEvent } from '../game/sim';
import { makeTrack, type Obstacle } from '../game/track';
import { serverNow, type RaceApi, type SubmitResult } from '../net/api';
import type { NetMsg } from '../net/channel';
import type { RaceRoom, RosterEntry, StartMsg } from '../net/room';
import { fallbackEndDue, noteHeard, raceHostOf, type Heard } from '../net/seats';

/** 화면에 그릴 주자 한 명의 지금 모습 */
export interface RunnerView {
  x: number;
  v: number;
  state: RunState;
  jumpT: number;
  /** 슬라이딩한 뒤 흐른 시간 */
  slideT: number;
  stunT: number;
  boost: boolean;
  mud: boolean;
  /** 통나무 위치 (구르기 전 undefined, 사라졌으면 -1) */
  logX: number | undefined;
  finishMs: number | null;
}

/** 다른 기기에서 받은 위치 한 점 */
interface Snap {
  ts: number;
  x: number;
  v: number;
  st: RunState;
  /** 점프(슬라이딩 중이면 슬라이딩)한 뒤 흐른 시간 */
  jumpT: number;
  stunT: number;
  boostT: number;
  /** -2 구르기 전, -1 사라짐 */
  logX: number;
  fin: number;
  mud: boolean;
}

export type RaceEvent = { slot: number; ev: SimEvent | 'foul' };

/** me 내가 조종 · ai 이 기기가 계산하는 AI · remote 다른 기기에서 받아 보간 */
type Control = 'me' | 'ai' | 'remote';

/** 전송용 상태 번호 (순서를 바꾸지 않는다: 새 상태는 뒤에 붙인다) */
const STATES: RunState[] = ['wait', 'run', 'jump', 'fall', 'slip', 'done', 'foul', 'slide'];
/** 상대는 이만큼 늦게 그린다 (받은 위치 사이를 부드럽게 잇기 위해) */
const INTERP_DELAY = 130;
/** 접속이 이만큼 끊기면 AI가 이어 달린다 */
const GONE_MS = 2500;
/** 위치가 이만큼 안 오면 AI가 이어 달린다 (화면이 멈춘 기기) */
const SILENT_MS = 8000;

/**
 * 한 판의 진행.
 * - 내 캐릭터는 이 기기에서 계산한다 (고정 간격 물리, 서버 시각 기준 GO).
 * - 상대는 초당 10회 받은 위치를 보간한다.
 * - 기준 기기(출전 명단에서 지금 접속해 있는 첫 사람)가 AI를 계산하고 경기 끝과 순위를 정해 알린다.
 */
export class RaceGame {
  readonly obs: Obstacle[];
  readonly roster: RosterEntry[];
  readonly round: number;
  readonly seed: number;
  readonly readyAt: number;
  readonly goAt: number;
  /** 내 자리 (출전하지 않았으면 -1) */
  readonly mySlot: number;
  private control: Control[] = [];
  private runners: (Runner | null)[] = [];
  private plans: (AiPlan | null)[] = [];
  private snaps: Snap[][] = [];
  /** 사람 자리였는데 AI가 이어 달리는 자리 */
  readonly taken: boolean[] = [];
  /** 그 자리의 마지막 받은 위치가 AI 계산(기준 기기)에서 온 것인가 (사람 기기가 보낸 것이면 false) */
  private aiSnap: boolean[] = [];
  /** 실시간 채널이 이어진 시각 (끊겨 있으면 0). 다시 이어진 직후 '조용했다'고 잘못 보지 않게 */
  private linkedSince = 0;
  private lastState: RunState[] = [];
  private goneSince = new Map<number, number>();
  private pendingPress: Press = false;
  private lastSend = 0;
  /** 사람마다 위치를 받은 기록 (기준 기기 고르기용). 나는 화면이 보이고 매 프레임이 돌 때 기록한다 */
  private heard = new Map<string, Heard>();
  private endAt = 0;
  private off: (() => void)[] = [];
  private fouledAt = 0;
  /** 이번 프레임에 생긴 일 (화면·소리에서 읽고 비운다) */
  events: RaceEvent[] = [];
  /** 끝났으면 최종 순위 */
  results: RankedEntry[] | null = null;
  /** 내 기록을 올린 결과 (도착했을 때) */
  record: Promise<SubmitResult> | null = null;
  /** 오늘의 도전으로 달리는 판이면 그 날짜 ('YYYY-MM-DD'). 완주 기록이 서버에 올라가면 그날 기록으로도 넣는다 */
  dailyDay: string | null = null;
  /** 오늘의 도전 기록을 넣은 결과 (들어갔으면 기록된 날짜, 아니면 null) */
  dailySaved: Promise<string | null> | null = null;
  onOver: ((r: RankedEntry[]) => void) | null = null;
  /** 내 자리가 AI로 넘어갔다 (접속이 끊겼다가 돌아옴) */
  onLostSeat: (() => void) | null = null;

  constructor(
    private room: RaceRoom,
    private api: RaceApi,
    start: StartMsg,
  ) {
    this.round = start.round;
    this.seed = start.seed;
    this.readyAt = start.readyAt;
    this.goAt = start.goAt;
    this.roster = start.roster;
    this.obs = makeTrack(start.seed);
    this.mySlot = start.roster.find((r) => r.id === room.me.id)?.slot ?? -1;
    for (let s = 0; s < LANES; s++) {
      this.taken[s] = false;
      this.aiSnap[s] = false;
      this.snaps[s] = [];
      this.lastState[s] = 'wait';
      this.plans[s] = null;
      if (s === this.mySlot) {
        this.control[s] = 'me';
        this.runners[s] = newRunner();
      } else {
        this.control[s] = 'remote';
        this.runners[s] = null;
      }
    }
    // 처음에는 모두 자리 잡은 것으로 본다 ('준비' 전에는 아무도 위치를 보내지 않으므로 그때까지는 조용해도 괜찮다)
    const base = Math.max(serverNow(), this.readyAt);
    for (const r of start.roster) if (r.id) this.heard.set(r.id, { last: base, since: -Infinity });
    if (room.connected()) this.linkedSince = serverNow();
    else this.heard.delete(room.me.id);
    this.off.push(room.onMsg((m) => this.onMsg(m)));
    if (typeof document !== 'undefined') {
      const onVis = () => this.onVisibility(document.visibilityState === 'hidden');
      document.addEventListener('visibilitychange', onVis);
      this.off.push(() => document.removeEventListener('visibilitychange', onVis));
    }
    this.syncHost();
  }

  // ───────────── 기준 기기 ─────────────

  /** 지금 기준 기기 (명단 순서로, 접속해 있고 위치가 오고 있는 첫 사람). 내 채널이 끊겨 있으면 나는 빠진다 */
  hostId(now = serverNow()): string | undefined {
    return raceHostOf(this.roster, this.room.present, this.taken, this.heard, now);
  }

  isHost(now = serverNow()): boolean {
    return this.hostId(now) === this.room.me.id;
  }

  /** 화면이 가려지면 기준 기기를 내려놓는다 (다른 기기가 바로 넘겨받게 알린다). 다시 보이면 평소대로 돌아온다 */
  private onVisibility(hidden: boolean) {
    if (!hidden || this.results) return;
    this.heard.delete(this.room.me.id);
    this.syncHost();
    this.room.send({ t: 'away', r: this.round, f: this.room.me.id });
  }

  private hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** AI가 달리는 자리 (원래 AI이거나 사람 자리를 AI가 넘겨받음) */
  private aiSeat(slot: number): boolean {
    return this.roster[slot].id === null || this.taken[slot];
  }

  /**
   * 기준 기기면 AI 자리를 이 기기에서 계산하고(마지막으로 받은 위치에서 이어서),
   * 아니면 내려놓고 기준 기기가 보내는 위치를 받는다.
   */
  private syncHost(now = serverNow()) {
    const host = this.isHost(now);
    for (const r of this.roster) {
      if (!this.aiSeat(r.slot)) continue;
      // 원래 AI와, 앞 기준 기기가 AI로 계산해 보낸 자리는 멈춰 있던 시간을 따라잡는다
      if (host && this.control[r.slot] === 'remote') this.adopt(r.slot, r.id === null, r.id === null || this.aiSnap[r.slot]);
      else if (!host && this.control[r.slot] === 'ai') this.release(r.slot);
    }
  }

  /** 이 기기에서 계산하던 AI 자리를 내려놓는다: 지금 위치를 받은 위치로 남겨 두고 이어서 받은 위치를 그린다 */
  private release(slot: number) {
    const r = this.runners[slot];
    if (r) {
      const logO = this.obs.find((o) => o.kind === 'log');
      const lx = logO ? r.logX[logO.id] : undefined;
      const ts = Math.min(serverNow(), this.goAt + r.t * 1000);
      this.snaps[slot] = [{
        ts, x: r.x, v: r.v, st: r.state, jumpT: r.state === 'slide' ? r.slideT : r.jumpT, stunT: r.stunT, boostT: r.boostT,
        logX: lx === undefined ? -2 : lx, fin: r.finishMs ?? 0, mud: r.inMud,
      }];
      this.lastState[slot] = r.state;
      this.aiSnap[slot] = true;
    }
    this.runners[slot] = null;
    this.plans[slot] = null;
    this.control[slot] = 'remote';
  }

  /**
   * 이 자리를 AI로 이 기기에서 계산한다 (마지막으로 받은 위치에서 이어서).
   * catchUp: 마지막 받은 위치의 시각부터 계산해 따라잡는다 (기준 기기가 바뀐 경우). 아니면 지금부터 (방금 사람에게서 넘겨받음)
   */
  private adopt(slot: number, tuned: boolean, catchUp = tuned) {
    const last = this.snaps[slot][this.snaps[slot].length - 1];
    const r = newRunner();
    const t = Math.max(0, (serverNow() - this.goAt) / 1000);
    if (last) {
      r.x = last.x;
      r.v = last.v;
      // 받은 속도는 진흙·가속판이 곱해진 값: 원래 속도로 되돌려 이어 달린다
      const k = (last.mud ? MUD_FACTOR : 1) * (last.boostT > 0 ? BOOST_FACTOR : 1);
      r.base = Math.min(TOP_SPEED, last.v / k);
      r.state = last.st;
      r.jumpT = last.st === 'jump' ? last.jumpT : 0;
      r.slideT = last.st === 'slide' ? last.jumpT : 0;
      r.jumpV = last.v;
      r.stunT = last.stunT;
      r.boostT = last.boostT;
      r.finishMs = last.fin > 0 ? last.fin : null;
      // AI가 달리던 자리는 멈춰 있던 시간을 따라잡고(기준 기기가 바뀐 탓이므로), 방금 사람에게서 이어받은 AI는 지금부터 달린다
      r.t = catchUp ? Math.max(0, (last.ts - this.goAt) / 1000) : t;
      for (const o of this.obs) {
        if (o.kind === 'log' && last.logX > -2) r.logX[o.id] = last.logX;
        if (o.kind === 'boost' && o.x < r.x) r.usedBoost.push(o.id);
        // 넘어져 있던 자리의 방해물에는 다시 걸리지 않게
        if ((r.state === 'fall' || r.state === 'slip') && Math.abs(o.x - r.x) < 1.5) {
          r.immuneId = o.id;
          r.immuneT = r.stunT + 0.5;
        }
      }
    } else {
      // 받은 위치가 없으면: 원래 AI는 GO부터 계산해 따라잡고(계획이 정해져 있어 어느 기기에서나 같다), 넘겨받은 자리는 지금부터
      r.t = tuned ? 0 : t;
    }
    this.runners[slot] = r;
    this.plans[slot] = makeAiPlan(this.seed, slot, this.obs, tuned);
    this.control[slot] = 'ai';
  }

  // ───────────── 입력 ─────────────

  /** 버튼(출발·점프·슬라이딩). '준비'와 GO 사이에 누르면 실격. 출발 전에는 어느 버튼이든 출발 */
  press(kind: 'jump' | 'slide' = 'jump') {
    const me = this.mySlot >= 0 && this.control[this.mySlot] === 'me' ? this.runners[this.mySlot] : null;
    if (!me || this.results) return;
    const now = serverNow();
    if (now < this.readyAt) return;
    if (now < this.goAt) {
      if (me.state === 'wait') {
        foul(me);
        this.fouledAt = now;
        this.events.push({ slot: this.mySlot, ev: 'foul' });
        this.sendPos(now, true);
      }
      return;
    }
    this.pendingPress = kind;
  }

  // ───────────── 매 프레임 ─────────────

  /** GO부터 흐른 시간 (초, GO 전에는 음수) */
  clock(): number {
    return (serverNow() - this.goAt) / 1000;
  }

  phase(): 'intro' | 'ready' | 'go' | 'over' {
    if (this.results) return 'over';
    const now = serverNow();
    return now < this.readyAt ? 'intro' : now < this.goAt ? 'ready' : 'go';
  }

  update() {
    const now = serverNow();
    const t = (now - this.goAt) / 1000;
    // 화면이 보이고 매 프레임이 돌고, 실시간 채널로 받을 수 있는 동안만 나를 기준 기기 후보로 둔다.
    // (다시 연결하는 중에는 보내기만 REST 로 되고 받는 것이 없다: 남의 위치를 모르면서 기준 기기를 맡으면 안 된다)
    const linked = this.room.connected();
    if (!linked) {
      this.linkedSince = 0;
      this.heard.delete(this.room.me.id);
    } else {
      if (!this.linkedSince) this.linkedSince = now;
      if (!this.hidden()) this.heard.set(this.room.me.id, noteHeard(this.heard.get(this.room.me.id), now));
    }
    this.syncHost(now);
    if (t >= 0 && !this.results) {
      for (let s = 0; s < LANES; s++) {
        const r = this.runners[s];
        if (!r) continue;
        const mine = this.control[s] === 'me';
        const plan = this.plans[s];
        let first = true;
        // 고정 간격으로 지금 시각까지 계산 (화면이 잠깐 멈췄다 와도 따라잡는다)
        while (r.t + DT <= t + 1e-9) {
          const press: Press = mine ? (first ? this.pendingPress : false) : plan ? aiPress(r, this.obs, plan) : false;
          stepRunner(r, this.obs, press);
          if (mine && first) this.pendingPress = false;
          first = false;
        }
        for (const ev of r.events) this.events.push({ slot: s, ev });
        r.events.length = 0;
        if (mine && r.finishMs !== null && !this.record) this.submit(r.finishMs);
      }
    }
    // 상대의 상태가 바뀌면 화면용 알림을 만든다
    for (let s = 0; s < LANES; s++) {
      if (this.control[s] !== 'remote') continue;
      const st = this.view(s).state;
      if (st !== this.lastState[s]) {
        const ev = this.remoteEvent(s, st);
        if (ev) this.events.push({ slot: s, ev });
        this.lastState[s] = st;
      }
    }
    if (!this.results) {
      // 화면이 가려진 동안에는 보내지 않는다 (다른 기기가 조용해진 것을 보고 기준 기기를 넘겨받게)
      if (now >= this.readyAt && now - this.lastSend >= NET_INTERVAL_MS && !this.hidden()) this.sendPos(now);
      if (this.isHost(now)) {
        this.checkGone(now);
        this.checkEnd(now, t);
      } else {
        // 기준 기기가 없어지거나 멈춰 끝 알림이 오지 않으면 여기서 정한다
        const entries = this.entries();
        const first = Math.min(...entries.map((e) => e.timeMs ?? Infinity));
        if (fallbackEndDue(t, Number.isFinite(first) ? first : null)) this.finish(rankResults(entries), false);
      }
    }
  }

  private remoteEvent(slot: number, st: RunState): RaceEvent['ev'] | null {
    if (st === 'jump') return 'jump';
    if (st === 'slide') return 'slide';
    if (st === 'slip') return 'banana';
    if (st === 'done') return 'finish';
    if (st === 'foul') return 'foul';
    if (st === 'run') {
      const was = this.lastState[slot];
      return was === 'jump' ? 'land' : was === 'wait' ? 'start' : was === 'slide' ? 'slideEnd' : 'getup';
    }
    if (st === 'fall') {
      // 가까운 것이 낮은 막대인지 허들인지 통나무인지
      const x = this.view(slot).x;
      const near = (kind: Obstacle['kind']) => this.obs.some((o) => o.kind === kind && Math.abs(o.x - x) < 1.2);
      return near('bar') ? 'bar' : near('hurdle') ? 'hurdle' : 'log';
    }
    return null;
  }

  // ───────────── 화면용 ─────────────

  view(slot: number): RunnerView {
    const r = this.runners[slot];
    if (r) {
      const logO = this.obs.find((o) => o.kind === 'log');
      return {
        x: r.x, v: r.v, state: r.state, jumpT: r.jumpT, slideT: r.slideT, stunT: r.stunT, boost: r.boostT > 0, mud: r.inMud,
        logX: logO ? r.logX[logO.id] : undefined, finishMs: r.finishMs,
      };
    }
    const buf = this.snaps[slot];
    if (!buf.length) return { x: 0, v: 0, state: 'wait', jumpT: 0, slideT: 0, stunT: 0, boost: false, mud: false, logX: undefined, finishMs: null };
    const rt = serverNow() - INTERP_DELAY;
    let i = buf.length - 1;
    while (i > 0 && buf[i].ts > rt) i--;
    const a = buf[i];
    const b = buf[i + 1];
    const moving = a.st === 'run' || a.st === 'jump' || a.st === 'slide' || a.st === 'done';
    let x = a.x;
    let logX = a.logX;
    const since = Math.max(0, (rt - a.ts) / 1000);
    if (b && b.ts > a.ts && rt >= a.ts) {
      const k = Math.min(1, (rt - a.ts) / (b.ts - a.ts));
      x = a.x + (b.x - a.x) * k;
      if (a.logX >= 0 && b.logX >= 0) logX = a.logX + (b.logX - a.logX) * k;
    } else if (moving) {
      // 다음 위치가 아직 안 왔으면 속도로 조금 앞서 그린다 (최대 0.3초)
      x = a.x + a.v * Math.min(0.3, since);
    }
    return {
      x, v: a.v, state: a.st, jumpT: a.st === 'jump' ? a.jumpT + since : 0, slideT: a.st === 'slide' ? a.jumpT + since : 0, stunT: Math.max(0, a.stunT - since),
      boost: a.boostT > 0, mud: a.mud, logX: logX === -2 ? undefined : logX, finishMs: a.fin > 0 ? a.fin : null,
    };
  }

  /** 지금 상태로 본 순위 계산용 목록 */
  entries(): RaceEntry[] {
    return this.roster.map((r) => {
      const v = this.view(r.slot);
      if (v.state === 'foul') return { slot: r.slot, status: 'foul' as const, timeMs: null, x: 0 };
      if (v.finishMs !== null) return { slot: r.slot, status: 'finish' as const, timeMs: v.finishMs, x: TRACK_LEN };
      return { slot: r.slot, status: 'dnf' as const, timeMs: null, x: Math.min(TRACK_LEN, Math.round(v.x * 100) / 100) };
    });
  }

  /** 내가 지금 달리는 중인가 (출전했고 AI로 넘어가지 않음) */
  amRacing(): boolean {
    return this.mySlot >= 0 && this.control[this.mySlot] === 'me';
  }

  myChar(): ZodiacId | null {
    return this.mySlot >= 0 ? this.roster[this.mySlot].char : null;
  }

  // ───────────── 통신 ─────────────

  private pack(slot: number, r: Runner): number[] {
    const logO = this.obs.find((o) => o.kind === 'log');
    const lx = logO ? r.logX[logO.id] : undefined;
    const q = (n: number) => Math.round(n * 100) / 100;
    return [slot, q(r.x), q(r.v), STATES.indexOf(r.state), q(r.state === 'slide' ? r.slideT : r.jumpT), q(r.stunT), q(r.boostT), lx === undefined ? -2 : q(lx), r.finishMs ?? 0, r.inMud ? 1 : 0];
  }

  private sendPos(now: number, force = false) {
    if (!force && now - this.lastSend < NET_INTERVAL_MS) return;
    this.lastSend = now;
    const s: number[][] = [];
    for (let i = 0; i < LANES; i++) {
      const r = this.runners[i];
      if (r) s.push(this.pack(i, r));
    }
    if (!s.length) return;
    let tk = 0;
    this.taken.forEach((v, i) => v && (tk |= 1 << i));
    // nh: 내 채널이 끊겨 있다 (받는 쪽은 나를 기준 기기 후보에서 뺀다. 내 자리 위치는 그대로 받는다)
    const msg: NetMsg = { t: 'pos', r: this.round, f: this.room.me.id, ts: Math.round(now), tk, s };
    if (!this.room.connected()) msg.nh = 1;
    this.room.send(msg);
  }

  private onMsg(m: NetMsg) {
    if (m.r !== this.round && m.round !== this.round) return;
    if (m.t === 'pos') {
      const now = serverNow();
      if (typeof m.f === 'string' && m.f !== this.room.me.id && this.roster.some((r) => r.id === m.f)) {
        if (m.nh) this.heard.delete(m.f);
        else this.heard.set(m.f, noteHeard(this.heard.get(m.f), now));
      }
      // 넘겨받은 자리 표시는 내가 보는 기준 기기 것만 따른다
      if (this.fromHost(m.f, now)) {
        const tk = Number(m.tk) || 0;
        for (let i = 0; i < LANES; i++) if (tk & (1 << i)) this.applyTakeover(i);
      }
      this.syncHost(now);
      const host = this.hostId(now);
      for (const p of m.s as number[][]) {
        const slot = p?.[0];
        // 네트워크 값 검사: 자리 번호는 정수, 위치·속도는 유한한 수만
        if (!Number.isInteger(slot) || slot < 0 || slot >= LANES || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
        // 자기 자리는 그 사람만, AI 자리는 기준 기기만 보낸다
        const owner = this.roster[slot].id;
        if (owner && !this.taken[slot] && owner !== m.f) continue;
        // AI 자리는 내가 보는 기준 기기 것만 받는다 (내가 기준 기기면 내 계산이 맞다.
        // 두 기기가 잠깐 서로 기준 기기라고 보는 동안에도 각 기기는 한쪽만 따른다)
        if (this.aiSeat(slot) && host !== undefined && host !== m.f) continue;
        if (this.control[slot] !== 'remote') continue;
        const buf = this.snaps[slot];
        const snap: Snap = {
          ts: Number(m.ts), x: p[1], v: p[2], st: STATES[p[3]] ?? 'wait', jumpT: p[4], stunT: p[5], boostT: p[6], logX: p[7], fin: p[8], mud: p[9] === 1,
        };
        if (buf.length && snap.ts <= buf[buf.length - 1].ts) continue;
        buf.push(snap);
        if (buf.length > 30) buf.shift();
        this.aiSnap[slot] = !owner || (this.taken[slot] && owner !== m.f);
      }
    } else if (m.t === 'away') {
      // 그 기기의 화면이 가려졌다: 기다리지 않고 바로 다음 사람이 기준 기기를 넘겨받는다
      if (typeof m.f === 'string' && m.f !== this.room.me.id) {
        this.heard.delete(m.f);
        this.syncHost();
      }
    } else if (m.t === 'takeover') {
      if (this.fromHost(m.f)) this.applyTakeover(Number(m.slot));
    } else if (m.t === 'end') {
      // 끝과 순위도 내가 보는 기준 기기 것만 (못 받으면 fallbackEndDue 로 스스로 끝낸다)
      if (!this.fromHost(m.f)) return;
      // 네트워크로 온 값은 그대로 화면(HTML)에 넣지 않는다: 숫자·정해진 값만 골라 쓴다
      if (Array.isArray(m.results)) {
        const n = this.roster.length;
        const clean: RankedEntry[] = [];
        for (const raw of m.results as unknown[]) {
          const e = (raw ?? {}) as Record<string, unknown>;
          const slot = Number(e.slot);
          const place = Number(e.place);
          const status = e.status === 'finish' || e.status === 'dnf' || e.status === 'foul' ? e.status : null;
          const timeMs = e.timeMs === null || e.timeMs === undefined ? null : Number(e.timeMs);
          const x = Number(e.x);
          if (!Number.isInteger(slot) || slot < 0 || slot >= n || clean.some((c) => c.slot === slot)) continue;
          if (!Number.isInteger(place) || place < 1 || place > n || !status || !Number.isFinite(x)) continue;
          if (status === 'finish' && (timeMs === null || !Number.isFinite(timeMs) || timeMs <= 0)) continue;
          clean.push({ slot, place, status, timeMs: status === 'finish' ? timeMs : null, x: Math.max(0, Math.min(200, x)) });
        }
        if (clean.length) this.finish(clean);
      }
    }
  }

  /** 내가 보는 기준 기기가 보낸 것인가 (기준 기기를 모르면 받는다) */
  private fromHost(f: unknown, now = serverNow()): boolean {
    const host = this.hostId(now);
    return host === undefined || host === f;
  }

  /** 사람 자리를 AI가 이어 달린다 */
  private applyTakeover(slot: number) {
    if (!(slot >= 0 && slot < LANES) || this.taken[slot] || this.roster[slot].id === null) return;
    this.taken[slot] = true;
    this.aiSnap[slot] = false;
    if (slot === this.mySlot && this.control[slot] === 'me') {
      // 내 자리가 넘어갔다: 구경만 하고 기록은 남기지 않는다
      const r = this.runners[slot]!;
      this.snaps[slot] = [{ ts: serverNow(), x: r.x, v: r.v, st: r.state, jumpT: r.state === 'slide' ? r.slideT : r.jumpT, stunT: r.stunT, boostT: r.boostT, logX: -2, fin: r.finishMs ?? 0, mud: r.inMud }];
      this.runners[slot] = null;
      this.control[slot] = 'remote';
      this.onLostSeat?.();
    }
    if (this.isHost() && this.control[slot] === 'remote') this.adopt(slot, false, false);
  }

  /** 기준 기기: 접속이 끊긴 사람을 AI로 넘긴다 */
  private checkGone(now: number) {
    // 내 채널이 끊겨 있으면 남이 조용한 것인지 내가 못 받는 것인지 모른다
    if (!this.room.connected() || !this.linkedSince) return;
    for (const r of this.roster) {
      if (!r.id || r.id === this.room.me.id || this.taken[r.slot]) continue;
      const buf = this.snaps[r.slot];
      const last = buf[buf.length - 1];
      // 다시 이어진 뒤로는 그때부터 잰다 (끊긴 동안 못 받은 것을 '조용했다'고 보지 않게)
      const silent = now > this.goAt && now - Math.max(last?.ts ?? 0, this.goAt, this.linkedSince) > SILENT_MS;
      if (this.room.present.has(r.id) && !silent) {
        this.goneSince.delete(r.slot);
        continue;
      }
      if (!this.goneSince.has(r.slot)) this.goneSince.set(r.slot, now);
      if (silent || now - this.goneSince.get(r.slot)! > GONE_MS) {
        // 이미 도착했거나 실격이면 그대로 둔다
        const st = this.view(r.slot).state;
        if (st === 'done' || st === 'foul') continue;
        this.room.send({ t: 'takeover', round: this.round, f: this.room.me.id, slot: r.slot });
        this.applyTakeover(r.slot);
      }
    }
  }

  /** 기준 기기: 경기 끝 판정 */
  private checkEnd(now: number, t: number) {
    const entries = this.entries();
    const humans = this.roster.filter((r) => r.id && !this.taken[r.slot]);
    const allFoul = humans.length > 0 && humans.every((r) => entries[r.slot].status === 'foul');
    const allDone = entries.every((e) => e.status !== 'dnf');
    const first = Math.min(...entries.map((e) => e.timeMs ?? Infinity));
    let end = false;
    if (allFoul || allDone) {
      // 사람 전원 실격이면 바로 끝 (실격 표시를 볼 시간만 준다)
      if (!this.endAt) this.endAt = now + (allFoul ? 1500 : 1200);
      end = now >= this.endAt;
    } else this.endAt = 0;
    if (t >= END_AFTER_GO) end = true;
    if (Number.isFinite(first) && t >= first / 1000 + END_AFTER_FIRST) end = true;
    if (!end) return;
    const results = rankResults(this.entries());
    const msg = { t: 'end', round: this.round, f: this.room.me.id, results };
    this.room.send(msg);
    // 놓친 기기를 위해 몇 번 더 보낸다
    for (const d of [400, 1200]) setTimeout(() => this.room.send(msg), d);
    this.finish(results);
  }

  /** sure: 기준 기기가 정한 결과인가 (끝 알림 없이 스스로 끝냈으면 false — 점수판을 퍼뜨리지 않는다) */
  private finish(results: RankedEntry[], sure = true) {
    if (this.results) return;
    this.results = results;
    // 연속전 점수판에 이 판의 점수를 더한다 (기록 제출·순위 판정과는 따로)
    this.room.addResult(this.round, this.roster, results, this.taken, sure);
    this.room.raceOver(this.round);
    this.onOver?.(results);
  }

  private submit(ms: number) {
    const char = this.myChar();
    if (!char) return;
    this.record = this.api.submit(this.room.key, this.round, ms, char);
    const day = this.dailyDay;
    // 서버가 받은 완주 기록만 오늘의 도전에 넣는다 (083_race_daily.sql 이 race_runs 를 읽는다)
    if (day) this.dailySaved = this.record.then((rec) => (rec.saved ? this.api.dailySubmit(this.room.key, this.round, day) : null)).catch(() => null);
    this.sendPos(serverNow(), true);
  }

  /** 실격한 뒤 흐른 시간 (ms). 실격이 아니면 0 */
  fouledFor(): number {
    return this.fouledAt ? serverNow() - this.fouledAt : 0;
  }

  dispose() {
    this.off.forEach((f) => f());
    this.onOver = null;
    this.onLostSeat = null;
  }
}

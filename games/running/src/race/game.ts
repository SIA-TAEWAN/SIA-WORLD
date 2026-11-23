import { makeAiPlan, aiPress, type AiPlan } from '../game/ai';
import { badgesOf, newTally, tallyEvent, type Badge } from '../game/badges';
import { DT, END_AFTER_FIRST, END_AFTER_GO, TRACK_LEN, type ZodiacId } from '../game/constants';
import { rankResults, type RaceEntry, type RankedEntry } from '../game/ranking';
import { foul, newRunner, stepRunner, type Press, type RunState, type Runner, type SimEvent } from '../game/sim';
import { makeTrack, type Obstacle } from '../game/track';
import { GhostPlayer, GhostRecorder, pressKindOf, replayGhost, type Ghost } from '../game/ghost';
import { serverNow, type RaceApi, type SubmitResult } from '../net/api';
import { submitGhost, submitRun, type GhostRun, type RosterEntry, type SoloStart } from '../net/solo';

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

export type RaceEvent = { slot: number; ev: SimEvent | 'foul' };

/**
 * 한 판의 진행 (오늘의 도전: 나 + AI. 모두 이 기기에서 계산한다).
 * - 고정 간격(DT) 물리, 서버 시각(serverNow) 기준 '준비'·GO.
 * - 화면이 가려졌다 돌아오면 그동안의 걸음을 한꺼번에 따라잡는다 (update 의 while 루프).
 * - GO 전에 누르면 실격. 모두 도착(또는 내가 실격)하거나, 1등 도착 뒤 15초 · GO 뒤 90초에 끝난다.
 * - 고스트 자리(role 'ghost'): 그날 1위가 누른 걸음 기록(start.ghost)을 같은 고정 걸음 루프에서 그대로 다시 누른다.
 * - 내가 누른 것은 걸음 번호(GO 뒤 첫 걸음 = 1)로 적어 두었다가(GhostRecorder), 완주하면 고스트로 올린다.
 */
export class RaceGame {
  readonly obs: Obstacle[];
  readonly roster: RosterEntry[];
  readonly round: number;
  readonly seed: number;
  readonly readyAt: number;
  readonly goAt: number;
  readonly key: string;
  /** 오늘의 도전 날짜 ('YYYY-MM-DD'). 완주 기록이 서버에 올라가면 그날 기록으로도 넣는다 */
  readonly dailyDay: string;
  /** 내 자리 */
  readonly mySlot: number;
  /** 이번 판에 내가 한 일을 센 것 (결과 화면 배지용) */
  private tally = newTally();
  private runners: Runner[] = [];
  private plans: (AiPlan | null)[] = [];
  /** 고스트 자리의 버튼 (자리 번호 → 재생기) */
  private ghosts: (GhostPlayer | null)[] = [];
  /** 자리마다 GO 뒤 계산한 걸음 수 (고스트 기록·재생의 걸음 번호) */
  private steps: number[] = [];
  /** 이번 판에 내가 누른 것 (완주하면 고스트로) */
  private recorder = new GhostRecorder();
  /** 같이 달린 고스트 (없으면 null) */
  readonly ghost: GhostRun | null;
  /** 내 고스트를 올린 결과 (완주하고 오늘의 도전 기록이 들어갔을 때) */
  ghostSaved: Promise<boolean> | null = null;
  private pendingPress: Press = false;
  private endAt = 0;
  private fouledAt = 0;
  /** 이번 프레임에 생긴 일 (화면·소리에서 읽고 비운다) */
  events: RaceEvent[] = [];
  /** 끝났으면 최종 순위 */
  results: RankedEntry[] | null = null;
  /** 내 기록을 올린 결과 (도착했을 때) */
  record: Promise<SubmitResult> | null = null;
  /** 오늘의 도전 기록을 넣은 결과 (들어갔으면 기록된 날짜, 아니면 null) */
  dailySaved: Promise<string | null> | null = null;
  onOver: ((r: RankedEntry[]) => void) | null = null;

  constructor(
    private api: RaceApi,
    start: SoloStart,
  ) {
    this.key = start.key;
    this.round = start.round;
    this.seed = start.seed;
    this.readyAt = start.readyAt;
    this.goAt = start.goAt;
    this.roster = start.roster;
    this.dailyDay = start.day;
    this.obs = makeTrack(start.seed);
    this.mySlot = start.roster.find((r) => r.role === 'me')?.slot ?? -1;
    this.ghost = start.ghost ?? null;
    for (const r of start.roster) {
      this.runners[r.slot] = newRunner();
      this.steps[r.slot] = 0;
      this.ghosts[r.slot] = r.role === 'ghost' && this.ghost ? new GhostPlayer(this.ghost.ghost) : null;
      // AI 계획은 (트랙 시드, 자리)로 정한다: 같은 날 같은 자리의 AI 는 늘 같게 달린다
      this.plans[r.slot] = r.role === 'ai' || (r.role === 'ghost' && !this.ghost) ? makeAiPlan(this.seed, r.slot, this.obs) : null;
    }
  }

  // ───────────── 입력 ─────────────

  /** 버튼(출발·점프·슬라이딩). '준비'와 GO 사이에 누르면 실격. 출발 전에는 어느 버튼이든 출발 */
  press(kind: 'jump' | 'slide' = 'jump') {
    const me = this.mySlot >= 0 ? this.runners[this.mySlot] : null;
    if (!me || this.results) return;
    const now = serverNow();
    if (now < this.readyAt) return;
    if (now < this.goAt) {
      if (me.state === 'wait') {
        foul(me);
        this.fouledAt = now;
        this.events.push({ slot: this.mySlot, ev: 'foul' });
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
    if (t >= 0 && !this.results) {
      for (const entry of this.roster) {
        const s = entry.slot;
        const r = this.runners[s];
        const mine = s === this.mySlot;
        const plan = this.plans[s];
        const ghost = this.ghosts[s];
        let first = true;
        // 고정 간격으로 지금 시각까지 계산 (화면이 잠깐 멈췄거나 가려졌다 와도 따라잡는다)
        while (r.t + DT <= t + 1e-9) {
          const step = ++this.steps[s];
          const press: Press = mine ? (first ? this.pendingPress : false) : ghost ? ghost.press(step) : plan ? aiPress(r, this.obs, plan) : false;
          const seen = r.events.length;
          stepRunner(r, this.obs, press);
          if (mine) {
            // 배지용 집계: 생긴 걸음의 시각으로 센다
            for (let i = seen; i < r.events.length; i++) tallyEvent(this.tally, r.events[i], r.t);
            // 고스트 기록: 누른 것이 실제로 들어간 걸음만 (출발·점프·슬라이딩이 생긴 걸음)
            if (press) {
              const kind = pressKindOf(r.events.slice(seen));
              if (kind !== null) this.recorder.recordPress(step, kind);
            }
            if (first) this.pendingPress = false;
          }
          first = false;
        }
        for (const ev of r.events) this.events.push({ slot: s, ev });
        r.events.length = 0;
        if (mine && r.finishMs !== null && !this.record) this.submit(r.finishMs);
      }
    }
    if (!this.results) this.checkEnd(now, t);
  }

  // ───────────── 화면용 ─────────────

  view(slot: number): RunnerView {
    const r = this.runners[slot];
    if (!r) return { x: 0, v: 0, state: 'wait', jumpT: 0, slideT: 0, stunT: 0, boost: false, mud: false, logX: undefined, finishMs: null };
    const logO = this.obs.find((o) => o.kind === 'log');
    return {
      x: r.x, v: r.v, state: r.state, jumpT: r.jumpT, slideT: r.slideT, stunT: r.stunT, boost: r.boostT > 0, mud: r.inMud,
      logX: logO ? r.logX[logO.id] : undefined, finishMs: r.finishMs,
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

  /** 내가 달리는 중인가 (혼자 판이라 늘 내 자리가 있다) */
  amRacing(): boolean {
    return this.mySlot >= 0;
  }

  /** 내가 이번 판에 받은 배지. finished: 결과에 적힌 내 완주 여부 */
  badges(finished = true): Badge[] {
    if (this.mySlot < 0) return [];
    return badgesOf(this.tally, this.obs.filter((o) => o.kind === 'boost').length, finished);
  }

  myChar(): ZodiacId | null {
    return this.mySlot >= 0 ? this.roster[this.mySlot].char : null;
  }

  // ───────────── 끝 판정 · 기록 ─────────────

  private checkEnd(now: number, t: number) {
    const entries = this.entries();
    const mine = this.mySlot >= 0 ? entries[this.mySlot] : null;
    const iFouled = mine?.status === 'foul';
    const allDone = entries.every((e) => e.status !== 'dnf');
    const first = Math.min(...entries.map((e) => e.timeMs ?? Infinity));
    let end = false;
    if (iFouled || allDone) {
      // 내가 실격이면 바로 끝 (실격 표시를 볼 시간만 준다)
      if (!this.endAt) this.endAt = now + (iFouled ? 1500 : 1200);
      end = now >= this.endAt;
    }
    if (t >= END_AFTER_GO) end = true;
    if (Number.isFinite(first) && t >= first / 1000 + END_AFTER_FIRST) end = true;
    if (end) this.finish(rankResults(this.entries()));
  }

  private finish(results: RankedEntry[]) {
    if (this.results) return;
    this.results = results;
    this.onOver?.(results);
  }

  private submit(ms: number) {
    const char = this.myChar();
    if (!char) return;
    const r = submitRun(this.api, this.key, this.round, ms, char, this.dailyDay);
    this.record = r.record;
    this.dailySaved = r.dailySaved;
    // 내 고스트: 다시 달려 같은 기록이 나올 때만 (오늘의 도전 기록이 들어간 판만 올린다)
    const g = this.myGhost(ms);
    if (g) this.ghostSaved = submitGhost(this.api, this.key, this.round, g, this.dailySaved).catch(() => false);
  }

  /** 이번 판의 내 고스트 (완주했을 때). 기록이 넘쳤거나 다시 달린 기록이 다르면 null */
  myGhost(ms: number): Ghost | null {
    const char = this.myChar();
    if (!char) return null;
    const g = this.recorder.build(this.dailyDay, char, ms);
    if (!g || replayGhost(g, this.obs).finishMs !== ms) return null;
    return g;
  }

  /** 실격한 뒤 흐른 시간 (ms). 실격이 아니면 0 */
  fouledFor(): number {
    return this.fouledAt ? serverNow() - this.fouledAt : 0;
  }

  dispose() {
    this.onOver = null;
  }
}

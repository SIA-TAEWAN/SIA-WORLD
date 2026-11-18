import { aiInput, makeAi, type Ai } from '../game/ai';
import { COUNTDOWN_SEC, STEP_MS, type ZodiacId } from '../game/constants';
import { createState, newClock, step, ticksFor, type Input, type Side, type SimEvent, type SimState } from '../game/sim';
import type { Pos } from '../game/sync';

/** 한 자리의 선수 */
export interface Fighter {
  /** 사람이면 사용자 ID (AI는 없음) */
  id?: string;
  name: string;
  char: ZodiacId;
  ai: boolean;
}

/** 경기 설정 */
export interface MatchSetup {
  /** ai: AI와 연습 · online: 사람과 온라인 대전 */
  mode: 'ai' | 'online';
  /** [왼쪽, 오른쪽] */
  fighters: [Fighter, Fighter];
  /** 내가 조작하는 자리 */
  mySide: Side;
  /** 첫 서브·AI 난수의 시드 */
  seed: number;
  /** 배경 번호 0~2 */
  bg: number;
  /** 온라인: 경기 번호와 시작 시각 (서버 시각 ms) */
  matchNo?: number;
  startAt?: number;
}

/** 경기 결과 (결과 화면용) */
export interface MatchResult {
  setup: MatchSetup;
  score: [number, number];
  winner: Side;
  /** normal: 두 사람이 끝까지 함 · leave: 한 사람이 나가서(또는 연결이 끊겨) AI가 그 자리를 이어받아 끝냄 */
  reason: 'normal' | 'leave';
  /** leave: 나간 사람의 자리 (그 자리의 캐릭터를 AI가 대신했다) */
  leaver?: Side;
  /** 온라인: 서버에 결과를 올린 결과 (AI전·테스트 모드는 없음) */
  record?: Promise<RecordOutcome>;
}

/** 결과 저장이 어떻게 됐는가 */
export interface RecordOutcome {
  /**
   * saved 기록됨 · void 두 기기의 결과가 달라 기록 안 됨 · failed 올리지 못함 · none 올릴 것이 없음(테스트 모드)
   * · left 내가 나간 경기(상대가 보고한다) · limit 같은 상대와 하루 30판을 채워 기록되지 않음
   */
  state: 'saved' | 'void' | 'failed' | 'none' | 'left' | 'limit';
  /** 내 전적 (읽을 수 있었으면) */
  wins?: number;
  losses?: number;
}

/** 화면에 알릴 일: 계산 중에 생긴 일 + 카운트다운 + AI 인계(takeover: 그 자리의 사람이 나가서 AI가 대신한다) */
export type MatchEvent = SimEvent | { t: 'count'; n: number } | { t: 'go' } | { t: 'takeover'; side: Side };

export type { Pos };

/**
 * 한 경기 진행: 카운트다운 → 경기 → 끝. 화면 프레임마다 update(지금 시각)를 부르면
 * 흐른 시간만큼 고정 간격(1/60초) 계산을 돌린다. 화면(Phaser·DOM)은 모른다.
 * 이 클래스는 AI 대전. 온라인 대전은 match/online.ts 의 OnlineMatch 가 이어받는다.
 */
export class Match {
  state: SimState;
  /** 화면이 가져가서 비우는 알림 목록 */
  readonly events: MatchEvent[] = [];
  /** 내 조작 (화면이 채운다) */
  readonly input: Input = { left: false, right: false, jump: false };
  phase: 'countdown' | 'play' | 'over' = 'countdown';
  /** 잠깐 멈춤 (AI 대전에서 '그만둘까요?' 창이 떠 있는 동안) */
  paused = false;
  /** 온라인: 상대 연결을 기다리는 중이면 이탈 처리까지 남은 초 (아니면 0) */
  waitingSec = 0;
  onOver: ((result: MatchResult) => void) | null = null;

  protected ai: Ai | null;
  private readonly clock = newClock();
  private lastMs = -1;
  private countMs = COUNTDOWN_SEC * 1000;
  private countShown = 0;
  /** 바로 앞 틱의 위치 (틱 사이를 부드럽게 그리려고) */
  protected prevBall: Pos;
  protected prevPlayers: [Pos, Pos];
  /** 다음 틱까지 얼마나 왔는가 (0~1) */
  protected frac = 0;

  constructor(readonly setup: MatchSetup) {
    this.state = createState(setup.seed);
    const aiSide = setup.fighters[0].ai ? 0 : setup.fighters[1].ai ? 1 : -1;
    this.ai = aiSide >= 0 ? makeAi(aiSide as Side, (setup.seed ^ 0x9e3779b9) >>> 0) : null;
    this.prevBall = { x: this.state.ball.x, y: this.state.ball.y };
    this.prevPlayers = [{ ...this.state.players[0] }, { ...this.state.players[1] }];
  }

  get mySide(): Side {
    return this.setup.mySide;
  }

  /** 카운트다운: 남은 시간(ms)을 받아 3·2·1 알림을 낸다. 끝났으면 true */
  protected countdown(leftMs: number): boolean {
    const n = Math.ceil(leftMs / 1000);
    if (n >= 1 && n <= COUNTDOWN_SEC && n !== this.countShown) {
      this.countShown = n;
      this.events.push({ t: 'count', n });
    }
    if (leftMs > 0) return false;
    this.phase = 'play';
    this.events.push({ t: 'go' }, { t: 'serve', side: this.state.server });
    return true;
  }

  /** 틱을 계산하기 직전에 지금 위치를 적어 둔다 */
  protected savePrev() {
    const s = this.state;
    this.prevBall = { x: s.ball.x, y: s.ball.y };
    this.prevPlayers = [{ x: s.players[0].x, y: s.players[0].y }, { x: s.players[1].x, y: s.players[1].y }];
  }

  protected finish(reason: 'normal' | 'leave', winner: Side, leaver?: Side) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    const s = this.state;
    this.onOver?.({ setup: this.setup, score: [s.score[0], s.score[1]], winner, reason, leaver });
  }

  /** nowMs: performance.now() 같은, 계속 늘어나는 시각 */
  update(nowMs: number) {
    const dt = this.lastMs < 0 ? 0 : Math.min(250, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    if (this.paused || this.phase === 'over') return;

    if (this.phase === 'countdown') {
      this.countMs -= dt;
      this.countdown(this.countMs);
      return;
    }

    const s = this.state;
    for (let n = ticksFor(this.clock, dt); n > 0; n--) {
      this.savePrev();
      const other = this.ai ? aiInput(this.ai, s) : this.input;
      step(s, this.mySide === 0 ? [this.input, other] : [other, this.input], this.events as SimEvent[]);
      if (s.phase === 'over') {
        this.finish('normal', s.winner as Side);
        break;
      }
    }
    this.frac = Math.min(1, this.clock.acc / STEP_MS);
  }

  /** 경기 중에 내가 나간다 (온라인: 상대에게 알린다) */
  quit() {}
  /** 화면을 떠날 때 정리 */
  dispose() {}

  protected lerp(prev: Pos, cur: Pos): Pos {
    // 서브처럼 한 번에 멀리 옮겨진 것은 그대로 보여 준다
    if (this.phase !== 'play' || Math.abs(cur.x - prev.x) > 60 || Math.abs(cur.y - prev.y) > 60) return { x: cur.x, y: cur.y };
    return { x: prev.x + (cur.x - prev.x) * this.frac, y: prev.y + (cur.y - prev.y) * this.frac };
  }

  /** 지금 그릴 공 위치 (틱 사이를 이어서) */
  ballView(): Pos {
    return this.lerp(this.prevBall, this.state.ball);
  }
  playerView(side: Side): Pos {
    return this.lerp(this.prevPlayers[side], this.state.players[side]);
  }
}

import { COUNTDOWN_SEC, STEP_MS, type ZodiacId } from '../game/constants';
import { NO_INPUT, createState, newClock, step, ticksFor, type Input, type Side, type SimEvent, type SimState } from '../game/sim';

/** 한 자리의 선수 */
export interface Fighter {
  name: string;
  char: ZodiacId;
  ai: boolean;
}

/** 경기 설정. mode: 지금은 AI 대전뿐 (3단계에서 'online' 추가) */
export interface MatchSetup {
  mode: 'ai';
  /** [왼쪽, 오른쪽] */
  fighters: [Fighter, Fighter];
  /** 내가 조작하는 자리 */
  mySide: Side;
  /** 첫 서브·AI 난수의 시드 */
  seed: number;
}

/** 경기 결과 (결과 화면용) */
export interface MatchResult {
  setup: MatchSetup;
  score: [number, number];
  winner: Side;
}

/** 화면에 알릴 일: 계산 중에 생긴 일 + 카운트다운 */
export type MatchEvent = SimEvent | { t: 'count'; n: number } | { t: 'go' };

export interface Pos {
  x: number;
  y: number;
}

/**
 * 한 경기 진행: 카운트다운 → 경기 → 끝. 화면 프레임마다 update(지금 시각)를 부르면
 * 흐른 시간만큼 고정 간격(1/60초) 계산을 돌린다. 화면(Phaser·DOM)은 모른다.
 */
export class Match {
  readonly state: SimState;
  /** 화면이 가져가서 비우는 알림 목록 */
  readonly events: MatchEvent[] = [];
  /** 내 조작 (화면이 채운다) */
  readonly input: Input = { left: false, right: false, jump: false };
  phase: 'countdown' | 'play' | 'over' = 'countdown';
  /** 잠깐 멈춤 (AI 대전에서 '그만둘까요?' 창이 떠 있는 동안) */
  paused = false;
  onOver: ((result: MatchResult) => void) | null = null;

  private readonly clock = newClock();
  private lastMs = -1;
  private countMs = COUNTDOWN_SEC * 1000;
  private countShown = 0;
  /** 바로 앞 틱의 위치 (틱 사이를 부드럽게 그리려고) */
  private prevBall: Pos;
  private prevPlayers: [Pos, Pos];

  constructor(readonly setup: MatchSetup) {
    this.state = createState(setup.seed);
    this.prevBall = { x: this.state.ball.x, y: this.state.ball.y };
    this.prevPlayers = [{ ...this.state.players[0] }, { ...this.state.players[1] }];
  }

  get mySide(): Side {
    return this.setup.mySide;
  }

  /** nowMs: performance.now() 같은, 계속 늘어나는 시각 */
  update(nowMs: number) {
    const dt = this.lastMs < 0 ? 0 : Math.min(250, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    if (this.paused || this.phase === 'over') return;

    if (this.phase === 'countdown') {
      this.countMs -= dt;
      const n = Math.ceil(this.countMs / 1000);
      if (n >= 1 && n !== this.countShown) {
        this.countShown = n;
        this.events.push({ t: 'count', n });
      }
      if (this.countMs <= 0) {
        this.phase = 'play';
        this.events.push({ t: 'go' }, { t: 'serve', side: this.state.server });
      }
      return;
    }

    const s = this.state;
    for (let n = ticksFor(this.clock, dt); n > 0; n--) {
      this.prevBall = { x: s.ball.x, y: s.ball.y };
      this.prevPlayers = [{ x: s.players[0].x, y: s.players[0].y }, { x: s.players[1].x, y: s.players[1].y }];
      // 1단계: 상대는 가만히 서 있다 (2단계에서 AI가 조작한다)
      const other = NO_INPUT;
      step(s, this.mySide === 0 ? [this.input, other] : [other, this.input], this.events as SimEvent[]);
      if (s.phase === 'over') {
        this.phase = 'over';
        this.onOver?.({ setup: this.setup, score: [s.score[0], s.score[1]], winner: s.winner as Side });
        break;
      }
    }
  }

  private lerp(prev: Pos, cur: Pos): Pos {
    const a = Math.min(1, this.clock.acc / STEP_MS);
    // 서브처럼 한 번에 멀리 옮겨진 것은 그대로 보여 준다
    if (this.phase !== 'play' || Math.abs(cur.x - prev.x) > 60 || Math.abs(cur.y - prev.y) > 60) return { x: cur.x, y: cur.y };
    return { x: prev.x + (cur.x - prev.x) * a, y: prev.y + (cur.y - prev.y) * a };
  }

  /** 지금 그릴 공 위치 (틱 사이를 이어서) */
  ballView(): Pos {
    return this.lerp(this.prevBall, this.state.ball);
  }
  playerView(side: Side): Pos {
    return this.lerp(this.prevPlayers[side], this.state.players[side]);
  }
}

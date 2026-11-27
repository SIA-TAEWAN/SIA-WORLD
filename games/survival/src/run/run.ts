import { TICK } from '../data/balance';
import { canReroll } from '../game/levelup';
import { createRun, makeInput, step, summarize, type RunSummary } from '../game/sim';
import type { Ev, Input, RunConfig, State } from '../game/state';

/** 고를 수 있는 배속. 가장 빠른 값은 서버의 max_speed (game/progress.ts 의 LIMITS) 와 같아야 한다 — 서버는 그보다 빨리 끝난 판을 받지 않는다 */
export const SPEEDS = [1, 2] as const;
export type Speed = (typeof SPEEDS)[number];
/** 느린 기기: 1배속일 때 한 프레임에 이만큼까지만 걷는다 (배속이면 그 배수) */
const MAX_STEPS = 4;

/**
 * 한 판의 진행: 실제 시간에 맞춰 계산(step)을 고정 걸음(1/60초)으로 돌린다.
 * 화면(scenes/GameScene.ts)은 매 프레임 update() 를 부른 뒤 state 를 그리기만 한다.
 * 배속(speed)은 실제 시간 1초에 걷는 걸음 수만 늘린다. 걸음 하나의 계산은 그대로라, 같은 입력이면 몇 배속이든 결과가 같다.
 */
export class Run {
  readonly state: State;
  readonly input: Input = makeInput();
  /** 일시정지 (창이 떠 있는 동안) */
  paused = false;
  /** 배속: 실제 시간 1초에 게임 시간이 이만큼 흐른다 */
  speed: Speed = 1;
  /** 걸음마다 생긴 일 (소리·연출) */
  onEvent: (e: Ev, s: State) => void = () => {};
  /** 점검용: 최근 프레임의 계산·그리기 시간 (ms) */
  readonly perf = { simMs: 0, drawMs: 0, frameMs: 0, steps: 0 };
  private last = 0;
  private acc = 0;

  constructor(readonly cfg: RunConfig) {
    this.state = createRun(cfg);
  }

  get over() {
    return this.state.phase === 'over' || this.state.phase === 'clear';
  }

  private stepOnce() {
    step(this.state, this.input);
    const s = this.state;
    for (let i = 0; i < s.evN; i++) this.onEvent(s.events[i], s);
  }

  /** 매 프레임: 흐른 시간만큼 걸음을 진행한다 (레벨업·일시정지 중에는 멈춘다) */
  update(nowMs: number) {
    const dt = this.last ? Math.min(0.25, (nowMs - this.last) / 1000) : 0;
    this.last = nowMs;
    this.perf.steps = 0;
    if (this.paused || this.state.phase !== 'play') {
      this.acc = 0;
      this.perf.simMs = 0;
      return;
    }
    this.acc += dt * this.speed;
    const t0 = performance.now();
    // 느린 기기: 한 프레임에 4걸음(2배속이면 8걸음)까지만 (그보다 밀리면 게임이 느려질 뿐 건너뛰지 않는다)
    const max = MAX_STEPS * this.speed;
    let n = 0;
    while (this.acc >= TICK && n < max && this.state.phase === 'play') {
      this.acc -= TICK;
      this.stepOnce();
      n++;
    }
    if (n === max) this.acc = 0;
    this.perf.steps = n;
    this.perf.simMs = performance.now() - t0;
  }

  /** 레벨업 카드를 고른다 */
  pick(i: number) {
    if (this.state.phase !== 'levelup' || i < 0 || i >= this.state.cardN) return;
    this.input.pick = i;
    this.stepOnce();
    this.input.pick = -1;
  }

  /** 레벨업 카드를 다시 뽑는다 */
  reroll() {
    if (!canReroll(this.state)) return;
    this.input.reroll = true;
    this.stepOnce();
    this.input.reroll = false;
  }

  summary(): RunSummary {
    return summarize(this.state);
  }
}

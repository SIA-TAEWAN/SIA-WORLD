import { TICK } from '../data/balance';
import { createRun, makeInput, step, summarize, type RunSummary } from '../game/sim';
import type { Ev, Input, RunConfig, State } from '../game/state';

/**
 * 한 판의 진행: 실제 시간에 맞춰 계산(step)을 고정 걸음(1/60초)으로 돌린다.
 * 화면(scenes/GameScene.ts)은 매 프레임 update() 를 부른 뒤 state 를 그리기만 한다.
 */
export class Run {
  readonly state: State;
  readonly input: Input = makeInput();
  /** 일시정지 (창이 떠 있는 동안) */
  paused = false;
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
    this.acc += dt;
    const t0 = performance.now();
    // 느린 기기: 한 프레임에 4걸음까지만 (그보다 밀리면 게임이 느려질 뿐 건너뛰지 않는다)
    let n = 0;
    while (this.acc >= TICK && n < 4 && this.state.phase === 'play') {
      this.acc -= TICK;
      this.stepOnce();
      n++;
    }
    if (n === 4) this.acc = 0;
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
    if (this.state.phase !== 'levelup' || this.state.rerolls <= 0) return;
    this.input.reroll = true;
    this.stepOnce();
    this.input.reroll = false;
  }

  summary(): RunSummary {
    return summarize(this.state);
  }
}

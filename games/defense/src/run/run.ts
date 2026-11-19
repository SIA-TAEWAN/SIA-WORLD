import { TICK } from '../data/balance';
import { command, createGame, isOver, step, summarize, type RunSummary } from '../game/sim';
import type { Cmd, Ev, GameConfig, State } from '../game/state';

/** 고를 수 있는 배속 (PRD 3장: 1배 / 2배) */
export const SPEEDS = [1, 2] as const;
export type Speed = (typeof SPEEDS)[number];
/** 느린 기기: 1배속일 때 한 프레임에 이만큼까지만 걷는다 (배속이면 그 배수) */
const MAX_STEPS = 4;

/**
 * 한 판의 진행: 실제 시간에 맞춰 계산(step)을 고정 걸음(1/60초)으로 돌린다.
 * 화면(scenes/GameScene.ts)은 매 프레임 update() 를 부른 뒤 state 를 그리기만 한다.
 * 배속(speed)은 실제 시간 1초에 걷는 걸음 수만 늘린다. 걸음 하나의 계산은 그대로라, 같은 명령이면 몇 배속이든 결과가 같다.
 * 플레이어의 조작은 모두 cmd() 로 들어간다 (state.log 에 쌓인다).
 */
export class Run {
  readonly state: State;
  /** 일시정지 (창이 떠 있는 동안) */
  paused = false;
  /** 배속: 실제 시간 1초에 게임 시간이 이만큼 흐른다 */
  speed: Speed = 1;
  /** 생긴 일 (소리·연출) */
  onEvent: (e: Ev, s: State) => void = () => {};
  /** 점검용: 최근 프레임의 계산·그리기 시간 (ms) */
  readonly perf = { simMs: 0, drawMs: 0, frameMs: 0, steps: 0 };
  private last = 0;
  private acc = 0;

  constructor(readonly cfg: GameConfig) {
    this.state = createGame(cfg);
  }

  get over() {
    return isOver(this.state);
  }

  private flush() {
    const s = this.state;
    for (let i = 0; i < s.evN; i++) this.onEvent(s.events[i], s);
  }

  /** 명령: 시작 · 배치 · 강화 · 되팔기. 할 수 없으면 false */
  cmd(op: Cmd['op'], slot = -1, char = -1): boolean {
    const ok = command(this.state, op, slot, char);
    this.flush();
    this.state.evN = 0;
    return ok;
  }

  /** 매 프레임: 흐른 시간만큼 걸음을 진행한다 (시작 전·일시정지 중에는 멈춘다) */
  update(nowMs: number) {
    const dt = this.last ? Math.max(0, Math.min(0.25, (nowMs - this.last) / 1000)) : 0;
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
      step(this.state);
      this.flush();
      n++;
    }
    if (n === max) this.acc = 0;
    this.perf.steps = n;
    this.perf.simMs = performance.now() - t0;
  }

  summary(): RunSummary {
    return summarize(this.state);
  }
}

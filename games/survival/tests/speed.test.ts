import { describe, expect, it } from 'vitest';
import { TICKS_PER_SEC } from '../src/data/balance';
import { LIMITS } from '../src/game/progress';
import { Run, SPEEDS, type Speed } from '../src/run/run';

/**
 * 배속 (run/run.ts): 실제 시간 1초에 걷는 걸음 수만 늘린다.
 * 걸음 하나의 계산은 그대로이므로, 같은 입력이면 2배속의 결과는 1배속과 같고 실제 시간만 절반이다.
 */
const FRAME_MS = 1000 / 60;

/** 화면이 하듯 프레임마다 update 를 부른다. 레벨업 카드는 늘 첫 장을 고른다 */
function drive(speed: Speed, opts: { realSec?: number; untilTick?: number; frameMs?: number }) {
  const run = new Run({ seed: 4242, char: 'tiger', map: 'field' });
  run.speed = speed;
  const frameMs = opts.frameMs ?? FRAME_MS;
  let now = 1000;
  let frames = 0;
  let maxSteps = 0;
  run.update(now);
  const s = run.state;
  const more = () => (opts.untilTick !== undefined ? s.tick < opts.untilTick : (now - 1000) / 1000 < opts.realSec!);
  while (!run.over && more()) {
    if (s.phase === 'levelup') run.pick(0);
    // 레벨이 오를 때마다 방향을 바꾼다. 레벨업에서는 몇 배속이든 걸음이 멈추므로, 조작이 바뀌는 걸음이 두 판에서 같다
    // (프레임마다 읽는 조작을 걸음 중간에 바꾸면 2배속에서는 한 걸음 늦게 닿아 판이 달라진다. 그건 배속이 아니라 입력이 다른 것)
    const leg = s.level % 4;
    run.input.mx = [1, 0, -1, 0][leg];
    run.input.my = [0, 1, 0, -1][leg];
    if (opts.untilTick !== undefined && opts.untilTick - s.tick < 16) run.speed = 1; // 끝에서는 한 걸음씩 맞춘다
    now += opts.untilTick !== undefined && opts.untilTick - s.tick < 16 ? FRAME_MS * 0.7 : frameMs;
    run.update(now);
    maxSteps = Math.max(maxSteps, run.perf.steps);
    frames++;
  }
  return { run, realSec: (now - 1000) / 1000, frames, maxSteps };
}

const snapshot = (run: Run) => {
  const s = run.state;
  return JSON.stringify({ sum: run.summary(), tick: s.tick, time: s.time, x: s.player.x, y: s.player.y, hp: s.player.hp, xp: s.xp, enemies: s.enemies.n, phase: s.phase });
};

describe('배속', () => {
  it('고를 수 있는 배속은 1·2, 가장 빠른 값이 서버 검증의 max_speed', () => {
    expect([...SPEEDS]).toEqual([1, 2]);
    expect(Math.max(...SPEEDS)).toBe(LIMITS.max_speed);
    expect(new Run({ seed: 1, char: 'rat', map: 'field' }).speed).toBe(1);
  });

  it('2배속은 같은 실제 시간에 걸음을 두 배로 걷는다 (시계가 2배로 간다)', () => {
    const a = drive(1, { realSec: 20 });
    const b = drive(2, { realSec: 20 });
    expect(a.run.state.time).toBeGreaterThan(19.5);
    expect(a.run.state.time).toBeLessThan(20.1);
    // 레벨업 창이 뜬 프레임은 걷지 않으므로 조금 모자랄 수 있다
    expect(b.run.state.time).toBeGreaterThan(39);
    expect(b.run.state.time).toBeLessThan(40.1);
    expect(a.maxSteps).toBeLessThanOrEqual(2);
    expect(b.maxSteps).toBeLessThanOrEqual(3);
  });

  it('같은 입력이면 2배속의 결과는 1배속과 같고, 실제 시간은 절반', () => {
    const T = 45 * TICKS_PER_SEC;
    const a = drive(1, { untilTick: T });
    const b = drive(2, { untilTick: T });
    expect(a.run.state.tick).toBe(T);
    expect(b.run.state.tick).toBe(T);
    expect(snapshot(b.run)).toBe(snapshot(a.run));
    expect(a.run.state.kills).toBeGreaterThan(0);
    expect(b.realSec / a.realSec).toBeGreaterThan(0.48);
    expect(b.realSec / a.realSec).toBeLessThan(0.53);
  });

  it('느린 기기: 한 프레임에 1배속 4걸음, 2배속 8걸음까지만 (밀린 걸음은 버린다)', () => {
    const a = drive(1, { realSec: 3, frameMs: 200 });
    const b = drive(2, { realSec: 3, frameMs: 200 });
    expect(a.maxSteps).toBe(4);
    expect(b.maxSteps).toBe(8);
    expect(b.run.state.tick).toBe(a.run.state.tick * 2);
  });

  it('일시정지·레벨업 중에는 배속이어도 멈춘다', () => {
    const run = new Run({ seed: 7, char: 'rat', map: 'field' });
    run.speed = 2;
    let now = 1000;
    run.update(now);
    for (let i = 0; i < 30; i++) run.update((now += FRAME_MS));
    const tick = run.state.tick;
    expect(tick).toBeGreaterThan(50);
    run.paused = true;
    for (let i = 0; i < 30; i++) run.update((now += FRAME_MS));
    expect(run.state.tick).toBe(tick);
    run.paused = false;
    run.state.phase = 'levelup';
    for (let i = 0; i < 30; i++) run.update((now += FRAME_MS));
    expect(run.state.tick).toBe(tick);
  });
});

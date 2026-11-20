import { describe, expect, it } from 'vitest';
import {
  BALL_MAX_SPEED, BALL_R, CEIL, FLOOR_Y, GROUND_Y, HIT_MIN_SPEED, JUMP_SPEED, LEFT, MOVE_SPEED, NET_CAP_Y, NET_TOP, NET_W, NET_X, PLAYER_MAX_X, PLAYER_MIN_X,
  PLAYER_R, POINT_PAUSE_TICKS, RALLY_STAGE_TICKS, RESTITUTION, RIGHT, SERVE_Y, START_X, STEP_MS, WIN_SCORE,
} from '../src/game/constants';
import { makeRng } from '../src/game/rng';
import { yieldWorker } from './helpers';
import {
  NO_INPUT, applyBall, applyScore, cloneState, createState, maxBallSpeed, newClock, setPlayer, speedMult, step, stepBallOnly, ticksFor,
  type BallState, type Input, type SimEvent, type SimState,
} from '../src/game/sim';

const IDLE: [Input, Input] = [NO_INPUT, NO_INPUT];
const key = (left = false, right = false, jump = false): Input => ({ left, right, jump });

/** 공을 원하는 곳에 놓은 상태 (두 캐릭터는 제자리) */
function withBall(b: BallState, seed = 1): SimState {
  const s = createState(seed);
  s.ball = { ...b };
  return s;
}
function run(s: SimState, ticks: number, inputs: [Input, Input] = IDLE, ev?: SimEvent[]) {
  for (let i = 0; i < ticks; i++) step(s, inputs, ev);
  return s;
}
/** 시드로 만든 무작위 조작 (몇 틱씩 같은 버튼을 누르고 있다) */
function randomInputs(seed: number) {
  const rng = makeRng(seed);
  const cur: [Input, Input] = [key(), key()];
  return (tick: number): [Input, Input] => {
    for (const side of [0, 1] as const) {
      if (tick % 6 === side * 3) cur[side] = key(rng() < 0.4, rng() < 0.4, rng() < 0.35);
    }
    return cur;
  };
}

describe('공 물리', () => {
  it('왼쪽·오른쪽 벽에 맞으면 0.9배 속도로 튕긴다', () => {
    const l = withBall({ x: LEFT + BALL_R + 4, y: 200, vx: -10, vy: 0 });
    const ev: SimEvent[] = [];
    step(l, IDLE, ev);
    expect(l.ball.vx).toBeCloseTo(10 * RESTITUTION, 5);
    expect(l.ball.x).toBeGreaterThanOrEqual(LEFT + BALL_R);
    expect(ev.some((e) => e.t === 'wall')).toBe(true);

    const r = withBall({ x: RIGHT - BALL_R - 4, y: 200, vx: 10, vy: 0 });
    step(r, IDLE);
    expect(r.ball.vx).toBeCloseTo(-10 * RESTITUTION, 5);
    expect(r.ball.x).toBeLessThanOrEqual(RIGHT - BALL_R);
  });

  it('천장에 맞으면 아래로 튕긴다', () => {
    const s = withBall({ x: 200, y: CEIL + BALL_R + 5, vx: 2, vy: -12 });
    step(s, IDLE);
    expect(s.ball.vy).toBeGreaterThan(0);
    expect(s.ball.vy).toBeCloseTo((12 - 0.45) * RESTITUTION, 5);
    expect(s.ball.vx).toBe(2);
    expect(s.ball.y).toBeGreaterThanOrEqual(CEIL + BALL_R);
  });

  it('네트 기둥에 맞으면 있던 쪽으로 튕긴다', () => {
    const s = withBall({ x: NET_X - NET_W / 2 - BALL_R - 3, y: NET_TOP + 80, vx: 9, vy: -2 });
    const ev: SimEvent[] = [];
    step(s, IDLE, ev);
    expect(s.ball.vx).toBeCloseTo(-9 * RESTITUTION, 5);
    expect(s.ball.x).toBeLessThanOrEqual(NET_X - NET_W / 2 - BALL_R);
    expect(ev.some((e) => e.t === 'net')).toBe(true);
  });

  it('네트 윗부분은 둥글다: 가운데에서 비켜 떨어진 공은 비킨 쪽으로 튄다', () => {
    for (const off of [-8, 8]) {
      const s = withBall({ x: NET_X + off, y: NET_TOP - BALL_R - 20, vx: 0, vy: 6 });
      let bounced = false;
      for (let i = 0; i < 20 && !bounced; i++) {
        step(s, IDLE);
        bounced = s.ball.vy < 0;
      }
      expect(bounced).toBe(true);
      expect(Math.sign(s.ball.vx)).toBe(Math.sign(off));
      // 둥근 면 밖에 있다
      expect(Math.hypot(s.ball.x - NET_X, s.ball.y - NET_CAP_Y)).toBeGreaterThanOrEqual(BALL_R + NET_W / 2 - 1e-6);
    }
  });

  it('캐릭터에 맞으면 캐릭터 중심 → 공 방향으로 최소 11의 속도로 튄다', () => {
    const s = createState(1);
    const p = s.players[0];
    s.ball = { x: p.x + 20, y: p.y - 80, vx: 0, vy: 2 };
    const ev: SimEvent[] = [];
    let hit: Extract<SimEvent, { t: 'hit' }> | undefined;
    for (let i = 0; i < 30 && !hit; i++) {
      step(s, IDLE, ev);
      hit = ev.find((e) => e.t === 'hit') as typeof hit;
    }
    expect(hit).toBeDefined();
    expect(hit!.side).toBe(0);
    expect(hit!.power).toBeGreaterThanOrEqual(HIT_MIN_SPEED - 1e-6);
    // 오른쪽 위로 (공이 캐릭터 중심의 오른쪽 위에 있었다)
    expect(s.ball.vx).toBeGreaterThan(0);
    expect(s.ball.vy).toBeLessThan(0);
  });

  it('점프하면서 치면 더 세게 날아간다 (캐릭터 속도의 절반이 더해진다)', () => {
    const power = (jump: boolean) => {
      const s = createState(1);
      const p = s.players[0];
      s.ball = { x: p.x, y: p.y - 100, vx: 0, vy: 0 };
      const ev: SimEvent[] = [];
      for (let i = 0; i < 30; i++) {
        step(s, [key(false, false, jump), NO_INPUT], ev);
        const h = ev.find((e) => e.t === 'hit');
        if (h && h.t === 'hit') return h.power;
      }
      return 0;
    };
    expect(power(false)).toBeCloseTo(HIT_MIN_SPEED, 5);
    expect(power(true)).toBeGreaterThan(HIT_MIN_SPEED + JUMP_SPEED * 0.5 - 2.5);
  });

  it('공 속도는 최대 20을 넘지 않는다 (가속 단계마다 10%씩, 최대 30)', () => {
    expect(maxBallSpeed(0)).toBe(BALL_MAX_SPEED);
    expect(maxBallSpeed(5)).toBeCloseTo(30, 9);
    // 아주 높은 데서 떨어져도, 세게 던져도
    const s = withBall({ x: 200, y: 60, vx: 50, vy: 50 });
    for (let i = 0; i < 40 && s.phase === 'play'; i++) {
      step(s, IDLE);
      expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeLessThanOrEqual(BALL_MAX_SPEED + 1e-9);
    }
  });

  it('가장 빠른 공(30)도 네트 기둥을 뚫고 지나가지 못한다', () => {
    for (const dir of [1, -1])
      for (let d = 30; d < 120; d += 7)
        for (const y of [NET_CAP_Y + 4, NET_TOP + 60, NET_TOP + 150]) {
          const s = withBall({ x: NET_X - dir * d, y, vx: dir * 30, vy: 0 });
          s.stage = 5;
          s.rallyTicks = 5 * RALLY_STAGE_TICKS;
          // 캐릭터가 끼어들지 않게 구석으로
          s.players[0].x = PLAYER_MIN_X[0];
          s.players[1].x = PLAYER_MAX_X[1];
          for (let i = 0; i < 8 && s.phase === 'play'; i++) {
            step(s, IDLE);
            expect(Math.sign(s.ball.x - NET_X)).toBe(-dir);
          }
        }
  });

  it('가장 빠른 공도 캐릭터를 뚫고 지나가지 못한다', () => {
    for (let d = 61; d < 130; d += 5) {
      const s = createState(1);
      const p = s.players[1];
      s.stage = 5;
      s.rallyTicks = 5 * RALLY_STAGE_TICKS;
      s.ball = { x: p.x - d, y: p.y - 10, vx: 30, vy: 0 };
      const ev: SimEvent[] = [];
      for (let i = 0; i < 6 && s.phase === 'play'; i++) {
        step(s, IDLE, ev);
        expect(s.ball.x).toBeLessThan(p.x);
      }
      expect(ev.some((e) => e.t === 'hit' && e.side === 1)).toBe(true);
    }
  });

  it('공만 따로 계산한 길(AI 예측용)은 실제 계산과 같다', () => {
    const s = withBall({ x: 500, y: 200, vx: -13, vy: -9 });
    s.players[0].x = PLAYER_MIN_X[0];
    s.players[1].x = PLAYER_MAX_X[1];
    const b = { ...s.ball };
    for (let i = 0; i < 25; i++) {
      step(s, IDLE);
      stepBallOnly(b, 0);
      expect(b).toEqual(s.ball);
    }
  });
});

describe('캐릭터', () => {
  it('좌우로 틱마다 5씩 움직이고, 자기 코트 밖으로는 못 나간다', () => {
    const s = createState(1);
    s.ball.y = CEIL + BALL_R; // 공이 방해하지 않게 위에서 시작
    const x0 = s.players[0].x;
    step(s, [key(false, true), key(true)]);
    expect(s.players[0].x).toBe(x0 + MOVE_SPEED);
    expect(s.players[1].x).toBe(START_X[1] - MOVE_SPEED);
    // 네트 쪽으로 계속 가도 네트를 넘지 못한다
    const t = createState(1);
    for (let i = 0; i < 200; i++) {
      t.ball = { x: 100, y: 100, vx: 0, vy: 0 };
      step(t, [key(false, true), key(true)]);
    }
    expect(t.players[0].x).toBe(PLAYER_MAX_X[0]);
    expect(t.players[1].x).toBe(PLAYER_MIN_X[1]);
    for (let i = 0; i < 200; i++) {
      t.ball = { x: 360, y: 100, vx: 0, vy: 0 };
      step(t, [key(true), key(false, true)]);
    }
    expect(t.players[0].x).toBe(PLAYER_MIN_X[0]);
    expect(t.players[1].x).toBe(PLAYER_MAX_X[1]);
  });

  it('점프: 처음 속도 14, 높이 약 120~130, 공중에서도 좌우 이동, 땅에서만 다시 뛴다', () => {
    const s = createState(1);
    const ev: SimEvent[] = [];
    let top = GROUND_Y;
    let air = 0;
    const x0 = s.players[0].x;
    for (let i = 0; i < 60; i++) {
      s.ball = { x: 600, y: 100, vx: 0, vy: 0 };
      // 점프 버튼을 계속 누르고 있어도 공중에서는 다시 뛰지 않는다
      step(s, [key(true, false, i < 20), NO_INPUT], ev);
      top = Math.min(top, s.players[0].y);
      if (!s.players[0].ground) air++;
    }
    expect(GROUND_Y - top).toBeGreaterThan(115);
    expect(GROUND_Y - top).toBeLessThan(135);
    expect(ev.filter((e) => e.t === 'jump')).toHaveLength(1);
    expect(ev.filter((e) => e.t === 'land')).toHaveLength(1);
    expect(air).toBeGreaterThan(30);
    expect(s.players[0].x).toBeLessThan(x0);
    expect(s.players[0].y).toBe(GROUND_Y);
  });
});

describe('득점과 서브', () => {
  it('첫 서브는 시드에 따라 무작위 (같은 시드면 같은 쪽)', () => {
    const servers = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      servers.add(createState(seed).server);
      expect(createState(seed).server).toBe(createState(seed).server);
    }
    expect(servers.size).toBe(2);
  });

  it('서브: 서브하는 캐릭터 머리 위에서 공이 떨어지며 시작한다', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createState(seed);
      const p = s.players[s.server];
      expect(s.ball.y).toBe(SERVE_Y);
      expect(Math.abs(s.ball.x - p.x)).toBeLessThan(PLAYER_R);
      expect(s.ball.vx).toBe(0);
      expect(s.ball.vy).toBe(0);
      const ev: SimEvent[] = [];
      run(s, 60, IDLE, ev);
      expect(ev.find((e) => e.t === 'hit')).toMatchObject({ side: s.server });
    }
  });

  it('공이 왼쪽 바닥에 닿으면 오른쪽이 1점, 오른쪽 바닥이면 왼쪽이 1점', () => {
    for (const [x, scorer] of [[150, 1], [600, 0]] as const) {
      const s = withBall({ x, y: FLOOR_Y - BALL_R - 30, vx: 0, vy: 5 });
      s.players[0].x = PLAYER_MAX_X[0];
      s.players[1].x = PLAYER_MIN_X[1];
      const ev: SimEvent[] = [];
      run(s, 10, IDLE, ev);
      expect(s.score[scorer]).toBe(1);
      expect(s.score[1 - scorer]).toBe(0);
      expect(s.scorer).toBe(scorer);
      expect(s.phase).toBe('point');
      expect(ev.filter((e) => e.t === 'point')).toEqual([{ t: 'point', side: scorer, x }]);
    }
  });

  it('득점하면 1.5초 멈췄다가, 실점한 쪽이 서브한다', () => {
    const s = withBall({ x: 150, y: FLOOR_Y - BALL_R - 2, vx: 0, vy: 5 });
    s.players[0].x = PLAYER_MAX_X[0];
    const ev: SimEvent[] = [];
    step(s, IDLE, ev);
    expect(s.phase).toBe('point');
    expect(s.server).toBe(0); // 실점한 왼쪽이 서브
    const frozen = { ...s.ball };
    run(s, POINT_PAUSE_TICKS - 1, [key(true), key(true)], ev);
    expect(s.phase).toBe('point');
    expect(s.ball).toEqual(frozen);
    expect(s.players[0].x).toBe(PLAYER_MAX_X[0]); // 멈춘 동안에는 움직이지 않는다
    step(s, IDLE, ev);
    expect(s.phase).toBe('play');
    expect(ev[ev.length - 1]).toEqual({ t: 'serve', side: 0 });
    expect(s.players[0].x).toBe(START_X[0]);
    expect(s.players[1].x).toBe(START_X[1]);
    expect(Math.abs(s.ball.x - START_X[0])).toBeLessThan(PLAYER_R);
    expect(s.rallyTicks).toBe(0);
  });

  it('3점을 먼저 얻으면 끝 (듀스 없음). 끝난 뒤에는 더 계산하지 않는다', () => {
    const s = createState(3);
    s.score = [2, 2];
    s.ball = { x: 600, y: FLOOR_Y - BALL_R - 2, vx: 0, vy: 5 };
    s.players[1].x = PLAYER_MIN_X[1];
    const ev: SimEvent[] = [];
    step(s, IDLE, ev);
    expect(s.score).toEqual([WIN_SCORE, 2]);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(ev[ev.length - 1]).toEqual({ t: 'over', winner: 0 });
    const after = JSON.stringify(s);
    run(s, 300, [key(true, false, true), key(false, true, true)]);
    expect(JSON.stringify(s)).toBe(after);
  });
});

describe('랠리 가속', () => {
  /** 공을 계속 공중에 붙잡아 두고 시간만 흘린다 */
  function hold(s: SimState, ticks: number, ev?: SimEvent[]) {
    for (let i = 0; i < ticks; i++) {
      s.ball = { x: 200, y: 200, vx: 0, vy: 0 };
      step(s, IDLE, ev);
    }
  }

  it('서브 후 10초마다 한 단계(+10%), 5단계(+50%)에서 멈춘다', () => {
    const s = createState(1);
    const ev: SimEvent[] = [];
    hold(s, RALLY_STAGE_TICKS - 1, ev);
    expect(s.stage).toBe(0);
    hold(s, 1, ev);
    expect(s.stage).toBe(1);
    expect(speedMult(s.stage)).toBeCloseTo(1.1, 9);
    hold(s, RALLY_STAGE_TICKS * 4, ev);
    expect(s.stage).toBe(5);
    expect(maxBallSpeed(s.stage)).toBeCloseTo(30, 9);
    hold(s, RALLY_STAGE_TICKS * 5, ev);
    expect(s.stage).toBe(5);
    expect(ev.filter((e) => e.t === 'speedup').map((e) => (e.t === 'speedup' ? e.stage : 0))).toEqual([1, 2, 3, 4, 5]);
  });

  it('단계가 오르는 순간 날아가던 공도 10% 빨라진다', () => {
    const s = createState(1);
    hold(s, RALLY_STAGE_TICKS - 2);
    s.ball = { x: 200, y: 200, vx: 4, vy: -6 };
    step(s, IDLE);
    const before = { ...s.ball };
    step(s, IDLE);
    expect(s.stage).toBe(1);
    expect(s.ball.vx).toBeCloseTo(before.vx * 1.1, 9);
  });

  it('가속 단계에서는 치는 힘과 속도 상한이 함께 오른다', () => {
    const s = createState(1);
    hold(s, RALLY_STAGE_TICKS * 5);
    const p = s.players[0];
    s.ball = { x: p.x + 10, y: p.y - 70, vx: 0, vy: 0 };
    const ev: SimEvent[] = [];
    run(s, 10, IDLE, ev);
    const hit = ev.find((e) => e.t === 'hit');
    expect(hit && hit.t === 'hit' && hit.power).toBeCloseTo(HIT_MIN_SPEED * 1.5, 5);
    // 상한 30
    s.ball = { x: 200, y: 100, vx: 80, vy: 0 };
    step(s, IDLE);
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeLessThanOrEqual(30 + 1e-9);
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeGreaterThan(29);
  });

  it('득점하면 기본 속도로 돌아간다', () => {
    const s = createState(1);
    hold(s, RALLY_STAGE_TICKS * 3);
    expect(s.stage).toBe(3);
    s.ball = { x: 150, y: FLOOR_Y - BALL_R - 2, vx: 0, vy: 5 };
    s.players[0].x = PLAYER_MAX_X[0];
    run(s, POINT_PAUSE_TICKS + 1);
    expect(s.phase).toBe('play');
    expect(s.stage).toBe(0);
    expect(s.rallyTicks).toBe(0);
  });
});

describe('고정 시간 간격 (프레임 속도와 무관)', () => {
  it('같은 시드·같은 조작이면 결과가 완전히 같다', () => {
    const play = () => {
      const s = createState(77);
      const inp = randomInputs(5);
      for (let i = 0; i < 4000 && s.phase !== 'over'; i++) step(s, inp(s.tick));
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });

  it('화면이 30·60·144fps이든 들쭉날쭉하든, 같은 시간이 흐르면 같은 상태가 된다', () => {
    const TOTAL_MS = 4000; // 경기가 끝나기 전까지만
    const play = (frameMs: (i: number) => number) => {
      const s = createState(9);
      const inp = randomInputs(3);
      const clock = newClock();
      let t = 0;
      for (let i = 0; t < TOTAL_MS; i++) {
        const dt = Math.min(frameMs(i), TOTAL_MS - t);
        t += dt;
        for (let n = ticksFor(clock, dt, 1000); n > 0; n--) step(s, inp(s.tick));
      }
      return s;
    };
    const base = play(() => STEP_MS);
    expect(base.phase).not.toBe('over');
    expect(base.tick).toBeGreaterThanOrEqual(239);
    expect(base.tick).toBeLessThanOrEqual(240);
    const rng = makeRng(42);
    for (const frame of [() => 1000 / 30, () => 1000 / 144, () => 1000 / 50, () => 3 + rng() * 40]) {
      const s = play(frame);
      // 남은 시간(한 틱 미만) 때문에 한 틱은 다를 수 있다 → 같은 틱까지 맞춰서 비교
      expect(Math.abs(s.tick - base.tick)).toBeLessThanOrEqual(1);
      const a = createState(9);
      const inp = randomInputs(3);
      while (a.tick < s.tick) step(a, inp(a.tick));
      expect(JSON.stringify(s)).toBe(JSON.stringify(a));
    }
  });

  it('탭을 오래 내려 두었다 돌아오면 밀린 시간은 버린다', () => {
    const clock = newClock();
    expect(ticksFor(clock, 5000)).toBe(12);
    expect(clock.acc).toBe(0);
    expect(ticksFor(clock, STEP_MS * 2 + 1)).toBe(2);
  });

  it('상태는 JSON으로 보냈다 받아도 그대로 이어진다', () => {
    const a = createState(5);
    const inp = randomInputs(8);
    for (let i = 0; i < 500; i++) step(a, inp(a.tick));
    const b = JSON.parse(JSON.stringify(a)) as SimState;
    const c = cloneState(a);
    for (let i = 0; i < 1500; i++) {
      const k = inp(a.tick);
      step(a, k);
      step(b, k);
      step(c, k);
    }
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

// 12판 × 6000프레임을 한 테스트에 몰면 일꾼을 15~25초 붙잡아 vitest 가 "Timeout calling onTaskUpdate" 로 멈출 수 있어
// 판(씨앗)마다 테스트를 나누고 500프레임마다 양보한다. 프레임마다 expect 를 부르는 대신 처음 어긋난 곳을 적어 두었다가 한 번에 본다
describe('무작위 조작 수천 프레임', () => {
  const E = 1e-6;
  /** 이 프레임에서 지켜야 할 것을 어긴 곳 (없으면 null) */
  const violation = (s: SimState): string | null => {
    const b = s.ball;
    if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) return '공 값이 수가 아님';
    if (b.x < LEFT + BALL_R - E || b.x > RIGHT - BALL_R + E) return `공 x ${b.x}`;
    if (b.y < CEIL + BALL_R - E || b.y > FLOOR_Y - BALL_R + E) return `공 y ${b.y}`;
    if (Math.hypot(b.vx, b.vy) > maxBallSpeed(s.stage) + E) return `공 속도 ${Math.hypot(b.vx, b.vy)}`;
    const netGap = b.y >= NET_CAP_Y ? Math.abs(b.x - NET_X) : Math.hypot(b.x - NET_X, b.y - NET_CAP_Y);
    if (netGap < BALL_R + NET_W / 2 - E) return `공이 네트 속 (${b.x}, ${b.y})`;
    for (const side of [0, 1] as const) {
      const p = s.players[side];
      if (p.x < PLAYER_MIN_X[side] || p.x > PLAYER_MAX_X[side]) return `캐릭터 ${side} x ${p.x}`;
      if (p.y > GROUND_Y || p.y <= GROUND_Y - 140) return `캐릭터 ${side} y ${p.y}`;
    }
    return null;
  };
  const totals = { hits: 0, nets: 0, points: 0, runs: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    it(`씨앗 ${seed}: 캐릭터는 자기 코트를, 공은 경기장을 벗어나지 않고, 공이 네트 속에 들어가지 않는다`, async () => {
      const s = createState(seed);
      const inp = randomInputs(seed * 31);
      const ev: SimEvent[] = [];
      let bad: string | null = null;
      for (let i = 0; i < 6000 && !bad; i++) {
        if (s.phase === 'over') {
          // 경기가 끝나면 점수만 지우고 계속 (오래 돌려 보려고)
          s.score = [0, 0];
          s.winner = -1;
          s.phase = 'point';
          s.pause = 1;
        }
        step(s, inp(s.tick), ev);
        const v = violation(s);
        if (v) bad = `${i}번째 프레임: ${v}`;
        if (i % 500 === 499) await yieldWorker();
      }
      expect(bad).toBeNull();
      totals.hits += ev.filter((e) => e.t === 'hit').length;
      totals.nets += ev.filter((e) => e.t === 'net').length;
      totals.points += ev.filter((e) => e.t === 'point').length;
      totals.runs++;
    }, 60000);
  }
  it('12판을 합치면 실제로 여러 가지 일이 일어난 판이었다', () => {
    expect(totals.runs).toBe(12);
    expect(totals.hits).toBeGreaterThan(200);
    expect(totals.nets).toBeGreaterThan(20);
    expect(totals.points).toBeGreaterThan(50);
  });
});

describe('밖에서 받은 값으로 덮어쓰기 (온라인 준비)', () => {
  it('한 캐릭터만 덮어쓴다 (코트 밖 값은 안으로 당긴다)', () => {
    const s = createState(1);
    const other = { ...s.players[0] };
    const ball = { ...s.ball };
    setPlayer(s, 1, { x: 500, y: 700, vx: -5, vy: -3, ground: false });
    expect(s.players[1]).toEqual({ x: 500, y: 700, vx: -5, vy: -3, ground: false });
    expect(s.players[0]).toEqual(other);
    expect(s.ball).toEqual(ball);
    setPlayer(s, 1, { x: 100, y: 9999, vx: 0, vy: 0, ground: true });
    expect(s.players[1].x).toBe(PLAYER_MIN_X[1]);
    expect(s.players[1].y).toBe(GROUND_Y);
  });

  it('공·점수만 덮어쓴다', () => {
    const host = createState(1);
    const guest = createState(2);
    run(host, 400, [key(true, false, true), key(false, true, true)]);
    const mine = { ...guest.players[1] };
    applyBall(guest, host.ball);
    applyScore(guest, host);
    expect(guest.ball).toEqual(host.ball);
    expect(guest.score).toEqual(host.score);
    expect(guest.phase).toBe(host.phase);
    expect(guest.server).toBe(host.server);
    expect(guest.players[1]).toEqual(mine);
  });
});

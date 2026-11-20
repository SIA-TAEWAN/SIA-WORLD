import { describe, expect, it } from 'vitest';
import {
  MAX_SHOT_STEPS,
  aimPreview,
  beginShot,
  buildConfig,
  createRun,
  dirOf,
  endTurn,
  playShot,
  replayRun,
  shotDone,
  sinT,
  cosT,
  stepShot,
  type RunState,
  type ShotInput,
  type SimEvent,
} from '../src/sim';
import { cfgOf, foe, hero } from './helpers';

/** 쏘고 멈출 때까지 (요괴 차례 전) */
function fly(s: RunState, inp: ShotInput): SimEvent[] {
  const ev = beginShot(s, inp);
  while (s.phase === 'shot') ev.push(...stepShot(s));
  return ev;
}

describe('각도 표 (사칙연산만)', () => {
  it('sin·cos 이 Math 값과 1e-12 안에서 같고 끝값은 정확하다', () => {
    for (let a = 0; a < 3600; a += 7) {
      const r = (a / 10) * (Math.PI / 180);
      expect(Math.abs(sinT(a) - Math.sin(r))).toBeLessThan(1e-12);
      expect(Math.abs(cosT(a) - Math.cos(r))).toBeLessThan(1e-12);
    }
    expect(sinT(900)).toBe(1);
    expect(sinT(0)).toBe(0);
    expect(dirOf(2700)).toEqual([0, -1]);
  });
});

describe('튕김', () => {
  it('벽에 부딪히면 입사각 = 반사각 (벽 쪽 속도만 뒤집힌다)', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(320, 100)]]));
    s.heroes[0].x = 320;
    s.heroes[0].y = 600;
    beginShot(s, { a: 450, p: 100, s: 0 }); // 오른쪽 아래 45°
    let bounced = false;
    for (let i = 0; i < 60 && !bounced; i++) {
      for (const e of stepShot(s)) if (e.t === 'wall') bounced = true;
    }
    expect(bounced).toBe(true);
    const m = s.movers[0];
    expect(m.vx).toBeLessThan(0);
    expect(m.vy).toBeGreaterThan(0);
    expect(Math.abs(Math.abs(m.vx) - Math.abs(m.vy))).toBeLessThan(1e-6);
  });

  it('방 밖으로 나가지 않는다', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(320, 100)]]));
    beginShot(s, { a: 2333, p: 100, s: 0 });
    while (s.phase === 'shot') {
      stepShot(s);
      for (const m of s.movers) {
        expect(m.x).toBeGreaterThanOrEqual(m.r - 1e-6);
        expect(m.x).toBeLessThanOrEqual(640 - m.r + 1e-6);
        expect(m.y).toBeGreaterThanOrEqual(m.r - 1e-6);
        expect(m.y).toBeLessThanOrEqual(960 - m.r + 1e-6);
      }
    }
  });

  it('조준선은 첫 벽에서 끝난다', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(100, 100)]]));
    s.heroes[0].x = 320;
    s.heroes[0].y = 800;
    const pts = aimPreview(s, 2700);
    expect(pts[1][0]).toBeCloseTo(320, 6);
    expect(pts[1][1]).toBeCloseTo(30, 6); // 위 벽 - 반지름
  });
});

describe('반사형 · 관통형', () => {
  const wall = [foe(320, 400, { hp: 9999 })];
  it('반사형은 요괴에서 튕겨 나와 아래로 돌아온다', () => {
    const s = createRun(cfgOf([hero('rat')], [wall]));
    s.heroes[0].x = 320;
    const ev = fly(s, { a: 2700, p: 60, s: 0 });
    expect(ev.filter((e) => e.t === 'hit').length).toBeGreaterThanOrEqual(1);
    expect(s.heroes[0].y).toBeGreaterThan(400);
  });

  it('관통형은 요괴를 뚫고 지나가 위로 간다', () => {
    const s = createRun(cfgOf([hero('ox')], [wall]));
    s.heroes[0].x = 320;
    const ev = fly(s, { a: 2700, p: 30, s: 0 });
    expect(ev.filter((e) => e.t === 'hit').length).toBeGreaterThanOrEqual(1);
    expect(s.heroes[0].y).toBeLessThan(400);
  });

  it('한 번 닿는 동안에는 한 번만 때린다 (관통형이 지나가는 동안)', () => {
    const s = createRun(cfgOf([hero('ox')], [[foe(320, 400, { hp: 9999, r: 80 })]]));
    s.heroes[0].x = 320;
    const ev = fly(s, { a: 2700, p: 10, s: 0 });
    const first = ev.findIndex((e) => e.t === 'hit');
    expect(first).toBeGreaterThanOrEqual(0);
    // 처음 닿고 나서 벽에 튕기기 전까지는 다시 때리지 않는다
    const nextWall = ev.findIndex((e, i) => i > first && e.t === 'wall');
    const hits = ev.slice(first, nextWall < 0 ? undefined : nextWall).filter((e) => e.t === 'hit');
    expect(hits.length).toBe(1);
  });

  it('요괴 체력이 0이 되면 쓰러진다', () => {
    const s = createRun(cfgOf([hero('rat', { atk: 100 })], [[foe(320, 400, { hp: 50 })], [foe(100, 100)]]));
    s.heroes[0].x = 320;
    const ev = fly(s, { a: 2700, p: 50, s: 0 });
    expect(ev.some((e) => e.t === 'kill')).toBe(true);
    expect(s.foes[0].alive).toBe(false);
  });
});

describe('마찰 · 멈춤', () => {
  it('마찰로 2~4초 뒤 멈춘다', () => {
    for (const p of [1, 50, 100]) {
      const s = createRun(cfgOf([hero('rat')], [[foe(-500, -500)]]));
      fly(s, { a: 2650, p, s: 0 });
      expect(shotDone(s)).toBe(true);
      expect(s.shotSteps / 60).toBeGreaterThanOrEqual(1.9);
      expect(s.shotSteps / 60).toBeLessThanOrEqual(4);
    }
  });

  it('6초(360스텝)가 지나면 강제로 멈춘다', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(-500, -500)]]));
    beginShot(s, { a: 0, p: 100, s: 0 });
    s.movers[0].vx = 1e9; // 마찰로는 멈추지 않을 속도
    let n = 0;
    while (s.phase === 'shot') {
      stepShot(s);
      n++;
    }
    expect(n).toBe(MAX_SHOT_STEPS);
  });
});

describe('요괴 차례 · 대원 체력', () => {
  it('턴마다 숫자가 줄고 0이면 가까운 대원을 공격하고 다시 찬다', () => {
    const s = createRun(cfgOf([hero('rat'), hero('ox')], [[foe(320, 100, { hp: 9999, cd: 2, atk: 10 })]]));
    s.heroes[1].x = 320;
    s.heroes[1].y = 300; // 소가 더 가깝다
    s.heroes[0].x = 50;
    s.heroes[0].y = 900;
    expect(s.foes[0].left).toBe(2);
    let ev = playShot(s, { a: 900, p: 1, s: 0 }); // 쥐가 아래로 살짝
    expect(s.foes[0].left).toBe(1);
    expect(ev.some((e) => e.t === 'attack')).toBe(false);
    ev = playShot(s, { a: 2700, p: 1, s: 0 }); // 소 차례
    const att = ev.find((e) => e.t === 'attack');
    expect(att && att.t === 'attack' ? att.hits[0].hero : -1).toBe(nearestOf(s));
    expect(s.foes[0].left).toBe(2);
  });

  it('쓰러진 대원은 차례를 건너뛰고, 모두 쓰러지면 실패', () => {
    const s = createRun(cfgOf([hero('rat', { hp: 5 }), hero('ox', { hp: 500 })], [[foe(320, 100, { hp: 99999, cd: 1, atk: 10, pattern: ['all'] })]]));
    const ev = playShot(s, { a: 900, p: 1, s: 0 });
    expect(ev.some((e) => e.t === 'fall' && e.hero === 0)).toBe(true);
    expect(s.heroes[0].fallen).toBe(true);
    expect(s.cur).toBe(1);
    playShot(s, { a: 900, p: 1, s: 0 });
    expect(s.cur).toBe(1); // 쥐는 건너뛴다
    s.heroes[1].hp = 1;
    const ev2 = playShot(s, { a: 900, p: 1, s: 0 });
    expect(s.phase).toBe('fail');
    expect(ev2.some((e) => e.t === 'fail')).toBe(true);
  });

  it('area 공격은 한 턴 전에 자리가 정해지고 그 원 안의 대원만 맞는다', () => {
    const s = createRun(cfgOf([hero('rat'), hero('ox')], [[foe(320, 100, { hp: 99999, cd: 2, atk: 10, pattern: ['area'], area: 100 })]]));
    playShot(s, { a: 900, p: 1, s: 0 });
    const f = s.foes[0];
    expect(f.left).toBe(1);
    expect(f.aim).not.toBeNull();
    const ev = playShot(s, { a: 2700, p: 100, s: 0 }); // 소가 멀리 간다
    const att = ev.find((e) => e.t === 'attack');
    expect(att?.t).toBe('attack');
  });

  it('턴을 다 쓰면 실패', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(320, 100, { hp: 99999, atk: 0 })]], { maxTurns: 3 }));
    for (let i = 0; i < 3; i++) playShot(s, { a: 900, p: 1, s: 0 });
    expect(s.phase).toBe('fail');
  });
});

function nearestOf(s: RunState) {
  const f = s.foes[0];
  let best = 0;
  let bd = Infinity;
  s.heroes.forEach((h, i) => {
    const d = (h.x - f.x) ** 2 + (h.y - f.y) ** 2;
    if (!h.fallen && d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

describe('같은 조작 = 같은 결과', () => {
  const inputs: ShotInput[] = Array.from({ length: 30 }, (_, i) => ({ a: (i * 1237 + 311) % 3600, p: 20 + ((i * 37) % 81), s: 0 }));
  const cfg = () => buildConfig({ stage: '1-1', party: ['rat', 'ox', 'tiger'] });

  it('replayRun 두 번이 같다', () => {
    expect(replayRun(cfg(), inputs)).toEqual(replayRun(cfg(), inputs));
  });

  it('한 스텝씩 돌린 것 · 2배속(프레임당 2스텝)이 replayRun 과 같다', () => {
    const want = replayRun(cfg(), inputs);
    for (const perFrame of [1, 2, 3]) {
      const s = createRun(cfg());
      let i = 0;
      let used = 0;
      while ((s.phase === 'aim' && i < inputs.length) || s.phase === 'shot' || s.phase === 'settle') {
        if (s.phase === 'aim') {
          beginShot(s, inputs[i++]);
          used++;
        } else if (s.phase === 'shot') for (let k = 0; k < perFrame; k++) stepShot(s);
        else endTurn(s);
      }
      const got = replayRun(cfg(), inputs.slice(0, used));
      expect(got).toEqual({ ...want, extra: 0 });
      expect(s.heroes.map((h) => [h.x, h.y, h.hp])).toEqual(finalHeroes(cfg(), inputs.slice(0, used)));
    }
  });
});

function finalHeroes(cfg: ReturnType<typeof buildConfig>, inputs: ShotInput[]) {
  const s = createRun(cfg);
  for (const i of inputs) if (s.phase === 'aim') playShot(s, i);
  return s.heroes.map((h) => [h.x, h.y, h.hp]);
}

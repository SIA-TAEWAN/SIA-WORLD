import { describe, expect, it } from 'vitest';
import { RUN_SEC, SELL_RATE, START_LIVES, TICK, WAVE_SEC } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { STARTERS, TOWERS } from '../src/data/characters';
import { ENEMIES } from '../src/data/enemies';
import { stageOf } from '../src/data/stages';
import { buildRoute, makePoint, routePos } from '../src/game/path';
import { normalPolicy, simulate } from '../src/game/policy';
import { activeBoss, canPlace, command, createGame, replay, sellValue, step, summarize, upgradeCost } from '../src/game/sim';
import { EV, type State } from '../src/game/state';
import { T, game, rich, run, runToEnd, start } from './helpers';

/** 걸음마다 생긴 일을 모으며 걷는다 */
function collect(s: State, sec: number, type: number): { time: number; a: number; b: number }[] {
  const out: { time: number; a: number; b: number }[] = [];
  for (let i = 0; i < Math.round(sec / TICK) && s.phase === 'play'; i++) {
    step(s);
    for (let k = 0; k < s.evN; k++) if (s.events[k].t === type) out.push({ time: s.time, a: s.events[k].a, b: s.events[k].b });
  }
  return out;
}

describe('길', () => {
  it('요괴는 길을 따라 온 거리만큼의 자리에 있다', () => {
    const r = buildRoute({ id: 'a', pts: [[0, 0], [2, 0], [2, 3]] });
    expect(r.len).toBe(400);
    const p = makePoint();
    expect(routePos(r, 80, 0, p)).toMatchObject({ x: 120, y: 40, dx: 1, dy: 0 });
    expect(routePos(r, 240, p.seg, p)).toMatchObject({ x: 200, y: 120, dx: 0, dy: 1, seg: 1 });
    // 끝을 넘어도 마지막 점에 머문다
    expect(routePos(r, 999, 0, p)).toMatchObject({ x: 200, y: 280 });
  });
});

describe('판의 흐름', () => {
  it('[시작]을 누르기 전에는 시간이 흐르지 않고, 그동안 배치할 수 있다', () => {
    const s = game();
    for (let i = 0; i < 600; i++) step(s);
    expect(s.phase).toBe('prep');
    expect(s.time).toBe(0);
    expect(s.enemyN).toBe(0);
    expect(command(s, 'place', 0, T.rat)).toBe(true);
    expect(start(s)).toBe(true);
    expect(start(s)).toBe(false);
    run(s, 1);
    expect(s.time).toBeCloseTo(1, 5);
  });

  it('요괴는 입구에서 나와 길을 따라 걷고, 출구에 닿으면 생명이 1 준다', () => {
    const s = game();
    start(s);
    const first = stageOf('1-1')!.waves[0].groups[0];
    run(s, first.at + 0.1);
    expect(s.enemyN).toBe(1);
    const e = s.enemies[0];
    const route = s.routes[0];
    expect(e.x).toBeLessThan(0); // 판 밖에서 걸어 들어온다
    const d0 = e.d;
    run(s, 2);
    expect(e.d - d0).toBeCloseTo(e.speed * 2, 3);
    // 길 끝까지 걸리는 시간 뒤에는 생명이 줄어 있다
    const leaks = collect(s, route.len / e.speed, EV.leak);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0].a).toBe(1);
    expect(s.lives).toBe(START_LIVES - leaks.length);
  });

  it('아무것도 놓지 않으면 생명이 0이 되어 실패한다', () => {
    const s = game();
    start(s);
    runToEnd(s);
    expect(s.phase).toBe('fail');
    expect(s.lives).toBe(0);
    expect(summarize(s)).toMatchObject({ cleared: false, stars: 0 });
  });

  it('30초마다 다음 웨이브가 시작되고(6개), 3분 뒤에는 새 요괴가 나오지 않으며 남은 요괴가 없어질 때까지 계속된다', () => {
    const s = game();
    s.lives = s.startLives = 100000; // 판이 끝나지 않게
    start(s);
    const waves = collect(s, RUN_SEC, EV.wave);
    expect(waves.map((w) => w.a)).toEqual([0, 1, 2, 3, 4, 5]);
    // 첫 웨이브는 첫 걸음에, 웨이브 k 는 판 시간 30k초에 (지금 웨이브 = ⌊판 시간 ÷ 30⌋: 서버가 도달 웨이브를 세는 기준)
    waves.forEach((w, i) => expect(w.time).toBeCloseTo(Math.max(TICK, i * WAVE_SEC), 5));
    // 3분: 나올 요괴는 다 나왔고, 길 위에는 아직 요괴가 남아 있다 → 판은 계속된다
    expect(s.spawnI).toBe(s.spawns.length);
    expect(s.enemyN).toBeGreaterThan(0);
    expect(s.phase).toBe('play');
    const uidAt180 = s.uid;
    runToEnd(s);
    // 남은 요괴가 모두 없어지면(여기서는 출구에 닿아서) 끝난다. 생명이 남아 있으니 클리어
    expect(s.time).toBeGreaterThan(RUN_SEC);
    expect(s.uid).toBe(uidAt180);
    expect(s.enemyN).toBe(0);
    expect(s.phase).toBe('clear');
  });

  it('요괴를 모두 막으면 클리어하고 별 3개, 기운은 처치할 때마다 늘어난다', () => {
    const s = rich(game());
    for (let i = 0; i < s.towers.length; i++) {
      command(s, 'place', i, i % 2 ? T.rabbit : T.tiger);
      command(s, 'upgrade', i);
      command(s, 'upgrade', i);
    }
    const before = s.energy;
    start(s);
    runToEnd(s);
    expect(s.phase).toBe('clear');
    expect(s.lives).toBe(START_LIVES);
    expect(s.kills).toBe(s.spawns.length);
    expect(s.energy - before).toBe(s.spawns.reduce((n, sp) => n + ENEMIES[sp.kind].bounty, 0));
    expect(summarize(s)).toMatchObject({ cleared: true, stars: 3, wave: 6 });
  });

  it('보스 스테이지: 2분에 보스가 나오고(3초 전 경고), 3분이 지나도 보스가 없어질 때까지 계속되며, 출구에 닿으면 생명이 5 준다', () => {
    const s = game('1-5');
    s.lives = s.startLives = 100000;
    start(s);
    const warn = collect(s, 118, EV.bossWarn);
    expect(warn).toHaveLength(1);
    expect(warn[0].time).toBeCloseTo(117, 1);
    expect(activeBoss(s)).toBeNull();
    run(s, 2.1);
    const boss = activeBoss(s)!;
    expect(BOSSES[boss.boss].id).toBe('bigDokkaebi');
    run(s, 61);
    // 3분이 지났다: 보스가 길 위에 있으니 판은 계속된다
    expect(s.time).toBeGreaterThan(RUN_SEC);
    expect(activeBoss(s)).toBe(boss);
    expect(s.phase).toBe('play');
    const leaks: number[] = [];
    while (s.phase === 'play') {
      step(s);
      for (let k = 0; k < s.evN; k++) if (s.events[k].t === EV.leak && s.events[k].b >= 0) leaks.push(s.events[k].a);
    }
    expect(leaks).toEqual([5]);
    expect(s.phase).toBe('clear');
  });

  it('생명이 0이 되면 그 자리에서 실패한다 (보스는 한 번에 5)', () => {
    const s = game('1-5');
    s.lives = 100000;
    start(s);
    run(s, 121);
    s.lives = 5;
    runToEnd(s);
    expect(s.phase).toBe('fail');
    expect(s.lives).toBe(0);
  });
});

describe('배치 · 강화 · 되팔기', () => {
  it('배치하면 비용만큼 기운이 줄고, 기운이 모자라거나 이미 놓인 칸에는 놓을 수 없다', () => {
    const s = game();
    const e0 = s.energy;
    expect(command(s, 'place', 0, T.tiger)).toBe(true);
    expect(s.energy).toBe(e0 - TOWERS[T.tiger].cost);
    expect(command(s, 'place', 0, T.rat)).toBe(false);
    s.energy = TOWERS[T.rabbit].cost - 1;
    expect(canPlace(s, 1, T.rabbit)).toBe(false);
    expect(command(s, 'place', 1, T.rabbit)).toBe(false);
    expect(command(s, 'place', 99, T.rat)).toBe(false);
    // 같은 캐릭터를 여러 칸에 놓을 수 있다
    s.energy = 1000;
    expect(command(s, 'place', 1, T.tiger)).toBe(true);
    expect(command(s, 'place', 2, T.tiger)).toBe(true);
  });

  it('데려가지 않은 캐릭터는 놓을 수 없다', () => {
    const s = createGame({ seed: 1, stage: '1-1', squad: ['rat', 'ox'] });
    expect(s.squad).toEqual([T.rat, T.ox]);
    expect(command(s, 'place', 0, T.tiger)).toBe(false);
    expect(command(s, 'place', 0, T.ox)).toBe(true);
  });

  it('강화는 3단계까지, 단계마다 정해진 비용', () => {
    const s = rich(game());
    command(s, 'place', 0, T.rat);
    const def = TOWERS[T.rat];
    expect(upgradeCost(s, 0)).toBe(def.up[0]);
    let e = s.energy;
    expect(command(s, 'upgrade', 0)).toBe(true);
    expect(s.energy).toBe(e - def.up[0]);
    e = s.energy;
    expect(command(s, 'upgrade', 0)).toBe(true);
    expect(s.energy).toBe(e - def.up[1]);
    expect(s.towers[0].lv).toBe(3);
    expect(upgradeCost(s, 0)).toBeNull();
    expect(command(s, 'upgrade', 0)).toBe(false);
    expect(command(s, 'upgrade', 5)).toBe(false);
  });

  it('되팔면 쓴 기운(배치 + 강화)의 70%를 돌려받는다. 시작 전에는 전부', () => {
    const s = rich(game(), 1000);
    command(s, 'place', 0, T.tiger);
    command(s, 'upgrade', 0);
    const spent = TOWERS[T.tiger].cost + TOWERS[T.tiger].up[0];
    expect(s.energy).toBe(1000 - spent);
    // 시작 전: 전부 돌려받는다
    expect(sellValue(s, 0)).toBe(spent);
    start(s);
    run(s, 0.5);
    expect(SELL_RATE).toBe(0.7);
    expect(sellValue(s, 0)).toBe(Math.floor(spent * 0.7));
    expect(command(s, 'sell', 0)).toBe(true);
    expect(s.energy).toBe(1000 - spent + Math.floor(spent * 0.7));
    expect(s.towers[0].char).toBe(-1);
    expect(command(s, 'sell', 0)).toBe(false);
    // 빈 칸에는 다시 놓을 수 있다
    expect(command(s, 'place', 0, T.rat)).toBe(true);
    // 쥐 1단계 + 강화 = 90 → 63 (62.999… 로 계산되어 1 모자라지 않는다)
    command(s, 'upgrade', 0);
    expect(s.towers[0].spent).toBe(90);
    expect(sellValue(s, 0)).toBe(63);
  });

  it('판이 끝난 뒤에는 명령을 받지 않는다', () => {
    const s = game();
    start(s);
    runToEnd(s);
    expect(command(s, 'place', 0, T.rat)).toBe(false);
  });
});

describe('결정적 계산', () => {
  it('같은 설정과 같은 명령이면 결과가 같고, 명령 기록으로 판을 그대로 다시 만들 수 있다', () => {
    const cfg = { seed: 77, stage: '1-3', squad: [...STARTERS] };
    const a = simulate(cfg, normalPolicy(5));
    const b = simulate(cfg, normalPolicy(5));
    expect(summarize(a.state)).toEqual(summarize(b.state));
    expect(a.state.log.length).toBeGreaterThan(3);
    const c = replay(cfg, a.state.log);
    expect(summarize(c)).toEqual(summarize(a.state));
    expect(c.tick).toBe(a.state.tick);
    expect(c.energy).toBe(a.state.energy);
    expect(c.log).toEqual(a.state.log);
    // 명령이 다르면(다른 정책) 다른 판이 된다
    const d = simulate(cfg, normalPolicy(6));
    expect(d.state.log).not.toEqual(a.state.log);
  });

  it('요괴·투사체·이펙트는 미리 만든 칸을 돌려 쓴다 (판이 끝날 때까지 배열이 늘지 않는다)', () => {
    const s = rich(game('1-4'));
    for (let i = 0; i < s.towers.length; i++) command(s, 'place', i, [T.rat, T.rabbit, T.ox, T.tiger][i % 4]);
    const sizes = [s.enemies.length, s.projectiles.items.length, s.fx.items.length, s.events.length];
    const first = [s.enemies[0], s.projectiles.items[0], s.fx.items[0]];
    start(s);
    runToEnd(s);
    expect([s.enemies.length, s.projectiles.items.length, s.fx.items.length, s.events.length]).toEqual(sizes);
    expect(s.enemies[0]).toBe(first[0]);
    expect(s.projectiles.items).toContain(first[1]);
    expect(s.fx.items).toContain(first[2]);
  });
});

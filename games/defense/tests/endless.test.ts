import { describe, expect, it } from 'vitest';
import { TICK, WAVE_SEC } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { STARTERS } from '../src/data/characters';
import { ENDLESS_BOSS_EVERY, ENDLESS_ID, ENDLESS_STAGE, endlessBoss, endlessWave } from '../src/data/endless';
import { ENEMIES, ENEMY_INDEX } from '../src/data/enemies';
import { buildRoute, cellX, cellY, distToRoad } from '../src/game/path';
import { normalPolicy, simulate } from '../src/game/policy';
import { command, createGame, replay, step, summarize } from '../src/game/sim';
import { EV } from '../src/game/state';

describe('끝없는 모드의 맵과 웨이브', () => {
  it('맵: 길 하나 + 공중 경로, 배치 칸은 길을 밟지 않는다', () => {
    const routes = ENDLESS_STAGE.routes.map(buildRoute);
    expect(ENDLESS_STAGE.routes.some((r) => r.air)).toBe(true);
    const seen = new Set<string>();
    for (const [c, r] of ENDLESS_STAGE.slots) {
      expect(seen.has(`${c},${r}`)).toBe(false);
      seen.add(`${c},${r}`);
      expect(distToRoad(routes, cellX(c), cellY(r)), `칸 [${c}, ${r}]`).toBeGreaterThanOrEqual(66);
    }
  });

  it('웨이브는 번호로 정해진다: 같은 번호면 언제나 같고, 뒤로 갈수록 많고 단단하며 새 요괴가 나온다', () => {
    expect(endlessWave(7)).toEqual(endlessWave(7));
    const weight = (w: number) => endlessWave(w).groups.reduce((n, g) => n + g.count * ENEMIES[ENEMY_INDEX[g.enemy]].hp, 0) * endlessWave(w).hp!;
    for (let w = 1; w < 60; w++) expect(endlessWave(w).hp!).toBeGreaterThan(endlessWave(w - 1).hp!);
    expect(weight(10)).toBeGreaterThan(weight(2) * 2);
    expect(weight(30)).toBeGreaterThan(weight(10) * 3);
    expect(endlessWave(0).groups.map((g) => g.enemy)).toEqual(['imp']);
    const kinds = new Set<string>();
    for (let w = 0; w < 40; w++) {
      for (const g of endlessWave(w).groups) {
        kinds.add(g.enemy);
        expect(ENEMY_INDEX[g.enemy]).toBeDefined();
        // 모든 등장이 그 웨이브의 30초 안에 끝난다
        expect(g.at + (g.count - 1) * g.gap).toBeLessThan(WAVE_SEC);
      }
    }
    expect(kinds.size).toBe(ENEMIES.length);
  });

  it('보스는 5웨이브마다, 12종이 차례로 나오고 한 바퀴 돌 때마다 더 단단해진다', () => {
    expect(endlessBoss(0)).toBeNull();
    expect(endlessBoss(ENDLESS_BOSS_EVERY - 1)).toMatchObject({ boss: 0 });
    expect(endlessBoss(2 * ENDLESS_BOSS_EVERY - 1)).toMatchObject({ boss: 1 });
    const again = endlessBoss((BOSSES.length + 1) * ENDLESS_BOSS_EVERY - 1)!;
    expect(again.boss).toBe(0);
    expect(again.hp).toBeGreaterThan(endlessBoss(ENDLESS_BOSS_EVERY - 1)!.hp * 5);
  });
});

describe('끝없는 모드의 판', () => {
  it('3분이 지나도 끝나지 않고 웨이브가 이어진다. 생명이 0이 되면 끝나고 도달 웨이브가 남는다', () => {
    const s = createGame({ seed: 3, stage: ENDLESS_ID, squad: [...STARTERS] });
    expect(s.endless).toBe(true);
    expect(s.spawns).toHaveLength(0);
    s.lives = s.startLives = 300;
    command(s, 'start');
    const waves: number[] = [];
    while (s.phase === 'play' && s.time < 400) {
      step(s);
      for (let k = 0; k < s.evN; k++) if (s.events[k].t === EV.wave) waves.push(s.events[k].a);
    }
    // 아무것도 놓지 않았다: 요괴가 다 지나가지만 3분(웨이브 6)을 넘겨 계속된다
    expect(s.time).toBeGreaterThan(200);
    expect(waves.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.phase === 'play' || s.phase === 'fail').toBe(true);
    s.lives = 1;
    while (s.phase === 'play') step(s);
    expect(s.phase).toBe('fail');
    const r = summarize(s);
    expect(r).toMatchObject({ endless: true, cleared: false, stars: 0, lives: 0 });
    expect(r.wave).toBe(Math.floor((s.tick - 1) / (WAVE_SEC / TICK)) + 1);
    expect(r.codex.enemies).toContain('imp');
  });

  it('보통 실력으로 여러 웨이브를 버티고, 5번째 웨이브에 보스를 만난다. 명령 기록으로 그대로 다시 만들 수 있다', { timeout: 60_000 }, () => {
    const cfg = { seed: 9, stage: ENDLESS_ID, squad: [...STARTERS] };
    const a = simulate(cfg, normalPolicy(4), 3700);
    expect(a.summary.cleared).toBe(false);
    expect(a.summary.wave).toBeGreaterThanOrEqual(6);
    expect(a.summary.codex.bosses).toContain(BOSSES[0].id);
    const b = replay(cfg, a.state.log, 3700);
    expect(summarize(b)).toEqual(a.summary);
  });
});

import { describe, expect, it } from 'vitest';
import { TICK, type CharId } from '../src/data/balance';
import { TOWER_INDEX } from '../src/data/characters';
import { ENEMY_INDEX } from '../src/data/enemies';
import { placeOnRoute, spawnEnemy } from '../src/game/core';
import { featsOf, pickMvp, supportLine, type FeatRow } from '../src/game/feats';
import { SKILLS, simulate, skillPolicy } from '../src/game/policy';
import { command, createGame, step, summarize } from '../src/game/sim';
import type { Enemy, State } from '../src/game/state';

/** 결과 화면 활약상: 캐릭터별 피해·처치 집계, 지원 기여, 오늘의 일꾼 */

function arena(squad: CharId[]): State {
  const s = createGame({ seed: 1, stage: '1-1', squad });
  s.energy = 100000;
  s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }];
  command(s, 'start');
  return s;
}
/** 0번 칸([200,200]) 위의 길에 멈춰 선 요괴. dx = 240~270 이면 1번 칸([440,200])과 2번 칸([520,280])이 함께 닿는다 */
const NEAR12 = 270;
function foe(s: State, dx: number, hp: number, kind = 'imp'): Enemy {
  const e = spawnEnemy(s, ENEMY_INDEX[kind], -1, 0, 1, s.slotX[0] + 80 + dx)!;
  e.hp = e.maxHp = hp;
  e.speed = 0;
  placeOnRoute(s, e);
  return e;
}
const tick = (s: State, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK); i++) step(s);
};
const I = TOWER_INDEX;
const row = (s: State, c: string) => featsOf(s).rows.find((r) => r.char === c)!;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('집계 (hurt · burn · fall)', () => {
  it('준 피해는 실제로 깎은 체력만 세고, 처치는 쓰러뜨린 캐릭터의 것', () => {
    const s = arena(['rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 0, I.rat);
    const a = foe(s, 0, 25); // 표창 몇 번이면 쓰러진다 (마지막 한 방은 남은 체력까지만 센다)
    const b = foe(s, -10, 100000);
    tick(s, 6);
    expect(a.alive).toBe(false);
    expect(s.kills).toBe(1);
    expect(s.stats.kills[I.rat]).toBe(1);
    expect(s.stats.dmg[I.rat]).toBeCloseTo(25 + (100000 - b.hp), 6);
    // 다른 캐릭터에게는 아무것도 적히지 않는다
    expect(sum(s.stats.dmg)).toBe(s.stats.dmg[I.rat]);
    const f = featsOf(s);
    expect(f.rows.map((r) => r.char)).toEqual(['rat']); // 놓지 않은 캐릭터는 줄이 없다
    expect(f.rows[0]).toMatchObject({ kills: 1, dmg: Math.round(s.stats.dmg[I.rat]), stun: 0, slow: 0, boost: 0, energy: 0 });
    expect(f.mvp).toBe('rat');
    expect(summarize(s).feats).toEqual(f);
  });

  it('여럿이 함께 때리면 각자 준 만큼 나뉘고, 합은 깎인 체력과 같다', () => {
    const s = arena(['rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 1, I.rat);
    command(s, 'place', 2, I.rabbit);
    const foes = [foe(s, NEAR12, 50000), foe(s, NEAR12 - 20, 50000), foe(s, NEAR12 - 40, 50000)];
    tick(s, 8);
    const lost = sum(foes.map((e) => 50000 - e.hp));
    expect(lost).toBeGreaterThan(0);
    expect(sum(s.stats.dmg)).toBeCloseTo(lost, 4);
    expect(s.stats.dmg[I.rat]).toBeGreaterThan(0);
    expect(s.stats.dmg[I.rabbit]).toBeGreaterThan(0); // 달떡(범위 폭발)도 던진 토끼의 것
  });

  it('독으로 준 피해와 독으로 쓰러진 요괴는 뱀의 것', () => {
    const s = arena(['snake', 'rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 0, I.snake);
    const e = foe(s, 0, 30);
    tick(s, 1.2); // 한 번 맞고
    command(s, 'sell', 0); // 뱀이 없어도 독은 남아 깎는다
    const direct = s.stats.dmg[I.snake];
    tick(s, 20);
    expect(e.alive).toBe(false);
    expect(s.stats.dmg[I.snake]).toBeGreaterThan(direct);
    expect(s.stats.dmg[I.snake]).toBeCloseTo(30, 4);
    expect(s.stats.kills[I.snake]).toBe(1);
    // 되판 캐릭터도 활약상에 남는다
    expect(row(s, 'snake')).toMatchObject({ kills: 1, dmg: 30 });
  });

  it('되살아나는 요괴는 완전히 쓰러졌을 때 한 번만 처치로 센다', () => {
    const s = arena(['rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 0, I.rat);
    foe(s, 0, 20, 'skeleton');
    tick(s, 12);
    expect(s.kills).toBe(1);
    expect(s.stats.kills[I.rat]).toBe(1);
    expect(s.stats.dmg[I.rat]).toBeCloseTo(30, 6); // 20 + 되살아난 체력 10
  });
});

describe('지원 기여', () => {
  it('소: 요괴를 멈춘 시간', () => {
    const s = arena(['ox', 'rat', 'tiger', 'rabbit']);
    command(s, 'place', 0, I.ox);
    foe(s, 0, 100000);
    foe(s, 20, 100000);
    tick(s, 0.5);
    const L = s.lv[I.ox][0];
    expect(s.stats.stun[I.ox]).toBeCloseTo((L.stun ?? 0) * 2, 6);
    expect(supportLine(row(s, 'ox'))).toContain('멈춘 시간');
  });

  it('양: 느리게 한 시간. 3단계는 느려진 동안 더 들어간 피해도', () => {
    const s = arena(['sheep', 'rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 1, I.sheep);
    command(s, 'upgrade', 1);
    command(s, 'upgrade', 1);
    command(s, 'place', 2, I.rat);
    const e = foe(s, NEAR12, 100000);
    tick(s, 5);
    expect(s.stats.slow[I.sheep]).toBeGreaterThan(4);
    expect(s.stats.slow[I.sheep]).toBeLessThanOrEqual(5 + 1e-6);
    const vuln = s.lv[I.sheep][2].vuln ?? 0;
    expect(vuln).toBeGreaterThan(0);
    // 쥐가 준 피해 가운데 양이 올려 준 몫 = 피해 × vuln / (1 + vuln)
    expect(100000 - e.hp).toBeCloseTo(s.stats.dmg[I.rat], 4);
    expect(s.stats.boost[I.sheep]).toBeCloseTo((s.stats.dmg[I.rat] * vuln) / (1 + vuln), 4);
    const line = supportLine(row(s, 'sheep'));
    expect(line).toContain('느리게 한 시간');
    expect(line).toContain('올려 준 피해');
  });

  it('닭: 빨라진 만큼 더 준 피해 (곁의 캐릭터가 준 피해 × 보너스 / (1 + 보너스))', () => {
    const s = arena(['rooster', 'rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 1, I.rat);
    command(s, 'place', 2, I.rooster);
    const h = s.towers[1].haste;
    expect(h).toBeGreaterThan(0);
    expect(s.towers[1].hasteBy).toBe(I.rooster);
    foe(s, 240, 100000); // 쥐만 닿는 자리 (닭의 깃털은 닿지 않는다)
    tick(s, 5);
    expect(s.stats.dmg[I.rat]).toBeGreaterThan(0);
    expect(s.stats.boost[I.rooster]).toBeCloseTo((s.stats.dmg[I.rat] * h) / (1 + h), 4);
    // 닭을 치우면 그 뒤로는 늘지 않는다
    command(s, 'sell', 2);
    expect(s.towers[1].hasteBy).toBe(-1);
    tick(s, 1); // 날아가던 표창이 다 맞을 때까지
    const was = s.stats.boost[I.rooster];
    tick(s, 3);
    expect(s.stats.boost[I.rooster]).toBe(was);
  });

  it('돼지: 벌어 준 기운', () => {
    const s = createGame({ seed: 1, stage: '1-1', squad: ['pig', 'rat', 'ox', 'tiger', 'rabbit'] });
    s.energy = 100000;
    command(s, 'place', 0, I.pig);
    command(s, 'start');
    tick(s, 31); // 웨이브 1·2 가 시작될 때 한 번씩
    const inc = s.lv[I.pig][0].income ?? 0;
    expect(inc).toBeGreaterThan(0);
    expect(s.stats.energy[I.pig]).toBe(inc * 2);
    expect(supportLine(row(s, 'pig'))).toBe(`벌어 준 기운 ${inc * 2}`);
  });
});

describe('오늘의 일꾼 · 한 판 전체', () => {
  const r = (char: CharId, dmg: number, kills = 0, boost = 0): FeatRow => ({ char, dmg, kills, stun: 0, slow: 0, boost, energy: 0 });

  it('준 피해 + 올려 준 피해가 가장 큰 캐릭터. 같으면 처치가 많은 쪽, 아무도 없으면 null', () => {
    expect(pickMvp([r('rat', 100, 9), r('tiger', 300, 2), r('rabbit', 250, 5)])).toBe('tiger');
    expect(pickMvp([r('rat', 100), r('rooster', 10, 0, 200)])).toBe('rooster');
    expect(pickMvp([r('rat', 100, 1), r('tiger', 100, 3)])).toBe('tiger');
    expect(pickMvp([r('rat', 100, 3), r('tiger', 100, 3)])).toBe('rat');
    expect(pickMvp([r('pig', 0), r('ox', 0)])).toBeNull();
    expect(pickMvp([])).toBeNull();
    expect(supportLine(r('rat', 100, 3))).toBe('');
  });

  it('자동 조종 한 판: 캐릭터별 처치의 합은 전체 처치를 넘지 않고, 결과에 활약상이 실린다', { timeout: 60_000 }, () => {
    const cfg = { seed: 3, stage: '1-4', squad: ['rat', 'ox', 'tiger', 'rabbit'] as CharId[] };
    const a = simulate(cfg, skillPolicy(11, SKILLS.normal));
    const st = a.state.stats;
    expect(sum(st.kills)).toBeGreaterThan(0);
    expect(sum(st.kills)).toBeLessThanOrEqual(a.summary.kills);
    const f = a.summary.feats;
    expect(f.rows.length).toBeGreaterThan(0);
    expect(f.mvp).not.toBeNull();
    expect(sum(f.rows.map((x) => x.kills))).toBe(sum(st.kills));
    for (const x of f.rows) expect(Number.isFinite(x.dmg) && x.dmg >= 0).toBe(true);
    // 같은 판은 활약상도 같다
    expect(simulate(cfg, skillPolicy(11, SKILLS.normal)).summary.feats).toEqual(f);
  });
});

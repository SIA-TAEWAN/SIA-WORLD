import { describe, expect, it } from 'vitest';
import { PASSIVE_INDEX } from '../src/data/passives';
import { WEAPON_INDEX, WEAPONS } from '../src/data/weapons';
import { damageShares, runBuild, type RunBuild } from '../src/game/build';
import { openChest } from '../src/game/levelup';
import { summarize } from '../src/game/sim';
import { rankGap, type RankRow } from '../src/net/rank';
import { advance, emptyRun, put } from './helpers';

const state = (weapons: [string, number][], passives: [string, number][], dmg: Record<string, number>) => {
  const dmgByWeapon = new Float64Array(WEAPONS.length);
  for (const [id, v] of Object.entries(dmg)) dmgByWeapon[WEAPON_INDEX[id]] = v;
  return {
    weapons: weapons.map(([id, lv]) => ({ def: WEAPON_INDEX[id], lv, cd: 0, a: 0, view: 0 })),
    passives: passives.map(([id, lv]) => ({ def: PASSIVE_INDEX[id], lv })),
    dmgByWeapon,
  };
};

describe('빌드 요약 (runBuild)', () => {
  it('든 무기·패시브를 든 순서대로, 레벨·진화 여부·피해와 함께 적는다', () => {
    const b = runBuild(state([['claw', 3], ['bell', 5]], [['fan', 2]], { claw: 120.4, bell: 300.6 }));
    expect(b.weapons).toEqual([
      { id: 'claw', lv: 3, evolved: false, dmg: 120 },
      { id: 'bell', lv: 5, evolved: false, dmg: 301 },
    ]);
    expect(b.passives).toEqual([{ id: 'fan', lv: 2 }]);
  });

  it('진화 무기에는 진화 전 무기가 준 피해를 합친다', () => {
    const b = runBuild(state([['shurikenEvo', 1], ['bell', 2]], [['fan', 1]], { shuriken: 400, shurikenEvo: 600, bell: 50 }));
    expect(b.weapons[0]).toEqual({ id: 'shurikenEvo', lv: 1, evolved: true, dmg: 1000 });
    expect(b.weapons[1].dmg).toBe(50);
  });

  it('들고 있지 않은 무기의 피해는 넣지 않는다', () => {
    const b = runBuild(state([['bell', 1]], [], { bell: 10, claw: 999 }));
    expect(b.weapons).toEqual([{ id: 'bell', lv: 1, evolved: false, dmg: 10 }]);
  });

  it('실제 판: summarize 가 빌드를 넘기고, 보물상자 진화 뒤에도 피해가 이어진다', () => {
    const s = emptyRun({ char: 'rat' });
    s.weapons[0].def = WEAPON_INDEX.shuriken;
    for (let i = 0; i < 6; i++) put(s, 'club', s.player.x + 60 + i * 8, s.player.y);
    advance(s, 4, { immortal: true });
    const before = summarize(s).build!;
    expect(before.weapons.map((w) => w.id)).toEqual(s.weapons.map((w) => WEAPONS[w.def].id));
    expect(before.weapons[0].dmg).toBeGreaterThan(0);
    // 진화 조건(5레벨 + 부채)을 만들고 상자를 연다: 진화 전에 준 피해가 진화 무기로 넘어간다
    s.weapons[0].lv = 5;
    if (!s.passives.some((p) => p.def === PASSIVE_INDEX.fan)) s.passives.push({ def: PASSIVE_INDEX.fan, lv: 1 });
    openChest(s);
    const after = summarize(s).build!;
    expect(after.weapons[0]).toEqual({ id: 'shurikenEvo', lv: 1, evolved: true, dmg: before.weapons[0].dmg });
  });
});

describe('무기별 피해 비율 (damageShares)', () => {
  const build = (ws: [string, number][]): RunBuild => ({ weapons: ws.map(([id, dmg]) => ({ id, lv: 1, evolved: false, dmg })), passives: [] });

  it('많이 준 순으로, 비율과 막대 길이(1등 = 100)를 낸다', () => {
    const out = damageShares(build([['bell', 100], ['claw', 300], ['mist', 600]]));
    expect(out.map((w) => w.id)).toEqual(['mist', 'claw', 'bell']);
    expect(out.map((w) => w.pct)).toEqual([60, 30, 10]);
    expect(out.map((w) => w.bar)).toEqual([100, 50, 17]);
    expect(out[0].name).toBe(WEAPONS[WEAPON_INDEX.mist].name);
  });

  it('피해가 같으면 든 순서, 피해가 하나도 없으면 모두 0', () => {
    expect(damageShares(build([['bell', 5], ['claw', 5]])).map((w) => w.id)).toEqual(['bell', 'claw']);
    expect(damageShares(build([['bell', 0], ['claw', 0]])).map((w) => [w.pct, w.bar])).toEqual([[0, 0], [0, 0]]);
    expect(damageShares(build([]))).toEqual([]);
  });

  it('모르는 무기 id·이상한 값은 건너뛰거나 0으로 본다', () => {
    const out = damageShares(build([['nope', 50], ['bell', Number.NaN], ['claw', 10]]));
    expect(out.map((w) => [w.id, w.pct])).toEqual([['claw', 100], ['bell', 0]]);
  });
});

describe('내 위 한 명과의 차이 (rankGap)', () => {
  const row = (place: number, time: number, kills = 100, key = `u${place}`): RankRow => ({ key, nickname: `닉${place}`, time, kills, place });

  it('1등이면 first', () => {
    const me = row(1, 240);
    expect(rankGap([me, row(2, 200)], me)).toEqual({ kind: 'first', place: 1 });
  });

  it('바로 위 사람과의 생존 시간 차이', () => {
    const me = row(3, 188);
    expect(rankGap([row(1, 240), row(2, 200), me, row(4, 100)], me)).toEqual({ kind: 'time', place: 3, name: '닉2', amount: 12 });
  });

  it('생존 시간이 같으면 처치 수 차이, 그것도 같으면 tie', () => {
    const me = row(2, 240, 500);
    expect(rankGap([row(1, 240, 534), me], me)).toEqual({ kind: 'kills', place: 2, name: '닉1', amount: 34 });
    expect(rankGap([row(1, 240, 500), me], me)).toEqual({ kind: 'tie', place: 2, name: '닉1' });
  });

  it('내가 목록 밖이면 목록의 마지막 사람까지', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(i + 1, 240 - i));
    expect(rankGap(rows, row(150, 100, 10, 'me'))).toEqual({ kind: 'time', place: 150, name: '닉100', amount: 41 });
  });

  it('내 기록이 없거나 위 사람을 알 수 없으면 null', () => {
    expect(rankGap([row(1, 240)], null)).toBeNull();
    expect(rankGap([], row(5, 100))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { CONST, COST_MUL, HALL_AT, HALL_CAP, HALL_NEED, LAND_SIZES, LEVEL_EXP, RATE_MUL, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC, lookOf } from '../src/data/balance';
import { BUILDING, BUILDINGS } from '../src/data/buildings';
import { GOALS, goalText, josa } from '../src/data/goals';
import {
  RuleError, addExp, build, claimGoal, cleanState, cloneState, goalStatus, harvest, landRect, maxCount, move, newVillage, placeError, ratePerHour, settle, slots,
  storageCap, stored, upgrade, upgradeCost, upgradeSec, type VillageState,
} from '../src/game/rules';

const T0 = 1_700_000_000_000;
const SEC = 1000;
const HOUR = 3600 * SEC;
let seq = 0;
const id = () => `b${++seq}`;
const rich = (s: VillageState, n = 100000) => ((s.profile.resources.rice = n), (s.profile.resources.wood = n), s);
const why = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RuleError) return e.message;
    throw e;
  }
  return null;
};

describe('수치 표', () => {
  it('길이와 오름차순', () => {
    expect(LEVEL_EXP).toHaveLength(CONST.max_level - 1);
    for (const t of [COST_MUL, UPGRADE_SEC, UPGRADE_EXP, HALL_NEED]) expect(t).toHaveLength(CONST.building_max_level - 1);
    for (const t of [RATE_MUL, HALL_CAP, STORAGE_CAP]) expect(t).toHaveLength(CONST.building_max_level);
    for (const t of [LEVEL_EXP, COST_MUL, UPGRADE_SEC, UPGRADE_EXP, HALL_NEED, RATE_MUL, HALL_CAP, STORAGE_CAP, LAND_SIZES]) {
      for (let i = 1; i < t.length; i++) expect(t[i], `${t}`).toBeGreaterThan(t[i - 1]);
    }
    expect(LAND_SIZES).toEqual([8, 10, 12, 14, 16, 18, 20]);
    expect(Math.max(...HALL_NEED)).toBeLessThanOrEqual(CONST.max_level);
  });

  it('건물: 해금 레벨은 오름차순, 마을 회관은 하나', () => {
    for (const d of BUILDINGS) {
      expect(d.unlock.length).toBeGreaterThan(0);
      for (let i = 1; i < d.unlock.length; i++) expect(d.unlock[i]).toBeGreaterThanOrEqual(d.unlock[i - 1]);
      expect(!!d.product).toBe(d.rate > 0);
    }
    expect(BUILDING.hall.unlock).toEqual([1]);
    // PRD 5장: 논 · 주민 집은 레벨 1, 벌목장 · 창고는 2 / 7장: 집은 주민이 이사 오는 레벨마다 한 채
    expect([BUILDING.paddy.unlock[0], BUILDING.house.unlock[0], BUILDING.lumber.unlock[0], BUILDING.storage.unlock[0]]).toEqual([1, 1, 2, 2]);
    expect(BUILDING.house.unlock).toEqual([1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24]);
  });

  it('업그레이드 값은 그때의 창고 용량 안에 든다 (창고를 하나도 안 지어도 마을 회관은 올릴 수 있다)', () => {
    for (let lv = 1; lv < CONST.building_max_level; lv++) {
      const c = upgradeCost('hall', lv);
      expect(Math.max(c.rice, c.wood), `hall ${lv}`).toBeLessThanOrEqual(HALL_CAP[lv - 1]);
      // 다른 건물을 레벨 lv+1 로 올릴 때 마을 회관은 lv+1 이상
      for (const d of BUILDINGS.filter((v) => v.id !== 'hall')) {
        const u = upgradeCost(d.id, lv);
        expect(Math.max(u.rice, u.wood), `${d.id} ${lv}`).toBeLessThanOrEqual(HALL_CAP[lv]);
      }
    }
    for (const d of BUILDINGS) expect(Math.max(d.rice, d.wood)).toBeLessThanOrEqual(HALL_CAP[0]);
  });

  it('모습 3단계: 레벨 1~3 / 4~7 / 8~10', () => {
    expect([1, 3, 4, 7, 8, 10].map(lookOf)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('목표: 순서대로 할 수 있다 (그 목표가 나올 때 건물이 열려 있고, 마을 회관 레벨이 닿는다)', () => {
    let level = 1;
    let hall = 1;
    for (const g of GOALS) {
      if (g.kind === 'level') level = Math.max(level, g.n);
      if (g.kind === 'build') expect(maxCount(g.type as 'paddy', level), goalText(g)).toBeGreaterThanOrEqual(g.n);
      if (g.kind === 'upgrade' && g.type === 'hall') {
        expect(level).toBeGreaterThanOrEqual(HALL_NEED[g.n - 2]);
        hall = g.n;
      }
      if (g.kind === 'upgrade' && g.type !== 'hall') expect(hall, goalText(g)).toBeGreaterThanOrEqual(g.n);
      expect(goalText(g).length).toBeGreaterThan(4);
    }
    expect(josa('논', '을', '를')).toBe('을');
    expect(josa('창고', '을', '를')).toBe('를');
    expect(goalText(GOALS[0])).toBe('논을 지어 보세요');
  });
});

describe('땅과 자리', () => {
  it('땅은 20×20 한가운데의 정사각형', () => {
    expect(landRect(0)).toEqual({ x0: 6, size: 8 });
    expect(landRect(6)).toEqual({ x0: 0, size: 20 });
    expect(landRect(3)).toEqual({ x0: 3, size: 14 });
  });

  it('새 마을: 한가운데에 마을 회관', () => {
    const s = newVillage(T0);
    expect(s.buildings).toHaveLength(1);
    expect(s.buildings[0]).toMatchObject({ type: 'hall', x: HALL_AT.x, y: HALL_AT.y, state: 'done', level: 1 });
    expect(placeError(s, 'hall', HALL_AT.x, HALL_AT.y, s.buildings[0].id)).toBeNull();
  });

  it('땅 밖 · 겹침', () => {
    const s = newVillage(T0);
    expect(placeError(s, 'paddy', 6, 6)).toBeNull();
    expect(placeError(s, 'paddy', 13, 13)).toBeNull();
    expect(placeError(s, 'paddy', 5, 6)).toBe('out of land');
    expect(placeError(s, 'paddy', 14, 6)).toBe('out of land');
    expect(placeError(s, 'paddy', 6.5, 6)).toBe('out of land');
    expect(placeError(s, 'hall', 13, 13)).toBe('out of land');
    for (const [x, y] of [[9, 9], [10, 9], [9, 10], [10, 10]]) expect(placeError(s, 'paddy', x, y)).toBe('occupied');
    expect(placeError(s, 'paddy', 8, 9)).toBeNull();
    expect(placeError(s, 'paddy', 11, 10)).toBeNull();
    // 2×2 를 한 칸 옆으로: 자기 자리와 겹치는 것은 된다
    expect(placeError(s, 'hall', 10, 9, s.buildings[0].id)).toBeNull();
    expect(placeError(s, 'hall', 10, 9)).toBe('occupied');
  });
});

describe('짓기', () => {
  it('자원을 내고 짓기 시작, 시간이 지나면 끝나고 경험치', () => {
    const s = newVillage(T0);
    const b = build(s, 'paddy', 6, 6, T0, id());
    expect(s.profile.resources).toMatchObject({ rice: 45, wood: 40 });
    expect(b).toMatchObject({ state: 'building', finishAt: T0 + 10 * SEC, startAt: T0 });
    settle(s, T0 + 9 * SEC);
    expect(b.state).toBe('building');
    settle(s, T0 + 10 * SEC);
    expect(b).toMatchObject({ state: 'done', finishAt: null, collectedAt: T0 + 10 * SEC });
    expect(s.profile.exp).toBe(10);
  });

  it('거절: 모르는 건물 · 잠김 · 개수 · 슬롯 · 자리 · 자원', () => {
    const s = newVillage(T0);
    expect(why(() => build(s, 'castle', 6, 6, T0, id()))).toBe('bad type');
    expect(why(() => build(s, 'lumber', 6, 6, T0, id()))).toBe('locked');
    expect(why(() => build(s, 'hall', 6, 6, T0, id()))).toBe('limit');
    expect(why(() => build(s, 'paddy', 9, 9, T0, id()))).toBe('occupied');
    expect(why(() => build(s, 'paddy', 0, 0, T0, id()))).toBe('out of land');
    build(s, 'paddy', 6, 6, T0, id());
    build(s, 'house', 7, 6, T0, id());
    expect(why(() => build(s, 'paddy', 8, 6, T0, id()))).toBe('no slot');
    // 논이 끝나면 슬롯이 하나 빈다
    build(s, 'paddy', 8, 6, T0 + 10 * SEC, id());
    expect(why(() => build(s, 'paddy', 6, 7, T0 + 60 * SEC, id()))).toBe('limit');
    s.profile.level = 3;
    s.profile.resources.wood = 9;
    expect(why(() => build(s, 'paddy', 6, 7, T0 + 60 * SEC, id()))).toBe('not enough');
    expect(s.buildings).toHaveLength(4);
    expect(s.profile.resources.wood).toBe(9);
  });

  it('옮기기: 비용 없음, 짓는 중에도 된다', () => {
    const s = newVillage(T0);
    const b = build(s, 'paddy', 6, 6, T0, id());
    const res = { ...s.profile.resources };
    move(s, b.id, 7, 7, T0);
    expect(b).toMatchObject({ x: 7, y: 7, state: 'building' });
    expect(s.profile.resources).toEqual(res);
    expect(why(() => move(s, b.id, 9, 9, T0))).toBe('occupied');
    expect(why(() => move(s, b.id, 5, 5, T0))).toBe('out of land');
    expect(why(() => move(s, 'nope', 6, 6, T0))).toBe('no building');
  });
});

describe('생산과 수확', () => {
  const withPaddy = () => {
    const s = newVillage(T0);
    const b = build(s, 'paddy', 6, 6, T0 - 10 * SEC, id());
    settle(s, T0);
    return { s, b };
  };

  it('쌓인 양 = floor(지난 초 × 시간당 ÷ 3600), 최대 12시간', () => {
    const { b } = withPaddy();
    expect(stored(b, T0)).toBe(0);
    expect(stored(b, T0 + 59 * SEC)).toBe(0);
    expect(stored(b, T0 + 60 * SEC)).toBe(1);
    expect(stored(b, T0 + HOUR)).toBe(60);
    expect(stored(b, T0 + 12 * HOUR)).toBe(720);
    expect(stored(b, T0 + 30 * 24 * HOUR)).toBe(720);
    expect(stored({ ...b, state: 'upgrading' }, T0 + HOUR)).toBe(0);
    expect(ratePerHour('paddy', 2)).toBe(78);
    expect(ratePerHour('lumber', 10)).toBe(220);
  });

  it('수확: 자원 · 경험치, 바로 또 하면 없다, 되다 만 시간은 남는다', () => {
    const { s, b } = withPaddy();
    const r = harvest(s, [b.id], T0 + 30 * 60 * SEC + 45 * SEC);
    expect(r).toEqual({ per: { [b.id]: 30 }, gained: { rice: 30 }, exp: 1, lost: 0 });
    expect(s.profile.resources.rice).toBe(45 + 30);
    // 30개 = 1800초만 썼다 → 15초 뒤에 1개가 더 찬다
    expect(b.collectedAt).toBe(T0 + 1800 * SEC);
    expect(harvest(s, [b.id, b.id], T0 + 30 * 60 * SEC + 45 * SEC).per).toEqual({});
    expect(harvest(s, [b.id], T0 + 31 * 60 * SEC).per).toEqual({ [b.id]: 1 });
  });

  it('창고 용량까지만 들어가고 넘친 것은 버린다. 경험치는 쌓여 있던 양으로 준다 (창고가 가득 차도 끊기지 않는다)', () => {
    const { s, b } = withPaddy();
    s.profile.resources.rice = 100;
    let t = T0 + 100 * HOUR;
    const r = harvest(s, [b.id], t);
    expect(storageCap(s)).toBe(300);
    expect(r).toEqual({ per: { [b.id]: 200 }, gained: { rice: 200 }, exp: 36, lost: 520 });
    expect(s.profile.resources.rice).toBe(300);
    // 건물은 비워졌다
    expect(stored(b, t)).toBe(0);
    expect(harvest(s, [b.id], t)).toEqual({ per: {}, gained: {}, exp: 0, lost: 0 });
    // 창고가 가득 찬 채로 거둬도 건물은 비워지고 경험치와 목표 횟수는 오른다
    t += 2 * HOUR;
    s.profile.goal = 2;
    const exp = s.profile.exp;
    expect(harvest(s, [b.id], t)).toEqual({ per: { [b.id]: 0 }, gained: {}, exp: 6, lost: 120 });
    expect(s.profile).toMatchObject({ exp: exp + 6, goalProgress: 1 });
    expect(s.profile.resources.rice).toBe(300);
  });

  it('요청 검사 · 없는 건물 · 생산하지 않는 건물은 그냥 넘어간다', () => {
    const { s, b } = withPaddy();
    expect(why(() => harvest(s, [], T0))).toBe('bad request');
    expect(why(() => harvest(s, Array(65).fill('x'), T0))).toBe('bad request');
    const r = harvest(s, ['nope', 'hall', b.id], T0 + HOUR);
    expect(r.per).toEqual({ [b.id]: 60 });
  });

  it('창고를 다 지으면 용량이 늘어난다', () => {
    const s = rich(newVillage(T0), 100);
    s.profile.level = 2;
    build(s, 'storage', 6, 6, T0, id());
    expect(storageCap(s)).toBe(300);
    settle(s, T0 + 60 * SEC);
    expect(storageCap(s)).toBe(450);
  });
});

describe('경험치와 레벨', () => {
  it('레벨마다 필요한 경험치, 한 번에 여러 레벨, 최고 레벨', () => {
    const p = newVillage(T0).profile;
    expect(addExp(p, LEVEL_EXP[0] - 1)).toBe(0);
    expect(addExp(p, 1)).toBe(1);
    expect(p).toMatchObject({ level: 2, exp: 0 });
    expect(addExp(p, LEVEL_EXP[1] + LEVEL_EXP[2] + 5)).toBe(2);
    expect(p).toMatchObject({ level: 4, exp: 5 });
    addExp(p, 1e9);
    expect(p).toMatchObject({ level: 30, exp: 0 });
    expect(addExp(p, 100)).toBe(0);
  });

  it('레벨이 오르면 지을 수 있는 개수가 늘어난다', () => {
    expect([1, 2, 3, 5].map((l) => maxCount('paddy', l))).toEqual([2, 2, 3, 4]);
    expect([1, 2, 4].map((l) => maxCount('lumber', l))).toEqual([0, 2, 3]);
    expect(maxCount('house', 30)).toBe(12);
  });
});

describe('업그레이드', () => {
  it('마을 회관은 마을 레벨이, 다른 건물은 마을 회관 레벨이 상한', () => {
    const s = rich(newVillage(T0));
    const hall = s.buildings[0];
    const p = build(s, 'paddy', 6, 6, T0, id());
    let t = T0 + 60 * SEC;
    expect(why(() => upgrade(s, p.id, t))).toBe('hall level');
    expect(why(() => upgrade(s, hall.id, t))).toBe('village level');
    s.profile.level = 2;
    const before = { ...s.profile.resources };
    upgrade(s, hall.id, t);
    expect(hall).toMatchObject({ state: 'upgrading', level: 1, finishAt: t + upgradeSec('hall', 1) * SEC });
    expect(upgradeSec('hall', 1)).toBe(60);
    expect(before.rice - s.profile.resources.rice).toBe(80);
    expect(why(() => upgrade(s, hall.id, t))).toBe('busy');
    t += 60 * SEC;
    const exp0 = s.profile.exp;
    const lv0 = s.profile.level;
    settle(s, t);
    expect(hall).toMatchObject({ state: 'done', level: 2 });
    expect(s.profile.level > lv0 || s.profile.exp === exp0 + 60).toBe(true);
    upgrade(s, p.id, t);
    expect(why(() => upgrade(s, 'nope', t))).toBe('no building');
  });

  it('쌓여 있던 것은 먼저 거두고, 올리는 동안에는 쌓이지 않는다', () => {
    const s = rich(newVillage(T0), 100);
    s.buildings[0].level = 2;
    const p = build(s, 'paddy', 6, 6, T0 - 10 * SEC, id());
    settle(s, T0);
    const rice = s.profile.resources.rice;
    upgrade(s, p.id, T0 + HOUR);
    expect(s.profile.resources.rice).toBe(rice + 60 - 10);
    expect(stored(p, T0 + HOUR + 20 * SEC)).toBe(0);
    settle(s, T0 + HOUR + 30 * SEC);
    expect(p).toMatchObject({ level: 2, state: 'done', collectedAt: T0 + HOUR + 30 * SEC });
    expect(stored(p, T0 + 2 * HOUR + 30 * SEC)).toBe(78);
  });

  it('최고 레벨 · 슬롯 · 자원', () => {
    const s = rich(newVillage(T0));
    s.profile.level = 30;
    s.buildings[0].level = 10;
    const a = build(s, 'paddy', 6, 6, T0, id());
    const b = build(s, 'paddy', 7, 6, T0, id());
    const t = T0 + HOUR;
    settle(s, t);
    expect(slots(s)).toBe(3);
    a.level = 10;
    expect(why(() => upgrade(s, a.id, t))).toBe('max level');
    expect(why(() => upgrade(s, s.buildings[0].id, t))).toBe('max level');
    s.profile.resources.wood = 0;
    expect(why(() => upgrade(s, b.id, t))).toBe('not enough');
    s.buildings[0].level = 4;
    expect(slots(s)).toBe(2);
  });
});

describe('마을 목표', () => {
  it('순서대로, 다 해야 받고, 수확 횟수는 그 목표가 시작된 뒤부터', () => {
    const s = newVillage(T0);
    expect(goalStatus(s)).toMatchObject({ have: 0, done: false });
    expect(why(() => claimGoal(s, T0))).toBe('not done');
    const p = build(s, 'paddy', 6, 6, T0, id());
    // 짓는 중인 건물은 세지 않는다
    expect(goalStatus(s)!.done).toBe(false);
    let t = T0 + 10 * SEC;
    settle(s, t);
    expect(goalStatus(s)!.done).toBe(true);
    const wood = s.profile.resources.wood;
    expect(claimGoal(s, t)).toBe(GOALS[0]);
    expect(s.profile).toMatchObject({ goal: 1, goalProgress: 0 });
    expect(s.profile.resources.wood).toBe(wood + 20);
    // 목표 1(집)을 하는 동안의 수확은 목표 2(수확)에 들어가지 않는다
    t += HOUR;
    harvest(s, [p.id], t);
    expect(s.profile.goalProgress).toBe(0);
    build(s, 'house', 7, 6, t, id());
    t += 30 * SEC;
    claimGoal(s, t);
    expect(goalStatus(s)).toMatchObject({ have: 0, done: false });
    t += HOUR;
    harvest(s, [p.id], t);
    expect(goalStatus(s)).toMatchObject({ have: 1, done: true });
  });

  it('목표를 다 하면 더 없다', () => {
    const s = newVillage(T0);
    s.profile.goal = GOALS.length;
    expect(goalStatus(s)).toBeNull();
    expect(why(() => claimGoal(s, T0))).toBe('no goal');
  });

  it('목록을 처음부터 끝까지 실제로 따라갈 수 있다', () => {
    const s = rich(newVillage(T0), 1e7);
    let t = T0;
    const spot = (type: string) => {
      for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) if (!placeError(s, type as 'paddy', x, y)) return { x, y };
      throw new Error('no room');
    };
    for (let guard = 0; guard < 500 && goalStatus(s); guard++) {
      t += 12 * HOUR;
      settle(s, t);
      const g = goalStatus(s)!;
      if (g.done) {
        claimGoal(s, t);
        continue;
      }
      const d = g.def;
      if (d.kind === 'build') {
        const at = spot(d.type);
        build(s, d.type, at.x, at.y, t, id());
      } else if (d.kind === 'upgrade') {
        const b = s.buildings.filter((v) => v.type === d.type).sort((a, c) => c.level - a.level)[0];
        upgrade(s, b.id, t);
      } else if (d.kind === 'harvest') {
        // 창고가 넘치게 넣어 둔 자원을 비워야 수확이 들어간다
        rich(s, 0);
        harvest(s, s.buildings.map((b) => b.id), t);
        rich(s, 1e7);
      } else addExp(s.profile, LEVEL_EXP[s.profile.level - 1]);
    }
    expect(goalStatus(s)).toBeNull();
    expect(s.profile.goal).toBe(GOALS.length);
  });
});

describe('서버 답 다듬기', () => {
  it('이상한 값을 걸러 낸다', () => {
    const s = cleanState({
      profile: { name: 7, level: 99, exp: -3, resources: { rice: '12', wood: null, coin: 5.9 }, landStage: 9, goal: 'x' },
      buildings: [{ id: 'a', type: 'paddy', level: 0, x: -1, y: 99, state: 'weird', finishAt: 5 }, { id: 'b', type: 'castle' }, { type: 'paddy' }, null],
    });
    expect(s.profile).toMatchObject({ name: '', level: 30, exp: 0, landStage: 6, goal: 0 });
    expect(s.profile.resources).toEqual({ rice: 12, wood: 0, stone: 0, cake: 0, coin: 5 });
    expect(s.buildings).toEqual([{ id: 'a', type: 'paddy', level: 1, x: 0, y: 19, state: 'done', finishAt: null, startAt: null, collectedAt: 0, resident: null }]);
    expect(cleanState(null).buildings).toEqual([]);
  });

  it('사본은 원본과 따로다', () => {
    const s = newVillage(T0);
    const c = cloneState(s);
    c.profile.resources.rice = 1;
    c.buildings[0].x = 0;
    expect(s.profile.resources.rice).toBe(50);
    expect(s.buildings[0].x).toBe(HALL_AT.x);
  });
});

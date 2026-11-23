import { describe, expect, it } from 'vitest';
import { GAMES, MONUMENTS, noStats } from '../src/data/monuments';
import { accStart, grantMonuments, isFull } from '../src/game/rules';
import { CONST, COST_MUL, HALL_AT, HALL_CAP, HALL_NEED, LAND_NEED, LAND_PRICE, LAND_SIZES, LEVEL_EXP, MARKET_LIMIT, RATE_MUL, RES_IDS, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC, kstDay, lookOf } from '../src/data/balance';
import { BUILDING, BUILDINGS, RECIPES, isBuildingType, upgradable, type BuildingType } from '../src/data/buildings';
import { ASKS, CAT_BONUS, RESIDENTS, RESIDENT_IDS, TASKS, affLevel, mix, type ResidentId } from '../src/data/residents';
import { GOALS, goalText, josa } from '../src/data/goals';
import {
  RuleError, addExp, assign, batchMax, build, buildSec, canHaveMore, capSec, countCap, claimGoal, dailyBonus, dailyClaim, makeAsk, makeDaily, marketLimit, pavilionRange, praiseGive, praiseLeft, praiseTake, prosperityOf,
  refresh, rename, requestDone, requestSkip, residentOf,
  residentPct, workersAt, workplace, cleanState, cloneState, countOf, craft, effRate, expand, feast, feasting, goalStatus, nearPavilion, ratePct, harvest, landRect, maxCount, move, newVillage, place, placeError, priceOf,
  ratePerHour, sell, sellCoins, sellLeft, settle, slots, storageCap, store, stored, unitSec, upgrade, upgradeCost, upgradeSec, type Building, type VillageState,
} from '../src/game/rules';

const T0 = 1_700_000_000_000;
const SEC = 1000;
const HOUR = 3600 * SEC;
let seq = 0;
const id = () => `b${++seq}`;
const rich = (s: VillageState, n = 100000) => ((s.profile.resources.rice = n), (s.profile.resources.wood = n), s);
/** 모든 자원을 n 으로 */
const fill = (s: VillageState, n: number) => {
  for (const k of RES_IDS) s.profile.resources[k] = n;
  return s;
};
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

  it('업그레이드 값은 그때 가질 수 있는 창고 용량 안에 든다 (마을 회관은 창고를 하나도 안 지어도 올릴 수 있다)', () => {
    for (let lv = 1; lv < CONST.building_max_level; lv++) {
      const c = upgradeCost('hall', lv);
      expect(Math.max(c.rice, c.wood, c.stone), `hall ${lv}`).toBeLessThanOrEqual(HALL_CAP[lv - 1]);
      // 다른 건물을 레벨 lv+1 로 올릴 때: 마을 회관은 lv+1 이상, 창고는 그 마을 레벨에서 지을 수 있는 만큼 (레벨 lv)
      const room = HALL_CAP[lv] + maxCount('storage', HALL_NEED[lv - 1]) * STORAGE_CAP[lv - 1];
      for (const d of BUILDINGS.filter((v) => v.id !== 'hall' && upgradable(v.id))) {
        const u = upgradeCost(d.id, lv);
        expect(Math.max(u.rice, u.wood, u.stone), `${d.id} ${lv}`).toBeLessThanOrEqual(room);
        expect(u.stone > 0).toBe(lv >= CONST.stone_from && d.upStone > 0);
        expect(u.coin > 0).toBe(lv >= CONST.coin_from);
      }
    }
    for (const d of BUILDINGS) expect(Math.max(d.rice, d.wood, d.stone)).toBeLessThanOrEqual(HALL_CAP[0]);
    expect(upgradeCost('paddy', 3)).toEqual({ rice: 35, wood: 70, stone: 0, coin: 0 });
    // 엽전은 레벨 4 부터: (쌀 + 나무) × 배수 × 45 ÷ 1000 (버림)
    expect(upgradeCost('paddy', 4)).toEqual({ rice: 55, wood: 110, stone: 55, coin: 74 });
    expect(upgradeCost('hall', 9)).toEqual({ rice: 2800, wood: 2800, stone: 2100, coin: 2520 });
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
    const { s, b } = withPaddy();
    expect(stored(s, b, T0)).toBe(0);
    expect(stored(s, b, T0 + 59 * SEC)).toBe(0);
    expect(stored(s, b, T0 + 60 * SEC)).toBe(1);
    expect(stored(s, b, T0 + HOUR)).toBe(60);
    expect(stored(s, b, T0 + 12 * HOUR)).toBe(720);
    expect(stored(s, b, T0 + 30 * 24 * HOUR)).toBe(720);
    expect(stored(s, { ...b, state: 'upgrading' }, T0 + HOUR)).toBe(0);
    expect(ratePerHour('paddy', 2)).toBe(78);
    expect(ratePerHour('lumber', 10)).toBe(220);
  });

  it('수확: 자원 · 경험치, 바로 또 하면 없다, 되다 만 시간은 남는다', () => {
    const { s, b } = withPaddy();
    const r = harvest(s, [b.id], T0 + 30 * 60 * SEC + 45 * SEC);
    expect(r).toEqual({ per: { [b.id]: 30 }, gained: { rice: 30 }, exp: 1, lost: 0, rooster: 0 });
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
    expect(r).toEqual({ per: { [b.id]: 200 }, gained: { rice: 200 }, exp: 36, lost: 520, rooster: 0 });
    expect(s.profile.resources.rice).toBe(300);
    // 건물은 비워졌다
    expect(stored(s, b, t)).toBe(0);
    expect(harvest(s, [b.id], t)).toEqual({ per: {}, gained: {}, exp: 0, lost: 0, rooster: 0 });
    // 창고가 가득 찬 채로 거둬도 건물은 비워지고 경험치와 목표 횟수는 오른다
    t += 2 * HOUR;
    s.profile.goal = GOALS.findIndex((g) => g.kind === 'harvest');
    const exp = s.profile.exp;
    expect(harvest(s, [b.id], t)).toEqual({ per: { [b.id]: 0 }, gained: {}, exp: 6, lost: 120, rooster: 0 });
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
    expect(hall).toMatchObject({ state: 'upgrading', level: 1, finishAt: t + upgradeSec(s, 'hall', 1) * SEC });
    expect(upgradeSec(s, 'hall', 1)).toBe(60);
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
    expect(stored(s, p, T0 + HOUR + 20 * SEC)).toBe(0);
    settle(s, T0 + HOUR + 30 * SEC);
    expect(p).toMatchObject({ level: 2, state: 'done', collectedAt: T0 + HOUR + 30 * SEC });
    expect(stored(s, p, T0 + 2 * HOUR + 30 * SEC)).toBe(78);
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
    expect(s.profile.resources.wood).toBe(wood + GOALS[0].wood);
    // 목표 1(집)을 하는 동안의 수확은 목표 2(수확)에 들어가지 않는다
    t += HOUR;
    harvest(s, [p.id], t);
    expect(s.profile.goalProgress).toBe(0);
    build(s, 'house', 7, 6, t, id());
    t += 30 * SEC;
    claimGoal(s, t);
    // 집을 지으면 찍찍이가 이사 온다 → 주민 목표
    expect(goalStatus(s)).toMatchObject({ def: { kind: 'resident' }, have: 1, done: true });
    claimGoal(s, t);
    expect(goalStatus(s)).toMatchObject({ def: { kind: 'harvest' }, have: 0, done: false });
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

  it('목록을 처음부터 끝까지 실제로 따라갈 수 있다 (마을 레벨 30 까지)', () => {
    const s = fill(newVillage(T0), 1e7);
    // 자리가 모자라 막히지 않게 땅은 넓게 (목표가 시키는 건물만 지으면 8×8 에도 들어간다 — 아래에서 따로 본다)
    s.profile.landStage = 6;
    let t = T0;
    const spot = (type: BuildingType) => {
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (!placeError(s, type, x, y)) return { x, y };
      throw new Error('no room');
    };
    let guard = 0;
    for (; guard < 3000 && goalStatus(s); guard++) {
      t += 12 * HOUR;
      settle(s, t);
      const g = goalStatus(s)!;
      if (g.done) {
        claimGoal(s, t);
        continue;
      }
      const d = g.def;
      fill(s, 1e7);
      if (d.kind === 'build') {
        const at = spot(d.type as BuildingType);
        build(s, d.type, at.x, at.y, t, id());
      } else if (d.kind === 'upgrade') {
        const b = s.buildings.filter((v) => v.type === d.type).sort((a, c) => c.level - a.level)[0];
        // 가공 중이면 먼저 거둬야 올릴 수 있다
        if (b.state === 'working') harvest(s, [b.id], t);
        else if (b.state === 'done') upgrade(s, b.id, t);
      } else if (d.kind === 'harvest') {
        // 창고가 넘치게 넣어 둔 자원을 비워야 수확이 들어간다 (넘쳐도 횟수는 오르지만, 들어가는 것도 함께 본다)
        fill(s, 0);
        harvest(s, s.buildings.filter((b) => BUILDING[b.type].product).map((b) => b.id), t);
      } else if (d.kind === 'sell') {
        let n = Math.floor((sellLeft(s, t) * 100) / priceOf(s, 'rice', t));
        while (n > 0 && sellCoins(s, 'rice', n, t) > sellLeft(s, t)) n--;
        if (sellLeft(s, t) > 0 && sellCoins(s, 'rice', n, t) >= 1) sell(s, 'rice', n, t);
      } else if (d.kind === 'craft') {
        const b = s.buildings.filter((v) => v.type === d.type)[0];
        if (b.state === 'working') harvest(s, [b.id], t);
        else if (b.state === 'done') craft(s, b.id, batchMax(b.type, b.level), t);
      } else if (d.kind === 'deco') {
        const type = BUILDINGS.find((v) => v.kind === 'deco' && countOf(s, v.id) < maxCount(v.id, s.profile.level))!.id;
        const at = spot(type);
        build(s, type, at.x, at.y, t, id());
      } else if (d.kind === 'resident') {
        // 집을 더 지으면 이사 온다 (그 레벨에 열리는 집까지)
        const at = spot('house');
        build(s, 'house', at.x, at.y, t, id());
      } else if (d.kind === 'request') {
        const q = s.requests.find((v) => v.state === 'open');
        if (q) requestDone(s, q.slot, t, id());
      } else if (d.kind === 'assign') {
        const r = s.residents.find((v) => RESIDENTS.find((x) => x.id === v.id)!.work !== '' && s.buildings.some((b) => b.type === RESIDENTS.find((x) => x.id === v.id)!.work && b.state === 'done'))!;
        assign(s, r.id, s.buildings.find((b) => b.type === RESIDENTS.find((x) => x.id === r.id)!.work && b.state === 'done')!.id, t);
      } else addExp(s.profile, LEVEL_EXP[s.profile.level - 1]);
    }
    expect(goalStatus(s)).toBeNull();
    expect(s.residents).toHaveLength(12);
    expect(s.profile.goal).toBe(GOALS.length);
    expect(s.profile.level).toBe(30);
    // 목표가 시키는 건물(장식물 빼고)은 처음 땅 8×8 에 다 들어간다
    const cells = s.buildings.filter((b) => BUILDING[b.type].kind === 'main').reduce((n, b) => n + BUILDING[b.type].w * BUILDING[b.type].h, 0);
    expect(cells).toBeLessThanOrEqual(64);
  });
});

describe('서버 답 다듬기', () => {
  it('이상한 값을 걸러 낸다', () => {
    const s = cleanState({
      profile: { name: 7, level: 99, exp: -3, resources: { rice: '12', wood: null, coin: 5.9 }, landStage: 9, goal: 'x', marketSold: -4 },
      buildings: [
        { id: 'a', type: 'paddy', level: 0, x: -1, y: 99, state: 'weird', finishAt: 5 },
        { id: 'm', type: 'mill', level: 2, x: null, y: null, state: 'working', finishAt: 9, startAt: 4, jobN: 7 },
        { id: 'k', type: 'tree', state: 'stored', x: null, y: null, jobN: 3 },
        { id: 'b', type: 'castle' }, { type: 'paddy' }, null,
      ],
    });
    expect(s.profile).toMatchObject({ name: '', level: 30, exp: 0, landStage: 6, goal: 0, marketDay: 0, marketSold: 0 });
    expect(s.profile.resources).toEqual({ rice: 12, wood: 0, stone: 0, cake: 0, coin: 5, special: 0 });
    expect(s.buildings).toEqual([
      { id: 'a', type: 'paddy', level: 1, x: 0, y: 19, state: 'done', finishAt: null, startAt: null, collectedAt: 0, jobN: 0, banked: 0, accFrom: 0 },
      { id: 'm', type: 'mill', level: 2, x: 0, y: 0, state: 'working', finishAt: 9, startAt: 4, collectedAt: 0, jobN: 7, banked: 0, accFrom: 0 },
      { id: 'k', type: 'tree', level: 1, x: 0, y: 0, state: 'stored', finishAt: null, startAt: null, collectedAt: 0, jobN: 0, banked: 0, accFrom: 0 },
    ]);
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

describe('4단계: 돌 · 엽전, 장식물 · 길, 보관함', () => {
  it('장식물 · 길은 엽전으로 바로 놓인다 (건설 슬롯을 쓰지 않는다). 업그레이드는 없다', () => {
    const s = fill(newVillage(T0), 1000);
    build(s, 'paddy', 6, 6, T0, id());
    build(s, 'house', 7, 6, T0, id());
    const tree = build(s, 'tree', 8, 6, T0, id());
    expect(tree.state).toBe('done');
    expect(s.profile.resources.coin).toBe(980);
    const road = build(s, 'road', 9, 6, T0, id());
    expect(road.state).toBe('done');
    expect(why(() => build(s, 'road', 9, 6, T0, id()))).toBe('occupied');
    expect(why(() => upgrade(s, tree.id, T0))).toBe('no upgrade');
    expect(why(() => build(s, 'lantern', 6, 7, T0, id()))).toBe('locked');
    expect(why(() => build(s, 'gift_rat', 6, 7, T0, id()))).toBe('locked');
    s.profile.resources.coin = 3;
    expect(why(() => build(s, 'road', 6, 7, T0, id()))).toBe('not enough');
    // 개수: 나무 12그루까지
    expect(maxCount('tree', 1)).toBe(12);
    expect(maxCount('lantern', 4)).toBe(0);
    expect(maxCount('lantern', 5)).toBe(8);
    expect(maxCount('road', 1)).toBe(80);
  });

  it('건물 값의 돌 · 엽전', () => {
    const s = fill(newVillage(T0), 500);
    s.profile.level = 8;
    build(s, 'mill', 6, 6, T0, id());
    expect(s.profile.resources).toMatchObject({ rice: 460, wood: 420, stone: 480, coin: 500 });
    build(s, 'jar', 7, 6, T0, id());
    expect(s.profile.resources).toMatchObject({ rice: 460, wood: 320, stone: 420, coin: 450 });
    s.profile.resources.stone = 0;
    settle(s, T0 + HOUR);
    expect(why(() => build(s, 'mill', 8, 6, T0 + HOUR, id()))).toBe('not enough');
    // 업그레이드: 레벨 4 부터 돌
    s.buildings[0].level = 6;
    const p = build(s, 'paddy', 8, 6, T0 + HOUR, id());
    settle(s, T0 + 2 * HOUR);
    p.level = 4;
    expect(why(() => upgrade(s, p.id, T0 + 2 * HOUR))).toBe('not enough');
    s.profile.resources.stone = 55;
    upgrade(s, p.id, T0 + 2 * HOUR);
    expect(s.profile.resources.stone).toBe(0);
  });

  it('보관함: 넣으면 자리가 비고 생산이 멈춘다. 다시 놓으면 그때부터 쌓인다', () => {
    const s = fill(newVillage(T0), 100);
    const p = build(s, 'paddy', 6, 6, T0 - 10 * SEC, id());
    settle(s, T0);
    expect(why(() => store(s, s.buildings[0].id, T0))).toBe('cannot store');
    const q = build(s, 'paddy', 7, 6, T0, id());
    expect(why(() => store(s, q.id, T0))).toBe('busy');
    // 쌓여 있던 60 은 먼저 거둔다 (경험치 없음)
    const exp = s.profile.exp;
    store(s, p.id, T0 + HOUR);
    expect(p.state).toBe('stored');
    expect(s.profile.resources.rice).toBe(100 - 5 - 5 + 60);
    expect(s.profile.exp).toBe(exp + 10); // 둘째 논의 완공 경험치뿐
    expect(why(() => store(s, p.id, T0 + HOUR))).toBe('stored');
    expect(why(() => move(s, p.id, 8, 8, T0 + HOUR))).toBe('stored');
    expect(stored(s, p, T0 + 5 * HOUR)).toBe(0);
    expect(harvest(s, [p.id], T0 + 5 * HOUR).per[p.id]).toBeUndefined();
    // 자리가 비었다. 개수에는 여전히 들어간다
    expect(placeError(s, 'house', 6, 6)).toBeNull();
    expect(why(() => build(s, 'paddy', 6, 6, T0 + 5 * HOUR, id()))).toBe('limit');
    expect(why(() => place(s, q.id, 8, 8, T0 + 5 * HOUR))).toBe('not stored');
    expect(why(() => place(s, p.id, 7, 6, T0 + 5 * HOUR))).toBe('occupied');
    place(s, p.id, 8, 8, T0 + 5 * HOUR);
    expect(p).toMatchObject({ state: 'done', x: 8, y: 8, collectedAt: T0 + 5 * HOUR });
    expect(stored(s, p, T0 + 6 * HOUR)).toBe(60);
  });

  it('보관함에 든 창고는 용량에 들어가지 않는다', () => {
    const s = fill(newVillage(T0), 100);
    s.profile.level = 2;
    const st = build(s, 'storage', 6, 6, T0, id());
    settle(s, T0 + 60 * SEC);
    expect(storageCap(s)).toBe(450);
    store(s, st.id, T0 + 60 * SEC);
    expect(storageCap(s)).toBe(300);
  });
});

describe('4단계: 방앗간 · 장독대 (가공)', () => {
  const withMill = () => {
    const s = fill(newVillage(T0), 200);
    s.profile.level = 8;
    const m = build(s, 'mill', 6, 6, T0 - HOUR, id());
    settle(s, T0);
    fill(s, 200);
    return { s, m };
  };

  it('재료를 내고 기다리면 떡이 나온다', () => {
    const { s, m } = withMill();
    expect(batchMax('mill', 1)).toBe(10);
    expect(unitSec(s, m)).toBe(120);
    expect(unitSec(s, { ...m, level: 2 })).toBe(92);
    expect(why(() => craft(s, m.id, 0, T0))).toBe('bad count');
    expect(why(() => craft(s, m.id, 11, T0))).toBe('bad count');
    expect(why(() => craft(s, m.id, 1.5, T0))).toBe('bad count');
    expect(why(() => craft(s, s.buildings[0].id, 1, T0))).toBe('no recipe');
    craft(s, m.id, 10, T0);
    expect(s.profile.resources.rice).toBe(170);
    expect(m).toMatchObject({ state: 'working', jobN: 10, finishAt: T0 + 1200 * SEC });
    expect(why(() => craft(s, m.id, 1, T0))).toBe('busy');
    expect(why(() => upgrade(s, m.id, T0))).toBe('busy');
    expect(why(() => store(s, m.id, T0))).toBe('busy');
    // 다 끝나기 전에는 거둘 것이 없다
    expect(stored(s, m, T0 + 1199 * SEC)).toBe(0);
    expect(harvest(s, [m.id], T0 + 1199 * SEC).per).toEqual({});
    expect(stored(s, m, T0 + 1200 * SEC)).toBe(10);
    // 가공 중인 건물은 건설 슬롯을 쓰지 않는다
    build(s, 'paddy', 7, 6, T0, id());
    build(s, 'paddy', 8, 6, T0, id());
    const exp = s.profile.exp;
    s.profile.goal = GOALS.findIndex((g) => g.kind === 'craft' && g.type === 'mill');
    const r = harvest(s, [m.id], T0 + 1300 * SEC);
    expect(r).toEqual({ per: { [m.id]: 10 }, gained: { cake: 10 }, exp: 10, lost: 0, rooster: 0 });
    expect(s.profile.resources.cake).toBe(210);
    expect(m).toMatchObject({ state: 'done', jobN: 0, finishAt: null });
    expect(s.profile.goalProgress).toBe(10);
    expect(s.profile.exp).toBe(exp + 10 + 20); // 가공 10 + 논 두 채 완공
  });

  it('재료가 모자라면 못 만든다. 창고가 가득 차면 넘친 떡은 버린다', () => {
    const { s, m } = withMill();
    s.profile.resources.rice = 29;
    expect(why(() => craft(s, m.id, 10, T0))).toBe('not enough');
    craft(s, m.id, 9, T0);
    s.profile.resources.cake = 295;
    expect(harvest(s, [m.id], T0 + HOUR)).toEqual({ per: { [m.id]: 5 }, gained: { cake: 5 }, exp: 9, lost: 4, rooster: 0 });
  });

  it('장독대: 떡과 쌀로 특산품을 만든다 (특산품은 창고 용량과 상관없다)', () => {
    const s = fill(newVillage(T0), 300);
    s.profile.level = 8;
    const j = build(s, 'jar', 6, 6, T0 - HOUR, id());
    settle(s, T0);
    fill(s, 300);
    expect(RECIPES.find((r) => r.type === 'jar')).toMatchObject({ in1: 'cake', n1: 3, in2: 'rice', n2: 10, out: 'special' });
    expect(batchMax('jar', 1)).toBe(2);
    craft(s, j.id, 2, T0);
    expect(s.profile.resources).toMatchObject({ cake: 294, rice: 280 });
    const r = harvest(s, [j.id], T0 + 2 * HOUR);
    expect(r).toEqual({ per: { [j.id]: 2 }, gained: { special: 2 }, exp: 30, lost: 0, rooster: 0 });
    expect(s.profile.resources.special).toBe(302);
  });
});

describe('4단계: 장터', () => {
  const withMarket = () => {
    const s = fill(newVillage(T0), 300);
    s.profile.level = 3;
    const m = build(s, 'market', 6, 6, T0 - HOUR, id());
    settle(s, T0);
    fill(s, 300);
    return { s, m };
  };

  it('시세는 날마다 다르고 (80 ~ 130 %), 받는 엽전 = floor(개수 × 기준 값 × 시세 ÷ 10000)', () => {
    const { s } = withMarket();
    const seen = new Set<number>();
    for (let d = 0; d < 60; d++) {
      const t = T0 + d * 24 * HOUR;
      const per100 = priceOf(s, 'rice', t);
      expect(per100).toBeGreaterThanOrEqual(32);
      expect(per100).toBeLessThanOrEqual(52);
      expect(sellCoins(s, 'rice', 100, t)).toBe(per100);
      seen.add(per100);
    }
    expect(seen.size).toBeGreaterThan(8);
    // 같은 날에는 같다 (한국 시간 자정에 바뀐다)
    const midnight = Date.UTC(2026, 10, 19, 15, 0, 0);
    expect(kstDay(midnight)).toBe(kstDay(midnight + 23 * HOUR));
    expect(priceOf(s, 'wood', midnight)).toBe(priceOf(s, 'wood', midnight + 23 * HOUR));
    expect(kstDay(midnight - 1)).toBe(kstDay(midnight) - 1);
  });

  it('팔기: 자원이 줄고 엽전이 는다. 하루 한도, 날이 바뀌면 다시', () => {
    const { s } = withMarket();
    expect(why(() => sell(s, 'coin', 10, T0))).toBe('bad resource');
    expect(why(() => sell(s, 'rice', 0, T0))).toBe('bad count');
    expect(why(() => sell(s, 'rice', 301, T0))).toBe('not enough');
    expect(why(() => sell(s, 'rice', 1, T0))).toBe('too few');
    const got = sell(s, 'rice', 100, T0);
    expect(got).toBe(priceOf(s, 'rice', T0));
    expect(s.profile.resources).toMatchObject({ rice: 200, coin: 300 + got });
    expect(s.profile).toMatchObject({ marketDay: kstDay(T0), marketSold: got });
    expect(sellLeft(s, T0)).toBe(MARKET_LIMIT[0] - got);
    // 한도: 떡 300개는 한도(300닢)를 넘는다
    s.profile.resources.cake = 1000;
    expect(sellCoins(s, 'cake', 300, T0)).toBeGreaterThan(sellLeft(s, T0));
    expect(why(() => sell(s, 'cake', 300, T0))).toBe('sell limit');
    // 다음 날에는 한도가 돌아온다
    const next = T0 + 24 * HOUR;
    expect(sellLeft(s, next)).toBe(MARKET_LIMIT[0]);
    const n = Math.floor((MARKET_LIMIT[0] * 100) / priceOf(s, 'cake', next)) - 1;
    sell(s, 'cake', n, next);
    expect(s.profile.marketSold).toBe(sellCoins(s, 'cake', n, next));
  });

  it('장터가 없거나 짓는 중이면 팔 수 없다', () => {
    const s = fill(newVillage(T0), 300);
    expect(why(() => sell(s, 'rice', 100, T0))).toBe('no market');
    s.profile.level = 3;
    build(s, 'market', 6, 6, T0, id());
    expect(why(() => sell(s, 'rice', 100, T0))).toBe('no market');
    expect(sellLeft(s, T0)).toBe(0);
    sell(s, 'rice', 100, T0 + 120 * SEC);
  });

  it('목표: 판 엽전을 센다', () => {
    const { s } = withMarket();
    s.profile.goal = GOALS.findIndex((g) => g.kind === 'sell');
    const got = sell(s, 'wood', 100, T0);
    expect(s.profile.goalProgress).toBe(got);
    expect(goalStatus(s)).toMatchObject({ have: 20, done: true });
  });
});

describe('5단계: 시아코인 — 땅 넓히기', () => {
  it('값과 마을 레벨 조건, 6단계까지', () => {
    expect(LAND_PRICE).toEqual([10, 20, 30, 50, 70, 100]);
    expect(LAND_NEED).toHaveLength(6);
    const s = newVillage(T0);
    expect(why(() => expand(s, T0))).toBe('village level');
    s.profile.level = 3;
    expect(why(() => expand(s, T0))).toBe('not enough coin');
    s.sia = 15;
    expand(s, T0);
    expect(s).toMatchObject({ sia: 5 });
    expect(s.profile.landStage).toBe(1);
    // 건물 좌표는 그대로, 땅이 바깥으로 넓어졌다
    expect(s.buildings[0]).toMatchObject({ x: HALL_AT.x, y: HALL_AT.y });
    expect(placeError(s, 'paddy', 5, 5)).toBeNull();
    expect(placeError(s, 'paddy', 4, 5)).toBe('out of land');
    s.profile.level = 30;
    s.sia = 1000;
    for (let i = 0; i < 5; i++) expand(s, T0);
    expect(s.profile.landStage).toBe(6);
    expect(s.sia).toBe(1000 - 20 - 30 - 50 - 70 - 100);
    expect(why(() => expand(s, T0))).toBe('max land');
    expect(placeError(s, 'paddy', 0, 19)).toBeNull();
  });
});

describe('5단계: 특별 건물', () => {
  it('일반 자원과 시아코인을 함께 낸다. 하나씩만', () => {
    const s = fill(newVillage(T0), 300);
    expect(why(() => build(s, 'pavilion', 6, 6, T0, id()))).toBe('locked');
    s.profile.level = 14;
    expect(why(() => build(s, 'pavilion', 6, 6, T0, id()))).toBe('not enough coin');
    s.sia = 130;
    s.profile.resources.rice = 99;
    // 일반 자원이 모자라면 시아코인도 쓰지 않는다
    expect(why(() => build(s, 'pavilion', 6, 6, T0, id()))).toBe('not enough');
    expect(s.sia).toBe(130);
    s.profile.resources.rice = 300;
    const pv = build(s, 'pavilion', 6, 6, T0, id());
    expect(s.sia).toBe(110);
    expect(s.profile.resources).toMatchObject({ rice: 200, wood: 200 });
    expect(pv).toMatchObject({ state: 'building', finishAt: T0 + 600 * SEC });
    expect(why(() => build(s, 'pavilion', 12, 12, T0, id()))).toBe('limit');
    expect(BUILDINGS.filter((d) => d.kind === 'special').map((d) => [d.id, d.sia, d.unlock[0]])).toEqual([['pavilion', 20, 6], ['feast', 40, 10], ['shrine', 60, 14]]);
    // 업그레이드는 일반 자원으로
    s.buildings[0].level = 5;
    settle(s, T0 + HOUR);
    fill(s, 3000);
    upgrade(s, pv.id, T0 + HOUR);
    expect(s.sia).toBe(110);
  });

  it('시아코인 없이도 일반 건물은 모두 처음 땅에 들어간다', () => {
    const cells = BUILDINGS.filter((d) => d.kind === 'main').reduce((n, d) => n + d.w * d.h * d.unlock.length, 0);
    expect(cells).toBeLessThanOrEqual(64);
    expect(BUILDINGS.filter((d) => d.kind === 'main').every((d) => d.sia === 0)).toBe(true);
  });
});

describe('5단계: 정자 (둘레의 생산 건물 +10%)', () => {
  /** 논 둘: 정자(6,6 의 2×2) 옆(8,6)과 먼 곳(12,12) */
  const setup = () => {
    const s = fill(newVillage(T0), 300);
    s.profile.level = 6;
    s.sia = 20;
    const near = build(s, 'paddy', 8, 6, T0 - HOUR, id());
    const far = build(s, 'paddy', 12, 12, T0 - HOUR, id());
    settle(s, T0);
    near.collectedAt = far.collectedAt = T0;
    const pv = build(s, 'pavilion', 6, 6, T0, id());
    return { s, near, far, pv };
  };

  it('다 지은 뒤부터, 둘레 한 칸 안에만', () => {
    const { s, near, far, pv } = setup();
    expect(ratePct(s, near)).toBe(0); // 아직 짓는 중
    // 30분 뒤에 들어와 보니 정자가 다 지어져 있다: 그때까지 쌓인 30 은 보너스 없이 적어 둔다
    settle(s, T0 + 30 * 60 * SEC);
    expect(pv.state).toBe('done');
    expect(near.banked).toBe(30);
    expect(ratePct(s, near)).toBe(10);
    expect(ratePct(s, far)).toBe(0);
    expect(effRate(s, near)).toBe(66);
    expect(nearPavilion(s, 5, 5, 1, 1)).toBe(true);
    expect(nearPavilion(s, 4, 5, 1, 1)).toBe(false);
    expect(nearPavilion(s, 8, 8, 1, 1)).toBe(true);
    expect(nearPavilion(s, 9, 8, 1, 1)).toBe(false);
    // 한 시간 더: 30 + 66
    expect(stored(s, near, T0 + 90 * 60 * SEC)).toBe(96);
    expect(stored(s, far, T0 + 90 * 60 * SEC)).toBe(90);
    s.profile.resources.rice = 0;
    const r = harvest(s, [near.id, far.id], T0 + 90 * 60 * SEC);
    expect(r.per).toEqual({ [near.id]: 96, [far.id]: 90 });
    expect(near.banked).toBe(0);
  });

  it('수확 직전에 정자 옆으로 옮겨도 그때까지 쌓인 것에는 보너스가 붙지 않는다', () => {
    const { s, near, far } = setup();
    settle(s, T0 + 10 * 60 * SEC);
    const t = T0 + 10 * HOUR;
    move(s, far.id, 8, 7, t);
    expect(far.banked).toBe(600);
    expect(ratePct(s, far)).toBe(10);
    expect(stored(s, far, t)).toBe(600);
    expect(stored(s, far, t + HOUR)).toBe(666);
    // 정자 옆에 있던 논을 멀리 옮기면 보너스가 그때부터 없다
    move(s, near.id, 13, 13, t);
    expect(ratePct(s, near)).toBe(0);
    expect(stored(s, near, t + HOUR)).toBe(near.banked + 60);
  });

  it('정자를 옮기거나 보관하면 모든 생산 건물의 쌓인 양을 먼저 적어 둔다. 레벨이 오르면 보너스가 커진다', () => {
    const { s, near, pv } = setup();
    settle(s, T0 + 10 * 60 * SEC);
    harvest(s, [near.id], T0 + 10 * 60 * SEC);
    const t = T0 + 10 * 60 * SEC + HOUR;
    store(s, pv.id, t);
    expect(near.banked).toBe(66);
    expect(ratePct(s, near)).toBe(0);
    place(s, pv.id, 6, 7, t + HOUR);
    expect(near.banked).toBe(66 + 60);
    expect(ratePct(s, near)).toBe(10);
    pv.level = 3;
    expect(ratePct(s, near)).toBe(14);
  });

  it('옮기기를 되풀이해도 쌓기 시작한 때부터 12시간까지만 쌓인다 (059)', () => {
    const { s, far } = setup();
    // 정자가 다 지어질 때 적어 둔다 (10분 몫 10개). 쌓기 시작한 시각은 처음 그대로
    settle(s, T0 + 10 * 60 * SEC);
    expect([far.banked, accStart(far)]).toEqual([10, T0]);
    move(s, far.id, 13, 12, T0 + 12 * HOUR);
    expect([far.banked, accStart(far)]).toEqual([720, T0]);
    expect(isFull(s, far, T0 + 12 * HOUR)).toBe(true);
    // 옮기지 않았을 때처럼 더 쌓이지 않는다 (예전에는 옮길 때마다 12시간이 새로 쌓였다)
    expect(stored(s, far, T0 + 24 * HOUR)).toBe(720);
    move(s, far.id, 12, 12, T0 + 24 * HOUR);
    expect(stored(s, far, T0 + 36 * HOUR)).toBe(720);
    s.profile.resources.rice = 0;
    s.buildings[0].level = 10; // 창고 넉넉히
    expect(harvest(s, [far.id], T0 + 36 * HOUR).per).toEqual({ [far.id]: 720 });
    expect([far.banked, far.accFrom, far.collectedAt]).toEqual([0, 0, T0 + 36 * HOUR]);
    // 거둔 뒤에는 다시 12시간
    expect(stored(s, far, T0 + 48 * HOUR)).toBe(720);
    // 6시간 뒤 정자 옆으로: 360 (보너스 없이) + 6시간 × 66 = 756, 그 뒤로는 더 쌓이지 않는다
    move(s, far.id, 8, 7, T0 + 42 * HOUR);
    expect(far.banked).toBe(360);
    expect(stored(s, far, T0 + 48 * HOUR)).toBe(360 + 396);
    expect(stored(s, far, T0 + 60 * HOUR)).toBe(360 + 396);
  });

  it('쌓이는 양의 상한: 12시간 분량 × 140%', () => {
    const { s, near } = setup();
    settle(s, T0 + 10 * 60 * SEC);
    near.banked = 5000;
    expect(stored(s, near, T0 + HOUR)).toBe(Math.floor((43200 * 66 * 140) / 360000));
  });
});

describe('5단계: 잔치 마당 (하루 동안 마을 전체 +20%)', () => {
  const setup = () => {
    const s = fill(newVillage(T0), 300);
    s.profile.level = 10;
    s.sia = 40;
    const p = build(s, 'paddy', 12, 12, T0 - 2 * HOUR, id());
    const f = build(s, 'feast', 6, 6, T0 - 2 * HOUR, id());
    settle(s, T0);
    p.collectedAt = T0;
    fill(s, 100);
    return { s, p, f };
  };

  it('떡을 내고 연다. 잔치 중에는 또 못 연다', () => {
    const { s, p, f } = setup();
    s.profile.resources.cake = 59;
    expect(why(() => feast(s, T0))).toBe('not enough');
    s.profile.resources.cake = 100;
    const exp = s.profile.exp;
    // 한 시간 뒤에 연다: 그때까지의 60 은 보너스 없이 적어 둔다
    feast(s, T0 + HOUR);
    expect(s.profile.resources.cake).toBe(40);
    expect(s.profile).toMatchObject({ feastFrom: T0 + HOUR, feastUntil: T0 + 25 * HOUR, feastPct: 20, exp: exp + 30 });
    expect(p.banked).toBe(60);
    expect(feasting(s, T0 + 2 * HOUR)).toBe(true);
    expect(why(() => feast(s, T0 + 2 * HOUR))).toBe('feast active');
    // 잔치 중의 한 시간: 60 + 12
    expect(stored(s, p, T0 + 2 * HOUR)).toBe(60 + 72);
    harvest(s, [p.id], T0 + 2 * HOUR);
    // 잔치가 끝난 뒤까지 걸친 구간: 겹친 시간에만 보너스 (끝나기 2시간 전부터 4시간 → 240 + 2시간 몫 24)
    p.collectedAt = T0 + 23 * HOUR;
    expect(stored(s, p, T0 + 27 * HOUR)).toBe(240 + 24);
    expect(feasting(s, T0 + 25 * HOUR)).toBe(false);
    f.level = 4;
    s.profile.resources.cake = 60;
    feast(s, T0 + 27 * HOUR);
    expect(s.profile.feastPct).toBe(26);
    expect(p.banked).toBe(264);
  });

  it('잔치 마당이 없으면 열 수 없다', () => {
    const s = fill(newVillage(T0), 300);
    expect(why(() => feast(s, T0))).toBe('no feast');
  });
});

// ───────────────────────── 6단계: 주민 · 부탁 · 오늘의 할 일 ─────────────────────────

/** 그 종류의 건물을 다 지어진 채로 놓는다 (값 · 개수 제한 없이: 검사용) */
function put(s: VillageState, type: BuildingType, x: number, y: number, level = 1): Building {
  const b: Building = { id: id(), type, level, x, y, state: 'done', finishAt: null, startAt: null, collectedAt: T0, jobN: 0, banked: 0, accFrom: 0 };
  s.buildings.push(b);
  return b;
}
/** 주민 n명이 이사 와 있는 마을 (집 n채, 마을 레벨 30, 땅 넓게) */
function town(n: number): VillageState {
  const s = fill(newVillage(T0), 1000);
  s.profile.level = 30;
  s.profile.landStage = 6;
  for (let i = 0; i < n; i++) put(s, 'house', i, 0);
  settle(s, T0);
  return s;
}
const aff = (s: VillageState, rid: ResidentId, points: number) => (residentOf(s, rid)!.affinity = points);

describe('6단계: 주민 이사', () => {
  it('표: 십이지 12명 + 고양이, 이사 오는 마을 레벨은 PRD 7장 그대로, 집도 그 레벨에 한 채씩 열린다', () => {
    expect(RESIDENTS.map((r) => r.id)).toEqual([...RESIDENT_IDS]);
    const zodiac = RESIDENTS.filter((r) => !r.buy);
    expect(zodiac.map((r) => r.level)).toEqual([1, 2, 3, 5, 7, 9, 11, 13, 15, 18, 21, 24]);
    expect(zodiac.map((r) => r.level)).toEqual(BUILDING.house.unlock);
    expect(RESIDENTS.map((r) => r.work)).toEqual(['storage', 'paddy', 'lumber', 'mill', 'hall', 'jar', 'market', 'pavilion', 'quarry', '', '', 'market', '']);
    expect(RESIDENTS.map((r) => r.nick)).toEqual(['찍찍이', '우직이', '어흥이', '깡총이', '여의룡', '스르르', '따각이', '몽실이', '재롱이', '꼬꼬댁', '멍뭉이', '꿀꿀이', '야옹이']);
    // 고양이는 끝에 하나 (시아코인으로 산다: 레벨 해금에 섞이지 않는다)
    expect(RESIDENTS.filter((r) => r.buy).map((r) => [r.id, r.level])).toEqual([['cat', 0]]);
    for (const r of RESIDENTS) expect(isBuildingType(`gift_${r.id}`)).toBe(true);
    expect([0, 9, 10, 29, 30, 60, 99, 100, 5000].map(affLevel)).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
  });

  it('마을 레벨이 되고 빈 집이 있으면 순서대로 한 명씩', () => {
    const s = fill(newVillage(T0), 1000);
    settle(s, T0);
    expect(s.residents).toEqual([]);
    expect(s.requests).toEqual([]);
    // 집을 다 지으면 쥐가 온다 (짓는 중에는 아직)
    const h1 = build(s, 'house', 6, 6, T0, id());
    expect(s.residents).toEqual([]);
    settle(s, T0 + 30 * SEC);
    expect(s.residents).toEqual([{ id: 'rat', affinity: 0, building: null, gifted: false }]);
    // 집이 더 있어도 마을 레벨 2 가 되어야 소가 온다
    put(s, 'house', 7, 6);
    put(s, 'house', 8, 6);
    settle(s, T0 + HOUR);
    expect(s.residents.map((r) => r.id)).toEqual(['rat']);
    s.profile.level = 3;
    settle(s, T0 + HOUR);
    expect(s.residents.map((r) => r.id)).toEqual(['rat', 'ox', 'tiger']);
    // 레벨이 높아도 집이 모자라면 못 온다. 보관함에 든 집은 세지 않는다
    s.profile.level = 30;
    settle(s, T0 + HOUR);
    expect(s.residents).toHaveLength(3);
    put(s, 'house', 9, 6).state = 'stored';
    settle(s, T0 + HOUR);
    expect(s.residents).toHaveLength(3);
    put(s, 'house', 10, 6);
    settle(s, T0 + HOUR);
    expect(s.residents.map((r) => r.id)).toEqual(['rat', 'ox', 'tiger', 'rabbit']);
    // 이사 온 주민은 집을 보관해도 떠나지 않는다
    store(s, h1.id, T0 + HOUR);
    expect(s.residents).toHaveLength(4);
    expect(town(12).residents.map((r) => r.id)).toEqual(RESIDENT_IDS.filter((r) => r !== 'cat'));
  });

  it('고양이: 사야 이사 온다 (레벨이 아니라). 산 마을은 주민 집을 한 채 더 지을 수 있다', () => {
    const s = town(12);
    s.profile.level = 30;
    expect(maxCount('house', 30)).toBe(12);
    expect(countCap(s, 'house')).toBe(12);
    expect(canHaveMore(s, 'house')).toBe(false);
    put(s, 'house', 12, 0);
    settle(s, T0);
    expect(residentOf(s, 'cat')).toBeNull();
    s.catOwned = true;
    expect(countCap(s, 'house')).toBe(13);
    settle(s, T0);
    expect(s.residents.map((r) => r.id)).toEqual([...RESIDENT_IDS]);
    expect(residentPct(s, 'cat')).toBe(CAT_BONUS[0]);
    // 산 뒤 빈 집이 없으면 집이 생길 때. 레벨이 되는 다른 주민이 먼저 들어간다 (순서대로)
    const t = town(5);
    t.profile.level = 9;
    t.catOwned = true;
    settle(t, T0);
    expect(t.residents.map((r) => r.id)).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'dragon']);
    put(t, 'house', 5, 0);
    settle(t, T0);
    expect(t.residents.map((r) => r.id)).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake']);
    put(t, 'house', 6, 0);
    settle(t, T0);
    expect(t.residents.map((r) => r.id)).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'cat']);
    // 레벨이 오르면 다음 십이지가 이어서 (고양이는 끝에 그대로)
    t.profile.level = 11;
    put(t, 'house', 7, 0);
    settle(t, T0);
    expect(t.residents.map((r) => r.id)).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'cat']);
  });

  it('고양이: 새 부탁의 엽전 · 경험치 + (친밀도 단계마다)', () => {
    const base = makeAsk(7, 10, ['rat']);
    const plus = makeAsk(7, 10, ['rat'], 12);
    expect(plus.coin).toBe(Math.floor((base.coin * 112) / 100));
    expect(plus.exp).toBe(Math.floor((base.exp * 112) / 100));
    expect([plus.n, plus.res, plus.aff]).toEqual([base.n, base.res, base.aff]);
    const s = town(12);
    s.catOwned = true;
    put(s, 'house', 12, 0);
    settle(s, T0);
    aff(s, 'cat', 100);
    for (const q of s.requests) Object.assign(q, { state: 'wait', readyAt: T0 });
    settle(s, T0 + SEC);
    const q = s.requests[0];
    const want = makeAsk(s.profile.reqSeq - 2, s.profile.level, s.residents.map((r) => r.id), CAT_BONUS[4]);
    expect([q.coin, q.exp]).toEqual([want.coin, want.exp]);
  });

  it('목표: 주민 수', () => {
    const s = town(3);
    s.profile.goal = GOALS.findIndex((g) => g.kind === 'resident' && g.n === 5);
    expect(goalStatus(s)).toMatchObject({ have: 3, done: false });
  });
});

describe('6단계: 배치와 보너스', () => {
  it('제 일터인 서 있는 건물에만. 닭 · 개는 배치하지 않는다', () => {
    const s = town(12);
    const paddy = put(s, 'paddy', 5, 5);
    const site = put(s, 'paddy', 6, 5);
    site.state = 'building';
    site.finishAt = T0 + 99 * HOUR;
    expect(why(() => assign(s, 'cat', paddy.id, T0))).toBe('no resident');
    expect(why(() => assign(town(1), 'ox', paddy.id, T0))).toBe('no resident');
    expect(why(() => assign(s, 'rooster', paddy.id, T0))).toBe('no work');
    expect(why(() => assign(s, 'ox', 'nope', T0))).toBe('no building');
    expect(why(() => assign(s, 'ox', s.buildings[0].id, T0))).toBe('wrong building');
    expect(why(() => assign(s, 'ox', site.id, T0))).toBe('wrong building');
    s.profile.goal = GOALS.findIndex((g) => g.kind === 'assign');
    assign(s, 'ox', paddy.id, T0);
    expect(residentOf(s, 'ox')!.building).toBe(paddy.id);
    expect(workplace(s, 'ox')).toBe(paddy);
    expect(s.profile.goalProgress).toBe(1);
    expect(workersAt(s, paddy)).toEqual(['ox']);
    assign(s, 'ox', null, T0);
    expect(workplace(s, 'ox')).toBeNull();
    expect(s.profile.goalProgress).toBe(1);
    // 보관함에 넣으면 거기서 일하던 주민은 쉰다
    assign(s, 'ox', paddy.id, T0);
    store(s, paddy.id, T0);
    expect(residentOf(s, 'ox')!.building).toBeNull();
  });

  it('소 · 호랑이 · 원숭이: 그 건물의 생산량 (친밀도 단계마다 10 · 15 · 20 · 25 · 30 %). 배치 전에 쌓인 것에는 붙지 않는다', () => {
    const s = town(9);
    const a = put(s, 'paddy', 5, 5);
    const b = put(s, 'paddy', 15, 15);
    assign(s, 'ox', a.id, T0 + HOUR);
    expect(a.banked).toBe(60);
    expect(ratePct(s, a)).toBe(10);
    expect(ratePct(s, b)).toBe(0);
    expect(effRate(s, a)).toBe(66);
    expect(stored(s, a, T0 + 2 * HOUR)).toBe(60 + 66);
    // 다른 논으로 옮기면 두 논 모두 그때까지 쌓인 양을 적어 둔다
    assign(s, 'ox', b.id, T0 + 2 * HOUR);
    expect([a.banked, b.banked]).toEqual([126, 120]);
    expect([ratePct(s, a), ratePct(s, b)]).toEqual([0, 10]);
    aff(s, 'ox', 100);
    expect(ratePct(s, b)).toBe(30);
    const lumber = put(s, 'lumber', 5, 6);
    const quarry = put(s, 'quarry', 5, 7);
    assign(s, 'tiger', lumber.id, T0);
    assign(s, 'monkey', quarry.id, T0);
    expect([ratePct(s, lumber), ratePct(s, quarry)]).toEqual([10, 10]);
    // 정자 둘레와 겹치면 더한다
    put(s, 'pavilion', 6, 6);
    expect(ratePct(s, lumber)).toBe(20);
  });

  it('쥐: 그 창고의 용량 · 토끼 · 뱀: 가공 속도 · 용: 짓는 시간', () => {
    const s = town(6);
    const st = put(s, 'storage', 5, 5, 3);
    put(s, 'storage', 6, 5, 3);
    expect(storageCap(s)).toBe(300 + 400 + 400);
    assign(s, 'rat', st.id, T0);
    expect(storageCap(s)).toBe(300 + 440 + 400);
    aff(s, 'rat', 100);
    expect(storageCap(s)).toBe(300 + 520 + 400);
    const mill = put(s, 'mill', 5, 6);
    const jar = put(s, 'jar', 5, 7);
    expect([unitSec(s, mill), unitSec(s, jar)]).toEqual([120, 3600]);
    assign(s, 'rabbit', mill.id, T0);
    assign(s, 'snake', jar.id, T0);
    expect([unitSec(s, mill), unitSec(s, jar)]).toEqual([109, 3272]);
    craft(s, mill.id, 10, T0);
    expect(mill.finishAt).toBe(T0 + 1090 * SEC);
    // 용: 마을 회관에 있으면 짓기 · 업그레이드 시간 −5 % (단계마다 5 · 8 · 11 · 14 · 17)
    expect(buildSec(s, 'storage')).toBe(60);
    assign(s, 'dragon', s.buildings[0].id, T0);
    expect(buildSec(s, 'storage')).toBe(57);
    expect(upgradeSec(s, 'paddy', 4)).toBe(1710);
    aff(s, 'dragon', 100);
    expect(upgradeSec(s, 'hall', 9)).toBe(Math.floor((57600 * 83) / 100));
    const p = build(s, 'paddy', 9, 9 + 3, T0, id());
    expect(p.finishAt).toBe(T0 + 8 * SEC);
  });

  it('말: 장터 한도 · 돼지: 파는 값 (둘 다 장터에)', () => {
    const s = town(12);
    const m = put(s, 'market', 5, 5);
    const base = sellCoins(s, 'rice', 1000, T0);
    expect(marketLimit(s)).toBe(300);
    assign(s, 'horse', m.id, T0);
    assign(s, 'pig', m.id, T0);
    expect(workersAt(s, m)).toEqual(['horse', 'pig']);
    expect(marketLimit(s)).toBe(330);
    // 쌀 1000개 = 4 × 시세(%) 닢 → 돼지가 있으면 그 110 %
    expect(sellCoins(s, 'rice', 1000, T0)).toBe(Math.floor((base * 110) / 100));
    const got = sell(s, 'rice', 500, T0);
    expect(got).toBe(sellCoins(s, 'rice', 500, T0));
  });

  it('양: 정자의 둘레 +1칸 (배치하면 모든 생산 건물의 쌓인 양을 먼저 적어 둔다)', () => {
    const s = town(8);
    const pv = put(s, 'pavilion', 6, 6);
    const p = put(s, 'paddy', 9, 6);
    expect(pavilionRange(s)).toBe(1);
    expect(ratePct(s, p)).toBe(0);
    assign(s, 'sheep', pv.id, T0 + HOUR);
    expect(p.banked).toBe(60);
    expect(pavilionRange(s)).toBe(2);
    expect(ratePct(s, p)).toBe(10);
  });

  it('개: 12 → 15시간 · 닭: 날마다 첫 수확', () => {
    const s = town(9);
    const p = put(s, 'paddy', 5, 5);
    expect(capSec(s)).toBe(43200);
    expect(stored(s, p, T0 + 20 * HOUR)).toBe(720);
    const t = town(12);
    const q = put(t, 'paddy', 5, 5);
    expect(capSec(t)).toBe(54000);
    expect(stored(t, q, T0 + 20 * HOUR)).toBe(900);
    // 닭: 그날의 첫 수확에 +10 % (경험치도 늘어난 양으로)
    t.profile.resources.rice = 0;
    const r = harvest(t, [q.id], T0 + HOUR);
    expect(r).toMatchObject({ per: { [q.id]: 66 }, rooster: 10, exp: Math.floor(66 / CONST.harvest_exp_div) });
    expect(t.profile.roosterDay).toBe(kstDay(T0 + HOUR));
    expect(harvest(t, [q.id], T0 + 2 * HOUR)).toMatchObject({ per: { [q.id]: 60 }, rooster: 0 });
    // 거둔 것이 없으면 보너스를 쓰지 않는다. 날이 바뀌면 다시
    const next = T0 + 30 * HOUR;
    expect(harvest(t, [t.buildings[0].id], next).rooster).toBe(0);
    expect(harvest(t, [q.id], next).rooster).toBe(10);
    aff(t, 'rooster', 100);
    expect(residentPct(t, 'rooster')).toBe(30);
    expect(residentPct(s, 'rooster')).toBe(0);
  });
});

describe('6단계: 주민 부탁', () => {
  it('주민이 있으면 칸 셋. 부탁은 번호 · 마을 레벨 · 이사 온 주민으로 정해진다', () => {
    const s = town(3);
    expect(s.requests.map((q) => [q.slot, q.state])).toEqual([[0, 'open'], [1, 'open'], [2, 'open']]);
    expect(s.profile.reqSeq).toBe(3);
    for (const q of s.requests) {
      expect(['rat', 'ox', 'tiger']).toContain(q.resident);
      expect(q.n).toBeGreaterThan(0);
      expect(q.coin).toBeGreaterThan(0);
      expect(q.exp).toBeGreaterThan(0);
      expect(q.aff).toBeGreaterThanOrEqual(2);
      expect(q.aff).toBeLessThanOrEqual(4);
    }
    expect(s.requests[0]).toMatchObject(makeAsk(1, 30, ['rat', 'ox', 'tiger']));
    // 마을 레벨 1: 쌀만 부탁한다
    for (let seq = 1; seq < 200; seq++) expect(makeAsk(seq, 1, ['rat']).res).toBe('rice');
    const kinds = new Set<string>();
    for (let seq = 1; seq < 200; seq++) kinds.add(makeAsk(seq, 30, ['rat', 'ox']).res);
    expect([...kinds].sort()).toEqual(['cake', 'rice', 'special', 'stone', 'wood']);
    // 식: 쌀 30 × (2 … 5) × (20 + 레벨 × 2) ÷ 20
    const a = makeAsk(7, 10, ['rat']);
    const base = ASKS.find((v) => v.res === a.res)!;
    expect(a.n % 1).toBe(0);
    expect(a.n).toBeGreaterThanOrEqual(Math.floor((base.base * 2 * (20 + 10 * base.grow)) / 20));
    expect(a.n).toBeLessThanOrEqual(Math.floor((base.base * 5 * (20 + 10 * base.grow)) / 20));
    expect(mix(1, 1)).toBe((7919 + 104729 + 12345) % 1000003);
  });

  it('들어주면 자원을 내고 엽전 · 경험치 · 친밀도. 그 칸은 20분 뒤에 새 부탁', () => {
    const s = town(1);
    s.profile.level = 5;
    const q = { ...s.requests[0] };
    expect(q.res).not.toBe('');
    const res = q.res as 'rice';
    s.profile.resources[res] = q.n - 1;
    expect(why(() => requestDone(s, 0, T0, id()))).toBe('not enough');
    expect(why(() => requestDone(s, 5, T0, id()))).toBe('no request');
    s.profile.resources[res] = q.n + 3;
    const coin = s.profile.resources.coin;
    const exp = s.profile.exp;
    s.profile.goal = GOALS.findIndex((g) => g.kind === 'request');
    expect(requestDone(s, 0, T0, id())).toBeNull();
    expect(s.profile.resources[res]).toBe(3);
    expect(s.profile.resources.coin).toBe(coin + q.coin);
    expect(s.profile.exp).toBe(exp + q.exp);
    expect(residentOf(s, 'rat')!.affinity).toBe(q.aff);
    expect(s.profile.goalProgress).toBe(1);
    expect(s.requests[0]).toMatchObject({ state: 'wait', readyAt: T0 + 1200 * SEC, resident: '', n: 0 });
    expect(why(() => requestDone(s, 0, T0, id()))).toBe('no request');
    // 20분 뒤에 새 부탁이 온다
    settle(s, T0 + 1199 * SEC);
    expect(s.requests[0].state).toBe('wait');
    settle(s, T0 + 1200 * SEC);
    expect(s.requests[0].state).toBe('open');
    expect(s.profile.reqSeq).toBe(4);
  });

  it('넘기면 한 시간 뒤에 새 부탁', () => {
    const s = town(1);
    const res = { ...s.profile.resources };
    requestSkip(s, 1, T0);
    expect(s.requests[1]).toMatchObject({ state: 'wait', readyAt: T0 + 3600 * SEC });
    expect(s.profile.resources).toEqual(res);
    expect(why(() => requestSkip(s, 1, T0))).toBe('no request');
    settle(s, T0 + 3600 * SEC);
    expect(s.requests[1].state).toBe('open');
  });

  it('친밀도: 5단계가 되면 전용 장식물이 보관함으로. 사당이 있으면 +50 %', () => {
    const s = town(1);
    fill(s, 1e6);
    aff(s, 'rat', 98);
    const q = { ...s.requests[0] };
    const gift = requestDone(s, 0, T0, 'gift-1');
    expect(residentOf(s, 'rat')).toMatchObject({ affinity: 98 + q.aff, gifted: true });
    expect(gift).toMatchObject({ id: 'gift-1', type: 'gift_rat', state: 'stored' });
    // 선물은 한 번만. 보관함에서 꺼내 놓을 수 있다
    expect(requestDone(s, 1, T0, 'gift-2')).toBeNull();
    place(s, 'gift-1', 15, 10, T0);
    expect(s.buildings.find((b) => b.id === 'gift-1')).toMatchObject({ state: 'done', x: 15, y: 10 });
    // 사당
    put(s, 'shrine', 12, 12);
    const before = residentOf(s, 'rat')!.affinity;
    const q2 = { ...s.requests[2] };
    requestDone(s, 2, T0, id());
    expect(residentOf(s, 'rat')!.affinity).toBe(before + Math.floor((q2.aff * 150) / 100));
  });

  it('소의 친밀도 단계가 오르면 그때까지 쌓인 양을 먼저 적어 둔다', () => {
    const s = town(2);
    fill(s, 1e6);
    const p = put(s, 'paddy', 5, 5);
    assign(s, 'ox', p.id, T0);
    aff(s, 'ox', 9);
    // 소의 부탁이 나올 때까지 넘긴다
    let t = T0;
    for (let i = 0; i < 40 && !s.requests.some((q) => q.state === 'open' && q.resident === 'ox'); i++) {
      for (const q of s.requests) if (q.state === 'open') requestSkip(s, q.slot, t);
      t += HOUR;
      settle(s, t);
    }
    const q = s.requests.find((v) => v.resident === 'ox')!;
    p.collectedAt = t - HOUR;
    p.banked = 0;
    requestDone(s, q.slot, t, id());
    expect(affLevel(residentOf(s, 'ox')!.affinity)).toBe(2);
    expect(p.banked).toBe(66);
    expect(ratePct(s, p)).toBe(15);
  });
});

describe('6단계: 오늘의 할 일', () => {
  it('하루 셋, 서버 날짜가 바뀌면 새로. 마을 레벨에 맞는 종류만', () => {
    const s = newVillage(T0);
    settle(s, T0);
    expect(s.daily).toHaveLength(3);
    expect(s.profile.dailyDay).toBe(kstDay(T0));
    expect(new Set(s.daily.map((t) => t.task)).size).toBe(3);
    // 마을 레벨 1: 수확 · 짓기 · 부탁뿐
    expect(s.daily.map((t) => t.task).sort()).toEqual(['construct', 'harvest', 'request']);
    expect(s.daily).toEqual(makeDaily(kstDay(T0), 1));
    expect(TASKS.filter((t) => t.from <= 1)).toHaveLength(3);
    // 같은 날에는 그대로, 날이 바뀌면 새로 (진행도 처음부터)
    s.daily[0].progress = 1;
    settle(s, T0 + HOUR);
    expect(s.daily[0].progress).toBe(1);
    s.profile.level = 20;
    const next = T0 + 24 * HOUR;
    settle(s, next);
    expect(s.daily).toEqual(makeDaily(kstDay(next), 20));
    expect(s.daily.every((t) => t.progress === 0 && !t.claimed)).toBe(true);
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) for (const t of makeDaily(d, 20)) seen.add(t.task);
    expect([...seen].sort()).toEqual(['construct', 'craft', 'harvest', 'request', 'sell']);
  });

  it('한 일이 세어지고, 다 하면 보상. 셋을 다 받으면 추가 보상 (하루 한 번)', () => {
    const s = fill(newVillage(T0), 1000);
    settle(s, T0);
    const task = (k: string) => s.daily.find((t) => t.task === k)!;
    expect(why(() => dailyClaim(s, task('construct').slot, T0))).toBe('not done');
    expect(why(() => dailyClaim(s, 3, T0))).toBe('not done');
    expect(why(() => dailyClaim(s, 7, T0))).toBe('no task');
    // 짓기 한 번 (장식물은 세지 않는다)
    build(s, 'tree', 13, 13, T0, id());
    expect(task('construct').progress).toBe(0);
    const p = build(s, 'paddy', 6, 6, T0, id());
    expect(task('construct').progress).toBe(1);
    const coin = s.profile.resources.coin;
    dailyClaim(s, task('construct').slot, T0);
    expect(s.profile.resources.coin).toBe(coin + task('construct').coin);
    expect(why(() => dailyClaim(s, task('construct').slot, T0))).toBe('claimed');
    // 수확: 건물 하나를 거둘 때마다 한 번 (필요한 횟수를 넘지 않는다)
    build(s, 'house', 7, 6, T0, id());
    let t = T0;
    for (let i = 0; i < task('harvest').n + 2; i++) {
      t += 10 * 60 * SEC;
      s.profile.resources.rice = 0;
      harvest(s, [p.id], t);
    }
    expect(task('harvest').progress).toBe(task('harvest').n);
    dailyClaim(s, task('harvest').slot, t);
    // 부탁 두 번
    fill(s, 1e6);
    requestDone(s, 0, t, id());
    requestDone(s, 1, t, id());
    expect(task('request').progress).toBe(2);
    expect(why(() => dailyClaim(s, 3, t))).toBe('not done');
    dailyClaim(s, task('request').slot, t);
    const exp = s.profile.exp;
    const lv = s.profile.level;
    const bonus = dailyBonus(lv);
    const c2 = s.profile.resources.coin;
    dailyClaim(s, 3, t);
    expect(s.profile.resources.coin).toBe(c2 + bonus.coin);
    expect(s.profile.level > lv || s.profile.exp === exp + bonus.exp).toBe(true);
    expect(why(() => dailyClaim(s, 3, t))).toBe('claimed');
    expect(bonus.exp).toBeGreaterThan(s.daily[0].exp);
  });

  it('업그레이드 · 판매 · 가공도 센다', () => {
    const s = town(1);
    s.daily = [
      { slot: 0, task: 'construct', n: 2, progress: 0, claimed: false, coin: 1, exp: 1 },
      { slot: 1, task: 'sell', n: 50, progress: 0, claimed: false, coin: 1, exp: 1 },
      { slot: 2, task: 'craft', n: 5, progress: 0, claimed: false, coin: 1, exp: 1 },
    ];
    s.buildings[0].level = 5;
    const p = put(s, 'paddy', 5, 5);
    put(s, 'market', 6, 5);
    const m = put(s, 'mill', 7, 5);
    upgrade(s, p.id, T0);
    expect(s.daily[0].progress).toBe(1);
    const got = sell(s, 'wood', 100, T0);
    expect(s.daily[1].progress).toBe(Math.min(50, got));
    craft(s, m.id, 3, T0);
    harvest(s, [m.id], T0 + HOUR);
    expect(s.daily[2].progress).toBe(3);
  });
});

describe('6단계: 서버 답 다듬기', () => {
  it('주민 · 부탁 · 오늘의 할 일', () => {
    const s = cleanState({
      residents: [{ id: 'ox', affinity: 12, building: 'b1' }, { id: 'lion' }, { id: 'rat', affinity: -5, gifted: true }, { id: 'ox' }],
      requests: [{ slot: 1, state: 'wait', readyAt: 99 }, { slot: 0, state: 'open', resident: 'rat', res: 'rice', n: 30, coin: 20, exp: 9, aff: 3 }, { slot: 2, state: 'open', resident: 'lion', res: 'rice' }],
      daily: [{ slot: 0, task: 'harvest', n: 7, progress: 2, claimed: false, coin: 25, exp: 12 }, { slot: 1, task: 'dance' }],
      profile: { reqSeq: 4, dailyDay: 321, roosterDay: 320 },
    });
    expect(s.residents).toEqual([{ id: 'rat', affinity: 0, building: null, gifted: true }, { id: 'ox', affinity: 12, building: 'b1', gifted: false }]);
    expect(s.requests).toEqual([
      { slot: 0, state: 'open', readyAt: 0, resident: 'rat', res: 'rice', n: 30, coin: 20, exp: 9, aff: 3 },
      { slot: 1, state: 'wait', readyAt: 99, resident: '', res: '', n: 0, coin: 0, exp: 0, aff: 0 },
      { slot: 2, state: 'wait', readyAt: 0, resident: '', res: '', n: 0, coin: 0, exp: 0, aff: 0 },
    ]);
    expect(s.daily).toEqual([{ slot: 0, task: 'harvest', n: 7, progress: 2, claimed: false, coin: 25, exp: 12 }]);
    expect(s.profile).toMatchObject({ reqSeq: 4, dailyDay: 321, dailyBonusDay: 0, roosterDay: 320 });
    const c = cloneState(s);
    c.residents[0].affinity = 50;
    c.requests[0].n = 1;
    c.daily[0].progress = 7;
    expect([s.residents[0].affinity, s.requests[0].n, s.daily[0].progress]).toEqual([0, 30, 2]);
  });
});

// ───────────────────────── 7단계: 번영도 · 칭찬 · 마을 이름 ─────────────────────────

describe('7단계: 번영도', () => {
  it('건물 레벨 합 + 놓인 것의 점수 + 주민 친밀도 + 받은 칭찬', () => {
    const s = newVillage(T0);
    expect(prosperityOf(s)).toBe(1); // 마을 회관 레벨 1
    const p = put(s, 'paddy', 6, 6, 3);
    put(s, 'pond', 7, 6);
    put(s, 'pavilion', 12, 12, 2);
    expect(prosperityOf(s)).toBe(1 + 3 + 13 + (2 + 20));
    // 짓는 중 · 보관함은 세지 않는다. 길은 점수가 없다
    put(s, 'road', 8, 6);
    put(s, 'stonetower', 9, 6).state = 'stored';
    const site = put(s, 'lumber', 10, 6, 5);
    site.state = 'building';
    expect(prosperityOf(s)).toBe(39);
    p.state = 'upgrading';
    expect(prosperityOf(s)).toBe(39);
    // 주민: 친밀도 단계 × 3
    s.residents = [{ id: 'rat', affinity: 0, building: null, gifted: false }, { id: 'ox', affinity: 100, building: null, gifted: true }];
    expect(prosperityOf(s)).toBe(39 + 3 + 15);
    put(s, 'gift_ox', 11, 6);
    s.profile.praiseCount = 4;
    expect(prosperityOf(s)).toBe(57 + 12 + 8);
  });

  it('값이 바뀔 때만 달성 시각이 바뀐다', () => {
    const s = newVillage(T0);
    refresh(s, T0 + 5);
    expect(s.profile).toMatchObject({ prosperity: 1, prosperityAt: T0 + 5 });
    refresh(s, T0 + 99);
    expect(s.profile.prosperityAt).toBe(T0 + 5);
    put(s, 'tree', 6, 6);
    refresh(s, T0 + 200);
    expect(s.profile).toMatchObject({ prosperity: 2, prosperityAt: T0 + 200 });
  });
});

describe('7단계: 마을 이름 · 칭찬', () => {
  it('이름: 한글 · 영문 · 숫자 · 띄어쓰기, 12자까지', () => {
    const s = newVillage(T0);
    for (const ok of ['달빛 마을', 'SIA 1번지', '가', '열두글자마을이름입니다아']) {
      rename(s, ok, T0);
      expect(s.profile.name).toBe(ok);
    }
    for (const bad of ['', ' 마을', '마을 ', '달빛  마을', '<b>마을</b>', "마을'; drop", '마을!', '열세글자마을이름입니다아아', 'ㅋㅋ', '🏡마을', '마을\n이름']) {
      expect(why(() => rename(s, bad, T0)), bad).toBe('bad name');
    }
    expect(why(() => rename(s, 5 as unknown as string, T0))).toBe('bad name');
    expect(s.profile.name).toBe('열두글자마을이름입니다아');
  });

  it('칭찬: 하루 다섯 번, 같은 마을은 하루 한 번, 내 마을은 안 된다', () => {
    const s = newVillage(T0);
    expect(why(() => praiseGive(s, 'me', 'me', T0))).toBe('self');
    praiseGive(s, 'me', 'a', T0);
    expect(s.profile.resources.coin).toBe(CONST.praise_coin);
    expect(praiseLeft(s, T0)).toBe(4);
    expect(why(() => praiseGive(s, 'me', 'a', T0 + HOUR))).toBe('already praised');
    for (const t of ['b', 'c', 'd', 'e']) praiseGive(s, 'me', t, T0);
    expect(praiseLeft(s, T0)).toBe(0);
    expect(why(() => praiseGive(s, 'me', 'f', T0))).toBe('praise limit');
    expect(s.profile.resources.coin).toBe(5 * CONST.praise_coin);
    // 날이 바뀌면 다시
    const next = T0 + 24 * HOUR;
    expect(praiseLeft(s, next)).toBe(5);
    praiseGive(s, 'me', 'a', next);
    expect(s.profile.praised).toEqual(['a']);
    // 받는 쪽: 번영도 +2
    const t = newVillage(T0);
    praiseTake(t);
    expect(prosperityOf(t)).toBe(1 + CONST.praise_points);
  });

  it('서버 답: 오늘 칭찬한 마을들', () => {
    const now = Date.UTC(2026, 10, 20, 3, 0, 0);
    const s = cleanState({ now, profile: { praised: ['u1', 'u2', 5], praiseCount: 3, prosperity: 40, prosperityAt: 123 } });
    expect(s.profile).toMatchObject({ praised: ['u1', 'u2'], praisedDay: kstDay(now), praiseCount: 3, prosperity: 40, prosperityAt: 123 });
    expect(praiseLeft(s, now)).toBe(3);
    const c = cloneState(s);
    c.profile.praised.push('x');
    expect(s.profile.praised).toHaveLength(2);
  });
});

// ───────────────────────── 8단계: 기념물 ─────────────────────────

describe('8단계: 기념물', () => {
  it('조건을 채운 것만 보관함으로 들어오고, 다시 주지 않는다', () => {
    const s = newVillage(T0);
    let n = 0;
    const id = () => `m${++n}`;
    expect(grantMonuments(s, noStats(), T0, id)).toEqual([]);
    const got = grantMonuments(s, { ...noStats(), volley_wins: 10, tank_wins: 9, race_plays: 1, def_12: 1 }, T0, id);
    expect(got.map((b) => [b.type, b.state])).toEqual([['mon_tank1', 'stored'], ['mon_volley1', 'stored'], ['mon_volley10', 'stored'], ['mon_race1', 'stored'], ['mon_def12', 'stored']]);
    expect(s.monuments).toEqual(['mon_tank1', 'mon_volley1', 'mon_volley10', 'mon_race1', 'mon_def12']);
    expect(grantMonuments(s, { ...noStats(), volley_wins: 10, tank_wins: 9, race_plays: 1, def_12: 1 }, T0, id)).toEqual([]);
    // 기록이 줄어도 그대로. 나중에 열린 것은 차례대로 끼어든다
    expect(grantMonuments(s, { ...noStats(), tank_wins: 10 }, T0, id).map((b) => b.type)).toEqual(['mon_tank10']);
    expect(s.monuments).toEqual(['mon_tank1', 'mon_tank10', 'mon_volley1', 'mon_volley10', 'mon_race1', 'mon_def12']);
    // 놓으면 번영도가 오른다
    const b = s.buildings.find((v) => v.type === 'mon_def12')!;
    const p0 = prosperityOf(s);
    place(s, b.id, 6, 6, T0);
    expect(prosperityOf(s)).toBe(p0 + 60);
    // 지을 수는 없다
    expect(why(() => build(s, 'mon_tank1', 8, 8, T0, 'x'))).toMatch(/locked|limit/);
  });

  it('서버 답의 기념물 목록', () => {
    const s = cleanState({ monuments: ['mon_def3', 'nope', 'mon_tank1', 5] });
    expect(s.monuments).toEqual(['mon_tank1', 'mon_def3']);
    const c = cloneState(s);
    c.monuments.push('mon_def6');
    expect(s.monuments).toHaveLength(2);
    expect(MONUMENTS).toHaveLength(16);
    expect(new Set(MONUMENTS.map((m) => m.game)).size).toBe(GAMES.length);
  });
});

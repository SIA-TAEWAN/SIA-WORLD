import { describe, expect, it } from 'vitest';
import { CONST, GRID_MAX, LAND_SIZES } from '../src/data/balance';
import { BUILDING, BUILDINGS, isReward } from '../src/data/buildings';
import { GOALS } from '../src/data/goals';
import { MONUMENTS } from '../src/data/monuments';
import { RESIDENT, RESIDENT_IDS, affLevel } from '../src/data/residents';
import { SHOWCASE_SIZE, makeShowcase, showcasePlan } from '../src/data/showcase';
import { cleanState, countOf, landRect, maxCount, placeError, prosperityOf, settle, standing, storageCap, workplace } from '../src/game/rules';

const T0 = 1_800_000_000_000;

describe('본보기 마을 (makeShowcase)', () => {
  const s = makeShowcase(T0);

  it('지도는 20×20 이고 모르는 글자가 없다', () => {
    expect(SHOWCASE_SIZE).toEqual({ rows: GRID_MAX, cols: GRID_MAX, grid: GRID_MAX });
    // 2×2 건물의 나머지 칸('##')은 그 건물의 칸과 딱 맞는다 = 놓인 칸 수의 합이 지도에 적힌 칸 수와 같다
    const cells = showcasePlan().reduce((n, p) => n + BUILDING[p.type].w * BUILDING[p.type].h, 0);
    expect(cells).toBe(s.buildings.reduce((n, b) => n + BUILDING[b.type].w * BUILDING[b.type].h, 0));
  });

  it('가장 넓은 땅 · 최고 마을 레벨 · 목표는 끝까지', () => {
    expect(s.profile.landStage).toBe(LAND_SIZES.length - 1);
    expect(landRect(s.profile.landStage)).toEqual({ x0: 0, size: GRID_MAX });
    expect(s.profile.level).toBe(CONST.max_level);
    expect(s.profile.goal).toBe(GOALS.length);
  });

  it('모든 종류가 최대 개수만큼 놓여 있다 (선물 · 기념물은 하나씩)', () => {
    for (const d of BUILDINGS) {
      const want = isReward(d.id) ? 1 : maxCount(d.id, CONST.max_level);
      expect([d.id, countOf(s, d.id)]).toEqual([d.id, want]);
    }
    expect(s.monuments).toEqual(MONUMENTS.map((m) => m.id));
  });

  it('모두 다 지어져 있고, 건물은 최고 레벨이다', () => {
    for (const b of s.buildings) {
      const kind = BUILDING[b.type].kind;
      expect([b.id, b.state, b.finishAt, b.startAt]).toEqual([b.id, 'done', null, null]);
      expect([b.id, b.level]).toEqual([b.id, kind === 'main' || kind === 'special' ? CONST.building_max_level : 1]);
      expect(standing(b)).toBe(true);
    }
  });

  it('id 는 겹치지 않고 show-000 부터 차례대로, 마을 회관이 맨 앞이다', () => {
    expect(s.buildings.map((b) => b.id)).toEqual(s.buildings.map((_, i) => `show-${String(i).padStart(3, '0')}`));
    expect(s.buildings[0].type).toBe('hall');
  });

  it('겹치지 않고 땅 안에 있다 (placeError 로 하나씩 다시 놓아 본다)', () => {
    for (const b of s.buildings) expect([b.id, b.type, b.x, b.y, placeError(s, b.type, b.x, b.y, b.id)]).toEqual([b.id, b.type, b.x, b.y, null]);
    // 칸마다 주인이 하나뿐인지도 직접 센다
    const seen = new Map<string, string>();
    for (const b of s.buildings) {
      const d = BUILDING[b.type];
      for (let x = b.x; x < b.x + d.w; x++) for (let y = b.y; y < b.y + d.h; y++) {
        expect(x >= 0 && y >= 0 && x < GRID_MAX && y < GRID_MAX).toBe(true);
        expect(seen.get(`${x},${y}`)).toBeUndefined();
        seen.set(`${x},${y}`, b.id);
      }
    }
  });

  it('주민 12명이 모두 이사 와 있고 일터에서 일한다', () => {
    expect(s.residents.map((r) => r.id)).toEqual([...RESIDENT_IDS]);
    for (const r of s.residents) {
      expect(affLevel(r.affinity)).toBe(5);
      expect(r.gifted).toBe(true);
      if (RESIDENT[r.id].work === '') expect(r.building).toBeNull();
      else expect(workplace(s, r.id)?.type).toBe(RESIDENT[r.id].work);
    }
  });

  it('마을 어귀(아래 가운데)에서 마을 회관 앞까지 길이 이어진다', () => {
    const road = new Set(s.buildings.filter((b) => b.type === 'road').map((b) => `${b.x},${b.y}`));
    expect(road.has(`${GRID_MAX / 2 - 1},${GRID_MAX - 1}`) && road.has(`${GRID_MAX / 2},${GRID_MAX - 1}`)).toBe(true);
    // 길은 모두 한 덩어리다 (어귀에서 걸어서 닿는다)
    const seen = new Set([`${GRID_MAX / 2},${GRID_MAX - 1}`]);
    const todo = [[GRID_MAX / 2, GRID_MAX - 1]];
    while (todo.length) {
      const [x, y] = todo.pop()!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = `${nx},${ny}`;
        if (road.has(k) && !seen.has(k)) {
          seen.add(k);
          todo.push([nx, ny]);
        }
      }
    }
    expect(seen.size).toBe(road.size);
    const hall = s.buildings[0];
    expect([...seen].some((k) => k === `${hall.x},${hall.y + 2}`)).toBe(true);
  });

  it('믿을 수 있는 상태다: 다듬어도 · 서버의 첫 처리(settle)를 거쳐도 그대로', () => {
    expect(cleanState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(s.profile.prosperity).toBe(prosperityOf(s));
    const t = makeShowcase(T0);
    settle(t, T0 + 1000);
    expect(t.buildings).toEqual(s.buildings);
    expect(t.residents).toEqual(s.residents);
    expect(t.profile.level).toBe(CONST.max_level);
    for (const k of ['rice', 'wood', 'stone', 'cake'] as const) expect(s.profile.resources[k]).toBeLessThanOrEqual(storageCap(s));
  });
});

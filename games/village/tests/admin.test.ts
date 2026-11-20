import { describe, expect, it } from 'vitest';
import { CONST, LAND_SIZES } from '../src/data/balance';
import { makeShowcase } from '../src/data/showcase';
import { MONUMENTS } from '../src/data/monuments';
import { RESIDENT_IDS } from '../src/data/residents';
import { RuleError, adminBoost, adminSetState, build, cleanState, expand, newVillage, upgrade, type VillageState } from '../src/game/rules';
import { ApiError, createLocalApi, type Store } from '../src/net/api';

/** 관리자 계정 (062): 최고 레벨 · 제한 없음 · 값 없음 · 전시 마을. SQL 은 supabase/migrations/062_village_admin.sql */

const T = 1_800_000_000_000;
const zero = (s: VillageState) => Object.assign(s.profile.resources, { rice: 0, wood: 0, stone: 0, cake: 0, coin: 0, special: 0 });
const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('관리자 규칙', () => {
  it('서버 답의 admin 을 읽는다 (없으면 일반 사용자)', () => {
    expect(cleanState({}).admin).toBe(false);
    expect(cleanState({ admin: true }).admin).toBe(true);
    expect(cleanState({ admin: 'true' }).admin).toBe(false);
  });

  it('최고 레벨 · 땅 끝까지 (일반 사용자는 그대로)', () => {
    const s = newVillage(T);
    expect(adminBoost(s)).toBe(false);
    expect([s.profile.level, s.profile.landStage]).toEqual([1, 0]);
    s.admin = true;
    expect(adminBoost(s)).toBe(true);
    expect([s.profile.level, s.profile.exp, s.profile.landStage]).toEqual([CONST.max_level, 0, LAND_SIZES.length - 1]);
    expect(adminBoost(s)).toBe(false);
  });

  it('짓기: 개수 · 해금 · 건설 슬롯 · 값 · 시아코인을 보지 않는다. 마을 회관은 하나, 자리는 그대로', () => {
    const s = newVillage(T);
    s.admin = true;
    adminBoost(s);
    zero(s);
    let x = 0;
    for (let i = 0; i < 10; i++) build(s, 'paddy', x++, 0, T, `p${i}`);
    for (const t of ['pavilion', 'pavilion', 'shrine'] as const) {
      build(s, t, x, 2, T, `${t}${x}`);
      x += 2;
    }
    for (const t of ['gift_rat', 'mon_def12', 'stonetower'] as const) build(s, t, x++, 0, T, t);
    expect(s.buildings.filter((b) => b.type === 'paddy')).toHaveLength(10);
    expect(s.buildings.filter((b) => b.state === 'building').length).toBeGreaterThan(3);
    expect(s.profile.resources).toEqual({ rice: 0, wood: 0, stone: 0, cake: 0, coin: 0, special: 0 });
    expect(s.sia).toBe(0);
    expect(() => build(s, 'hall', 0, 18, T, 'h2')).toThrow(new RuleError('limit'));
    expect(() => build(s, 'paddy', 0, 0, T, 'dup')).toThrow(new RuleError('occupied'));
    // 일반 사용자는 그대로
    const u = newVillage(T);
    expect(() => build(u, 'pavilion', 6, 6, T, 'pv')).toThrow(new RuleError('locked'));
    expect(() => build(u, 'gift_rat', 6, 6, T, 'g')).toThrow(new RuleError('locked'));
    build(u, 'paddy', 6, 6, T, 'p');
    expect([u.profile.resources.rice, u.profile.resources.wood]).toEqual([45, 40]);
  });

  it('업그레이드: 마을 회관 레벨 · 건설 슬롯 · 값 없이 (최고 레벨 10 은 그대로) · 땅 넓히기도 값 없이', () => {
    const s = newVillage(T);
    s.admin = true;
    zero(s);
    for (let i = 0; i < 5; i++) build(s, 'paddy', 6 + i, 6, T, `p${i}`);
    const later = T + 3600_000;
    for (let i = 0; i < 5; i++) upgrade(s, `p${i}`, later);
    expect(s.buildings.filter((b) => b.state === 'upgrading')).toHaveLength(5);
    const top = s.buildings.find((b) => b.id === 'p0')!;
    Object.assign(top, { state: 'done', finishAt: null, startAt: null, level: CONST.building_max_level });
    expect(() => upgrade(s, 'p0', later)).toThrow(new RuleError('max level'));
    // 쌀은 업그레이드 전에 거둔 생산이다. 낸 것은 없다
    expect([s.profile.resources.wood, s.profile.resources.stone, s.profile.resources.coin]).toEqual([0, 0, 0]);
    expect(s.profile.resources.rice).toBeGreaterThan(0);
    expand(s, later);
    expect([s.profile.landStage, s.sia]).toEqual([1, 0]);
    const u = newVillage(T);
    expect(() => expand(u, T)).toThrow(new RuleError('village level'));
  });

  it('전시 마을: makeShowcase 를 그대로 받는다 (짓는 중 없음 · 주민 배치 · 기념물). 관리자가 아니면 거절', () => {
    const show = makeShowcase(T);
    const u = newVillage(T);
    expect(() => adminSetState(u, show, T, () => 'x')).toThrow(new RuleError('not admin'));
    const s = newVillage(T);
    s.admin = true;
    let n = 0;
    adminSetState(s, show, T + 1000, () => `n${++n}`);
    expect(s.buildings).toHaveLength(show.buildings.length);
    expect(s.buildings.map((b) => [b.type, b.level, b.x, b.y])).toEqual(show.buildings.map((b) => [b.type, b.level, b.x, b.y]));
    expect(s.buildings.every((b) => b.state === 'done' && b.finishAt === null)).toBe(true);
    expect([s.profile.level, s.profile.landStage, s.profile.name]).toEqual([CONST.max_level, LAND_SIZES.length - 1, show.profile.name]);
    expect(s.residents.map((r) => r.id)).toEqual(RESIDENT_IDS);
    for (const r of s.residents) {
      const want = show.residents.find((v) => v.id === r.id)!;
      const sent = show.buildings.findIndex((b) => b.id === want.building);
      expect(r.building, r.id).toBe(sent < 0 ? null : s.buildings[sent].id);
    }
    expect(s.monuments).toEqual(MONUMENTS.map((m) => m.id));
    expect(s.requests).toHaveLength(3);
    expect(s.daily).toHaveLength(3);
    // 겹치면 통째로 거절 (그대로 남는다)
    const before = JSON.stringify(s);
    const bad = makeShowcase(T);
    bad.buildings.push({ ...bad.buildings[0], id: 'again' });
    expect(() => adminSetState(s, bad, T, () => 'z')).toThrow(new RuleError('bad state'));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('테스트 모드 (?admin=1)', async () => {
    const api = createLocalApi(memStore(), () => T, 1, undefined, undefined, true);
    const s = await api.load();
    expect([s.admin, s.profile.level, s.profile.landStage]).toEqual([true, CONST.max_level, 6]);
    const next = await api.adminSetState(makeShowcase(api.now()));
    expect(next.buildings.length).toBe(makeShowcase(T).buildings.length);
    const plain = createLocalApi(memStore(), () => T);
    await expect(plain.adminSetState(makeShowcase(T))).rejects.toThrow(ApiError);
    expect((await plain.load()).admin).toBe(false);
  });
});

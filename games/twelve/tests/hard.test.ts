import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, BOSS_IDS, FINAL_BOSS } from '../src/data/bosses';
import { FINAL_GIFT, REGION_TIER, bossGift, regionTier } from '../src/data/economy';
import { itemDef, itemLevel, regionRares, starReward } from '../src/data/items';
import { ALL_MAPS, FINAL, MAPS, mapKillMax, mapOf, mapPar } from '../src/data/maps';
import { EXP_CURVE, EXP_HARD, MAX_LEVEL, expNeed } from '../src/data/growth';
import { FINAL_MAP, HARD, HARD_READY, MAPS_PER_REGION, REGIONS, levelScale, mapLevel, mapScale } from '../src/data/regions';
import { mapRows } from '../src/data/sqlrows';
import { TIER_LEVELS, tierAtk } from '../src/data/weapons';
import {
  applyReport,
  checkStart,
  cleared,
  continueMap,
  emptyProfile,
  finalOpen,
  hardDone,
  hasKey,
  keyCount,
  mapOpen,
  mapReward,
  modeOpen,
  normalDone,
  regionOpen,
  regionStarCount,
  setMode,
  whyText,
  type RunReport,
  type TwelveProfile,
} from '../src/game/progress';
import { forSale, shopTier } from '../src/game/rules';
import { STAR_TIME, createRun } from '../src/game/sim';
import { towerRareLists } from '../src/game/tower';
import { ApiError, createLocalApi, createSupabaseApi, normalize, type RpcClient, type Store } from '../src/net/api';
import { autoplay } from './bot';
import { lo } from './helpers';

/**
 * 어려움 모드 (PRD '전체 구조' · '성장'): 보통 모드를 끝내면 열리는 2회차.
 * 레벨·장비는 그대로, 맵 진행·열쇠·별은 모드마다 따로. 서버 쪽은 scripts/pg-check.mjs 가 실제로 돌려 본다.
 */

/** 보통 모드를 끝낸 기록 */
function normalCleared(): TwelveProfile {
  const p = emptyProfile();
  p.level = 66;
  for (const m of ALL_MAPS) p.maps.normal[m.id] = { stars: 0, clears: 1, best: 100 };
  p.keys.normal = Array.from({ length: REGIONS }, (_, i) => i + 1);
  return p;
}
const report = (map: string, over: Partial<RunReport> = {}): RunReport => {
  const m = mapOf(map)!;
  const max = mapKillMax(m, 'hard');
  return { run: 'r', map, mode: 'hard', hero: 'rat', time: 100, cleared: true, kills: { ...max.kinds }, elites: max.elites, boss: !!m.boss, chest: true, deaths: 0, ...over };
};
const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('어려움 모드 — 열림과 전환', () => {
  it('준비됐다 (서버 맵 표에 어려움 줄 97개)', () => {
    expect(HARD_READY).toBe(true);
    const rows = mapRows().filter((r) => r.includes("'hard'"));
    expect(rows.length).toBe(97);
    expect(rows[0].startsWith("('1-1', 'hard', 1, 1, 66, ")).toBe(true);
    expect(rows[96].startsWith(`('final', 'hard', 12, 9, 99, ${mapPar(FINAL, 'hard')}, true, `)).toBe(true);
  });

  it('보통 모드를 끝내기 전에는 잠겨 있다: 맵 · 지형 · 모드 바꾸기', () => {
    const p = emptyProfile();
    expect(modeOpen(p, 'normal')).toBe(true);
    expect(modeOpen(p, 'hard')).toBe(false);
    expect(regionOpen(p, 1, 'hard')).toBe(false);
    expect(mapOpen(p, '1-1', 'hard')).toBe(false);
    expect(checkStart(p, '1-1', 'hard', 'rat')).toBe('mode locked');
    expect(setMode(p, 'hard')).toBe('mode locked');
    expect(p.mode).toBe('normal');
    expect(setMode(p, 'easy')).toBe('bad mode');
    expect(whyText('mode locked')).toContain('보통 모드');
    // 12지형 보스까지만 잡은 것으로는 안 열린다 (최종보스를 잡아야 한다)
    const q = normalCleared();
    delete q.maps.normal[FINAL_MAP];
    expect(normalDone(q)).toBe(false);
    expect(setMode(q, 'hard')).toBe('mode locked');
  });

  it('보통 모드를 끝내면 열린다: 레벨·장비·엽전은 그대로, 맵 진행·열쇠는 새로. 보통으로 돌아갈 수 있다', () => {
    const p = normalCleared();
    p.coins = 1234;
    const items = JSON.stringify(p.items);
    expect(setMode(p, 'hard')).toBeNull();
    expect(p.mode).toBe('hard');
    expect([p.level, p.coins, JSON.stringify(p.items)]).toEqual([66, 1234, items]);
    // 기본 인자가 지금 모드를 따른다
    expect(regionOpen(p, 1)).toBe(true);
    expect(regionOpen(p, 2)).toBe(false);
    expect(mapOpen(p, '1-1')).toBe(true);
    expect(mapOpen(p, '1-2')).toBe(false);
    expect(keyCount(p)).toBe(0);
    expect(continueMap(p)).toBe('1-1');
    expect(checkStart(p, '1-1', 'hard', 'rat')).toBeNull();
    expect(checkStart(p, '1-2', 'hard', 'rat')).toBe('map locked');
    // 보통 모드의 기록은 그대로다
    expect(setMode(p, 'normal')).toBeNull();
    expect(keyCount(p)).toBe(REGIONS);
    expect(continueMap(p)).toBe('12-8');
  });

  it('어려움의 맵 기록 · 별 · 열쇠는 따로 쌓인다', () => {
    const p = normalCleared();
    setMode(p, 'hard');
    const before = { ...p.maps.normal['1-1'] };
    for (let n = 1; n <= MAPS_PER_REGION; n++) applyReport(p, report(`1-${n}`), 7);
    expect(p.maps.normal['1-1']).toEqual(before);
    expect(cleared(p, '1-8', 'hard')).toBe(true);
    expect(regionStarCount(p, 1, 'hard')).toBe(24);
    expect(regionStarCount(p, 1, 'normal')).toBe(0);
    expect(regionOpen(p, 2, 'hard')).toBe(true);
    // 별 24개 보상은 어려움 것을 따로 받는다
    expect(p.codex).toContain(starReward(1, 'hard'));
    expect(p.codex).not.toContain(starReward(1, 'normal'));
    // 열쇠: 보스를 세 번 잡으면 확정
    for (let i = 0; i < 2 && !hasKey(p, 1, 'hard'); i++) applyReport(p, report('1-8'), 100 + i);
    expect(p.keys.hard).toEqual([1]);
    expect(p.keys.normal.length).toBe(REGIONS);
  });

  it('어려움 최종보스: 어려움 열쇠 12개가 있어야 하고, 잡으면 진짜 끝 (hardDone · 강화석 꾸러미는 모드마다 한 번)', () => {
    const p = normalCleared();
    setMode(p, 'hard');
    for (const m of MAPS) p.maps.hard[m.id] = { stars: 0, clears: 1, best: 100 };
    p.keys.hard = [1, 2, 3];
    expect(finalOpen(p)).toBe(false);
    expect(checkStart(p, FINAL_MAP, 'hard', 'rat')).toBe('need keys');
    p.keys.hard = Array.from({ length: REGIONS }, (_, i) => i + 1);
    expect(checkStart(p, FINAL_MAP, 'hard', 'rat')).toBeNull();
    expect(continueMap(p)).toBe(FINAL_MAP);
    expect(hardDone(p)).toBe(false);
    const r = applyReport(p, report(FINAL_MAP, { time: 400 }), 9);
    expect(r.first).toBe(true);
    expect(r.gift).toBe(FINAL_GIFT);
    expect(hardDone(p)).toBe(true);
    expect(applyReport(p, report(FINAL_MAP, { time: 400 }), 10).gift).toBe(0);
    // 10~12지형 보스의 선물도 어려움에서 다시 한 번
    const q = normalCleared();
    setMode(q, 'hard');
    expect(applyReport(q, report('12-8'), 3).gift).toBe(bossGift(12));
  });
});

describe('어려움 모드 — 요괴 · 보스 · 장비', () => {
  it('권장 레벨 Lv66~99, 요괴가 더 세고 많다', () => {
    expect(mapLevel(1, 1, 'hard')).toBe(66);
    expect(mapLevel(6, 8, 'hard')).toBe(82);
    expect(mapLevel(12, 8, 'hard')).toBe(99);
    for (const m of MAPS) {
      const n = mapScale(m.region, m.no, 'normal');
      const h = mapScale(m.region, m.no, 'hard');
      expect(h.hp).toBeGreaterThan(n.hp);
      expect(h.atk).toBeGreaterThan(n.atk);
      expect(h.count).toBeGreaterThan(n.count);
      expect(mapKillMax(m, 'hard').total).toBeGreaterThanOrEqual(mapKillMax(m, 'normal').total);
      expect(mapReward(m, 'hard').bossExp).toBeGreaterThanOrEqual(mapReward(m, 'normal').bossExp);
    }
    // 어려움의 첫 맵은 보통의 마지막 맵보다 약하지 않다
    expect(mapScale(1, 1, 'hard').hp).toBeGreaterThan(mapScale(12, 8, 'normal').hp);
  });

  it('어려움 배율: 체력·공격·요괴 수가 오르고 별 시간이 넉넉해진다. 최종보스맵은 덜 올린다', () => {
    const base = levelScale(mapLevel(6, 8, 'hard'));
    const h = mapScale(6, 8, 'hard');
    expect(h.count).toBe(HARD.count);
    expect(h.hp / base.hp).toBeCloseTo(HARD.hp + HARD.hpStep * (82 - 66));
    expect(h.atk / base.atk).toBeCloseTo(HARD.atk);
    // 경험치·엽전은 권장 레벨의 식 그대로 (요괴가 많아진 만큼 더 받는다)
    expect([h.exp, h.reward]).toEqual([base.exp, base.reward]);
    const f = mapScale(FINAL.region, FINAL.no, 'hard');
    const top = mapScale(12, 8, 'hard');
    expect(f.level).toBe(99);
    expect(f.hp).toBeLessThan(top.hp);
    expect(f.atk).toBeLessThan(top.atk);
    expect(f.hp).toBeGreaterThan(levelScale(99).hp);
    for (const m of ALL_MAPS) {
      expect(mapPar(m, 'normal')).toBe(m.par);
      expect(mapPar(m, 'hard')).toBe(Math.round(m.par * HARD.par));
    }
    // 별 '시간 안에'는 그 모드의 기준 시간으로 본다
    const p = normalCleared();
    setMode(p, 'hard');
    const par = mapOf('1-1')!.par;
    expect(applyReport(p, report('1-1', { time: par + 1 }), 1).stars & STAR_TIME).toBe(STAR_TIME);
    expect(applyReport(p, report('1-1', { time: mapPar(mapOf('1-1')!, 'hard') + 1 }), 1).stars & STAR_TIME).toBe(0);
  });

  it('경험치 곡선: 보통 모드(Lv65 까지)는 그대로, Lv66 부터 가파르다 — Lv99 까지 늘 오른다', () => {
    for (let l = 1; l < EXP_HARD.from; l++) expect(expNeed(l)).toBe(Math.round(EXP_CURVE.base * Math.pow(l, EXP_CURVE.pow) + EXP_CURVE.add));
    for (let l = 2; l < MAX_LEVEL; l++) expect(expNeed(l), `Lv${l}`).toBeGreaterThan(expNeed(l - 1));
    expect(expNeed(66) / (EXP_CURVE.base * Math.pow(66, EXP_CURVE.pow))).toBeCloseTo(1 / EXP_HARD.base, 2);
    expect(expNeed(98) / (EXP_CURVE.base * Math.pow(98, EXP_CURVE.pow))).toBeGreaterThan(1.9);
    expect(expNeed(MAX_LEVEL)).toBe(0);
    // 어려움 1-1 을 깬 경험치로 Lv66 의 2% 이상은 찬다 (맵 96개 + 사냥으로 33레벨)
    const p = normalCleared();
    setMode(p, 'hard');
    expect(applyReport(p, report('1-1'), 1).exp / expNeed(66)).toBeGreaterThan(0.02);
  });

  it('보스마다 어려움 전용 공격이 하나 있고, 어려움에서만 쓴다', () => {
    expect(Object.keys(BOSSES).sort()).toEqual([...BOSS_IDS, FINAL_BOSS].sort());
    for (const b of Object.values(BOSSES)) expect(b.hardMoves.length, b.name).toBe(1);
    const src = readFileSync(new URL('../src/game/sim.ts', import.meta.url), 'utf8');
    expect(src).toContain("s.mode === 'hard' ? [...base, ...def.hardMoves] : base");
  });

  it('장비 등급: 보통은 Lv63 까지, Lv72·81·90·99 는 어려움 지형에서만', () => {
    expect(TIER_LEVELS.slice(8)).toEqual([72, 81, 90, 99]);
    expect(Math.max(...REGION_TIER.normal)).toBe(7);
    expect(Math.min(...REGION_TIER.hard)).toBe(8);
    expect([...new Set(REGION_TIER.hard)]).toEqual([8, 9, 10, 11]);
    for (let r = 1; r <= REGIONS; r++) {
      // 어려움 전용 레어 (지형마다 무기 둘 + 방어구 하나) · 별 24개 보상
      const rares = regionRares(r, 'hard');
      expect(rares.length).toBe(3);
      for (const b of [...rares, starReward(r, 'hard')]) {
        const d = itemDef(b)!;
        expect(d.mode).toBe('hard');
        expect(d.tier).toBe(regionTier(r, 'hard'));
        expect(itemLevel(d)).toBeGreaterThanOrEqual(72);
        expect(d.name.startsWith('깊은 ')).toBe(true);
      }
      expect(rares).not.toEqual(regionRares(r, 'normal'));
    }
  });

  it('상점 · 끝없는 탑의 등급: 어려움 지형을 열어야 Lv72 이상이 나온다', () => {
    // 보통 모드를 끝내기 전: 비취(Lv63)까지 — 어려움 1지형이 열린 것으로 치지 않는다
    const p = normalCleared();
    delete p.maps.normal[FINAL_MAP];
    expect(shopTier(p)).toBe(7);
    expect(forSale(p, itemDef('w-sword-8')!)).toBe(false);
    expect(towerRareLists(p).length).toBe(12);
    // 끝낸 뒤: 어려움 1지형 등급(Lv72) + 그 지형 레어. 모드를 바꾸지 않아도 열린다
    const q = normalCleared();
    expect(shopTier(q)).toBe(8);
    expect(forSale(q, itemDef('w-sword-8')!)).toBe(true);
    expect(forSale(q, itemDef('w-sword-9')!)).toBe(false);
    expect(towerRareLists(q).length).toBe(13);
    expect(towerRareLists(q)[12]).toEqual(regionRares(1, 'hard'));
    // 어려움 지형을 깰수록 오른다: 3지형 보스 → 4지형(Lv81), 9지형 보스 → 10지형(Lv99)
    for (let r = 1; r <= 3; r++) q.maps.hard[`${r}-8`] = { stars: 0, clears: 1, best: 100 };
    expect(shopTier(q)).toBe(9);
    for (let r = 4; r <= 9; r++) q.maps.hard[`${r}-8`] = { stars: 0, clears: 1, best: 100 };
    expect(shopTier(q)).toBe(11);
    expect(towerRareLists(q).length).toBe(22);
  });
});

describe('어려움 모드 — 저장', () => {
  it('테스트 모드: 모드 바꾸기가 기기에 남고, 잠겨 있으면 거절한다', async () => {
    const store = memStore();
    const api = createLocalApi(store);
    await expect(api.setMode('hard')).rejects.toThrow(ApiError);
    await expect(api.start('1-1', 'hard', 'rat')).rejects.toThrow('mode locked');
    store.setItem('sia-twelve-local-v2', JSON.stringify(normalCleared()));
    expect((await api.setMode('hard')).mode).toBe('hard');
    expect((await api.loadProfile()).mode).toBe('hard');
    const { run } = await api.start('1-1', 'hard', 'rat');
    const out = await api.finish({ ...report('1-1'), run });
    expect(out!.profile.maps.hard['1-1'].clears).toBe(1);
    expect(out!.profile.maps.normal['1-1'].clears).toBe(1);
    expect((await api.setMode('normal')).mode).toBe('normal');
  });

  it('서버: twelve_set_mode 를 부르고, 거절(mode locked)은 ApiError 로', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    let locked = true;
    const sb: RpcClient = {
      rpc: async (fn, args) => {
        calls.push([fn, args]);
        if (locked) return { data: null, error: { message: 'mode locked' } };
        return { data: { ...emptyProfile(), mode: 'hard' }, error: null };
      },
    };
    const api = createSupabaseApi(sb, 'u1', memStore());
    await expect(api.setMode('hard')).rejects.toThrow(ApiError);
    locked = false;
    expect((await api.setMode('hard')).mode).toBe('hard');
    expect(calls[1]).toEqual(['twelve_set_mode', { p_mode: 'hard' }]);
    expect(normalize({ mode: 'hard' }).mode).toBe('hard');
  });

  it('SQL: 어려움은 보통 모드를 끝낸 뒤에만 (시작 · 모드 바꾸기 · 지형 열림), 랭킹의 👑 는 어려움 최종보스 기록', () => {
    const sql = ['078_twelve.sql', '089_twelve_full.sql'].map((n) => readFileSync(new URL(`../../../supabase/migrations/${n}`, import.meta.url), 'utf8')).join('\n');
    const fn = (name: string) => {
      const i = sql.lastIndexOf(`create or replace function public.${name}(`);
      return sql.slice(i, sql.indexOf('$$;', i));
    };
    for (const name of ['twelve_start', 'twelve_set_mode']) expect(fn(name)).toContain("if p_mode = 'hard' and not public._twelve_normal_done(me) then raise exception 'mode locked'; end if;");
    expect(fn('twelve_set_mode')).toContain('update public.twelve_profiles set mode = p_mode');
    expect(fn('_twelve_region_open')).toContain("(p_mode <> 'hard' or public._twelve_normal_done(p_user))");
    expect(sql).toContain("m.mode = 'hard' and m.map_id = 'final') as hard_done");
    // 시아코인: 권장 레벨(어려움 66~99)보다 15 이상 높으면 없다 — 맵 표의 레벨을 쓴다
    expect(fn('twelve_finish')).toContain("pr.level - mp.level < public._twelve_const('coin_level_gap')");
  });
});

describe('어려움 모드 — 맵 한 판 (자동 조종, 표본)', () => {
  // 96맵 전부는 보통 모드에서 본다 (tests/play1~3). 어려움은 지형 조각·보스 공격이 고르게 들어가는 표본만
  const sample = ['1-8', '4-5', '7-8', '10-4', '12-8', FINAL_MAP];
  it.each(sample)('%s: 끝까지 깰 수 있다 (무적 자동 조종)', { timeout: 60000 }, (id) => {
    const m = mapOf(id)!;
    const s = createRun(m, 'hard', { ...lo('ox', 'sword', mapLevel(m.region, m.no, 'hard')), weaponAtk: tierAtk(regionTier(m.region, 'hard')) }, { seed: 11, god: true });
    expect(s.total).toBe(mapKillMax(m, 'hard').total);
    const r = autoplay(s, 1800, { chest: true });
    expect(r.phase).toBe('clear');
    if (m.boss) expect(s.bossDead).toBe(true);
    expect(r.time).toBeLessThan(mapPar(m, 'hard') * 3);
  });
});

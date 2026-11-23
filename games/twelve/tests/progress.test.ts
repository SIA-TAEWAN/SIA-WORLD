import { describe, expect, it } from 'vitest';
import { BOSSES } from '../src/data/bosses';
import { ENEMIES } from '../src/data/enemies';
import { MAX_LEVEL, addExp, expNeed, expPenalty } from '../src/data/growth';
import { mapKillMax, mapOf } from '../src/data/maps';
import { mapLevel, mapScale } from '../src/data/regions';
import {
  LIMITS,
  applyReport,
  checkReport,
  checkStart,
  cleared,
  continueMap,
  emptyProfile,
  heroesOf,
  loadoutOf,
  mapOpen,
  recommended,
  regionOpen,
  regionReady,
  regionStarCount,
  rewardOf,
  setHero,
  weaponOf,
  type RunReport,
} from '../src/game/progress';
import { STAR_CHEST, STAR_NO_DEATH, STAR_TIME, chestCoins, createRun } from '../src/game/sim';
import { ApiError, createLocalApi, normalize, type Store } from '../src/net/api';
import { autoplay } from './bot';

const report = (map: string, over: Partial<RunReport> = {}): RunReport => {
  const m = mapOf(map)!;
  const max = mapKillMax(m, over.mode ?? 'normal');
  return { run: 'r', map, mode: 'normal', hero: 'rat', time: 100, cleared: true, kills: { ...max.kinds }, elites: max.elites, boss: !!m.boss, chest: true, deaths: 0, ...over };
};

const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('경험치', () => {
  it('레벨이 오르고 99에서 멈춘다', () => {
    expect(addExp(1, 0, expNeed(1) - 1)).toEqual({ level: 1, exp: expNeed(1) - 1, ups: 0 });
    expect(addExp(1, 0, expNeed(1) + expNeed(2) + 5)).toEqual({ level: 3, exp: 5, ups: 2 });
    expect(addExp(98, 0, 1e9)).toEqual({ level: MAX_LEVEL, exp: 0, ups: 1 });
    expect(expNeed(MAX_LEVEL)).toBe(0);
    for (let l = 2; l < MAX_LEVEL; l++) expect(expNeed(l)).toBeGreaterThan(expNeed(l - 1));
  });

  it('내 레벨이 맵보다 10 이상 높으면 경험치가 크게 준다', () => {
    expect(expPenalty(5, 1)).toBe(1);
    expect(expPenalty(11, 1)).toBeLessThanOrEqual(0.25);
    expect(expPenalty(30, 1)).toBeLessThan(expPenalty(11, 1));
  });
});

describe('맵 열림', () => {
  it('처음엔 1-1 만 열려 있고, 깨면 다음 맵이 열린다', () => {
    const p = emptyProfile();
    expect(mapOpen(p, '1-1')).toBe(true);
    expect(mapOpen(p, '1-2')).toBe(false);
    expect(continueMap(p)).toBe('1-1');
    applyReport(p, report('1-1'));
    expect(cleared(p, '1-1')).toBe(true);
    expect(mapOpen(p, '1-2')).toBe(true);
    expect(mapOpen(p, '1-3')).toBe(false);
    expect(continueMap(p)).toBe('1-2');
  });

  it('2지형부터와 어려움 모드는 준비 중', () => {
    const p = emptyProfile();
    for (let n = 1; n <= 8; n++) applyReport(p, report(`1-${n}`));
    expect(regionOpen(p, 2)).toBe(true);
    expect(regionReady(1)).toBe(true);
    expect(regionReady(2)).toBe(false);
    expect(mapOpen(p, '2-1')).toBe(false);
    expect(mapOpen(p, '1-1', 'hard')).toBe(false);
    expect(continueMap(p)).toBe('1-8');
    expect(checkStart(p, '2-1', 'normal', 'rat')).toBe('bad map');
    expect(checkStart(p, '1-1', 'hard', 'rat')).toBe('map locked');
  });

  it('어려움 모드는 진행과 별을 따로 센다', () => {
    const p = emptyProfile();
    applyReport(p, report('1-1', { mode: 'hard' }));
    expect(cleared(p, '1-1', 'hard')).toBe(true);
    expect(cleared(p, '1-1', 'normal')).toBe(false);
    expect(regionStarCount(p, 1, 'hard')).toBe(3);
    expect(regionStarCount(p, 1, 'normal')).toBe(0);
  });
});

describe('결과 적기', () => {
  it('깨면 경험치·엽전을 맵 표로 계산해서 준다', () => {
    const p = emptyProfile();
    const m = mapOf('1-1')!;
    const n = mapKillMax(m, 'normal').kinds.imp!;
    const r = applyReport(p, report('1-1'));
    expect(r.exp).toBe(n * ENEMIES.imp.exp);
    expect(r.coins).toBe(n * ENEMIES.imp.coin + chestCoins(1));
    expect(r.first).toBe(true);
    expect(r.ups).toBeGreaterThan(0);
    expect(p.coins).toBe(r.coins);
    expect(p.level).toBe(r.level);
  });

  it('쓰러지면 경험치는 남고 엽전은 잃는다. 맵 기록은 그대로', () => {
    const p = emptyProfile();
    const r = applyReport(p, report('1-1', { cleared: false, kills: { imp: 5 }, chest: true }));
    expect(r.exp).toBe(5 * ENEMIES.imp.exp);
    expect(r.coins).toBe(0);
    expect(r.stars).toBe(0);
    expect(p.coins).toBe(0);
    expect(cleared(p, '1-1')).toBe(false);
  });

  it('별 3개는 따로따로 모을 수 있다', () => {
    const p = emptyProfile();
    const par = mapOf('1-1')!.par;
    let r = applyReport(p, report('1-1', { time: par + 50, deaths: 1, chest: false }));
    expect(r.stars).toBe(0);
    r = applyReport(p, report('1-1', { time: par, deaths: 2, chest: false }));
    expect([r.stars, r.newStars]).toEqual([STAR_TIME, STAR_TIME]);
    r = applyReport(p, report('1-1', { time: par + 50, deaths: 0, chest: true }));
    expect(r.newStars).toBe(STAR_NO_DEATH | STAR_CHEST);
    expect(r.first).toBe(false);
    expect(regionStarCount(p, 1)).toBe(3);
    expect(p.maps.normal['1-1']).toEqual({ stars: 7, clears: 3, best: par });
  });

  it('보스·정예·상자 보상', () => {
    const m = mapOf('1-8')!;
    const sc = mapScale(1, 8, 'normal');
    const base = rewardOf('1-8', 'normal', { kills: {}, elites: 0, boss: false, chest: false });
    expect(base).toEqual({ exp: 0, coins: 0 });
    const boss = rewardOf('1-8', 'normal', { kills: {}, elites: 0, boss: true, chest: false });
    expect(boss.exp).toBe(Math.round(BOSSES.bigDokkaebi.exp * sc.reward));
    const elite = rewardOf('1-8', 'normal', { kills: {}, elites: 5, boss: false, chest: false });
    const kind = m.groups.find((g) => g.elite)!.elite!;
    expect(elite.exp).toBe(Math.round(ENEMIES[kind].exp * 6 * sc.reward)); // 최대치(1)를 넘는 수는 잘라 낸다
    expect(rewardOf('1-8', 'normal', { kills: {}, elites: 0, boss: false, chest: true }).coins).toBe(chestCoins(sc.reward));
  });

  it('화면에 보이던 경험치·엽전과 저장되는 값이 같다 (자동 조종으로 한 판)', () => {
    for (const id of ['1-3', '1-8']) {
      const p = emptyProfile();
      p.level = mapLevel(1, Number(id[2]), 'normal');
      const s = createRun(mapOf(id)!, 'normal', loadoutOf(p), { seed: 4, god: true });
      autoplay(s, 1500, { chest: true });
      expect(s.phase).toBe('clear');
      const rep: RunReport = { run: 'r', map: id, mode: 'normal', hero: 'rat', time: Math.floor(s.t), cleared: true, kills: s.kills, elites: s.eliteKills, boss: s.bossDead, chest: s.chest, deaths: 0 };
      expect(checkReport(rep)).toBeNull();
      expect(rewardOf(id, 'normal', rep)).toEqual({ exp: s.exp, coins: s.coins });
    }
  });

  it('받을 수 없는 결과', () => {
    const max = mapKillMax(mapOf('1-1')!, 'normal');
    expect(checkReport(report('1-1'))).toBeNull();
    expect(checkReport({ ...report('1-1'), map: '9-9' })).toBe('bad map');
    expect(checkReport(report('1-1', { kills: { imp: max.kinds.imp! + 1 } }))).toBe('bad kills');
    expect(checkReport(report('1-1', { kills: { club: 1 } }))).toBe('bad kills');
    expect(checkReport(report('1-1', { elites: 1 }))).toBe('bad kills');
    expect(checkReport(report('1-1', { boss: true }))).toBe('bad kills');
    expect(checkReport(report('1-1', { time: LIMITS.clearMinTime - 1 }))).toBe('too early');
    expect(checkReport(report('1-1', { time: LIMITS.maxTime + 1 }))).toBe('bad time');
    expect(checkReport(report('1-8', { boss: false }))).toBe('bad result');
    expect(checkReport(report('1-8', { boss: false, cleared: false }))).toBeNull();
  });
});

describe('대원', () => {
  it('처음엔 3종, 1지형 보스를 처음 잡으면 토끼가 합류한다', () => {
    const p = emptyProfile();
    expect(heroesOf(p)).toEqual(['rat', 'ox', 'tiger']);
    expect(checkStart(p, '1-1', 'normal', 'rabbit')).toBe('hero locked');
    expect(checkStart(p, '1-1', 'normal', 'cat')).toBe('hero locked');
    for (let n = 1; n <= 7; n++) expect(applyReport(p, report(`1-${n}`)).joined).toBeNull();
    expect(applyReport(p, report('1-8')).joined).toBe('rabbit');
    expect(applyReport(p, report('1-8')).joined).toBeNull();
    expect(heroesOf(p)).toEqual(['rat', 'ox', 'tiger', 'rabbit']);
  });

  it('대표 대원 바꾸기 · 무기는 착용한 장비가 정한다', () => {
    const p = emptyProfile();
    expect(setHero(p, 'tiger')).toBeNull();
    expect(p.hero).toBe('tiger');
    expect(setHero(p, 'dragon')).toBe('hero locked');
    expect(setHero(p, 'lion')).toBe('bad hero');
    expect(setHero(p, 'cat')).toBe('hero locked');
    expect(setHero(p, 'cat', true)).toBeNull();
    expect(weaponOf(p)).toBe('sword');
    expect(loadoutOf(p).hero).toBe('cat');
  });

  it('추천 대원: 고향 대원 + 환경을 막는 대원', () => {
    expect(recommended(1)).toEqual(['rat', 'ox']);
    for (let r = 1; r <= 12; r++) expect(recommended(r).length).toBeGreaterThan(0);
  });
});

describe('기기 저장 (?local=1)', () => {
  it('시작 → 결과 → 다시 불러오기', async () => {
    const store = memStore();
    const api = createLocalApi(store);
    expect(await api.loadProfile()).toEqual(emptyProfile());
    const st = await api.start('1-1', 'normal', 'rat');
    expect(st.run).toMatch(/^local-/);
    expect(st.seed).toBeGreaterThanOrEqual(0);
    await expect(api.start('1-2', 'normal', 'rat')).rejects.toBeInstanceOf(ApiError);
    const out = await api.finish(report('1-1', { run: st.run }));
    expect(out!.result.first).toBe(true);
    const again = await createLocalApi(store).loadProfile();
    expect(again).toEqual(out!.profile);
    expect(again.maps.normal['1-1'].clears).toBe(1);
    await expect(api.finish(report('1-1', { time: 1 }))).rejects.toThrow('too early');
    expect((await api.setHero('ox')).hero).toBe('ox');
  });

  it('깨진 저장 값은 기본값으로', () => {
    expect(normalize(null)).toEqual(emptyProfile());
    expect(normalize({ level: 500, exp: -3, coins: 'x', hero: 'lion', mode: 'easy', maps: { normal: { '1-1': { stars: 99, clears: 2, best: 30 }, '1-2': { clears: 0 } } } })).toEqual({
      ...emptyProfile(),
      level: 99,
      maps: { normal: { '1-1': { stars: 3, clears: 2, best: 30 } }, hard: {} },
    });
  });
});

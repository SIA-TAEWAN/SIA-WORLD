import { describe, expect, it } from 'vitest';
import { COINS, STAR2_LIVES } from '../src/data/balance';
import { stageOf } from '../src/data/stages';
import { applyRun, cleanProfile, defaultProfile, endlessOpen, partialCoins, regionCleared, regionOpen, regionStars, stageOpen, starsOf, totalStars, type RunReport } from '../src/game/progress';
import { createLocalApi, type Store } from '../src/net/api';

const report = (stage: string, lives: number, over: Partial<RunReport> = {}): RunReport => ({ stage, cleared: lives > 0, lives, startLives: 20, time: 185, kills: 100, ...over });

describe('별 평가', () => {
  it('★ 클리어 · ★★ 생명 10 이상 · ★★★ 생명을 하나도 잃지 않음', () => {
    expect(starsOf(true, 20, 20)).toBe(3);
    expect(starsOf(true, 19, 20)).toBe(2);
    expect(starsOf(true, STAR2_LIVES, 20)).toBe(2);
    expect(starsOf(true, STAR2_LIVES - 1, 20)).toBe(1);
    expect(starsOf(true, 1, 20)).toBe(1);
    expect(starsOf(false, 0, 20)).toBe(0);
    expect(starsOf(false, 12, 20)).toBe(0); // 포기
  });
});

describe('잠금', () => {
  it('앞 스테이지를 클리어하면 다음 스테이지가 열린다', () => {
    let p = defaultProfile();
    expect(stageOpen(p, stageOf('1-1')!)).toBe(true);
    expect(stageOpen(p, stageOf('1-2')!)).toBe(false);
    const out = applyRun(p, report('1-1', 12));
    p = out.profile;
    expect(out.result.opened).toBe('1-2');
    expect(stageOpen(p, stageOf('1-2')!)).toBe(true);
    expect(stageOpen(p, stageOf('1-3')!)).toBe(false);
    // 실패한 판으로는 열리지 않는다
    expect(applyRun(p, report('1-2', 0)).result.opened).toBeNull();
    expect(() => applyRun(p, report('1-3', 20))).toThrow('stage locked');
    expect(() => applyRun(p, report('9-9', 20))).toThrow('no stage');
  });

  it('다음 지역은 앞 지역 보스 클리어 + 필요 별, 끝없는 모드는 1지역 클리어', () => {
    const p = defaultProfile();
    expect(regionOpen(p, 1)).toBe(true);
    expect(regionOpen(p, 2)).toBe(false);
    expect(endlessOpen(p)).toBe(false);
    for (const id of ['1-1', '1-2', '1-3', '1-4']) p.stages[id] = 1;
    expect(regionCleared(p, 1)).toBe(false);
    p.stages['1-5'] = 1;
    expect(regionCleared(p, 1)).toBe(true);
    expect(endlessOpen(p)).toBe(true);
    // 별이 5개뿐이라 2지역(별 9개)은 아직 잠겨 있다
    expect(totalStars(p)).toBe(5);
    expect(regionOpen(p, 2)).toBe(false);
    p.stages['1-1'] = 3;
    p.stages['1-2'] = 3;
    expect(regionStars(p, 1)).toBe(9);
    expect(regionOpen(p, 2)).toBe(true);
  });
});

describe('엽전', () => {
  const st = stageOf('1-1')!;
  it('첫 클리어: 클리어 보상 + 첫 클리어 보상 + 딴 별만큼', () => {
    const { profile, result } = applyRun(defaultProfile(), report('1-1', 14));
    expect(result).toMatchObject({ stars: 2, bestStars: 2, newStars: 2, firstClear: true, baseCoins: st.coins, firstCoins: st.firstCoins, starCoins: 2 * COINS.perStar });
    expect(result.coins).toBe(st.coins + st.firstCoins + 2 * COINS.perStar);
    expect(profile.coins).toBe(result.coins);
    expect(profile.stages['1-1']).toBe(2);
  });
  it('다시 클리어: 클리어 보상만. 별을 더 따면 새 별만큼 더, 덜 따도 기록은 줄지 않는다', () => {
    let p = applyRun(defaultProfile(), report('1-1', 14)).profile;
    const worse = applyRun(p, report('1-1', 3));
    expect(worse.result).toMatchObject({ stars: 1, bestStars: 2, newStars: 0, firstClear: false, coins: st.coins });
    expect(worse.profile.stages['1-1']).toBe(2);
    p = worse.profile;
    const better = applyRun(p, report('1-1', 20));
    expect(better.result).toMatchObject({ stars: 3, bestStars: 3, newStars: 1, coins: st.coins + COINS.perStar });
    expect(better.profile.stages['1-1']).toBe(3);
  });
  it('실패·포기: 끝낸 웨이브만큼 일부만 받는다', () => {
    expect(partialCoins(st, 20)).toBe(0);
    expect(partialCoins(st, 95)).toBe(Math.floor(st.coins * COINS.failRate * (3 / 6)));
    expect(partialCoins(st, 999)).toBe(Math.floor(st.coins * COINS.failRate));
    const out = applyRun(defaultProfile(), report('1-1', 0, { time: 95 }));
    expect(out.result).toMatchObject({ stars: 0, firstClear: false, coins: partialCoins(st, 95) });
    expect(out.profile.stages['1-1']).toBeUndefined();
    // 포기: 생명이 남아 있어도 클리어가 아니다
    expect(applyRun(defaultProfile(), report('1-1', 15, { cleared: false, time: 40 })).result.stars).toBe(0);
  });
});

describe('기기 저장', () => {
  const store = (): Store & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };
  it('판 결과를 저장하고 다시 읽는다', async () => {
    const st = store();
    const api = createLocalApi(st, 'k');
    expect(await api.loadProfile()).toEqual(defaultProfile());
    const out = await api.finish(report('1-1', 20));
    expect(out.result.stars).toBe(3);
    const again = createLocalApi(st, 'k');
    expect(await again.loadProfile()).toEqual(out.profile);
    // 계정마다 따로 저장된다
    expect(await createLocalApi(st, 'other').loadProfile()).toEqual(defaultProfile());
    await expect(api.finish(report('1-4', 20))).rejects.toThrow('stage locked');
  });
  it('망가진 저장 값은 믿을 수 있는 모양으로 고친다', async () => {
    expect(cleanProfile(null)).toEqual(defaultProfile());
    expect(cleanProfile({ coins: -5, stages: { '1-1': 9, 'x-y': 3, '1-2': 0 } })).toEqual({ coins: 0, stages: { '1-1': 3 } });
    const st = store();
    st.setItem('k', '{broken');
    expect(await createLocalApi(st, 'k').loadProfile()).toEqual(defaultProfile());
  });
});

import { describe, expect, it } from 'vitest';
import { COINS, STAR2_LIVES } from '../src/data/balance';
import { CHAR_MAX_LV, LEVEL_COSTS, UPGRADES, levelMods, upgradeCost, upgradeMods } from '../src/data/growth';
import { ENDLESS_ID } from '../src/data/endless';
import { stageOf } from '../src/data/stages';
import {
  LIMITS, applyRun, buyUpgrade, charLevel, cleanProfile, defaultProfile, endlessOpen, isValid, levelUp, partialCoins, regionCleared, regionOpen, regionStars,
  endlessCoins, mergeCodex, rejectReason, squadOk, stageOpen, starsOf, totalStars, waveOf, type DefenseProfile, type RunReport,
} from '../src/game/progress';
import { createGame, command, sellValue } from '../src/game/sim';
import { ApiError, createLocalApi, createSupabaseApi, type RpcClient, type Store } from '../src/net/api';
import { readPending } from '../src/net/pending';
import { T } from './helpers';

const report = (stage: string, lives: number, over: Partial<RunReport> = {}): RunReport => ({
  run: 'r', stage, cleared: lives > 0, lives, startLives: 20, time: 185, kills: 100, placed: 6, cmds: 12, bonus: 0, codex: { enemies: [], bosses: [] }, ...over,
});
const store = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('별 평가', () => {
  it('★ 클리어 · ★★ 생명 10 이상 · ★★★ 생명을 하나도 잃지 않음', () => {
    expect(starsOf(true, 20, 20)).toBe(3);
    expect(starsOf(true, 19, 20)).toBe(2);
    expect(starsOf(true, STAR2_LIVES, 20)).toBe(2);
    expect(starsOf(true, STAR2_LIVES - 1, 20)).toBe(1);
    expect(starsOf(true, 1, 20)).toBe(1);
    expect(starsOf(false, 0, 20)).toBe(0);
    expect(starsOf(false, 12, 20)).toBe(0); // 포기
    // 시작 생명 강화: 22로 시작했으면 22를 지켜야 별 3개
    expect(starsOf(true, 21, 22)).toBe(2);
    expect(starsOf(true, 22, 22)).toBe(3);
  });
});

describe('잠금과 해금', () => {
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
    expect(() => applyRun(p, report('99-9', 20))).toThrow('bad stage');
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

  it('지역의 보스 스테이지를 처음 클리어하면 그 지역의 캐릭터가 해금된다 (1지역 → 용)', () => {
    let p = defaultProfile();
    // 고양이는 스테이지와 상관없이 (지금은 모두에게) 함께한다
    expect(p.unlocked).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'cat']);
    for (const id of ['1-1', '1-2', '1-3', '1-4']) p = applyRun(p, report(id, 15)).profile;
    expect(p.unlocked).not.toContain('dragon');
    // 실패한 판으로는 해금되지 않는다
    expect(applyRun(p, report('1-5', 0)).result.unlocked).toEqual([]);
    const out = applyRun(p, report('1-5', 11));
    expect(out.result.unlocked).toEqual(['dragon']);
    expect(out.profile.unlocked).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'cat']);
    // 다시 클리어해도 또 해금되지는 않는다
    expect(applyRun(out.profile, report('1-5', 20)).result.unlocked).toEqual([]);
    expect(squadOk(out.profile, ['rat', 'dragon'])).toBe(true);
    expect(squadOk(p, ['rat', 'dragon'])).toBe(false);
    expect(squadOk(p, ['rat', 'cat'])).toBe(true);
    expect(squadOk(p, ['rat', 'rat'])).toBe(false);
    expect(squadOk(p, [])).toBe(false);
  });
});

describe('엽전', () => {
  const st = stageOf('1-1')!;
  it('첫 클리어: 클리어 보상 + 첫 클리어 보상 + 딴 별만큼', () => {
    const { profile, result } = applyRun(defaultProfile(), report('1-1', 14));
    expect(result).toMatchObject({ stars: 2, bestStars: 2, newStars: 2, firstClear: true, baseCoins: st.coins, firstCoins: st.firstCoins, starCoins: 2 * COINS.perStar, valid: true });
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
  it('실패·포기: 끝낸 웨이브만큼 일부만 받는다 (클리어 보상 × 끝낸 웨이브 ÷ 15)', () => {
    expect(partialCoins(st, 20)).toBe(0);
    expect(partialCoins(st, 95)).toBe(Math.floor((st.coins * 3) / 15));
    expect(partialCoins(st, 999)).toBe(Math.floor((st.coins * 6) / 15));
    const out = applyRun(defaultProfile(), report('1-1', 0, { time: 95 }));
    expect(out.result).toMatchObject({ stars: 0, firstClear: false, coins: partialCoins(st, 95) });
    expect(out.profile.stages['1-1']).toBeUndefined();
    // 포기: 생명이 남아 있어도 클리어가 아니다
    expect(applyRun(defaultProfile(), report('1-1', 15, { cleared: false, time: 40 })).result.stars).toBe(0);
  });
  it('엽전 획득 강화는 받는 엽전을 5%씩 늘리고, 돼지의 엽전은 돼지를 데려간 판에서만 상한까지', () => {
    const p = { ...defaultProfile(), upgrades: { coin: 2 } };
    expect(applyRun(p, report('1-1', 20)).result.coins).toBe(Math.floor(((st.coins + st.firstCoins + 60) * 110) / 100));
    expect(applyRun(defaultProfile(), report('1-1', 20, { bonus: 99 })).result.coins).toBe(st.coins + st.firstCoins + 60);
    expect(applyRun(defaultProfile(), report('1-1', 20, { bonus: 99 }), ['rat', 'pig']).result.coins).toBe(st.coins + st.firstCoins + 60 + LIMITS.bonus_max);
  });
  it('너무 짧은 판·비정상 판은 아무것도 받지 못한다', () => {
    const short = applyRun(defaultProfile(), report('1-1', 0, { time: 19 }));
    expect(short.result).toMatchObject({ coins: 0, stars: 0, valid: true });
    const cheat = report('1-1', 20, { kills: LIMITS.kills_base + 185 * LIMITS.kills_per_sec + 1 });
    expect(isValid(cheat)).toBe(false);
    const out = applyRun(defaultProfile(), cheat);
    expect(out.result).toMatchObject({ coins: 0, stars: 0, valid: false });
    expect(out.profile).toEqual(defaultProfile());
  });
});

describe('판 검증', () => {
  it('2배속보다 빨리 끝난 판은 받지 않는다 (여유 15초)', () => {
    const r = report('1-1', 20, { time: 200 });
    expect(rejectReason(r, 200 / 2 - 15, 20)).toBeNull();
    expect(rejectReason(r, 200 / 2 - 15.5, 20)).toBe('too early');
    expect(rejectReason(r, LIMITS.max_age + 1, 20)).toBe('too late');
  });
  it('있을 수 없는 값은 거절한다', () => {
    const ok = (over: Partial<RunReport>) => rejectReason(report('1-1', 20, over), 9999, 20);
    expect(ok({})).toBeNull();
    expect(ok({ time: 901 })).toBe('bad time');
    expect(ok({ time: -1 })).toBe('bad time');
    expect(ok({ lives: 21 })).toBe('bad result');
    expect(ok({ kills: -1 })).toBe('bad result');
    expect(ok({ time: 1.5 })).toBe('bad result');
    // 클리어는 3분을 채우고, 생명이 남고, 캐릭터를 하나 이상 놓은 판에서만
    expect(ok({ time: 179 })).toBe('bad result');
    expect(ok({ lives: 0, cleared: true })).toBe('bad result');
    expect(ok({ placed: 0 })).toBe('bad result');
    expect(ok({ cmds: 1, placed: 1 })).toBe('bad result');
    expect(ok({ placed: 13, cmds: 12 })).toBe('bad result');
    expect(ok({ cmds: LIMITS.cmds_max + 1 })).toBe('bad result');
    // 포기한 판은 짧아도 된다
    expect(ok({ cleared: false, time: 30, lives: 20, placed: 0, cmds: 1 })).toBeNull();
  });
});

describe('캐릭터 레벨업 · 공통 강화', () => {
  it('레벨업: 정해진 비용을 내고 12레벨까지. 잠긴 캐릭터·엽전 부족은 거절', () => {
    let p = { ...defaultProfile(), coins: LEVEL_COSTS[0] + LEVEL_COSTS[1] };
    p = levelUp(p, 'rat');
    expect(p.coins).toBe(LEVEL_COSTS[1]);
    expect(charLevel(p, 'rat')).toBe(2);
    p = levelUp(p, 'rat');
    expect(p.coins).toBe(0);
    expect(() => levelUp(p, 'rat')).toThrow('not enough coins');
    expect(() => levelUp(p, 'dragon')).toThrow('character locked');
    expect(() => levelUp(p, 'lion')).toThrow('bad character');
    expect(charLevel(levelUp({ ...p, coins: 1e6 }, 'cat'), 'cat')).toBe(2);
    p = { ...p, coins: 1e6 };
    for (let i = 3; i < CHAR_MAX_LV; i++) p = levelUp(p, 'rat');
    expect(charLevel(p, 'rat')).toBe(12);
    expect(1e6 - p.coins).toBe(LEVEL_COSTS.slice(2).reduce((a, b) => a + b, 0));
    expect(() => levelUp(p, 'rat')).toThrow('max level');
    expect(LEVEL_COSTS).toHaveLength(CHAR_MAX_LV - 1);
    expect([...LEVEL_COSTS].sort((a, b) => a - b)).toEqual(LEVEL_COSTS);
  });
  it('공통 강화: PRD 7장 표 (시작 기운 +5% · 시작 생명 +1 · 기운 획득 +3% · 엽전 획득 +5% 최대 5, 되팔기 환급 +5% 최대 3)', () => {
    expect(UPGRADES.map((u) => [u.id, u.max])).toEqual([['energy', 5], ['lives', 5], ['gain', 5], ['coin', 5], ['sell', 3]]);
    const full = upgradeMods({ energy: 5, lives: 5, gain: 5, coin: 5, sell: 3 });
    expect(full.energy).toBeCloseTo(1.25);
    expect(full.lives).toBe(5);
    expect(full.gain).toBeCloseTo(1.15);
    expect(full.coinPct).toBe(25);
    expect(full.sell).toBeCloseTo(0.15);
    // 최대 레벨을 넘는 값은 최대까지만
    expect(upgradeMods({ sell: 9 }).sell).toBeCloseTo(0.15);
    let p = { ...defaultProfile(), coins: 1000 };
    p = buyUpgrade(p, 'sell');
    p = buyUpgrade(p, 'sell');
    expect(p.coins).toBe(1000 - upgradeCost('sell', 0)! - upgradeCost('sell', 1)!);
    p = buyUpgrade(p, 'sell');
    expect(() => buyUpgrade(p, 'sell')).toThrow('max level');
    expect(() => buyUpgrade(p, 'luck')).toThrow('bad upgrade');
    expect(() => buyUpgrade({ ...p, coins: 0 }, 'coin')).toThrow('not enough coins');
  });
  it('캐릭터 레벨: 레벨당 공격력 +4%, 4레벨 사거리 +5%, 8레벨 비용 -5%, 12레벨 공격 간격 -5%', () => {
    expect(levelMods(1)).toEqual({ dmg: 1, range: 1, cost: 1, every: 1 });
    expect(levelMods(4)).toMatchObject({ range: 1.05, cost: 1, every: 1 });
    expect(levelMods(4).dmg).toBeCloseTo(1.12);
    expect(levelMods(8)).toMatchObject({ range: 1.05, cost: 0.95, every: 1 });
    expect(levelMods(12)).toMatchObject({ range: 1.05, cost: 0.95, every: 0.95 });
    expect(levelMods(12).dmg).toBeCloseTo(1.44);
  });
  it('판에 적용된다: 레벨은 그 캐릭터의 수치에, 공통 강화는 시작 기운·생명·되팔기에', () => {
    const base = createGame({ seed: 1, stage: '1-1', squad: ['rat', 'tiger'] });
    const s = createGame({ seed: 1, stage: '1-1', squad: ['rat', 'tiger'], levels: { rat: 12 }, upgrades: { energy: 2, lives: 3, sell: 2, gain: 5 } });
    expect(s.lv[T.rat][0].dmg).toBeCloseTo(base.lv[T.rat][0].dmg * 1.44);
    expect(s.lv[T.rat][0].range).toBeCloseTo(base.lv[T.rat][0].range * 1.05);
    expect(s.lv[T.rat][0].every).toBeCloseTo(base.lv[T.rat][0].every * 0.95);
    expect(s.cost[T.rat]).toBe(Math.round(base.cost[T.rat] * 0.95));
    expect(s.lv[T.tiger]).toEqual(base.lv[T.tiger]);
    expect(s.cost[T.tiger]).toBe(base.cost[T.tiger]);
    expect(s.energy).toBe(Math.floor(base.energy * 1.1));
    expect(s.lives).toBe(base.lives + 3);
    expect(s.startLives).toBe(23);
    expect(s.gain).toBeCloseTo(1.15);
    command(s, 'place', 0, T.tiger);
    command(s, 'start');
    expect(sellValue(s, 0)).toBe(Math.floor(base.cost[T.tiger] * 0.8 + 1e-6));
  });
});

describe('기기 저장 (서버와 같은 규칙)', () => {
  it('판을 시작하고 끝내면 저장되고 다시 읽을 수 있다', async () => {
    const st = store();
    let now = 1_000_000;
    const api = createLocalApi(st, 'k', () => now);
    expect(await api.loadProfile()).toEqual(defaultProfile());
    const id = (await api.start('1-1', ['rat', 'tiger']))!.run;
    now += 200_000;
    const out = (await api.finish(report('1-1', 20, { run: id })))!;
    expect(out.result.stars).toBe(3);
    expect(await createLocalApi(st, 'k').loadProfile()).toEqual(out.profile);
    // 계정마다 따로 저장된다
    expect(await createLocalApi(st, 'other').loadProfile()).toEqual(defaultProfile());
    // 끝난 판은 다시 쓸 수 없고, 시작하지 않은 판은 없다
    await expect(api.finish(report('1-1', 20, { run: id }))).rejects.toThrow('already finished');
    await expect(api.finish(report('1-1', 20, { run: 'nope' }))).rejects.toThrow('no run');
  });
  it('잠긴 스테이지·잠긴 캐릭터·잘못된 명단으로는 시작할 수 없다', async () => {
    const api = createLocalApi(store(), 'k');
    await expect(api.start('1-4', ['rat'])).rejects.toThrow('stage locked');
    await expect(api.start('1-1', ['dragon'])).rejects.toThrow('character locked');
    await expect(api.start('1-1', [])).rejects.toThrow('bad squad');
    await expect(api.start('1-1', ['rat', 'rat'])).rejects.toThrow('bad squad');
    await expect(api.start('9-9', ['rat'])).rejects.toBeInstanceOf(ApiError);
  });
  it('너무 빨리 끝난 판과 겹치는 판은 받지 않는다. 보고한 스테이지가 아니라 시작한 스테이지로 저장한다', async () => {
    const st = store();
    let now = 5_000_000;
    const api = createLocalApi(st, 'k', () => now);
    const a = (await api.start('1-1', ['rat']))!.run;
    now += 50_000;
    await expect(api.finish(report('1-1', 20, { run: a, time: 200 }))).rejects.toThrow('too early');
    const b = (await api.start('1-1', ['rat']))!.run;
    now += 100_000;
    // a 는 150초 전에 시작했다: 200초 판(2배속 100초 − 여유 15초)으로 받아들여진다. 스테이지를 속여도 1-1 로 저장된다
    const out = (await api.finish(report('1-5', 20, { run: a, time: 200 })))!;
    expect(out.profile.stages).toEqual({ '1-1': 3 });
    // b 는 a 가 쓰던 시간에 시작했다
    await expect(api.finish(report('1-1', 20, { run: b, time: 200 }))).rejects.toThrow('overlap');
  });
  it('시작 생명 강화를 산 뒤에 시작한 판은 그 생명이 기준이다', async () => {
    const st = store();
    let now = 1e7;
    const api = createLocalApi(st, 'k', () => now);
    st.setItem('k', JSON.stringify({ profile: { ...defaultProfile(), upgrades: { lives: 2 } } }));
    const info = (await api.start('1-1', ['rat']))!;
    // 판 시작의 답에 판 설정이 함께 온다 (화면은 이 값으로 판을 만든다)
    expect(info).toMatchObject({ startLives: 22, upgrades: { lives: 2 }, levels: {} });
    expect(createGame({ seed: 1, stage: '1-1', squad: ['rat'], upgrades: info.upgrades, levels: info.levels, startLives: info.startLives }).startLives).toBe(22);
    now += 300_000;
    // 22로 시작해 20이 남았다: 별 2개 (보고에 적은 시작 생명 20 은 보지 않는다)
    const out = (await api.finish(report('1-1', 20, { run: info.run, startLives: 20 })))!;
    expect(out.result.stars).toBe(2);
  });
  it('판을 만들 때 시작 생명을 주면 그 값이 시작 생명이다 (서버가 적어 둔 값)', () => {
    const s = createGame({ seed: 1, stage: '1-1', squad: ['rat'], upgrades: {}, startLives: 24 });
    expect([s.lives, s.startLives]).toEqual([24, 24]);
    expect(createGame({ seed: 1, stage: '1-1', squad: ['rat'], upgrades: { lives: 3 } }).startLives).toBe(23);
  });
  it('망가진 저장 값은 믿을 수 있는 모양으로 고친다', async () => {
    expect(cleanProfile(null)).toEqual(defaultProfile());
    expect(cleanProfile({ coins: -5, stages: { '1-1': 9, 'x-y': 3, '1-2': 0 }, levels: { rat: 99, lion: 3, ox: 1, cat: 4 }, upgrades: { sell: 7, luck: 2 }, unlocked: ['dragon', 'lion'] })).toEqual({
      coins: 0, stages: { '1-1': 3 }, levels: { rat: 12, cat: 4 }, upgrades: { sell: 3 }, unlocked: ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'cat'],
      codex: { enemies: [], bosses: [] }, endless: null,
    });
    // 도감은 알려진 id 만, 끝없는 모드 기록은 웨이브 1 이상만
    expect(cleanProfile({ codex: { enemies: ['wisp', 'imp', 'cat'], bosses: 'x' }, endless: { wave: 7, squad: ['rat', 'cat', 'lion'] } })).toMatchObject({
      codex: { enemies: ['imp', 'wisp'], bosses: [] }, endless: { wave: 7, squad: ['rat', 'cat'] },
    });
    const st = store();
    st.setItem('k', '{broken');
    expect(await createLocalApi(st, 'k').loadProfile()).toEqual(defaultProfile());
  });
});

describe('서버 저장: 보관 후 재전송', () => {
  type Answer = { data: unknown; error: { code?: string; message?: string } | null };
  const fake = (answers: Record<string, () => Answer | Promise<Answer>>) => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const client: RpcClient = { rpc: (fn, args) => (calls.push({ fn, args }), Promise.resolve(answers[fn]())) };
    return { client, calls };
  };
  const okAnswer = (): Answer => ({ data: { profile: { coins: 160, stages: { '1-1': 3 } }, result: { stars: 3, bestStars: 3, newStars: 3, firstClear: true, coins: 160, baseCoins: 40, firstCoins: 60, starCoins: 60, unlocked: [], valid: true } }, error: null });

  it('성공하면 보관한 것을 지우고, 별은 남은 생명으로 계산해 보낸다', async () => {
    const st = store();
    const { client, calls } = fake({ defense_profile: () => ({ data: { coins: 0 }, error: null }), defense_finish: okAnswer });
    const api = createSupabaseApi(client, 'u1', st);
    await api.loadProfile();
    const out = (await api.finish(report('1-1', 20, { run: 'run-1' })))!;
    expect(out.result).toMatchObject({ stars: 3, coins: 160, opened: '1-2' });
    expect(readPending(st, 'u1')).toEqual([]);
    const sent = calls.find((c) => c.fn === 'defense_finish')!.args!;
    expect(sent).toMatchObject({ p_run: 'run-1', p_time: 185, p_cleared: true, p_lives: 20, p_stars: 3, p_kills: 100, p_placed: 6, p_cmds: 12, p_bonus: 0, p_codex: { enemies: [], bosses: [] } });
    // 엽전은 보내지 않는다 (서버가 계산한다)
    expect(Object.keys(sent).some((k) => /coin/.test(k))).toBe(false);
  });
  it('통신 실패·시간 초과·too early 는 보관해 두고, 다음에 다시 보낸다', async () => {
    const st = store();
    let mode: 'net' | 'early' | 'ok' = 'net';
    const { client } = fake({
      defense_finish: () => (mode === 'net' ? { data: null, error: { message: 'Failed to fetch' } } : mode === 'early' ? { data: null, error: { code: 'P0001', message: 'too early' } } : okAnswer()),
    });
    const api = createSupabaseApi(client, 'u1', st);
    const got: number[] = [];
    api.onProfile = (p) => got.push(p.coins);
    expect(await api.finish(report('1-1', 20, { run: 'run-1' }))).toBeNull();
    expect(readPending(st, 'u1')).toHaveLength(1);
    mode = 'early';
    expect(await api.resend()).toBe(0);
    expect(readPending(st, 'u1')).toHaveLength(1);
    mode = 'ok';
    expect(await api.resend()).toBe(1);
    expect(readPending(st, 'u1')).toEqual([]);
    expect(got).toEqual([160]);
  });
  it('서버가 거절(P0001)하면 보관하지 않는다', async () => {
    const st = store();
    const { client } = fake({ defense_finish: () => ({ data: null, error: { code: 'P0001', message: 'overlap' } }) });
    const api = createSupabaseApi(client, 'u1', st);
    await expect(api.finish(report('1-1', 20, { run: 'run-1' }))).rejects.toThrow('overlap');
    expect(readPending(st, 'u1')).toEqual([]);
  });
  it('답이 제한 시간 안에 오지 않으면 통신 실패로 본다. 판 시작을 알리지 못하면 null (기록되지 않는 판)', async () => {
    const st = store();
    const never = () => new Promise<Answer>(() => undefined);
    const { client, calls } = fake({ defense_finish: never, defense_start: never });
    const api = createSupabaseApi(client, 'u1', st, 40);
    expect(await api.finish(report('1-1', 20, { run: 'run-1' }))).toBeNull();
    expect(readPending(st, 'u1')).toHaveLength(1);
    expect(await api.start('1-1', ['rat'])).toBeNull();
    expect(calls.filter((c) => c.fn === 'defense_start')).toHaveLength(2);
  });
  it('판 시작의 답(jsonb)에서 판 id 와 판 설정을 읽는다. 060 앞의 답(판 id 글자)도 받는다', async () => {
    const { client } = fake({ defense_start: () => ({ data: { run: 'r-9', startLives: 23, upgrades: { lives: 3, luck: 9 }, levels: { rat: 4, cat: 2, lion: 5 } }, error: null }) });
    expect(await createSupabaseApi(client, 'u1', store()).start('1-1', ['rat'])).toEqual({ run: 'r-9', startLives: 23, upgrades: { lives: 3 }, levels: { rat: 4, cat: 2 } });
    const old = fake({ defense_start: () => ({ data: 'r-1', error: null }) });
    expect(await createSupabaseApi(old.client, 'u1', store()).start('1-1', ['rat'])).toEqual({ run: 'r-1' });
    const bad = fake({ defense_start: () => ({ data: { startLives: 20 }, error: null }) });
    expect(await createSupabaseApi(bad.client, 'u1', store(), 40).start('1-1', ['rat'])).toBeNull();
  });
  it('잠긴 스테이지로 시작하면 까닭을 알려 준다', async () => {
    const { client } = fake({ defense_start: () => ({ data: null, error: { code: 'P0001', message: 'stage locked' } }) });
    await expect(createSupabaseApi(client, 'u1', store()).start('1-4', ['rat'])).rejects.toThrow('stage locked');
  });
});

describe('끝없는 모드 (끝없는 고개)', () => {
  const cleared1 = (): DefenseProfile => ({ ...defaultProfile(), stages: { '1-1': 1, '1-2': 1, '1-3': 1, '1-4': 1, '1-5': 1 } });
  const erep = (time: number, over: Partial<RunReport> = {}): RunReport => report(ENDLESS_ID, 0, { cleared: false, time, kills: 400, ...over });

  it('1지역을 클리어해야 열리고, 도달 웨이브가 기록된다 (더 높을 때만 새 기록)', () => {
    expect(() => applyRun(defaultProfile(), erep(200), ['rat'], 'endless')).toThrow('endless locked');
    let p = cleared1();
    const a = applyRun(p, erep(275), ['rat', 'tiger'], 'endless');
    // 275초 = 웨이브 9개를 넘기고 10번째에서 끝났다
    expect(a.result).toMatchObject({ wave: 10, bestWave: 10, newRecord: true, stars: 0, firstClear: false, valid: true });
    expect(a.result.coins).toBe(9 * LIMITS.endless_coin_per_wave);
    expect(a.profile.endless).toEqual({ wave: 10, squad: ['rat', 'tiger'] });
    // 스테이지의 별·잠금에는 영향이 없다
    expect(a.profile.stages).toEqual(p.stages);
    p = a.profile;
    const b = applyRun(p, erep(100), ['ox'], 'endless');
    expect(b.result).toMatchObject({ wave: 4, bestWave: 10, newRecord: false });
    expect(b.profile.endless).toEqual({ wave: 10, squad: ['rat', 'tiger'] });
    // 같은 웨이브는 먼저 달성한 기록을 그대로 둔다
    expect(applyRun(p, erep(299), ['ox'], 'endless').result.newRecord).toBe(false);
  });

  it('엽전은 넘긴 웨이브마다, 한 판 상한까지. 도감은 만난 요괴·보스가 쌓인다', () => {
    expect(endlessCoins(29)).toBe(0);
    expect(endlessCoins(95)).toBe(3 * LIMITS.endless_coin_per_wave);
    expect(endlessCoins(3000)).toBe(LIMITS.endless_coin_cap);
    expect(waveOf(0)).toBe(1);
    expect(waveOf(95)).toBe(4);
    const out = applyRun(cleared1(), erep(3000, { kills: 5000, codex: { enemies: ['wisp', 'imp', 'nope'], bosses: ['bigDokkaebi'] } }), ['rat'], 'endless');
    expect(out.result.coins).toBe(LIMITS.endless_coin_cap);
    expect(out.profile.codex).toEqual({ enemies: ['imp', 'wisp'], bosses: ['bigDokkaebi'] });
    expect(mergeCodex(out.profile.codex, { enemies: ['club'], bosses: [] }).enemies).toEqual(['imp', 'wisp', 'club']);
  });

  it('클리어 보고·시간 상한 초과는 거절, 요괴를 거의 잡지 않고 버틴 것처럼 꾸민 판은 비정상', () => {
    expect(rejectReason(erep(300, { cleared: true, lives: 5 }), 9999, 20, 'endless')).toBe('bad result');
    expect(rejectReason(erep(LIMITS.endless_max_time + 1), 9999, 20, 'endless')).toBe('bad time');
    expect(rejectReason(erep(1000), 9999, 20, 'endless')).toBeNull();
    expect(rejectReason(erep(1000), 9999, 20, 'normal')).toBe('bad time');
    expect(rejectReason(erep(1000), 1000 / 2 - 16, 20, 'endless')).toBe('too early');
    // 웨이브 20 에 닿았는데 처치가 (20 − 4) × 5 보다 적다
    const lazy = erep(585, { kills: 79 });
    expect(isValid(lazy, 'endless')).toBe(false);
    expect(isValid(erep(585, { kills: 80 }), 'endless')).toBe(true);
    const out = applyRun(cleared1(), lazy, ['rat'], 'endless');
    expect(out.result).toMatchObject({ valid: false, coins: 0, wave: 0, newRecord: false });
    expect(out.profile.endless).toBeNull();
  });

  it('기기 저장: 끝없는 모드로 시작한 판은 끝없는 모드로 저장된다 (스테이지 id 를 속여도)', async () => {
    const st = store();
    let now = 1e8;
    st.setItem('k', JSON.stringify({ profile: cleared1() }));
    const api = createLocalApi(st, 'k', () => now);
    await expect(api.start('1-1', ['rat'], 'endless')).rejects.toThrow('bad stage');
    await expect(api.start(ENDLESS_ID, ['rat'])).rejects.toThrow('bad stage');
    const id = (await api.start(ENDLESS_ID, ['rat', 'ox'], 'endless'))!.run;
    now += 400_000;
    const out = (await api.finish(erep(400, { run: id, stage: '1-1' })))!;
    expect(out.result).toMatchObject({ wave: 14, newRecord: true });
    expect(out.profile.endless).toEqual({ wave: 14, squad: ['rat', 'ox'] });
    await expect(createLocalApi(store(), 'k').start(ENDLESS_ID, ['rat'], 'endless')).rejects.toThrow('endless locked');
  });
});

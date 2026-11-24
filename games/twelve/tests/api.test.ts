import { describe, expect, it } from 'vitest';
import { EXP_PENALTY, GROWTH_TARGETS, MAX_LEVEL, expNeed, expPenaltyPct } from '../src/data/growth';
import { mapLevel } from '../src/data/regions';
import { LIMITS, emptyProfile, type RunReport } from '../src/game/progress';
import { ApiError, createSupabaseApi, normalize, type RpcClient, type Store } from '../src/net/api';

const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
/** 서버 흉내: 부른 것을 적어 두고, 정해 둔 답을 준다 */
function fake(answers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const sb: RpcClient = {
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      try {
        return { data: answers[fn]?.(args) ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
  return { sb, calls };
}
const report = (over: Partial<RunReport> = {}): RunReport => ({ run: 'run-1', map: '1-1', mode: 'normal', hero: 'rat', time: 100.9, cleared: true, kills: { imp: 30 }, elites: 0, boss: false, chest: true, deaths: 0, potions: [[1, 0, 0], [0, 0, 0]], ...over });
/** 서버가 주는 기록 모양 (장비 id 는 글자) */
const serverState = (over: Record<string, unknown> = {}) => ({ ...emptyProfile(), ...over });

describe('성장 곡선', () => {
  it('레벨 1~99 경험치 표: 늘 오르고 99에서 끝난다', () => {
    for (let l = 1; l < MAX_LEVEL; l++) expect(expNeed(l)).toBeGreaterThan(0);
    expect(expNeed(MAX_LEVEL)).toBe(0);
  });

  it('맵 레벨 차이 보정: 10 이상 높으면 크게 줄고, 정수 %로 계산한다', () => {
    expect(expPenaltyPct(9, 1)).toBe(100);
    expect(expPenaltyPct(11, 1)).toBe(25);
    expect(expPenaltyPct(21, 1)).toBe(5);
    expect([...EXP_PENALTY].sort((a, b) => b.gap - a.gap)).toEqual([...EXP_PENALTY]);
  });

  it('목표 곡선(PRD 성장 표)의 도착 레벨이 그 구간 마지막 맵의 권장 레벨과 맞는다', () => {
    expect(GROWTH_TARGETS.map((t) => t.level)).toEqual([25, 45, 65, 82, 99]);
    expect(mapLevel(12, 8, 'normal')).toBe(65);
    expect(mapLevel(12, 8, 'hard')).toBe(99);
    expect(LIMITS.coinMinTime).toBe(60);
    expect(LIMITS.coinLevelGap).toBe(15);
  });
});

describe('서버 저장 (createSupabaseApi)', () => {
  it('내 상태 읽기 · 판 시작 · 판 끝', async () => {
    const { sb, calls } = fake({
      twelve_state: () => serverState({ level: 7, coins: 120 }),
      twelve_start: () => ({ run: 'run-1', seed: 4242 }),
      twelve_finish: () => ({
        state: serverState({ level: 8 }),
        result: { exp: 50, coins: 30, ups: 1, level: 8, stars: 7, newStars: 7, first: true, joined: 'rabbit', siaCoin: true, items: [{ id: 9, base: 'r-n1-1', box: true }], stones: 3, potions: [[1, 0, 0], [0, 0, 0]], key: true, starItem: null },
      }),
    });
    const api = createSupabaseApi(sb, 'u1', memStore());
    expect((await api.loadProfile()).level).toBe(7);
    expect(await api.start('1-1', 'normal', 'rat')).toEqual({ run: 'run-1', seed: 4242 });
    expect(calls[1]).toEqual(['twelve_start', { p_map: '1-1', p_mode: 'normal', p_hero: 'rat' }]);
    const out = await api.finish(report());
    // 화면은 잡은 수·시간·상자·쓰러진 횟수·쓴 물약만 보낸다 (경험치·엽전·드랍은 보내지 않는다)
    expect(calls[2]).toEqual(['twelve_finish', { p_run: 'run-1', p_report: { time: 100, cleared: true, kills: { imp: 30 }, elites: 0, boss: false, chest: true, deaths: 0, potions: [[1, 0, 0], [0, 0, 0]] } }]);
    expect(out!.profile.level).toBe(8);
    expect(out!.result).toMatchObject({ exp: 50, joined: 'rabbit', siaCoin: true, key: true, stones: 3, items: [{ id: '9', base: 'r-n1-1', plus: 0, lock: false, box: true }] });
  });

  it('서버가 거절하면 ApiError(까닭), 통신 실패면 기록되지 않는 판', async () => {
    const { sb } = fake({
      twelve_start: (a) => {
        throw new Error(a!.p_map === '1-2' ? 'map locked' : 'fetch failed');
      },
      twelve_buy: () => {
        throw new Error('P0001: not enough coins');
      },
      twelve_equip: () => {
        throw new Error('bad item');
      },
    });
    const api = createSupabaseApi(sb, 'u1', memStore());
    await expect(api.start('1-2', 'normal', 'rat')).rejects.toThrow('map locked');
    const st = await api.start('1-1', 'normal', 'rat');
    expect(st.run).toBe('');
    expect(await api.finish(report({ run: '' }))).toBeNull();
    await expect(api.buy('bag')).rejects.toBeInstanceOf(ApiError);
    await expect(api.buy('bag')).rejects.toThrow('not enough coins');
    await expect(api.equip('3')).rejects.toThrow('bad item');
  });

  it('못 보낸 결과는 보관했다가 다시 보낸다. 거절된 결과는 버린다', async () => {
    const store = memStore();
    let down = true;
    const { sb, calls } = fake({
      twelve_finish: (a) => {
        if (down) throw new Error('fetch failed');
        if (a!.p_run === 'run-2') throw new Error('already finished');
        return { state: serverState(), result: { exp: 1 } };
      },
      twelve_start: () => ({ run: 'run-9', seed: 1 }),
    });
    const api = createSupabaseApi(sb, 'u1', store);
    expect(await api.finish(report())).toBeNull();
    expect(await api.finish(report({ run: 'run-2' }))).toBeNull();
    expect(JSON.parse(store.getItem('siatwelve:pending:u1')!).length).toBe(2);
    down = false;
    // 새 판을 시작하기 전에 먼저 보낸다
    await api.start('1-1', 'normal', 'rat');
    expect(calls.filter((c) => c[0] === 'twelve_finish').length).toBe(4);
    expect(store.getItem('siatwelve:pending:u1')).toBeNull();
    expect(await api.resend()).toBe(0);
  });

  it('시작 전에 못 보낸 결과를 보냈으면 새 프로필을 함께 돌려준다 (없으면 돌려주지 않는다)', async () => {
    const store = memStore();
    let down = true;
    const { sb } = fake({
      twelve_finish: () => {
        if (down) throw new Error('fetch failed');
        return { state: serverState({ level: 9, maps: { normal: { '1-1': { stars: 3, clears: 1, best: 90 } }, hard: {} } }), result: { exp: 1 } };
      },
      twelve_start: () => ({ run: 'run-9', seed: 1 }),
    });
    const api = createSupabaseApi(sb, 'u1', store);
    expect(await api.finish(report())).toBeNull();
    down = false;
    const st = await api.start('1-2', 'normal', 'rat');
    expect(st.run).toBe('run-9');
    expect(st.profile?.level).toBe(9);
    expect(st.profile?.maps.normal['1-1']?.clears).toBe(1);
    // 보관된 결과가 없으면 프로필은 없다
    expect((await api.start('1-2', 'normal', 'rat')).profile).toBeUndefined();
  });

  it('다시 보낸 판을 서버가 이미 받아 두었으면(already finished) 시작할 때 기록을 새로 읽어 돌려준다', async () => {
    const store = memStore();
    let down = true;
    const { sb, calls } = fake({
      twelve_finish: () => {
        // 지난번에 서버에는 들어갔지만 답만 못 받았다
        throw new Error(down ? 'fetch failed' : 'already finished');
      },
      twelve_state: () => serverState({ level: 11 }),
      twelve_start: () => ({ run: 'run-9', seed: 1 }),
    });
    const api = createSupabaseApi(sb, 'u1', store);
    expect(await api.finish(report())).toBeNull();
    expect(api.pending()).toBe(1);
    down = false;
    const st = await api.start('1-2', 'normal', 'rat');
    expect(api.pending()).toBe(0);
    expect(calls.filter((c) => c[0] === 'twelve_state').length).toBe(1);
    expect(st.profile?.level).toBe(11);
    // 한 번 읽었으면 다음 시작에는 다시 읽지 않는다
    expect((await api.start('1-2', 'normal', 'rat')).profile).toBeUndefined();
    expect(calls.filter((c) => c[0] === 'twelve_state').length).toBe(1);
  });

  it('resend 는 이미 받은 판도 센다 (화면이 기록을 다시 읽게)', async () => {
    const store = memStore();
    let down = true;
    const { sb } = fake({
      twelve_finish: () => {
        throw new Error(down ? 'fetch failed' : 'already finished');
      },
    });
    const api = createSupabaseApi(sb, 'u1', store);
    expect(await api.finish(report())).toBeNull();
    down = false;
    expect(await api.resend()).toBe(1);
    expect(api.pending()).toBe(0);
  });

  it('최종보스맵 열쇠가 모자라면 need keys 로 거절한다', async () => {
    const { sb } = fake({
      twelve_start: () => {
        throw new Error('need keys');
      },
    });
    const api = createSupabaseApi(sb, 'u1', memStore());
    await expect(api.start('final', 'normal', 'rat')).rejects.toThrow('need keys');
    await expect(api.start('final', 'normal', 'rat')).rejects.toBeInstanceOf(ApiError);
  });

  it('상점·대장간·가방은 장비 번호를 숫자로 보낸다', async () => {
    const { sb, calls } = fake({});
    const api = createSupabaseApi(sb, 'u1', memStore());
    await api.sell(['3', '4']);
    await api.scrap(['5']);
    await api.enhance('6');
    await api.equip('7');
    await api.unequip('acc');
    await api.lock('8', true);
    await api.claim();
    await api.buy('potion:0:1', 5);
    await api.setHero('ox');
    expect(calls).toEqual([
      ['twelve_sell', { p_items: [3, 4] }],
      ['twelve_scrap', { p_items: [5] }],
      ['twelve_enhance', { p_item: 6 }],
      ['twelve_equip', { p_item: 7 }],
      ['twelve_unequip', { p_slot: 'acc' }],
      ['twelve_lock', { p_item: 8, p_on: true }],
      ['twelve_claim', { p_items: [] }],
      ['twelve_buy', { p_what: 'potion:0:1', p_n: 5 }],
      ['twelve_set_hero', { p_hero: 'ox' }],
    ]);
  });

  it('서버 기록을 프로필 모양으로: 보관함 장비는 착용에서 빠지고, 무기는 꼭 하나 든다', () => {
    const p = normalize({ items: [{ id: 11, base: 'w-bow-0', plus: 2, lock: true, box: false }, { id: 12, base: 'a-0', box: true }, { id: 13, base: 'zzz' }], eq: { weapon: null, armor: '12', acc: null }, bag: 48, potions: [[1, 2, 3], [4, 5, 99]], keys: { normal: [3, 1, 1, 99] }, pity: { normal: { 1: { elite: 5 }, 2: {} } }, codex: ['r-n1-1', 'nope'] });
    expect(p.items).toEqual([{ id: '11', base: 'w-bow-0', plus: 2, lock: true, box: false }, { id: '12', base: 'a-0', plus: 0, lock: false, box: true }]);
    expect(p.eq).toEqual({ weapon: '11', armor: null, acc: null });
    expect([p.bag, p.potions, p.keys.normal, p.pity.normal, p.codex]).toEqual([48, [[1, 2, 3], [4, 5, 20]], [1, 3], { 1: { elite: 5, boss: 0, key: 0 } }, ['r-n1-1']]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEVEL_TABLE, STAGE_REWARDS, UPGRADES, clearCoins, failCoins, levelCost, rewardOf, totalCoins } from '../src/data/growth';
import {
  applyResult,
  buyUpgrade,
  checkStart,
  emptyProfile,
  heroesOf,
  levelUp,
  minRunTime,
  normalize,
  regionOpen,
  snapshotOf,
  stageOpen,
  type FingerProfile,
} from '../src/game/progress';
import { ApiError, createLocalApi, createSupabaseApi, rejectOf, type ServerClient, type Store } from '../src/net/api';
import { buildConfig, createRun, type RunResult } from '../src/sim';
import { playLikeBrowser } from './helpers';

const result = (o: Partial<RunResult>): RunResult => ({
  cleared: true, ended: true, stars: 3, starFlags: [true, true, true], turns: 15, wave: 2, waves: 3, kills: 8, coins: 6, fallen: 0, extra: 0, steps: 1500, floors: 0, ...o,
});

/** 067_finger.sql 의 엽전 식을 그대로 옮긴 것 (SQL 표 줄을 파일에서 읽는다) */
const SQL = readFileSync(new URL('../../../supabase/migrations/067_finger.sql', import.meta.url), 'utf8');
const sqlStages = new Map(
  [...SQL.matchAll(/\('(\d+-\d)', (\d+), (\d), (\d+), (\d+), (\d+)\)/g)].map((m) => [m[1], { clear: +m[4], star: +m[5], first: +m[6] }]),
);
function sqlCoins(stage: string, r: RunResult, first: boolean, coinLv: number) {
  const st = sqlStages.get(stage)!;
  const raw = r.cleared ? st.clear + st.star * r.stars + (first ? st.first : 0) : Math.floor((st.clear * 3 * Math.min(r.wave, r.waves)) / (10.0 * r.waves));
  return Math.floor(((raw + Math.min(r.coins, 300)) * (100 + 5 * Math.min(5, Math.max(0, coinLv)))) / 100.0);
}

describe('엽전 (기기 규칙 = SQL 식)', () => {
  it('보상표: 60스테이지, 지역이 오를수록 · 보스 스테이지가 더 많이', () => {
    expect(STAGE_REWARDS.length).toBe(60);
    expect(sqlStages.size).toBe(60);
    expect(STAGE_REWARDS[0]).toEqual({ id: '1-1', region: 1, no: 1, clear: 28, star: 8, first: 45 });
    for (let r = 1; r < 12; r++) expect(rewardOf(r + 1, 1).clear).toBeGreaterThan(rewardOf(r, 1).clear);
    expect(rewardOf(3, 5).first).toBeGreaterThan(rewardOf(3, 4).first);
  });

  it('60스테이지 × 별 × 첫 클리어 × 엽전 강화 × 주운 엽전 · 실패 웨이브마다 같은 값', () => {
    for (const rw of STAGE_REWARDS)
      for (const coin of [0, 1, 3, 5])
        for (const picked of [0, 7, 999]) {
          for (const stars of [1, 2, 3]) {
            const p = emptyProfile();
            const r = result({ stars, coins: picked });
            const a = applyResult(p, rw.id, r, { coin });
            expect(a.coins, `${rw.id} ★${stars} 첫`).toBe(sqlCoins(rw.id, r, true, coin));
            expect(a.first).toBe(true);
            const b = applyResult(p, rw.id, r, { coin });
            expect(b.coins, `${rw.id} ★${stars}`).toBe(sqlCoins(rw.id, r, false, coin));
          }
          for (const wave of [0, 1, 2]) {
            const r = result({ cleared: false, stars: 0, wave, coins: picked });
            expect(applyResult(emptyProfile(), rw.id, r, { coin }).coins, `${rw.id} 실패 ${wave}`).toBe(sqlCoins(rw.id, r, false, coin));
          }
        }
  });

  it('식 확인: 1-1 별 3개 첫 클리어 + 주운 엽전 6 = 28 + 24 + 45 + 6, 실패는 간 만큼', () => {
    const rw = rewardOf(1, 1);
    expect(clearCoins(rw, 3)).toBe(52);
    expect(totalCoins(52 + 45, 6, {})).toBe(103);
    expect(totalCoins(100, 0, { coin: 5 })).toBe(125);
    expect(failCoins(rw, 0, 3)).toBe(0);
    expect(failCoins(rw, 2, 3)).toBe(5);
  });

  it('지역 보스를 깨면 대원 합류, 별은 높은 쪽만 남는다', () => {
    const p: FingerProfile = { ...emptyProfile(), stages: { '1-1': 3, '1-2': 3, '1-3': 3, '1-4': 3 } };
    const a = applyResult(p, '1-5', result({ stars: 2 }), {});
    expect(a.newHeroes).toEqual(['rabbit']);
    expect(a.best).toBe(true);
    const b = applyResult(p, '1-5', result({ stars: 1 }), {});
    expect(b).toMatchObject({ best: false, first: false, newHeroes: [] });
    expect(p.stages['1-5']).toBe(2);
  });
});

describe('열기 · 강화 · 레벨', () => {
  it('스테이지 · 지역 · 대원 열림 (돌격대와 같은 규칙)', () => {
    const p = emptyProfile();
    expect(stageOpen(p, '1-1')).toBe(true);
    expect(stageOpen(p, '1-2')).toBe(false);
    expect(heroesOf(p)).toEqual(['rat', 'ox', 'tiger']);
    for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5']) p.stages[id] = 1;
    expect(regionOpen(p, 2)).toBe(false); // 별 5개 < 9
    for (const id of ['1-1', '1-2', '1-3', '1-4', '1-5']) p.stages[id] = 2;
    expect(regionOpen(p, 2)).toBe(true);
    expect(heroesOf(p)).toContain('rabbit');
    expect(checkStart(p, '1-3', ['rabbit', 'rat'])).toBeNull();
    expect(checkStart(emptyProfile(), '1-2', ['rat'])).toBe('stage locked');
    expect(checkStart(emptyProfile(), '1-1', ['rabbit'])).toBe('hero locked');
    expect(checkStart(emptyProfile(), '1-1', ['rat', 'rat'])).toBe('bad party');
    expect(checkStart(emptyProfile(), '1-1', [])).toBe('bad party');
  });

  it('강화: 가격표대로 엽전이 줄고, 최대 · 모자람은 거절', () => {
    const p = { ...emptyProfile(), coins: 100000 };
    const hp = UPGRADES.find((u) => u.key === 'hp')!;
    let spent = 0;
    for (let i = 0; i < hp.max; i++) {
      spent += hp.base + hp.step * i;
      expect(buyUpgrade(p, 'hp')).toBeNull();
    }
    expect(p.coins).toBe(100000 - spent);
    expect(buyUpgrade(p, 'hp')).toBe('max level');
    expect(buyUpgrade(emptyProfile(), 'coin')).toBe('not enough coins');
  });

  it('대원 레벨: 1→30 가격표, 합류 안 한 대원 · 30 넘기 거절', () => {
    expect(LEVEL_TABLE[0]).toEqual([1, 30]);
    expect(LEVEL_TABLE[28]).toEqual([29, 450]);
    const total = LEVEL_TABLE.reduce((a, [, c]) => a + c, 0);
    expect(total).toBe(6960);
    const p = { ...emptyProfile(), coins: total };
    for (let lv = 1; lv < 30; lv++) expect(levelUp(p, 'ox')).toBeNull();
    expect(p.levels.ox).toBe(30);
    expect(p.coins).toBe(0);
    expect(levelUp(p, 'ox')).toBe('max level');
    expect(levelUp({ ...p, coins: 999 }, 'dog')).toBe('hero locked');
    expect(levelUp(emptyProfile(), 'rat')).toBe('not enough coins');
    expect(levelCost(10)).toBe(165);
  });

  it('스냅숏은 파티 대원 레벨과 강화만, 서버 프로필 모양을 읽는다', () => {
    const p = normalize({ coins: '120', stages: { '1-1': 3, '9-9': 2, '1-2': 0 }, upgrades: { hp: 2, coin: 99, x: 1 }, levels: { rat: 4, cat: 3 }, heroes: ['rat'] });
    expect(p).toEqual({ coins: 120, stages: { '1-1': 3 }, upgrades: { hp: 2, coin: 5 }, levels: { rat: 4 }, tower: null });
    expect(normalize({ tower: { floor: '12', turns: 40 } }).tower).toEqual({ floor: 12, turns: 40 });
    expect(normalize({ tower: { floor: 0, turns: 3 } }).tower).toBeNull();
    expect(snapshotOf(p, '1-1', ['ox', 'rat'])).toEqual({ stage: '1-1', mode: 'normal', party: ['ox', 'rat'], levels: { ox: 1, rat: 4 }, upgrades: { hp: 2, coin: 5 } });
  });

  it('판 최소 시간: 턴 수 × 0.4초 + 날아간 스텝 ÷ 120', () => {
    expect(minRunTime(15, 1200)).toBeCloseTo(16);
  });
});

const memStore = (): Store & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe('테스트 모드 저장 (?local=1)', () => {
  it('시작 → 실제 판의 조작 → 기기에서 다시 돌려 엽전 · 별, 레벨 올리기', async () => {
    const api = createLocalApi(memStore());
    await expect(api.start('1-2', ['rat'])).rejects.toThrow('stage locked');
    await expect(api.levelUp('rat')).rejects.toThrow('not enough coins');
    const run = await api.start('1-1', ['rat', 'ox', 'tiger']);
    const s = createRun(buildConfig({ stage: '1-1', party: ['rat', 'ox', 'tiger'] }));
    playLikeBrowser(s, { pilot: { coarse: 150, powers: [50, 100] } });
    const out = (await api.finish({ run, stage: '1-1', inputs: s.log }))!;
    expect(out.replay?.turns).toBe(s.turn);
    if (s.phase === 'clear') {
      expect(out.result.first).toBe(true);
      expect(out.profile.stages['1-1']).toBe(out.result.stars);
    }
    expect(out.result.coins).toBe(sqlCoins('1-1', out.replay!, s.phase === 'clear', 0));
    expect((await api.loadProfile()).coins).toBe(out.result.coins);
    await expect(api.finish({ run, stage: '1-1', inputs: s.log })).rejects.toThrow('no run');
    if (out.result.coins >= 30) expect((await api.levelUp('rat')).levels.rat).toBe(2);
  });
});

describe('서버 저장: 못 보낸 결과 보관 · 다시 보내기', () => {
  const PROFILE = { coins: 50, stages: { '1-1': 2 }, upgrades: {}, levels: {} };
  function fake() {
    const calls: { fn: string; args?: unknown }[] = [];
    let mode: 'ok' | 'down' | 'reject' | 'error500' = 'ok';
    const c: ServerClient = {
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (mode === 'down') throw new Error('Failed to fetch');
        if (fn === 'finger_start') return { data: 'run-1', error: null };
        return { data: PROFILE, error: null };
      },
      functions: {
        invoke: async (name, opts) => {
          calls.push({ fn: name, args: opts.body });
          if (mode === 'down') return { data: null, error: { message: 'Failed to send a request to the Edge Function' } };
          if (mode === 'error500') return { data: null, error: { message: 'non-2xx', context: { status: 500, json: async () => ({ error: 'server error' }) } } };
          if (mode === 'reject') return { data: null, error: { message: 'non-2xx', context: { status: 400, json: async () => ({ error: 'too early' }) } } };
          return { data: { profile: PROFILE, result: { coins: 9, stars: 2, first: false, best: false, siaCoin: true, newHeroes: [] }, replay: null }, error: null };
        },
      },
    };
    return { c, calls, set: (m: typeof mode) => (mode = m) };
  }
  const report = (run: string) => ({ run, stage: '1-1', inputs: [{ a: 2700, p: 50, s: 0 as const }] });

  it('통신 실패면 보관(5판까지)했다가 resend 로 보낸다', async () => {
    const f = fake();
    const store = memStore();
    const api = createSupabaseApi(f.c, 'u1', store);
    f.set('down');
    expect(await api.start('1-1', ['rat'])).toBe('');
    for (let i = 0; i < 7; i++) expect(await api.finish(report(`r${i}`))).toBeNull();
    expect(JSON.parse(store.map.get('siafinger:pending:u1')!).map((r: { run: string }) => r.run)).toEqual(['r2', 'r3', 'r4', 'r5', 'r6']);
    f.set('error500');
    expect(await api.resend()).toBe(0);
    expect(JSON.parse(store.map.get('siafinger:pending:u1')!).length).toBe(5);
    f.set('ok');
    expect(await api.resend()).toBe(5);
    expect(store.map.has('siafinger:pending:u1')).toBe(false);
    const sent = f.calls.filter((x) => x.fn === 'finger-finish').at(-1)!.args as { runId: string; inputs: unknown[] };
    // 규칙 판 번호가 없는(예전에 보관한) 판은 0 으로 보낸다 → 서버가 'old rules' 로 거절
    expect(sent).toEqual({ runId: 'r6', inputs: [{ a: 2700, p: 50, s: 0 }], rules: 0 });
    await api.finish({ ...report('r7'), rules: 7 });
    expect((f.calls.filter((x) => x.fn === 'finger-finish').at(-1)!.args as { rules: number }).rules).toBe(7);
  });

  it('서버가 거절하면(4xx) 보관하지 않고 까닭을 알린다', async () => {
    const f = fake();
    const store = memStore();
    const api = createSupabaseApi(f.c, 'u1', store);
    f.set('reject');
    await expect(api.finish(report('x'))).rejects.toThrow(ApiError);
    expect(store.map.has('siafinger:pending:u1')).toBe(false);
    f.set('ok');
    const out = await api.finish(report('y'));
    expect(out?.result.siaCoin).toBe(true);
    expect(out?.profile.stages).toEqual({ '1-1': 2 });
    expect(f.calls.find((x) => x.fn === 'finger_start')).toBeUndefined();
    expect(await api.start('1-1', ['rat', 'ox'])).toBe('run-1');
    expect(f.calls.find((x) => x.fn === 'finger_start')?.args).toEqual({ p_stage: '1-1', p_party: ['rat', 'ox'], p_mode: 'normal' });
  });

  it('거절 글자 고르기', () => {
    expect(rejectOf('P0001: stage locked')).toBe('stage locked');
    expect(rejectOf('bad party')).toBe('bad party');
    expect(rejectOf('Failed to fetch')).toBeNull();
  });
});

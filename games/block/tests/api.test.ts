import { describe, expect, it } from 'vitest';
import { ApiError, createLocalApi, createSupabaseApi, weekOf, type ServerClient, type Store } from '../src/net/api.ts';
import { botGame } from '../src/bot.ts';
import { BLOCK_RULES, newGame } from '../src/rules.ts';

const mem = (): Store & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) };
};

describe('주 (월요일 시작, 한국 시간)', () => {
  it('일요일 밤과 월요일 새벽', () => {
    expect(weekOf(Date.parse('2026-11-29T14:00:00Z'))).toBe('2026-11-23');   // 한국 일요일 23시
    expect(weekOf(Date.parse('2026-11-29T15:00:00Z'))).toBe('2026-11-30');   // 한국 월요일 0시
  });
});

describe('테스트 모드 기록', () => {
  it('끝난 판을 다시 돌려 최고 점수 · 시아코인을 정한다', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t, () => 42);
    const { run, seed } = await api.start();
    const { state, moves } = botGame(seed, newGame, 1);
    t = 600_000;
    const r = await api.finish({ run, seed, log: moves, score: state.score, rules: BLOCK_RULES });
    expect(r!.verified).toBe(true);
    expect(r!.best).toBe(state.score);
    expect(r!.newBest).toBe(true);
    expect((await api.state()).best).toBe(state.score);
    await expect(api.finish({ run, seed, log: moves, score: state.score, rules: BLOCK_RULES })).rejects.toThrow('no run');
  });
  it('너무 빨리 끝낸 판 · 점수가 다른 판', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t, () => 7);
    const a = await api.start();
    const g = botGame(a.seed, newGame, 1);
    t = 1000;
    await expect(api.finish({ ...a, log: g.moves, score: g.state.score, rules: BLOCK_RULES })).rejects.toThrow(ApiError);
    const b = await api.start();
    t = 2_000_000;
    const r = await api.finish({ ...b, log: g.moves, score: g.state.score + 1, rules: BLOCK_RULES });
    expect(r!.verified).toBe(false);
    expect(r!.best).toBe(0);
  });
});

describe('서버 제출', () => {
  const report = { run: '00000000-0000-0000-0000-000000000001', seed: 1, log: [[0, 0, 0]] as [number, number, number][], score: 1, rules: BLOCK_RULES };
  const client = (fn: () => Promise<{ data: unknown; error: { message: string; context?: { status?: number } } | null }>): ServerClient => ({
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: fn },
  });
  it('통신 실패면 보관했다가 다시 보낸다', async () => {
    const store = mem();
    let fail = true;
    const api = createSupabaseApi(client(async () => (fail ? { data: null, error: { message: 'fetch failed' } } : { data: { score: 1, verified: true, best: 1 }, error: null })), 'u', store);
    expect(await api.finish(report)).toBeNull();
    expect(store.m.get('siablock:pending:u')).toContain(report.run);
    fail = false;
    expect(await api.flush()).toBe(1);
    expect(store.m.has('siablock:pending:u')).toBe(false);
  });
  it('로그인이 만료(401)되면 버리지 않고 보관한다', async () => {
    const store = mem();
    const api = createSupabaseApi(client(async () => ({ data: null, error: { message: 'Invalid JWT', context: { status: 401 } } })), 'u', store);
    expect(await api.finish(report)).toBeNull();
    expect(store.m.get('siablock:pending:u')).toContain(report.run);
  });
  it('게이트웨이의 일시 4xx(429 등, 까닭 모름)는 버리지 않고 보관한다', async () => {
    const store = mem();
    const api = createSupabaseApi(client(async () => ({ data: null, error: { message: 'Too Many Requests', context: { status: 429 } } })), 'u', store);
    expect(await api.finish(report)).toBeNull();
    expect(store.m.get('siablock:pending:u')).toContain(report.run);
  });
  it('keep 은 보내기 전에 먼저 보관한다', () => {
    const store = mem();
    const api = createSupabaseApi(client(async () => ({ data: null, error: null })), 'u', store);
    api.keep(report);
    expect(store.m.get('siablock:pending:u')).toContain(report.run);
  });
  it('서버가 거절하면 버린다', async () => {
    const store = mem();
    const api = createSupabaseApi(client(async () => ({ data: null, error: { message: 'x', context: { status: 400, json: async () => ({ error: 'bad move' }) } } })), 'u', store);
    await expect(api.finish(report)).rejects.toThrow('bad move');
    expect(store.m.has('siablock:pending:u')).toBe(false);
  });
});

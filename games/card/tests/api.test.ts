/** 서버 연결 (src/net/api.ts): 막 끝 업로드 보관 · 다시 보내기 · 거절은 버리기 */
import { describe, expect, it } from 'vitest';
import { ApiError, createApi, friendly, normState, type ServerClient, type Store } from '../src/net/api';
import { RULES_VERSION, type Input } from '../src/game/rules';

function memStore(): Store & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
type Reply = { data?: unknown; status?: number; error?: string } | 'throw';
function fakeClient(replies: Reply[]) {
  const sent: { runId: string; log: Input[]; rules: number }[] = [];
  const c: ServerClient = {
    rpc: async (fn) => ({ data: fn === 'card_state' ? { runs: {}, heroes: { dog: { mastery: 2, best: 1, clears: 3 } }, clears: 3, today: '2026-11-26', dailyPlayed: true } : null, error: null }),
    functions: {
      invoke: async (_n, opts) => {
        sent.push(opts.body as never);
        const r = replies.shift() ?? { data: { result: { newCoins: 1 } } };
        if (r === 'throw') throw new Error('network');
        if (r.error) return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: r.status, json: async () => ({ error: r.error }) } } };
        return { data: r.data, error: null };
      },
    },
  };
  return { c, sent };
}
const log = (n: number): Input[] => Array.from({ length: n }, () => ({ t: 'end' }) as Input);

describe('업로드', () => {
  it('보내기 전에 보관하고, 성공하면 지운다 · 판 처음부터의 기록과 규칙 판본을 보낸다', async () => {
    const st = memStore();
    const { c, sent } = fakeClient([{ data: { result: { newCoins: 1, coins: 1 } } }]);
    const api = createApi(c, 'u1', st);
    const r = await api.upload('11111111-1111-1111-1111-111111111111', log(5));
    expect(r?.newCoins).toBe(1);
    expect(sent[0]).toEqual({ runId: '11111111-1111-1111-1111-111111111111', log: log(5), rules: RULES_VERSION });
    expect(api.pending('11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(st.m.size).toBe(0);
  });

  it('통신 실패 · 5xx 는 보관 → flush 때 다시 · 같은 판은 가장 최근 기록 하나만', async () => {
    const st = memStore();
    const { c, sent } = fakeClient(['throw', { status: 503, error: 'auth unavailable' }]);
    const api = createApi(c, 'u1', st);
    expect(await api.upload('r1', log(3))).toBeNull();
    expect(await api.upload('r1', log(7))).toBeNull();
    expect(api.pending('r1')).toBe(true);
    expect(JSON.parse(st.m.get('siacard:pending:u1')!).length).toBe(1);
    expect(await api.flush()).toBe(1);
    expect(sent.at(-1)!.log.length).toBe(7);
    expect(api.pending('r1')).toBe(false);
  });

  it('거절(4xx)은 ApiError 로 알리고 버린다', async () => {
    const st = memStore();
    const { c } = fakeClient([{ status: 409, error: 'stale' }, { status: 400, error: 'bad log' }]);
    const api = createApi(c, 'u1', st);
    await expect(api.upload('r1', log(3))).rejects.toThrow(ApiError);
    expect(api.pending('r1')).toBe(false);
    await expect(api.upload('r2', log(3))).rejects.toThrow('bad log');
    expect(st.m.size).toBe(0);
  });

  it('보관한 것이 없으면 flush 는 0', async () => {
    const { c } = fakeClient([]);
    expect(await createApi(c, 'u1', memStore()).flush()).toBe(0);
  });
});

describe('상태 · 문구', () => {
  it('card_state 를 화면 모양으로', async () => {
    const { c } = fakeClient([]);
    const s = await createApi(c, 'u1', memStore()).state();
    expect(s.heroes.dog).toEqual({ mastery: 2, best: 1, clears: 3 });
    expect(s.clears).toBe(3);
    expect(s.dailyPlayed).toBe(true);
    expect(s.endless).toBeNull();
    const n = normState({ runs: { endless: { runId: 'x', mode: 'endless', hero: 'dog', mastery: 0, seed: '4294967295', log: [{ t: 'go', col: 0 }], acts: 1 } } });
    expect(n.runs.endless?.seed).toBe(4294967295);
    expect(n.runs.endless?.log.length).toBe(1);
  });
  it('거절 문구', () => {
    expect(friendly(new ApiError('locked character'))).toContain('시아코인 100');
    expect(friendly(new Error('timeout'))).toContain('서버에 연결하지 못했어요');
  });
});

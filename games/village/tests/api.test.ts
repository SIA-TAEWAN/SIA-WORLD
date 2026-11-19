import { describe, expect, it } from 'vitest';
import { ApiError, createLocalApi, createSupabaseApi, type RpcClient, type Store } from '../src/net/api';
import { newVillage } from '../src/game/rules';

const memory = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('테스트 모드 (LocalApi)', () => {
  it('짓기 → 기다리기 → 수확 → 목표, 새로 열어도 그대로', async () => {
    const store = memory();
    let t = 1_700_000_000_000;
    const api = createLocalApi(store, () => t);
    let s = await api.load();
    expect(s.buildings).toHaveLength(1);
    const r = await api.build('paddy', 6, 6);
    expect(r.state.profile.resources.wood).toBe(40);
    await expect(api.build('paddy', 6, 6)).rejects.toThrow(new ApiError('occupied'));
    await expect(api.claimGoal()).rejects.toThrow('not done');
    t += 3600_000;
    s = await api.load();
    expect(s.buildings.find((b) => b.id === r.id)!.state).toBe('done');
    const h = await api.harvest([r.id]);
    expect(h.harvest.per[r.id]).toBe(59);
    s = await api.claimGoal();
    expect(s.profile.goal).toBe(1);
    s = await api.move(r.id, 7, 7);
    // 거절된 요청은 저장하지 않는다
    await expect(api.move(r.id, 9, 9)).rejects.toThrow('occupied');
    const again = createLocalApi(store, () => t);
    expect(await again.load()).toEqual(s);
    expect(again.now()).toBe(t);
  });

  it('?fast: 시간을 빨리 돌리고, 새로 열어도 뒤로 가지 않는다', async () => {
    const store = memory();
    let t = 1000_000;
    const api = createLocalApi(store, () => t, 60);
    await api.build('paddy', 6, 6);
    t += 1000;
    expect(api.now()).toBe(1000_000 + 60_000);
    expect((await api.load()).buildings[1].state).toBe('done');
    const again = createLocalApi(store, () => t, 60);
    expect(again.now()).toBe(1000_000 + 60_000);
    t += 500;
    expect(again.now()).toBe(1000_000 + 60_000 + 30_000);
  });
});

describe('서버 (SupabaseApi)', () => {
  const answer = (now: number) => ({ now, ...newVillage(now, 'h') });

  it('서버 시각으로 기기 시계와의 차이를 맞춘다', async () => {
    let device = 5000;
    const calls: [string, unknown][] = [];
    const sb: RpcClient = {
      rpc(fn, args) {
        calls.push([fn, args]);
        device += 200; // 오가는 데 200ms
        return Promise.resolve({ data: { ...answer(100_000), id: 'new', harvest: { per: { a: 3 }, gained: { rice: 3 }, exp: 0, lost: 2 } }, error: null });
      },
    };
    const api = createSupabaseApi(sb, 1000, () => device);
    expect(api.now()).toBe(5000);
    const s = await api.load();
    expect(s.buildings[0]).toMatchObject({ id: 'h', type: 'hall' });
    // 서버 시각 100000 은 보낸 때(5000)와 받은 때(5200)의 가운데(5100)로 본다
    expect(api.now()).toBe(100_000 + 100);
    device += 1000;
    expect(api.now()).toBe(101_100);
    expect((await api.build('paddy', 6, 7)).id).toBe('new');
    expect((await api.harvest(['a'])).harvest).toEqual({ per: { a: 3 }, gained: { rice: 3 }, exp: 0, lost: 2 });
    await api.move('a', 1, 2);
    await api.upgrade('a');
    await api.claimGoal();
    expect(calls).toEqual([
      ['village_state', undefined],
      ['village_build', { p_type: 'paddy', p_x: 6, p_y: 7 }],
      ['village_harvest', { p_ids: ['a'] }],
      ['village_move', { p_id: 'a', p_x: 1, p_y: 2 }],
      ['village_upgrade', { p_id: 'a' }],
      ['village_claim_goal', undefined],
    ]);
  });

  it('서버가 거절하면 ApiError(까닭), 통신 문제 · 시간 초과면 network', async () => {
    const reject: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { code: 'P0001', message: 'not enough' } }) };
    await expect(createSupabaseApi(reject).upgrade('a')).rejects.toThrow(new ApiError('not enough'));
    const broken: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }) };
    const e = await createSupabaseApi(broken).load().catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(ApiError);
    expect((e as Error).message).toBe('network');
    const slow: RpcClient = { rpc: () => new Promise(() => undefined) };
    await expect(createSupabaseApi(slow, 30).load()).rejects.toThrow('network');
    const thrown: RpcClient = { rpc: () => Promise.reject(new Error('boom')) };
    await expect(createSupabaseApi(thrown).load()).rejects.toThrow('network');
  });

  it('시아코인 잔액은 상태에 실려 온다 (서버가 공통 지갑에서 읽는다)', async () => {
    const ok: RpcClient = { rpc: () => Promise.resolve({ data: { ...answer(1000), sia: 12 }, error: null }) };
    expect((await createSupabaseApi(ok).load()).sia).toBe(12);
    expect((await createSupabaseApi(ok).expand()).sia).toBe(12);
  });
});

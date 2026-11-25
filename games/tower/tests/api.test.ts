import { describe, expect, it } from 'vitest';
import { ApiError, createLocalApi, createSupabaseApi, type RpcClient, type Store } from '../src/net/api';
import { clearFloor, newData } from '../src/game/progress';

const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('기기 저장 (테스트 모드) — 서버와 같은 규칙', () => {
  it('외형: 처음은 무료, 바꾸면 시아코인 30, 모자라면 거절', async () => {
    const api = createLocalApi(memStore());
    expect((await api.state()).look).toBeNull();
    const look = { sex: 'f' as const, hair: 1, face: 2, outfit: 3 };
    expect(await api.setLook(look)).toMatchObject({ paid: false, siaCoins: 100 });
    expect(await api.setLook(look)).toMatchObject({ paid: false });
    expect(await api.setLook({ ...look, hair: 0 })).toMatchObject({ paid: true, siaCoins: 70 });
    await expect(api.setLook({ ...look, hair: 9 } as never)).rejects.toThrow('bad look');
  });

  it('저장: 층 건너뛰기는 거절, 처음 깬 층마다 시아코인 1개', async () => {
    const api = createLocalApi(memStore());
    const d = newData(3);
    clearFloor(d, 1);
    expect(await api.save(d, 1)).toMatchObject({ bestFloor: 1, gotCoin: true, siaCoins: 101 });
    expect(await api.save(d, 1)).toMatchObject({ gotCoin: false });
    await expect(api.save(d, 3)).rejects.toThrow('bad save');
    for (let f = 2; f <= 10; f++) {
      clearFloor(d, f);
      await api.save(d, f);
    }
    const st = await api.state();
    expect(st.bestFloor).toBe(10);
    expect(st.data.checkpoint).toBe(11);
    expect(st.siaCoins).toBe(110);
  });
});

describe('서버 저장', () => {
  /** 가짜 서버: down 이면 통신 실패, 받은 호출을 기록한다 */
  const fake = () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    let best = 0;
    const c = {
      down: false,
      savedAt: 0,
      /** 107 서버: tower_save 가 savedAt 을 돌려주고 서버의 savedAt 을 바꾼다. false = 106 서버 */
      stamps: true,
      /** 이만큼 저장을 받은 뒤 통신이 끊긴다 (null = 끊기지 않는다) */
      downAfter: null as number | null,
      calls,
      rpc(fn: string, args?: Record<string, unknown>) {
        if (c.down) return Promise.reject(new Error('Failed to fetch'));
        calls.push({ fn, args });
        if (fn === 'tower_save') {
          const cl = args?.p_cleared as number | null;
          if (cl != null && cl > best + 1) return Promise.resolve({ data: null, error: { message: 'bad save' } });
          const got = cl != null && cl > best;
          if (cl != null) best = Math.max(best, cl);
          // 서버 시각: 기기 시각보다 앞서 있어도 (기기마다 시계가 다르다) 이 기기의 저장으로 알아본다
          c.savedAt = Math.max(c.savedAt + 1, Date.now() + 5000);
          if (c.downAfter != null && --c.downAfter <= 0) c.down = true;
          return Promise.resolve({ data: { bestFloor: best, gotCoin: got, siaCoins: 5, ...(c.stamps ? { savedAt: c.savedAt } : {}) }, error: null });
        }
        if (fn === 'tower_state') return Promise.resolve({ data: { look: null, data: {}, bestFloor: best, siaCoins: 5, lookPrice: 30, savedAt: c.savedAt }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return c;
  };

  it('부르는 모양: tower_save(p_data, p_cleared)', async () => {
    const c = fake();
    const api = createSupabaseApi(c as RpcClient, 'u1', memStore());
    const d = newData(1);
    clearFloor(d, 1);
    expect(await api.save(d, 1)).toMatchObject({ gotCoin: true });
    expect(c.calls[0]).toEqual({ fn: 'tower_save', args: { p_data: JSON.parse(JSON.stringify(d)), p_cleared: 1 } });
    await api.save(d);
    expect(c.calls[1].args?.p_cleared).toBeNull();
  });

  it('통신이 끊기면 보관했다가 순서대로 다시 보낸다 (깬 층은 하나도 빠뜨리지 않는다)', async () => {
    const c = fake();
    const store = memStore();
    const api = createSupabaseApi(c as RpcClient, 'u1', store);
    const d = newData(1);
    c.down = true;
    for (let f = 1; f <= 3; f++) {
      clearFloor(d, f);
      expect(await api.save(d, f)).toBeNull();
      expect(await api.save(d)).toBeNull();
    }
    expect(api.pending()).toBe(6);
    c.down = false;
    // 새로 연 화면 (같은 기기) 도 보관한 것을 보낸다
    const again = createSupabaseApi(c as RpcClient, 'u1', store);
    const st = await again.state();
    expect(again.pending()).toBe(0);
    expect(st.bestFloor).toBe(3);
    expect(c.calls.filter((x) => x.fn === 'tower_save').map((x) => x.args?.p_cleared)).toEqual([1, null, 2, null, 3, null]);
  });

  it('거절은 ApiError, 그 저장은 버린다', async () => {
    const c = fake();
    const api = createSupabaseApi(c as RpcClient, 'u1', memStore());
    await expect(api.save(newData(1), 5)).rejects.toBeInstanceOf(ApiError);
    expect(api.pending()).toBe(0);
  });

  it('다른 기기가 그 뒤에 저장했으면 이 기기의 못 보낸 저장은 보내지 않고 버린다 (106 savedAt)', async () => {
    const c = fake();
    const store = memStore();
    const api = createSupabaseApi(c as RpcClient, 'u1', store);
    const d = newData(1);
    c.down = true;
    await api.save(d);
    expect(api.pending()).toBe(1);
    c.down = false;
    c.savedAt = Date.now() + 1000;
    await createSupabaseApi(c as RpcClient, 'u1', store).state();
    expect(c.calls.filter((x) => x.fn === 'tower_save')).toHaveLength(0);
    expect(api.pending()).toBe(0);
  });

  it('못 보낸 A · B 중 A 만 들어가고 끊겨도 B 는 버리지 않고 다음에 보낸다 (107 tower_save 의 savedAt)', async () => {
    const c = fake();
    const store = memStore();
    const api = createSupabaseApi(c as RpcClient, 'u1', store);
    const d = newData(1);
    c.down = true;
    clearFloor(d, 1);
    await api.save(d, 1);
    clearFloor(d, 2);
    await api.save(d, 2);
    expect(api.pending()).toBe(2);
    // 다시 보낸다: A(1층)만 들어가고 끊긴다 → 서버 savedAt(A 를 받은 시각)이 B 를 만든 시각보다 늦다
    c.down = false;
    c.downAfter = 1;
    expect(await api.resend()).toBe(1);
    c.down = false;
    c.downAfter = null;
    const st = await createSupabaseApi(c as RpcClient, 'u1', store).state();
    expect(c.calls.filter((x) => x.fn === 'tower_save').map((x) => x.args?.p_cleared)).toEqual([1, 2]);
    expect(st.bestFloor).toBe(2);
    expect(api.pending()).toBe(0);
  });

  it('그 뒤 다른 기기가 저장했으면 (서버 savedAt 이 이 기기가 받은 것보다 크다) 남은 저장은 버린다', async () => {
    const c = fake();
    const store = memStore();
    const api = createSupabaseApi(c as RpcClient, 'u1', store);
    const d = newData(1);
    await api.save(d);
    c.down = true;
    d.coins = 77;
    await api.save(d);
    expect(api.pending()).toBe(1);
    c.down = false;
    c.savedAt += 60_000; // 다른 기기의 저장
    await createSupabaseApi(c as RpcClient, 'u1', store).state();
    expect(c.calls.filter((x) => x.fn === 'tower_save')).toHaveLength(1);
    expect(api.pending()).toBe(0);
  });

  it('106 서버(tower_save 에 savedAt 이 없다)와도 예전처럼 동작한다', async () => {
    const c = fake();
    c.stamps = false;
    const store = memStore();
    const api = createSupabaseApi(c as RpcClient, 'u1', store);
    const d = newData(1);
    c.down = true;
    clearFloor(d, 1);
    await api.save(d, 1);
    expect(api.pending()).toBe(1);
    c.down = false;
    const st = await createSupabaseApi(c as RpcClient, 'u1', store).state();
    expect(st.bestFloor).toBe(1);
    expect(api.pending()).toBe(0);
  });

  it('보관이 너무 많으면 그냥 저장부터 줄이고, 층을 깬 저장은 100층 모두 남긴다', async () => {
    const c = fake();
    const store = memStore();
    const api = createSupabaseApi(c as RpcClient, 'u1', store);
    const d = newData(1);
    c.down = true;
    for (let f = 1; f <= 100; f++) {
      clearFloor(d, f);
      await api.save(d, f);
      d.coins++;
      await api.save(d);
    }
    expect(api.pending()).toBeLessThanOrEqual(120);
    c.down = false;
    await api.resend();
    const cl = c.calls.filter((x) => x.fn === 'tower_save').map((x) => x.args?.p_cleared).filter((x) => x != null);
    expect(cl).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
});

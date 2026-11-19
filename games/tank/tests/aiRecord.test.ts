import { describe, expect, it } from 'vitest';
import { AiMatchRecorder, EARLY_MARGIN_MS, EARLY_RETRY_MS, localPending, aiRanked, outcomeText, parseFinish, parseStart, type AiFinish, type AiRpc, type PendingResult, type PendingStore } from '../src/net/aiRecord';

/** 가짜 시계: sleep 을 부르면 그만큼 시간이 흐른다 */
function clock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    pass: (ms: number) => (t += ms),
    slept,
  };
}

/** 시작 요청이 답을 받을 때까지 */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 서버의 최소 시간(초) */
const MIN = 30;

const done = (over: Partial<AiFinish> = {}): AiFinish => ({ counted: true, coin: true, wins: 3, losses: 1, perDay: 30, ...over });

/** 부른 것을 적어 두는 가짜 서버 */
function fakeRpc(over: Partial<AiRpc> = {}, minSec = 30) {
  const calls: string[] = [];
  let n = 0;
  const rpc: AiRpc = {
    async start() {
      const id = `m${++n}`;
      calls.push(`start ${id}`);
      return { id, minSec };
    },
    async finish(id, won) {
      calls.push(`finish ${id} ${won}`);
      return done();
    },
    async cancel(id) {
      calls.push(`cancel ${id}`);
    },
    ...over,
  };
  return { rpc, calls };
}

describe('어떤 판이 전적에 반영되는가', () => {
  it('AI 보통·어려움 + 게임 모드 일반만', () => {
    expect(aiRanked('normal', 'normal', false)).toBe(true);
    expect(aiRanked('hard', 'normal', false)).toBe(true);
  });
  it('AI 쉬움 · 한 기기 2인 · 초보 모드 · 백발백중은 아니다', () => {
    expect(aiRanked('easy', 'normal', false)).toBe(false);
    expect(aiRanked('local', 'normal', false)).toBe(false);
    expect(aiRanked('normal', 'easy', false)).toBe(false);
    expect(aiRanked('hard', 'easy', false)).toBe(false);
    expect(aiRanked('hard', 'normal', true)).toBe(false);
  });
});

describe('AI 판 기록 순서', () => {
  it('만들 때 시작을 알리고, 끝나면 결과를 올린다', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc();
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(120_000);
    expect(await rec.finish(true)).toEqual({ state: 'saved', coin: true, wins: 3, losses: 1 });
    expect(calls).toEqual(['start m1', 'finish m1 true']);
    expect(c.slept).toEqual([]);
  });

  it('진 판은 패배로 올린다. finish 를 여러 번 불러도 한 번만 올린다', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc();
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(60_000);
    const a = rec.finish(false);
    const b = rec.finish(true);
    expect(a).toBe(b);
    await a;
    expect(calls).toEqual(['start m1', 'finish m1 false']);
  });

  it('최소 시간보다 빨리 끝난 판은 서버가 받아 주는 시각까지 기다렸다가 올린다', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc({}, 30);
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(12_000);
    expect((await rec.finish(true)).state).toBe('saved');
    expect(c.slept).toEqual([18_000 + EARLY_MARGIN_MS]);
    expect(calls).toEqual(['start m1', 'finish m1 true']);
  });

  it("그래도 'too early' 면 잠깐 뒤 다시 올린다 (두 번까지)", async () => {
    const c = clock();
    let n = 0;
    const { rpc } = fakeRpc({
      async finish() {
        if (++n <= 2) throw new Error('too early');
        return done();
      },
    });
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(90_000);
    expect((await rec.finish(true)).state).toBe('saved');
    expect(c.slept).toEqual([EARLY_RETRY_MS, EARLY_RETRY_MS]);

    n = -10;
    const rec2 = new AiMatchRecorder({ ...rpc, finish: async () => Promise.reject(new Error('too early')) }, c);
    await tick();
    c.pass(90_000);
    expect(await rec2.finish(true)).toEqual({ state: 'failed' });
  });

  it('하루 한도를 넘긴 판은 그렇게 알린다 (전적·코인 없음)', async () => {
    const c = clock();
    const { rpc } = fakeRpc({ finish: async () => done({ counted: false, coin: false }) });
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(90_000);
    const o = await rec.finish(true);
    expect(o).toEqual({ state: 'limit', perDay: 30, wins: 3, losses: 1 });
    expect(outcomeText(o)).toContain('30판');
  });

  it('시작을 알리지 못했으면 결과도 올리지 않고 실패로 알린다. 예외를 던지지 않는다', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc({ start: async () => Promise.reject(new Error('Failed to fetch')) });
    expect(await new AiMatchRecorder(rpc, c).finish(true)).toEqual({ state: 'failed' });
    expect(calls).toEqual([]);
    // 서버에 연결하지 못함
    expect(await new AiMatchRecorder(Promise.reject(new Error('no world')), c).finish(true)).toEqual({ state: 'failed' });
    // 결과를 올리다 실패 (다른 까닭은 다시 올리지 않는다)
    const bad = fakeRpc({ finish: async () => Promise.reject(new Error('no match')) });
    const rec = new AiMatchRecorder(bad.rpc, c);
    await tick();
    c.pass(90_000);
    expect(await rec.finish(false)).toEqual({ state: 'failed' });
    expect(c.slept).toEqual([]);
  });

  it('테스트 모드(서버 없음)는 아무것도 부르지 않는다', async () => {
    const o = await new AiMatchRecorder(null, clock()).finish(true);
    expect(o).toEqual({ state: 'none' });
    expect(outcomeText(o)).toContain('테스트 모드');
  });

  it('중간에 나간 판은 종료를 올리지 않는다 (finish 를 부르지 않으면 start 뿐)', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc();
    new AiMatchRecorder(rpc, c);
    await tick();
    expect(calls).toEqual(['start m1']);
  });

  it('바로 다시 하기: 앞 판의 결과가 올라간 다음에 새 판의 시작을 알린다 (서버는 열린 판을 하나만 둔다)', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc({}, 30);
    const first = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(5_000);
    // 5초 만에 끝난 판: 결과는 25초 뒤에야 올라간다. 그 사이에 새 판을 시작한다
    const p1 = first.finish(false);
    const second = new AiMatchRecorder(rpc, c);
    const p2 = second.finish(true);
    await Promise.all([p1, p2]);
    expect(calls).toEqual(['start m1', 'finish m1 false', 'start m2', 'finish m2 true']);
  });
});

/** 기기 저장소 대신 */
function memStore(init: PendingResult | null = null) {
  const box = { v: init };
  const store: PendingStore = { get: () => box.v, set: (v) => (box.v = v) };
  return { box, store };
}

describe('도중에 나간 판', () => {
  it('최소 시간 전: 확인 없이 나가고 서버에서 지운다 (기록 없음)', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc({}, MIN);
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(MIN * 1000 - 1000);
    expect(rec.forfeitable()).toBe(false);
    expect(await rec.leave(false)).toEqual({ state: 'none' });
    expect(calls).toEqual(['start m1', 'cancel m1']);
    // 나간 뒤 finish 를 불러도 올리지 않는다
    await rec.finish(true);
    expect(calls).toEqual(['start m1', 'cancel m1']);
  });

  it('최소 시간이 지난 뒤: 패배로 올린다', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc({}, MIN);
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(MIN * 1000);
    expect(rec.forfeitable()).toBe(true);
    expect((await rec.leave(true)).state).toBe('saved');
    expect(calls).toEqual(['start m1', 'finish m1 false']);
    expect(rec.forfeitable()).toBe(false);
  });

  it('최소 시간은 시작 요청을 보낸 시각부터 센다 (서버가 적은 시각보다 이르게: 경고가 늦지 않게)', async () => {
    const c = clock();
    const { rpc } = fakeRpc({
      async start() {
        c.pass(3_000); // 답이 3초 걸렸다
        return { id: 'm1', minSec: MIN };
      },
    });
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(MIN * 1000 - 3_000);
    expect(rec.forfeitable()).toBe(true);
  });

  it('시작 답을 받기 전이나 시작에 실패한 판은 패배가 아니다', async () => {
    const c = clock();
    let release!: () => void;
    const { rpc, calls } = fakeRpc({
      start: () => new Promise((r) => (release = () => r({ id: 'm1', minSec: MIN }))),
    });
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    expect(rec.forfeitable()).toBe(false);
    const p = rec.leave(false);
    release();
    await p;
    expect(calls).toEqual(['cancel m1']);
    const bad = new AiMatchRecorder({ ...rpc, start: async () => Promise.reject(new Error('Failed to fetch')) }, c);
    await tick();
    c.pass(90_000);
    expect(bad.forfeitable()).toBe(false);
    // 지우기에 실패해도 예외 없이 나간다
    const rec3 = new AiMatchRecorder(fakeRpc({ cancel: async () => Promise.reject(new Error('Failed to fetch')) }).rpc, c);
    expect(await rec3.leave(false)).toEqual({ state: 'failed' });
  });

  it('테스트 모드에서는 아무것도 부르지 않는다', async () => {
    const rec = new AiMatchRecorder(null, clock());
    await tick();
    expect(rec.forfeitable()).toBe(false);
    expect(await rec.leave(false)).toEqual({ state: 'none' });
  });
});

describe('못 올린 결과는 다음 판 시작 전에 다시 올린다', () => {
  it('올리면 맡겨 둔 것을 지운다', async () => {
    const c = clock();
    const { rpc } = fakeRpc();
    const { box, store } = memStore();
    const rec = new AiMatchRecorder(rpc, { ...c, store });
    await tick();
    c.pass(90_000);
    await rec.finish(true);
    expect(box.v).toBe(null);
  });

  it('통신 실패로 못 올린 이긴 판: 다음 판 시작 전에 먼저 올리고 새 판을 시작한다', async () => {
    const c = clock();
    let down = true;
    const { rpc, calls } = fakeRpc({
      async finish(id, won) {
        calls.push(`finish ${id} ${won}`);
        if (down) throw new Error('Failed to fetch');
        return done();
      },
    });
    const { box, store } = memStore();
    const rec = new AiMatchRecorder(rpc, { ...c, store });
    await tick();
    c.pass(90_000);
    expect(await rec.finish(true)).toEqual({ state: 'failed' });
    expect(box.v).toEqual({ id: 'm1', won: true });
    down = false;
    // 다른 기록기(새로 고침 뒤)도 기기에 맡겨 둔 것으로 다시 올린다
    const next = new AiMatchRecorder(rpc, { ...c, store });
    await next.leave(false);
    expect(calls).toEqual(['start m1', 'finish m1 true', 'finish m1 true', 'start m2', 'cancel m2']);
    expect(box.v).toBe(null);
  });

  it('다시 올리기도 실패하면 버리고 그대로 새 판을 시작한다', async () => {
    const c = clock();
    const { rpc, calls } = fakeRpc({
      async finish(id, won) {
        calls.push(`finish ${id} ${won}`);
        throw new Error('already finished');
      },
    });
    const { box, store } = memStore({ id: 'old', won: true });
    const rec = new AiMatchRecorder(rpc, { ...c, store });
    await rec.leave(false);
    expect(calls).toEqual(['finish old true', 'start m1', 'cancel m1']);
    expect(box.v).toBe(null);
  });

  it('기다리는 동안(너무 빨리 끝난 판)에도 미리 맡겨 둔다', async () => {
    const c = clock();
    const { rpc } = fakeRpc({}, MIN);
    const { box, store } = memStore();
    let seen: PendingResult | null = null;
    const rec = new AiMatchRecorder(rpc, {
      now: c.now,
      store,
      sleep: async (ms) => {
        seen = box.v;
        c.pass(ms);
      },
    });
    await tick();
    await rec.finish(false);
    expect(seen).toEqual({ id: 'm1', won: false });
    expect(box.v).toBe(null);
  });

  it('localStorage 한 칸: 없거나 망가진 값은 없는 것으로, 쓰지 못해도 예외 없음', () => {
    const g = globalThis as { localStorage?: unknown };
    const had = Object.getOwnPropertyDescriptor(g, 'localStorage');
    const map = new Map<string, string>();
    Object.defineProperty(g, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) },
    });
    try {
      const st = localPending('k');
      expect(st.get()).toBe(null);
      st.set({ id: 'a', won: false });
      expect(st.get()).toEqual({ id: 'a', won: false });
      map.set('k', '{oops');
      expect(st.get()).toBe(null);
      map.set('k', JSON.stringify({ id: 1 }));
      expect(st.get()).toBe(null);
      st.set(null);
      expect(map.has('k')).toBe(false);
      Object.defineProperty(g, 'localStorage', {
        configurable: true,
        get: () => {
          throw new Error('denied');
        },
      });
      expect(st.get()).toBe(null);
      expect(() => st.set({ id: 'a', won: true })).not.toThrow();
    } finally {
      if (had) Object.defineProperty(g, 'localStorage', had);
      else delete g.localStorage;
    }
  });
});

describe('서버 답 읽기', () => {
  it('시작·종료 답', () => {
    expect(parseStart({ id: 'x', min_sec: 30, today: 2, per_day: 30 })).toEqual({ id: 'x', minSec: 30 });
    expect(() => parseStart(null)).toThrow();
    expect(parseFinish({ status: 'done', counted: true, coin: false, wins: 2, losses: 5, today: 3, per_day: 30 })).toEqual({ counted: true, coin: false, wins: 2, losses: 5, perDay: 30 });
    expect(() => parseFinish({})).toThrow();
  });
  it('결과 화면 한 줄', () => {
    expect(outcomeText({ state: 'saved', coin: true, wins: 4, losses: 2 })).toBe('🏅 전적 +1 · 시아코인 +1 · 내 전적 4승 2패');
    expect(outcomeText({ state: 'saved', coin: false, wins: 4, losses: 2 })).toContain('시아코인은 이번엔 없어요');
    expect(outcomeText({ state: 'failed' })).toBe('전적을 기록하지 못했어요');
  });
});

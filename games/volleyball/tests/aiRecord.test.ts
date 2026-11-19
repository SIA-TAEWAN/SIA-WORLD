import { describe, expect, it } from 'vitest';
import { AiMatchRecorder, EARLY_MARGIN_MS, EARLY_RETRY_MS, outcomeText, parseFinish, parseStart, type AiFinish, type AiRpc } from '../src/net/aiRecord';

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

const done = (over: Partial<AiFinish> = {}): AiFinish => ({ counted: true, coin: true, wins: 3, losses: 1, perDay: 30, ...over });

/** 부른 것을 적어 두는 가짜 서버 */
function fakeRpc(over: Partial<AiRpc> = {}, minSec = 15) {
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
    ...over,
  };
  return { rpc, calls };
}

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
    const { rpc, calls } = fakeRpc({}, 15);
    const rec = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(9_000);
    expect((await rec.finish(true)).state).toBe('saved');
    expect(c.slept).toEqual([6_000 + EARLY_MARGIN_MS]);
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
    const { rpc, calls } = fakeRpc({}, 15);
    const first = new AiMatchRecorder(rpc, c);
    await tick();
    c.pass(5_000);
    // 5초 만에 끝난 판: 결과는 10초 뒤에야 올라간다. 그 사이에 새 판을 시작한다
    const p1 = first.finish(false);
    const second = new AiMatchRecorder(rpc, c);
    const p2 = second.finish(true);
    await Promise.all([p1, p2]);
    expect(calls).toEqual(['start m1', 'finish m1 false', 'start m2', 'finish m2 true']);
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

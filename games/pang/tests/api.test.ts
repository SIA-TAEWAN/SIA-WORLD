import { describe, expect, it } from 'vitest';
import { ApiError, createLocalApi, LIVES, refill, starsFor } from '../src/net/api';
import LEVELS from '../src/data/levels.json';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe('테스트 모드 기록', () => {
  it('별은 서버와 같은 기준으로 계산한다', () => {
    const [s2, s3] = LEVELS[0].stars;
    expect(starsFor(1, false, 1e9)).toBe(0);
    expect(starsFor(1, true, s2 - 1)).toBe(1);
    expect(starsFor(1, true, s2)).toBe(2);
    expect(starsFor(1, true, s3)).toBe(3);
  });
  it('열린 스테이지만 시작하고, 너무 빨리 끝낸 판은 거절한다', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t);
    await expect(api.start(2)).rejects.toThrow(ApiError);
    const { run } = await api.start(1);
    t = 1000;
    await expect(api.finish(run, 1, true, 5000, 10)).rejects.toThrow('too fast');
    const { run: run2 } = await api.start(1);
    t = 60_000;
    const r = await api.finish(run2, 1, true, LEVELS[0].stars[1], 10);
    expect(r.stars).toBe(3);
    expect(r.gotCoin).toBe(true);
    await expect(api.finish(run2, 1, true, 100, 10)).rejects.toThrow('bad run');
    expect((await api.start(2)).run).toBeTruthy();
  });
});

describe('목숨', () => {
  it('시작마다 1개 쓰고, 처음 깬 판만 1개 돌려받는다', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t);
    expect((await api.state()).lives).toBe(5);
    const a = await api.start(1);
    expect(a.lives).toBe(4);
    expect(a.nextLife).toBe(LIVES.regenSec);
    t = 60_000;
    const r = await api.finish(a.run, 1, true, 100, 10);
    expect(r.lifeBack).toBe(true);
    expect(r.lives).toBe(5);
    // 이미 깬 판 · 진 판은 돌려받지 않는다
    const b = await api.start(1);
    t = 120_000;
    expect((await api.finish(b.run, 1, true, 100, 10)).lifeBack).toBe(false);
    const c = await api.start(2);
    t = 180_000;
    const lost = await api.finish(c.run, 2, false, 100, 10);
    expect(lost.lifeBack).toBe(false);
    expect(lost.lives).toBe(3);
  });
  it('다 쓰면 시작할 수 없고 20분마다 1개 찬다', async () => {
    let t = 0;
    const api = createLocalApi(mem(), 'k', () => t);
    for (let i = 0; i < 5; i++) await api.start(1);
    await expect(api.start(1)).rejects.toThrow('no lives');
    t = LIVES.regenSec * 1000 - 1;
    expect((await api.state()).lives).toBe(0);
    t = LIVES.regenSec * 1000;
    const s = await api.state();
    expect(s.lives).toBe(1);
    expect(s.nextLife).toBe(LIVES.regenSec);
    t = LIVES.regenSec * 1000 * 10;
    expect((await api.state()).lives).toBe(5);
    expect((await api.state()).nextLife).toBe(0);
  });
  it('refill 은 최대를 넘지 않는다', () => {
    expect(refill(5, 123, 1e9)).toEqual({ lives: 5, at: null, next: 0 });
    expect(refill(3, 0, LIVES.regenSec * 1500).lives).toBe(4);
  });
  it('관리자는 목숨이 줄지 않고 모든 판을 시작한다', async () => {
    const api = createLocalApi(mem(), 'k', () => 0, true);
    expect((await api.state()).admin).toBe(true);
    for (let i = 0; i < 8; i++) expect((await api.start(100)).lives).toBe(5);
  });
});

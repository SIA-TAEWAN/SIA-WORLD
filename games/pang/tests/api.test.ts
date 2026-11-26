import { describe, expect, it } from 'vitest';
import { ApiError, createLocalApi, starsFor } from '../src/net/api';
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
    const run = await api.start(1);
    t = 1000;
    await expect(api.finish(run, 1, true, 5000, 10)).rejects.toThrow('too fast');
    const run2 = await api.start(1);
    t = 60_000;
    const r = await api.finish(run2, 1, true, LEVELS[0].stars[1], 10);
    expect(r.stars).toBe(3);
    expect(r.gotCoin).toBe(true);
    await expect(api.finish(run2, 1, true, 100, 10)).rejects.toThrow('bad run');
    expect(await api.start(2)).toBeTruthy();
  });
});

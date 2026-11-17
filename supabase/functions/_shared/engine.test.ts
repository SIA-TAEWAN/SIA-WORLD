import { describe, expect, it } from 'vitest';
import { cryptoRng, seededRng, shuffle } from './engine.ts';

describe('engine 공통', () => {
  it('시드 난수는 재현된다', () => {
    const a = seededRng(42), b = seededRng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
  it('섞기는 원소를 그대로 보존한다', () => {
    const src = Array.from({ length: 52 }, (_, i) => i);
    const out = shuffle(src, cryptoRng());
    expect(out).toHaveLength(52);
    expect([...out].sort((x, y) => x - y)).toEqual(src);
  });
  it('crypto 정수는 범위 안', () => {
    const r = cryptoRng();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(7);
      expect(v >= 0 && v < 7).toBe(true);
    }
  });
});

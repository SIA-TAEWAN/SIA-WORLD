import { describe, expect, it } from 'vitest';
import { lobbyCount, lobbyOrder, lobbyPlace, LOBBY_MAX } from '../src/net/capacity';

describe('접속 인원 (정원 30명)', () => {
  const m = (key: string, seen: unknown) => ({ key, meta: { seen } });
  it('같은 계정은 한 번만 세고, 먼저 온 순서로 줄을 선다', () => {
    const list = [m('b', 200), m('a', 300), m('a', 100), m('c', 200), m('x', 'bad')];
    expect(lobbyOrder(list)).toEqual(['a', 'b', 'c', 'x']);
    expect(lobbyCount(list)).toBe(4);
    expect(lobbyPlace(list, 'c')).toBe(2);
    expect(lobbyPlace(list, 'nobody')).toBe(4);
  });
  it('31번째로 온 사람은 정원 밖이다', () => {
    const list = Array.from({ length: 31 }, (_, i) => m(`u${String(i).padStart(2, '0')}`, 1000 + i));
    expect(lobbyPlace(list, 'u29')).toBeLessThan(LOBBY_MAX);
    expect(lobbyPlace(list, 'u30')).toBeGreaterThanOrEqual(LOBBY_MAX);
  });
});

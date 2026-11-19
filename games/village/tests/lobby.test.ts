import { describe, expect, it } from 'vitest';
import { LOBBY_CHANNEL, LOBBY_MAX, lobbyOrder, lobbyPlace } from '../src/net/lobby';

describe('10단계: 접속 인원 (village-lobby, 최대 30명)', () => {
  it('먼저 온 순서로 줄 세우고, 같은 계정은 한 번만 센다', () => {
    const m = [{ key: 'b', meta: { seen: 20 } }, { key: 'a', meta: { seen: 30 } }, { key: 'b', meta: { seen: 10 } }, { key: 'c', meta: {} }];
    expect(lobbyOrder(m)).toEqual(['b', 'a', 'c']);
    expect(lobbyPlace(m, 'a')).toBe(1);
    expect(lobbyPlace(m, 'z')).toBe(3);
  });
  it('정원 · 채널 이름은 로비(shared/presence.js)와 같다', () => {
    expect(LOBBY_MAX).toBe(30);
    expect(LOBBY_CHANNEL).toBe('village-lobby');
  });
});

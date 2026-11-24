import { describe, expect, it } from 'vitest';
import { RoomSession, roomSweeper, type RoomMeta } from '../src/net/room';
import type { Backend, Channel, Member, NetMsg } from '../src/net/backend';

describe('대기방에서 끊긴 사람을 빼는 기기 (roomSweeper)', () => {
  const v = (p: Partial<Parameters<typeof roomSweeper>[1]> = {}) => ({
    me: 'a',
    meWatching: true,
    present: new Set(['a', 'b', 'c']),
    watching: new Set(['b', 'c']),
    ...p,
  });

  it('방 화면을 보고 있는 명단 첫 사람', () => {
    expect(roomSweeper(['a', 'b', 'c'], v())).toBe('a');
    expect(roomSweeper(['a', 'b', 'c'], v({ me: 'c', watching: new Set(['a', 'b']) }))).toBe('a');
  });

  it('결과 화면에 머물거나 탭을 숨긴 첫 사람은 건너뛴다', () => {
    // 내가(a) 결과 화면에 있으면 b 가 맡는다
    expect(roomSweeper(['a', 'b', 'c'], v({ meWatching: false }))).toBe('b');
    // b 입장: a 는 접속해 있지만 방 화면을 안 본다(숨은 아이폰 탭 등) → b 가 맡는다
    expect(roomSweeper(['a', 'b', 'c'], v({ me: 'b', watching: new Set(['c']) }))).toBe('b');
  });

  it('접속이 안 보이는 사람은 맡지 않는다', () => {
    expect(roomSweeper(['a', 'b', 'c'], v({ me: 'c', present: new Set(['c']), watching: new Set(['a', 'b']) }))).toBe('c');
  });

  it('아무도 방 화면을 안 보면 null', () => {
    expect(roomSweeper(['a', 'b'], v({ meWatching: false, watching: new Set() }))).toBeNull();
  });
});

describe('RoomSession 방 화면 표시', () => {
  function fake() {
    const tracked: RoomMeta[] = [];
    let pres: ((m: Member<RoomMeta>[]) => void) | null = null;
    const ch: Channel<RoomMeta> = {
      onPresence: (cb) => void (pres = cb),
      onMessage: () => undefined,
      join: async (m) => void tracked.push(m),
      track: async (m) => void tracked.push(m),
      send: (_m: NetMsg) => undefined,
      leave: async () => undefined,
    } as Channel<RoomMeta>;
    const backend = { channel: () => ch } as unknown as Backend;
    return { tracked, backend, emit: (l: Member<RoomMeta>[]) => pres!(l) };
  }

  it('setWatching 은 바뀔 때만 접속 정보에 올리고, 다른 기기의 watch 를 모은다', async () => {
    const f = fake();
    const rs = new RoomSession(f.backend, 'r1', { id: 'a', name: '가' });
    await rs.join();
    expect(f.tracked.at(-1)?.watch).toBeUndefined();
    await rs.setWatching(true);
    await rs.setWatching(true);
    expect(f.tracked.filter((m) => m.watch)).toHaveLength(1);
    expect(rs.meWatching).toBe(true);
    f.emit([
      { key: 'a', meta: { name: '가', watch: true } },
      { key: 'b', meta: { name: '나', watch: true } },
      { key: 'c', meta: { name: '다' } },
    ]);
    expect([...rs.watching]).toEqual(['b']);
    expect(rs.isSweeper(['a', 'b', 'c'])).toBe(true);
    await rs.setWatching(false);
    expect(f.tracked.at(-1)?.watch).toBeUndefined();
    expect(rs.isSweeper(['a', 'b', 'c'])).toBe(false);
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Channel, Member, NetMsg } from '../src/net/channel';
import type { PlayerMeta } from '../src/net/seats';
import type { VolleyApi } from '../src/net/api';

// api.ts 가 주소(location)를 읽으므로 Node 에서는 흉내 낸 주소를 둔 뒤에 불러온다
let VolleyRoom: typeof import('../src/net/room').VolleyRoom;
beforeAll(async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  ({ VolleyRoom } = await import('../src/net/room'));
});

/** 가짜 방 채널: 받은 presence·메시지를 테스트가 직접 넣는다 */
class FakeChannel implements Channel<PlayerMeta> {
  presence: ((m: Member<PlayerMeta>[]) => void)[] = [];
  msg: ((m: NetMsg) => void)[] = [];
  sent: NetMsg[] = [];
  onPresence(cb: (m: Member<PlayerMeta>[]) => void) {
    this.presence.push(cb);
  }
  onMessage(cb: (m: NetMsg) => void) {
    this.msg.push(cb);
  }
  async join() {}
  async track() {}
  send(m: NetMsg) {
    this.sent.push(m);
  }
  async leave() {}
  connected() {
    return true;
  }
}

const ME = { id: 'me', name: '나' };
const OTHER = 'other';

function setup() {
  const ch = new FakeChannel();
  const api = { kind: 'local', channel: () => ch, syncClock: async () => {} } as unknown as VolleyApi;
  const room = new VolleyRoom(api, 'abcd12', ME, 'tiger');
  const tick = () => (room as unknown as { tick(): void }).tick();
  const meta = (ready: boolean, at: number): PlayerMeta => ({ name: '상대', char: 'rabbit', ready, at, title: '' });
  const presence = (others: { ready: boolean; at: number }[]) =>
    ch.presence.forEach((cb) =>
      cb([{ key: ME.id, meta: { name: ME.name, char: 'tiger', ready: false, at: room.joinedAt, title: '' } }, ...others.map((o) => ({ key: OTHER, meta: meta(o.ready, o.at) }))]),
    );
  // 방장(상대)이 보내 주는 '지금 경기 중' 답: 내가 새로고침 전에 하던 경기
  const adopt = () =>
    ch.msg.forEach((cb) =>
      cb({
        t: 'state',
        to: ME.id,
        start: {
          t: 'start',
          matchNo: 123,
          seed: 1,
          bg: 0,
          startAt: Date.now() - 20000,
          players: [
            { id: OTHER, name: '상대', char: 'rabbit' },
            { id: ME.id, name: ME.name, char: 'tiger' },
          ],
        },
      }),
    );
  return { ch, room, tick, presence, adopt };
}

let rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(rooms.map((r) => r.leave()));
  rooms = [];
});

describe('state 로 받은 경기 (새로고침 뒤 다시 들어온 선수)', () => {
  it('첫 presence 동기화 전에 state 가 와도 바로 끝난 것으로 보지 않는다', async () => {
    const { room, tick, presence, adopt } = setup();
    rooms.push(room);
    await room.join();
    adopt();
    tick();
    expect(room.current?.matchNo).toBe(123);
    // 상대가 있고 레디가 아니면 경기는 이어진다
    presence([{ ready: false, at: room.joinedAt - 60000 }]);
    expect(room.current?.matchNo).toBe(123);
    // 상대가 나가면(나만 남으면) 끝난 것으로 본다
    presence([]);
    expect(room.current).toBeNull();
  });

  it('끝 알림(over)을 놓쳐도: 상대가 남아서 레디하면 그 경기는 끝난 것으로 본다', async () => {
    const { room, presence, adopt } = setup();
    rooms.push(room);
    await room.join();
    presence([{ ready: false, at: room.joinedAt - 60000 }]);
    adopt();
    expect(room.current?.matchNo).toBe(123);
    presence([{ ready: true, at: room.joinedAt - 60000 }]);
    expect(room.current).toBeNull();
  });

  it('이 기기에서 시작한 경기는 상대의 레디가 아직 꺼지지 않았어도 끝내지 않는다 (시작 직후)', async () => {
    const { ch, room, presence } = setup();
    rooms.push(room);
    await room.join();
    presence([{ ready: true, at: room.joinedAt - 60000 }]);
    const start = {
      t: 'start',
      matchNo: 456,
      seed: 1,
      bg: 0,
      startAt: Date.now() + 3000,
      players: [
        { id: OTHER, name: '상대', char: 'rabbit' },
        { id: ME.id, name: ME.name, char: 'tiger' },
      ],
    };
    ch.msg.forEach((cb) => cb(start));
    presence([{ ready: true, at: room.joinedAt - 60000 }]);
    expect(room.current?.matchNo).toBe(456);
  });
});

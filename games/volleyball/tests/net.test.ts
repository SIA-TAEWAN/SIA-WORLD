import { describe, expect, it } from 'vitest';
import type { Member } from '../src/net/channel';
import { roomsFrom, type LobbyMeta } from '../src/net/lobby';
import { bothReady, cleanTitle, hostOf, players, roomTitle, seatOf, type MemberInfo } from '../src/net/seats';

const lm = (key: string, name: string, room: string | null, at = 0, extra: Partial<LobbyMeta> = {}): Member<LobbyMeta> => ({
  key,
  meta: { name, room, title: '', at, char: 'tiger', busy: false, ...extra },
});
const mem = (id: string, at: number, extra: Partial<MemberInfo> = {}): MemberInfo => ({ id, name: id, char: 'tiger', ready: false, at, title: '', ...extra });

describe('방 목록 (대기실 Presence → 방)', () => {
  it('같은 방 코드끼리 묶고, 먼저 들어간 사람이 방장', () => {
    const rooms = roomsFrom([lm('b', '나중', 'abcd12', 200, { char: 'pig' }), lm('a', '먼저', 'abcd12', 100, { char: 'rabbit' }), lm('c', '구경', null)]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ code: 'abcd12', host: '먼저', hostChar: 'rabbit', count: 2, busy: false, open: false, title: '먼저의 방' });
  });

  it('방 이름: 방장이 적은 이름, 비우면 "○○의 방"', () => {
    const rooms = roomsFrom([lm('a', '시아', 'room01', 1, { title: '  한판   하자  ' }), lm('b', '태완', 'room02', 2), lm('c', '손님', 'room01', 5, { title: '손님 이름' })]);
    expect(rooms.find((r) => r.code === 'room01')!.title).toBe('한판 하자');
    expect(rooms.find((r) => r.code === 'room02')!.title).toBe('태완의 방');
  });

  it('인원 1/2 · 2/2, 상태 대기중/경기중, 들어갈 수 있는 방은 대기중이면서 1/2뿐', () => {
    const rooms = roomsFrom([
      lm('a', 'A', 'wait01', 10),
      lm('b', 'B', 'full02', 20),
      lm('c', 'C', 'full02', 30),
      lm('d', 'D', 'play03', 5, { busy: true }),
      lm('e', 'E', 'play03', 6, { busy: true }),
      lm('f', 'F', 'solo04', 1, { busy: true }),
    ]);
    const by = Object.fromEntries(rooms.map((r) => [r.code, r]));
    expect(by.wait01).toMatchObject({ count: 1, busy: false, open: true });
    expect(by.full02).toMatchObject({ count: 2, busy: false, open: false });
    expect(by.play03).toMatchObject({ count: 2, busy: true, open: false });
    expect(by.solo04).toMatchObject({ count: 1, busy: true, open: false });
    // 들어갈 수 있는 방이 맨 위
    expect(rooms[0].code).toBe('wait01');
  });

  it('세 번째 사람이 잠깐 끼어도 인원은 2명까지만 센다', () => {
    const rooms = roomsFrom([lm('a', 'A', 'room01', 1), lm('b', 'B', 'room01', 2), lm('c', 'C', 'room01', 3)]);
    expect(rooms[0].count).toBe(2);
  });

  it('빈 방은 없다: 아무도 없으면 목록에서 사라진다. 이상한 방 코드는 무시', () => {
    expect(roomsFrom([lm('a', 'A', null), lm('b', 'B', null)])).toEqual([]);
    expect(roomsFrom([lm('a', 'A', 'x'), lm('b', 'B', 'BAD CODE!'), lm('c', 'C', '<script>')])).toEqual([]);
  });

  it('긴 이름·잘못된 캐릭터는 다듬는다', () => {
    const r = roomsFrom([lm('a', '아주아주아주아주긴이름입니다정말로', 'room01', 1, { char: 'unicorn' as never, title: 'x'.repeat(40) })])[0];
    expect(r.host.length).toBeLessThanOrEqual(12);
    expect(r.title.length).toBeLessThanOrEqual(16);
    expect(r.hostChar).toBe('tiger');
  });
});

describe('자리 정하기 (게임방)', () => {
  it('먼저 들어온 사람이 왼쪽(방장), 나중에 온 사람이 오른쪽', () => {
    const list = [mem('late', 200), mem('early', 100)];
    expect(hostOf(list)).toBe('early');
    expect(seatOf(list, 'early')).toBe(0);
    expect(seatOf(list, 'late')).toBe(1);
    expect(players(list).map((m) => m.id)).toEqual(['early', 'late']);
  });

  it('같은 시각에 들어오면 ID 순 (모든 기기가 같은 순서를 본다)', () => {
    expect(hostOf([mem('b', 100), mem('a', 100)])).toBe('a');
    expect(hostOf([mem('a', 100), mem('b', 100)])).toBe('a');
  });

  it('세 번째로 들어온 사람은 자리가 없다', () => {
    const list = [mem('a', 1), mem('b', 2), mem('c', 3)];
    expect(seatOf(list, 'c')).toBe(-1);
    expect(seatOf(list, 'nobody')).toBe(-1);
    expect(players(list)).toHaveLength(2);
  });

  it('방장이 나가면 남은 사람이 방장(왼쪽)이 되고, 새로 온 사람은 오른쪽', () => {
    const before = [mem('host', 1), mem('guest', 2)];
    const after = before.filter((m) => m.id !== 'host');
    expect(hostOf(after)).toBe('guest');
    expect(seatOf(after, 'guest')).toBe(0);
    const again = [...after, mem('new', 9)];
    expect(seatOf(again, 'guest')).toBe(0);
    expect(seatOf(again, 'new')).toBe(1);
    // 자리에서 밀려났던 세 번째 사람은, 한 명이 나가면 자리가 생긴다
    expect(seatOf([mem('a', 1), mem('c', 3)], 'c')).toBe(1);
  });

  it('둘 다 레디해야 시작한다 (혼자서는 시작하지 않는다)', () => {
    expect(bothReady([mem('a', 1, { ready: true })])).toBe(false);
    expect(bothReady([mem('a', 1, { ready: true }), mem('b', 2)])).toBe(false);
    expect(bothReady([mem('a', 1, { ready: true }), mem('b', 2, { ready: true })])).toBe(true);
    // 자리가 없는 세 번째 사람의 레디는 상관없다
    expect(bothReady([mem('a', 1, { ready: true }), mem('b', 2, { ready: true }), mem('c', 3)])).toBe(true);
    expect(bothReady([mem('a', 1, { ready: true }), mem('b', 2), mem('c', 3, { ready: true })])).toBe(false);
  });

  it('같은 캐릭터를 골라도 그대로 둔다', () => {
    const list = [mem('a', 1, { char: 'pig' }), mem('b', 2, { char: 'pig' })];
    expect(players(list).map((m) => m.char)).toEqual(['pig', 'pig']);
  });

  it('방 이름은 지금 방장의 것 (방장이 바뀌면 이름도 바뀐다)', () => {
    const list = [mem('시아', 1, { title: '한판 하자' }), mem('태완', 2)];
    expect(roomTitle(list)).toBe('한판 하자');
    expect(roomTitle(list.slice(1))).toBe('태완의 방');
    expect(roomTitle([])).toBe('');
    expect(cleanTitle('   ')).toBe('');
  });
});

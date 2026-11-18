import { describe, expect, it } from 'vitest';
import { ZODIAC_IDS } from '../src/game/constants';
import { aiChars, allReady, hostOf, makeSeats, players, raceHostOf, resolveChar, sortMembers, type MemberInfo } from '../src/net/seats';

const m = (id: string, at: number, char: MemberInfo['char'], ready = false, pickAt = at): MemberInfo => ({ id, name: id, char, ready, at, pickAt });

describe('방과 자리', () => {
  it('방은 항상 4자리: 혼자면 AI 3명, 사람이 들어올 때마다 AI가 1명 빠진다', () => {
    for (let n = 1; n <= 4; n++) {
      const members = Array.from({ length: n }, (_, i) => m(`u${i}`, 100 + i, ZODIAC_IDS[i]));
      const seats = makeSeats('room01', members);
      expect(seats).toHaveLength(4);
      expect(seats.filter((s) => s.id === null)).toHaveLength(4 - n);
      expect(seats.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
      // 캐릭터는 겹치지 않는다
      expect(new Set(seats.map((s) => s.char)).size).toBe(4);
    }
  });

  it('AI 캐릭터는 사람이 고르지 않은 것 중에서, 어느 기기에서나 같게', () => {
    const a = aiChars('abc123', ['tiger'], 3);
    expect(a).toEqual(aiChars('abc123', ['tiger'], 3));
    expect(a).not.toContain('tiger');
    expect(a).toHaveLength(3);
    expect(makeSeats('abc123', [m('u', 1, 'tiger')])[1].name).toMatch(/^AI /);
  });

  it('자리는 들어온 순서, 5번째부터는 자리가 없다', () => {
    const members = [m('e', 5, 'dog'), m('a', 1, 'rat'), m('c', 3, 'tiger'), m('b', 2, 'ox'), m('d', 4, 'pig')];
    expect(sortMembers(members).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(players(members).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(makeSeats('r', members).every((s) => s.id !== null)).toBe(true);
  });

  it('방장은 가장 먼저 들어온 사람, 나가면 다음 사람', () => {
    const members = [m('b', 2, 'ox'), m('a', 1, 'rat'), m('c', 3, 'tiger')];
    expect(hostOf(members)).toBe('a');
    expect(hostOf(members.filter((x) => x.id !== 'a'))).toBe('b');
    // 같은 시각이면 ID 순
    expect(hostOf([m('z', 1, 'ox'), m('y', 1, 'rat')])).toBe('y');
  });

  it('캐릭터는 선착순: 겹치면 늦게 고른 사람이 다음 빈 캐릭터로', () => {
    const first = m('a', 1, 'tiger', false, 10);
    const late = m('b', 2, 'tiger', false, 20);
    const all = [first, late];
    expect(resolveChar(first, all)).toBe('tiger');
    expect(resolveChar(late, all)).toBe('rabbit'); // 호랑이 다음 띠
    // 다음 띠도 차 있으면 그다음
    expect(resolveChar(late, [...all, m('c', 3, 'rabbit')])).toBe('dragon');
    // 겹치지 않으면 그대로
    expect(resolveChar(m('d', 4, 'pig'), all)).toBe('pig');
  });

  it('사람 전원이 레디해야 시작', () => {
    expect(allReady([])).toBe(false);
    expect(allReady([m('a', 1, 'rat', true)])).toBe(true);
    expect(allReady([m('a', 1, 'rat', true), m('b', 2, 'ox', false)])).toBe(false);
    expect(allReady([m('a', 1, 'rat', true), m('b', 2, 'ox', true)])).toBe(true);
    // 자리가 없는 5번째 사람의 레디는 보지 않는다
    const four = ['a', 'b', 'c', 'd'].map((id, i) => m(id, i, ZODIAC_IDS[i], true));
    expect(allReady([...four, m('e', 9, 'pig', false)])).toBe(true);
  });

  it('경기 중 기준 기기: 명단에서 접속해 있는 첫 사람 (나가거나 AI로 넘어가면 다음 사람)', () => {
    const roster = [
      { slot: 0, id: 'a' },
      { slot: 1, id: 'b' },
      { slot: 2, id: null },
      { slot: 3, id: null },
    ];
    const none = [false, false, false, false];
    expect(raceHostOf(roster, new Set(['a', 'b']), none)).toBe('a');
    expect(raceHostOf(roster, new Set(['b']), none)).toBe('b');
    expect(raceHostOf(roster, new Set(['a', 'b']), [true, false, false, false])).toBe('b');
    expect(raceHostOf(roster, new Set(), none)).toBeUndefined();
  });
});

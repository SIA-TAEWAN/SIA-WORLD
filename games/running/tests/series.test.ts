import { describe, expect, it } from 'vitest';
import { EMOTES, EMOTE_GAP_MS, EMOTE_RECV_GAP_MS, emoteReady, validEmote } from '../src/game/emote';
import { rankResults, type RaceEntry } from '../src/game/ranking';
import { addRound, cleanSeries, newSeries, pointsFor, seriesKey, shouldAdopt, standings } from '../src/game/series';

const roster = [
  { slot: 0, id: 'a', name: '가', char: 'tiger' as const },
  { slot: 1, id: 'b', name: '나', char: 'rat' as const },
  { slot: 2, id: null, name: 'AI 소', char: 'ox' as const },
  { slot: 3, id: null, name: 'AI 용', char: 'dragon' as const },
];
const fin = (slot: number, timeMs: number): RaceEntry => ({ slot, status: 'finish', timeMs, x: 100 });
const dnf = (slot: number, x: number): RaceEntry => ({ slot, status: 'dnf', timeMs: null, x });
const foul = (slot: number): RaceEntry => ({ slot, status: 'foul', timeMs: null, x: 0 });
const pts = (s: ReturnType<typeof newSeries>) => Object.fromEntries(s.rows.map((r) => [r.k, r.pts]));

describe('연속전 점수', () => {
  it('순위별 점수: 1등 4 · 2등 3 · 3등 2 · 4등 1, 완주하지 못하면 0', () => {
    expect([1, 2, 3, 4].map((place) => pointsFor({ place, status: 'finish' }))).toEqual([4, 3, 2, 1]);
    expect(pointsFor({ place: 2, status: 'dnf' })).toBe(0);
    expect(pointsFor({ place: 4, status: 'foul' })).toBe(0);
    expect(pointsFor({ place: 5, status: 'finish' })).toBe(0);
  });

  it('한 판을 더하면 사람·AI 모두 점수를 받고, 미완주·실격은 0점', () => {
    const res = rankResults([fin(0, 21000), dnf(1, 80), fin(2, 20000), foul(3)]);
    const s = addRound(newSeries(), 7, roster, res);
    expect(s.n).toBe(1);
    expect(pts(s)).toEqual({ 'u:a': 3, 'u:b': 0, 'ai:ox': 4, 'ai:dragon': 0 });
    expect(s.rows.find((r) => r.k === 'u:a')!.add).toBe(3);
  });

  it("'한 판 더'를 하면 쌓이고, 같은 판은 두 번 세지 않는다", () => {
    let s = addRound(newSeries(), 1, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    const again = addRound(s, 1, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    expect(again).toBe(s);
    s = addRound(s, 2, roster, rankResults([fin(1, 20000), fin(0, 21000), dnf(2, 50), fin(3, 23000)]));
    expect(s.n).toBe(2);
    expect(pts(s)).toEqual({ 'u:a': 7, 'u:b': 7, 'ai:ox': 2, 'ai:dragon': 3 });
    // add 는 마지막 판에서 얻은 점수
    expect(s.rows.map((r) => r.add)).toEqual([3, 4, 0, 2]);
    // 원래 점수판은 바뀌지 않는다 (순수 함수)
    expect(newSeries()).toEqual({ n: 0, done: [], rows: [] });
  });

  it('AI가 이어 달린 사람 자리는 0점, 결과가 비면 세지 않는다', () => {
    const res = rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]);
    const s = addRound(newSeries(), 1, roster, res, [false, true, false, false]);
    expect(pts(s)).toEqual({ 'u:a': 4, 'u:b': 0, 'ai:ox': 2, 'ai:dragon': 1 });
    const empty = newSeries();
    expect(addRound(empty, 2, roster, [])).toBe(empty);
  });

  it('사람이 바뀌어도 열쇠로 이어 센다: 새로 온 사람은 새 줄, 나간 사람 줄은 남는다', () => {
    let s = addRound(newSeries(), 1, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    const next = [roster[0], { slot: 1, id: 'c', name: '다', char: 'pig' as const }, roster[2], roster[3]];
    s = addRound(s, 2, next, rankResults([fin(1, 20000), fin(0, 21000), fin(2, 22000), fin(3, 23000)]));
    expect(pts(s)).toEqual({ 'u:a': 7, 'u:b': 3, 'ai:ox': 4, 'ai:dragon': 2, 'u:c': 4 });
    expect(s.rows.find((r) => r.k === 'u:b')!.add).toBe(0);
    expect(seriesKey({ id: null, char: 'ox' })).toBe('ai:ox');
  });

  it('누적 순위: 점수 높은 순, 같은 점수는 같은 순위', () => {
    let s = addRound(newSeries(), 1, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    s = addRound(s, 2, roster, rankResults([fin(1, 20000), fin(0, 21000), fin(2, 22000), fin(3, 23000)]));
    const t = standings(s);
    expect(t.map((r) => [r.k, r.pts, r.rank])).toEqual([
      ['u:a', 7, 1],
      ['u:b', 7, 1],
      ['ai:ox', 4, 3],
      ['ai:dragon', 2, 4],
    ]);
  });

  it('받은 점수판 검사: 모양이 틀리면 버리고, 이상한 줄은 뺀다', () => {
    const s = addRound(newSeries(), 1, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    expect(cleanSeries(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(cleanSeries(null)).toBeNull();
    expect(cleanSeries({ n: -1, done: [], rows: [] })).toBeNull();
    expect(cleanSeries({ n: 1, done: [], rows: 'x' })).toBeNull();
    const dirty = cleanSeries({
      n: 2,
      done: [1, 'x', 2.5, 2],
      rows: [
        { k: 'u:a', name: '가', char: 'tiger', pts: 5, add: 1 },
        { k: 'u:a', name: '겹침', char: 'tiger', pts: 9, add: 1 },
        { k: '<b>', name: '나', char: 'rat', pts: 1, add: 0 },
        { k: 'u:b', name: '나', char: 'nope', pts: 1, add: 0 },
        { k: 'u:c', name: '다', char: 'rat', pts: -3, add: 0 },
        { k: 'u:d', name: 5, char: 'rat', pts: 1, add: 0 },
        { k: 'ai:ox', name: '아주아주아주아주아주아주아주아주 긴 이름', char: 'ox', pts: 3, add: 3 },
      ],
    })!;
    expect(dirty.done).toEqual([1, 2]);
    expect(dirty.rows.map((r) => r.k)).toEqual(['u:a', 'ai:ox']);
    expect(dirty.rows[1].name.length).toBeLessThanOrEqual(16);
  });

  it('받은 점수판으로 바꾸기: 더 많은 판을 센 것, 같은 판 수면 방장 것만', () => {
    const one = addRound(newSeries(), 1, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    const two = addRound(one, 2, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    // 늦게 들어온 사람(0판)은 누구 것이든 받는다
    expect(shouldAdopt(newSeries(), two, false)).toBe(true);
    expect(shouldAdopt(one, two, false)).toBe(true);
    expect(shouldAdopt(two, one, true)).toBe(false);
    expect(shouldAdopt(one, one, false)).toBe(false);
    expect(shouldAdopt(one, one, true)).toBe(true);
    expect(shouldAdopt(newSeries(), newSeries(), true)).toBe(false);
  });

  it('내 것이 확정이 아니면(스스로 끝낸 판) 그 판을 센 같은 판 수의 다른 사람 것도 받는다', () => {
    const one = addRound(newSeries(), 3, roster, rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]));
    const other = addRound(newSeries(), 3, roster, rankResults([fin(1, 20000), fin(0, 21000), fin(2, 22000), fin(3, 23000)]));
    const elseRound = addRound(newSeries(), 2, roster, rankResults([fin(1, 20000), fin(0, 21000), fin(2, 22000), fin(3, 23000)]));
    expect(shouldAdopt(one, other, false, null)).toBe(false);
    expect(shouldAdopt(one, other, false, 3)).toBe(true);
    expect(shouldAdopt(one, elseRound, false, 3)).toBe(false);
    expect(shouldAdopt(one, newSeries(), false, 3)).toBe(false);
  });

  it('누적 순위는 지금 자리에 있는 열쇠만 골라 다시 매긴다', () => {
    let s = addRound(newSeries(), 1, roster, rankResults([fin(1, 20000), fin(0, 21000), fin(2, 22000), fin(3, 23000)]));
    const next = [roster[0], { slot: 1, id: 'c', name: '다', char: 'pig' as const }, roster[2], roster[3]];
    s = addRound(s, 2, next, rankResults([fin(2, 20000), fin(0, 21000), fin(1, 22000), fin(3, 23000)]));
    // 전체: b(4점) 가 나갔어도 줄은 남는다
    expect(standings(s).map((r) => [r.k, r.pts, r.rank])).toEqual([
      ['ai:ox', 6, 1],
      ['u:a', 6, 1],
      ['u:b', 4, 3],
      ['ai:dragon', 2, 4],
      ['u:c', 2, 4],
    ]);
    // 지금 자리: a, c, AI 둘 → b 가 빠지고 그 아래가 한 칸씩 올라온다
    expect(standings(s, next.map(seriesKey)).map((r) => [r.k, r.rank])).toEqual([
      ['ai:ox', 1],
      ['u:a', 1],
      ['ai:dragon', 3],
      ['u:c', 3],
    ]);
    expect(standings(s, [])).toEqual([]);
  });

  it('24줄이 차면 방에 없는(이번 판에 달리지 않은) 줄부터 버리고 새 줄을 넣는다', () => {
    let s = newSeries();
    const res = rankResults([fin(0, 20000), fin(1, 21000), fin(2, 22000), fin(3, 23000)]);
    // 사람 4명씩 6판 = 24줄
    for (let i = 0; i < 6; i++) s = addRound(s, i + 1, [0, 1, 2, 3].map((slot) => ({ slot, id: `p${i * 4 + slot}`, name: '이름', char: 'rat' as const })), res);
    expect(s.rows.length).toBe(24);
    // 마지막 판에 있던 둘 + 새 사람 둘
    const mixed = [
      { slot: 0, id: 'p22', name: '이름', char: 'rat' as const },
      { slot: 1, id: 'p23', name: '이름', char: 'rat' as const },
      { slot: 2, id: 'new1', name: '새', char: 'ox' as const },
      { slot: 3, id: 'new2', name: '새', char: 'pig' as const },
    ];
    s = addRound(s, 7, mixed, res);
    expect(s.rows.length).toBe(24);
    const keys = s.rows.map((r) => r.k);
    expect(keys).toContain('u:new1');
    expect(keys).toContain('u:new2');
    expect(keys).toContain('u:p22');
    // 가장 오래된, 방에 없는 줄 둘이 빠졌다
    expect(keys).not.toContain('u:p0');
    expect(keys).not.toContain('u:p1');
    expect(keys).toContain('u:p2');
  });
});

describe('짧은 말', () => {
  it('정해진 여섯 가지', () => {
    expect(EMOTES).toEqual(['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ']);
  });

  it('번호 검사: 범위 안의 정수만', () => {
    expect(validEmote(0)).toBe(true);
    expect(validEmote(EMOTES.length - 1)).toBe(true);
    for (const bad of [-1, EMOTES.length, 1.5, '1', null, undefined, NaN]) expect(validEmote(bad)).toBe(false);
  });

  it('보내기는 1.5초에 한 번', () => {
    expect(EMOTE_GAP_MS).toBe(1500);
    expect(emoteReady(0, 123)).toBe(true);
    expect(emoteReady(1000, 2499)).toBe(false);
    expect(emoteReady(1000, 2500)).toBe(true);
    // 받는 쪽은 조금 느슨하게 (몰려서 와도 받게)
    expect(EMOTE_RECV_GAP_MS).toBeLessThan(EMOTE_GAP_MS);
    expect(emoteReady(1000, 2100, EMOTE_RECV_GAP_MS)).toBe(true);
  });
});

describe('판 열쇠', () => {
  it('GO 시각(정수 ms)이 열쇠라 판 번호가 같아도 다른 판은 다르게 센다', async () => {
    const { roundKey } = await import('../src/game/series');
    expect(roundKey({ round: 1, goAt: 1000.4 })).toBe(1000);
    expect(roundKey({ round: 1, goAt: 1000 })).not.toBe(roundKey({ round: 1, goAt: 5000 }));
  });
});

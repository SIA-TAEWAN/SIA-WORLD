import { describe, expect, it } from 'vitest';
import { seededRng, type GameEvent, type SeatInfo } from './engine.ts';
import { poker, type PokerPublic, type PokerState } from './poker.ts';
import { bettingRound, pokerRoundStart, rewindPoker } from './poker-rewind.ts';

/** 화면에 그리는 값만 */
const shown = (p: PokerPublic) => ({
  phase: p.phase,
  round: p.round,
  pot: p.pot,
  curBet: p.curBet,
  turn: p.turn,
  showdown: p.showdown,
  winners: p.winners,
  seats: p.seats.map((s) => ({
    seat: s.seat,
    chosen: s.chosen,
    open: s.open,
    hiddenCount: s.hiddenCount,
    betRound: s.betRound,
    total: s.total,
    folded: s.folded,
    allIn: s.allIn,
    last: s.last,
    openLabel: s.openLabel,
  })),
});
const maxId = (p: PokerPublic) => p.events.reduce((a, e) => Math.max(a, e.id), 0);
const fresh = (p: PokerPublic, seen: number): GameEvent[] => p.events.filter((e) => e.id > seen);

/** AI끼리 한 판을 끝까지: 행동 하나마다 공개 상태를 남긴다 */
function playOut(seed: number, stacks: (number | null)[]): PokerPublic[] {
  const rng = seededRng(seed);
  const seats: SeatInfo[] = stacks.map((stack, i) => ({ seat: i, kind: 'ai', name: `P${i}`, stack }));
  let s: PokerState = poker.newRound({ seats, baseUnit: 100, carry: null, rng });
  const snaps = [poker.view(s).public];
  for (let n = 0; n < 200 && !poker.done(s); n++) {
    const seat = poker.pending(s)[0];
    const v = poker.view(s);
    s = poker.apply(s, seat, poker.ai(v.public, v.private[seat], seat, rng), rng);
    snaps.push(poker.view(s).public);
  }
  expect(poker.done(s)).toBe(true);
  return snaps;
}

describe('세븐포커 되돌리기 (한 동작씩 보여 주기)', () => {
  it('어느 구간을 되돌려도 실제로 지나온 화면과 같다', () => {
    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const stacks = seed % 3 === 0 ? [300, 5000, 800, null] : seed % 3 === 1 ? [null, null, null, null] : [2000, 400];
      const snaps = playOut(seed, stacks);
      for (let a = 0; a < snaps.length - 1; a++) {
        for (const b of [a + 1, Math.min(snaps.length - 1, a + 4), snaps.length - 1]) {
          const ev = fresh(snaps[b], maxId(snaps[a]));
          // 사건 기록이 잘렸으면 (30개 초과) 화면도 되돌리기를 쓰지 않는다
          if (!ev.length || ev[0].id !== maxId(snaps[a]) + 1) continue;
          const before = JSON.stringify(snaps[b]);
          const frames = rewindPoker(snaps[b], ev, snaps[a]);
          expect(JSON.stringify(snaps[b])).toBe(before);
          expect(frames).toHaveLength(ev.length);
          // 사이에 지나온 화면마다: 그 화면 다음 사건의 직전 화면과 같아야 한다
          for (let k = a; k < b; k++) {
            const idx = ev.findIndex((e) => e.id === maxId(snaps[k]) + 1);
            expect(shown(frames[idx]), `seed ${seed} ${a}→${b} @${k} (${ev[idx].t})`).toEqual(shown({ ...snaps[k], winners: [], showdown: null }));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('고르기 → 공개 → 4구 → 베팅이 한 걸음씩 나뉜다', () => {
    const rng = seededRng(5);
    const seats: SeatInfo[] = [0, 1, 2].map((i) => ({ seat: i, kind: 'ai', name: `P${i}`, stack: null }));
    let s = poker.newRound({ seats, baseUnit: 100, carry: null, rng });
    const start = poker.view(s).public;
    for (const seat of [0, 1, 2]) {
      const v = poker.view(s);
      s = poker.apply(s, seat, poker.ai(v.public, v.private[seat], seat, rng), rng);
    }
    const first = s.turn!;
    const v = poker.view(s);
    s = poker.apply(s, first, poker.ai(v.public, v.private[first], first, rng), rng);
    const pub = poker.view(s).public;
    const ev = fresh(pub, maxId(start));
    expect(ev.map((e) => e.t).slice(0, 7)).toEqual(['choose', 'choose', 'choose', 'reveal', 'deal', 'deal', 'deal']);
    const frames = rewindPoker(pub, ev, start);
    // 공개 직전: 모두 골랐지만 아직 뒷면 3장
    expect(frames[3].phase).toBe('choose');
    expect(frames[3].seats.map((x) => [x.open.length, x.hiddenCount, x.chosen])).toEqual([[0, 3, true], [0, 3, true], [0, 3, true]]);
    // 공개 직후 (4구 카드 전): 공개 카드 1장씩, 아직 아무도 베팅하지 않았다
    expect(frames[4].seats.map((x) => [x.open.length, x.hiddenCount])).toEqual([[1, 2], [1, 2], [1, 2]]);
    expect(frames[4].turn).toBeNull();
    // 첫 베팅 직전: 4구 카드까지 다 받았고 그 자리 차례
    expect(frames[7].seats.map((x) => x.open.length)).toEqual([2, 2, 2]);
    expect(frames[7].turn).toBe(first);
    expect(frames[7].pot).toBe(start.pot);
  });

  it('판 시작(앤티·첫 카드)은 되돌리지 않는다', () => {
    const rng = seededRng(2);
    const seats: SeatInfo[] = [0, 1].map((i) => ({ seat: i, kind: 'ai', name: `P${i}`, stack: null }));
    const pub = poker.view(poker.newRound({ seats, baseUnit: 100, carry: null, rng })).public;
    expect(() => rewindPoker(pub, pub.events)).toThrow();
  });

  it('서버가 공개한 상태는 round 칸이 방의 판 번호다 (몇 구가 아니다): 그래도 되돌린다 (몇 구인지는 단계·카드 수로 센다)', () => {
    let checked = 0;
    let deals = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const stacks = seed % 3 === 0 ? [300, 5000, 800, null] : seed % 3 === 1 ? [null, null, null, null] : [2000, 400];
      const snaps = playOut(seed, stacks);
      // 몇 구인지 다시 센 값이 엔진의 값과 늘 같다
      for (const p of snaps) expect(bettingRound(p), `seed ${seed} ${p.phase}`).toBe(p.round);
      // 판 진행기(runner)가 공개할 때처럼 round 칸을 방의 판 번호로 덮어쓴다
      const roomRound = 1 + (seed % 9);
      const served = snaps.map((p) => ({ ...p, round: roomRound }));
      for (let a = 1; a < snaps.length - 1; a++) {
        for (const b of [a + 1, Math.min(snaps.length - 1, a + 6), snaps.length - 1]) {
          const ev = fresh(served[b], maxId(served[a]));
          if (!ev.length || ev[0].id !== maxId(served[a]) + 1 || pokerRoundStart(ev)) continue;
          const frames = rewindPoker(served[b], ev, served[a]);
          expect(frames).toHaveLength(ev.length);
          deals += ev.filter((e) => e.t === 'deal').length;
          for (let k = a; k < b; k++) {
            const idx = ev.findIndex((e) => e.id === maxId(snaps[k]) + 1);
            // 화면 값은 엔진이 실제로 지나온 화면과 같다 (round 도 몇 구로 돌아와 있다)
            expect(shown(frames[idx]), `seed ${seed} ${a}→${b} @${k} (${ev[idx].t})`).toEqual(shown({ ...snaps[k], winners: [], showdown: null }));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(deals).toBeGreaterThan(100);
  });

  it('판 시작 묶음인지 미리 가른다 (화면은 그때 되돌리기를 부르지 않는다)', () => {
    const snaps = playOut(4, [null, null, null]);
    expect(pokerRoundStart(snaps[0].events)).toBe(true);
    // 판 시작 뒤의 사건만 든 묶음은 아니다
    const later = fresh(snaps[snaps.length - 1], maxId(snaps[0]));
    expect(later.length).toBeGreaterThan(5);
    expect(pokerRoundStart(later)).toBe(false);
    expect(pokerRoundStart([])).toBe(false);
  });
});

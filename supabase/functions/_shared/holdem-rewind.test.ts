import { describe, expect, it } from 'vitest';
import { seededRng, type GameEvent, type SeatInfo } from './engine.ts';
import { holdem, type HoldemPublic, type HoldemState } from './holdem.ts';
import { rewindHoldem } from './holdem-rewind.ts';

/** 화면에 그리는 값만 */
const shown = (p: HoldemPublic) => ({
  phase: p.phase,
  board: p.board,
  pot: p.pot,
  curBet: p.curBet,
  turn: p.turn,
  runout: p.runout,
  showdown: p.showdown,
  winners: p.winners,
  seats: p.seats.map((s) => ({
    seat: s.seat,
    folded: s.folded,
    allIn: s.allIn,
    betRound: s.betRound,
    total: s.total,
    stackLeft: s.stackLeft,
    holeCount: s.holeCount,
    last: s.last,
  })),
});
const maxId = (p: HoldemPublic) => p.events.reduce((a, e) => Math.max(a, e.id), 0);
const fresh = (p: HoldemPublic, seen: number): GameEvent[] => p.events.filter((e) => e.id > seen);

/** 한 판을 끝까지: 행동 하나마다 공개 상태를 남긴다 */
function playOut(seed: number): HoldemPublic[] {
  const rng = seededRng(seed);
  const n = 2 + rng.int(3);
  const seats: SeatInfo[] = Array.from({ length: n }, (_, i) =>
    rng.next() < 0.5 ? { seat: i, kind: 'ai', name: `AI${i}`, stack: null } : { seat: i, kind: 'human', name: `P${i}`, stack: 400 + rng.int(20_000) },
  );
  let s: HoldemState = holdem.newRound({ seats, baseUnit: 100, carry: { button: rng.int(n) }, rng });
  const snaps = [holdem.view(s).public];
  for (let k = 0; k < 200 && !holdem.done(s); k++) {
    const seat = holdem.pending(s)[0];
    const v = holdem.view(s);
    s = holdem.apply(s, seat, holdem.ai(v.public, v.private[seat], seat, rng), rng);
    snaps.push(holdem.view(s).public);
  }
  expect(holdem.done(s)).toBe(true);
  return snaps;
}

describe('홀덤 되돌리기 (한 동작씩 보여 주기)', () => {
  it('어느 구간을 되돌려도 실제로 지나온 화면과 같다', () => {
    let checked = 0;
    let streets = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const snaps = playOut(seed);
      for (let a = 0; a < snaps.length - 1; a++) {
        if (snaps[a].phase === 'done') continue;
        for (const b of [a + 1, Math.min(snaps.length - 1, a + 4), snaps.length - 1]) {
          const ev = fresh(snaps[b], maxId(snaps[a]));
          // 사건 기록이 잘렸으면 화면도 되돌리기를 쓰지 않는다
          if (!ev.length || ev[0].id !== maxId(snaps[a]) + 1) continue;
          const before = JSON.stringify(snaps[b]);
          const frames = rewindHoldem(snaps[b], ev, snaps[a]);
          expect(JSON.stringify(snaps[b])).toBe(before);
          expect(frames).toHaveLength(ev.length);
          for (let k = a; k < b; k++) {
            const idx = ev.findIndex((e) => e.id === maxId(snaps[k]) + 1);
            expect(shown(frames[idx]), `seed ${seed} ${a}→${b} @${k} (${ev[idx].t})`).toEqual(shown(snaps[k]));
            checked++;
          }
          // 공용 카드가 깔리기 직전 화면: 그 카드는 아직 없고 아무 차례도 아니다
          ev.forEach((e, i) => {
            if (e.t !== 'flop' && e.t !== 'turn' && e.t !== 'river') return;
            expect(frames[i].board).toHaveLength(e.t === 'flop' ? 0 : e.t === 'turn' ? 3 : 4);
            expect(frames[i].turn).toBeNull();
            streets++;
          });
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(streets).toBeGreaterThan(100);
  });

  it('판 시작(블라인드·첫 카드)은 되돌리지 않는다', () => {
    const rng = seededRng(2);
    const seats: SeatInfo[] = [0, 1, 2].map((i) => ({ seat: i, kind: 'ai', name: `P${i}`, stack: null }));
    const pub = holdem.view(holdem.newRound({ seats, baseUnit: 100, carry: null, rng })).public;
    expect(() => rewindHoldem(pub, pub.events)).toThrow();
  });
});

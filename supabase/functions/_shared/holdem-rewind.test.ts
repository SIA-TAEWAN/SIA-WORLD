import { describe, expect, it } from 'vitest';
import { seededRng, type GameEvent, type SeatInfo } from './engine.ts';
import { holdem, type HoldemPublic, type HoldemState } from './holdem.ts';
import { holdemRoundStart, rewindHoldem } from './holdem-rewind.ts';

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

  it('올인 runout: runout 부터 남은 사람 패를 펼치고 (족보 없이), 쇼다운에서 족보를 붙인다. 접은 사람 패는 끝까지 비공개', () => {
    const seats: SeatInfo[] = [
      { seat: 0, kind: 'human', name: 'P0', stack: 100_000 },
      { seat: 1, kind: 'human', name: 'P1', stack: 1000 },
      { seat: 2, kind: 'human', name: 'P2', stack: 100_000 },
    ];
    const rng = seededRng(5);
    let s: HoldemState = holdem.newRound({ seats, baseUnit: 100, carry: { button: 2 }, rng }); // 버튼 0 · SB 1 · BB 2 → 0 부터
    s = holdem.apply(s, 0, { type: 'fold' }, rng);
    s = holdem.apply(s, 1, { type: 'allin' }, rng);
    const prev = holdem.view(s).public;
    s = holdem.apply(s, 2, { type: 'call' }, rng);
    const next = holdem.view(s).public;
    const ev = fresh(next, maxId(prev));
    const frames = rewindHoldem(next, ev, prev);
    const ro = ev.findIndex((e) => e.t === 'runout');
    const sd = ev.findIndex((e) => e.t === 'showdown');
    expect(ro).toBeGreaterThan(0);
    expect(sd).toBeGreaterThan(ro);
    const holes = next.showdown!.map((h) => ({ seat: h.seat, cards: h.cards }));
    expect(holes.map((h) => h.seat)).toEqual([1, 2]);
    frames.forEach((f, i) => {
      // frames[i] = ev[i] 직전 화면
      if (i <= ro) expect(f.showdown, `@${i} ${ev[i].t}`).toBeNull();
      else if (i <= sd) expect(f.showdown, `@${i} ${ev[i].t}`).toEqual(holes.map((h) => ({ ...h, hand: '', best: [] })));
      else expect(f.showdown, `@${i} ${ev[i].t}`).toEqual(next.showdown);
      if (i > ro) expect(f.runout).toBe(true);
      for (const c of s.players[0].hole) expect(JSON.stringify(f).includes(`"${c}"`)).toBe(false);
    });
    // runout 중 깐 카드 직전 화면: 카드는 아직 없고 패는 펼쳐져 있다
    const riv = ev.findIndex((e) => e.t === 'river');
    expect(riv).toBeGreaterThan(ro);
    expect(frames[riv].board).toHaveLength(4);
  });

  it('판 시작(블라인드·첫 카드)은 되돌리지 않는다', () => {
    const rng = seededRng(2);
    const seats: SeatInfo[] = [0, 1, 2].map((i) => ({ seat: i, kind: 'ai', name: `P${i}`, stack: null }));
    const pub = holdem.view(holdem.newRound({ seats, baseUnit: 100, carry: null, rng })).public;
    expect(() => rewindHoldem(pub, pub.events)).toThrow();
  });

  it('판 시작 묶음인지 미리 가른다 (화면은 그때 되돌리기를 부르지 않는다). 그 밖의 묶음은 모두 되돌려진다', () => {
    let tried = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const snaps = playOut(seed);
      expect(holdemRoundStart(snaps[0].events)).toBe(true);
      for (let a = 0; a < snaps.length - 1; a++) {
        const ev = fresh(snaps[snaps.length - 1], maxId(snaps[a]));
        if (!ev.length || ev[0].id !== maxId(snaps[a]) + 1) continue;
        expect(holdemRoundStart(ev)).toBe(false);
        expect(() => rewindHoldem(snaps[snaps.length - 1], ev, snaps[a])).not.toThrow();
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(100);
    expect(holdemRoundStart([])).toBe(false);
  });
});

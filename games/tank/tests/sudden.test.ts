import { describe, expect, it } from 'vitest';
import { Match, SUDDEN_DAMAGE, SUDDEN_DROWN, SUDDEN_GAP, SUDDEN_RISE, SUDDEN_TURN } from '../src/game/match';
import type { PlayerSetup, TurnInput } from '../src/game/types';
import { autoplay } from '../src/ai/autoplay';
import { decideMove, fleeWater } from '../src/ai/ai';
import { Rng } from '../src/game/rng';
import { allAtLeast, CLIENT_VERSION, SUDDEN_VERSION } from '../src/net/room';
import type { MapId } from '../src/data/maps';

const duo = (ai: PlayerSetup['ai'] = null): PlayerSetup[] => [
  { name: 'A', tank: 'tiger', team: 0, ai, items: ['repair'] },
  { name: 'B', tank: 'sheep', team: 1, ai, items: [] },
];
const quad = (): PlayerSetup[] => [
  { name: 'A', tank: 'tiger', team: 0, ai: null, items: [] },
  { name: 'B', tank: 'sheep', team: 1, ai: null, items: [] },
  { name: 'C', tank: 'ox', team: 0, ai: null, items: [] },
  { name: 'D', tank: 'rabbit', team: 1, ai: null, items: [] },
];
const shot = (m: Match, i: number): TurnInput => ({ angle: 30 + ((i * 7) % 40), facing: m.cur.x < m.terrain.w / 2 ? 1 : -1, power: 35 + ((i * 13) % 50), weapon: (i % 2) as 0 | 1, itemSlot: null });

/** 쏘지 않고 n턴을 넘긴다 (끝나면 멈춘다) */
function pass(m: Match, n: number) {
  for (let i = 0; i < n && !m.over; i++) {
    m.startTurn();
    if (m.over) break;
    m.skipTurn();
  }
}

describe('서든데스 전', () => {
  it('켠 판과 끈 판은 서든데스 턴까지 지문·상태가 똑같다', () => {
    for (const map of ['valley', 'sky', 'sphinx'] as MapId[]) {
      const on = new Match(duo(), map, 4242, { sudden: SUDDEN_TURN });
      const off = new Match(duo(), map, 4242);
      for (let i = 0; i < SUDDEN_TURN && !on.over && !off.over; i++) {
        on.startTurn();
        off.startTurn();
        expect(on.lastFlood).toBeNull();
        // 조금 걷고 쏜다
        for (let k = 0; k < 6; k++) {
          const dir = i % 2 ? 1 : -1;
          expect(on.moveStep(dir)).toBe(off.moveStep(dir));
        }
        if (on.over) break;
        const input = shot(on, i);
        expect(JSON.stringify(on.fire(input))).toBe(JSON.stringify(off.fire(input)));
        expect(on.stateHash()).toBe(off.stateHash());
        expect(on.stateHash()).not.toMatch(/\|w-?\d+$/);
        expect(on.water).toBeNull();
        const a = on.snapshot();
        const b = off.snapshot();
        expect(JSON.stringify({ ...a, options: null })).toBe(JSON.stringify({ ...b, options: null }));
      }
    }
  }, 60_000);

  it('AI끼리 붙은 판도 물이 오기 전에 끝나면 결과가 같다', () => {
    let checked = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const off = autoplay('tiger', 'sheep', 'valley', seed * 7919, 'normal', true);
      if (off.turns > SUDDEN_TURN) continue;
      checked++;
      expect(autoplay('tiger', 'sheep', 'valley', seed * 7919, 'normal', true, SUDDEN_TURN)).toEqual(off);
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it('남은 턴 수를 알려 준다 (끈 판은 null)', () => {
    const m = new Match(duo(), 'valley', 5, { sudden: SUDDEN_TURN });
    expect(m.suddenIn).toBe(SUDDEN_TURN);
    pass(m, 3);
    expect(m.suddenIn).toBe(SUDDEN_TURN - 3);
    expect(new Match(duo(), 'valley', 5).suddenIn).toBeNull();
    expect(new Match(duo(), 'valley', 5, { sudden: 0 }).suddenIn).toBeNull();
  }, 60_000);

  it('백발백중에는 서든데스가 없다', () => {
    const m = new Match(duo(), 'target', 5, { sudden: 1 });
    expect(m.suddenTurn).toBe(0);
    pass(m, 4);
    expect(m.water).toBeNull();
  }, 60_000);
});

describe('서든데스', () => {
  it('정해진 턴이 지나면 가장 낮은 탱크 발밑 아래에서 물이 나타나고 턴마다 오른다', () => {
    const m = new Match(duo(), 'valley', 99, { sudden: SUDDEN_TURN });
    pass(m, SUDDEN_TURN);
    expect(m.turn).toBe(SUDDEN_TURN);
    expect(m.water).toBeNull();
    const low = Math.max(...m.tanks.map((t) => t.y));
    m.startTurn();
    expect(m.turn).toBe(SUDDEN_TURN + 1);
    expect(m.lastFlood).toEqual({ level: low + SUDDEN_GAP, first: true, hits: [] });
    expect(m.water).toBe(low + SUDDEN_GAP);
    expect(m.stateHash().endsWith(`|w${low + SUDDEN_GAP}`)).toBe(true);
    m.skipTurn();
    m.startTurn();
    // 둘이 살아 있으면 한 턴에 절반씩
    expect(m.water).toBe(low + SUDDEN_GAP - SUDDEN_RISE / 2);
    expect(m.lastFlood!.first).toBe(false);
  }, 60_000);

  it('발이 잠기면 턴마다 피해, 몸이 다 잠기면 탈락한다 (방어력·체력 1 남기기 없음)', () => {
    const m = new Match(duo(), 'valley', 99, { sudden: 1 });
    pass(m, 1);
    const [a, b] = m.tanks;
    // 수면을 A 발밑 바로 위로 옮겨 놓고 한 번 올린다
    const hi = a.y < b.y ? a : b;
    const lo = hi === a ? b : a;
    m.water = hi.y + SUDDEN_RISE / 2 - 1; // 다음에 hi 발이 1px 잠긴다
    const loDepth = lo.y - (m.water - SUDDEN_RISE / 2);
    const hpHi = hi.hp;
    m.startTurn();
    const per = Math.round((hi.maxHp * SUDDEN_DAMAGE) / 2);
    expect(hi.hp).toBe(hpHi - per);
    expect(m.lastFlood!.hits.find((h) => h.target === hi.idx)).toEqual({ target: hi.idx, amount: per, dead: false });
    if (loDepth >= SUDDEN_DROWN) {
      expect(lo.alive).toBe(false);
      expect(m.winner).toBe(hi.team);
    }
    // 깊이 잠긴 탱크는 바로 탈락
    const m2 = new Match(duo(), 'valley', 99, { sudden: 1 });
    pass(m2, 1);
    const t = m2.tanks[0];
    m2.water = t.y - SUDDEN_DROWN + SUDDEN_RISE / 2;
    const turn = m2.turn;
    m2.startTurn();
    expect(t.alive).toBe(false);
    expect(t.hp).toBe(0);
    expect(m2.lastFlood!.hits.some((h) => h.target === 0 && h.dead)).toBe(true);
    // 물로 판이 끝나면 새 턴은 시작하지 않는다
    if (m2.over) expect(m2.turn).toBe(turn);
  }, 60_000);

  it('아무도 쏘지 않아도 판이 반드시 끝난다 (모든 맵, 2명·4명)', () => {
    for (const map of ['valley', 'sky', 'sphinx', 'ledge'] as MapId[]) {
      for (const setups of [duo(), quad()]) {
        for (const seed of [1, 22, 333]) {
          const m = new Match(setups, map, seed, { sudden: SUDDEN_TURN });
          pass(m, 400);
          expect(m.over).toBe(true);
          // 맵 높이(800)를 한 바퀴에 20씩 오르면 넉넉히 이 안에 끝난다
          expect(m.turn).toBeLessThan(SUDDEN_TURN + 200);
        }
      }
    }
  }, 60_000);

  it('높은 곳에 선 쪽이 이긴다', () => {
    const m = new Match(duo(), 'valley', 99, { sudden: 1 });
    pass(m, 1);
    const [a, b] = m.tanks;
    if (Math.abs(a.y - b.y) < SUDDEN_DROWN) return; // 높이가 비슷한 시드면 건너뛴다
    const hi = a.y < b.y ? a : b;
    pass(m, 400);
    expect(m.winner).toBe(hi.team);
  }, 60_000);

  it('같은 입력이면 물이 찬 뒤에도 결과가 같고, 판 상태를 주고받아도 이어진다', () => {
    const run = (viaSnap: boolean) => {
      let m = new Match(duo(), 'sphinx', 31337, { sudden: 4 });
      const hashes: string[] = [];
      for (let i = 0; i < 40 && !m.over; i++) {
        m.startTurn();
        if (m.over) break;
        m.fire(shot(m, i));
        hashes.push(m.stateHash());
        if (viaSnap && i % 3 === 2) m = Match.fromSnapshot(JSON.parse(JSON.stringify(m.snapshot())));
      }
      return { hashes, winner: m.winner, water: m.water };
    };
    const a = run(false);
    expect(run(false)).toEqual(a);
    expect(run(true)).toEqual(a);
    expect(a.water).not.toBeNull();
  }, 60_000);

  it('예전 판본이 보낸 판 상태(수위·설정 없음)는 서든데스 없이 이어진다', () => {
    const m = new Match(duo(), 'valley', 8);
    pass(m, 2);
    const snap = JSON.parse(JSON.stringify(m.snapshot()));
    delete snap.water;
    delete snap.options;
    const r = Match.fromSnapshot(snap);
    expect(r.water).toBeNull();
    expect(r.suddenTurn).toBe(0);
    expect(r.stateHash()).toBe(m.stateHash());
  }, 60_000);
});

describe('AI는 물을 피한다', () => {
  it('probeWalk 는 moveStep 과 같은 자리를 돌려준다', () => {
    for (const map of ['valley', 'sphinx', 'sky'] as MapId[]) {
      for (const dir of [1, -1] as const) {
        const m = new Match(duo(), map, 606);
        m.startTurn();
        const hash = m.stateHash();
        const path = m.probeWalk(dir);
        expect(m.stateHash()).toBe(hash);
        const real: { x: number; y: number }[] = [];
        while (m.moveStep(dir) && m.cur.alive) real.push({ x: m.cur.x, y: m.cur.y });
        expect(path).toEqual(real);
      }
    }
  }, 60_000);

  it('물이 없으면 피하지 않고, 물이 가까우면 더 높은 곳으로 간다', () => {
    let fled = 0;
    for (const seed of [3, 14, 159, 2653]) {
      const m = new Match(duo('normal'), 'valley', seed, { sudden: 1 });
      m.startTurn();
      expect(fleeWater(m)).toBeNull();
      m.skipTurn();
      m.startTurn();
      const me = m.cur;
      m.water = me.y + 5;
      const y0 = me.y;
      const mv = fleeWater(m);
      if (mv === null) continue;
      fled++;
      expect(decideMove(m, 'normal', new Rng(1))).toBe(mv);
      expect(decideMove(m, 'easy', new Rng(1))).toBe(mv);
      for (let i = 0; i < Math.abs(mv); i++) m.moveStep(mv > 0 ? 1 : -1);
      expect(me.alive).toBe(true);
      expect(me.y).toBeLessThanOrEqual(y0 - 3);
    }
    expect(fled).toBeGreaterThan(0);
  }, 60_000);

  it('물이 아직 멀면 평소대로 움직인다', () => {
    const m = new Match(duo('normal'), 'valley', 3, { sudden: 1 });
    m.startTurn();
    m.water = m.cur.y + 200;
    expect(fleeWater(m)).toBeNull();
  }, 60_000);

  it('AI끼리 붙은 판은 서든데스가 있으면 턴 수 한도 안에 끝난다', () => {
    for (let seed = 1; seed <= 2; seed++) {
      const r = autoplay('ox', 'pig', 'valley', seed * 104729, 'easy', false, SUDDEN_TURN);
      expect(r.turns).toBeLessThan(SUDDEN_TURN + 120);
    }
  }, 120_000);
});

describe('판본이 섞인 방', () => {
  it('모든 기기가 서든데스를 아는 판본일 때만 켠다', () => {
    const vers = new Map([['a', CLIENT_VERSION], ['b', CLIENT_VERSION], ['old', 1], ['none', 0]]);
    expect(CLIENT_VERSION).toBeGreaterThanOrEqual(SUDDEN_VERSION);
    expect(allAtLeast(['a', 'b'], vers, 'a', SUDDEN_VERSION)).toBe(true);
    expect(allAtLeast(['a', 'b', 'old'], vers, 'a', SUDDEN_VERSION)).toBe(false);
    expect(allAtLeast(['a', 'none'], vers, 'a', SUDDEN_VERSION)).toBe(false);
    // 접속 정보가 안 보이는 사람이 있으면 끈다 (예전 탭일 수 있다)
    expect(allAtLeast(['a', 'ghost'], vers, 'a', SUDDEN_VERSION)).toBe(false);
    // 나는 접속 목록에 없어도 지금 판본이다
    expect(allAtLeast(['me', 'a'], vers, 'me', SUDDEN_VERSION)).toBe(true);
  }, 60_000);
});

import { afterEach, describe, expect, it } from 'vitest';
import { GROUND_Y, MOVE_SPEED, PLAYER_MAX_X, PLAYER_MIN_X, START_X, STEP_MS } from '../src/game/constants';
import { aiInput, makeAi } from '../src/game/ai';
import { NO_INPUT, cloneState, createState, step, stepPlayerOnly, type Input, type PlayerState } from '../src/game/sim';
import {
  EXTRAPOLATE_MAX, LINK_LOST_MS, LINK_WAIT_MS, SNAP_DIST, carryOffset, cleanPlayer, decayOffset, extrapolatePlayer, linkState, makeSnapshot, repredict, snapshotEvents,
  validSnapshot, type OwnFrame,
} from '../src/game/sync';
import type { NetMsg } from '../src/net/channel';
import type { MatchResult, MatchSetup } from '../src/match/game';
import { OnlineMatch } from '../src/match/online';

const key = (left = false, right = false, jump = false): Input => ({ left, right, jump });
const ground = (x: number): PlayerState => ({ x, y: GROUND_Y, vx: 0, vy: 0, ground: true });

describe('상대 캐릭터 이어 움직이기', () => {
  it('보낸 틱부터 지금 틱까지 같은 조작으로 움직인다 (실제 계산과 같다)', () => {
    const p = ground(500);
    const real = { ...p };
    for (let i = 0; i < 6; i++) stepPlayerOnly(real, 1, key(true, false, true));
    expect(extrapolatePlayer({ tick: 100, p, in: key(true, false, true) }, 1, 106)).toEqual(real);
    // 틱이 같으면 그대로
    expect(extrapolatePlayer({ tick: 100, p, in: key(true) }, 1, 100)).toEqual(p);
    // 지금보다 앞선 소식이어도 뒤로 돌리지 않는다
    expect(extrapolatePlayer({ tick: 100, p, in: key(true) }, 1, 97)).toEqual(p);
  });

  it('너무 오래된 소식이면 한도까지만 움직이고 멈춘다 (계속 걸어가지 않는다)', () => {
    const out = extrapolatePlayer({ tick: 0, p: ground(600), in: key(true) }, 1, 500);
    expect(out.x).toBe(600 - MOVE_SPEED * EXTRAPOLATE_MAX);
    expect(out.vx).toBe(0);
  });

  it('코트 밖·이상한 값은 안으로 당긴다', () => {
    expect(cleanPlayer({ x: -999, y: 99999, vx: 80, vy: NaN, ground: false }, 1)).toEqual({ x: PLAYER_MIN_X[1], y: GROUND_Y, vx: 5, vy: 0, ground: true });
    expect(cleanPlayer({ x: 9999, y: -500, vx: 0, vy: -99, ground: true }, 0)).toMatchObject({ x: PLAYER_MAX_X[0], ground: false, vy: -14 });
    expect(extrapolatePlayer({ tick: 0, p: { x: 100, y: GROUND_Y, vx: 0, vy: 0, ground: true }, in: key(true) }, 1, 3).x).toBe(PLAYER_MIN_X[1]);
  });
});

describe('스냅샷에서 다시 계산하기 (상대 기기)', () => {
  /** 방장 쪽 진짜 경기를 돌리면서, 상대(오른쪽)의 기록을 남긴다 */
  function world(ticks: number, seed = 5) {
    const s = createState(seed);
    const own = new Map<number, OwnFrame>();
    const left = makeAi(0, 11);
    const right = makeAi(1, 22);
    const hostIns: Input[] = [];
    const states = [cloneState(s)];
    for (let t = 0; t < ticks; t++) {
      const il = aiInput(left, s);
      const ir = aiInput(right, s);
      own.set(t, { p: { ...s.players[1] }, in: { ...ir } });
      hostIns.push({ ...il });
      step(s, [il, ir]);
      states.push(cloneState(s));
    }
    return { own, hostIns, states };
  }

  it('방장 조작이 그동안 바뀌지 않았으면, 다시 계산한 결과는 방장의 실제 상태와 똑같다', () => {
    const { own, hostIns, states } = world(600);
    let checked = 0;
    for (let t = 20; t < 580; t += 7) {
      const age = 8;
      // 그 사이 방장 조작이 그대로이고 경기가 이어진 구간만
      const same = hostIns.slice(t, t + age).every((i) => JSON.stringify(i) === JSON.stringify(hostIns[t - 1]));
      if (!same || states[t].phase !== 'play') continue;
      const snap = makeSnapshot(states[t], hostIns[t - 1], [0, 0]);
      const out = repredict(snap, own, states[t + age].players[1], t + age);
      expect(out).toEqual(states[t + age]);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('스냅샷이 지금 틱이면 스냅샷 그대로 (내 캐릭터는 내 기록)', () => {
    const { own, hostIns, states } = world(200);
    const snap = makeSnapshot(states[150], hostIns[149], [3, 2]);
    const out = repredict(snap, own, states[150].players[1], 150);
    expect(out.ball).toEqual(states[150].ball);
    expect(out.players).toEqual(states[150].players);
    expect(out.tick).toBe(150);
  });

  it('점수·서브·단계는 스냅샷(방장) 값을 따른다', () => {
    const s = createState(1);
    s.score = [2, 1];
    s.server = 1;
    s.stage = 3;
    s.rallyTicks = 1900;
    const out = repredict(makeSnapshot(s, NO_INPUT, [0, 0]), new Map(), s.players[1], s.tick);
    expect(out.score).toEqual([2, 1]);
    expect(out.server).toBe(1);
    expect(out.stage).toBe(3);
    expect(out.rallyTicks).toBe(1900);
  });

  it('받은 스냅샷 모양 확인', () => {
    expect(validSnapshot(makeSnapshot(createState(1), NO_INPUT, [0, 0]))).toBe(true);
    expect(validSnapshot(null)).toBe(false);
    expect(validSnapshot({ tick: 1 })).toBe(false);
    expect(validSnapshot({ ...makeSnapshot(createState(1), NO_INPUT, [0, 0]), ball: { x: NaN, y: 0, vx: 0, vy: 0 } })).toBe(false);
  });
});

describe('보정: 작으면 부드럽게, 크면 바로', () => {
  it('차이가 작으면 그 차이를 들고 있다가 조금씩 줄인다', () => {
    let off = carryOffset({ x: 110, y: 205 }, { x: 100, y: 200 });
    expect(off).toEqual({ x: 10, y: 5 });
    const sizes: number[] = [];
    for (let i = 0; i < 40; i++) {
      off = decayOffset(off);
      sizes.push(Math.hypot(off.x, off.y));
    }
    // 계속 줄어들고, 0.2초(12틱) 뒤에는 1px 안쪽, 끝내 0
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    expect(sizes[11]).toBeLessThan(1);
    expect(off).toEqual({ x: 0, y: 0 });
  });

  it('차이가 크면 바로 맞춘다 (차이 0)', () => {
    expect(carryOffset({ x: 100 + SNAP_DIST + 1, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(carryOffset({ x: 100 + SNAP_DIST - 1, y: 0 }, { x: 100, y: 0 })).toEqual({ x: SNAP_DIST - 1, y: 0 });
    expect(carryOffset({ x: 130, y: 0 }, { x: 100, y: 0 }, 20)).toEqual({ x: 0, y: 0 });
  });

  it('보이는 자리는 이어진다: 보정 직후 (새 자리 + 차이) = 보이던 자리', () => {
    const shown = { x: 321.5, y: 410.25 };
    const next = { x: 300, y: 400 };
    const off = carryOffset(shown, next);
    expect(next.x + off.x).toBeCloseTo(shown.x, 9);
    expect(next.y + off.y).toBeCloseTo(shown.y, 9);
  });
});

describe('스냅샷으로 알리는 일 (점수·서브·가속·끝은 방장 값만)', () => {
  const base = () => makeSnapshot(createState(1), NO_INPUT, [0, 0]);
  it('점수가 오르면 득점, 멈췄다가 다시 시작하면 서브, 단계가 오르면 가속, 승자가 정해지면 끝', () => {
    const a = { ...base(), rallyTicks: 500 };
    expect(snapshotEvents(a, { ...a, tick: 9, rallyTicks: 503 })).toEqual([]);
    const pt = { ...a, tick: 10, phase: 'point' as const, score: [0, 1] as [number, number], ball: { x: 123, y: 752, vx: 0, vy: 0 } };
    expect(snapshotEvents(a, pt)).toEqual([{ t: 'point', side: 1, x: 123 }]);
    const serve = { ...pt, tick: 100, phase: 'play' as const, rallyTicks: 1, server: 0 as const };
    expect(snapshotEvents(pt, serve)).toEqual([{ t: 'serve', side: 0 }]);
    expect(snapshotEvents(a, { ...a, tick: 20, stage: 1, rallyTicks: 600 })).toEqual([{ t: 'speedup', stage: 1 }]);
    const over = { ...a, tick: 30, phase: 'over' as const, score: [3, 0] as [number, number], winner: 0 as const };
    expect(snapshotEvents({ ...a, score: [2, 0] }, over)).toEqual([{ t: 'point', side: 0, x: over.ball.x }, { t: 'over', winner: 0 }]);
  });
  it('득점 스냅샷을 놓치고 다음 서브 스냅샷만 받아도 득점과 서브를 모두 알린다', () => {
    const a = { ...base(), rallyTicks: 500 };
    const serve = { ...a, tick: 200, score: [1, 0] as [number, number], rallyTicks: 4, server: 1 as const };
    expect(snapshotEvents(a, serve).map((e) => e.t)).toEqual(['point', 'serve']);
  });
});

describe('이탈 판정 (상대 소식이 끊긴 시간)', () => {
  it('2초 미만은 정상, 2초부터 기다리는 중, 10초가 지나면 이탈', () => {
    expect(linkState(1000, 1000).state).toBe('ok');
    expect(linkState(1000 + LINK_WAIT_MS - 1, 1000).state).toBe('ok');
    expect(linkState(1000 + LINK_WAIT_MS, 1000)).toEqual({ state: 'waiting', leftSec: 8 });
    expect(linkState(1000 + 9999, 1000)).toEqual({ state: 'waiting', leftSec: 1 });
    expect(linkState(1000 + LINK_LOST_MS, 1000)).toEqual({ state: 'lost', leftSec: 0 });
    expect(linkState(99999, 1000).state).toBe('lost');
  });
  it('소식을 다시 들으면 정상으로 돌아온다. 시계가 거꾸로 가도 탈 없다', () => {
    expect(linkState(9000, 1000).state).toBe('waiting');
    expect(linkState(9000, 8990).state).toBe('ok');
    expect(linkState(1000, 5000).state).toBe('ok');
  });
});

// ───────────────────────── 두 기기를 붙여서 돌려 보기 ─────────────────────────

/** 가짜 시계 + 지연 있는 통신으로 방장·상대 두 경기를 붙인다 */
function pair(lagMs: number, seed = 7) {
  let now = 1_000_000;
  const queue: { at: number; to: 0 | 1; m: NetMsg }[] = [];
  const fns: [((m: NetMsg) => void)[], ((m: NetMsg) => void)[]] = [[], []];
  /** 이 쪽이 보내는 것을 버린다 (연결 끊김 흉내) */
  const mute = [false, false];
  const link = (side: 0 | 1) => ({
    send: (m: NetMsg) => {
      if (!mute[side]) queue.push({ at: now + lagMs, to: side === 0 ? 1 : 0, m: JSON.parse(JSON.stringify(m)) as NetMsg });
    },
    onMsg: (fn: (m: NetMsg) => void) => {
      fns[side].push(fn);
      return () => undefined;
    },
  });
  const setup = (mySide: 0 | 1): MatchSetup => ({
    mode: 'online', mySide, seed, bg: 0, matchNo: 42, startAt: now + 3000,
    fighters: [{ id: 'L', name: 'L', char: 'tiger', ai: false }, { id: 'R', name: 'R', char: 'pig', ai: false }],
  });
  const host = new OnlineMatch(setup(0), link(0), () => now);
  const guest = new OnlineMatch(setup(1), link(1), () => now);
  const results: [MatchResult | null, MatchResult | null] = [null, null];
  host.onOver = (r) => (results[0] = r);
  guest.onOver = (r) => (results[1] = r);
  const ais = [makeAi(0, seed + 1), makeAi(1, seed + 2)];
  /** frameMs 만큼 시간을 흘린다: 도착한 메시지 전달 → 두 기기 갱신 */
  const advance = (frameMs: number, play = true) => {
    now += frameMs;
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) {
      const q = queue.shift()!;
      fns[q.to].forEach((f) => f(q.m));
    }
    if (play) {
      Object.assign(host.input, host.phase === 'play' ? aiInput(ais[0], host.state) : NO_INPUT);
      Object.assign(guest.input, guest.phase === 'play' ? aiInput(ais[1], guest.state) : NO_INPUT);
    }
    host.update();
    guest.update();
  };
  return { host, guest, results, advance, mute, clock: () => now, dispose: () => (host.dispose(), guest.dispose()) };
}

describe('방장과 상대 기기를 붙여서 (가짜 통신)', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  for (const lag of [0, 60, 150]) {
    it(`지연 ${lag}ms: 두 기기가 같은 점수·같은 승자로 끝나고, 공 위치가 크게 어긋나지 않는다`, () => {
      const p = pair(lag);
      cleanup = p.dispose;
      let frames = 0;
      let diffSum = 0;
      let diffMax = 0;
      let n = 0;
      const counts = { host: [0, 0, 0], guest: [0, 0, 0] };
      while ((!p.results[0] || !p.results[1]) && frames < 60 * 60 * 10) {
        p.advance(STEP_MS);
        frames++;
        for (const [k, m] of [['host', p.host], ['guest', p.guest]] as const)
          for (const e of m.events.splice(0)) {
            if (e.t === 'point') counts[k][0]++;
            if (e.t === 'serve') counts[k][1]++;
            if (e.t === 'over') counts[k][2]++;
          }
        if (p.host.phase === 'play' && p.guest.phase === 'play' && p.host.state.phase === 'play' && p.guest.state.phase === 'play') {
          // 같은 순간 두 화면에 보이는 공의 차이
          const a = p.host.ballView();
          const b = p.guest.ballView();
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          diffSum += d;
          diffMax = Math.max(diffMax, d);
          n++;
        }
      }
      const [rh, rg] = p.results;
      expect(rh).not.toBeNull();
      expect(rg).not.toBeNull();
      expect(rg!.winner).toBe(rh!.winner);
      expect(rg!.score).toEqual(rh!.score);
      expect(rh!.reason).toBe('normal');
      expect(Math.max(...rh!.score)).toBe(3);
      // 득점·서브·끝 알림 수가 두 기기에서 같다 (상대 기기는 방장 값으로만 알린다)
      expect(counts.guest).toEqual(counts.host);
      expect(counts.host[0]).toBe(rh!.score[0] + rh!.score[1]);
      const st = p.guest.stats;
      console.log(
        `[지연 ${lag}ms] ${(frames / 60).toFixed(0)}초 · 스냅샷 ${st.snaps}개(초당 ${(st.snaps / (frames / 60 - 3)).toFixed(1)}) · 위치 ${p.guest.stats.sentPos}개(초당 ${(st.sentPos / (frames / 60 - 3)).toFixed(1)})` +
          ` · 보정 평균 ${(st.corrSum / st.snaps).toFixed(2)}px 최대 ${st.corrMax.toFixed(0)}px · 10px 넘는 보정 ${((100 * st.corrOver10) / st.snaps).toFixed(1)}% · 바로 맞춤 ${st.hardSnaps}번` +
          ` · 두 화면 공 차이 평균 ${(diffSum / n).toFixed(1)}px 최대 ${diffMax.toFixed(0)}px · 다시 계산 평균 ${(st.resimTicks / st.snaps).toFixed(1)}틱`,
      );
      expect(st.snaps / (frames / 60 - 3)).toBeGreaterThan(18);
      expect(st.sentPos / (frames / 60 - 3)).toBeGreaterThan(25);
      expect(st.sentPos / (frames / 60 - 3)).toBeLessThan(45);
      // 보정은 대부분 작다
      expect(st.corrSum / st.snaps).toBeLessThan(lag === 0 ? 1 : 6);
      expect(st.corrOver10 / st.snaps).toBeLessThan(0.2);
    }, 120000);
  }

  it('두 기기가 같은 순간에 카운트다운을 끝낸다 (시작 시각 기준)', () => {
    const p = pair(80);
    cleanup = p.dispose;
    const seen: [number[], number[]] = [[], []];
    let goAt: [number, number] = [0, 0];
    for (let i = 0; i < 200; i++) {
      p.advance(STEP_MS, false);
      [p.host, p.guest].forEach((m, k) => {
        for (const e of m.events.splice(0)) {
          if (e.t === 'count') seen[k].push(e.n);
          if (e.t === 'go') goAt[k] = p.clock();
        }
      });
    }
    expect(seen[0]).toEqual([3, 2, 1]);
    expect(seen[1]).toEqual([3, 2, 1]);
    expect(goAt[0]).toBeGreaterThan(0);
    expect(goAt[1]).toBe(goAt[0]);
  });

  /** 경기가 끝날 때까지 돌린다 (side 쪽 결과가 나올 때까지). 그동안 생긴 알림을 모은다 */
  function playOut(p: ReturnType<typeof pair>, side: 0 | 1, maxSec = 600) {
    const seen: string[] = [];
    for (let i = 0; i < 60 * maxSec && !p.results[side]; i++) {
      p.advance(STEP_MS);
      for (const e of (side === 0 ? p.host : p.guest).events.splice(0)) seen.push(e.t);
    }
    return seen;
  }

  it('상대(오른쪽) 소식이 끊기면 기다리는 중 → 10초 뒤 AI가 이어받아 같은 점수에서 끝까지 한다', () => {
    const p = pair(30);
    cleanup = p.dispose;
    for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false); // 카운트다운 3초 + 2초 경기
    expect(p.host.phase).toBe('play');
    const tickBefore = p.host.state.tick;
    p.mute[1] = true; // 오른쪽 사람의 연결이 끊김
    for (let i = 0; i < 60 * 3; i++) p.advance(STEP_MS, false);
    // 기다리는 동안 경기는 멈춰 있다
    expect(p.host.waitingSec).toBeGreaterThan(0);
    expect(p.host.waitingSec).toBeLessThanOrEqual(8);
    expect(p.host.state.tick).toBeLessThan(tickBefore + 60 * 2.2);
    expect(p.host.solo).toBe(false);
    const frozen = p.host.state.tick;
    const scoreBefore = [...p.host.state.score];
    for (let i = 0; i < 60 * 6.5; i++) p.advance(STEP_MS, false);
    expect(p.host.solo).toBe(false);
    expect(p.host.state.tick).toBe(frozen);
    p.host.events.length = 0;
    for (let i = 0; i < 60 * 1; i++) p.advance(STEP_MS, false);
    // 10초가 지나면 바로 이기는 것이 아니라 AI가 이어받는다
    expect(p.host.solo).toBe(true);
    expect(p.results[0]).toBeNull();
    expect(p.host.phase).toBe('play');
    expect(p.host.waitingSec).toBe(0);
    expect(p.host.events.filter((e) => e.t === 'takeover')).toEqual([{ t: 'takeover', side: 1 }]);
    expect(p.host.state.score).toEqual(scoreBefore);
    // 경기가 다시 흐르고, AI(오른쪽)가 실제로 움직여 공을 친다
    const seen = playOut(p, 0);
    expect(seen).toContain('hit');
    expect(seen.filter((t) => t === 'over')).toHaveLength(1);
    const r = p.results[0]!;
    expect(r.reason).toBe('leave');
    expect(r.leaver).toBe(1);
    expect(Math.max(...r.score)).toBe(3);
    expect(Math.min(...r.score)).toBeLessThan(3);
    expect(r.winner).toBe(r.score[0] === 3 ? 0 : 1);
    // 끊겼던 사람(받기는 됨)은 '이어받았음' 알림을 받고 이 경기에서 빠진다: 나간 사람으로 끝
    expect(p.results[1]).toMatchObject({ reason: 'leave', leaver: 1 });
    expect(p.guest.phase).toBe('over');
  });

  it('방장이 끊겨도 같다: 오른쪽 사람 기기가 계산을 넘겨받고, AI가 왼쪽 캐릭터를 조종해 끝까지 한다', () => {
    const p = pair(30);
    cleanup = p.dispose;
    for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false);
    p.mute[0] = true;
    for (let i = 0; i < 60 * 9.5; i++) p.advance(STEP_MS, false);
    expect(p.results[1]).toBeNull();
    expect(p.guest.waitingSec).toBeGreaterThan(0);
    expect(p.guest.solo).toBe(false);
    const scoreBefore = [...p.guest.state.score];
    p.guest.events.length = 0;
    for (let i = 0; i < 60 * 1; i++) p.advance(STEP_MS, false);
    expect(p.guest.solo).toBe(true);
    expect(p.guest.events.filter((e) => e.t === 'takeover')).toEqual([{ t: 'takeover', side: 0 }]);
    expect(p.guest.state.score).toEqual(scoreBefore);
    expect(p.results[1]).toBeNull();
    // 넘겨받은 뒤에는 오른쪽 기기가 득점·서브·끝을 스스로 정한다
    const leftX0 = p.guest.state.players[0].x;
    let leftMoved = false;
    const seen: string[] = [];
    for (let i = 0; i < 60 * 600 && !p.results[1]; i++) {
      p.advance(STEP_MS);
      for (const e of p.guest.events.splice(0)) seen.push(e.t);
      if (Math.abs(p.guest.state.players[0].x - leftX0) > 30) leftMoved = true;
    }
    expect(leftMoved).toBe(true); // AI가 왼쪽 캐릭터를 움직였다
    expect(seen).toContain('point');
    expect(seen.filter((t) => t === 'over')).toHaveLength(1);
    const r = p.results[1]!;
    expect(r).toMatchObject({ reason: 'leave', leaver: 0 });
    expect(Math.max(...r.score)).toBe(3);
    expect(r.winner).toBe(r.score[0] === 3 ? 0 : 1);
    // 보내기만 막혔던 방장은 '이어받았음' 알림을 받고 이 경기에서 빠진다
    // (그 전에 자기 화면에서 경기가 끝나 버렸으면 normal로 끝나 있다 → 서버에서는 두 보고가 달라 무효)
    expect(p.results[0]).not.toBeNull();
    if (p.results[0]!.reason === 'leave') expect(p.results[0]!.leaver).toBe(0);
    expect(p.host.phase).toBe('over');
  });

  it('경기 중에 나가면(quit) 기다리지 않고 바로 AI가 이어받는다 (방장이 나간 경우 · 상대가 나간 경우)', () => {
    for (const quitter of [0, 1] as const) {
      const p = pair(50);
      const stay = quitter === 0 ? 1 : 0;
      const [gone, left] = quitter === 0 ? [p.host, p.guest] : [p.guest, p.host];
      for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false);
      gone.quit();
      for (let i = 0; i < 20; i++) p.advance(STEP_MS, false);
      expect(left.solo).toBe(true);
      expect(left.waitingSec).toBe(0);
      expect(p.results[stay]).toBeNull();
      expect(p.results[quitter]).toBeNull(); // 나간 사람은 결과 화면 없이 로비로
      expect(gone.phase).toBe('over');
      playOut(p, stay);
      expect(p.results[stay]).toMatchObject({ reason: 'leave', leaver: quitter });
      expect(Math.max(...p.results[stay]!.score)).toBe(3);
      p.dispose();
    }
  });

  it('오른쪽 기기가 넘겨받을 때, 방장이 확인해 주지 못한 득점(미리 계산한 것)도 알림으로 나온다', () => {
    // 공이 바닥에 닿기 직전에 방장이 끊기는 순간을 찾아 본다
    let checked = 0;
    for (let cut = 200; cut < 520 && checked < 3; cut += 8) {
      const p = pair(30, 11);
      // 처음부터 화면에 알린 득점을 모두 센다
      const pts: number[] = [];
      const collect = () => {
        for (const e of p.guest.events.splice(0)) if (e.t === 'point') pts.push(e.side);
      };
      for (let i = 0; i < 60 * 3 + cut; i++) {
        p.advance(STEP_MS, false);
        collect();
      }
      p.mute[0] = true;
      const told = pts.length;
      for (let i = 0; i < 60 * 11 && !p.guest.solo; i++) {
        p.advance(STEP_MS, false);
        collect();
      }
      collect();
      expect(p.guest.solo).toBe(true);
      const now = p.guest.state.score;
      // 넘겨받은 순간: 화면에 알린 득점 수 = 지금 점수 (빠진 것도, 두 번 알린 것도 없다)
      expect(pts.length).toBe(now[0] + now[1]);
      // 방장이 확인해 주지 못한 득점이 있었던 경우를 실제로 지나갔는지
      if (p.guest.stats.snaps > 0 && pts.length > told) checked++;
      p.dispose();
    }
  });

  it('한번 AI로 바뀌면 그 경기 끝까지 AI: 끊겼던 사람이 돌아와 보내는 소식은 무시한다', () => {
    const p = pair(30);
    cleanup = p.dispose;
    for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false);
    p.mute[1] = true;
    for (let i = 0; i < 60 * 10.5; i++) p.advance(STEP_MS, false);
    expect(p.host.solo).toBe(true);
    p.mute[1] = false; // 돌아옴
    for (let i = 0; i < 60 * 3; i++) p.advance(STEP_MS);
    expect(p.host.solo).toBe(true);
    expect(p.host.waitingSec).toBe(0);
    expect(p.guest.phase).toBe('over');
    expect(p.results[1]).toMatchObject({ leaver: 1 });
  });

  it('서로 완전히 끊기면 두 기기 모두 AI와 끝까지 한다 (서버에서는 두 보고가 달라 무효가 된다)', () => {
    const p = pair(30);
    cleanup = p.dispose;
    for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false);
    p.mute[0] = true;
    p.mute[1] = true;
    for (let i = 0; i < 60 * 10.5; i++) p.advance(STEP_MS, false);
    expect(p.host.solo).toBe(true);
    expect(p.guest.solo).toBe(true);
    for (let i = 0; i < 60 * 600 && (!p.results[0] || !p.results[1]); i++) p.advance(STEP_MS);
    expect(p.results[0]).toMatchObject({ reason: 'leave', leaver: 1 });
    expect(p.results[1]).toMatchObject({ reason: 'leave', leaver: 0 });
  });

  it('잠깐 끊겼다 돌아오면 경기가 이어진다', () => {
    const p = pair(30);
    cleanup = p.dispose;
    for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false);
    p.mute[1] = true;
    for (let i = 0; i < 60 * 5; i++) p.advance(STEP_MS, false);
    expect(p.host.waitingSec).toBeGreaterThan(0);
    p.mute[1] = false;
    for (let i = 0; i < 30; i++) p.advance(STEP_MS, false);
    expect(p.host.waitingSec).toBe(0);
    expect(p.host.phase).toBe('play');
    const t = p.host.state.tick;
    for (let i = 0; i < 60; i++) p.advance(STEP_MS, false);
    expect(p.host.state.tick).toBeGreaterThan(t + 50);
    expect(p.results[0]).toBeNull();
    // 상대 기기의 틱도 방장을 따라온다
    expect(Math.abs(p.guest.state.tick - p.host.state.tick)).toBeLessThan(45);
  });

  it('방장 탭이 가려져 1초에 한 번만 계산해도 따라잡고, 상대는 이탈로 보지 않는다', () => {
    const p = pair(30);
    cleanup = p.dispose;
    for (let i = 0; i < 60 * 4; i++) p.advance(STEP_MS, false);
    const t0 = p.host.state.tick;
    // 방장은 1초에 한 번만 update, 상대는 매 프레임
    for (let sec = 0; sec < 6; sec++) {
      for (let i = 0; i < 59; i++) {
        // 상대만 갱신: advance 는 둘 다 갱신하므로 방장 쪽은 직접 건너뛴다
        const upd = p.host.update.bind(p.host);
        p.host.update = () => undefined;
        p.advance(STEP_MS, false);
        p.host.update = upd;
      }
      p.advance(STEP_MS, false);
    }
    expect(p.results[1]).toBeNull();
    expect(p.guest.waitingSec).toBe(0);
    if (p.host.phase === 'play') expect(p.host.state.tick).toBeGreaterThanOrEqual(t0 + 60 * 6 - 2);
  });
});

/** (점검) START_X 를 쓰는 다른 테스트와 같은 자리에서 시작하는가 */
it('캐릭터 시작 자리', () => {
  const s = createState(1);
  expect(s.players.map((p) => p.x)).toEqual([START_X[0], START_X[1]]);
});

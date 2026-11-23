import { describe, expect, it } from 'vitest';
import { choose } from '../src/game/autopilot';
import { HINT_PATH_STEPS, HINT_SLICE_MS, HINT_USES, hintMode, hintPath, hintSearch } from '../src/game/hint';
import { FINGER_RULES, beginShot, buildConfig, checkInputs, createRun, playShot, stepShot, verifyRun } from '../src/sim';
import { cfgOf, foe, hero } from './helpers';

const room = () => createRun(cfgOf([hero('rat'), hero('ox'), hero('tiger'), hero('rabbit')], [[foe(200, 200), foe(440, 300), foe(320, 520)]]));

describe('힌트 한 수', () => {
  it('횟수: 스테이지 2 · 끝없는 탑 1 · 오늘의 도전 0', () => {
    expect(HINT_USES[hintMode(false, false)]).toBe(2);
    expect(HINT_USES[hintMode(true, false)]).toBe(1);
    expect(HINT_USES[hintMode(false, true)]).toBe(0);
  });

  it('나눠서 계산해도 자동 조종이 한 번에 고른 수와 같다', () => {
    const s = room();
    const want = choose(s, { special: 0 });
    const job = hintSearch(s, 0);
    let got = job.step(0);
    let slices = 1;
    while (!got) {
      got = job.step(0);
      slices++;
    }
    expect(got).toEqual(want);
    // 시간 0 이면 한 번에 후보 하나씩: 36각 × 3힘 + 둘레 26
    expect(slices).toBe(108 + 26 + 1);
    expect(job.tried).toBe(134);
    // 끝난 뒤에는 같은 수를 돌려준다
    expect(job.step()).toEqual(want);
  });

  it('한 번에 쓰는 시간은 정한 만큼만 (가짜 시계)', () => {
    const job = hintSearch(room(), 0);
    let t = 0;
    // 후보 하나에 2ms 가 걸린다고 치면 6ms 에 3개
    expect(job.step(HINT_SLICE_MS, () => (t += 2) - 2)).toBeNull();
    expect(job.tried).toBeLessThanOrEqual(4);
    expect(job.tried).toBeGreaterThanOrEqual(1);
  });

  it('판 상태를 건드리지 않는다 (계산 뒤에도 조작 기록 · 턴 그대로)', () => {
    const s = room();
    const before = JSON.stringify(s);
    const job = hintSearch(s, 0);
    while (!job.step(50)) {
      /* 계속 */
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it('필살기를 끈 채(0) · 켠 채(1) 고른 수는 그 값을 그대로 가진다', () => {
    const s = room();
    s.heroes[s.cur].charge = s.heroes[s.cur].chargeMax;
    for (const sp of [0, 1] as const) {
      const job = hintSearch(s, sp);
      let got = job.step(50);
      while (!got) got = job.step(50);
      expect(got.s).toBe(sp);
    }
  });

  it('힌트 길 = 그 조작으로 실제로 쏘았을 때 지나가는 자리 (판은 그대로)', () => {
    const s = room();
    const before = JSON.stringify(s);
    const inp = { a: 2650, p: 100, s: 0 as const };
    const pts = hintPath(s, inp);
    expect(JSON.stringify(s)).toBe(before);
    expect(pts[0]).toEqual([s.heroes[s.cur].x, s.heroes[s.cur].y]);
    expect(pts.length).toBeGreaterThan(5);
    expect(pts.length).toBeLessThanOrEqual(HINT_PATH_STEPS + 1);
    beginShot(s, inp);
    for (let i = 1; i < pts.length; i++) {
      stepShot(s);
      expect(pts[i]).toEqual([s.movers[0].x, s.movers[0].y]);
    }
  });

  it('힌트대로 쏜 판도 서버 다시 돌리기에서 같은 결과 (조작 값만 간다)', () => {
    const snap = { stage: '1-1', mode: 'normal', party: ['rat', 'ox', 'tiger'], levels: {}, upgrades: {} };
    const s = createRun(buildConfig({ stage: '1-1', mode: 'normal', party: ['rat', 'ox', 'tiger'], levels: {}, upgrades: {} }));
    while (s.phase === 'aim') {
      const job = hintSearch(s, 0);
      let got = job.step(50);
      while (!got) got = job.step(50);
      playShot(s, got);
    }
    // 조작 값은 손으로 낼 수 있는 범위 안
    expect(() => checkInputs(s.log)).not.toThrow();
    const r = verifyRun(snap, s.log);
    expect(r.cleared).toBe(s.phase === 'clear');
    expect(r.turns).toBe(s.turn);
    expect(FINGER_RULES).toBeGreaterThan(0);
  });
});

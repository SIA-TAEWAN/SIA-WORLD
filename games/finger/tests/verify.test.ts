import { describe, expect, it } from 'vitest';
import { emptyProfile, snapshotOf, type FingerProfile } from '../src/game/progress';
import { MAX_INPUTS, VerifyError, buildConfig, createRun, resultOf, verifyRun, type HeroId, type RunSnapshot, type ShotInput } from '../src/sim';
import { playLikeBrowser } from './helpers';

/**
 * 서버 다시 돌리기 (finger-finish 가 부르는 verifyRun) 가 브라우저에서 둔 판과 완전히 같은 결과를 내는지.
 * 브라우저처럼 한 스텝씩 · 2배속 턴을 섞어 자동 플레이어로 실제 판을 두고, s.log 만 verifyRun 에 넣는다.
 */

/** 화면이 판을 만드는 방식 (app.ts startGame) 그대로 */
function browserRun(p: FingerProfile, stage: string, party: HeroId[], opts: Parameters<typeof playLikeBrowser>[1] = {}) {
  const s = createRun(buildConfig({ stage, party, levels: p.levels, upgrades: p.upgrades }));
  playLikeBrowser(s, opts);
  // 서버는 DB(jsonb)에 남은 스냅숏을 읽는다: JSON 으로 한 번 왕복
  const snap = JSON.parse(JSON.stringify(snapshotOf(p, stage, party))) as RunSnapshot;
  const inputs = JSON.parse(JSON.stringify(s.log)) as ShotInput[];
  return { s, snap, inputs };
}

const fastOdd = (t: number) => t % 2 === 1;
const quick = { coarse: 150, powers: [50, 100] };

describe('서버 다시 돌리기 = 브라우저 결과', () => {
  const lv1 = browserRun(emptyProfile(), '1-1', ['rat', 'ox', 'tiger'], { fast: fastOdd });

  it('1-1 레벨 1 (2배속 턴 섞음): 클리어 · 별 · 턴 · 엽전 · 스텝까지 같다', () => {
    const local = resultOf(lv1.s);
    expect(local.cleared).toBe(true);
    const server = verifyRun(lv1.snap, lv1.inputs);
    expect(server).toEqual(local);
    expect(server.extra).toBe(0);
  });

  it('레벨 · 강화가 다른 스냅숏에서도 같다', () => {
    const p: FingerProfile = { ...emptyProfile(), levels: { rat: 12, ox: 20, tiger: 5 }, upgrades: { hp: 3, charge: 2, heal: 4, coin: 1 } };
    const r = browserRun(p, '1-3', ['tiger', 'rat', 'ox'], { pilot: quick, fast: () => true, frameMs: 33 });
    expect(r.snap.levels).toEqual({ tiger: 5, rat: 12, ox: 20 });
    expect(verifyRun(r.snap, r.inputs)).toEqual(resultOf(r.s));
    // 스냅숏의 레벨이 실제로 판에 들어간다 (같은 조작이라도 레벨 1 로 돌리면 다른 판)
    const asLv1 = verifyRun({ ...r.snap, levels: {}, upgrades: {} }, r.inputs.slice(0, 3));
    const asIs = verifyRun(r.snap, r.inputs.slice(0, 3));
    expect(asLv1).not.toEqual(asIs);
  });

  it('토끼가 있는 4명 파티 · 1-5 보스 (2배속 없이)', () => {
    const p: FingerProfile = { ...emptyProfile(), stages: { '1-5': 1 }, levels: { rabbit: 10 } };
    const r = browserRun(p, '1-5', ['ox', 'rabbit', 'rat', 'tiger'], { pilot: quick });
    expect(verifyRun(r.snap, r.inputs)).toEqual(resultOf(r.s));
  });

  it('고양이(추가 대원)가 있는 파티: 고양이 레벨이 스냅숏에 들어가고 덮치기까지 같은 결과', () => {
    const p: FingerProfile = { ...emptyProfile(), levels: { cat: 8 }, upgrades: { charge: 5 } };
    const r = browserRun(p, '1-3', ['cat', 'rat', 'ox'], { pilot: quick, fast: fastOdd });
    expect(r.snap.levels).toEqual({ cat: 8, rat: 1, ox: 1 });
    expect(verifyRun(r.snap, r.inputs)).toEqual(resultOf(r.s));
    expect(r.inputs.some((i) => i.s === 1)).toBe(true);
  });

  it('그만하기로 끝난 판(조작이 모자람)도 같은 상태까지 돌리고 ended = false', () => {
    const s = createRun(buildConfig({ stage: '1-2', party: ['rat', 'ox'] }));
    playLikeBrowser(s, { pilot: quick, maxTurns: 4, fast: fastOdd });
    const r = verifyRun(snapshotOf(emptyProfile(), '1-2', ['rat', 'ox']), s.log);
    expect(r.ended).toBe(false);
    expect(r).toEqual(resultOf(s));
  });

  it('조작을 하나만 바꿔도 결과가 달라진다', () => {
    const changed = lv1.inputs.map((i, k) => (k === 0 ? { ...i, a: (i.a + 900) % 3600 } : i));
    let r;
    try {
      r = verifyRun(lv1.snap, changed);
    } catch (e) {
      // 바뀐 판이 일찍 끝나면 남는 조작으로 거절된다 (그것도 '다른 결과')
      expect((e as Error).message).toBe('extra inputs');
      return;
    }
    expect(r).not.toEqual(resultOf(lv1.s));
  });
});

describe('장애물 · 요괴 행동이 있는 판도 서버 다시 돌리기 = 브라우저 결과', () => {
  /** 순간이동·가시밭·빨래판·돌기둥·방패·숨기·분열 (8-2), 해골·원혼·강철이 불길·단단해짐 (11-5), 저승사자 되살아남 (10-5) 등 */
  const cases: [string, HeroId[], number][] = [
    ['5-5', ['rabbit', 'dragon', 'snake', 'horse'], 4],
    ['8-2', ['horse', 'sheep', 'monkey', 'rooster'], 12],
    ['10-5', ['monkey', 'rooster', 'dog', 'pig'], 17],
    ['11-5', ['monkey', 'rooster', 'dog', 'pig'], 20],
    ['12-5', ['monkey', 'rooster', 'dog', 'pig'], 23],
  ];
  it.each(cases)('%s (한 스텝씩 · 2배속 섞음)', (stage, party, lv) => {
    const p: FingerProfile = { ...emptyProfile(), levels: Object.fromEntries(party.map((id) => [id, lv])), upgrades: { hp: 2, heal: 1 } };
    const r = browserRun(p, stage, party, { pilot: quick, fast: fastOdd, frameMs: 20 });
    expect(r.s.log.length).toBeGreaterThan(3);
    expect(verifyRun(r.snap, r.inputs)).toEqual(resultOf(r.s));
    // 같은 조작을 다시 돌려도 같다 (상태가 설정을 바꾸지 않는다)
    expect(verifyRun(r.snap, r.inputs)).toEqual(resultOf(r.s));
  });
});

describe('다시 돌리기 거절', () => {
  const snap = snapshotOf(emptyProfile(), '1-1', ['rat', 'ox', 'tiger']);
  const err = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      expect(e).toBeInstanceOf(VerifyError);
      return (e as Error).message;
    }
    return 'ok';
  };

  it('판이 끝난 뒤에 남는 조작', () => {
    const r = browserRun(emptyProfile(), '1-1', ['rat', 'ox', 'tiger'], { pilot: quick });
    expect(r.s.phase === 'clear' || r.s.phase === 'fail').toBe(true);
    expect(err(() => verifyRun(r.snap, [...r.inputs, { a: 2700, p: 50, s: 0 }]))).toBe('extra inputs');
  });

  it('40턴을 넘는 조작 (41개)', () => {
    expect(MAX_INPUTS).toBe(40);
    const many = Array.from({ length: 41 }, () => ({ a: 2700, p: 1, s: 0 as const }));
    expect(err(() => verifyRun(snap, many))).toBe('too many turns');
  });

  it('이상한 값', () => {
    const bad: unknown[] = [
      { a: 3600, p: 50, s: 0 },
      { a: -1, p: 50, s: 0 },
      { a: 10.5, p: 50, s: 0 },
      { a: '900', p: 50, s: 0 },
      { a: 900, p: 0, s: 0 },
      { a: 900, p: 101, s: 0 },
      { a: 900, p: 50, s: 2 },
      { a: 900, p: 50 },
      null,
      7,
    ];
    for (const b of bad) expect(err(() => verifyRun(snap, [b]))).toBe('bad inputs');
    expect(err(() => verifyRun(snap, 'x'))).toBe('bad inputs');
    expect(err(() => verifyRun(snap, { length: 1 }))).toBe('bad inputs');
  });

  it('스냅숏이 틀림', () => {
    expect(err(() => verifyRun({ ...snap, stage: '9-9' }, []))).toBe('bad stage');
    expect(err(() => verifyRun({ ...snap, party: ['wolf'] }, []))).toBe('bad party');
    expect(err(() => verifyRun({ ...snap, party: ['rat', 'rat'] }, []))).toBe('bad party');
    expect(err(() => verifyRun({ ...snap, party: [] }, []))).toBe('bad party');
    expect(err(() => verifyRun({ ...snap, mode: 'hell' }, []))).toBe('bad mode');
  });

  it('조작이 없으면 시작한 그대로 (실패 · 끝나지 않음)', () => {
    const r = verifyRun(snap, []);
    expect(r).toMatchObject({ cleared: false, ended: false, turns: 0, stars: 0, wave: 0 });
  });
});

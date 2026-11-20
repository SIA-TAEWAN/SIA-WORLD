import { choose, type PilotOptions } from '../game/autopilot';
import { buildConfigFrom, createRun, playShot, resultOf, stageOf, type HeroId, type RunResult, type StageDef } from '../sim';
import { ATK_FROM, ATK_KEEP, PAR_SLACK, TURN_GOAL, atkMulOf, expectLevel, partyFor, testLevel } from './balance';
import { stageFrom, type Calib, type Layout } from './stagegen';

/**
 * 밸런스 보정 (npm run calib · tests/balance.test.ts): 자동 플레이어로 스테이지를 끝까지 둔다.
 * 판 안에 무작위가 없으므로 같은 스테이지·파티·레벨이면 결과가 늘 같다.
 */

export interface PlayOpts {
  level: number;
  party: HeroId[];
  pilot?: PilotOptions;
}

/** 자동 플레이어로 한 판 */
export function autoPlay(st: StageDef, o: PlayOpts): RunResult {
  const levels = Object.fromEntries(o.party.map((id) => [id, o.level])) as Partial<Record<HeroId, number>>;
  const s = createRun(buildConfigFrom(st, { party: o.party, levels, upgrades: {} }));
  while (s.phase === 'aim') playShot(s, choose(s, o.pilot));
  return resultOf(s);
}

/** 보정 기준 통과: 깼고 · 목표 턴 안 · 쓰러진 대원 1명 이하 */
export const passes = (r: RunResult, boss: boolean) => r.cleared && r.turns <= (boss ? TURN_GOAL.boss : TURN_GOAL.normal) && r.fallen <= 1;

/** 지역 기준 (testLevel · 예상 레벨 · 파티) 으로 한 판 */
export const playAt = (st: StageDef, which: 'test' | 'expect' | 'one') =>
  autoPlay(st, { level: which === 'test' ? testLevel(st.region) : which === 'expect' ? expectLevel(st.region) : 1, party: partyFor(st.region) });

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 한 스테이지 보정: testLevel 에서 passes 를 만족하는 가장 큰 요괴 체력 배율을 찾고 (곱셈 단계로 올리고 내린 뒤 이분 탐색),
 * 별 기준 턴 = max(testLevel 턴, 예상 레벨 턴 + PAR_SLACK)
 */
export function calibrate(l: Layout, start: Calib, log: (m: string) => void = () => {}): Calib & { turnsTest: number; turnsExpect: number; evals: number } {
  const boss = l.no === 5;
  let evals = 0;
  const test = (hp: number) => {
    evals++;
    const r = playAt(stageFrom(l, { hp, par: 99 }), 'test');
    log(`  ${l.id} hp ${hp} → ${r.cleared ? '클리어' : '실패'} ${r.turns}턴 쓰러짐 ${r.fallen}`);
    return passes(r, boss);
  };
  let lo = 0;
  let hi = 0;
  let h = round2(start.hp);
  if (test(h)) {
    lo = h;
    for (let i = 0; i < 6; i++) {
      h = round2(h * 1.25);
      if (!test(h)) {
        hi = h;
        break;
      }
      lo = h;
    }
    if (!hi) hi = round2(lo * 1.25);
  } else {
    hi = h;
    for (let i = 0; i < 10; i++) {
      h = round2(h / 1.25);
      if (h < 0.2) break;
      if (test(h)) {
        lo = h;
        break;
      }
      hi = h;
    }
    if (!lo) lo = 0.2;
  }
  for (let i = 0; i < 3 && hi - lo > 0.02; i++) {
    const mid = round2(Math.sqrt(lo * hi));
    if (mid <= lo || mid >= hi) break;
    if (test(mid)) lo = mid;
    else hi = mid;
  }
  // 6지역부터: 요괴 공격도 올린다 (레벨을 올려야 깨지게). testLevel 에서 통과하는 가장 센 공격의 ATK_KEEP 만큼
  let atk: number | undefined;
  if (l.region >= ATK_FROM) {
    const base = atkMulOf(l.region);
    let ok = base;
    for (let i = 1; i <= 12; i++) {
      const a = round2(base * (1 + 0.2 * i));
      evals++;
      const r = playAt(stageFrom(l, { hp: lo, par: 99, atk: a }), 'test');
      log(`  ${l.id} atk ${a} → ${r.cleared ? '클리어' : '실패'} ${r.turns}턴 쓰러짐 ${r.fallen}`);
      if (!passes(r, boss)) break;
      // 예상 레벨에서도 깨야 한다 (자동 플레이어는 레벨이 높아도 다른 길을 고를 수 있다)
      evals++;
      if (!passes(playAt(stageFrom(l, { hp: lo, par: 99, atk: a }), 'expect'), boss)) break;
      ok = a;
    }
    atk = round2(base + (ok - base) * ATK_KEEP);
    evals++;
    evals += 2;
    const fin = stageFrom(l, { hp: lo, par: 99, atk });
    if (!passes(playAt(fin, 'test'), boss) || !passes(playAt(fin, 'expect'), boss)) atk = ok === base ? undefined : ok;
  }
  const st = stageFrom(l, { hp: lo, par: 99, atk });
  const rt = playAt(st, 'test');
  const re = playAt(st, 'expect');
  evals += 2;
  const par = Math.min(30, Math.max(rt.turns, re.turns + PAR_SLACK));
  return { hp: lo, par, ...(atk !== undefined ? { atk } : {}), turnsTest: rt.turns, turnsExpect: re.turns, evals };
}

/** 지금 데이터의 스테이지 하나를 세 기준(레벨 1 · testLevel · 예상 레벨)으로 */
export function report(id: string) {
  const st = stageOf(id)!;
  return { id, one: playAt(st, 'one'), test: playAt(st, 'test'), expect: playAt(st, 'expect'), par: st.par };
}

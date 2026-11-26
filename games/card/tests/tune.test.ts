/** 11-26 밸런스 확정: 강해진 요괴 · 관리자 시험 판 시작 엽전 (보상 자동 받기는 run.test.ts, 끝없는 배수는 review.test.ts) */
import { describe, expect, it } from 'vitest';
import {
  ADMIN_START_GOLD,
  ENEMIES,
  START_GOLD,
  STRONG_DMG,
  STRONG_FOES,
  STRONG_FROM,
  STRONG_HP,
  apply,
  dailyRun,
  enemyDef,
  genMap,
  newRun,
  regionDef,
  replay,
  verifyRun,
  type RunMode,
  type RunState,
} from '../src/game/rules';
import { hasArt } from '../src/art';
import { playRun } from './bot';

describe('강해진 요괴 (e-*-elite 그림)', () => {
  it('궁궐·저승 일반 요괴 5종의 정예판: 이름 "사나운 …", 체력·공격 소폭 상향, 그림 e-*-elite', () => {
    const strong = ENEMIES.filter((e) => e.strong);
    expect(strong.map((e) => e.id).sort()).toEqual(Object.values(STRONG_FOES).sort());
    for (const e of strong) {
      const b = enemyDef(e.strong!);
      expect(e.name).toBe(`사나운 ${b.name}`);
      expect(e.art).toMatch(/^e-\w+-elite$/);
      expect(hasArt(e.art)).toBe(true);
      expect(e.hp).toEqual([Math.round(b.hp[0] * STRONG_HP), Math.round(b.hp[1] * STRONG_HP)]);
      e.phase1.moves.forEach((m, i) =>
        m.ops.forEach((op, k) => {
          const o = op as { op: string; n?: number };
          const ob = b.phase1.moves[i].ops[k] as { op: string; n?: number };
          if (o.op === 'dmg' || o.op === 'block') expect(o.n).toBe(Math.round(ob.n! * STRONG_DMG));
          else expect(o).toEqual(ob);
        }),
      );
      // 바탕 요괴는 그 지역(궁궐·저승) 요괴
      expect(['palace', 'underworld'].some((r) => regionDef(r).enemies.includes(e.strong!))).toBe(true);
    }
  });

  /** 그 막 첫 줄(모두 전투)로 들어가 본다 */
  const firstFight = (seed: number, act: number, battles: number, mode: RunMode = 'normal') => {
    const run = newRun({ seed, hero: 'dog', mode });
    run.act = act;
    run.map = genMap(seed, act, 0, mode);
    run.actBattles = battles;
    expect(apply(run, { t: 'go', col: 0 }).ok).toBe(true);
    expect(run.battle?.kind).toBe('battle');
    return run.battle!.foes.filter((f) => !f.minion).map((f) => f.id);
  };

  it('2·3막 뒤쪽 일반 전투에 가끔 1마리 (앞쪽 · 1막에는 없음), 같은 씨앗이면 같은 결과', () => {
    let hit = 0;
    const N = 200;
    for (let s = 1; s <= N; s++) {
      for (const act of [2, 3]) {
        const foes = firstFight(s, act, STRONG_FROM);
        const n = foes.filter((id) => enemyDef(id).strong).length;
        expect(n).toBeLessThanOrEqual(1);
        hit += n;
        expect(firstFight(s, act, STRONG_FROM)).toEqual(foes);
        expect(firstFight(s, act, STRONG_FROM - 1).some((id) => enemyDef(id).strong)).toBe(false);
      }
      expect(firstFight(s, 1, 9).some((id) => enemyDef(id).strong)).toBe(false);
    }
    // 확률 35% × 정예판이 있는 조합 → 대략 2할
    expect(hit / (N * 2)).toBeGreaterThan(0.1);
    expect(hit / (N * 2)).toBeLessThan(0.4);
  });

  it('끝없는 모드: 궁궐·저승 지역의 막(6·7막 …)에도 나온다', () => {
    let hit = 0;
    for (let s = 1; s <= 100; s++) {
      expect(genMap(s, 6, 0, 'endless').region).toBe('palace');
      hit += firstFight(s, 6, STRONG_FROM, 'endless').filter((id) => enemyDef(id).strong).length;
      expect(firstFight(s, 4, 9, 'endless').some((id) => enemyDef(id).strong)).toBe(false);
    }
    expect(hit).toBeGreaterThan(5);
  });
});

describe('관리자 시험 판 시작 엽전', () => {
  it('newRun gold: 보통·끝없는은 그 값, 오늘의 도전은 늘 기본', () => {
    expect(newRun({ seed: 1, hero: 'dog' }).gold).toBe(START_GOLD);
    expect(newRun({ seed: 1, hero: 'dog', gold: null }).gold).toBe(START_GOLD);
    expect(newRun({ seed: 1, hero: 'dog', gold: ADMIN_START_GOLD }).gold).toBe(10000);
    expect(newRun({ seed: 1, hero: 'dog', mode: 'endless', gold: ADMIN_START_GOLD }).gold).toBe(10000);
    expect(newRun({ seed: 1, hero: 'dog', mode: 'daily', gold: ADMIN_START_GOLD }).gold).toBe(START_GOLD);
  });

  it('verifyRun 은 서버 줄의 startGold 로 다시 돌린다 (상점에서 1만 엽전을 쓴 판도 통과, 다른 값이면 bad log)', () => {
    // 엽전 1만으로 시작해 상점·이야기에서 엽전을 쓴 판
    let found: RunState | null = null;
    for (let s = 1; s < 40 && !found; s++) {
      const run = newRun({ seed: s, hero: 'dog', gold: ADMIN_START_GOLD });
      playRun(run);
      if (run.log.some((i) => i.t === 'buy') && run.phase === 'dead') found = run;
    }
    expect(found).not.toBeNull();
    const run = found!;
    const snap = { mode: 'normal' as const, hero: 'dog', mastery: 0, seed: run.seed, day: null };
    const log = JSON.parse(JSON.stringify(run.log));
    const v = verifyRun({ ...snap, startGold: ADMIN_START_GOLD }, log);
    expect(v.run.gold).toBe(run.gold);
    expect(v.result.over).toBe(true);
    expect(replay(run.seed, 'dog', log, { gold: ADMIN_START_GOLD }).run.gold).toBe(run.gold);
    // 기본 엽전으로는 다시 돌릴 수 없다 (같은 입력이 다른 결과)
    let bad = false;
    try {
      const w = verifyRun(snap, log);
      bad = w.run.gold !== run.gold;
    } catch {
      bad = true;
    }
    expect(bad).toBe(true);
    expect(() => verifyRun({ ...snap, startGold: -5 }, log)).toThrow('bad run');
    expect(() => verifyRun({ ...snap, startGold: 1.5 }, log)).toThrow('bad run');
  });

  it('오늘의 도전 판은 startGold 를 무시한다 (모두 같은 조건)', () => {
    const d = dailyRun('2026-11-26');
    const run = newRun({ seed: d.seed, hero: d.hero, mode: 'daily' });
    playRun(run);
    const snap = { mode: 'daily' as const, hero: d.hero, mastery: 0, seed: d.seed, day: '2026-11-26' };
    const log = JSON.parse(JSON.stringify(run.log));
    expect(verifyRun({ ...snap, startGold: ADMIN_START_GOLD }, log).run.gold).toBe(verifyRun(snap, log).run.gold);
  });
});

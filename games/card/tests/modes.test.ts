/** 5단계: 끝없는 모드 · 숙련 단계 · 오늘의 도전 · 서버 다시 돌리기(verifyRun) */
import { describe, expect, it, vi } from 'vitest';
import {
  DAILY_HEROES,
  ENDLESS_REGIONS,
  MASTERY,
  MASTERY_OPEN,
  RULES_VERSION,
  VerifyError,
  apply,
  dailyRun,
  dailyScore,
  dailySeed,
  foeDamage,
  foeMods,
  genMap,
  newRun,
  removePrice,
  replay,
  restHeal,
  runScore,
  shopPrice,
  startBattle,
  storyAct,
  verifyRun,
  type Input,
  type RunState,
} from '../src/game/rules';
import { playRun, runInput } from './bot';

vi.mock('../../../shared/supabase.js', () => ({ supabase: {} }));

/** 막 보스 보상 화면에서 떠나기 → 다음 막 (규칙 코드의 nextAct) */
function finishAct(run: RunState) {
  run.phase = 'reward';
  run.reward = { items: [], boss: true };
  run.stats.bosses++;
  expect(apply(run, { t: 'leave' }).ok).toBe(true);
}

describe('끝없는 모드', () => {
  it('1~3막은 보통과 같은 지도, 4막부터 대나무숲 → 들판 → 궁궐 → 저승 되풀이 (숨은 4막 없음)', () => {
    for (const seed of [1, 7, 99]) {
      for (const act of [1, 2, 3]) expect(genMap(seed, act, 0, 'endless')).toEqual(genMap(seed, act));
      for (let act = 4; act <= 12; act++) {
        const m = genMap(seed, act, 0, 'endless');
        expect(m.region).toBe(ENDLESS_REGIONS[(act - 4) % 4]);
        expect(m.rows.length).toBe(13);
      }
    }
    // 보스는 그 지역 3마리 중 무작위 (씨앗마다 다르게 나온다)
    const bosses = new Set<string>();
    for (let seed = 0; seed < 40; seed++) bosses.add(genMap(seed, 4, 0, 'endless').boss);
    expect([...bosses].sort()).toEqual(['centipede', 'gumiho', 'jangsanbeom']);
  });

  it('3막 보스 뒤에도 끝나지 않고 4막(대나무숲)으로 · 보통 모드는 엔딩', () => {
    const e = newRun({ seed: 5, hero: 'tiger', mode: 'endless' });
    const n = newRun({ seed: 5, hero: 'tiger' });
    for (const run of [e, n]) {
      run.act = 3;
      run.stats.elites = 5; // 보통 모드면 숨은 4막이 열릴 만큼
      run.map = genMap(5, 3, 0, run.mode);
      finishAct(run);
    }
    expect(e.phase).toBe('map');
    expect(e.act).toBe(4);
    expect(e.map.region).toBe('bamboo');
    expect(e.ending).toBeUndefined();
    expect(n.act).toBe(4);
    expect(n.map.region).toBe('abyss');
    for (let k = 0; k < 4; k++) finishAct(e);
    expect(e.act).toBe(8);
    expect(e.map.region).toBe('bamboo');
    expect(e.actStart.length).toBe(6); // [0] + 막을 넘길 때마다 하나 (위에서 3막으로 바로 옮겼다)
  });

  it('막마다 요괴 체력·피해 ×1.15 누적 (1막은 그대로)', () => {
    const run = newRun({ seed: 3, hero: 'dog', mode: 'endless' });
    expect(foeMods(run)).toBeUndefined();
    for (const act of [2, 3, 5, 9]) {
      run.act = act;
      expect(foeMods(run)!.hp).toBeCloseTo(1.15 ** (act - 1), 9);
      expect(foeMods(run)!.dmg).toBeCloseTo(1.15 ** (act - 1), 9);
    }
    // 같은 씨앗 전투: 끝없는 5막 요괴 체력 = 보통 체력 × 1.15^4 (반올림)
    run.act = 5;
    const plain = newRun({ seed: 3, hero: 'dog' });
    const a = startBattle(plain, { kind: 'battle', foes: ['lynx'], seed: 11 }, []);
    const b = startBattle(run, { kind: 'battle', foes: ['lynx'], seed: 11, mods: foeMods(run) }, []);
    expect(b.foes[0].maxHp).toBe(Math.round(a.foes[0].maxHp * 1.15 ** 4));
    expect(foeDamage(b, b.foes[0], 10)).toBe(Math.floor(10 * 1.15 ** 4));
    expect(foeDamage(a, a.foes[0], 10)).toBe(10);
  });

  it('4막부터 이야기·쉬운 전투는 그 지역의 막을 본다 (궁궐 = 2막 사건)', () => {
    const run = newRun({ seed: 9, hero: 'dog', mode: 'endless' });
    const at = (act: number) => {
      run.act = act;
      run.map = genMap(9, act, 0, 'endless');
      return storyAct(run);
    };
    expect([at(1), at(2), at(3), at(4), at(5), at(6), at(7), at(8)]).toEqual([1, 2, 3, 1, 1, 2, 3, 1]);
  });

  it('봇이 끝없는 모드를 쓰러질 때까지 돌고, 기록으로 다시 돌려도 같다', () => {
    const run = newRun({ seed: 21, hero: 'dog', mode: 'endless' });
    playRun(run);
    expect(run.phase).toBe('dead');
    const again = replay(21, 'dog', run.log, { mode: 'endless' });
    expect(again.bad).toBe(-1);
    expect(again.run).toEqual(run);
  });
});

describe('숙련 단계 1~5 (누적, 6~10 은 데이터만)', () => {
  it('데이터: 10단계, 고를 수 있는 것은 5까지', () => {
    expect(MASTERY.map((m) => m.lv)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(MASTERY_OPEN).toBe(5);
    expect(newRun({ seed: 1, hero: 'rat', mastery: 9 }).mastery).toBe(5);
    expect(newRun({ seed: 1, hero: 'rat', mastery: 3, mode: 'endless' }).mastery).toBe(0);
    expect(newRun({ seed: 1, hero: 'rat', mastery: 3, mode: 'daily' }).mastery).toBe(0);
  });

  it('1 정예 체력 +10% · 2 일반 요괴 공격 +1 · 5 막 보스 체력 +10%', () => {
    const at = (m: number) => newRun({ seed: 4, hero: 'ox', mastery: m });
    const hp = (m: number, kind: 'battle' | 'elite' | 'boss', foe: string) => {
      const run = at(m);
      return startBattle(run, { kind, foes: [foe], seed: 77, mods: foeMods(run) }, []).foes[0].maxHp;
    };
    expect(hp(1, 'elite', 'gumiho')).toBe(Math.round(hp(0, 'elite', 'gumiho') * 1.1));
    expect(hp(1, 'boss', 'gumiho')).toBe(hp(0, 'boss', 'gumiho'));
    expect(hp(4, 'boss', 'gumiho')).toBe(hp(0, 'boss', 'gumiho'));
    expect(hp(5, 'boss', 'gumiho')).toBe(Math.round(hp(0, 'boss', 'gumiho') * 1.1));
    expect(hp(5, 'battle', 'lynx')).toBe(hp(0, 'battle', 'lynx'));
    const dmg = (m: number, kind: 'battle' | 'boss') => {
      const run = at(m);
      const b = startBattle(run, { kind, foes: [kind === 'boss' ? 'gumiho' : 'lynx'], seed: 77, mods: foeMods(run) }, []);
      return foeDamage(b, b.foes[0], 9);
    };
    expect(dmg(1, 'battle')).toBe(9);
    expect(dmg(2, 'battle')).toBe(10);
    expect(dmg(5, 'boss')).toBe(9);
  });

  it('3 상점 가격 +15% (카드 없애기 포함) · 4 쉼터 회복 20%', () => {
    const r0 = newRun({ seed: 2, hero: 'rabbit' });
    const r3 = newRun({ seed: 2, hero: 'rabbit', mastery: 3 });
    const r4 = newRun({ seed: 2, hero: 'rabbit', mastery: 4 });
    expect(shopPrice(r0, 100)).toBe(100);
    expect(shopPrice(r3, 100)).toBe(115);
    expect(removePrice(r3)).toBe(Math.round(75 * 1.15));
    expect(restHeal(r0)).toBe(Math.floor(r0.maxHp * 0.3) + 10);
    expect(restHeal(r3)).toBe(restHeal(r0));
    expect(restHeal(r4)).toBe(Math.floor(r4.maxHp * 0.2) + 10);
  });

  it('숙련 판도 기록으로 다시 돌리면 같다', () => {
    const run = newRun({ seed: 31, hero: 'pig', mastery: 5 });
    playRun(run);
    const again = replay(31, 'pig', run.log, { mastery: 5 });
    expect(again.bad).toBe(-1);
    expect(again.run).toEqual(run);
    // 숙련을 다르게 주면 (보통은) 다른 판이 된다
    expect(replay(31, 'pig', run.log).run).not.toEqual(run);
  });
});

describe('오늘의 도전', () => {
  it('shared/daily.js 의 dailySeed · dailyPick 과 같은 값, 영웅은 십이지 12명 (고양이 없음)', async () => {
    const shared = (await import(/* @vite-ignore */ '../../../shared/daily.js')) as {
      dailySeed(game: string, day: string, salt?: string): number;
      dailyPick<T>(list: T[], game: string, day: string, salt?: string): T;
      DAILY_GAMES: string[];
    };
    expect(shared.DAILY_GAMES).toContain('card');
    expect(DAILY_HEROES).not.toContain('cat');
    expect(DAILY_HEROES.length).toBe(12);
    const heroes = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const day = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
      expect(dailySeed('card', day, 'seed')).toBe(shared.dailySeed('card', day, 'seed'));
      const d = dailyRun(day);
      expect(d.seed).toBe(shared.dailySeed('card', day, 'seed'));
      expect(d.hero).toBe(shared.dailyPick([...DAILY_HEROES], 'card', day, 'hero'));
      heroes.add(d.hero);
    }
    expect(heroes.size).toBeGreaterThan(6);
  });

  it('점수 = 칸×10 + 정예×30 + 보스×100 + 남은 체력', () => {
    expect(dailyScore({ floors: 13, elites: 2, bosses: 1, hp: 40 })).toBe(130 + 60 + 100 + 40);
    expect(dailyScore({ floors: 5, elites: 0, bosses: 0, hp: -3 })).toBe(50);
    const run = newRun({ seed: 1, hero: 'rat', mode: 'daily' });
    run.stats = { floors: 20, elites: 1, bosses: 1, battles: 9 };
    run.hp = 33;
    expect(runScore(run)).toBe(200 + 30 + 100 + 33);
  });
});

/** 봇으로 판을 진행해 n막 시작까지의 기록 */
function logUntilAct(seed: number, hero: string, act: number, mode: 'normal' | 'endless' = 'normal'): { run: RunState; log: Input[] } | null {
  const run = newRun({ seed, hero, mode });
  let n = 0;
  while (run.phase !== 'dead' && run.phase !== 'won' && run.act < act && n++ < 40000) apply(run, runInput(run));
  return run.act >= act ? { run, log: run.log } : null;
}

describe('verifyRun (card-finish 의 다시 돌리기)', () => {
  const snap = (o: Partial<Parameters<typeof verifyRun>[0]> = {}) => ({ mode: 'normal' as const, hero: 'dog', mastery: 0, seed: 0, day: null, ...o });

  it('쓰러진 판: 끝 상태 그대로', () => {
    const run = newRun({ seed: 8, hero: 'rat' });
    playRun(run);
    const v = verifyRun(snap({ hero: 'rat', seed: 8 }), JSON.parse(JSON.stringify(run.log)));
    expect(v.result.over).toBe(run.phase === 'dead' || run.phase === 'won');
    expect(v.result).toMatchObject({ rules: RULES_VERSION, logLen: run.log.length, floors: run.stats.floors, elites: run.stats.elites, bosses: run.stats.bosses, acts: run.stats.bosses });
    expect(v.result.dead).toBe(run.phase === 'dead');
  });

  it('진행 중인 판: 마지막으로 시작한 막의 처음까지만 기록', () => {
    let got: { run: RunState; log: Input[] } | null = null;
    let seed = 0;
    for (; seed < 40 && !got; seed++) got = logUntilAct(seed, 'dog', 2);
    expect(got).not.toBeNull();
    const { run, log } = got!;
    // 2막에서 몇 칸 더 간 기록을 보내도 2막 시작까지만
    let k = 0;
    while (run.phase !== 'dead' && run.stats.floors < 16 && k++ < 3000) apply(run, runInput(run));
    const v = verifyRun(snap({ seed: seed - 1 }), run.log);
    expect(v.result.over).toBe(run.phase === 'dead' || run.phase === 'won');
    if (!v.result.over) {
      expect(v.result.logLen).toBe(run.actStart[1]);
      expect(v.result.acts).toBe(1);
      expect(v.result.act).toBe(2);
      expect(v.run.phase).toBe('map');
      expect(v.run.row).toBe(-1);
      expect(v.log).toEqual(log.slice(0, run.actStart[1]));
    }
    // 1막 중간만 보내면 아무것도 기록하지 않는다
    const one = verifyRun(snap({ seed: seed - 1 }), run.log.slice(0, 20));
    expect(one.result).toMatchObject({ logLen: 0, acts: 0, floors: 0, over: false });
  });

  it('받아들여지지 않는 입력 · 이상한 모양 · 다른 씨앗은 bad log', () => {
    const run = newRun({ seed: 8, hero: 'rat' });
    for (let k = 0; k < 30; k++) apply(run, runInput(run));
    const log = run.log;
    expect(() => verifyRun(snap({ hero: 'rat', seed: 8 }), [...log, { t: 'go', col: 9 }])).toThrow(VerifyError);
    expect(() => verifyRun(snap({ hero: 'rat', seed: 8 }), 'x')).toThrow('bad log');
    expect(() => verifyRun(snap({ hero: 'rat', seed: 8 }), [{ t: 'go', col: '0' }])).toThrow('bad log');
    expect(() => verifyRun(snap({ hero: 'rat', seed: 8 }), [{ t: 'go', col: 0, evil: 1 }])).toThrow('bad log');
    expect(() => verifyRun(snap({ hero: 'rat', seed: 8 }), [{ t: 'warp' }])).toThrow('bad log');
    expect(() => verifyRun(snap({ hero: 'rat', seed: 8 }), new Array(40000).fill({ t: 'leave' }))).toThrow('bad log');
  });

  it('오늘의 도전: 그날의 영웅·씨앗이 아니면 bad daily', () => {
    const day = '2026-11-26';
    const d = dailyRun(day);
    expect(verifyRun(snap({ mode: 'daily', day, hero: d.hero, seed: d.seed }), []).result.logLen).toBe(0);
    expect(() => verifyRun(snap({ mode: 'daily', day, hero: d.hero === 'rat' ? 'ox' : 'rat', seed: d.seed }), [])).toThrow('bad daily');
    expect(() => verifyRun(snap({ mode: 'daily', day, hero: d.hero, seed: d.seed + 1 }), [])).toThrow('bad daily');
    expect(() => verifyRun(snap({ mode: 'daily', day: null, hero: d.hero, seed: d.seed }), [])).toThrow('bad daily');
  });

  it('끝없는 모드·숙련은 서버가 정한 값으로 다시 돌린다', () => {
    const run = newRun({ seed: 12, hero: 'horse', mode: 'endless' });
    playRun(run);
    expect(verifyRun(snap({ mode: 'endless', hero: 'horse', seed: 12 }), run.log).result.floors).toBe(run.stats.floors);
  });
});

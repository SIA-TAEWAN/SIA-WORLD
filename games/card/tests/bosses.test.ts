/** 보스 12종 + 어둑시니 정식 패턴 (PRD [요괴·보스]) */
import { describe, expect, it } from 'vitest';
import { ENEMIES, REGIONS, apply, enemyDef, enterTestBattle, foeHits, newRun, phaseAt, type Battle, type Foe, type RunState } from '../src/game/rules';

/** 보스 하나와 전투 (영웅은 꿀꿀이, 체력 넉넉히 · 호랑이 약화 같은 시작 상태 없음) */
function boss(id: string, kind: 'boss' | 'elite' = 'boss') {
  const run = newRun({ seed: 3, hero: 'pig' });
  run.hp = run.maxHp = 500;
  enterTestBattle(run, [id], kind);
  const b = run.battle!;
  const f = b.foes[0];
  f.st = {};
  return { run, b, f };
}
/** 손패를 정해 둔다 (기력 e) */
function hand(b: Battle, ids: string[], e = 3) {
  b.discard.push(...b.hand);
  b.hand = ids.map((id, i) => ({ uid: 800 + i, id }));
  b.energy = e;
}
const play = (run: RunState, uid: number, target?: number) => apply(run, { t: 'play', uid, target });
/** 손패 없이 턴 끝 → 요괴가 move 를 한다 */
function foeDoes(run: RunState, b: Battle, f: Foe, move?: string) {
  if (move) f.intent = move;
  b.discard.push(...b.hand);
  b.hand = [];
  b.block = 0;
  return apply(run, { t: 'end' }).ev;
}
const hurt = (ev: { e: string; to?: unknown; n?: number }[]) => ev.filter((e) => e.e === 'hit' && e.to === 'hero').reduce((s, e) => s + (e.n ?? 0), 0);
/** 그 단계로 (의도는 그 단계 순서의 첫 행동으로 직접 정하므로 순서는 다음부터) */
const toPhase = (f: Foe, p: 2 | 3) => {
  f.phase = p;
  f.cyc = 1;
};

describe('보스 데이터', () => {
  it('지역마다 보스 3마리, 체력은 스펙 값에서 밸런스로 바꾼 값(PROGRESS 바꾼 값 표, 11-26 확정), 2단계가 있다', () => {
    const hp: Record<string, number> = {
      gumiho: 130, jangsanbeom: 165, centipede: 135, bigDokkaebi: 150, bulgasal: 210, gangcheori: 190,
      guardCaptain: 255, dueoksini: 265, imugi: 300, reaper: 330, yagwanggwi: 400, yeomra: 330, final: 450,
    };
    for (const r of REGIONS.filter((x) => !x.hidden)) {
      expect(r.bosses).toHaveLength(3);
      expect(r.enemies).toHaveLength(4);
      for (const id of r.enemies) {
        const e = enemyDef(id);
        const n = e.phase1.moves.length;
        expect(n >= 2 && n <= 4, id).toBe(true);
      }
    }
    for (const [id, n] of Object.entries(hp)) {
      const e = enemyDef(id);
      expect(e.hp).toEqual([n, n]);
      expect(e.boss).toBe(true);
      expect(e.phase2, id).toBeTruthy();
    }
    expect(ENEMIES.filter((e) => e.boss)).toHaveLength(13);
  });

  it('막이 오를수록 일반 요괴가 세다 (체력 평균)', () => {
    const avg = (rid: string) => {
      const r = REGIONS.find((x) => x.id === rid)!;
      return r.enemies.reduce((s, id) => s + (enemyDef(id).hp[0] + enemyDef(id).hp[1]) / 2, 0) / r.enemies.length;
    };
    expect(avg('palace')).toBeGreaterThan(avg('bamboo'));
    expect(avg('palace')).toBeGreaterThan(avg('field'));
    expect(avg('underworld')).toBeGreaterThan(avg('palace'));
  });
});

describe('1막 보스', () => {
  it('구미호: 할퀴기9 → 여우불6+화상2 → 분신2(체력12·공격4) / 2단계 매 턴 분신1, 분신 있으면 받는 피해 -50%', () => {
    const { run, b, f } = boss('gumiho');
    expect(f.intent).toBe('claw');
    expect(hurt(foeDoes(run, b, f))).toBe(9);
    expect(f.intent).toBe('foxfire');
    foeDoes(run, b, f);
    expect(b.st.fire).toBe(2);
    foeDoes(run, b, f);
    const clones = b.foes.filter((x) => x.minion && !x.dead);
    expect(clones).toHaveLength(2);
    expect(clones[0].maxHp).toBe(12);
    expect(foeHits(run, b, clones[0])[0].n).toBe(4);
    // 2단계
    f.hp = 60;
    toPhase(f, 2);
    f.intent = 'claw';
    const before = b.foes.filter((x) => x.minion && !x.dead).length;
    foeDoes(run, b, f);
    expect(b.foes.filter((x) => x.minion && !x.dead).length).toBe(before + 1);
    hand(b, ['slash']);
    play(run, 800, f.uid);
    expect(f.hp).toBe(60 - 3);
  });

  it('장산범: 흉내 소리(다음 턴 손패 1장 버림)+12 → 덮치기 예고(힘+2) → 덮치기19 / 2단계 덮치기 2연속, 사이에 숨기', () => {
    const { run, b, f } = boss('jangsanbeom');
    const ev = foeDoes(run, b, f, 'mimicry');
    expect(hurt(ev)).toBe(12);
    expect(b.hand).toHaveLength(4); // 5장 뽑고 1장 버림
    expect(f.intent).toBe('warn');
    expect(foeHits(run, b, f)).toHaveLength(0);
    foeDoes(run, b, f);
    expect(f.str).toBe(2); // 예고하며 힘 +2 (11-26)
    expect(f.intent).toBe('pounce');
    expect(hurt(foeDoes(run, b, f))).toBe(21);
    f.str = 0;
    f.hp = 60;
    toPhase(f, 2);
    f.intent = 'pounce2';
    expect(hurt(foeDoes(run, b, f))).toBe(19);
    expect(f.intent).toBe('pounce2');
    expect(hurt(foeDoes(run, b, f))).toBe(19);
    expect(f.intent).toBe('hide');
    foeDoes(run, b, f);
    expect(f.dodge).toBe(1);
    hand(b, ['slash', 'slash']);
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(f.hp).toBe(hp);
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 6);
  });

  it('왕지네: 독침5+독3 → 몸 감기(방어12) / 2단계 다리 훑기 3×4, 매 턴 내 독+2', () => {
    const { run, b, f } = boss('centipede');
    const ev = foeDoes(run, b, f, 'sting');
    expect(hurt(ev.slice(0, ev.findIndex((e) => e.e === 'turn' && e.who === 'hero')))).toBe(5);
    foeDoes(run, b, f, 'coil');
    expect(f.block).toBe(12);
    toPhase(f, 2);
    f.intent = 'legs';
    b.st = {};
    const ev2 = foeDoes(run, b, f);
    expect(ev2.filter((e) => e.e === 'hit' && e.to === 'hero' && e.from === f.uid).map((e) => (e as { n: number }).n)).toEqual([3, 3, 3, 3]);
    // 독 2 → 내 턴 시작에 2 피해 후 1
    expect(b.st.poison).toBe(1);
  });

  it('큰도깨비: 방망이11 → 금 나와라(방어15, 힘+1) / 2단계 방망이 9×2, 내 덱에 도깨비 장난2', () => {
    const { run, b, f } = boss('bigDokkaebi');
    expect(hurt(foeDoes(run, b, f, 'club'))).toBe(11);
    foeDoes(run, b, f, 'gold');
    expect(f.block).toBe(15);
    expect(f.str).toBe(1);
    f.str = 0;
    toPhase(f, 2);
    expect(foeHits(run, b, { ...f, intent: 'club2' })).toEqual([{ n: 9, times: 2 }]);
    foeDoes(run, b, f, 'mischief');
    const pranks = [...b.draw, ...b.hand, ...b.discard].filter((c) => c.id === 'prank');
    expect(pranks).toHaveLength(2);
  });

  it('불가살: 쇠 먹기(방어20) → 박치기16 / 2단계 쓰러지면 한 번 30%로 부활, 화상이면 부활 못 함', () => {
    const { run, b, f } = boss('bulgasal');
    foeDoes(run, b, f, 'eat');
    expect(f.block).toBe(20);
    expect(hurt(foeDoes(run, b, f, 'butt'))).toBe(16);
    f.block = 0;
    f.hp = 5;
    toPhase(f, 2);
    hand(b, ['slash', 'slash']);
    const ev = play(run, 800, f.uid).ev;
    expect(ev.some((e) => e.e === 'foeRevive')).toBe(true);
    expect(f.hp).toBe(63);
    expect(f.dead).toBe(false);
    f.hp = 5;
    play(run, 801, f.uid);
    expect(f.dead).toBe(true);
    expect(b.over).toBe('win');
    // 화상이 걸려 있으면 부활 못 함
    const x = boss('bulgasal');
    x.f.hp = 5;
    toPhase(x.f, 2);
    x.f.st.fire = 2;
    hand(x.b, ['slash']);
    play(x.run, 800, x.f.uid);
    expect(x.f.dead).toBe(true);
  });

  it('강철이: 불길7+화상3 → 메마름(내 방어 절반 제거) / 2단계 매 턴 화상2, 화상 피해 2배, 젖음을 걸면 화상 감소', () => {
    const { run, b, f } = boss('gangcheori');
    foeDoes(run, b, f, 'flame');
    expect(b.st.fire).toBe(3);
    f.intent = 'parch';
    b.hand = [];
    b.block = 10;
    apply(run, { t: 'end' });
    expect(b.block).toBe(0); // 10 → 5 남음 → 내 턴 시작에 사라짐
    // 2단계
    b.st = {};
    toPhase(f, 2);
    f.intent = 'parch';
    foeDoes(run, b, f);
    expect(b.st.fire).toBe(2); // 매 턴 화상 2
    // 화상 피해 2배: 턴 끝 화상 2 → 피해 4
    const hp = run.hp;
    b.hand = [];
    f.intent = 'parch';
    const ev = apply(run, { t: 'end' }).ev;
    expect(hp - run.hp).toBe(4);
    expect(ev.some((e) => e.e === 'hit' && e.to === 'hero' && e.n === 4)).toBe(true);
    // 젖음을 걸면 내 화상이 줄어든다
    b.st.fire = 5;
    hand(b, ['thrust']);
    play(run, 800, f.uid);
    expect(b.st.fire).toBe(3);
  });
});

describe('2막 보스', () => {
  it('수문장 대장: 창 찌르기15 → 방패벽(방어20)+병졸1 / 2단계 화살 비4×4, 병졸2', () => {
    const { run, b, f } = boss('guardCaptain');
    expect(hurt(foeDoes(run, b, f, 'spear'))).toBe(15);
    foeDoes(run, b, f, 'wall');
    expect(f.block).toBe(20);
    expect(b.foes.filter((x) => x.id === 'soldier' && !x.dead)).toHaveLength(1);
    toPhase(f, 2);
    foeDoes(run, b, f, 'muster');
    expect(b.foes.filter((x) => x.id === 'soldier' && !x.dead)).toHaveLength(3);
    expect(foeHits(run, b, { ...f, intent: 'volley' })).toEqual([{ n: 4, times: 4 }]);
    // 병졸만 남아도 대장이 쓰러지면 승리
    f.hp = 1;
    f.block = 0;
    hand(b, ['slash']);
    play(run, 800, f.uid);
    expect(b.over).toBe('win');
  });

  it('두억시니: 내려치기16 → 짓누르기10+진흙2 / 2단계 매 턴 힘+2', () => {
    const { run, b, f } = boss('dueoksini');
    expect(hurt(foeDoes(run, b, f, 'smash'))).toBe(16);
    foeDoes(run, b, f, 'crush');
    expect(b.hand).toHaveLength(4); // 진흙 2 → 이번 턴 뽑기 -1
    toPhase(f, 2);
    f.intent = 'smash';
    expect(foeHits(run, b, f)).toEqual([{ n: 16, times: 1 }]);
    const ev = foeDoes(run, b, f);
    expect(f.str).toBe(2);
    expect(hurt(ev)).toBe(18);
    foeDoes(run, b, f);
    expect(f.str).toBe(4);
  });

  it('이무기: 물보라9+젖음2 → 물어뜯기18 → 똬리(방어15) / 2단계 승천 예고 2턴 → 대해일40, 예고 중 피해 50 주면 취소', () => {
    const { run, b, f } = boss('imugi');
    expect(hurt(foeDoes(run, b, f, 'spray'))).toBe(9);
    expect(b.st.wet).toBe(2); // 젖음은 내 턴 끝에 1 줄어든다
    expect(f.intent).toBe('bite');
    b.st = {};
    expect(hurt(foeDoes(run, b, f))).toBe(18);
    foeDoes(run, b, f, 'coil');
    expect(f.block).toBe(15);
    // 2단계: 체력 50% 아래로 → 승천 예고부터
    const x = boss('imugi');
    x.f.hp = 151;
    hand(x.b, ['slash']);
    play(x.run, 800, x.f.uid);
    expect(x.f.phase).toBe(2);
    expect(x.f.intent).toBe('omen');
    foeDoes(x.run, x.b, x.f);
    expect(x.f.charge).toBe(50);
    expect(x.f.intent).toBe('omen2');
    foeDoes(x.run, x.b, x.f);
    expect(x.f.intent).toBe('wave');
    x.b.st = {};
    expect(hurt(foeDoes(x.run, x.b, x.f))).toBe(40);
    expect(x.f.charge).toBe(null);
    // 예고 중 피해 50 → 취소 (떨어짐) → 다음은 물보라
    const y = boss('imugi');
    toPhase(y.f, 2);
    y.f.hp = 120;
    y.f.intent = 'omen';
    foeDoes(y.run, y.b, y.f);
    expect(y.f.charge).toBe(50);
    y.f.block = 0;
    hand(y.b, ['smash', 'smash', 'smash', 'smash'], 8);
    play(y.run, 800, y.f.uid);
    play(y.run, 801, y.f.uid);
    play(y.run, 802, y.f.uid);
    expect(y.f.charge).toBe(8);
    const ev = play(y.run, 803, y.f.uid).ev;
    expect(ev.some((e) => e.e === 'cancel')).toBe(true);
    expect(y.f.intent).toBe('fall');
    expect(hurt(foeDoes(y.run, y.b, y.f))).toBe(0);
    expect(y.f.intent).toBe('spray');
  });
});

describe('3막 보스', () => {
  it('저승사자: 명부 낫15 → 이름 부르기(저승 사슬1) / 2단계 낫10×2, 내 체력 30% 이하면 피해 2배', () => {
    const { run, b, f } = boss('reaper');
    expect(hurt(foeDoes(run, b, f, 'scythe'))).toBe(15);
    foeDoes(run, b, f, 'call');
    expect([...b.draw, ...b.hand, ...b.discard].filter((c) => c.id === 'chain')).toHaveLength(1);
    toPhase(f, 2);
    f.intent = 'scythe2';
    expect(foeHits(run, b, f)).toEqual([{ n: 10, times: 2 }]);
    run.hp = 150; // 30%
    expect(foeHits(run, b, f)).toEqual([{ n: 20, times: 2 }]);
  });

  it('야광귀: 신발 훔치기6(다음 턴 기력-1) → 할퀴기20 ×2 / 2단계 2턴마다 어둠 속(받는 피해 -75%), 화상 걸면 해제', () => {
    const { run, b, f } = boss('yagwanggwi');
    expect(hurt(foeDoes(run, b, f, 'shoes'))).toBe(6);
    expect(b.energy).toBe(2);
    expect(hurt(foeDoes(run, b, f, 'claw'))).toBe(20);
    expect(f.intent).toBe('claw');
    toPhase(f, 2);
    f.intent = 'dark';
    foeDoes(run, b, f);
    expect(f.dark).toBe(true);
    expect(f.intent).toBe('claw');
    f.block = 0;
    hand(b, ['smash', 'ember']);
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(hp - f.hp).toBe(3); // 14 × 0.25
    play(run, 801, f.uid); // 불씨: 화상 → 어둠 해제
    expect(f.dark).toBe(false);
    // 다음 행동 때 어둠은 풀린다
    f.dark = true;
    foeDoes(run, b, f);
    expect(f.dark).toBe(false);
  });

  it('염라대왕: 심판16 → 업보(쓴 공격카드 수×2) → 저승 사슬2 / 2단계 저승사자(체력60) 소환, 매 턴 업보(×1)', () => {
    const { run, b, f } = boss('yeomra');
    expect(hurt(foeDoes(run, b, f, 'judge'))).toBe(16);
    hand(b, ['slash', 'slash', 'slash']);
    play(run, 800, f.uid);
    play(run, 801, f.uid);
    play(run, 802, f.uid);
    f.intent = 'karma';
    expect(foeHits(run, b, f)).toEqual([{ n: 6, times: 1 }]);
    expect(hurt(foeDoes(run, b, f))).toBe(6);
    foeDoes(run, b, f, 'chains');
    expect([...b.draw, ...b.hand, ...b.discard].filter((c) => c.id === 'chain')).toHaveLength(2);
    toPhase(f, 2);
    f.intent = 'summon';
    foeDoes(run, b, f);
    const minion = b.foes.find((x) => x.id === 'reaperMinion')!;
    expect(minion.maxHp).toBe(60);
    // 업보 매 턴 (+ 심판)
    f.intent = 'judge';
    expect(foeHits(run, b, f)).toEqual([
      { n: 3, times: 1 },
      { n: 16, times: 1 },
    ]);
  });
});

describe('숨은 최종보스 어둑시니', () => {
  it('덮침12, 공격카드 쓸 때마다 힘+1, 66%·33% 에서 커짐(230→262→296), 덮침 8×3', () => {
    const d = enemyDef('final');
    expect(d.grow).toEqual([230, 262, 296]);
    expect(phaseAt(d)).toEqual([0.66, 0.33]);
    const { run, b, f } = boss('final');
    expect(foeHits(run, b, f)).toEqual([{ n: 12, times: 1 }]);
    hand(b, ['slash', 'slash', 'guard']);
    play(run, 800, f.uid);
    play(run, 801, f.uid);
    play(run, 802);
    expect(f.str).toBe(2);
    expect(foeHits(run, b, f)).toEqual([{ n: 14, times: 1 }]);
    f.str = 0;
    f.hp = 300;
    hand(b, ['slash']);
    const ev = play(run, 800, f.uid).ev;
    expect(f.phase).toBe(2);
    expect(ev.find((e) => e.e === 'phase')).toMatchObject({ n: 2 });
    f.intent = 'triple';
    f.str = 0;
    expect(foeHits(run, b, f)).toEqual([{ n: 8, times: 3 }]);
    f.hp = 150;
    hand(b, ['slash']);
    const ev3 = play(run, 800, f.uid).ev;
    expect(f.phase).toBe(3);
    expect(ev3.find((e) => e.e === 'phase')).toMatchObject({ n: 3 });
  });

  it('정예로 나온 보스는 체력 60%(염라대왕은 eliteMod 65%), 막 보스가 아니다', () => {
    const { f } = boss('yeomra', 'elite');
    expect(f.maxHp).toBe(215); // 330 × 65% (214.5 → 215, 9단계)
    expect(f.elite).toBe(true);
    expect(f.boss).toBeFalsy();
  });
});

/** 11-26 전체검사에서 고친 규칙 (RULES_VERSION 5) */
import { describe, expect, it } from 'vitest';
import { VerifyError, apply, endlessScale, enterTestBattle, newRun, verifyRun, type Battle, type Foe, type RunState } from '../src/game/rules';

function fight(id: string, hero = 'pig', kind: 'boss' | 'battle' = 'boss') {
  const run = newRun({ seed: 3, hero });
  run.hp = run.maxHp = 500;
  enterTestBattle(run, [id], kind);
  const b = run.battle!;
  const f = b.foes[0];
  f.st = {};
  return { run, b, f };
}
function hand(b: Battle, ids: string[], e = 3) {
  b.discard.push(...b.hand);
  b.hand = ids.map((id, i) => ({ uid: 800 + i, id }));
  b.energy = e;
}
function endEmpty(run: RunState, b: Battle, f?: Foe, move?: string) {
  if (f && move) f.intent = move;
  b.discard.push(...b.hand);
  b.hand = [];
  b.block = 0;
  return apply(run, { t: 'end' });
}

describe('요괴 차례 중 단계가 바뀌면 새 단계 첫 행동이 남는다', () => {
  it('수문장 대장: 행동 뒤 화상으로 2단계 → 다음 의도 = 병졸 부르기', () => {
    const { run, b, f } = fight('guardCaptain');
    f.st = { fire: 10 };
    f.hp = 132; // 127.5 이하가 2단계 (체력 255)
    const r = endEmpty(run, b, f, 'spear');
    expect(r.ok).toBe(true);
    expect(f.phase).toBe(2);
    expect(f.intent).toBe('muster');
  });

  it('염라대왕: 반격(지킴이)으로 행동 중 2단계 → 다음 의도 = 저승사자 부르기', () => {
    const { run, b, f } = fight('yeomra');
    f.hp = 170; // 165 이하가 2단계 (체력 330)
    hand(b, ['watchdog']);
    apply(run, { t: 'play', uid: 800 });
    endEmpty(run, b, f, 'judge');
    expect(f.phase).toBe(2);
    expect(f.intent).toBe('summon');
  });
});

describe('부활', () => {
  it('순서: 고양이 패시브 → 불사조 깃 → 불가살 쇠조각', () => {
    const { run, b, f } = fight('water', 'cat', 'battle');
    run.relics.push('bulgasalIron');
    b.powers.phoenix = 30;
    const lethal = () => {
      run.hp = 1;
      b.block = 0;
      f.intent = 'drag';
      f.str = 100;
      return endEmpty(run, b);
    };
    const who = (ev: { e: string; who?: string }[]) => ev.filter((e) => e.e === 'revive').map((e) => e.who);
    expect(who(lethal().ev)).toEqual(['cat']);
    // 고양이는 방어10 을 얻는다 → 방어를 지우고 다시
    expect(who(lethal().ev)).toEqual(['phoenix']);
    expect(who(lethal().ev)).toEqual(['bulgasalIron']);
    expect(lethal().ev.some((e) => e.e === 'lose')).toBe(true);
  });

  it('불가살을 1단계에서 한 번에 쓰러뜨려도 부활하고 2단계가 된다 (화상이면 못 함)', () => {
    const { run, b, f } = fight('bulgasal');
    f.block = 0;
    f.hp = 120; // 1단계 (105 초과)
    hand(b, ['smash']);
    b.powers.atkUp = 200;
    apply(run, { t: 'play', uid: 800, target: f.uid });
    expect(f.dead).toBeFalsy();
    expect(f.revived).toBe(true);
    expect(f.hp).toBe(Math.round(f.maxHp * 0.3));
    expect(f.phase).toBe(2);

    const c = fight('bulgasal');
    c.f.block = 0;
    c.f.hp = 120;
    c.f.st.fire = 2;
    hand(c.b, ['smash']);
    c.b.powers.atkUp = 200;
    apply(c.run, { t: 'play', uid: 800, target: c.f.uid });
    expect(c.f.dead).toBe(true);
  });
});

describe('영웅의 젖음', () => {
  it('젖음 n = 받는 요괴 공격 차례 n 번 (요괴 쪽과 같게)', () => {
    const { run, b, f } = fight('water', 'pig', 'battle');
    const dealt = (ev: { e: string; to?: unknown; n?: number; blocked?: number }[]) =>
      ev.filter((e) => e.e === 'hit' && e.to === 'hero').map((e) => (e.n ?? 0) + (e.blocked ?? 0));
    // 1차례: 끌어당기기 9 + 젖음2 (맞은 뒤 걸림)
    expect(dealt(endEmpty(run, b, f, 'drag').ev)).toEqual([9]);
    expect(b.st.wet).toBe(2);
    // 2·3차례: 물보라 6×2 가 젖음으로 9×2
    expect(dealt(endEmpty(run, b, f, 'splash').ev)).toEqual([9, 9]);
    expect(b.st.wet).toBe(1);
    expect(dealt(endEmpty(run, b, f, 'splash').ev)).toEqual([9, 9]);
    expect(b.st.wet ?? 0).toBe(0);
    // 4차례: 젖음 끝
    expect(dealt(endEmpty(run, b, f, 'splash').ev)).toEqual([6, 6]);
  });
});

describe('끝없는 모드 배수', () => {
  it('더하기: 1 + 0.15×(막-1), 백분율 정수 ÷ 100 (엔진마다 같은 값)', () => {
    expect(endlessScale(1)).toBe(1);
    expect(endlessScale(2)).toBe(1.15);
    expect(endlessScale(3)).toBe(1.3);
    expect(endlessScale(5)).toBe(1.6);
    expect(endlessScale(8)).toBe(2.05);
    for (let a = 1; a <= 40; a++) expect(endlessScale(a)).toBe((100 + 15 * (a - 1)) / 100);
  });
});

describe('입력 검사', () => {
  const snap = { mode: 'normal' as const, hero: 'dog', mastery: 0, seed: 1, day: null };
  it('글자 칸(t · kind) 은 16자까지', () => {
    expect(() => verifyRun(snap, [{ t: 'x'.repeat(17) }])).toThrow(VerifyError);
    expect(() => verifyRun(snap, [{ t: 'buy', kind: 'k'.repeat(17), i: 0 }])).toThrow(VerifyError);
    expect(() => verifyRun(snap, [{ t: 'buy', kind: 3, i: 0 }])).toThrow(VerifyError);
  });
  it('상점 buy 는 card · relic · potion 만 (모르는 kind 로 물약 3개 상한을 넘지 못함)', () => {
    const run = newRun({ seed: 3, hero: 'dog' });
    run.phase = 'shop';
    run.gold = 999;
    run.potions = ['heal', 'heal', 'heal'];
    run.shop = { cards: [], relics: [], potions: [{ id: 'heal', price: 10 }], removed: false };
    expect(apply(run, { t: 'buy', kind: 'zzz' as never, i: 0 }).ok).toBe(false);
    expect(apply(run, { t: 'buy', kind: 'potion', i: 0 }).ok).toBe(false);
    expect(run.potions.length).toBe(3);
  });
});

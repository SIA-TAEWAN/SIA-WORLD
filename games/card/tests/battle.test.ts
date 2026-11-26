import { describe, expect, it } from 'vitest';
import { apply, enterTestBattle, newRun, type Battle, type RunState } from '../src/game/rules';
import { playBattle } from './bot';

function setup(foes: string[], seed = 7, relics: string[] = []) {
  const run = newRun({ seed, hero: 'tiger' });
  run.relics = relics;
  enterTestBattle(run, foes);
  const b = run.battle!;
  return { run, b };
}
/** 손패·요괴 상태를 정해 둔다 (호랑이 약화도 지움) */
function hand(b: Battle, ids: (string | [string, boolean])[]) {
  b.discard.push(...b.hand);
  b.hand = ids.map((x, i) => (typeof x === 'string' ? { uid: 800 + i, id: x } : { uid: 800 + i, id: x[0], up: x[1] }));
  for (const f of b.foes) f.st = {};
  b.energy = 3;
}
const play = (run: RunState, uid: number, target?: number) => apply(run, { t: 'play', uid, target });

describe('전투 기본', () => {
  it('시작: 손패 5장 · 기력 3 · 어흥이 패시브(모든 적 약화1) · 의도', () => {
    const { b } = setup(['fox', 'acorn']);
    expect(b.hand).toHaveLength(5);
    expect(b.draw).toHaveLength(5);
    expect(b.energy).toBe(3);
    for (const f of b.foes) {
      expect(f.st.weak).toBe(1);
      expect(f.intent).toBeTruthy();
    }
  });

  it('베기 6, 방어가 먼저 막는다', () => {
    const { run, b } = setup(['lynx']);
    hand(b, ['slash', 'slash']);
    const f = b.foes[0];
    const hp = f.hp;
    expect(play(run, 800, f.uid).ok).toBe(true);
    expect(f.hp).toBe(hp - 6);
    f.block = 4;
    play(run, 801, f.uid);
    expect(f.block).toBe(0);
    expect(f.hp).toBe(hp - 8);
    expect(b.energy).toBe(1);
  });

  it('젖음 +50% · 약화 -25% · 강화 카드', () => {
    const { run, b } = setup(['lynx']);
    hand(b, [['slash', true], 'thrust', 'slash']);
    const f = b.foes[0];
    let hp = f.hp;
    play(run, 800, f.uid);
    expect(f.hp).toBe(hp - 9);
    play(run, 801, f.uid); // 8, 젖음1
    expect(f.st.wet).toBe(1);
    hp = f.hp;
    play(run, 802, f.uid);
    expect(f.hp).toBe(hp - 9); // 6 × 1.5
    // 요괴 약화: 덮치기 11 → 8
    f.st.weak = 1;
    f.intent = 'pounce';
    f.str = 0;
    b.block = 0;
    b.hand = [];
    const before = run.hp;
    apply(run, { t: 'end' });
    expect(before - run.hp).toBe(8);
  });

  it('기력은 이월되지 않는다, 손패는 버리고 새로 5장', () => {
    const { run, b } = setup(['acorn']);
    hand(b, ['guard']);
    b.foes[0].intent = 'shell';
    apply(run, { t: 'end' });
    expect(b.energy).toBe(3);
    expect(b.hand).toHaveLength(5);
    expect(b.turn).toBe(2);
  });

  it('방어는 내 턴 시작에 사라진다', () => {
    const { run, b } = setup(['acorn']);
    hand(b, ['guard']);
    b.foes[0].intent = 'shell';
    play(run, 800);
    expect(b.block).toBe(5);
    apply(run, { t: 'end' });
    expect(b.block).toBe(0);
  });

  it('독: 요괴 턴 시작에 방어 무시 피해 후 1 감소', () => {
    const { run, b } = setup(['bamboo']);
    hand(b, ['poisonFog']);
    const f = b.foes[0];
    play(run, 800);
    expect(f.st.poison).toBe(3);
    f.intent = 'root';
    f.block = 10;
    const hp = f.hp;
    apply(run, { t: 'end' });
    expect(f.hp).toBe(hp - 3);
    expect(f.st.poison).toBe(2);
  });

  it('화상: 요괴 턴 끝에 피해 후 1 감소 · 영웅은 내 턴 끝', () => {
    const { run, b } = setup(['bamboo']);
    hand(b, ['ember']);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 800, f.uid);
    f.intent = 'grow';
    apply(run, { t: 'end' });
    expect(f.hp).toBe(hp - 3 - 3);
    expect(f.st.fire).toBe(2);
    b.st.fire = 2;
    b.hand = [];
    f.intent = 'grow';
    const me = run.hp;
    apply(run, { t: 'end' });
    expect(me - run.hp).toBe(2);
    expect(b.st.fire).toBe(1);
  });

  it('진흙: 다음 턴 뽑기 -1', () => {
    const { run, b } = setup(['acorn']);
    hand(b, []);
    b.foes[0].intent = 'shell';
    b.st.mud = 1;
    apply(run, { t: 'end' });
    expect(b.hand).toHaveLength(4);
    expect(b.st.mud).toBeUndefined();
  });

  it('뽑을 더미가 비면 버린 더미를 섞는다', () => {
    const { run, b } = setup(['acorn']);
    b.hand = [{ uid: 999, id: 'breathe' }];
    b.draw = [];
    b.discard = Array.from({ length: 4 }, (_, i) => ({ uid: 700 + i, id: 'slash' }));
    const ev = play(run, 999).ev;
    expect(ev.some((e) => e.e === 'shuffle')).toBe(true);
    expect(b.hand).toHaveLength(1);
    expect(b.draw).toHaveLength(3);
  });

  it('손패 최대 10: 넘치면 뽑은 카드는 버린 더미로', () => {
    const { run, b } = setup(['acorn']);
    b.hand = Array.from({ length: 10 }, (_, i) => ({ uid: 600 + i, id: 'slash' }));
    b.hand[0] = { uid: 999, id: 'breathe' };
    b.draw = [{ uid: 650, id: 'guard' }, { uid: 651, id: 'guard' }];
    b.energy = 1;
    expect(play(run, 999).ok).toBe(true); // 손 9 → 1장 뽑아 10
    expect(b.hand).toHaveLength(10);
    b.hand[1] = { uid: 998, id: 'breathe' };
    play(run, 998); // 손 9 → 10
    expect(b.hand).toHaveLength(10);
    b.draw = [{ uid: 652, id: 'guard' }];
    b.hand.push(); // 그대로 10
    const before = b.discard.length;
    // 손이 10장인데 카드를 쓰지 않고 뽑으면 (물약) 버린 더미로
    run.potions = ['swift'];
    apply(run, { t: 'potion', slot: 0 });
    expect(b.hand).toHaveLength(10);
    expect(b.discard.length).toBeGreaterThan(before);
  });

  it('소멸 카드는 이 전투에서 빠진다', () => {
    const { run, b } = setup(['acorn']);
    hand(b, ['breathe']);
    play(run, 800);
    expect(b.exhaust.map((c) => c.uid)).toContain(800);
    expect(b.discard.map((c) => c.uid)).not.toContain(800);
    expect(b.energy).toBe(4);
  });

  it('저승 사슬: 턴 끝에 손에 있으면 피해 3, 기력1로 소멸', () => {
    const { run, b } = setup(['acorn']);
    hand(b, ['chain', 'chain']);
    b.foes[0].intent = 'shell';
    play(run, 800);
    expect(b.exhaust.map((c) => c.id)).toContain('chain');
    const hp = run.hp;
    apply(run, { t: 'end' });
    expect(hp - run.hp).toBe(3);
  });

  it('반격 자세: 맞으면 반격', () => {
    const { run, b } = setup(['acorn']);
    hand(b, ['counter']);
    const f = b.foes[0];
    f.intent = 'roll';
    play(run, 800);
    const hp = f.hp;
    apply(run, { t: 'end' });
    expect(f.hp).toBe(hp - 3);
  });

  it('담금질: 공격카드 피해 +2 (부적술은 전투 내내)', () => {
    const { run, b } = setup(['lynx']);
    hand(b, ['temper', 'slash']);
    const f = b.foes[0];
    play(run, 800);
    const hp = f.hp;
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 8);
    expect(b.discard.map((c) => c.uid)).not.toContain(800);
  });

  it('물약: 기력 없이 쓰고 사라진다', () => {
    const { run, b } = setup(['lynx']);
    run.potions = ['fire', 'energy'];
    const f = b.foes[0];
    const hp = f.hp;
    expect(apply(run, { t: 'potion', slot: 0 }).ok).toBe(false); // 대상 필요
    expect(apply(run, { t: 'potion', slot: 0, target: f.uid }).ok).toBe(true);
    expect(f.hp).toBe(hp - 15);
    apply(run, { t: 'potion', slot: 0 });
    expect(b.energy).toBe(5);
    expect(run.potions).toEqual([]);
  });

  it('잘못된 입력은 받지 않고 기록에도 없다', () => {
    const { run, b } = setup(['lynx']);
    hand(b, ['smash', 'smash']);
    const n = run.log.length;
    expect(play(run, 800).ok).toBe(false); // 대상 없음
    expect(play(run, 12345, b.foes[0].uid).ok).toBe(false); // 손에 없음
    expect(play(run, 800, b.foes[0].uid).ok).toBe(true);
    expect(play(run, 801, b.foes[0].uid).ok).toBe(false); // 기력 1 < 2
    expect(run.log.length).toBe(n + 1);
  });
});

describe('보스', () => {
  it('체력 50% 이하에서 2단계 (행동 목록 교체)', () => {
    const { run, b } = setup(['centipede']);
    const f = b.foes[0];
    expect(f.maxHp).toBe(135);
    f.hp = 70;
    hand(b, ['slash']);
    const ev = play(run, 800, f.uid).ev;
    expect(f.phase).toBe(2);
    expect(f.intent).toBe('legs');
    expect(ev.some((e) => e.e === 'phase')).toBe(true);
  });

  it('구미호 분신: 소환 · 분신이 있으면 받는 피해 -50% · 보스가 쓰러지면 승리', () => {
    const { run, b } = setup(['gumiho']);
    const g = b.foes[0];
    g.intent = 'clones';
    b.hand = [];
    apply(run, { t: 'end' });
    expect(b.foes.filter((f) => f.minion && !f.dead)).toHaveLength(2);
    g.hp = 60;
    g.phase = 2;
    hand(b, ['slash', 'slash']);
    play(run, 800, g.uid);
    expect(g.hp).toBe(60 - 3);
    g.hp = 2;
    play(run, 801, g.uid);
    expect(b.over).toBe('win');
    expect(run.phase).toBe('won');
  });

  it('장산범 숨기: 다음 공격 1번 피함', () => {
    const { run, b } = setup(['jangsanbeom']);
    const f = b.foes[0];
    f.dodge = 1;
    hand(b, ['slash', 'slash']);
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(f.hp).toBe(hp);
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 6);
  });

  it('정예로 나오면 체력 60%', () => {
    const run = newRun({ seed: 1, hero: 'tiger' });
    enterTestBattle(run, ['gumiho'], 'elite');
    expect(run.battle!.foes[0].maxHp).toBe(78);
    expect(run.battle!.foes[0].elite).toBe(true);
  });
});

describe('결정성', () => {
  it('같은 씨앗 + 같은 입력 = 같은 결과, 기록으로 다시 돌려도 같다', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const a = newRun({ seed, hero: 'tiger' });
      enterTestBattle(a, ['fox', 'acorn', 'acorn']);
      playBattle(a);
      expect(a.battle!.over).toBeTruthy();
      const b = newRun({ seed, hero: 'tiger' });
      enterTestBattle(b, ['fox', 'acorn', 'acorn']);
      for (const i of a.log) expect(apply(b, i).ok).toBe(true);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('상태는 JSON 으로 저장했다 불러와도 이어서 똑같이 돌아간다', () => {
    const a = newRun({ seed: 42, hero: 'tiger' });
    enterTestBattle(a, ['lynx', 'acorn']);
    for (let k = 0; k < 3 && !a.battle!.over; k++) apply(a, { t: 'end' });
    const saved: RunState = JSON.parse(JSON.stringify(a));
    playBattle(a);
    playBattle(saved);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(a));
  });

  it('씨앗이 다르면 섞인 순서가 다르다', () => {
    const x = newRun({ seed: 1, hero: 'tiger' });
    const y = newRun({ seed: 2, hero: 'tiger' });
    enterTestBattle(x, ['fox']);
    enterTestBattle(y, ['fox']);
    const order = (r: RunState) => [...r.battle!.hand, ...r.battle!.draw].map((c) => c.uid).join();
    expect(order(x)).not.toBe(order(y));
  });
});

describe('봇', () => {
  it('어흥이가 대나무숲 일반 전투를 대부분 이긴다', () => {
    let win = 0;
    const N = 200;
    const sets = [['fox'], ['bamboo'], ['acorn', 'acorn'], ['lynx'], ['fox', 'acorn'], ['acorn', 'acorn', 'acorn']];
    for (let s = 0; s < N; s++) {
      const run = newRun({ seed: 1000 + s, hero: 'tiger' });
      enterTestBattle(run, sets[s % sets.length]);
      playBattle(run);
      if (run.battle!.over === 'win') win++;
    }
    console.log(`봇 일반 전투 승률 ${win}/${N}`);
    expect(win / N).toBeGreaterThan(0.8);
  });

  it('보스 3종과 끝까지 싸운다', () => {
    for (const boss of ['gumiho', 'jangsanbeom', 'centipede']) {
      let win = 0;
      for (let s = 0; s < 50; s++) {
        const run = newRun({ seed: 5000 + s, hero: 'tiger' });
        enterTestBattle(run, [boss], 'boss');
        playBattle(run);
        expect(run.battle!.over).toBeTruthy();
        if (run.battle!.over === 'win') win++;
      }
      console.log(`봇 시작 덱 vs ${boss}: ${win}/50`);
    }
  });
});

/** 공용 카드 60장 중 4단계에 더한 카드의 새 효과 (PRD [공용 카드 60장]) */
import { describe, expect, it } from 'vitest';
import { CARDS, apply, cardText, enterTestBattle, newRun, type Battle, type RunState } from '../src/game/rules';
import { runInput } from './bot';

function setup(foes = ['bamboo', 'bamboo'], hero = 'pig') {
  const run = newRun({ seed: 9, hero });
  run.hp = 60;
  enterTestBattle(run, foes);
  const b = run.battle!;
  for (const f of b.foes) {
    f.st = {};
    f.hp = f.maxHp = 100;
  }
  return { run, b, f: b.foes[0], g: b.foes[1] };
}
function hand(b: Battle, ids: (string | [string, boolean])[], e = 3) {
  b.discard.push(...b.hand);
  b.hand = ids.map((x, i) => (typeof x === 'string' ? { uid: 800 + i, id: x } : { uid: 800 + i, id: x[0], up: x[1] }));
  b.energy = e;
}
const play = (run: RunState, uid: number, target?: number) => apply(run, { t: 'play', uid, target });
function pass(run: RunState) {
  const b = run.battle!;
  for (const f of b.foes) f.intent = null;
  b.discard.push(...b.hand);
  b.hand = [];
  return apply(run, { t: 'end' });
}

describe('카드 설명', () => {
  it('86장 모두 설명이 있고, 강화하면 설명이나 기력이 바뀐다', () => {
    for (const c of CARDS) {
      expect(cardText(c.id).length, c.id).toBeGreaterThan(1);
      if (c.up) expect(cardText(c.id, true) !== cardText(c.id) || c.up.cost !== undefined, c.id).toBe(true);
    }
    expect(cardText('dragonBreath')).toBe('모든 적 10, 화상2');
    expect(cardText('thunderGeneral')).toBe('모든 적 20, 젖음2');
    expect(cardText('boltTalisman')).toBe('무작위 적 5×4, 젖은 적 2배');
    expect(cardText('wildfire')).toBe('모든 적 화상2, 이미 화상이면 +2');
    expect(cardText('trident')).toBe('피해 5, 다른 적 모두 3');
  });
});

describe('일반 카드', () => {
  it('엽전 던지기: 이기면 엽전 +5', () => {
    const run = newRun({ seed: 11, hero: 'pig' });
    apply(run, { t: 'go', col: 0 });
    const b = run.battle!;
    b.hand.push({ uid: 777, id: 'coinThrow' });
    b.energy = 3;
    apply(run, { t: 'play', uid: 777, target: b.foes[0].uid });
    expect(b.b.gold).toBe(5);
    const base = newRun({ seed: 11, hero: 'pig' });
    apply(base, { t: 'go', col: 0 });
    while (base.phase === 'battle') apply(base, runInput(base));
    while (run.phase === 'battle') apply(run, runInput(run));
    const g = (r: RunState) => r.reward!.items.find((x) => x.k === 'gold') as { n: number };
    expect(g(run).n).toBe(g(base).n + 5);
  });

  it('돌팔매: 방어 무시 · 삼지창: 대상 5, 다른 적 모두 3', () => {
    const { run, b, f, g } = setup();
    f.block = 10;
    hand(b, ['sling', 'trident']);
    play(run, 800, f.uid);
    expect(f.hp).toBe(94);
    expect(f.block).toBe(10);
    f.block = 0;
    play(run, 801, f.uid);
    expect([f.hp, g.hp]).toEqual([89, 97]);
  });

  it('그림자 걸음: 이번 턴 다음 카드 기력-1 · 돌담: 다음 턴 방어5', () => {
    const { run, b, f } = setup();
    hand(b, ['shadowStep', 'smash', 'smash', 'stoneWall'], 6);
    play(run, 800);
    expect(b.energy).toBe(5);
    play(run, 801, f.uid);
    expect(b.energy).toBe(4);
    play(run, 802, f.uid);
    expect(b.energy).toBe(2);
    play(run, 803);
    pass(run);
    expect(b.block).toBe(5);
  });

  it('겨누기: 다음 공격카드 피해 2배 (한 장만)', () => {
    const { run, b, f } = setup();
    hand(b, ['aim', 'guard', 'slash', 'slash'], 4);
    play(run, 800);
    play(run, 801);
    play(run, 802, f.uid);
    expect(f.hp).toBe(88);
    play(run, 803, f.uid);
    expect(f.hp).toBe(82);
  });

  it('물벼락·꽃가루·끈끈이 가시·약초·부채 바람', () => {
    const { run, b, f, g } = setup();
    hand(b, ['rainDrop', 'pollen', 'stickyBurr'], 3);
    play(run, 800);
    play(run, 801);
    play(run, 802, f.uid);
    expect(f.st).toEqual({ wet: 1, weak: 3 });
    expect(g.st).toEqual({ wet: 1, weak: 1 });
    hand(b, ['herb', 'fanWind'], 3);
    const n = b.hand.length;
    play(run, 800);
    expect(run.hp).toBe(64);
    expect(b.exhaust.some((c) => c.uid === 800)).toBe(true);
    play(run, 801);
    expect(b.block).toBe(4);
    expect(b.hand.length).toBe(n - 2 + 2);
  });
});

describe('고급 카드', () => {
  it('번개부적: 무작위 적 5×4, 젖은 적 2배', () => {
    const { run, b, f, g } = setup();
    f.st.wet = 3;
    g.st.wet = 3;
    hand(b, ['boltTalisman']);
    play(run, 800);
    // 젖음: 피해 ×2 (번개부적) × 1.5 (젖음) = 15 씩 4번
    expect(200 - f.hp - g.hp).toBe(60);
  });

  it('흡혈 베기: 준 피해 절반 회복, 소멸', () => {
    const { run, b, f } = setup();
    hand(b, ['vampSlash']);
    play(run, 800, f.uid);
    expect(run.hp).toBe(65);
    expect(b.exhaust.map((c) => c.uid)).toContain(800);
  });

  it('여우구슬: 손패 무작위 1장 이번 턴 기력0', () => {
    const { run, b, f } = setup();
    hand(b, ['foxBead', 'smash', 'smash']);
    play(run, 800, f.uid);
    expect(b.hand.filter((c) => c.free)).toHaveLength(1);
    const free = b.hand.find((c) => c.free)!;
    play(run, free.uid, f.uid);
    expect(b.energy).toBe(2);
  });

  it('구르기: 다음 턴 1장 더 · 거울 부채: 이번에 받는 상태이상 1번 막기', () => {
    const { run, b, f } = setup(['fox']);
    f.hp = 100;
    hand(b, ['roll', 'mirrorFan']);
    play(run, 800);
    play(run, 801);
    f.intent = 'foxfire';
    b.discard.push(...b.hand);
    b.hand = [];
    const ev = apply(run, { t: 'end' }).ev;
    expect(b.st.fire).toBeUndefined();
    expect(ev.some((e) => e.e === 'ward')).toBe(true);
    expect(b.hand).toHaveLength(6);
  });

  it('독 퍼뜨리기 · 독사의 길(내가 거는 독+1) · 만독(대상 독 3배)', () => {
    const { run, b, f, g } = setup();
    hand(b, ['viperPath', 'poisonSpear', 'spreadPoison'], 3);
    play(run, 800);
    play(run, 801, f.uid);
    expect(f.st.poison).toBe(5);
    play(run, 802, f.uid);
    expect(g.st.poison).toBe(6);
    hand(b, ['myriadPoison']);
    play(run, 800, f.uid);
    expect(f.st.poison).toBe(15);
  });

  it('불길 번지기: 모든 적 화상2, 이미 화상이면 +2', () => {
    const { run, b, f, g } = setup();
    f.st.fire = 1;
    hand(b, ['wildfire']);
    play(run, 800);
    expect([f.st.fire, g.st.fire]).toEqual([5, 2]);
  });

  it('날랜 몸(매 턴 1장 더) · 수호신(매 턴 방어3) · 십이지 대진(매 턴 기력+1) · 무한 부채(뽑을 때마다 방어1)', () => {
    const { run, b } = setup();
    hand(b, ['swiftBody', 'guardian', 'twelveArray', 'infiniteFan'], 9);
    for (const u of [800, 801, 802, 803]) expect(play(run, u).ok).toBe(true);
    pass(run);
    expect(b.hand).toHaveLength(6);
    expect(b.energy).toBe(4);
    expect(b.block).toBe(3 + 6);
  });
});

describe('전설 카드', () => {
  it('천둥 신장 · 별똥별(무작위 8×6) · 용오름(쓴 공격카드 1장당 +2)', () => {
    const { run, b, f, g } = setup();
    hand(b, ['thunderGeneral', 'meteor'], 6);
    play(run, 800);
    expect([f.hp, g.hp]).toEqual([80, 80]);
    expect(f.st.wet).toBe(2);
    play(run, 801);
    expect(160 - f.hp - g.hp).toBe(72); // 8 × 1.5 × 6
    const x = setup();
    hand(x.b, ['slash', 'slash', 'dragonRise'], 4);
    play(x.run, 800, x.f.uid);
    play(x.run, 801, x.f.uid);
    play(x.run, 802, x.f.uid);
    expect(x.f.hp).toBe(100 - 12 - 6 - 6);
  });

  it('시간 멈춤: 모든 적 다음 행동 건너뜀', () => {
    const { run, b, f, g } = setup();
    f.intent = 'stab';
    g.intent = 'stab';
    hand(b, ['timeStop']);
    play(run, 800);
    const hp = run.hp;
    b.hand = [];
    apply(run, { t: 'end' });
    expect(run.hp).toBe(hp);
    expect(f.stun).toBe(false);
  });

  it('불사조 깃: 이 전투에서 쓰러지면 체력 10% 로 한 번 일어남', () => {
    const { run, b, f } = setup();
    hand(b, ['phoenixFeather']);
    play(run, 800);
    run.hp = 2;
    f.intent = 'stab';
    b.hand = [];
    apply(run, { t: 'end' });
    expect(run.hp).toBe(Math.floor(run.maxHp * 0.1));
    expect(b.over).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { HEROES, apply, cardDef, cardPool, cardText, enterTestBattle, newRun, replay, restHeal, type Battle, type Input, type RunState } from '../src/game/rules';
import { playBattle, playRun } from './bot';

/** 그 영웅으로 연습 전투 하나 (요괴 상태이상은 지움) */
function setup(hero: string, foes: string[] = ['lynx'], seed = 7) {
  const run = newRun({ seed, hero });
  enterTestBattle(run, foes);
  const b = run.battle!;
  for (const f of b.foes) f.st = {};
  return { run, b };
}
/** 손패를 정해 둔다 */
function hand(b: Battle, ids: (string | [string, boolean])[]) {
  b.discard.push(...b.hand);
  b.hand = ids.map((x, i) => (typeof x === 'string' ? { uid: 800 + i, id: x } : { uid: 800 + i, id: x[0], up: x[1] }));
  b.energy = 3;
}
const play = (run: RunState, uid: number, target?: number) => apply(run, { t: 'play', uid, target });
const end = (run: RunState) => apply(run, { t: 'end' });
/** 요괴가 아무것도 안 하게 (턴 넘기기 시험용) */
function calm(b: Battle) {
  for (const f of b.foes) {
    f.intent = null;
    f.str = 0;
  }
}

describe('영웅 13명 데이터', () => {
  it('13명 모두 고를 수 있고, 시작 덱 = 베기5 + 막기4 + 전용1, 전용카드 2장이 다 있다', () => {
    expect(HEROES).toHaveLength(13);
    for (const h of HEROES) {
      expect(h.ready, h.id).toBe(true);
      const run = newRun({ seed: 1, hero: h.id });
      expect(run.hp).toBe(h.hp);
      expect(run.deck.map((c) => c.id).sort()).toEqual([...Array(4).fill('guard'), ...Array(5).fill('slash'), h.cards[0]].sort());
      expect(cardDef(h.cards[0]).rarity).toBe('hero');
      expect(cardDef(h.cards[1]).rarity).toBe('hero2');
      for (const id of h.cards) {
        expect(cardDef(id).hero).toBe(h.id);
        expect(cardText(id).length, id).toBeGreaterThan(1);
        expect(cardText(id, true).length, id).toBeGreaterThan(1);
      }
    }
    expect(HEROES.find((h) => h.id === 'cat')!.locked).toBe(true);
  });

  it('전용2(고급)는 그 영웅 보상에만, 상점에는 없다 · 다른 영웅 전용카드는 안 나온다', () => {
    const run = newRun({ seed: 1, hero: 'rat' });
    expect(cardPool(run, 'uncommon')).toContain('ratFire');
    expect(cardPool(run, 'uncommon', false)).not.toContain('ratFire');
    expect(cardPool(run, 'uncommon')).not.toContain('tigerMajesty');
    for (const r of ['common', 'uncommon', 'legend']) expect(cardPool(run, r).some((id) => cardDef(id).rarity === 'hero')).toBe(false);
  });
});

describe('패시브', () => {
  it('쥐: 턴 시작 1장 더 · 닭: 첫 턴만 2장 더', () => {
    expect(setup('rat').b.hand).toHaveLength(6);
    const { run, b } = setup('rooster');
    expect(b.hand).toHaveLength(7);
    calm(b);
    end(run);
    expect(run.battle!.hand).toHaveLength(5);
  });

  it('소: 턴 끝 남은 방어 절반 유지', () => {
    const { run, b } = setup('ox');
    hand(b, ['guard', 'guard']);
    play(run, 800);
    play(run, 801);
    expect(b.block).toBe(10);
    calm(b);
    end(run);
    expect(b.block).toBe(5);
  });

  it('호랑이: 전투 시작 모든 적 약화1', () => {
    const run = newRun({ seed: 3, hero: 'tiger' });
    enterTestBattle(run, ['fox', 'acorn']);
    for (const f of run.battle!.foes) expect(f.st.weak).toBe(1);
  });

  it('토끼: 쉼터 회복 +10', () => {
    const r = newRun({ seed: 1, hero: 'rabbit' });
    const t = newRun({ seed: 1, hero: 'tiger' });
    expect(restHeal(r)).toBe(Math.floor(66 * 0.3) + 10);
    expect(restHeal(t)).toBe(Math.floor(72 * 0.3));
  });

  it('용: 전투 첫 턴 기력+1 (둘째 턴부터 3)', () => {
    const { run, b } = setup('dragon');
    expect(b.energy).toBe(4);
    calm(b);
    end(run);
    expect(b.energy).toBe(3);
  });

  it('뱀: 턴마다 첫 공격카드에 독1 (둘째 공격은 아님)', () => {
    const { run, b } = setup('snake');
    hand(b, ['slash', 'slash']);
    const f = b.foes[0];
    play(run, 800, f.uid);
    expect(f.st.poison).toBe(1);
    play(run, 801, f.uid);
    expect(f.st.poison).toBe(1);
  });

  it('말: 턴마다 첫 공격카드 +3', () => {
    const { run, b } = setup('horse');
    hand(b, ['slash', 'slash']);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(f.hp).toBe(hp - 9);
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 15);
  });

  it('양: 전투 시작 방어6', () => {
    expect(setup('sheep').b.block).toBe(6);
  });

  it('원숭이: 카드 보상 선택지 4장 (다른 영웅은 3장)', () => {
    for (const [hero, n] of [
      ['monkey', 4],
      ['tiger', 3],
    ] as const) {
      const run = newRun({ seed: 11, hero });
      run.relics = [];
      // 첫 줄은 모두 전투
      apply(run, { t: 'go', col: run.map.rows[0][0].col });
      playBattle(run);
      expect(run.phase).toBe('reward');
      const it = run.reward!.items.find((x) => x.k === 'card');
      expect(it && it.k === 'card' && it.options.length).toBe(n);
    }
  });

  it('개: 체력 50% 이하면 공격카드 피해 +25%', () => {
    const { run, b } = setup('dog');
    hand(b, ['slash', 'slash']);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(f.hp).toBe(hp - 6);
    run.hp = Math.floor(run.maxHp / 2);
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 6 - 7);
  });

  it('돼지: 전투 승리 시 체력3 회복', () => {
    const run = newRun({ seed: 11, hero: 'pig' });
    apply(run, { t: 'go', col: run.map.rows[0][0].col });
    run.hp = 50;
    const b = run.battle!;
    for (const f of b.foes) f.hp = 1;
    hand(b, ['slash']);
    const before = run.hp;
    // 요괴가 여럿이면 하나씩
    for (const f of [...b.foes]) {
      if (f.dead) continue;
      hand(b, ['slash']);
      play(run, 800, f.uid);
    }
    expect(run.phase).toBe('reward');
    expect(run.hp).toBe(before + 3);
  });

  it('고양이: 한 판에 한 번 쓰러질 피해를 받으면 체력1로 버티고 방어10', () => {
    const { run, b } = setup('cat');
    hand(b, []);
    run.hp = 3;
    const f = b.foes[0];
    f.intent = 'pounce';
    // 스라소니 11 피해
    end(run);
    expect(run.hp).toBe(1);
    expect(run.flags.catUsed).toBe(true);
    expect(b.over).toBe(null);
    // 두 번째는 버티지 못함
    run.hp = 1;
    b.block = 0;
    b.hand = [];
    for (const x of b.foes) x.intent = 'pounce';
    end(run);
    expect(b.over).toBe('lose');
  });
});

describe('전용 카드', () => {
  it('쥐구멍: 2장 뽑고 1장 고를 때까지 다른 입력은 안 받는다', () => {
    const { run, b } = setup('rat');
    hand(b, ['ratHole', 'slash']);
    expect(play(run, 800).ok).toBe(true);
    expect(b.hand).toHaveLength(3);
    expect(b.pending).toEqual({ kind: 'discard', n: 1 });
    expect(play(run, 801, b.foes[0].uid).ok).toBe(false);
    expect(end(run).ok).toBe(false);
    expect(apply(run, { t: 'pick', uid: 801 }).ok).toBe(true);
    expect(b.pending).toBe(null);
    expect(b.hand).toHaveLength(2);
    expect(b.discard.some((c) => c.uid === 801)).toBe(true);
  });

  it('쥐불놀이: 이번 턴 뽑은 카드 1장당 모든 적 피해 2', () => {
    const { run, b } = setup('rat', ['acorn', 'acorn']);
    hand(b, ['ratFire']);
    b.t.drawn = 6;
    const hp = b.foes.map((f) => f.hp);
    play(run, 800);
    b.foes.forEach((f, i) => expect(f.hp).toBe(Math.max(0, hp[i] - 12)));
  });

  it('들이받기: 내 방어만큼 피해 · 우직함: 방어 얻을 때마다 +2', () => {
    const { run, b } = setup('ox');
    hand(b, ['steadfast', 'guard', 'headbutt']);
    play(run, 800);
    play(run, 801);
    expect(b.block).toBe(7);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 802, f.uid);
    expect(f.hp).toBe(hp - 7);
  });

  it('산군의 위엄: 약화된 적에게 피해 +50% · 호랑이 발톱 4×3', () => {
    const { run, b } = setup('tiger');
    hand(b, ['tigerMajesty', 'tigerClaw']);
    const f = b.foes[0];
    f.st.weak = 2;
    const hp = f.hp;
    play(run, 800);
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 6 * 3);
  });

  it('깡충: 방어8, 다음 턴 기력+1 · 절구질: 남은 기력1당 +4', () => {
    const { run, b } = setup('rabbit');
    hand(b, ['hop', 'mortar']);
    play(run, 800);
    expect(b.block).toBe(8);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 801, f.uid);
    // 기력 3 - 1 - 1 = 1 남음 → 4 + 4
    expect(f.hp).toBe(hp - 8);
    calm(b);
    end(run);
    expect(b.energy).toBe(4);
  });

  it('용의 숨결: 모든 적 10, 화상2 · 승천: 화상인 적 +10', () => {
    const { run, b } = setup('dragon', ['lynx', 'lynx']);
    hand(b, ['dragonBreath', 'ascend']);
    b.energy = 5;
    const [f1, f2] = b.foes;
    const hp1 = f1.hp;
    play(run, 800);
    expect(f1.hp).toBe(hp1 - 10);
    expect(f1.st.fire).toBe(2);
    expect(f2.st.fire).toBe(2);
    play(run, 801, f1.uid);
    expect(f1.hp).toBe(Math.max(0, hp1 - 10 - 35));
  });

  it('똬리: 대상 독 2배 · 허물벗기: 내 상태이상 모두 제거, 방어8', () => {
    const { run, b } = setup('snake');
    hand(b, ['coil', 'shed']);
    const f = b.foes[0];
    f.st.poison = 4;
    play(run, 800, f.uid);
    expect(f.st.poison).toBe(8);
    b.st = { fire: 2, wet: 1, mud: 1 };
    play(run, 801);
    expect(b.st).toEqual({});
    expect(b.block).toBe(8);
  });

  it('돌진: 12 + 앞서 쓴 카드 1장당 +2 · 천리마: 첫 공격카드 한 번 더', () => {
    const { run, b } = setup('horse', ['bamboo']);
    hand(b, ['galloper', 'charge']);
    b.energy = 4;
    const f = b.foes[0];
    f.hp = f.maxHp = 200;
    play(run, 800);
    play(run, 801, f.uid);
    // (12 + 2×1 + 말 패시브 3) × 2번
    expect(f.hp).toBe(200 - 17 * 2);
  });

  it('양털 방패: 방어12, 맞으면 반사3 · 털깎기: 방어만큼 모든 적 피해 후 방어 0', () => {
    const { run, b } = setup('sheep', ['acorn', 'lynx']);
    b.block = 0;
    hand(b, ['woolShield', 'shear']);
    play(run, 800);
    expect(b.block).toBe(12);
    expect(b.thorns).toBe(3);
    const hp = b.foes.map((f) => f.hp);
    play(run, 801);
    b.foes.forEach((f, i) => expect(f.hp).toBe(Math.max(0, hp[i] - 12)));
    expect(b.block).toBe(0);
  });

  it('흉내: 직전 카드 한 번 더 · 분신술: 손패 1장 복사본 2장, 소멸', () => {
    const { run, b } = setup('monkey');
    hand(b, ['slash', 'mimic', 'cloneArt', 'guard']);
    b.energy = 5;
    const f = b.foes[0];
    f.hp = f.maxHp = 100;
    play(run, 800, f.uid);
    play(run, 801);
    expect(f.hp).toBe(100 - 12);
    play(run, 802);
    expect(b.pending?.kind).toBe('clone');
    apply(run, { t: 'pick', uid: 803 });
    expect(b.hand.filter((c) => c.id === 'guard')).toHaveLength(3);
    expect(b.hand.filter((c) => c.tmp)).toHaveLength(2);
    expect(b.exhaust.some((c) => c.id === 'cloneArt')).toBe(true);
  });

  it('쪼기: 3×3, 약화1 · 홰치기: 매 턴 첫 카드 쓰면 1장 뽑기', () => {
    const { run, b } = setup('rooster');
    hand(b, ['crow', 'peck']);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 800);
    // 홰치기를 처음 쓴 그 카드로는 뽑지 않는다
    expect(b.hand).toHaveLength(1);
    play(run, 801, f.uid);
    expect(f.hp).toBe(hp - 9);
    expect(f.st.weak).toBe(1);
    calm(b);
    end(run);
    const n = b.hand.length;
    play(run, b.hand.find((c) => c.id === 'guard' || c.id === 'slash')!.uid, f.uid);
    expect(b.hand.length).toBe(n);
  });

  it('지킴이: 방어10, 맞으면 반격6 · 냄새 추적: 2턴치 의도, 젖음2', () => {
    const { run, b } = setup('dog');
    hand(b, ['watchdog', 'track']);
    play(run, 800);
    expect(b.block).toBe(10);
    expect(b.thorns).toBe(6);
    const f = b.foes[0];
    play(run, 801, f.uid);
    expect(f.st.wet).toBe(2);
    expect(f.next).toBeTruthy();
    const next = f.next;
    end(run);
    expect(f.intent).toBe(next);
    expect(f.next).toBe(null);
  });

  it('배치기: 최대 체력 10% 피해 · 먹성: 체력8 회복, 최대 체력+2, 소멸', () => {
    const { run, b } = setup('pig');
    hand(b, ['bellyFlop', 'gluttony']);
    const f = b.foes[0];
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(f.hp).toBe(hp - 9);
    run.hp = 50;
    play(run, 801);
    expect(run.maxHp).toBe(92);
    expect(run.hp).toBe(60);
    expect(b.exhaust.some((c) => c.id === 'gluttony')).toBe(true);
  });

  it('할퀴기: 피해5, 이번 턴 손패 공격카드 기력-1 · 살금살금: 다음 턴 첫 공격카드 기력0', () => {
    const { run, b } = setup('cat');
    hand(b, ['scratch', 'slash', 'sneak']);
    play(run, 800, b.foes[0].uid);
    expect(b.energy).toBe(2);
    play(run, 801, b.foes[0].uid);
    expect(b.energy).toBe(2);
    play(run, 802);
    calm(b);
    end(run);
    expect(b.freeAtk).toBe(true);
    const atk = b.hand.find((c) => cardDef(c.id).kind === 'atk')!;
    const e = b.energy;
    play(run, atk.uid, b.foes[0].uid);
    expect(b.energy).toBe(e);
    expect(b.freeAtk).toBe(false);
  });
});

describe('영웅 봇 · 결정성', () => {
  it('13명 모두 1막을 끝까지 돌고, 기록으로 다시 돌려도 같다', () => {
    const lines: string[] = [];
    for (const h of HEROES) {
      let wins = 0;
      const N = 12;
      for (let s = 0; s < N; s++) {
        const run = newRun({ seed: 1000 + s, hero: h.id });
        playRun(run);
        if (run.phase === 'won') wins++;
        if (s === 0) {
          const again = replay(run.seed, h.id, run.log as Input[]);
          expect(again.bad).toBe(-1);
          expect(JSON.stringify(again.run)).toBe(JSON.stringify(run));
        }
      }
      lines.push(`${h.name} ${wins}/${N}`);
    }
    console.log('봇 1막 클리어 — ' + lines.join(' · '));
  });
});

/** 부적 30개 (PRD [부적 30개]) — 전투 쪽은 battle.ts, 판 쪽(지도·쉼터·보상·엽전)은 run.ts */
import { describe, expect, it } from 'vitest';
import {
  CARD_ODDS,
  RELICS,
  RELIC_READY,
  Rng,
  apply,
  enterTestBattle,
  gainRelic,
  genMap,
  handMax,
  newRun,
  rarityOf,
  restHeal,
  restUpgrades,
  type Battle,
  type RunState,
} from '../src/game/rules';
import { runInput } from './bot';

/** 그 부적들을 가지고 연습 전투 (어흥이 대신 꿀꿀이 — 시작 약화가 없다) */
function setup(relics: string[], foes = ['bamboo'], kind: 'battle' | 'elite' | 'boss' = 'battle', hero = 'pig') {
  const run = newRun({ seed: 5, hero });
  for (const r of relics) gainRelic(run, r);
  enterTestBattle(run, foes, kind);
  const b = run.battle!;
  return { run, b, f: b.foes[0] };
}
function hand(b: Battle, ids: string[], e = 3) {
  b.discard.push(...b.hand);
  b.hand = ids.map((id, i) => ({ uid: 800 + i, id }));
  b.energy = e;
  for (const f of b.foes) {
    f.st = {};
    f.block = 0;
  }
}
const play = (run: RunState, uid: number, target?: number) => apply(run, { t: 'play', uid, target });
/** 요괴가 아무것도 안 하고 턴을 넘긴다 */
function pass(run: RunState) {
  const b = run.battle!;
  for (const f of b.foes) f.intent = null;
  b.discard.push(...b.hand);
  b.hand = [];
  return apply(run, { t: 'end' });
}
/** 정상 판에서 첫 전투를 이기고 보상 화면까지 */
function firstReward(relics: string[], seed = 11) {
  const run = newRun({ seed, hero: 'pig' });
  for (const r of relics) gainRelic(run, r);
  run.maxHp = 300;
  run.hp = 200;
  apply(run, { t: 'go', col: 0 });
  while (run.phase === 'battle') apply(run, runInput(run));
  return run;
}

describe('부적 데이터', () => {
  it('30개 = 일반 14 · 고급 10 · 보스 6, 전부 효과가 있다', () => {
    const n = (r: string) => RELICS.filter((x) => x.rarity === r).length;
    expect([RELICS.length, n('common'), n('uncommon'), n('boss')]).toEqual([30, 14, 10, 6]);
    for (const r of RELICS) expect(RELIC_READY.has(r.id), r.id).toBe(true);
  });
});

describe('일반 부적', () => {
  it('호리병: 전투 후 체력6', () => {
    const a = firstReward([]);
    const b = firstReward(['gourd']);
    expect(b.hp - a.hp).toBe(6);
  });

  it('복주머니: 엽전 +30%', () => {
    const gold = (run: RunState) => run.reward!.items.find((x) => x.k === 'gold')!;
    const a = gold(firstReward([]));
    const b = gold(firstReward(['luckyPouch']));
    expect(a.k === 'gold' && b.k === 'gold' && b.n === Math.floor(a.n * 1.3)).toBe(true);
  });

  it('도깨비 방망이: 전투 첫 턴 기력+1 · 나무 방패: 전투 시작 방어8 · 짚신: 첫 턴 2장 더', () => {
    expect(setup(['goblinClub']).b.energy).toBe(4);
    expect(setup(['woodShield']).b.block).toBe(8);
    expect(setup(['strawShoes']).b.hand).toHaveLength(7);
    const { run, b } = setup(['goblinClub', 'strawShoes']);
    pass(run);
    expect(b.energy).toBe(3);
    expect(b.hand).toHaveLength(5);
  });

  it('돌탑 조각: 최대 체력+8 · 엽전 돈주머니: 얻을 때 엽전+100', () => {
    const run = newRun({ seed: 1, hero: 'pig' });
    gainRelic(run, 'cairnStone');
    expect([run.hp, run.maxHp]).toEqual([98, 98]);
    gainRelic(run, 'coinPurse');
    expect(run.gold).toBe(199);
  });

  it('숫돌: 전투마다 첫 공격카드 +4 (타마다)', () => {
    const { run, b, f } = setup(['whetstone']);
    hand(b, ['slash', 'slash']);
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(hp - f.hp).toBe(10);
    play(run, 801, f.uid);
    expect(hp - f.hp).toBe(16);
  });

  it('새끼줄: 3턴마다 방어6', () => {
    const { run, b } = setup(['rope']);
    pass(run);
    expect(b.block).toBe(0);
    pass(run);
    expect(b.turn).toBe(3);
    expect(b.block).toBe(6);
  });

  it('수수깡: 체력 50% 이하가 되면 한 번 체력10', () => {
    const { run, b, f } = setup(['sorghum']);
    run.hp = 50;
    f.intent = 'stab';
    f.str = 0;
    b.hand = [];
    apply(run, { t: 'end' });
    expect(run.hp).toBe(50 - 9 + 10);
  });

  it('불씨: 내가 거는 화상+1 · 독사 이빨: 전투 시작 모든 적 독2 · 장구: 전투 시작 모든 적 약화1', () => {
    const { run, b, f } = setup(['emberCharm']);
    hand(b, ['ember']);
    play(run, 800, f.uid);
    expect(f.st.fire).toBe(4);
    const x = setup(['snakeFang', 'janggu'], ['fox', 'acorn']);
    for (const foe of x.b.foes) expect(foe.st).toEqual({ poison: 2, weak: 1 });
  });

  it('우산: 젖음 면역', () => {
    const { run, b, f } = setup(['umbrella'], ['water']);
    f.intent = 'drag';
    b.hand = [];
    apply(run, { t: 'end' });
    expect(b.st.wet).toBeUndefined();
  });
});

describe('고급 부적', () => {
  it('호랑이 수염: 정예·보스 피해 +20%', () => {
    const { run, b, f } = setup(['tigerWhisker'], ['gumiho'], 'boss');
    hand(b, ['smash']);
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(hp - f.hp).toBe(16);
    const x = setup(['tigerWhisker'], ['bamboo']);
    hand(x.b, ['smash']);
    const hp2 = x.f.hp;
    play(x.run, 800, x.f.uid);
    expect(hp2 - x.f.hp).toBe(14);
  });

  it('대장간 망치: 쉼터 강화 한 장 더 · 산삼: 쉼터 회복+15 · 여의주 조각: 쉼터 회복 불가', () => {
    const run = newRun({ seed: 1, hero: 'pig' });
    expect(restUpgrades(run)).toBe(1);
    gainRelic(run, 'smithHammer');
    expect(restUpgrades(run)).toBe(2);
    expect(restHeal(run)).toBe(27);
    gainRelic(run, 'wildGinseng');
    expect(restHeal(run)).toBe(42);
    gainRelic(run, 'dragonPearl');
    expect(restHeal(run)).toBe(0);
  });

  it('보물 지도: 지도에 보물 칸 +2 (다음 막부터 + 지금 막의 남은 전투 2칸)', () => {
    const count = (m: ReturnType<typeof genMap>) => m.rows.flat().filter((n) => n.type === 'treasure').length;
    expect(count(genMap(7, 2, 2))).toBe(count(genMap(7, 2, 0)) + 2);
    const run = newRun({ seed: 7, hero: 'pig' });
    const before = count(run.map);
    gainRelic(run, 'treasureMap');
    expect(count(run.map)).toBe(before + 2);
  });

  it('달빛 구슬: 턴 끝 손패 1장 남길 수 있음', () => {
    const { run, b } = setup(['moonOrb']);
    hand(b, ['smash', 'guard']);
    for (const f of b.foes) f.intent = null;
    expect(apply(run, { t: 'end', keep: 800 }).ok).toBe(true);
    expect(b.hand.filter((c) => c.uid === 800)).toHaveLength(1);
    const x = setup([]);
    hand(x.b, ['smash']);
    expect(apply(x.run, { t: 'end', keep: 800 }).ok).toBe(false);
  });

  it('버선 한 쌍: 전투에 한 번 첫 카드 기력-1', () => {
    const { run, b, f } = setup(['beoseon']);
    hand(b, ['smash', 'smash']);
    play(run, 800, f.uid);
    expect(b.energy).toBe(2);
    play(run, 801, f.uid);
    expect(b.energy).toBe(0);
  });

  it('대나무 통: 소멸 카드 쓸 때마다 방어4', () => {
    const { run, b } = setup(['bambooTube']);
    hand(b, ['herb']);
    play(run, 800);
    expect(b.block).toBe(4);
  });

  it('까치 깃털: 고급 이상 카드가 더 자주', () => {
    const tally = (relics: string[]) => {
      const run = newRun({ seed: 1, hero: 'pig' });
      run.relics = relics;
      const r = new Rng({ s: 99 }, 's');
      let hi = 0;
      for (let i = 0; i < 4000; i++) if (rarityOf(run, r) !== 'common') hi++;
      return hi / 4000;
    };
    const base = tally([]);
    expect(Math.abs(base - (100 - CARD_ODDS[0][1]) / 100)).toBeLessThan(0.03);
    expect(tally(['magpieFeather'])).toBeGreaterThan(base + 0.1);
  });

  it('얼음 항아리: 턴이 끝나도 방어3 남김', () => {
    const { run, b } = setup(['iceJar']);
    b.block = 10;
    pass(run);
    expect(b.block).toBe(3);
  });

  it('번개 부채: 젖은 적 공격 시 +3', () => {
    const { run, b, f } = setup(['thunderFan']);
    hand(b, ['slash']);
    f.st.wet = 2;
    const hp = f.hp;
    play(run, 800, f.uid);
    expect(hp - f.hp).toBe(Math.floor((6 + 3) * 1.5));
  });
});

describe('보스 부적', () => {
  it('여의주 조각: 매 턴 기력+1 · 쉼터에서 쉬기 불가', () => {
    const { b } = setup(['dragonPearl']);
    expect(b.energy).toBe(4);
  });

  it('염라의 장부: 매 턴 기력+1, 전투 시작 시 저승 사슬1', () => {
    const { b } = setup(['yeomraLedger']);
    expect(b.energy).toBe(4);
    expect([...b.hand, ...b.draw].filter((c) => c.id === 'chain')).toHaveLength(1);
  });

  it('구미호 구슬: 전투 시작 분신이 첫 공격 대신 맞음', () => {
    const { run, b, f } = setup(['foxOrb']);
    f.intent = 'stab';
    b.hand = [];
    const hp = run.hp;
    apply(run, { t: 'end' });
    expect(run.hp).toBe(hp);
    expect(b.foxShield).toBe(false);
  });

  it('불가살 쇠조각: 한 판에 한 번 쓰러지면 20%로 부활', () => {
    const { run, b, f } = setup(['bulgasalIron']);
    run.hp = 3;
    f.intent = 'stab';
    f.str = 0;
    b.hand = [];
    apply(run, { t: 'end' });
    expect(run.hp).toBe(18);
    expect(run.flags.ironUsed).toBe(true);
    run.hp = 3;
    f.intent = 'stab';
    b.block = 0;
    b.hand = [];
    apply(run, { t: 'end' });
    expect(b.over).toBe('lose');
  });

  it('이무기 비늘: 매 턴 1장 더, 손패 최대 7', () => {
    const { run, b } = setup(['imugiScale']);
    expect(b.hand).toHaveLength(6);
    expect(handMax(run)).toBe(7);
  });

  it('큰도깨비 방망이: 엽전 쓸 때 25% 돌려받음', () => {
    for (let seed = 1; seed < 80; seed++) {
      const run = newRun({ seed, hero: 'pig' });
      gainRelic(run, 'dokkaebiClub');
      run.hp = run.maxHp = 999;
      let guard = 0;
      // 봇은 엽전이 넉넉하면 상점 칸을 고른다
      while (run.phase !== 'shop' && run.phase !== 'dead' && run.phase !== 'won' && run.act === 1 && guard++ < 3000) {
        run.gold = Math.max(run.gold, 150);
        apply(run, runInput(run));
      }
      if (run.phase !== 'shop') continue;
      run.gold = 200;
      const price = run.shop!.cards[0].price;
      expect(apply(run, { t: 'buy', kind: 'card', i: 0 }).ok).toBe(true);
      expect(run.gold).toBe(200 - price + Math.floor(price * 0.25));
      return;
    }
    throw new Error('상점 칸을 못 찾음');
  });
});

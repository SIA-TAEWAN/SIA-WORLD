import { describe, expect, it } from 'vitest';
import { BONUS, CARD_WEIGHT, LIMIT, xpNeed } from '../src/data/balance';
import { EVOLUTIONS } from '../src/data/evolutions';
import { ITEM } from '../src/data/items';
import { PASSIVES, PASSIVE_INDEX } from '../src/data/passives';
import { WEAPONS, WEAPON_INDEX } from '../src/data/weapons';
import { dropPickup } from '../src/game/core';
import { addPassive, addWeapon, applyCard, drawCards, evolvable, openChest } from '../src/game/levelup';
import { makeInput, step } from '../src/game/sim';
import { CARD, EV, type State } from '../src/game/state';
import { advance, disarm, emptyRun, live, put } from './helpers';

const cards = (s: State) => s.cards.slice(0, s.cardN);
const events = (s: State) => live({ items: s.events, n: s.evN });

describe('경험치와 레벨업', () => {
  it('요괴를 잡으면 구슬이 떨어지고, 가까이 가면 빨려와 경험치가 된다', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    const e = put(s, 'imp', 300, 0);
    e.speed = 0;
    e.hp = 0.5;
    addWeapon(s, WEAPON_INDEX.shuriken);
    advance(s, 1.5);
    expect(s.kills).toBe(1);
    const gem = live(s.pickups).find((p) => p.kind === ITEM.gemS)!;
    expect(gem.value).toBe(1);
    expect(s.xp).toBe(0);
    // 획득 범위(72) 밖에서는 그대로 있다가, 안으로 들어가면 빨려온다
    s.player.x = gem.x - 60;
    s.player.y = gem.y;
    advance(s, 0.5);
    expect(s.xp).toBe(1);
    expect(live(s.pickups).some((p) => p.kind === ITEM.gemS)).toBe(false);
  });

  it('쥐의 특성(경험치 +10%)과 강화가 더해진다', () => {
    const s = disarm(emptyRun({ char: 'rat', upgrades: { xp: 2 } }));
    s.xpNext = 10; // 레벨이 오르지 않게 (1레벨은 경험치 2면 오른다)
    dropPickup(s, ITEM.gemS, 0, 0, 2);
    advance(s, 0.1);
    expect(s.xp).toBeCloseTo(2.4, 6);
  });

  it('경험치가 차면 게임이 멈추고 카드 3장이 나온다. 고르면 다시 진행한다', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    s.xp = xpNeed(1);
    step(s, makeInput());
    expect(s.phase).toBe('levelup');
    expect(s.level).toBe(2);
    expect(s.xpNext).toBe(xpNeed(2));
    expect(s.cardN).toBe(3);
    expect(events(s).some((e) => e.t === EV.levelup && e.a === 2)).toBe(true);
    const tick = s.tick;
    for (let i = 0; i < 30; i++) step(s, makeInput());
    expect(s.tick).toBe(tick);
    const c = { ...s.cards[1] };
    step(s, { mx: 0, my: 0, pick: 1, reroll: false });
    expect(s.phase).toBe('play');
    if (c.type === CARD.weapon) expect(s.weapons.some((w) => w.def === c.def && w.lv === c.lv)).toBe(true);
    else expect(s.passives.some((p) => p.def === c.def && p.lv === c.lv)).toBe(true);
    step(s, makeInput());
    expect(s.tick).toBe(tick + 1);
  });

  it('한꺼번에 여러 레벨이 오르면 이어서 고른다', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    s.xp = xpNeed(1) + xpNeed(2) + 1;
    step(s, makeInput());
    step(s, { mx: 0, my: 0, pick: 0, reroll: false });
    expect(s.phase).toBe('levelup');
    expect(s.level).toBe(3);
    step(s, { mx: 0, my: 0, pick: 0, reroll: false });
    expect(s.phase).toBe('play');
    expect(s.xp).toBeCloseTo(1, 6);
  });

  it('다시 뽑기: 강화로 얻은 횟수만큼만 쓸 수 있다', () => {
    const s = disarm(emptyRun({ char: 'ox', upgrades: { reroll: 1 } }));
    s.xp = xpNeed(1);
    step(s, makeInput());
    const rng = s.rng;
    step(s, { mx: 0, my: 0, pick: -1, reroll: true });
    expect(s.rerolls).toBe(0);
    expect(s.rng).not.toBe(rng);
    const rng2 = s.rng;
    step(s, { mx: 0, my: 0, pick: -1, reroll: true });
    expect(s.rng).toBe(rng2);
    expect(s.phase).toBe('levelup');
  });
});

describe('카드 뽑기 규칙', () => {
  it('카드 3장은 서로 다르고, 진화 무기·준비 안 된 무기는 나오지 않는다', () => {
    const s = emptyRun();
    for (let i = 0; i < 300; i++) {
      drawCards(s);
      const cs = cards(s);
      expect(cs.length).toBe(3);
      expect(new Set(cs.map((c) => `${c.type}:${c.def}`)).size).toBe(3);
      for (const c of cs) {
        if (c.type !== CARD.weapon) continue;
        expect(WEAPONS[c.def].evolved).toBeFalsy();
        expect(WEAPONS[c.def].ready).toBe(true);
      }
    }
  });

  /** 카드를 n번 뽑아, 카드마다 나온 횟수를 센다 (열쇠: 'w:무기 id' · 'p:패시브 id') */
  const tally = (s: State, n: number) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      drawCards(s);
      for (const c of cards(s)) {
        const key = c.type === CARD.weapon ? `w:${WEAPONS[c.def].id}` : `p:${PASSIVES[c.def].id}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    return (key: string) => seen.get(key) ?? 0;
  };

  it('가진 무기의 강화와 그 무기의 진화 짝 패시브가 더 자주 나온다 (가중치)', () => {
    expect(CARD_WEIGHT.ownedWeapon).toBeGreaterThan(1);
    expect(CARD_WEIGHT.evoWeapon).toBeGreaterThan(CARD_WEIGHT.ownedWeapon);
    expect(CARD_WEIGHT.evoPassive).toBeGreaterThan(1);
    // 호랑이: 발톱(가진 무기, 진화가 있다) + 힘의 부적(발톱의 진화 짝). 독안개는 진화가 없는 가진 무기
    const s = emptyRun({ char: 'tiger' });
    addWeapon(s, WEAPON_INDEX.mist, 1);
    const n = tally(s, 3000);
    const others = PASSIVES.filter((p) => p.id !== 'might').map((p) => n(`p:${p.id}`));
    const plain = others.reduce((a, b) => a + b, 0) / others.length;
    // 3장을 겹치지 않게 뽑으므로 나온 횟수의 비는 가중치보다 조금 작다
    expect(n('w:claw') / plain).toBeGreaterThan(CARD_WEIGHT.evoWeapon * 0.65);
    expect(n('w:claw') / plain).toBeLessThan(CARD_WEIGHT.evoWeapon * 1.1);
    expect(n('w:mist') / plain).toBeGreaterThan(CARD_WEIGHT.ownedWeapon * 0.7);
    expect(n('w:mist') / plain).toBeLessThan(CARD_WEIGHT.ownedWeapon * 1.1);
    expect(n('w:claw')).toBeGreaterThan(n('w:mist') * 1.15);
    expect(n('p:might') / plain).toBeGreaterThan(CARD_WEIGHT.evoPassive * 0.65);
    expect(n('p:might') / plain).toBeLessThan(CARD_WEIGHT.evoPassive * 1.1);
    // 새 무기와 짝이 아닌 패시브는 모두 같은 무게
    expect(n('w:shuriken') / plain).toBeGreaterThan(0.75);
    expect(n('w:shuriken') / plain).toBeLessThan(1.25);
    for (const c of others) expect(c / plain).toBeGreaterThan(0.75);
  });

  it('2차 진화 4종(plainPassive): 무기 강화는 진화가 있는 무기만큼 자주 나오지만, 짝 패시브는 밀어주지 않는다', () => {
    expect(EVOLUTIONS.filter((e) => e.plainPassive).map((e) => e.result)).toEqual(['bellEvo', 'mooncakeEvo', 'hoofEvo', 'piggyEvo']);
    // 말: 말발굽(가진 무기, 진화가 있다) + 바람의 신(짝이지만 보통 무게)
    const s = emptyRun({ char: 'horse' });
    const n = tally(s, 3000);
    const others = PASSIVES.filter((p) => p.id !== 'wind').map((p) => n(`p:${p.id}`));
    const plain = others.reduce((a, b) => a + b, 0) / others.length;
    expect(n('w:hoof') / plain).toBeGreaterThan(CARD_WEIGHT.evoWeapon * 0.65);
    expect(n('w:hoof') / plain).toBeLessThan(CARD_WEIGHT.evoWeapon * 1.1);
    expect(n('p:wind') / plain).toBeGreaterThan(0.75);
    expect(n('p:wind') / plain).toBeLessThan(1.25);
  });

  it('짝 패시브를 얻은 뒤에는 그 패시브의 강화가 보통 무게로 돌아가고, 진화한 뒤에는 짝 패시브를 밀어주지 않는다', () => {
    const s = emptyRun({ char: 'tiger' });
    addPassive(s, PASSIVE_INDEX.might, 1);
    addPassive(s, PASSIVE_INDEX.wind, 1);
    const n = tally(s, 3000);
    expect(n('p:might') / n('p:wind')).toBeGreaterThan(0.8);
    expect(n('p:might') / n('p:wind')).toBeLessThan(1.25);
    expect(n('w:claw')).toBeGreaterThan(n('p:wind') * 1.6);
    // 진화한 발톱: 힘의 부적이 없어도 더 자주 나오지 않는다
    const t = emptyRun({ char: 'tiger' });
    t.weapons[0].lv = 5;
    addPassive(t, PASSIVE_INDEX.might, 1);
    openChest(t);
    expect(WEAPONS[t.weapons[0].def].id).toBe('clawEvo');
    t.passives.length = 0;
    const m = tally(t, 3000);
    expect(m('p:might') / m('p:wind')).toBeGreaterThan(0.8);
    expect(m('p:might') / m('p:wind')).toBeLessThan(1.25);
  });

  it('같은 시드면 같은 카드가 같은 순서로 나온다 (가중치를 줘도 난수는 카드 한 장에 한 번)', () => {
    const draw = (seed: number) => {
      const s = emptyRun({ char: 'tiger', seed });
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        const before = s.rng;
        drawCards(s);
        expect(s.rng).not.toBe(before);
        out.push(cards(s).map((c) => `${c.type}:${c.def}:${c.lv}`).join(','));
        if (i % 3 === 0) applyCard(s, s.cards[0].type, s.cards[0].def, s.cards[0].lv);
      }
      return out;
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it('가진 것은 다음 레벨이, 없는 것은 1레벨(새로 얻기)이 나온다', () => {
    const s = emptyRun();
    addWeapon(s, WEAPON_INDEX.shuriken, 3);
    addPassive(s, PASSIVE_INDEX.fan, 2);
    for (let i = 0; i < 200; i++) {
      drawCards(s);
      for (const c of cards(s)) {
        const own = c.type === CARD.weapon ? s.weapons.find((w) => w.def === c.def)?.lv : s.passives.find((p) => p.def === c.def)?.lv;
        expect(c.lv).toBe((own ?? 0) + 1);
        expect(c.isNew).toBe(own === undefined);
      }
    }
  });

  it('무기 4개·패시브 6개가 차면 새것은 나오지 않고, 5레벨은 더 오르지 않는다', () => {
    const s = emptyRun();
    s.weapons.length = 0;
    expect(LIMIT.weapons).toBe(4);
    expect(LIMIT.passives).toBe(6);
    for (const id of ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist']) addWeapon(s, WEAPON_INDEX[id], 5);
    for (let i = 0; i < 6; i++) addPassive(s, i, i < 5 ? 5 : 4);
    expect(s.weapons.length).toBe(LIMIT.weapons);
    expect(s.weapons.map((w) => WEAPONS[w.def].id)).toEqual(['shuriken', 'bell', 'claw', 'mooncake']);
    expect(s.passives.length).toBe(LIMIT.passives);
    addPassive(s, 6, 1);
    addWeapon(s, WEAPON_INDEX.shurikenEvo, 1);
    expect(s.passives.length).toBe(6);
    expect(s.weapons.length).toBe(4);
    drawCards(s);
    // 남은 것은 패시브 하나(4→5)뿐: 나머지 두 장은 덤(떡·엽전)
    expect(cards(s).map((c) => c.type)).toEqual([CARD.passive, CARD.heal, CARD.coins]);
    expect(cards(s)[0]).toMatchObject({ def: 5, lv: 5, isNew: false });
    addPassive(s, 5, 9);
    expect(s.passives[5].lv).toBe(LIMIT.level);
    drawCards(s);
    expect(cards(s).map((c) => c.type)).toEqual([CARD.heal, CARD.coins]);
  });

  it('덤 카드: 떡은 체력을, 엽전은 엽전을 준다', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    for (const id of ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist']) addWeapon(s, WEAPON_INDEX[id], 5);
    for (let i = 0; i < 6; i++) addPassive(s, i, 5);
    s.weapons.length = 0; // 조용히 (무기는 이미 찼다고 본 뒤 치운다)
    for (const id of ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist']) s.weapons.push({ def: WEAPON_INDEX[id], lv: 5, cd: 99, a: 0, view: 0 });
    s.player.hp = 50;
    s.xp = s.xpNext;
    step(s, makeInput());
    expect(cards(s).map((c) => c.type)).toEqual([CARD.heal, CARD.coins]);
    step(s, { mx: 0, my: 0, pick: 0, reroll: false });
    expect(s.player.hp).toBe(50 + BONUS.heal);
    s.xp = s.xpNext;
    step(s, makeInput());
    step(s, { mx: 0, my: 0, pick: 1, reroll: false });
    expect(s.coins).toBeCloseTo(BONUS.coins, 6);
  });

  it('패시브 12종의 효과 (레벨당)', () => {
    const s = disarm(emptyRun({ char: 'dog' }));
    const base = { ...s.stats };
    for (let i = 0; i < 6; i++) addPassive(s, i, 2);
    expect(s.stats.might).toBeCloseTo(base.might + 0.2, 6);
    expect(s.stats.speed).toBeCloseTo(base.speed * 1.16, 6);
    expect(s.stats.armor).toBe(2);
    expect(s.stats.area).toBeCloseTo(1.2, 6);
    expect(s.stats.cooldown).toBeCloseTo(0.84, 6);
    // 개의 특성(+20%)에 자석(+50%씩)이 더해진다
    expect(s.stats.pickup).toBeCloseTo(72 * 2.2, 6);
    const t = disarm(emptyRun({ char: 'rat' }));
    t.player.hp = 60;
    addPassive(t, PASSIVE_INDEX.ginseng, 3);
    addPassive(t, PASSIVE_INDEX.knot, 3);
    expect(t.stats.maxHp).toBe(130);
    expect(t.player.hp).toBe(90); // 늘어난 만큼 지금 체력도 는다
    expect(t.stats.coin).toBeCloseTo(1.3, 6);
    // 세트용 4종: 지속 피해 · 회복 · 경험치 · 투사체 속도
    const u = disarm(emptyRun({ char: 'rat' }));
    const ub = { ...u.stats };
    for (const id of ['venom', 'spring', 'scroll', 'string']) addPassive(u, PASSIVE_INDEX[id], 2);
    expect(u.stats.dot).toBeCloseTo(ub.dot + 0.2, 6);
    expect(u.stats.regen).toBeCloseTo(ub.regen + 0.3, 6);
    expect(u.stats.xp).toBeCloseTo(ub.xp + 0.2, 6);
    expect(u.stats.projSpeed).toBeCloseTo(ub.projSpeed + 0.2, 6);
    expect(PASSIVES.length).toBe(12);
  });
});

describe('진화와 보물상자', () => {
  it('진화 조합 7종: 표창+부채, 여의주+넓은 소매, 발톱+힘의 부적, 방울+거북 등껍질, 달떡+인삼, 말발굽+바람의 신, 복돼지+복주머니 매듭', () => {
    expect(EVOLUTIONS.map((e) => `${e.weapon}+${e.passive}=${e.result}`)).toEqual([
      'shuriken+fan=shurikenEvo', 'pearl+sleeve=pearlEvo', 'claw+might=clawEvo',
      'bell+shell=bellEvo', 'mooncake+ginseng=mooncakeEvo', 'hoof+wind=hoofEvo', 'piggy+knot=piggyEvo',
    ]);
  });

  it('무기 5레벨 + 짝 패시브가 있어야 진화한다', () => {
    for (const ev of EVOLUTIONS) {
      const s = disarm(emptyRun({ char: 'ox' }));
      addWeapon(s, WEAPON_INDEX[ev.weapon], 4);
      addPassive(s, PASSIVE_INDEX[ev.passive], 1);
      expect(evolvable(s)).toBe(-1); // 4레벨
      s.weapons[0].lv = 5;
      expect(evolvable(s)).toBe(0);
      s.passives.length = 0;
      expect(evolvable(s)).toBe(-1); // 짝 패시브 없음
      addPassive(s, PASSIVE_INDEX[ev.passive === 'fan' ? 'might' : 'fan'], 1);
      expect(evolvable(s)).toBe(-1); // 다른 패시브
      addPassive(s, PASSIVE_INDEX[ev.passive], 1);
      openChest(s);
      expect(WEAPONS[s.weapons[0].def].id).toBe(ev.result);
      expect(events(s).some((e) => e.t === EV.evolve && e.a === WEAPON_INDEX[ev.result])).toBe(true);
      // 진화한 뒤에는 원래 무기가 다시 카드에 나오지 않는다
      for (let i = 0; i < 100; i++) {
        drawCards(s);
        expect(cards(s).some((c) => c.type === CARD.weapon && (c.def === WEAPON_INDEX[ev.weapon] || c.def === WEAPON_INDEX[ev.result]))).toBe(false);
      }
    }
  });

  it('진화할 것이 없으면 보물상자는 가진 것 하나를 한 레벨 올려 준다', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    addWeapon(s, WEAPON_INDEX.bell, 2);
    openChest(s);
    expect(s.weapons[0].lv).toBe(3);
    expect(events(s).some((e) => e.t === EV.chestGain)).toBe(true);
    s.weapons[0].lv = 5;
    openChest(s);
    expect(s.coins).toBeGreaterThan(0);
  });
});

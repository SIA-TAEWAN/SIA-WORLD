import { describe, expect, it } from 'vitest';
import { BONUS, LIMIT, xpNeed } from '../src/data/balance';
import { EVOLUTIONS } from '../src/data/evolutions';
import { ITEM } from '../src/data/items';
import { PASSIVES, PASSIVE_INDEX } from '../src/data/passives';
import { WEAPONS, WEAPON_INDEX } from '../src/data/weapons';
import { dropPickup } from '../src/game/core';
import { addPassive, addWeapon, drawCards, evolvable, openChest } from '../src/game/levelup';
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

  it('무기 6개·패시브 6개가 차면 새것은 나오지 않고, 5레벨은 더 오르지 않는다', () => {
    const s = emptyRun();
    s.weapons.length = 0;
    for (const id of ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist']) addWeapon(s, WEAPON_INDEX[id], 5);
    for (let i = 0; i < 6; i++) addPassive(s, i, i < 5 ? 5 : 4);
    expect(s.weapons.length).toBe(LIMIT.weapons);
    expect(s.passives.length).toBe(LIMIT.passives);
    addPassive(s, 6, 1);
    addWeapon(s, WEAPON_INDEX.shurikenEvo, 1);
    expect(s.passives.length).toBe(6);
    expect(s.weapons.length).toBe(6);
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

  it('패시브 8종의 효과 (레벨당)', () => {
    const s = disarm(emptyRun({ char: 'dog' }));
    const base = { ...s.stats };
    for (let i = 0; i < 6; i++) addPassive(s, i, 2);
    expect(s.stats.might).toBeCloseTo(base.might + 0.2, 6);
    expect(s.stats.speed).toBeCloseTo(base.speed * 1.16, 6);
    expect(s.stats.armor).toBe(2);
    expect(s.stats.area).toBeCloseTo(1.2, 6);
    expect(s.stats.cooldown).toBeCloseTo(0.84, 6);
    // 개의 특성(+20%)에 자석(+25%씩)이 더해진다
    expect(s.stats.pickup).toBeCloseTo(72 * 1.7, 6);
    const t = disarm(emptyRun({ char: 'rat' }));
    t.player.hp = 60;
    addPassive(t, PASSIVE_INDEX.ginseng, 3);
    addPassive(t, PASSIVE_INDEX.knot, 3);
    expect(t.stats.maxHp).toBe(130);
    expect(t.player.hp).toBe(90); // 늘어난 만큼 지금 체력도 는다
    expect(t.stats.coin).toBeCloseTo(1.3, 6);
    expect(PASSIVES.length).toBe(8);
  });
});

describe('진화와 보물상자', () => {
  it('진화 조합 3종: 표창+부채, 여의주+넓은 소매, 발톱+힘의 부적', () => {
    expect(EVOLUTIONS.map((e) => `${e.weapon}+${e.passive}=${e.result}`)).toEqual(['shuriken+fan=shurikenEvo', 'pearl+sleeve=pearlEvo', 'claw+might=clawEvo']);
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

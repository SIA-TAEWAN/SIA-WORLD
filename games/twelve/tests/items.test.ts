import { describe, expect, it } from 'vitest';
import { ACC_STATS, BAG, DROP, FX, MAX_PLUS, PITY, POTION, REGION_TIER, WEAPON_FX, armorDefOf, armorHpOf, bagPrice, buyPrice, enhanceCost, regionTier, weaponAtkOf } from '../src/data/economy';
import { ITEMS, gearDrops, itemDef, itemLevel, itemStats, regionRares, starReward } from '../src/data/items';
import { MODES, REGIONS } from '../src/data/regions';
import { TIER_LEVELS, WEAPON_KINDS, tierAtk } from '../src/data/weapons';
import { bossDrop, copyCtx, eliteDrop, noPity, normalDrop, roll, rollRun, type Drop, type DropCtx } from '../src/game/drops';
import { addItem, applyReport, bagCount, boxItems, emptyProfile, equipped, loadoutOf, pityOf, weaponOf, type RunReport } from '../src/game/progress';
import { buy, claim, enhance, equip, forSale, scrap, scrapOf, sell, setLock, shopTier, unequip } from '../src/game/rules';
import { mapKillMax, mapOf } from '../src/data/maps';
import { playerStats } from '../src/data/growth';
import { arena, at, group, place, play, run } from './helpers';
import { createRun, PICK_DIST } from '../src/game/sim';

/** 씨앗·종류·순번 → 값. 서버(_twelve_roll)도 같은 값을 내야 한다 (scripts/pg-check.mjs) */
export const ROLL_VECTORS = [3867720813, 1989341573, 3474315949, 1758990476];
const ctx = (over: Partial<DropCtx> = {}): DropCtx => ({ seed: 1, region: 1, mode: 'normal', pity: noPity(), codex: [], hasKey: false, ...over });
const report = (map: string, over: Partial<RunReport> = {}): RunReport => {
  const m = mapOf(map)!;
  const max = mapKillMax(m, over.mode ?? 'normal');
  return { run: 'r', map, mode: 'normal', hero: 'rat', time: 100, cleared: true, kills: { ...max.kinds }, elites: max.elites, boss: !!m.boss, chest: true, deaths: 0, ...over };
};

describe('장비 목록', () => {
  it('일반 무기 4종 × 12등급 · 방어구 12등급 · 장신구 · 지형 레어가 있다', () => {
    expect(ITEMS.filter((d) => d.slot === 'weapon' && !d.rare).length).toBe(48);
    expect(ITEMS.filter((d) => d.slot === 'armor' && !d.rare).length).toBe(12);
    expect(ITEMS.filter((d) => d.id.startsWith('c-')).length).toBe(ACC_STATS.length * 12);
    expect(ITEMS.filter((d) => d.id.startsWith('r-')).length).toBe(REGIONS * 3 * 2);
    expect(ITEMS.filter((d) => d.id.startsWith('s-')).length).toBe(REGIONS * 2);
    expect(new Set(ITEMS.map((d) => d.id)).size).toBe(ITEMS.length);
    expect(new Set(ITEMS.map((d) => d.name)).size).toBe(ITEMS.length);
  });

  it('착용 레벨은 9단위 12단계, 보통 모드는 Lv63 까지 · 어려움은 Lv72~99', () => {
    expect([...TIER_LEVELS]).toEqual([1, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99]);
    expect(Math.max(...REGION_TIER.normal.map((t) => TIER_LEVELS[t]))).toBe(63);
    expect(Math.min(...REGION_TIER.hard.map((t) => TIER_LEVELS[t]))).toBe(72);
    expect(Math.max(...REGION_TIER.hard.map((t) => TIER_LEVELS[t]))).toBe(99);
    expect(itemLevel(itemDef('w-sword-3')!)).toBe(27);
  });

  it('레어는 일반보다 +20% 이고 특수 효과가 하나 있다. 지형마다 그 지형의 레어가 있다', () => {
    for (const mode of MODES) {
      for (let r = 1; r <= REGIONS; r++) {
        const list = regionRares(r, mode).map((b) => itemDef(b)!);
        expect(list.map((d) => d.slot)).toEqual(['weapon', 'weapon', 'armor']);
        for (const d of list) {
          expect(d.rare && d.region === r && d.mode === mode && d.tier === regionTier(r, mode)).toBe(true);
          expect(d.fx).toBeTruthy();
          expect(d.buy).toBe(0);
        }
        expect(list[0].kind).not.toBe(list[1].kind);
        expect(WEAPON_FX).toContain(list[0].fx);
        expect(list[2].fx).toBe('ward');
        expect(itemDef(starReward(r, mode))!.slot).toBe('acc');
      }
    }
    expect(weaponAtkOf(3, 0, true)).toBe(Math.round(tierAtk(3) * 1.2));
    // 무기 효과 6가지가 모두 쓰인다
    expect(new Set(ITEMS.filter((d) => d.slot === 'weapon' && d.fx).map((d) => d.fx)).size).toBe(WEAPON_FX.length);
  });

  it('강화: 단계마다 오르고 +9 는 다음 등급 일반과 같다', () => {
    for (let t = 0; t < 11; t++) {
      for (let p = 1; p <= MAX_PLUS; p++) {
        expect(weaponAtkOf(t, p, false)).toBeGreaterThan(weaponAtkOf(t, p - 1, false));
        expect(armorHpOf(t, p, false)).toBeGreaterThan(armorHpOf(t, p - 1, false));
        expect(armorDefOf(t, p, false)).toBeGreaterThanOrEqual(armorDefOf(t, p - 1, false));
        expect(enhanceCost(t, p).coins).toBeGreaterThan(enhanceCost(t, p - 1).coins);
      }
      expect(weaponAtkOf(t, MAX_PLUS, false)).toBe(weaponAtkOf(t + 1, 0, false));
      expect(armorHpOf(t, MAX_PLUS, false)).toBe(armorHpOf(t + 1, 0, false));
    }
    expect(itemStats(itemDef('c-mp-0')!, 5)).toEqual({ atk: 0, hp: 0, def: 0 });
  });

  it('값: 등급이 오를수록 비싸고, 파는 값은 사는 값보다 싸다', () => {
    for (const d of ITEMS) {
      expect(d.sell).toBeLessThan(buyPrice(d.tier));
      expect(d.scrap).toBeGreaterThan(0);
    }
    expect(bagPrice(BAG.size + BAG.step)).toBeGreaterThan(bagPrice(BAG.size));
    expect(gearDrops(2)).toEqual([...WEAPON_KINDS.map((k) => `w-${k}-2`), 'a-2']);
  });
});

describe('드랍 판정', () => {
  it('같은 씨앗이면 같은 결과, 씨앗이 다르면 달라진다', () => {
    expect(rollRun(ctx({ seed: 77 }), 60, 2, true)).toEqual(rollRun(ctx({ seed: 77 }), 60, 2, true));
    const a = JSON.stringify(Array.from({ length: 30 }, (_, i) => rollRun(ctx({ seed: i + 1 }), 60, 2, true)));
    const b = JSON.stringify(Array.from({ length: 30 }, (_, i) => rollRun(ctx({ seed: i + 1000 }), 60, 2, true)));
    expect(a).not.toBe(b);
    // SQL 의 _twelve_roll 과 맞춰 보는 값 (scripts/pg-check.mjs 가 서버에서 같은 값을 확인한다)
    expect([roll(1, 1, 1), roll(123456789, 12, 1), roll(2147483647, 7, 250), roll(0, 3, 2)]).toEqual(ROLL_VECTORS);
    for (const [s, t, n] of [[1, 1, 1], [5, 2, 9], [2147483647, 12, 300]]) {
      const v = roll(s, t, n);
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
    }
  });

  it('확률이 드랍 표와 맞는다 (일반 요괴: 물약 2.5% · 일반 장비 1.2%)', () => {
    let potion = 0;
    let gear = 0;
    const N = 40000;
    for (let i = 1; i <= N; i++) {
      for (const d of normalDrop(ctx({ seed: 9 }), i)) {
        if (d.t === 'potion') potion++;
        else gear++;
      }
    }
    expect(DROP.potion).toBe(250);
    expect(DROP.gear).toBe(120);
    expect(potion / N).toBeGreaterThan(0.021);
    expect(potion / N).toBeLessThan(0.029);
    expect(gear / N).toBeGreaterThan(0.0095);
    expect(gear / N).toBeLessThan(0.0145);
    expect(DROP.potion + DROP.gear).toBeLessThan(10000);
  });

  it('정예: 강화석 30% · 장신구 5% · 레어 1%, 보스: 강화석 항상 · 장신구 30% · 레어 10% · 열쇠 40%', () => {
    const count = { stone: 0, acc: 0, rare: 0 };
    const N = 30000;
    for (let j = 1; j <= N; j++) {
      // 확정 보정이 섞이지 않게 판마다 새 카운터
      for (const d of eliteDrop(ctx({ seed: 3 }), j)) {
        if (d.t === 'stone') count.stone++;
        else if (d.t === 'item') d.rare ? count.rare++ : count.acc++;
      }
    }
    expect(Math.abs(count.stone / N - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(count.acc / N - 0.05)).toBeLessThan(0.01);
    expect(Math.abs(count.rare / N - 0.01)).toBeLessThan(0.005);
    const boss = { acc: 0, rare: 0, key: 0 };
    const M = 20000;
    for (let s = 1; s <= M; s++) {
      const out = bossDrop(ctx({ seed: s }));
      expect(out[0]).toEqual({ t: 'stone', n: 3 });
      for (const d of out) {
        if (d.t === 'key') boss.key++;
        else if (d.t === 'item') d.rare ? boss.rare++ : boss.acc++;
      }
    }
    expect(Math.abs(boss.acc / M - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(boss.rare / M - 0.1)).toBeLessThan(0.015);
    expect(Math.abs(boss.key / M - 0.4)).toBeLessThan(0.02);
  });

  it('레어 확정 보정: 정예 100마리째 · 보스 8번째에는 꼭 나오고, 아직 없는 것부터 준다', () => {
    const c = ctx({ seed: 5, pity: { elite: PITY.elite - 1, boss: 0, key: 0 }, codex: ['r-n1-1'] });
    const got = eliteDrop(c, 1).find((d): d is Extract<Drop, { t: 'item' }> => d.t === 'item' && d.rare)!;
    expect(got.base).toBe('r-n1-2');
    expect(c.pity).toEqual({ elite: 0, boss: 0, key: 0 });
    expect(c.codex).toEqual(['r-n1-1', 'r-n1-2']);
    // 보스 8번: 카운터가 7 이면 이번에 꼭
    for (let seed = 1; seed <= 50; seed++) {
      const b = ctx({ seed, pity: { elite: 40, boss: PITY.boss - 1, key: 0 }, codex: ['r-n1-1', 'r-n1-2'], hasKey: true });
      const rare = bossDrop(b).filter((d) => d.t === 'item' && d.rare);
      expect(rare.length).toBe(1);
      expect(b.pity.boss).toBe(0);
      expect(b.pity.elite).toBe(0);
    }
    // 모두 가졌으면 아무거나
    const all = ctx({ seed: 2, pity: { elite: 0, boss: PITY.boss - 1, key: 0 }, codex: regionRares(1, 'normal'), hasKey: true });
    expect(bossDrop(all).some((d) => d.t === 'item' && d.rare)).toBe(true);
    // 못 받으면 카운터가 오른다
    let miss = 0;
    for (let seed = 1; seed <= 200 && !miss; seed++) {
      const m = ctx({ seed, hasKey: true });
      if (!bossDrop(m).some((d) => d.t === 'item' && d.rare)) {
        expect(m.pity.boss).toBe(1);
        miss = seed;
      }
    }
    expect(miss).toBeGreaterThan(0);
  });

  it('열쇠 확정 보정: 같은 보스 3번째에는 꼭 나오고, 이미 있으면 다시 나오지 않는다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const c = ctx({ seed, pity: { elite: 0, boss: 0, key: PITY.key - 1 } });
      expect(bossDrop(c).some((d) => d.t === 'key')).toBe(true);
      expect(c.pity.key).toBe(0);
      expect(c.hasKey).toBe(true);
      const have = ctx({ seed, hasKey: true });
      expect(bossDrop(have).some((d) => d.t === 'key')).toBe(false);
      expect(have.pity.key).toBe(0);
    }
    // 세 번 안에는 반드시
    for (let seed = 1; seed <= 100; seed++) {
      const pity = noPity();
      let got = false;
      for (let n = 0; n < 3 && !got; n++) got = bossDrop(ctx({ seed: seed * 31 + n, pity })).some((d) => d.t === 'key');
      expect(got).toBe(true);
    }
  });

  it('드랍은 그 지형 등급의 것만 나온다', () => {
    const c = ctx({ seed: 11, region: 5 });
    for (const d of rollRun(c, 3000, 300, true)) {
      if (d.t !== 'item') continue;
      const def = itemDef(d.base)!;
      expect(def.tier).toBe(regionTier(5, 'normal'));
      if (d.rare) expect(regionRares(5, 'normal')).toContain(d.base);
    }
    expect(copyCtx(c)).toEqual(c);
  });
});

describe('가방', () => {
  it('처음에는 나무 무기 4종과 나무 갑옷, 칼과 갑옷을 착용하고 있다', () => {
    const p = emptyProfile();
    expect(p.items.map((i) => i.base)).toEqual(['w-sword-0', 'w-spear-0', 'w-bow-0', 'w-fan-0', 'a-0']);
    expect(equipped(p, 'weapon')!.base).toBe('w-sword-0');
    expect(equipped(p, 'armor')!.base).toBe('a-0');
    expect(equipped(p, 'acc')).toBeNull();
    expect(weaponOf(p)).toBe('sword');
    expect(loadoutOf(p)).toMatchObject({ weapon: 'sword', weaponAtk: tierAtk(0), armorHp: armorHpOf(0, 0, false), armorDef: armorDefOf(0, 0, false) });
    expect(p.potions).toEqual(POTION.start);
  });

  it('착용: 레벨이 모자라면 안 되고, 바꾸면 무기 종류·능력치가 바뀐다', () => {
    const p = emptyProfile();
    const bow = p.items.find((i) => i.base === 'w-bow-0')!;
    expect(equip(p, bow.id)).toBeNull();
    expect(weaponOf(p)).toBe('bow');
    const good = addItem(p, 'w-sword-1');
    expect(equip(p, good.id)).toBe('low level');
    p.level = 9;
    expect(equip(p, good.id)).toBeNull();
    expect(loadoutOf(p).weaponAtk).toBe(tierAtk(1));
    expect(equip(p, 'nope')).toBe('no item');
    expect(unequip(p, 'weapon')).toBe('bad slot');
    expect(unequip(p, 'armor')).toBeNull();
    expect(loadoutOf(p).armorHp).toBe(0);
  });

  it('레어 효과와 장신구가 능력치에 들어간다', () => {
    const p = emptyProfile();
    const rare = addItem(p, 'r-n1-1');
    const acc = addItem(p, 'c-crit-0');
    const mp = addItem(p, 'c-mp-0');
    equip(p, rare.id);
    equip(p, acc.id);
    const lo = loadoutOf(p);
    expect(lo.fx).toEqual([itemDef('r-n1-1')!.fx]);
    expect(lo.bonus).toEqual({ crit: 2 });
    expect(playerStats(lo, 0).crit).toBeCloseTo(playerStats({ ...lo, bonus: {} }, 0).crit + 0.02);
    equip(p, mp.id);
    expect(playerStats(loadoutOf(p), 0).mp).toBe(Math.round(playerStats({ ...lo, bonus: {} }, 0).mp * 1.1));
  });

  it('가방이 꽉 차면 새 장비는 보관함으로 가고, 자리가 나면 꺼낸다', () => {
    const p = emptyProfile();
    while (bagCount(p) < p.bag) addItem(p, 'a-0');
    const over = addItem(p, 'r-n1-3');
    expect(over.box).toBe(true);
    expect(bagCount(p)).toBe(BAG.size);
    expect(boxItems(p).length).toBe(1);
    expect(equip(p, over.id)).toBe('bad item');
    expect(claim(p)).toBe('bag full');
    expect(buy(Object.assign(p, { coins: 9999 }), 'w-sword-0')).toBe('bag full');
    const spare = p.items.find((i) => i.base === 'a-0' && p.eq.armor !== i.id)!;
    expect(sell(p, [spare.id])).toBeNull();
    expect(claim(p, [over.id])).toBeNull();
    expect(boxItems(p).length).toBe(0);
    expect(claim(p)).toBeNull();
  });

  it('잠금: 잠근 장비와 착용 중인 장비는 팔거나 분해할 수 없다', () => {
    const p = emptyProfile();
    const it = addItem(p, 'w-spear-0');
    expect(setLock(p, it.id, true)).toBeNull();
    expect(sell(p, [it.id])).toBe('locked item');
    expect(scrap(p, [it.id])).toBe('locked item');
    expect(sell(p, [p.eq.weapon!])).toBe('equipped');
    expect(setLock(p, it.id, false)).toBeNull();
    const coins = p.coins;
    expect(sell(p, [it.id])).toBeNull();
    expect(p.coins).toBe(coins + itemDef('w-spear-0')!.sell);
    expect(sell(p, [it.id])).toBe('no item');
    expect(sell(p, [])).toBe('bad item');
  });
});

describe('상점 · 대장간', () => {
  it('상점은 열린 지형까지의 등급만 판다. 레어·장신구는 팔지 않는다', () => {
    const p = emptyProfile();
    expect(shopTier(p)).toBe(0);
    expect(forSale(p, itemDef('w-sword-0')!)).toBe(true);
    expect(forSale(p, itemDef('w-sword-1')!)).toBe(false);
    expect(forSale(p, itemDef('r-n1-1')!)).toBe(false);
    expect(forSale(p, itemDef('c-mp-0')!)).toBe(false);
    expect(buy(p, 'w-bow-0')).toBe('not enough coins');
    p.coins = 1000;
    expect(buy(p, 'w-bow-0')).toBeNull();
    expect(p.coins).toBe(1000 - buyPrice(0));
    expect(buy(p, 'w-bow-1')).toBe('not for sale');
    expect(buy(p, 'r-n1-1')).toBe('not for sale');
    expect(buy(p, 'zzz')).toBe('bad item');
  });

  it('물약 소·중·대와 가방 늘리기', () => {
    const p = emptyProfile();
    p.coins = 100000;
    expect(buy(p, 'potion:0:1', 3)).toBeNull();
    expect(p.potions[0]).toEqual([POTION.start[0][0], 3, 0]);
    expect(p.coins).toBe(100000 - POTION.price[0][1] * 3);
    expect(buy(p, 'potion:1:2', POTION.max)).toBeNull();
    expect(buy(p, 'potion:1:2', 1)).toBe('max potions');
    expect(buy(p, 'potion:0:3')).toBe('bad item');
    expect(buy(p, 'potion:0:0', 0)).toBe('bad count');
    const before = p.coins;
    expect(buy(p, 'bag')).toBeNull();
    expect(p.bag).toBe(BAG.size + BAG.step);
    expect(p.coins).toBe(before - bagPrice(BAG.size));
    while (p.bag < BAG.max) expect(buy(p, 'bag')).toBeNull();
    expect(buy(p, 'bag')).toBe('max bag');
  });

  it('강화는 항상 성공하고 엽전·강화석이 든다. +9 까지', () => {
    const p = emptyProfile();
    const id = p.eq.weapon!;
    expect(enhance(p, id)).toBe('not enough coins');
    p.coins = 1e6;
    expect(enhance(p, id)).toBe('not enough stones');
    p.stones = 1000;
    for (let n = 1; n <= MAX_PLUS; n++) {
      const c = { coins: p.coins, stones: p.stones };
      expect(enhance(p, id)).toBeNull();
      expect([c.coins - p.coins, c.stones - p.stones]).toEqual([enhanceCost(0, n).coins, enhanceCost(0, n).stones]);
    }
    expect(enhance(p, id)).toBe('max plus');
    expect(loadoutOf(p).weaponAtk).toBe(tierAtk(1));
    expect(enhance(p, addItem(p, 'c-mp-0').id)).toBe('bad item');
  });

  it('분해하면 강화석을 받는다 (강화한 단계마다 +1)', () => {
    const p = emptyProfile();
    const it = addItem(p, 'r-n1-1');
    it.plus = 4;
    expect(scrap(p, [it.id])).toBeNull();
    expect(p.stones).toBe(scrapOf(itemDef('r-n1-1')!, 4));
    expect(scrapOf(itemDef('r-n1-1')!, 0)).toBeGreaterThan(scrapOf(itemDef('w-sword-0')!, 0));
  });
});

describe('판 결과와 드랍', () => {
  it('깬 판은 드랍을 받고, 쓰러진 판은 아이템·카운터가 그대로다', () => {
    const p = emptyProfile();
    const dead = applyReport(p, report('1-8', { cleared: false }), 4);
    expect([dead.items.length, dead.stones, dead.key]).toEqual([0, 0, false]);
    expect(p.pity.normal).toEqual({});
    expect(p.items.length).toBe(5);
    for (let n = 1; n <= 7; n++) applyReport(p, report(`1-${n}`), n);
    const win = applyReport(p, report('1-8'), 4);
    expect(win.stones).toBeGreaterThanOrEqual(3);
    expect(p.stones).toBeGreaterThanOrEqual(win.stones);
    expect(p.items.length).toBeGreaterThanOrEqual(5 + win.items.length);
    expect(pityOf(p, 1).boss + (win.items.some((i) => itemDef(i.base)!.rare) ? 1 : 0)).toBeGreaterThan(0);
  });

  it('열쇠는 세 번 안에 꼭 얻고, 한 번 얻으면 다시 떨어지지 않는다', () => {
    const p = emptyProfile();
    for (let n = 1; n <= 7; n++) applyReport(p, report(`1-${n}`), n);
    let keys = 0;
    for (let n = 0; n < 6; n++) keys += applyReport(p, report('1-8'), 100 + n).key ? 1 : 0;
    expect(keys).toBe(1);
    expect(p.keys.normal).toEqual([1]);
    expect(pityOf(p, 1).key).toBe(0);
  });

  it('지형의 별 24개를 모두 모으면 그 지형 장신구를 한 번 받는다', () => {
    const p = emptyProfile();
    let star = 0;
    for (let n = 1; n <= 8; n++) {
      const r = applyReport(p, report(`1-${n}`), n);
      if (r.starItem) star++;
      expect(r.starItem).toBe(n === 8 ? 's-n1' : null);
    }
    expect(applyReport(p, report('1-8'), 9).starItem).toBeNull();
    expect(star).toBe(1);
    expect(p.items.filter((i) => i.base === 's-n1').length).toBe(1);
    expect(p.codex).toContain('s-n1');
  });

  it('쓴 물약은 빠지고, 엽전 장신구는 엽전을 늘린다', () => {
    const p = emptyProfile();
    const plain = applyReport(structuredClone(p), report('1-1'), 1).coins;
    equip(p, addItem(p, 'c-coin-0').id);
    const r = applyReport(p, report('1-1', { potions: [[2, 0, 0], [9, 0, 0]] }), 1);
    expect(r.coins).toBe(Math.floor((plain * 105) / 100));
    expect(p.potions[0][0]).toBe(POTION.start[0][0] - 2 + r.potions[0][0]);
    expect(p.potions[1][0]).toBe(0 + r.potions[1][0]);
  });
});

describe('전투 속 장비', () => {
  it('물약: 모자란 만큼을 채우는 가장 작은 것부터 쓰고, 쓴 수를 크기별로 센다', () => {
    const s = run(arena(), { stock: [[1, 1, 1], [0, 0, 0]] });
    expect(s.potions).toEqual([3, 0]);
    s.p.hp = s.stats.hp * 0.75;
    play(s, 0.1, { potion: [true, false] });
    expect(s.used[0]).toEqual([1, 0, 0]);
    s.p.hp = 1;
    play(s, 3.2, {});
    play(s, 0.1, { potion: [true, false] });
    expect(s.used[0]).toEqual([1, 0, 1]);
    expect(s.p.hp).toBe(s.stats.hp);
    expect(s.potions[0]).toBe(1);
  });

  it('요괴가 쓰러지면 드랍이 떨어지고, 가까이 가면 줍는다', () => {
    // 일반 장비가 떨어지는 씨앗을 찾는다
    let seed = 1;
    while (!normalDrop(ctx({ seed }), 1).some((d) => d.t === 'item')) seed++;
    const s = createRun(arena({ groups: [group(8, 5)] }), 'normal', loadoutOf(emptyProfile()), { seed: 1, drops: ctx({ seed }) });
    const e = place(s, s.enemies[0], 0, -60);
    e.hp = 1;
    play(s, 0.5, { attack: true });
    expect(e.dead).toBe(true);
    expect(s.loot.length).toBe(1);
    expect(s.picks.length).toBe(1);
    // 바로 옆이라 곧 줍는다
    expect(Math.hypot(s.picks[0].x - s.p.x, s.picks[0].y - s.p.y)).toBeLessThan(PICK_DIST);
    expect(s.picks[0].got).toBe(true);
    expect(at(0)).toBe(30);
  });

  it('레어 효과: 흡혈은 체력을 채우고, 불길은 요괴를 태운다', () => {
    const base = { ...loadoutOf(emptyProfile()), hero: 'ox' as const };
    const leech = createRun(arena({ groups: [group(8, 5, 'club')] }), 'normal', { ...base, fx: ['leech'] }, { seed: 1 });
    place(leech, leech.enemies[0], 0, -60, false);
    leech.p.hp = 10;
    play(leech, 0.1, { attack: true });
    expect(leech.p.hp).toBeGreaterThan(10);
    const burn = createRun(arena({ groups: [group(8, 5, 'club')] }), 'normal', { ...base, fx: ['burn'] }, { seed: 1 });
    place(burn, burn.enemies[0], 0, -60, false);
    play(burn, 0.1, { attack: true });
    expect(burn.enemies[0].dotT).toBeGreaterThan(FX.burn.dur - 0.2);
  });
});

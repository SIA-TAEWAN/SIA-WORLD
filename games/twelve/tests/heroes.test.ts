import { describe, expect, it } from 'vitest';
import { AFFINITY_BONUS, HOME_BONUS, playerStats } from '../src/data/growth';
import { HEROES, HERO_IDS, STARTERS, STAT_KEYS, ZODIAC_IDS, heroOf, joinsAt } from '../src/data/heroes';
import { REGION_TABLE } from '../src/data/regions';
import { WEAPON_KINDS } from '../src/data/weapons';
import { noInput, step } from '../src/game/sim';
import { arena, group, lo, place, play, run } from './helpers';

const zodiac = HEROES.filter((h) => !h.hidden);

describe('대원 표', () => {
  it('십이지 12종 + 숨은 고양이', () => {
    expect(zodiac.map((h) => h.id)).toEqual([...ZODIAC_IDS]);
    expect(HERO_IDS.length).toBe(13);
    const cat = heroOf('cat');
    expect(cat.hidden).toBe(true);
    expect(cat.price).toBe(100);
  });

  it('처음 3종(쥐·소·호랑이), 1~9지형 보스마다 한 명씩 합류', () => {
    expect(STARTERS).toEqual(['rat', 'ox', 'tiger']);
    expect(Array.from({ length: 9 }, (_, i) => joinsAt(i + 1)?.id)).toEqual(['rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig']);
    expect(joinsAt(10)).toBeNull();
  });

  it('능력치 차이는 최대 10%', () => {
    for (const k of STAT_KEYS) {
      const v = zodiac.map((h) => h.stats[k]);
      expect(Math.max(...v) / Math.min(...v)).toBeLessThanOrEqual(1.1 + 1e-9);
    }
  });

  it('고양이는 가장 좋은 대원보다 5% 안쪽으로만 좋다', () => {
    const cat = heroOf('cat');
    for (const k of STAT_KEYS) {
      const best = Math.max(...zodiac.map((h) => h.stats[k]));
      expect(cat.stats[k]).toBeLessThanOrEqual(best * 1.05 + 1e-9);
    }
    expect(STAT_KEYS.some((k) => cat.stats[k] > Math.max(...zodiac.map((h) => h.stats[k])))).toBe(true);
  });

  it('고향 지형은 지형 표와 같고, 무기마다 잘 다루는 대원이 셋씩', () => {
    for (const r of REGION_TABLE) expect(heroOf(r.home).home).toBe(r.region);
    for (const w of WEAPON_KINDS) expect(zodiac.filter((h) => h.weapon === w).length).toBe(3);
  });

  it('고유 스킬이 하나씩 있다 (이름이 서로 다르다)', () => {
    expect(new Set(HEROES.map((h) => h.unique.name)).size).toBe(13);
    for (const h of HEROES) {
      expect(h.unique.acts.length).toBeGreaterThan(0);
      expect(h.unique.cd).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('고향 · 무기 궁합', () => {
  it('고향 지형에서는 공격·방어 +10%', () => {
    const home = playerStats(lo('rat', 'spear', 10), 1);
    const away = playerStats(lo('rat', 'spear', 10), 2);
    expect(home.atk / away.atk).toBeCloseTo(HOME_BONUS);
    expect(home.def / away.def).toBeCloseTo(HOME_BONUS);
    expect(home.hp).toBe(away.hp);
  });

  it('잘 다루는 무기는 공격 +5%', () => {
    const a = playerStats(lo('rat', 'sword', 10), 2);
    const b = playerStats(lo('rat', 'spear', 10), 2);
    expect(a.atk / b.atk).toBeCloseTo(AFFINITY_BONUS);
    expect(a.affinity).toBe(true);
  });
});

describe('고유 스킬', () => {
  const near = (hero: Parameters<typeof lo>[0], n = 1) => {
    const s = run(arena({ groups: [group(8, 5, 'imp', n)] }), { hero, seed: 5 });
    s.enemies.forEach((e, i) => {
      place(s, e, (i - (n - 1) / 2) * 70, -110);
      e.hp = e.maxHp = 1e6;
      e.cd = 1e6;
    });
    return s;
  };

  it('모든 대원: 쓰면 마력이 줄고 대기가 걸린다', () => {
    for (const h of HEROES) {
      const s = near(h.id);
      s.p.hp = 50;
      s.p.mp = Math.max(30, h.unique.mp);
      const mp = s.p.mp;
      step(s, { ...noInput(), unique: true });
      expect(s.p.uniqueCd, h.id).toBeCloseTo(h.unique.cd, 1);
      if (h.unique.mp) expect(s.p.mp, h.id).toBeLessThan(mp);
    }
  });

  it('호랑이 포효: 주변 요괴가 기절해서 공격이 끊긴다', () => {
    const s = near('tiger');
    const e = s.enemies[0];
    e.cd = 0;
    place(s, e, 0, -50);
    step(s, noInput());
    expect(s.warns.length).toBe(1);
    step(s, { ...noInput(), unique: true });
    expect(e.stun).toBeGreaterThan(2);
    play(s, 1);
    expect(s.warns.length).toBe(0);
    expect(s.p.hp).toBe(s.stats.hp);
  });

  it('토끼 달떡: 체력 35% 회복', () => {
    const s = near('rabbit');
    s.p.hp = 10;
    step(s, { ...noInput(), unique: true });
    expect(s.p.hp).toBe(10 + Math.round(s.stats.hp * 0.35));
  });

  it('소 버티기: 받는 피해가 줄어든다', () => {
    const hurt = (guard: boolean) => {
      const s = near('ox');
      const e = s.enemies[0];
      e.atk = 100;
      e.cd = 0;
      place(s, e, 0, -50);
      if (guard) step(s, { ...noInput(), unique: true });
      play(s, 0.6);
      return s.stats.hp - s.p.hp;
    };
    expect(hurt(true)).toBeLessThan(hurt(false) * 0.5);
  });

  it('닭 새벽 울음: 공격이 세진다', () => {
    const dmg = (buff: boolean) => {
      const s = near('rooster');
      if (buff) step(s, { ...noInput(), unique: true });
      s.seed = 1;
      s.p.atkCd = 0;
      s.events.length = 0;
      step(s, { ...noInput(), attack: true });
      const d = s.events.find((v) => v.e === 'dmg');
      return d && d.e === 'dmg' ? d.n / (d.crit ? 1.5 : 1) : 0;
    };
    expect(dmg(true) / dmg(false)).toBeCloseTo(1.4, 1);
  });

  it('쥐 잽싼 발: 더 빨리 움직인다', () => {
    const s = near('rat');
    step(s, { ...noInput(), unique: true });
    const x0 = s.p.x;
    play(s, 0.5, { mx: 1 });
    expect(s.p.x - x0).toBeCloseTo(s.stats.speed * 1.4 * 0.5, 0);
  });

  it('용 용숨: 맞은 요괴가 계속 불탄다', () => {
    const s = near('dragon');
    const e = s.enemies[0];
    step(s, { ...noInput(), unique: true });
    const first = e.maxHp - e.hp;
    expect(first).toBeGreaterThan(0);
    play(s, 2);
    expect(e.maxHp - e.hp).toBeGreaterThan(first);
  });

  it('말 질주: 멀리 달려가며 들이받는다', () => {
    const s = near('horse');
    const y0 = s.p.y;
    play(s, 0.5, { unique: true });
    expect(y0 - s.p.y).toBeGreaterThan(400);
    expect(s.enemies[0].hp).toBeLessThan(s.enemies[0].maxHp);
  });

  it('양 솜구름: 요괴가 느려지고 체력이 찬다', () => {
    const s = near('sheep');
    s.p.hp = 10;
    step(s, { ...noInput(), unique: true });
    expect(s.enemies[0].slowT).toBeGreaterThan(3);
    expect(s.p.hp).toBeGreaterThan(10);
  });

  it('개·고양이: 여러 요괴를 차례로 문다', () => {
    for (const [hero, n] of [['dog', 5], ['cat', 6]] as const) {
      const s = near(hero, 7);
      step(s, { ...noInput(), unique: true });
      expect(s.events.filter((v) => v.e === 'dmg').length, hero).toBe(n);
    }
  });

  it('돼지 복주머니: 마력 60% 회복', () => {
    const s = near('pig');
    s.p.mp = 0;
    step(s, { ...noInput(), unique: true });
    expect(s.p.mp).toBeCloseTo(Math.round(s.stats.mp * 0.6), 0);
  });
});

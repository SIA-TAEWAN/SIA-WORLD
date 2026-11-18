import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { PASSIVE_INDEX } from '../src/data/passives';
import { WEAPONS, WEAPON_INDEX } from '../src/data/weapons';
import { addPassive, addWeapon } from '../src/game/levelup';
import { dpsTable, weaponDps } from '../src/game/policy';
import { startWeapon } from '../src/game/sim';
import { MODE } from '../src/game/state';
import { BEHAVIORS, weaponReady } from '../src/game/weapons';
import { advance, disarm, emptyRun, live, put } from './helpers';

/** 캐릭터 12종의 시작 무기 */
const SIX = ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist', 'hoof', 'wool', 'staff', 'feather', 'puppy', 'piggy'];

/** 무기 하나만 든 판 */
function armed(id: string, lv = 1) {
  const s = disarm(emptyRun());
  addWeapon(s, WEAPON_INDEX[id], lv);
  return s;
}

describe('무기 12종의 세기', () => {
  it('시작 무기(1레벨)가 같은 시간에 주는 피해는 서로 ±15% 안이다', () => {
    const dps = SIX.map((id) => weaponDps(id, 1));
    const mean = dps.reduce((a, b) => a + b, 0) / dps.length;
    for (const d of dps) expect(Math.abs(d / mean - 1)).toBeLessThan(0.15);
  }, 60000);

  it('레벨마다 세지고, 같은 레벨끼리도 ±15% 안이다', () => {
    const table = dpsTable().filter((r) => SIX.includes(r.id));
    for (const r of table) for (let i = 1; i < 5; i++) expect(r.dps[i]).toBeGreaterThan(r.dps[i - 1] * 1.2);
    for (let lv = 0; lv < 5; lv++) {
      const col = table.map((r) => r.dps[lv]);
      const mean = col.reduce((a, b) => a + b, 0) / col.length;
      for (const d of col) expect(Math.abs(d / mean - 1)).toBeLessThan(0.15);
    }
  }, 120000);

  it('진화 무기는 5레벨보다 두 배 넘게 세다', () => {
    for (const [base, evo] of [['shuriken', 'shurikenEvo'], ['pearl', 'pearlEvo'], ['claw', 'clawEvo']]) {
      expect(weaponDps(evo, 1)).toBeGreaterThan(weaponDps(base, 5) * 2);
    }
  }, 60000);

  it('무기 12종 + 진화 3종이 모두 준비됐다', () => {
    expect(WEAPONS.filter(weaponReady).map((w) => w.id).sort()).toEqual([...SIX, 'shurikenEvo', 'pearlEvo', 'clawEvo'].sort());
    expect(CHARACTERS.map((c) => c.weapon)).toEqual(SIX);
    for (const c of CHARACTERS) {
      const def = WEAPONS[WEAPON_INDEX[c.weapon]];
      expect(def).toBeTruthy();
      expect(WEAPONS[startWeapon(c.id)].id).toBe(def.ready ? def.id : 'shuriken');
    }
    for (const w of WEAPONS.filter((x) => x.ready)) expect(BEHAVIORS[w.kind]).toBeTypeOf('function');
    for (const w of WEAPONS.filter((x) => !x.evolved && x.ready)) expect(w.levels.length).toBe(5);
  });
});

describe('무기 동작', () => {
  it('표창: 가장 가까운 적에게 날아가 맞힌다', () => {
    const s = armed('shuriken');
    const far = put(s, 'club', 0, -300);
    const near = put(s, 'club', 200, 0);
    far.speed = near.speed = 0;
    advance(s, 0.8);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('표창: 적이 없으면 마지막으로 움직인 쪽으로 날아간다', () => {
    const s = armed('shuriken');
    s.player.fx = 0;
    s.player.fy = 1;
    advance(s, 0.4);
    const pr = live(s.projectiles)[0];
    expect(pr.mode).toBe(MODE.line);
    expect(pr.vx).toBeCloseTo(0, 6);
    expect(pr.vy).toBeGreaterThan(0);
  });

  it('방울: 장판 안의 적만 피해를 입는다', () => {
    const s = armed('bell');
    const inside = put(s, 'club', 90, 0);
    const outside = put(s, 'club', 250, 0);
    inside.speed = outside.speed = 0;
    advance(s, 1.2, { immortal: true });
    expect(inside.hp).toBeLessThan(inside.maxHp);
    expect(outside.hp).toBe(outside.maxHp);
    expect(s.weapons[0].view).toBe(120);
  });

  it('발톱: 겨눈 쪽 부채꼴 안의 적만 벤다', () => {
    const s = armed('claw');
    const front = put(s, 'club', 100, 0);
    const back = put(s, 'club', -110, 0);
    front.speed = back.speed = 0;
    advance(s, 0.5, { immortal: true });
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(back.hp).toBe(back.maxHp);
  });

  it('달떡: 포물선으로 날아가 떨어진 자리 둘레를 함께 터뜨린다', () => {
    const s = armed('mooncake');
    const a = put(s, 'club', 200, 0);
    const b = put(s, 'club', 250, 0);
    a.speed = b.speed = 0;
    advance(s, 0.4);
    expect(live(s.projectiles)[0].mode).toBe(MODE.lob);
    expect(a.hp).toBe(a.maxHp);
    advance(s, 0.6);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('여의주: 구슬이 내 주위를 돌며, 내가 움직이면 따라온다', () => {
    const s = armed('pearl');
    advance(s, 0.5);
    const orbs = live(s.projectiles);
    expect(orbs.length).toBe(2);
    for (const o of orbs) expect(Math.hypot(o.x - s.player.x, o.y - s.player.y)).toBeCloseTo(98, 3);
    advance(s, 1, { input: { mx: 1, my: 0, pick: -1, reroll: false } });
    for (const o of live(s.projectiles)) expect(Math.hypot(o.x - s.player.x, o.y - s.player.y)).toBeCloseTo(98, 3);
    // 쉬지 않고 돈다: 오래 지나도 구슬 수가 그대로다
    advance(s, 10);
    expect(s.projectiles.n).toBe(2);
  });

  it('독안개: 적이 있는 자리에 독 지대가 깔려 계속 피해를 준다', () => {
    const s = armed('mist');
    const e = put(s, 'club', 200, 0);
    e.speed = 0;
    advance(s, 0.4);
    const z = live(s.zones)[0];
    expect([z.x, z.y]).toEqual([200, 0]);
    const hp1 = e.hp;
    advance(s, 1.2);
    expect(e.hp).toBeLessThan(hp1);
  });

  it('패시브: 공격력·범위·재사용 대기시간이 무기에 반영된다', () => {
    const base = armed('claw');
    const strong = armed('claw');
    addPassive(strong, PASSIVE_INDEX.might, 5);
    addPassive(strong, PASSIVE_INDEX.fan, 5);
    addPassive(strong, PASSIVE_INDEX.sleeve, 5);
    expect(strong.stats.might).toBeCloseTo(1.5, 6);
    expect(strong.stats.cooldown).toBeCloseTo(0.6, 6);
    expect(strong.stats.area).toBeCloseTo(1.5, 6);
    for (const s of [base, strong]) {
      const e = put(s, 'club', 100, 0);
      e.speed = 0;
      e.hp = e.maxHp = 1e9;
      advance(s, 10, { immortal: true });
    }
    const ratio = strong.dmgByWeapon[WEAPON_INDEX.claw] / base.dmgByWeapon[WEAPON_INDEX.claw];
    expect(ratio).toBeGreaterThan(1.5 / 0.6 - 0.3);
    expect(ratio).toBeLessThan(1.5 / 0.6 + 0.3);
  });

  it('뱀의 특성(지속 피해 +10%)은 장판·독 지대에만 붙는다', () => {
    const snake = disarm(emptyRun({ char: 'snake' }));
    expect(snake.stats.dot).toBeCloseTo(1.1, 6);
    expect(WEAPONS.filter((w) => w.dot && w.ready).map((w) => w.id)).toEqual(['bell', 'mist', 'wool']);
  });
});

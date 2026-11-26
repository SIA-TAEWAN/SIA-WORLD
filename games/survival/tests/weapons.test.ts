import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { PASSIVE_INDEX } from '../src/data/passives';
import { WEAPONS, WEAPON_INDEX } from '../src/data/weapons';
import { addPassive, addWeapon } from '../src/game/levelup';
import { startWeapon } from '../src/game/sim';
import { MODE, PROJ, ZONE } from '../src/game/state';
import { MAX_BONUS, SETS } from '../src/data/sets';
import { BEHAVIORS, DASH_SPREAD, isMaxLevel, setActive, weaponLine, weaponReady } from '../src/game/weapons';
import { advance, disarm, emptyRun, live, put } from './helpers';

/** 캐릭터 12종의 시작 무기 */
const SIX = ['shuriken', 'bell', 'claw', 'mooncake', 'pearl', 'mist', 'hoof', 'wool', 'staff', 'feather', 'puppy', 'piggy'];
/** 캐릭터 13종의 시작 무기 (고양이는 호랑이와 같은 발톱) */
const START = [...SIX, 'claw'];

/** 무기 하나만 든 판 */
function armed(id: string, lv = 1) {
  const s = disarm(emptyRun());
  addWeapon(s, WEAPON_INDEX[id], lv);
  return s;
}

// 무기의 세기를 재는 시험(수백 판을 돌린다)은 tests/weaponDps.test.ts 에 따로 있다
describe('무기 12종', () => {
  it('무기 12종 + 진화 7종이 모두 준비됐다', () => {
    expect(WEAPONS.filter(weaponReady).map((w) => w.id).sort()).toEqual([...SIX, 'shurikenEvo', 'pearlEvo', 'clawEvo', 'bellEvo', 'mooncakeEvo', 'hoofEvo', 'piggyEvo'].sort());
    expect(CHARACTERS.map((c) => c.weapon)).toEqual(START);
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
    // 발톱 + 힘의 부적은 세트 (발톱 피해 ×1.3)
    const ratio = strong.dmgByWeapon[WEAPON_INDEX.claw] / base.dmgByWeapon[WEAPON_INDEX.claw];
    expect(ratio).toBeGreaterThan((1.5 / 0.6) * 1.3 - 0.35);
    expect(ratio).toBeLessThan((1.5 / 0.6) * 1.3 + 0.35);
  });

  it('뱀의 특성(지속 피해 +10%)은 장판·독 지대에만 붙는다', () => {
    const snake = disarm(emptyRun({ char: 'snake' }));
    expect(snake.stats.dot).toBeCloseTo(1.1, 6);
    expect(WEAPONS.filter((w) => w.dot && w.ready).map((w) => w.id)).toEqual(['bell', 'mist', 'wool', 'bellEvo']);
  });
});

describe('진화 무기 2차 (방울·달떡·말발굽·복돼지)', () => {
  it('황금 복돼지: 세 마리가 겨눈 쪽을 가운데로 부채꼴로 벌어져 달리고, 닿는 적을 모두 친다', () => {
    const s = armed('piggyEvo');
    const front = put(s, 'club', 160, 0);
    const up = put(s, 'club', 170 * Math.cos(DASH_SPREAD), -170 * Math.sin(DASH_SPREAD));
    const down = put(s, 'club', 170 * Math.cos(DASH_SPREAD), 170 * Math.sin(DASH_SPREAD));
    const back = put(s, 'club', -300, 0);
    for (const e of [front, up, down, back]) e.speed = 0;
    advance(s, 0.35);
    const pigs = live(s.projectiles).filter((p) => p.kind === PROJ.pigEvo);
    expect(pigs.length).toBe(3);
    expect(pigs.map((p) => Math.round(Math.atan2(p.vy, p.vx) * 100) / 100).sort((a, b) => a - b)).toEqual([-DASH_SPREAD, 0, DASH_SPREAD]);
    advance(s, 0.6);
    for (const e of [front, up, down]) expect(e.hp).toBeLessThan(e.maxHp);
    expect(back.hp).toBe(back.maxHp);
    // 원래 복돼지는 한 마리 그대로
    const one = armed('piggy', 5);
    put(one, 'club', 160, 0).speed = 0;
    advance(one, 0.35);
    expect(live(one.projectiles).filter((p) => p.kind === PROJ.pig).length).toBe(1);
  });

  it('천리마의 발굽·한가위 보름달떡: 원래 무기와 같은 동작에 그림만 다르다', () => {
    const hoof = armed('hoofEvo');
    put(hoof, 'club', 120, 0).speed = 0;
    advance(hoof, 0.35);
    expect(live(hoof.zones).map((z) => z.kind)).toEqual([ZONE.hoofEvo]);
    const cake = armed('mooncakeEvo');
    put(cake, 'club', 200, 0).speed = 0;
    advance(cake, 0.35);
    const cakes = live(cake.projectiles);
    expect(cakes.length).toBe(5);
    expect(cakes.every((p) => p.kind === PROJ.cakeEvo && p.mode === MODE.lob)).toBe(true);
  });

  it('수호의 범종: 방울보다 넓은 장판', () => {
    const s = armed('bellEvo');
    const near = put(s, 'club', 180, 0);
    const far = put(s, 'club', 280, 0);
    near.speed = far.speed = 0;
    advance(s, 0.5);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
    expect(WEAPONS[WEAPON_INDEX.bellEvo].levels[0].radius).toBeGreaterThan(WEAPONS[WEAPON_INDEX.bell].levels[4].radius!);
  });
});

describe('세트와 최종 레벨', () => {
  it('짝 패시브를 가지면 레벨과 상관없이 세트 효과가 붙고, 진화해도 남는다', () => {
    const s = armed('shuriken');
    const w = s.weapons[0];
    expect(setActive(s, w.def)).toBe(false);
    expect(weaponLine(s, w).count).toBe(1);
    addPassive(s, PASSIVE_INDEX.fan, 1);
    expect(setActive(s, w.def)).toBe(true);
    expect(weaponLine(s, w).count).toBe(2);
    // 레벨 줄 자체는 그대로다
    expect(WEAPONS[w.def].levels[0].count).toBe(1);
    // 진화 무기: 원래 무기의 세트 효과 + 최종 레벨 보너스
    w.def = WEAPON_INDEX.shurikenEvo;
    const evo = WEAPONS[w.def].levels[0];
    expect(weaponLine(s, w).count).toBe((evo.count ?? 1) + 1);
    expect(weaponLine(s, w).dmg).toBeCloseTo(evo.dmg * MAX_BONUS.dmg, 6);
  });

  it('세트 12종이 모두 그 무기의 수치를 바꾼다', () => {
    for (const x of SETS) {
      const s = armed(x.weapon, 3);
      const w = s.weapons[0];
      const before = JSON.stringify(weaponLine(s, w));
      addPassive(s, PASSIVE_INDEX[x.passive], 1);
      expect(JSON.stringify(weaponLine(s, w)), x.weapon).not.toBe(before);
    }
  });

  it('5레벨(MAX)은 4레벨 줄보다 한 단계 더: 피해 ×1.25', () => {
    const s = armed('claw', 4);
    const w = s.weapons[0];
    expect(isMaxLevel(w)).toBe(false);
    expect(weaponLine(s, w)).toBe(WEAPONS[w.def].levels[3]);
    w.lv = 5;
    expect(isMaxLevel(w)).toBe(true);
    expect(weaponLine(s, w).dmg).toBeCloseTo(WEAPONS[w.def].levels[4].dmg * MAX_BONUS.dmg, 6);
  });

  it('세트 효과가 실제 판에 들어간다: 깃털 + 활시위면 한 번에 2개 더 쏘고 1마리를 뚫는다', () => {
    const count = (withSet: boolean) => {
      const s = armed('feather');
      if (withSet) addPassive(s, PASSIVE_INDEX.string, 1);
      // 요괴 없이: 맞아서 사라지는 깃털이 없게
      advance(s, 1.05, { immortal: true });
      return live(s.projectiles).filter((p) => p.kind === PROJ.feather);
    };
    const plain = count(false);
    const set = count(true);
    expect(set.length).toBe(plain.length + 2);
    expect(set.every((p) => p.pierce === 1)).toBe(true);
  });
});

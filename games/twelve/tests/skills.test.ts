import { describe, expect, it } from 'vitest';
import { NO_MP_MUL, POTION_CD, skillLevelMul } from '../src/data/balance';
import { POTION } from '../src/data/economy';

const POTION_HEAL = { hp: POTION.heal[0][0], mp: POTION.heal[1][0] };
import { WEAPONS, WEAPON_KINDS, TIER_LEVELS, tierAtk, tierForLevel } from '../src/data/weapons';
import { noInput, step, type RunState } from '../src/game/sim';
import { arena, group, place, play, run } from './helpers';

/** 맞아도 안 쓰러지는 허수아비: 체력을 크게, 공격은 하지 않게 */
function dummy(s: RunState, i: number, dx: number, dy: number) {
  const e = place(s, s.enemies[i], dx, dy);
  e.hp = e.maxHp = 1e6;
  e.cd = 1e6;
  e.speed = 0;
  return e;
}
const hits = (s: RunState) => s.events.filter((v) => v.e === 'dmg').length;
const lost = (e: { hp: number; maxHp: number }) => e.maxHp - e.hp;

describe('무기 표', () => {
  it('4종 모두 기본 공격과 스킬 2개가 있다', () => {
    expect(WEAPON_KINDS).toEqual(['sword', 'spear', 'bow', 'fan']);
    for (const k of WEAPON_KINDS) {
      const w = WEAPONS[k];
      expect(w.basic.acts.length).toBeGreaterThan(0);
      expect(w.skills.length).toBe(2);
      for (const sk of w.skills) {
        expect(sk.mp).toBeGreaterThan(0);
        expect(sk.cd).toBeGreaterThan(w.basic.cd);
      }
    }
    // 칼은 빠르고 활은 느리다 (PRD 표)
    expect(WEAPONS.sword.basic.cd).toBeLessThan(WEAPONS.spear.basic.cd);
    expect(WEAPONS.spear.basic.cd).toBeLessThan(WEAPONS.bow.basic.cd);
  });

  it('착용 레벨 12단계 (9단위)와 등급 공격력', () => {
    expect([...TIER_LEVELS]).toEqual([1, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99]);
    expect(tierForLevel(1)).toBe(0);
    expect(tierForLevel(8)).toBe(0);
    expect(tierForLevel(9)).toBe(1);
    expect(tierForLevel(99)).toBe(11);
    for (let t = 1; t < 12; t++) expect(tierAtk(t)).toBeGreaterThan(tierAtk(t - 1));
  });

  it('10레벨마다 스킬이 강해진다', () => {
    expect(skillLevelMul(9)).toBe(1);
    expect(skillLevelMul(10)).toBeCloseTo(1.08);
    expect(skillLevelMul(99)).toBeCloseTo(1.72);
  });
});

describe('스킬 공통', () => {
  it('마력을 쓰고 재사용 대기가 걸린다', () => {
    const s = run(arena(), { weapon: 'sword' });
    const sk = WEAPONS.sword.skills[0];
    play(s, 0.1, { skill: [true, false] });
    expect(s.p.mp).toBeLessThan(s.stats.mp - sk.mp + 1);
    expect(s.p.skillCd[0]).toBeCloseTo(sk.cd - 0.1, 1);
    const mp = s.p.mp;
    play(s, 0.1, { skill: [true, false] });
    expect(s.p.mp).toBeGreaterThanOrEqual(mp); // 대기 중에는 다시 나가지 않는다
  });

  it('마력이 모자라면 나가지 않고 대기도 걸리지 않는다', () => {
    const s = run(arena(), { weapon: 'sword' });
    s.p.mp = 3;
    step(s, { ...noInput(), skill: [true, false] });
    expect(s.p.skillCd[0]).toBe(0);
    expect(s.events.some((v) => v.e === 'nope' && v.why === 'mp')).toBe(true);
  });
});

describe('칼', () => {
  it('연속 베기: 세 번 벤다', () => {
    const s = run(arena({ groups: [group(8, 5)] }), { weapon: 'sword' });
    const e = dummy(s, 0, 0, -70);
    play(s, 0.5, { skill: [true, false] });
    expect(hits(s)).toBe(3);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it('돌진 베기: 앞으로 나아가며 길 위의 요괴를 한 번씩 베고, 그동안 맞지 않는다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 2)] }), { weapon: 'sword' });
    dummy(s, 0, 0, -120);
    dummy(s, 1, 10, -220);
    const y0 = s.p.y;
    step(s, { ...noInput(), skill: [false, true] });
    expect(s.p.invuln).toBeGreaterThan(0);
    play(s, 0.4);
    expect(y0 - s.p.y).toBeGreaterThan(250);
    expect(hits(s)).toBe(2);
  });
});

describe('창', () => {
  it('찌르기: 길고 좁다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 2)] }), { weapon: 'spear' });
    const far = dummy(s, 0, 0, -170);
    const side = dummy(s, 1, 110, -20);
    s.p.moving = true; // 조준 보정이 옆 요괴로 돌지 않게 위를 본 채로
    step(s, { ...noInput(), my: -1, attack: true });
    expect(lost(far)).toBeGreaterThan(0);
    expect(lost(side)).toBe(0);
  });

  it('회전 베기: 뒤에 있는 요괴도 맞는다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 2)] }), { weapon: 'spear' });
    const front = dummy(s, 0, 0, -120);
    const back = dummy(s, 1, 0, 120);
    step(s, { ...noInput(), skill: [true, false] });
    expect(lost(front)).toBeGreaterThan(0);
    expect(lost(back)).toBeGreaterThan(0);
  });

  it('창 던지기: 한 줄로 선 요괴를 모두 뚫는다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 3)] }), { weapon: 'spear' });
    const es = [dummy(s, 0, 0, -150), dummy(s, 1, 0, -300), dummy(s, 2, 0, -450)];
    play(s, 1, { skill: [false, true] });
    for (const e of es) expect(lost(e)).toBeGreaterThan(0);
    expect(hits(s)).toBe(3);
  });
});

describe('활', () => {
  it('쏘기: 멀리 있는 요괴 하나를 뚫고 둘째까지 맞힌 뒤 사라진다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 3)] }), { weapon: 'bow' });
    const near = dummy(s, 0, 0, -300);
    const behind = dummy(s, 1, 0, -400);
    const last = dummy(s, 2, 0, -500);
    step(s, { ...noInput(), attack: true });
    expect(lost(near)).toBe(0); // 날아가는 중
    expect(s.events.some((v) => v.e === 'fx')).toBe(false); // 붙은 요괴가 없으면 활대를 휘두르지 않는다
    play(s, 1);
    expect(lost(near)).toBeGreaterThan(0);
    expect(lost(behind)).toBeGreaterThan(0);
    expect(lost(last)).toBe(0);
    expect(s.shots.every((sh) => !sh.on)).toBe(true);
  });

  it.each(['bow', 'fan'] as const)('%s: 바짝 붙은 요괴는 밀쳐 낸다 (근접 약점 보완)', (weapon) => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 2)] }), { weapon });
    const close = dummy(s, 0, 0, -60);
    const far = dummy(s, 1, 0, -200);
    const y0 = close.y;
    step(s, { ...noInput(), attack: true });
    expect(s.events.some((v) => v.e === 'fx')).toBe(true);
    expect(lost(close)).toBeGreaterThan(0);
    expect(lost(far)).toBe(0); // 멀리 있는 요괴는 밀쳐 내기에 맞지 않는다 (화살·구슬은 아직 날아가는 중)
    play(s, 0.3);
    expect(y0 - close.y).toBeGreaterThan(60);
  });

  it('화살은 벽에서 멈춘다', () => {
    const rows = arena().rows.map((r, y) => (y === 7 ? '################' : r));
    const s = run(arena({ rows, groups: [group(8, 3)] }), { weapon: 'bow' });
    const e = s.enemies[0];
    e.hp = e.maxHp = 1e6;
    e.awake = true;
    e.speed = 0;
    e.cd = 1e6;
    play(s, 1.5, { attack: true });
    expect(lost(e)).toBe(0);
  });

  it('화살 비: 요괴가 있는 자리에 떨어져 여러 번 맞는다', () => {
    const s = run(arena({ groups: [group(8, 5)] }), { weapon: 'bow' });
    const e = dummy(s, 0, 60, -380);
    play(s, 3, { skill: [true, false] });
    expect(hits(s)).toBeGreaterThanOrEqual(5);
    expect(s.zones.length).toBe(0);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it('세 갈래 화살: 세 발이 나간다', () => {
    const s = run(arena(), { weapon: 'bow' });
    step(s, { ...noInput(), skill: [false, true] });
    expect(s.shots.filter((sh) => sh.on).length).toBe(3);
  });
});

describe('부채', () => {
  it('구슬: 마력을 조금 쓰고, 마력이 없어도 약하게 나간다', () => {
    const s = run(arena({ groups: [group(8, 5)] }), { weapon: 'fan' });
    const e = dummy(s, 0, 0, -200);
    const mp = s.p.mp;
    step(s, { ...noInput(), attack: true });
    expect(s.p.mp).toBeLessThan(mp);
    play(s, 0.45);
    const full = lost(e);
    expect(full).toBeGreaterThan(0);
    s.p.mp = 0;
    s.p.atkCd = 0;
    s.seed = 99; // 치명타가 섞이지 않게 같은 흐름으로 다시
    step(s, { ...noInput(), attack: true });
    expect(Math.min(...s.shots.filter((sh) => sh.on).map((sh) => sh.mul))).toBeCloseTo(1.3 * NO_MP_MUL);
  });

  it('회오리바람: 요괴를 가운데로 끌어당긴다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 2)] }), { weapon: 'fan' });
    const a = dummy(s, 0, 0, -240);
    const b = dummy(s, 1, 120, -240);
    step(s, { ...noInput(), skill: [true, false] });
    const z = s.zones[0];
    const d0 = Math.hypot(b.x - z.x, b.y - z.y);
    play(s, 0.8);
    expect(Math.hypot(b.x - z.x, b.y - z.y)).toBeLessThan(d0 - 40);
    expect(lost(a)).toBeGreaterThan(0);
  });

  it('번개: 가까운 요괴부터 다섯까지 번지고, 요괴가 없으면 나가지 않는다', () => {
    const s = run(arena({ groups: [group(8, 5, 'imp', 7)] }), { weapon: 'fan' });
    s.enemies.forEach((_, i) => dummy(s, i, ((i % 4) - 1.5) * 70, -200 - Math.floor(i / 4) * 70));
    step(s, { ...noInput(), skill: [false, true] });
    expect(hits(s)).toBe(5);
    expect(s.events.some((v) => v.e === 'chain' && v.pts.length === 12)).toBe(true);

    const none = run(arena(), { weapon: 'fan' });
    const mp = none.p.mp;
    step(none, { ...noInput(), skill: [false, true] });
    expect(none.p.skillCd[1]).toBe(0);
    expect(none.p.mp).toBeGreaterThanOrEqual(mp);
    expect(none.events.some((v) => v.e === 'nope' && v.why === 'target')).toBe(true);
  });
});

describe('물약', () => {
  it('체력 물약: 바로 회복하고 한 개 줄어든다. 공통 대기 3초', () => {
    const s = run(arena(), { potions: [2, 2] });
    s.p.hp = 10;
    s.p.mp = 0;
    step(s, { ...noInput(), potion: [true, false] });
    expect(s.p.hp).toBe(10 + Math.round(s.stats.hp * POTION_HEAL.hp));
    expect(s.potions).toEqual([1, 2]);
    // 공통 대기: 마력 물약도 바로는 못 먹는다
    step(s, { ...noInput(), potion: [false, true] });
    expect(s.potions).toEqual([1, 2]);
    play(s, POTION_CD);
    step(s, { ...noInput(), potion: [false, true] });
    expect(s.potions).toEqual([1, 1]);
    expect(s.p.mp).toBeGreaterThan(s.stats.mp * POTION_HEAL.mp);
  });

  it('가득 차 있거나 물약이 없으면 먹지 않는다', () => {
    const s = run(arena(), { potions: [1, 0] });
    step(s, { ...noInput(), potion: [true, false] });
    expect(s.potions[0]).toBe(1);
    s.p.mp = 0;
    step(s, { ...noInput(), potion: [false, true] });
    expect(s.p.potionCd).toBe(0);
  });

  it('최대치를 넘겨 회복하지 않는다', () => {
    const s = run(arena(), { potions: [1, 0] });
    s.p.hp = s.stats.hp - 5;
    step(s, { ...noInput(), potion: [true, false] });
    expect(s.p.hp).toBe(s.stats.hp);
  });
});

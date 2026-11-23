import { describe, expect, it } from 'vitest';
import {
  HEROES,
  HERO_IDS,
  ALL_HERO_IDS,
  EXTRA_HERO_IDS,
  isHeroId,
  beginShot,
  canSpecial,
  createRun,
  endTurn,
  heroStats,
  playShot,
  stepShot,
  type ComboKind,
  type HeroId,
  type RunState,
  type ShotInput,
  type SimEvent,
} from '../src/sim';
import { cfgOf, foe, hero } from './helpers';

function fly(s: RunState, inp: ShotInput): SimEvent[] {
  const ev = beginShot(s, inp);
  while (s.phase === 'shot') ev.push(...stepShot(s));
  return ev;
}

/** 쥐가 위로 쏘아 바로 위에 선 아군(ally)을 스치게 놓은 판 */
function comboRun(ally: HeroId, foes = [foe(320, 300, { hp: 9999 }), foe(500, 650, { hp: 9999 }), foe(150, 650, { hp: 9999 })]) {
  const s = createRun(cfgOf([hero('ox'), hero(ally)], [foes]));
  s.heroes[0].x = 320;
  s.heroes[0].y = 900;
  s.heroes[1].x = 330;
  s.heroes[1].y = 650;
  return s;
}

describe('대원 12종 데이터', () => {
  it('PRD 표대로 12종 · 처음 3종(쥐·소·호랑이) · 타입 · 충전 턴', () => {
    expect(HERO_IDS.length).toBe(12);
    expect(HERO_IDS.filter((id) => HEROES[id].unlockRegion === 0)).toEqual(['rat', 'ox', 'tiger']);
    const pierce = HERO_IDS.filter((id) => HEROES[id].type === 'pierce');
    expect(pierce).toEqual(['ox', 'dragon', 'horse', 'rooster', 'pig']);
    expect(HERO_IDS.map((id) => HEROES[id].charge)).toEqual([4, 6, 8, 7, 10, 6, 6, 7, 8, 9, 7, 8]);
    expect(HERO_IDS.map((id) => HEROES[id].unlockRegion)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 능력치 차이는 10% 안팎
    const hp = HERO_IDS.map((id) => HEROES[id].hp);
    const atk = HERO_IDS.map((id) => HEROES[id].atk);
    expect(Math.max(...hp) / Math.min(...hp)).toBeLessThanOrEqual(1.2);
    expect(Math.max(...atk) / Math.min(...atk)).toBeLessThanOrEqual(1.2);
  });

  it('고양이(13번째 대원): 지역 합류 밖 · 능력치는 십이지 범위 안 · 콤보/필살기는 다른 대원과 겹치지 않는다', () => {
    expect([...EXTRA_HERO_IDS]).toEqual(['cat']);
    expect(ALL_HERO_IDS).toEqual([...HERO_IDS, 'cat']);
    const c = HEROES.cat;
    expect(c.unlockRegion).toBe(-1);
    expect(isHeroId('cat')).toBe(true);
    const hp = HERO_IDS.map((id) => HEROES[id].hp);
    const atk = HERO_IDS.map((id) => HEROES[id].atk);
    expect(c.hp).toBeLessThanOrEqual(Math.max(...hp));
    expect(c.atk).toBeLessThanOrEqual(Math.max(...atk));
    expect(HERO_IDS.some((id) => HEROES[id].combo === c.combo || HEROES[id].special === c.special)).toBe(false);
  });

  it('레벨·강화 → 능력치', () => {
    expect(heroStats('rat', 1)).toEqual({ hp: 100, atk: 30, comboTier: 1, charge0: 0, healMul: 1 });
    expect(heroStats('rat', 30).comboTier).toBe(4);
    expect(heroStats('rat', 11).hp).toBe(140);
    expect(heroStats('rat', 1, { charge: 2, heal: 3 })).toMatchObject({ charge0: 2, healMul: 1.3 });
  });
});

describe('우정 콤보', () => {
  it('날아가는 중 가만히 있는 아군을 스치면 그 아군 콤보가 한 번 나간다 (한 발사에 아군마다 한 번)', () => {
    const s = comboRun('tiger');
    const ev = fly(s, { a: 2700, p: 100, s: 0 });
    const combos = ev.filter((e) => e.t === 'combo');
    expect(combos.length).toBe(1);
    expect(combos[0].t === 'combo' && combos[0].hero).toBe(1);
  });

  it('스치지 않으면 콤보가 없다', () => {
    const s = comboRun('tiger');
    const ev = fly(s, { a: 0, p: 10, s: 0 });
    expect(ev.some((e) => e.t === 'combo')).toBe(false);
  });

  it('쓰러진 아군은 콤보를 쏘지 않는다', () => {
    const s = comboRun('tiger');
    s.heroes[1].fallen = true;
    const ev = fly(s, { a: 2700, p: 100, s: 0 });
    expect(ev.some((e) => e.t === 'combo')).toBe(false);
  });

  const damaging: [HeroId, ComboKind][] = [
    ['rat', 'shuriken'],
    ['ox', 'quake'],
    ['tiger', 'laserH'],
    ['dragon', 'laserV'],
    ['horse', 'kick'],
    ['monkey', 'balls'],
    ['rooster', 'cleanse'],
    ['dog', 'fang'],
    ['cat', 'scratch'],
  ];
  it.each(damaging)('%s 콤보(%s)가 요괴에게 피해를 준다', (id) => {
    const foes = [foe(330, 300, { hp: 9999 }), foe(500, 650, { hp: 9999 }), foe(180, 650, { hp: 9999 }), foe(480, 500, { hp: 9999 }), foe(180, 800, { hp: 9999 })];
    const s = createRun(cfgOf([hero('rat'), hero(id)], [foes]));
    s.heroes[1].x = 330;
    s.heroes[1].y = 650;
    const ev: SimEvent[] = [];
    // 아군 콤보만 시험: 쥐를 아군 바로 아래에 두고 위로
    s.heroes[0].x = 330;
    s.heroes[0].y = 900;
    ev.push(...fly(s, { a: 2700, p: 100, s: 0 }));
    const ci = ev.findIndex((e) => e.t === 'combo');
    expect(ci).toBeGreaterThanOrEqual(0);
    const c = ev[ci];
    expect(c.t === 'combo' && c.targets.length).toBeGreaterThan(0);
  });

  it('회복 구슬(토끼): 모든 대원 체력 조금', () => {
    const s = comboRun('rabbit');
    s.heroes.forEach((h) => (h.hp = 50));
    fly(s, { a: 2700, p: 100, s: 0 });
    expect(s.heroes[1].hp).toBeGreaterThan(50);
    expect(s.heroes[0].hp).toBeGreaterThan(50);
  });

  it('독(뱀): 요괴 차례마다 피해', () => {
    const s = comboRun('snake', [foe(330, 540, { hp: 9999, cd: 9 })]);
    s.heroes[0].x = 400;
    fly(s, { a: 2600, p: 40, s: 0 });
    const f = s.foes[0];
    expect(f.poisonTurns).toBe(3);
    const hp = f.hp;
    endTurn(s);
    expect(f.hp).toBe(hp - f.poison);
    expect(f.poisonTurns).toBe(2);
  });

  it('보호막(양): 다음 피해 반', () => {
    const s = comboRun('sheep', [foe(330, 100, { hp: 9999, cd: 1, atk: 20, pattern: ['all'] })]);
    const ev = playShot(s, { a: 2700, p: 100, s: 0 });
    const att = ev.find((e) => e.t === 'attack');
    expect(att?.t === 'attack' && att.hits.map((h) => h.dmg)).toEqual([6, 6]); // 전체 공격 12 → 반
  });

  it('냥냥 펀치(고양이): 가장 가까운 요괴를 세 번 할퀸다', () => {
    const s = comboRun('cat', [foe(330, 520, { hp: 9999 }), foe(100, 100, { hp: 9999 })]);
    s.heroes[0].x = 400;
    const ev = fly(s, { a: 2600, p: 40, s: 0 });
    const ci = ev.findIndex((e) => e.t === 'combo');
    expect(ci).toBeGreaterThanOrEqual(0);
    const hits = ev.slice(ci + 1, ci + 4);
    expect(hits.every((e) => e.t === 'hit' && e.id === s.foes[0].id)).toBe(true);
  });

  it('엽전(돼지): 판 엽전이 는다', () => {
    const s = comboRun('pig');
    fly(s, { a: 2700, p: 100, s: 0 });
    expect(s.coins).toBeGreaterThan(0);
  });
});

describe('필살기', () => {
  it('턴마다 충전되고 다 차면 쓸 수 있다 · 쓰면 0', () => {
    const s = createRun(cfgOf([hero('rat')], [[foe(320, 100, { hp: 99999, atk: 0 })]]));
    for (let i = 0; i < 4; i++) {
      expect(canSpecial(s)).toBe(false);
      playShot(s, { a: 900, p: 1, s: 1 }); // 덜 찼을 때 s=1 은 무시
    }
    expect(s.heroes[0].charge).toBe(4);
    expect(canSpecial(s)).toBe(true);
    const ev = beginShot(s, { a: 2700, p: 50, s: 1 });
    expect(ev.some((e) => e.t === 'special')).toBe(true);
    expect(s.heroes[0].charge).toBe(0);
  });

  const ready = (id: HeroId, foes = [foe(320, 200, { hp: 9999, cd: 3 })], extra: HeroId[] = []) => {
    const s = createRun(cfgOf([hero(id, { charge0: 99 }), ...extra.map((e) => hero(e))], [foes]));
    s.heroes[0].charge = s.heroes[0].chargeMax;
    return s;
  };

  it('쥐: 속도 2배', () => {
    const a = ready('rat');
    const b = ready('rat');
    beginShot(a, { a: 2700, p: 50, s: 1 });
    beginShot(b, { a: 2700, p: 50, s: 0 });
    expect(a.movers[0].vy).toBe(b.movers[0].vy * 2);
  });

  it('소: 크기 2배 관통', () => {
    const s = ready('ox');
    beginShot(s, { a: 2700, p: 50, s: 1 });
    expect(s.movers[0].r).toBe(60);
    expect(s.movers[0].pierce).toBe(true);
  });

  it('호랑이: 모든 요괴 턴 +1', () => {
    const s = ready('tiger');
    beginShot(s, { a: 900, p: 1, s: 1 });
    expect(s.foes[0].left).toBe(4);
  });

  it('토끼: 모두 회복 + 쓰러진 대원 1명 일으키기', () => {
    const s = ready('rabbit', undefined, ['rat', 'ox']);
    s.heroes[1].fallen = true;
    s.heroes[1].hp = 0;
    s.heroes[2].hp = 10;
    const ev = beginShot(s, { a: 900, p: 1, s: 1 });
    expect(ev.some((e) => e.t === 'revive' && e.hero === 1)).toBe(true);
    expect(s.heroes[1].fallen).toBe(false);
    expect(s.heroes[1].hp).toBeGreaterThan(0);
    expect(s.heroes[2].hp).toBeGreaterThan(10);
  });

  it('용: 화면 전체 피해', () => {
    const s = ready('dragon', [foe(100, 100, { hp: 9999 }), foe(500, 300, { hp: 9999 })]);
    beginShot(s, { a: 900, p: 1, s: 1 });
    expect(s.foes.every((f) => f.hp < 9999)).toBe(true);
  });

  it('뱀: 가장 먼저 공격할 요괴 하나가 두 턴 멈춘다', () => {
    const s = ready('snake', [foe(100, 100, { hp: 9999, cd: 3 }), foe(500, 100, { hp: 9999, cd: 1, atk: 50 })]);
    playShot(s, { a: 900, p: 1, s: 1 });
    expect(s.foes[1].frozen).toBe(1);
    expect(s.heroes[0].hp).toBe(s.heroes[0].maxHp); // 공격하지 않았다
  });

  it('말: 멈춘 뒤 한 번 더 달린다', () => {
    const s = ready('horse', [foe(-500, -500)]);
    const ev = fly(s, { a: 2700, p: 20, s: 1 });
    expect(ev.some((e) => e.t === 'dash')).toBe(true);
  });

  it('양: 2턴 동안 받는 피해 반', () => {
    const s = ready('sheep', [foe(320, 200, { hp: 99999, cd: 1, atk: 20 })]);
    const ev = playShot(s, { a: 900, p: 1, s: 1 });
    const att = ev.find((e) => e.t === 'attack');
    expect(att?.t === 'attack' && att.hits[0].dmg).toBe(10);
    const ev2 = playShot(s, { a: 900, p: 1, s: 0 });
    const att2 = ev2.find((e) => e.t === 'attack');
    expect(att2?.t === 'attack' && att2.hits[0].dmg).toBe(10);
    const ev3 = playShot(s, { a: 900, p: 1, s: 0 });
    const att3 = ev3.find((e) => e.t === 'attack');
    expect(att3?.t === 'attack' && att3.hits[0].dmg).toBe(20);
  });

  it('원숭이: 작은 분신 2명이 함께 날아가고 끝나면 사라진다', () => {
    const s = ready('monkey');
    beginShot(s, { a: 2700, p: 50, s: 1 });
    expect(s.movers.filter((m) => m.clone).length).toBe(2);
    while (s.phase === 'shot') stepShot(s);
    expect(s.movers.length).toBe(0);
  });

  it('닭: 다른 대원 필살기 충전 +2', () => {
    const s = ready('rooster', undefined, ['rat']);
    beginShot(s, { a: 900, p: 1, s: 1 });
    expect(s.heroes[1].charge).toBe(2);
  });

  it('개: 체력 낮은 요괴 3마리 공격', () => {
    const s = ready('dog', [foe(100, 100, { hp: 500 }), foe(200, 100, { hp: 100 }), foe(300, 100, { hp: 200 }), foe(400, 100, { hp: 300 })]);
    beginShot(s, { a: 900, p: 1, s: 1 });
    expect(s.foes.map((f) => f.hp < f.maxHp)).toEqual([false, true, true, true]);
  });

  it('고양이: 멈추면 가장 가까운 요괴에게 한 번 더 덮친다', () => {
    // 오른쪽 아래로 살짝 쏘면 요괴(왼쪽 위)에 닿지 않고 멈춘다 → 덮치기로 그 요괴를 때린다
    const a = ready('cat', [foe(120, 200, { hp: 99999, cd: 9 }), foe(600, 40, { hp: 99999, cd: 9 })]);
    const b = ready('cat', [foe(120, 200, { hp: 99999, cd: 9 }), foe(600, 40, { hp: 99999, cd: 9 })]);
    const ea = fly(a, { a: 0, p: 5, s: 1 });
    const eb = fly(b, { a: 0, p: 5, s: 0 });
    const pounce = ea.find((e) => e.t === 'pounce');
    expect(pounce && pounce.t === 'pounce' && [pounce.tx, pounce.ty]).toEqual([120, 200]);
    expect(ea.some((e) => e.t === 'hit' && e.id === a.foes[0].id)).toBe(true);
    expect(eb.some((e) => e.t === 'pounce' || e.t === 'hit')).toBe(false);
    // 덮치기는 한 번만
    expect(ea.filter((e) => e.t === 'pounce').length).toBe(1);
  });

  it('고양이: 요괴가 없으면 덮치지 않고 그대로 멈춘다', () => {
    const s = ready('cat', [foe(-500, -500, { hp: 1 })]);
    s.foes[0].alive = false;
    s.foes[0].down = true; // 판이 끝나지 않게 (되살아날 요괴)
    const ev = fly(s, { a: 2700, p: 20, s: 1 });
    expect(ev.some((e) => e.t === 'pounce')).toBe(false);
    expect(s.phase).toBe('settle');
  });

  it('돼지: 벽에 튕길수록 피해가 커진다', () => {
    const a = ready('pig', [foe(320, 300, { hp: 99999 })]);
    const b = ready('pig', [foe(320, 300, { hp: 99999 })]);
    const shot = { a: 2250, p: 100 } as const; // 왼쪽 벽에 한 번 튕긴 뒤 요괴
    const ea = fly(a, { ...shot, s: 1 });
    const eb = fly(b, { ...shot, s: 0 });
    const sum = (ev: SimEvent[]) => ev.reduce((t, e) => t + (e.t === 'hit' ? e.dmg : 0), 0);
    expect(sum(ea)).toBeGreaterThan(sum(eb));
  });
});

describe('줍기', () => {
  it('요괴가 떨어뜨린 회복 구슬 · 엽전 주머니를 밟으면 줍는다', () => {
    const s = createRun(cfgOf([hero('ox', { atk: 999 })], [[foe(320, 500, { hp: 10, drop: 'heal' }), foe(320, 300, { hp: 10, drop: 'coin' }), foe(50, 50, { hp: 9999 })]]));
    s.heroes[0].x = 320;
    s.heroes[0].hp = 50;
    const ev = playShot(s, { a: 2700, p: 30, s: 0 });
    expect(ev.filter((e) => e.t === 'drop').length).toBe(2);
    // 관통형이라 쓰러뜨린 자리를 그대로 지나가며 줍는다
    expect(ev.some((e) => e.t === 'pick' && e.kind === 'heal')).toBe(true);
    expect(ev.some((e) => e.t === 'pick' && e.kind === 'coin')).toBe(true);
    expect(s.heroes[0].hp).toBeGreaterThan(50);
    expect(s.coins).toBe(3);
  });
});

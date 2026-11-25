/**
 * 4차 (51~100층): 새 적 AI · 정예 번개 줄기 · 보스 다섯의 기술과 단계 · 새 퍼즐 다섯 · 70·90층 전설 구슬 · 100층 소원 구슬과 엔딩 저장.
 * 빈 시험 방(arena)에서 하나씩, 전설 구슬·소원은 실제 층(generateFloor)에서.
 */
import { describe, expect, it } from 'vitest';
import { T, TILE, generateFloor } from '../src/game/floorgen';
import { clearFloor, climbAgain, newData, normalize, towerDone } from '../src/game/progress';
import { BODY_UP, createRun, interactTarget, noInput, step, tileOf, type Enemy, type RunState } from '../src/game/sim';
import { checkSave } from '../src/net/api';
import { arena, foe, press, wait } from './arena';

const steps = (s: RunState, n: number, inp = noInput()) => {
  for (let i = 0; i < n; i++) step(s, inp);
};
const until = (s: RunState, ok: () => boolean, sec = 5) => {
  for (let i = 0; i < sec * 60 && !ok(); i++) step(s, noInput());
  return ok();
};
const boss = (floor: number, id: string, dx = 60) => {
  const s = arena({ floor, level: floor });
  const b = foe(s, id, dx, 0, false);
  s.boss = b;
  b.cd = 0;
  return { s, b };
};
/** 바로 옆에서 칼을 휘두른다 (맞았는지는 부르는 쪽이 본다) */
const slashAt = (s: RunState, e: Enemy, n = 30) => {
  s.p.swing = null;
  s.p.recover = 0;
  s.p.x = e.x - 16;
  s.p.y = e.y + BODY_UP;
  s.p.face = 2;
  steps(s, n, { ...noInput(), attack: true });
};
const hittableNow = (s: RunState, e: Enemy) => {
  const hp = e.hp;
  slashAt(s, e);
  return e.hp < hp;
};

describe('6~10구역 일반 적 · 정예', () => {
  it('번개 깃발: 선으로 예고하고, 그 줄 전체에 번개 (줄에서 비켜나면 안 맞는다)', () => {
    const s = arena({ floor: 53 });
    const e = foe(s, 'flagspirit', 80, 0, false);
    e.cd = 0;
    steps(s, 2);
    expect(e.state).toBe('beamWind');
    expect(e.tele).toMatchObject({ kind: 'fan', n: 1 });
    const hp = s.p.hp;
    expect(until(s, () => e.state === 'strike', 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    const r = arena({ floor: 53 });
    const f = foe(r, 'flagspirit', 80, 0, false);
    f.cd = 0;
    steps(r, 2);
    r.p.y += 30;
    const hp2 = r.p.hp;
    expect(until(r, () => f.state === 'strike', 2)).toBe(true);
    expect(r.p.hp).toBe(hp2);
  });

  it('별똥 슬라임: 쓰러지면 별 부스러기 둘로 나뉜다 (부스러기는 경험치·엽전 없음)', () => {
    const s = arena({ floor: 61 });
    const e = foe(s, 'starslime', 18);
    e.hp = 1;
    s.p.inv = 999;
    slashAt(s, e, 20);
    expect(e.alive).toBe(false);
    const bits = s.enemies.filter((m) => m.def.id === 'starlet' && m.alive);
    expect(bits).toHaveLength(2);
    expect(bits.every((m) => m.summoned)).toBe(true);
    const exp = s.data.exp;
    const coins = s.data.coins;
    for (const m of bits) {
      m.hp = 1;
      m.wake = 999;
      slashAt(s, m, 20);
    }
    expect(bits.every((m) => !m.alive)).toBe(true);
    expect(s.data.exp).toBe(exp);
    expect(s.data.coins).toBe(coins);
  });

  it('꽃 요정: 둘레의 다친 동료를 고친다', () => {
    const s = arena({ floor: 73 });
    const f = foe(s, 'fairy', 60, 0, false);
    const ally = foe(s, 'thornhand', 70, 10);
    ally.hp = Math.floor(ally.max * 0.4);
    const hp = ally.hp;
    s.p.inv = 999;
    steps(s, 3);
    expect(ally.hp).toBeGreaterThan(hp);
    expect(s.fx.some((x) => x.kind === 'heal')).toBe(true);
    expect(f.alive).toBe(true);
  });

  it('정예 번개 줄기: 뇌우 장수 세 갈래 · 천상 장군 세 갈래 · 장승은 세 방향(120도) 세 갈래', () => {
    for (const [id, floor, n] of [['thunderGeneral', 59, 3], ['skygeneral', 99, 3], ['jangseung', 89, 3]] as const) {
      const s = arena({ floor });
      const e = foe(s, id, 90, 0, false);
      e.beamCd = 0;
      e.fanCd = 99;
      e.leapCd = 99;
      e.ringCd = 99;
      e.dashCd = 99;
      steps(s, 2);
      expect(e.state, id).toBe('beamWind');
      expect(e.tele?.n, id).toBe(n);
      const hp = s.p.hp;
      expect(until(s, () => e.state === 'strike', 2)).toBe(true);
      expect(s.p.hp, id).toBeLessThan(hp);
    }
  });
});

describe('보스: 뇌공 (60층)', () => {
  it('번개 줄기는 부채꼴 선 셋, 낙뢰 행진은 보스에서 캐릭터 쪽으로 차례로 떨어진다', () => {
    const { s, b } = boss(60, 'noegong', 70);
    b.pattern = 0;
    steps(s, 2);
    expect(b.state).toBe('skillWind');
    expect(b.tele).toMatchObject({ kind: 'fan', n: 3 });
    const hp = s.p.hp;
    expect(until(s, () => b.state === 'strike', 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    const t = boss(60, 'noegong', 90);
    t.b.pattern = 1;
    steps(t.s, 2);
    const zaps = t.s.strikes.filter((k) => k.kind === 'zap');
    expect(zaps).toHaveLength(7);
    // 차례로 (멀수록 늦게), 캐릭터 쪽으로
    for (let i = 1; i < zaps.length; i++) expect(zaps[i].total).toBeGreaterThan(zaps[i - 1].total);
    expect(zaps[6].x).toBeLessThan(zaps[0].x);
  });

  it('체력 절반: 먹구름에 올라 맞지 않고, 천둥 북 넷을 한꺼번에 울리면 떨어져 멍해지고 체력이 깎인다', () => {
    const { s, b } = boss(60, 'noegong', 70);
    b.hp = Math.floor(b.max * 0.49);
    s.p.inv = 999;
    steps(s, 2);
    expect(b.guard).toBe('cloud');
    const drums = s.enemies.filter((e) => e.def.id === 'drum');
    expect(drums).toHaveLength(4);
    expect(hittableNow(s, b)).toBe(false);
    // 셋만 울리면 그대로
    for (const d of drums.slice(0, 3)) {
      s.p.inv = 999;
      slashAt(s, d, 8);
    }
    expect(drums.slice(0, 3).every((d) => d.lit > 0)).toBe(true);
    expect(b.guard).toBe('cloud');
    expect(drums[0].hp).toBe(drums[0].max);
    const hp = b.hp;
    s.p.inv = 999;
    slashAt(s, drums[3], 8);
    expect(b.guard).toBeNull();
    expect(b.state).toBe('stun');
    expect(b.hp).toBeLessThan(hp);
    expect(b.rage).toBe(true);
    expect(hittableNow(s, b)).toBe(true);
  });
});

describe('보스: 까마귀 대왕 (70층)', () => {
  it('오작교 무너뜨리기: 띠 둘 (하나는 캐릭터 줄) — 네모 안에 있으면 맞는다', () => {
    const { s, b } = boss(70, 'crowKing', 70);
    b.pattern = 3;
    steps(s, 2);
    expect(s.rects).toHaveLength(2);
    const by = s.p.y - BODY_UP;
    expect(s.rects.some((r) => (r.y0 <= by && by <= r.y1) || (r.x0 <= s.p.x && s.p.x <= r.x1))).toBe(true);
    b.wake = 999;
    const hp = s.p.hp;
    wait(s, 1.6);
    expect(s.rects).toHaveLength(0);
    expect(s.p.hp).toBeLessThan(hp);
  });

  it('체력 절반: 그림자로 갈라진다 — 그림자는 한 대에 사라지며 깃털을 흩뿌리고, 진짜는 그대로', () => {
    const { s, b } = boss(70, 'crowKing', 70);
    b.hp = Math.floor(b.max * 0.49);
    s.p.inv = 999;
    expect(until(s, () => s.enemies.some((e) => e.def.ai === 'decoy' && e.alive), 2)).toBe(true);
    const decoys = s.enemies.filter((e) => e.def.ai === 'decoy');
    expect(decoys).toHaveLength(2);
    expect(decoys.every((d) => d.def.art === 'crowKing' && d.summoned)).toBe(true);
    const d = decoys[0];
    d.wake = 999;
    const exp = s.data.exp;
    slashAt(s, d, 20);
    expect(d.alive).toBe(false);
    // 사방으로 6발 (벽에 바로 닿는 것은 사라진다)
    expect(s.projs.filter((q) => q.from === 'e' && q.kind === 'crowfeather').length).toBeGreaterThanOrEqual(4);
    expect(s.data.exp).toBe(exp);
    expect(b.alive).toBe(true);
  });
});

describe('보스: 꽃감관 (80층)', () => {
  it('가시 감옥: 캐릭터 자리 원 — 갇히면 잠깐 못 움직인다', () => {
    const { s, b } = boss(80, 'ggotgamgwan', 70);
    b.pattern = 2;
    steps(s, 2);
    const cage = s.strikes.find((k) => k.kind === 'thornCage');
    expect(cage?.root).toBeGreaterThan(0);
    b.wake = 999;
    const hp = s.p.hp;
    expect(until(s, () => !s.strikes.length, 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    expect(s.p.root).toBeGreaterThan(0.5);
  });

  it('체력 절반: 몇 초마다 캐릭터가 있는 쪽(방의 네 쪽 중)에 꽃이 핀다 (네모 예고)', () => {
    const { s, b } = boss(80, 'ggotgamgwan', 90);
    b.hp = Math.floor(b.max * 0.49);
    s.p.inv = 999;
    expect(until(s, () => s.rects.some((r) => r.kind === 'bloom'), 3)).toBe(true);
    const by = s.p.y - BODY_UP;
    expect(s.rects.some((r) => r.kind === 'bloom' && r.x0 <= s.p.x && s.p.x <= r.x1 && r.y0 <= by && by <= r.y1)).toBe(true);
    // 성나면 두 쪽
    expect(s.rects.filter((r) => r.kind === 'bloom').length).toBe(2);
  });
});

describe('보스: 흑룡 (90층)', () => {
  it('체력 절반: 폭풍의 눈 — 가만히 있어도 흑룡 쪽으로 끌려가고, 고리는 한 군데가 비어 있다', () => {
    const { s, b } = boss(90, 'heukryong', 100);
    b.hp = Math.floor(b.max * 0.49);
    s.p.inv = 999;
    steps(s, 2);
    expect(s.vortex).not.toBeNull();
    b.wake = 999;
    const d0 = Math.hypot(b.x - s.p.x, b.y - (s.p.y - BODY_UP));
    wait(s, 1);
    expect(Math.hypot(b.x - s.p.x, b.y - (s.p.y - BODY_UP))).toBeLessThan(d0 - 15);
    const t = boss(90, 'heukryong', 100);
    t.b.hp = Math.floor(t.b.max * 0.49);
    t.s.p.inv = 999;
    steps(t.s, 2);
    t.b.mt = 0;
    t.b.state = 'move';
    t.b.cd = 9;
    steps(t.s, 1);
    expect(t.s.projs.filter((q) => q.from === 'e').length).toBe(13);
  });
});

describe('마지막 보스: 어둑시니 (100층)', () => {
  it('1단계 → 2단계(샛바람) → 3단계(커져서 맞지 않음, 소원 등불 넷) — 등불을 한꺼번에 밝히면 작아져 맞고, 시간이 지나면 다시 커진다', () => {
    const { s, b } = boss(100, 'eodugsini', 80);
    expect(b.def.size).toBe(48);
    s.p.inv = 999;
    b.hp = Math.floor(b.max * 0.65);
    steps(s, 2);
    expect(b.phase).toBe(2);
    expect(s.wind).not.toBeNull();
    b.hp = Math.floor(b.max * 0.32);
    steps(s, 2);
    expect(b.phase).toBe(3);
    expect(b.guard).toBe('dark');
    expect(s.wind).toBeNull();
    expect(s.vortex).not.toBeNull();
    const lights = s.enemies.filter((e) => e.def.id === 'wishlight');
    expect(lights).toHaveLength(4);
    expect(hittableNow(s, b)).toBe(false);
    for (const l of lights) {
      s.p.inv = 999;
      slashAt(s, l, 8);
    }
    expect(b.guard).toBeNull();
    expect(b.state).toBe('stun');
    expect(s.vortex).toBeNull();
    expect(hittableNow(s, b)).toBe(true);
    // 작아진 동안(멍 3.5초 + 9초)이 지나면 다시 커진다
    s.p.inv = 999;
    b.wake = 0;
    expect(until(s, () => b.guard === 'dark', 15)).toBe(true);
    expect(lights.every((l) => l.lit <= 0)).toBe(true);
  });

  it('1단계는 앞 보스들의 기술 (돌진 · 고드름 비 · 땅파기 · 쇠가시)', () => {
    const seen = new Set<string>();
    const { s, b } = boss(100, 'eodugsini', 80);
    s.p.inv = 999;
    for (let i = 0; i < 60 * 60 && seen.size < 4; i++) {
      // 캐릭터는 멀찍이 (붙어 있으면 보스는 주먹만 쓴다)
      s.p.x = b.x - 70;
      s.p.y = b.y + BODY_UP;
      step(s, noInput());
      if (b.state === 'skillWind' || b.state === 'skillRun') seen.add(b.move);
      b.hp = b.max;
    }
    expect([...seen].sort()).toEqual(['burrow', 'charge', 'icicles', 'spikes']);
  });
});

describe('6~10구역 퍼즐', () => {
  const row = (y: number, rows: Record<number, string>) => rows[y] ?? '...................';
  const grid = (rows: Record<number, string>) => Array.from({ length: 13 }, (_, y) => row(y, rows));
  const at = (s: RunState, tx: number, ty: number, face: number) => {
    s.p.x = tx * TILE + 8;
    s.p.y = ty * TILE + 11;
    s.p.face = face;
  };

  it('뇌석: 말 구슬 연쇄 번개가 셋을 한 사슬로 이으면 철문이 열리고, 하나씩 빛낸 뇌석은 1초 뒤 꺼진다', () => {
    const g = grid({ 0: '.........g.........', 4: '...l..l............', 6: '....l..............' });
    const s = arena({ floor: 53, orb: 'horse', grid: g });
    s.locked.clear();
    at(s, 6, 9, 3);
    press(s, 'skill', 5);
    expect(tileOf(s, 10, 1)).toBe(T.FLOOR);
    expect(s.data.orbs.horse).toBe(1);
    // 청룡 회오리로 하나만: 잠깐 빛나고 꺼진다
    const r = arena({ floor: 95, orb: 'blueDragon', grid: g });
    r.locked.clear();
    at(r, 2, 5, 2);
    press(r, 'skill', 30);
    expect(tileOf(r, 4, 5)).toBe(T.ROD_ON);
    wait(r, 1.5);
    expect(tileOf(r, 4, 5)).toBe(T.ROD);
    expect(tileOf(r, 10, 1)).toBe(T.GATE);
  });

  it('구름 덩이: 돼지 바람 칼날로 물 건너에서 밀면 미끄러져 구덩이를 메운다 (쥐 참격으로는 안 밀린다)', () => {
    const g = grid({ 2: '.........x.........', 3: '.........o.........', 4: '.........~.........', 5: '.........~.........' });
    const s = arena({ floor: 63, orb: 'pig', grid: g });
    s.locked.clear();
    at(s, 10, 8, 3);
    press(s, 'skill', 40);
    expect(tileOf(s, 10, 3)).toBe(T.RUBBLE);
    expect(tileOf(s, 10, 4)).toBe(T.FLOOR);
    const r = arena({ floor: 63, orb: 'rat', grid: g });
    r.locked.clear();
    at(r, 10, 8, 3);
    press(r, 'skill', 40);
    expect(tileOf(r, 10, 4)).toBe(T.PUFF);
    expect(tileOf(r, 10, 3)).toBe(T.PIT);
  });

  it('쇠창살: 백호 금강 베기로 자른다 (칼로는 안 잘린다)', () => {
    const g = grid({ 6: '..........z........' });
    const s = arena({ floor: 74, orb: 'whiteTiger', grid: g });
    s.locked.clear();
    at(s, 10, 7, 2);
    press(s, 'skill', 30);
    expect(tileOf(s, 11, 7)).toBe(T.FLOOR);
    const r = arena({ floor: 74, orb: 'rat', grid: g });
    r.locked.clear();
    at(r, 10, 7, 2);
    steps(r, 40, { ...noInput(), attack: true });
    expect(tileOf(r, 11, 7)).toBe(T.BARS);
  });

  it('거울: 쥐 참격이 거울에서 꺾여 숨은 스위치를 맞히면 철문이 열린다', () => {
    const g = grid({ 0: '.........g.........', 3: '.../....w..........' });
    const s = arena({ floor: 84, orb: 'rat', grid: g });
    s.locked.clear();
    at(s, 4, 9, 3);
    press(s, 'skill', 60);
    expect(tileOf(s, 9, 4)).toBe(T.SWITCH_ON);
    expect(tileOf(s, 10, 1)).toBe(T.FLOOR);
    // 역빗금 거울: 오른쪽으로 가던 것이 아래로
    const g2 = grid({ 0: '.........g.........', 2: '......' + '\\' + '............', 7: '......w............' });
    const r = arena({ floor: 84, orb: 'rat', grid: g2 });
    r.locked.clear();
    at(r, 2, 3, 2);
    press(r, 'skill', 60);
    expect(tileOf(r, 7, 8)).toBe(T.SWITCH_ON);
  });

  it('짙은 구름: 청룡 번개 회오리가 지나가면 걷힌다 (쥐 참격으로는 안 걷힌다)', () => {
    const g = grid({ 6: '...........mmm.....' });
    const s = arena({ floor: 94, orb: 'blueDragon', grid: g });
    s.locked.clear();
    at(s, 10, 7, 2);
    press(s, 'skill', 90);
    for (let x = 12; x <= 14; x++) expect(tileOf(s, x, 7)).toBe(T.FLOOR);
    const r = arena({ floor: 94, orb: 'rat', grid: g });
    r.locked.clear();
    at(r, 10, 7, 2);
    press(r, 'skill', 60);
    expect(tileOf(r, 12, 7)).toBe(T.FOG);
  });
});

/** 보스를 쓰러뜨린다 (단계 기술을 넘긴 상태로) */
const killBoss = (s: RunState) => {
  const b = s.enemies.find((e) => e.def.boss)!;
  s.p.x = b.x - 18;
  s.p.y = b.y + BODY_UP;
  s.p.face = 2;
  steps(s, 2);
  expect(s.locked.size).toBe(1);
  b.phase = 3;
  b.rage = true;
  b.mt = 99;
  b.guard = null;
  b.hp = 1;
  for (let i = 0; i < 160 && b.alive; i++) {
    b.guard = null;
    b.hidden = false;
    s.p.x = b.x - 18;
    s.p.y = b.y + BODY_UP;
    s.p.face = 2;
    step(s, { ...noInput(), attack: true });
  }
  expect(b.alive).toBe(false);
};

describe('보스층 전설 구슬 (백호 70층 · 청룡 90층)', () => {
  for (const [floor, orb] of [[70, 'whiteTiger'], [90, 'blueDragon']] as const) {
    it(`${floor}층: 보스를 쓰러뜨리면 받침대가 솟고, ${orb} 구슬을 받아야 층을 깬다 · 체크포인트 ${floor + 1}`, () => {
      const d = { ...newData(9), level: floor, best: floor - 1, checkpoint: floor - 9, floor };
      const s = createRun(generateFloor(d.seed, floor), d, { god: true });
      const ped = s.map.objs.find((o) => o.kind === 'pedestal')!;
      expect(ped.hidden).toBe(true);
      killBoss(s);
      expect(tileOf(s, ped.x, ped.y)).toBe(T.PEDESTAL);
      expect(s.legendWait).toBe(true);
      wait(s, 4);
      expect(s.over).toBeNull();
      s.p.x = ped.x * TILE + 8;
      s.p.y = (ped.y + 1) * TILE + 10;
      expect(interactTarget(s)?.kind).toBe('pedestal');
      step(s, { ...noInput(), interact: true });
      expect(s.events.find((e) => e.t === 'orb')).toMatchObject({ t: 'orb', id: orb, gain: 'new' });
      wait(s, 3);
      expect(s.over).toBe('clear');
      clearFloor(s.data, floor);
      expect(s.data.checkpoint).toBe(floor + 1);
    });
  }
});

describe('100층: 소원 구슬 · 엔딩 · 다 오른 뒤의 저장', () => {
  it('어둑시니를 쓰러뜨리면 소원 구슬이 솟고, 소원을 빌어야 탑을 다 오른다 — 저장은 104 의 확인을 지킨다', () => {
    const d = { ...newData(9), level: 97, best: 99, checkpoint: 91, floor: 100 };
    const s = createRun(generateFloor(d.seed, 100), d, { god: true });
    const wish = s.map.objs.find((o) => o.kind === 'wish')!;
    expect(wish.hidden).toBe(true);
    expect(tileOf(s, wish.x, wish.y)).toBe(T.FLOOR);
    killBoss(s);
    const evs = s.events.splice(0).map((e) => e.t);
    expect(evs).toContain('wishRise');
    expect(tileOf(s, wish.x, wish.y)).toBe(T.WISH);
    wait(s, 5);
    expect(s.over).toBeNull();
    // 계단은 나타나지 않는다 (101층이 없다)
    expect(s.stairsShown).toBe(false);
    s.p.x = wish.x * TILE + 8;
    s.p.y = (wish.y + 1) * TILE + 10;
    expect(interactTarget(s)?.kind).toBe('wish');
    step(s, { ...noInput(), interact: true });
    expect(s.events.some((e) => e.t === 'wish')).toBe(true);
    wait(s, 4);
    expect(s.over).toBe('clear');
    // 저장: 층 100 · 최고 100 · 체크포인트 91 (101 은 없다)
    const out = s.data;
    expect(clearFloor(out, 100)).toBe(100);
    expect(out).toMatchObject({ best: 100, floor: 100, checkpoint: 91 });
    expect(checkSave(out, 100, 99)).toBeNull();
    expect(towerDone(out)).toBe(true);
    // 다시 깨도 (best 100) 저장은 그대로 된다
    expect(checkSave(out, 100, 100)).toBeNull();
    // 읽어 들여도 그대로
    expect(normalize(JSON.parse(JSON.stringify(out)))).toMatchObject({ best: 100, floor: 100, checkpoint: 91 });
    // 다 오른 뒤: 아무 체크포인트에서나 다시 오른다 (1·11·…·91)
    for (const cp of [1, 41, 91]) {
      const c = JSON.parse(JSON.stringify(out));
      expect(climbAgain(c, cp)).toBeNull();
      expect(checkSave(c, null, 100)).toBeNull();
      expect(c).toMatchObject({ floor: cp, checkpoint: cp, best: 100 });
    }
    expect(climbAgain(JSON.parse(JSON.stringify(out)), 101)).not.toBeNull();
    expect(climbAgain(JSON.parse(JSON.stringify(out)), 50)).not.toBeNull();
    // 아직 다 오르지 않았으면 고를 수 없다
    expect(climbAgain({ ...newData(1), best: 60 }, 41)).not.toBeNull();
  });

  it('부활 부적은 마지막 보스전(100층)에서 타오르지 않는다', () => {
    const d = { ...newData(9), level: 97, best: 99, checkpoint: 91, floor: 100 };
    d.items.revive = 1;
    const s = createRun(generateFloor(d.seed, 100), d);
    s.p.hp = 1;
    s.p.inv = 0;
    const b = s.enemies.find((e) => e.def.boss)!;
    s.p.x = b.x - 30;
    s.p.y = b.y + BODY_UP;
    steps(s, 2);
    for (let i = 0; i < 60 * 20 && !s.over; i++) step(s, noInput());
    expect(s.over).toBe('dead');
    expect(s.data.items.revive).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { zoneData } from '../src/data';
import { T, generateFloor } from '../src/game/floorgen';
import { addExp, awakenWithShards, buy, clearFloor, die, gainOrb, newData, normalize } from '../src/game/progress';
import { createRun, hitsToKill, interactTarget, maxHp, noInput, step, tileOf, useItem, type RunState } from '../src/game/sim';
import { arena, foe, wait } from './arena';

const run = (floor: number, patch: Partial<ReturnType<typeof newData>> = {}, god = false) => {
  const d = { ...newData(42), level: floor, ...patch };
  return createRun(generateFloor(d.seed, floor), d, { god });
};
const steps = (s: RunState, n: number, inp = noInput()) => {
  for (let i = 0; i < n; i++) step(s, inp);
};

describe('규칙', () => {
  it('일반 적은 그 층 레벨 캐릭터의 기본 공격 3~5번에 쓰러진다 (1~50층)', () => {
    for (let f = 1; f <= 50; f++) for (const id of zoneData(f)!.enemies) {
      const n = hitsToKill(id, f);
      expect(n, `${id} ${f}층`).toBeGreaterThanOrEqual(3);
      expect(n, `${id} ${f}층`).toBeLessThanOrEqual(5);
    }
  });

  it('구슬: 처음은 장착, 두 번째는 각성, 그 뒤는 조각. 조각 5개로 각성', () => {
    const d = newData(1);
    expect(gainOrb(d, 'rat')).toBe('new');
    expect(d.equipped).toBe('rat');
    expect(gainOrb(d, 'rat')).toBe('awaken');
    expect(gainOrb(d, 'rat')).toBe('shard');
    expect(d.shards).toBe(1);
    gainOrb(d, 'ox');
    expect(d.equipped).toBe('rat');
    expect(awakenWithShards(d, 'ox')).toMatch(/조각/);
    d.shards = 5;
    expect(awakenWithShards(d, 'ox')).toBeNull();
    expect(d.awakened).toEqual(['rat', 'ox']);
    expect(d.shards).toBe(0);
  });

  it('상점: 휴식층에서만, 조각은 휴식층마다 1개, 부활 부적 1개만', () => {
    const d = { ...newData(1), coins: 5000 };
    expect(buy(d, 'potionL', 4)).toMatch(/휴식층/);
    expect(buy(d, 'shard', 5)).toBeNull();
    expect(buy(d, 'shard', 5)).toMatch(/1개/);
    expect(buy(d, 'revive', 5)).toBeNull();
    expect(buy(d, 'revive', 5)).toMatch(/1개/);
    expect(buy(d, 'potionL', 15)).toBeNull();
    expect(d.coins).toBe(5000 - 300 - 500 - 90);
    d.coins = 10;
    expect(buy(d, 'potionL', 5)).toMatch(/모자라/);
  });

  it('층 깨기·체크포인트·죽음', () => {
    const d = newData(1);
    for (let f = 1; f <= 9; f++) clearFloor(d, f);
    expect(d.checkpoint).toBe(1);
    expect(d.floor).toBe(10);
    clearFloor(d, 10);
    expect(d).toMatchObject({ best: 10, floor: 11, checkpoint: 11 });
    d.floor = 14;
    die(d);
    expect(d.floor).toBe(11);
    expect(d.deaths).toBe(1);
  });

  it('레벨은 99까지, normalize 는 어긋난 값을 바로잡는다', () => {
    const d = newData(1);
    addExp(d, 1e9);
    expect(d.level).toBe(99);
    const n = normalize({ level: 5, best: 3, checkpoint: 11, floor: 9, orbs: { rat: 1, nope: 2 }, equipped: 'ox', items: { potionS: -3, revive: 4 } });
    expect(n).toMatchObject({ level: 5, best: 3, checkpoint: 1, floor: 4, orbs: { rat: 1 }, equipped: null });
    expect(n.items.potionS).toBe(0);
    expect(n.items.revive).toBe(1);
    expect(normalize({}).level).toBe(1);
    // 관리자 처음 상태: 서버가 coins 만 넣어 둔 {} → 새 진행 + 엽전 1만 (105)
    expect(normalize({ coins: 10000 })).toMatchObject({ level: 1, floor: 1, coins: 10000 });
  });

  it('전투방에 들어가면 문이 잠기고 다 잡으면 열린다', () => {
    const s = run(1, {}, true);
    const room = s.map.rooms.find((r) => r.kind === 'combat')!;
    s.p.x = (room.x0 + 10) * 16 + 8;
    s.p.y = (room.y0 + 7) * 16 + 10;
    steps(s, 2);
    expect(s.locked.has(room.id)).toBe(true);
    expect(s.events.some((e) => e.t === 'lock')).toBe(true);
    for (const e of s.enemies) if (e.room === room.id) e.hp = 0, (e.alive = false);
    steps(s, 2);
    expect(s.locked.size).toBe(0);
    expect(s.cleared.has(room.id)).toBe(true);
  });

  it('칼 3타 콤보: 누르고 있으면 1→2→3타', () => {
    const s = run(1);
    const inp = { ...noInput(), attack: true };
    const combos: number[] = [];
    for (let i = 0; i < 70; i++) {
      step(s, inp);
      for (const e of s.events.splice(0)) if (e.t === 'swing') combos.push(e.combo);
    }
    expect(combos.slice(0, 4)).toEqual([1, 2, 3, 1]);
  });

  it('쓰러지면 dead, 부활 부적이 있으면 체력 50%로 일어선다', () => {
    const s = run(1);
    s.data.items.revive = 1;
    const e = s.enemies.find((x) => x.def.id !== 'spitter')!;
    e.active = true;
    s.p.hp = 1;
    s.p.x = e.x;
    s.p.y = e.y + 7;
    e.cd = 0;
    steps(s, 30);
    expect(s.events.some((x) => x.t === 'revive')).toBe(true);
    expect(s.p.hp).toBeGreaterThan(40);
    expect(s.over).toBeNull();
  });

  it('이미 깬 층은 경험치 절반', () => {
    const a = run(3);
    const b = run(3, { best: 5 });
    expect(a.replay).toBe(false);
    expect(b.replay).toBe(true);
    for (const s of [a, b]) {
      const e = s.enemies[0];
      e.active = true;
      e.hp = 1;
      s.p.x = e.x;
      s.p.y = e.y + 7 + 10;
      s.p.face = 3;
    }
    const exp = (s: RunState) => {
      for (let i = 0; i < 40; i++) {
        step(s, { ...noInput(), attack: true });
        const k = s.events.find((x) => x.t === 'kill');
        if (k && k.t === 'kill') return k.exp;
      }
      return -1;
    };
    const ea = exp(a);
    expect(ea).toBeGreaterThan(0);
    expect(exp(b)).toBe(Math.round(ea / 2));
  });

  it('소지품: 가득하면 못 쓰고, 지도 두루마리는 다음 층을 밝힌다', () => {
    const s = run(4);
    expect(useItem(s, 'potionS')).toMatch(/가득/);
    s.p.hp = 10;
    expect(useItem(s, 'potionS')).toBeNull();
    s.data.items.map = 1;
    expect(useItem(s, 'map')).toBeNull();
    expect(s.data.mapped).toEqual([5]);
  });

  it('2층 구슬 받침대: 처음 오를 때만 구슬이 있다', () => {
    const s = run(2);
    const o = s.map.objs.find((x) => x.kind === 'pedestal')!;
    expect(s.tiles[o.y * s.map.w + o.x]).toBe(T.PEDESTAL);
    const again = run(2, { best: 3, orbs: { rat: 1 } });
    expect(again.tiles[o.y * again.map.w + o.x]).toBe(T.PEDESTAL_EMPTY);
    s.p.x = o.x * 16 + 8;
    s.p.y = (o.y + 1) * 16 + 10;
    expect(interactTarget(s)?.kind).toBe('pedestal');
    step(s, { ...noInput(), interact: true });
    expect(s.data.orbs.rat).toBe(1);
  });
});

describe('검사 반영: 같은 층에서 쓰러져도 첫 보상을 다시 받지 않는다', () => {
  it('이미 가진 구슬의 받침대는 비어 있다 (2층에서 줍고 쓰러진 뒤)', () => {
    const d = newData(7);
    d.orbs.rat = 1;
    d.best = 1;
    const map = generateFloor(d.seed, 2);
    const run = createRun(map, d);
    const ped = map.objs.find((o) => o.kind === 'pedestal' && o.orb === 'rat')!;
    expect(ped).toBeTruthy();
    expect(run.tiles[ped.y * map.w + ped.x]).toBe(T.PEDESTAL_EMPTY);
  });
  it('첫 조각 기록(got)은 저장 모양을 지나도 남는다', () => {
    const d = newData(7);
    d.got.push('3:chest', '10:boss');
    expect(normalize(JSON.parse(JSON.stringify(d))).got).toEqual(['3:chest', '10:boss']);
    expect(normalize({ ...d, got: ['x', '3:chest'] }).got).toEqual(['3:chest']);
  });
});

describe('2차: 무리 · 퍼즐 · 2구역 적 · 싸움 밖 회복', () => {
  it('전투방은 한 무리를 다 잡으면 잠깐 뒤 다음 무리가 나오고, 마지막 무리까지 잡아야 문이 열린다', () => {
    const s = run(3, {}, true);
    const room = s.map.rooms.find((r) => r.kind === 'combat')!;
    const waves = Math.max(...room.spawns.map((x) => x.wave)) + 1;
    expect(waves).toBeGreaterThanOrEqual(2);
    s.p.x = (room.x0 + 10) * 16 + 8;
    s.p.y = (room.y0 + 7) * 16 + 10;
    steps(s, 2);
    expect(s.locked.has(room.id)).toBe(true);
    const mine = () => s.enemies.filter((e) => e.room === room.id);
    expect(mine().filter((e) => e.active).every((e) => e.wave === 0)).toBe(true);
    let seen = 0;
    for (let w = 0; w < waves; w++) {
      for (const e of mine()) if (e.wave === w) (e.hp = 0), (e.alive = false);
      steps(s, 80);
      seen += s.events.splice(0).filter((e) => e.t === 'wave').length;
      if (w < waves - 1) {
        expect(s.locked.has(room.id), `무리 ${w + 1}`).toBe(true);
        expect(mine().some((e) => e.alive && e.active && e.wave === w + 1)).toBe(true);
      }
    }
    expect(seen).toBe(waves - 1);
    expect(s.locked.has(room.id)).toBe(false);
  });

  it('발판: 시간 안에 모두 밟으면 철문이 열리고, 늦으면 다시 올라온다', () => {
    const grid = Array.from({ length: 13 }, (_, y) => (y === 0 ? 'g..................' : y === 6 ? '..q.............q..' : '...................'));
    const s = arena({ grid });
    s.locked.clear();
    const goTo = (tx: number, ty: number) => {
      s.p.x = tx * 16 + 8;
      s.p.y = ty * 16 + 10;
      step(s, noInput());
    };
    goTo(3, 7);
    expect(tileOf(s, 3, 7)).toBe(T.PLATE_ON);
    // 늦으면 (3 + 2.5×2 = 8초) 다시 올라온다
    goTo(10, 7);
    for (let i = 0; i < 60 * 9; i++) step(s, noInput());
    expect(tileOf(s, 3, 7)).toBe(T.PLATE);
    goTo(3, 7);
    goTo(17, 7);
    expect(tileOf(s, 1, 1)).toBe(T.FLOOR);
    expect(s.solved.has(0)).toBe(true);
  });

  it('싸움 밖(잠긴 방이 없을 때)에서는 체력·혼력이 천천히 회복된다', () => {
    const s = arena();
    s.locked.clear();
    s.p.hp = 10;
    s.p.mp = 0;
    wait(s, 4);
    expect(s.p.hp).toBeGreaterThan(10 + maxHp(s) * 0.08);
    expect(s.p.mp).toBeGreaterThan(0);
    const t = arena();
    foe(t, 'lizard', 120);
    t.p.hp = 10;
    wait(t, 2);
    expect(t.p.hp).toBe(10);
  });

  it('바위 두꺼비: 예고한 자리로 뛰어올라 내려찍는다', () => {
    const s = arena({ floor: 13 });
    const e = foe(s, 'toad', 50, 0, false);
    e.cd = 0;
    steps(s, 2);
    expect(e.state).toBe('hopWind');
    expect(e.tele?.kind).toBe('circle');
    const hp = s.p.hp;
    for (let i = 0; i < 90 && s.p.hp === hp; i++) step(s, noInput());
    expect(s.p.hp).toBeLessThan(hp);
    expect(Math.abs(e.x - s.p.x)).toBeLessThan(20);
  });

  it('가시 덩굴싹은 부채꼴 3발, 고목 수호자는 둘레로 가시를 쏜다', () => {
    const s = arena({ floor: 12 });
    const sp = foe(s, 'sprout', 60, 0, false);
    sp.cd = 0;
    steps(s, 60);
    expect(s.projs.filter((q) => q.from === 'e' && q.kind === 'thorn').length).toBe(3);
    const t = arena({ floor: 19 });
    const tr = foe(t, 'treant', 90, 0, false);
    tr.ringCd = 0;
    steps(t, 70);
    expect(t.projs.filter((q) => q.from === 'e').length).toBeGreaterThanOrEqual(8);
  });

  it('이끼 이무기: 땅속에서는 맞지 않고 발밑에서 솟구친다 · 성나면 이끼 나방 둘을 부른다 (경험치·엽전 없음)', () => {
    const s = arena({ floor: 20, level: 20 });
    const b = foe(s, 'imugi', 70, 0, false);
    s.boss = b;
    b.cd = 0;
    b.pattern = 3; // 다음 기술 = 땅파기
    steps(s, 2);
    expect(b.state).toBe('burrow');
    expect(b.hidden).toBe(true);
    const hp = b.hp;
    s.p.face = 2;
    s.p.x = b.x - 18;
    steps(s, 20, { ...noInput(), attack: true });
    expect(b.hp).toBe(hp);
    for (let i = 0; i < 200 && b.state !== 'burrowWind'; i++) step(s, noInput());
    expect(b.tele?.kind).toBe('circle');
    for (let i = 0; i < 120 && b.hidden; i++) step(s, noInput());
    expect(b.hidden).toBe(false);
    // 성나면 나방 둘
    b.hp = Math.floor(b.max * 0.49);
    b.state = 'move';
    steps(s, 2);
    const moths = s.enemies.filter((e) => e.def.id === 'moth' && e.summoned);
    expect(moths).toHaveLength(2);
    const coins = s.data.coins;
    for (const m of moths) m.hp = 1;
    moths[0].wake = 0;
    s.p.x = moths[0].x - 14;
    s.p.y = moths[0].y + 7;
    s.p.face = 2;
    steps(s, 30, { ...noInput(), attack: true });
    expect(s.data.coins).toBe(coins);
  });
});

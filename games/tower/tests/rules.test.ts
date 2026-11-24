import { describe, expect, it } from 'vitest';
import { zoneData } from '../src/data';
import { T, generateFloor } from '../src/game/floorgen';
import { addExp, awakenWithShards, buy, clearFloor, die, gainOrb, newData, normalize } from '../src/game/progress';
import { createRun, hitsToKill, interactTarget, noInput, step, useItem, type RunState } from '../src/game/sim';

const run = (floor: number, patch: Partial<ReturnType<typeof newData>> = {}, god = false) => {
  const d = { ...newData(42), level: floor, ...patch };
  return createRun(generateFloor(d.seed, floor), d, { god });
};
const steps = (s: RunState, n: number, inp = noInput()) => {
  for (let i = 0; i < n; i++) step(s, inp);
};

describe('규칙', () => {
  it('일반 적은 그 층 레벨 캐릭터의 기본 공격 3~5번에 쓰러진다 (1~10층)', () => {
    for (let f = 1; f <= 10; f++) for (const id of zoneData(1)!.enemies) {
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
  });

  it('전투방에 들어가면 문이 잠기고 다 잡으면 열린다', () => {
    const s = run(1, {}, true);
    const room = s.map.rooms.find((r) => r.kind === 'combat')!;
    s.p.x = (room.x0 + 8) * 16 + 8;
    s.p.y = (room.y0 + 6) * 16 + 10;
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

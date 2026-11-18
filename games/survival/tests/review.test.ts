import { describe, expect, it } from 'vitest';
import { LIMIT, PLAYER } from '../src/data/balance';
import { BOSS_INDEX } from '../src/data/bosses';
import { ITEM } from '../src/data/items';
import { MAPS, MAP_INDEX } from '../src/data/maps';
import { addProjectile, dropPickup, emit, hurtEnemy, spawnBoss } from '../src/game/core';
import { makeInput, step } from '../src/game/sim';
import { EV, MODE, PROJ, type State } from '../src/game/state';
import { blocked, cellObstacles } from '../src/game/terrain';
import { advance, disarm, emptyRun, live, move, put } from './helpers';

/** 코드 검토에서 나온 문제들이 다시 생기지 않게 */

const count = (s: State, kind: number) => live(s.pickups).filter((p) => !p.dead && p.kind === kind).length;
const gemXp = (s: State) => live(s.pickups).filter((p) => !p.dead && p.kind <= ITEM.gemL).reduce((a, p) => a + p.value, 0);

describe('바닥 아이템 풀이 가득 찼을 때', () => {
  /** 바닥을 작은 구슬로 가득 채운다 (내게서 멀리, 줍지 못하는 곳에) */
  const fill = (s: State) => {
    for (let i = 0; i < LIMIT.pickups; i++) dropPickup(s, ITEM.gemS, 2000 + i * 10, 500, 1);
    expect(s.pickups.n).toBe(LIMIT.pickups);
  };

  it('보스를 잡으면 보물상자가 반드시 나온다 (가장 먼 구슬을 옆 구슬에 합쳐 자리를 만든다)', () => {
    const s = disarm(emptyRun());
    fill(s);
    const boss = spawnBoss(s, BOSS_INDEX[MAPS[MAP_INDEX.field].bosses[0].id], 300, 0)!;
    const xp = boss.xp;
    hurtEnemy(s, boss, 1e9, -1);
    expect(boss.dead).toBe(true);
    expect(count(s, ITEM.chest)).toBe(1);
    const chest = live(s.pickups).find((p) => p.kind === ITEM.chest)!;
    expect([chest.x, chest.y]).toEqual([300, 0]);
    expect(s.pickups.n).toBe(LIMIT.pickups);
    // 경험치는 사라지지 않는다: 원래 구슬 400 + 보스의 큰 구슬
    expect(gemXp(s)).toBe(LIMIT.pickups + xp);
    // 자리를 내준 것은 가장 먼 구슬이고, 그 값은 바로 옆 구슬에 합쳐졌다
    const far = live(s.pickups).filter((p) => p.kind <= ITEM.gemL).sort((a, b) => b.x - a.x)[0];
    expect(far.x).toBe(2000 + (LIMIT.pickups - 2) * 10);
    expect(far.value).toBeGreaterThanOrEqual(2);
    // 상자를 주울 수 있다
    s.player.x = 300;
    let got = false;
    advance(s, 0.2, { immortal: true, each: (st) => (got ||= live({ items: st.events, n: st.evN }).some((e) => e.t === EV.pick && e.a === ITEM.chest)) });
    expect(got).toBe(true);
  });

  it('떡·복주머니·부적도 놓이고, 구슬·엽전은 예전처럼 같은 종류에 합쳐진다', () => {
    const s = disarm(emptyRun());
    fill(s);
    for (const kind of [ITEM.cake, ITEM.pouch, ITEM.talisman]) {
      const p = dropPickup(s, kind, 700, 700, 1);
      expect(p?.kind).toBe(kind);
      expect(p?.magnet).toBe(false);
    }
    expect(s.pickups.n).toBe(LIMIT.pickups);
    expect(gemXp(s)).toBe(LIMIT.pickups);
    dropPickup(s, ITEM.gemS, 0, 900, 3);
    expect(gemXp(s)).toBe(LIMIT.pickups + 3);
    // 엽전은 놓인 엽전이 없으면 예전처럼 놓이지 않는다 (값이 작은 것은 자리를 뺏지 않는다)
    expect(dropPickup(s, ITEM.coin, 0, 900, 1)).toBeNull();
    expect(s.pickups.n).toBe(LIMIT.pickups);
  });
});

describe('관통 투사체', () => {
  it('적이 9마리 넘게 겹쳐 있어도 같은 투사체는 같은 적을 한 번만 때린다', () => {
    const s = disarm(emptyRun());
    const foes = Array.from({ length: 14 }, (_, i) => put(s, 'imp', 200 + (i % 2), (i % 7) - 3));
    for (const e of foes) {
      e.maxHp = e.hp = 1000;
      e.speed = 0;
    }
    // 느리고 큰 관통 투사체가 무리 전체를 여러 걸음 동안 덮고 지나간다 (요괴들은 서로 밀려 흩어지므로 크게 잡는다)
    const pr = addProjectile(s, PROJ.shurikenEvo, MODE.line, 0, -1, 150, 0, 60, 0, 160, 10, 1)!;
    pr.pierce = 99;
    const input = makeInput();
    for (let i = 0; i < 80; i++) {
      s.player.inv = 5;
      step(s, input);
    }
    expect(pr.dead).toBe(true);
    // 14마리 모두 정확히 한 번씩 맞았다 (예전에는 기억 칸 8개를 돌려 써서 걸음마다 다시 맞았다)
    for (const e of foes) expect(1000 - e.hp).toBeCloseTo(10, 6);
  });
});

describe('한 걸음의 알림이 가득 찼을 때', () => {
  it('레벨업·게임 오버·클리어 알림은 빠지지 않는다', () => {
    const s = disarm(emptyRun());
    const cap = s.events.length;
    for (let i = 0; i < cap + 10; i++) emit(s, EV.fire, i);
    expect(s.evN).toBe(cap);
    emit(s, EV.levelup, 7);
    emit(s, EV.hurt, 1);
    emit(s, EV.over);
    const ev = live({ items: s.events, n: s.evN });
    expect(ev.length).toBe(cap);
    expect(ev.filter((e) => e.t === EV.levelup).map((e) => e.a)).toEqual([7]);
    expect(ev.filter((e) => e.t === EV.over).length).toBe(1);
    expect(ev.some((e) => e.t === EV.hurt)).toBe(false);
  });

  it('알림이 넘치는 걸음에서 죽어도 게임 오버 알림이 온다', () => {
    const s = disarm(emptyRun());
    s.player.hp = 0;
    const input = makeInput();
    // 걸음 도중에 알림 칸이 가득 찬 상황을 만든다: 걸음이 시작되면 칸이 비므로, 첫 알림이 나기 전에 채워 둘 수는 없다.
    // 대신 한 걸음 뒤 상태(over)에서 칸을 가득 채우고 같은 알림을 다시 내 본다
    step(s, input);
    expect(s.phase).toBe('over');
    s.evN = 0;
    for (let i = 0; i < s.events.length; i++) emit(s, EV.pick, 0);
    emit(s, EV.over);
    expect(s.events[s.evN - 1].t).toBe(EV.over);
  });
});

describe('궁궐 담을 따라 미끄러지기', () => {
  /** 원 네 개가 온전히 이어진 가로 담 하나: 왼쪽 끝 원의 자리 */
  function wall(s: State) {
    const t = s.map.terrain;
    const buf = new Float32Array(12);
    for (let cx = 2; cx < 40; cx++) {
      for (let cy = 2; cy < 40; cy++) {
        if (cellObstacles(t, s.terrainSeed, cx, cy, buf) === 4 && buf[1] === buf[4]) return { x: buf[0], y: buf[1], gap: buf[3] - buf[0], r: buf[2] };
      }
    }
    throw new Error('가로 담이 없다');
  }

  it('담에 가파르게(60°~80°) 밀어도 원 사이 틈에 걸리지 않고 담을 따라 나아간다', () => {
    for (const deg of [60, 70, 80]) {
      for (const dir of [1, -1]) {
        const s = disarm(emptyRun({ map: 'palace', seed: 3 }));
        const w = wall(s);
        // 담의 한쪽 끝 위에서 출발해 담 쪽으로 비스듬히 민다
        const x0 = dir > 0 ? w.x + 4 : w.x + w.gap * 3 - 4;
        s.player.x = x0;
        s.player.y = w.y - w.r - PLAYER.r - 6;
        const a = (deg * Math.PI) / 180;
        const sec = 1.5;
        let inside = false;
        advance(s, sec, {
          input: move(dir * Math.cos(a), Math.sin(a)),
          each: () => {
            if (blocked(s.map.terrain, s.terrainSeed, s.player.x, s.player.y, PLAYER.r - 0.5)) inside = true;
          },
        });
        expect(inside).toBe(false);
        // 담과 나란한 쪽의 빠르기를 거의 그대로 낸다 (틈에 걸리면 한 칸(51px)도 못 간다)
        const want = Math.min(s.stats.speed * Math.cos(a) * sec, w.gap * 3 - 8);
        expect((s.player.x - x0) * dir).toBeGreaterThan(want * 0.85);
        // 담을 뚫지 않았다
        expect(s.player.y).toBeLessThan(w.y);
      }
    }
  });

  it('담에 똑바로 밀면 그 자리에 선다', () => {
    const s = disarm(emptyRun({ map: 'palace', seed: 3 }));
    const w = wall(s);
    s.player.x = w.x + w.gap * 1.5;
    s.player.y = w.y - 120;
    advance(s, 2, { input: move(0, 1) });
    expect(s.player.x).toBeCloseTo(w.x + w.gap * 1.5, 3);
    expect(s.player.y).toBeCloseTo(w.y - w.r - PLAYER.r, 3);
  });
});

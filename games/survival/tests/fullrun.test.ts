import { describe, expect, it } from 'vitest';
import { BOSS_WARN_SEC, LIMIT, RUN_SEC } from '../src/data/balance';
import { BOSSES, BOSS_INDEX } from '../src/data/bosses';
import { ENEMIES, ENEMY_INDEX } from '../src/data/enemies';
import { ITEM, ITEMS } from '../src/data/items';
import { MAPS } from '../src/data/maps';
import { PASSIVE_INDEX } from '../src/data/passives';
import { presetUpgrades } from '../src/data/upgrades';
import { WEAPON_INDEX } from '../src/data/weapons';
import { PATTERNS } from '../src/game/bosses';
import { dropPickup, hurtEnemy, killEnemy, spawnBoss } from '../src/game/core';
import { MOVES } from '../src/game/enemies';
import { addPassive, addWeapon } from '../src/game/levelup';
import { activeBoss, createRun, makeInput, step, summarize } from '../src/game/sim';
import { EV, MODE, type State } from '../src/game/state';
import { advance, disarm, emptyRun, live, put } from './helpers';

const FIELD = MAPS[0];
const BIG = BOSSES[BOSS_INDEX.bigDokkaebi];

/** 무기 없이, 죽지 않고 들판을 sec 초까지 흘려보내며 본 것을 적는다 (cull: 요괴가 상한까지 쌓이지 않게 가끔 치운다) */
function watch(untilSec: number, from = 0, cull = false) {
  const s = createRun({ seed: 11, char: 'ox', map: 'field', numbers: false, startAt: from || undefined });
  if (from) {
    // 건너뛴 판: 미리 받은 무기·패시브를 치운다
    s.passives.length = 0;
  }
  s.weapons.length = 0;
  const firstSeen = new Map<string, number>();
  const events: { t: number; a: number; at: number }[] = [];
  let maxNormals = 0;
  advance(s, untilSec - from, {
    immortal: true,
    each: (st) => {
      for (let i = 0; i < st.enemies.n; i++) {
        const e = st.enemies.items[i];
        const id = e.boss >= 0 ? `boss:${BOSSES[e.boss].id}` : ENEMIES[e.kind].id;
        if (!firstSeen.has(id)) firstSeen.set(id, st.time);
      }
      for (let i = 0; i < st.evN; i++) events.push({ t: st.events[i].t, a: st.events[i].a, at: st.time });
      maxNormals = Math.max(maxNormals, st.normals);
      if (cull && st.normals > 150) for (let i = 0; i < st.enemies.n; i++) if (st.enemies.items[i].boss < 0) killEnemy(st, st.enemies.items[i], false);
    },
  });
  return { s, firstSeen, events, maxNormals };
}

describe('시간별 등장 표 (들판)', () => {
  const early = watch(113, 0, true);

  it('처음에는 꼬마 도깨비만, 33초부터 도깨비불, 1분 20초부터 방망이 도깨비, 1분 40초부터 물귀신', () => {
    expect(early.firstSeen.get('imp')).toBeLessThan(3);
    expect(early.firstSeen.get('wisp')).toBeGreaterThanOrEqual(33);
    expect(early.firstSeen.get('wisp')).toBeLessThan(39);
    expect(early.firstSeen.get('club')).toBeGreaterThanOrEqual(80);
    expect(early.firstSeen.get('water')).toBeGreaterThanOrEqual(100);
    expect(early.firstSeen.has('fox')).toBe(false);
  });

  it('1분 20초에 중간 보스 1(큰 도깨비): 3초 전에 경고가 먼저 뜬다', () => {
    const warn = early.events.find((e) => e.t === EV.bossWarn)!;
    const spawn = early.events.find((e) => e.t === EV.bossSpawn)!;
    expect(warn.a).toBe(BOSS_INDEX.bigDokkaebi);
    expect(warn.at).toBeCloseTo(80 - BOSS_WARN_SEC, 1);
    expect(spawn.a).toBe(BOSS_INDEX.bigDokkaebi);
    expect(spawn.at).toBeCloseTo(80, 1);
    expect(early.firstSeen.get('boss:bigDokkaebi')).toBeCloseTo(80, 1);
  });

  it('떼로 몰려오는 이벤트가 정해진 시각에 온다', () => {
    const swarm = early.events.filter((e) => e.t === EV.swarm);
    expect(swarm.map((e) => Math.round(e.at))).toEqual(FIELD.swarms.filter((w) => w.at < 113).map((w) => w.at));
    expect(swarm.length).toBe(2);
    expect(swarm[0].a).toBe(ENEMY_INDEX.imp);
  });

  it('요괴 수는 상한(300)을 넘지 않는다 (잡지 않고 버텨도)', () => {
    const late = watch(193, 147);
    expect(late.maxNormals).toBeGreaterThan(250);
    expect(late.maxNormals).toBeLessThanOrEqual(LIMIT.enemies + 40); // 떼·소환은 풀 크기까지
    expect(late.s.enemies.n).toBeLessThanOrEqual(LIMIT.enemyPool);
    // 2분 40초에 중간 보스 2(두억시니), 그 뒤로 여우불. (상한에 닿으면 새 요괴는 나오지 않는다)
    expect(late.firstSeen.has('water')).toBe(true);
    expect(late.firstSeen.get('boss:dueoksini')).toBeCloseTo(160, 1);
  });

  it('등장 표는 PRD의 시작 시각을 지킨다 (데이터)', () => {
    const first = (id: string) => Math.min(...FIELD.spawns.filter((r) => r.enemy === id).map((r) => r.from));
    expect([first('imp'), first('wisp'), first('club'), first('water'), first('fox')]).toEqual([0, 33, 80, 100, 160]);
    expect(FIELD.bosses).toEqual([{ at: 80, id: 'bigDokkaebi' }, { at: 160, id: 'dueoksini' }, { at: 240, id: 'bulgasal' }]);
    for (const r of FIELD.spawns) expect(ENEMY_INDEX[r.enemy]).toBeGreaterThanOrEqual(0);
  });

  it('시간이 갈수록 요괴가 단단해진다', () => {
    const s = emptyRun();
    const a = put(s, 'imp', 500, 0);
    s.time = 180;
    const b = put(s, 'imp', 500, 100);
    expect(b.maxHp).toBeCloseTo(a.maxHp * (1 + FIELD.growth.hpPerMin * 3), 6);
    expect(b.dmg).toBeGreaterThan(a.dmg);
  });
});

describe('요괴 5종의 움직임', () => {
  it('공통 요괴 5종의 움직임 3종이 등록돼 있다 (쫓기·출렁이기·원거리)', () => {
    const common = ENEMIES.slice(0, 5);
    expect(common.map((x) => x.id)).toEqual(['imp', 'wisp', 'club', 'water', 'fox']);
    expect(common.map((x) => x.move)).toEqual(['chase', 'chase', 'chase', 'wave', 'ranged']);
    for (const e of common) expect(MOVES[e.move]).toBeTypeOf('function');
  });

  it('도깨비불은 꼬마 도깨비보다 빠르고, 방망이 도깨비는 느리고 단단하다', () => {
    const s = disarm(emptyRun());
    const imp = put(s, 'imp', 400, 0);
    const wisp = put(s, 'wisp', 400, 200);
    const club = put(s, 'club', 400, -200);
    expect(club.maxHp).toBeGreaterThan(imp.maxHp * 5);
    advance(s, 1, { immortal: true });
    expect(400 - wisp.x).toBeGreaterThan((400 - imp.x) * 1.5);
    expect(400 - club.x).toBeLessThan(400 - imp.x);
  });

  it('물귀신은 옆으로 출렁이며 다가온다', () => {
    const s = disarm(emptyRun());
    const w = put(s, 'water', 400, 0);
    let maxSide = 0;
    advance(s, 2, { immortal: true, each: () => (maxSide = Math.max(maxSide, Math.abs(w.y))) });
    expect(maxSide).toBeGreaterThan(8);
    expect(w.x).toBeLessThan(300);
  });

  it('여우불은 거리를 두고 불을 쏜다. 맞으면 피해를 입는다', () => {
    const s = disarm(emptyRun());
    const fox = put(s, 'fox', 250, 0);
    let shots = 0;
    advance(s, 6, { each: (st) => (shots = Math.max(shots, live(st.projectiles).filter((p) => p.mode === MODE.enemy).length)) });
    expect(shots).toBeGreaterThan(0);
    expect(Math.hypot(fox.x, fox.y)).toBeGreaterThan(200);
    expect(s.player.hp).toBeLessThan(100);
  });
});

describe('보스 3종', () => {
  /** 보스 하나만 있는 판 */
  function bossRun(id: string) {
    const s = disarm(emptyRun({ char: 'ox' }));
    const b = spawnBoss(s, BOSS_INDEX[id], 0, -400)!;
    return { s, b };
  }

  it('패턴 종류가 모두 등록돼 있다', () => {
    const field = BOSSES.filter((x) => x.map === 'field');
    for (const b of field) {
      expect(b.patterns.length).toBeGreaterThan(1);
      for (const p of b.patterns) expect(PATTERNS[p.kind]).toBeTypeOf('function');
    }
    expect(field.map((x) => x.id)).toEqual(['bigDokkaebi', 'dueoksini', 'bulgasal']);
    expect(BOSSES.length).toBe(12);
  });

  it('큰 도깨비: 돌진(빠르게 내달림)과 주변 충격파(미리 보이고 터짐)', () => {
    const { s, b } = bossRun('bigDokkaebi');
    let maxStep = 0;
    let warned = false;
    let boom = false;
    let px = b.x;
    let py = b.y;
    advance(s, 12, {
      immortal: true,
      each: (st) => {
        maxStep = Math.max(maxStep, Math.hypot(b.x - px, b.y - py));
        px = b.x;
        py = b.y;
        if (live(st.zones).some((z) => z.owner === 1 && z.delay > 0 && z.r === BIG.patterns[3].r)) warned = true;
        for (let i = 0; i < st.evN; i++) if (st.events[i].t === EV.boom) boom = true;
      },
    });
    expect(maxStep).toBeCloseTo(BIG.patterns[1].speed! / 60, 1);
    expect(warned).toBe(true);
    expect(boom).toBe(true);
  });

  it('범위 공격은 미리 보여 준 뒤에 터지고, 그 안에 있으면 맞는다 (밖이면 안 맞는다)', () => {
    for (const inside of [true, false]) {
      const { s, b } = bossRun('bigDokkaebi');
      b.pat = 3; // 충격파
      b.x = inside ? 100 : 400;
      b.y = 0;
      b.speed = 0;
      b.dmg = 0;
      step(s, makeInput());
      const wave = BIG.patterns[3];
      const z = live(s.zones)[0];
      expect(z.delay).toBeCloseTo(wave.windup!, 1);
      advance(s, wave.windup! - 0.1);
      expect(s.player.hp).toBe(110);
      advance(s, 0.3);
      expect(s.player.hp).toBe(inside ? 110 - wave.dmg! : 110);
    }
  });

  it('두억시니: 내 자리에 방망이를 여러 번 내려찍고 꼬마 도깨비를 부른다', () => {
    const { s } = bossRun('dueoksini');
    let slams = 0;
    let seen = new Set<object>();
    advance(s, 12, {
      immortal: true,
      each: (st) => {
        for (const z of live(st.zones)) if (z.owner === 1 && z.r === 125 && z.delay > 0.85 && !seen.has(z)) slams++;
        seen = new Set(live(st.zones).filter((z) => z.delay > 0.85));
      },
    });
    expect(slams).toBeGreaterThanOrEqual(3);
    expect(live(s.enemies).filter((e) => e.kind === ENEMY_INDEX.imp).length).toBe(BOSSES[BOSS_INDEX.dueoksini].patterns[3].count);
  });

  it('불가살: 큰 범위 공격을 하고, 시간이 갈수록 단단해진다', () => {
    const { s } = bossRun('bulgasal');
    let maxR = 0;
    let many = 0;
    advance(s, 12, {
      immortal: true,
      each: (st) => {
        const zs = live(st.zones).filter((z) => z.owner === 1);
        many = Math.max(many, zs.length);
        for (const z of zs) maxR = Math.max(maxR, z.r);
      },
    });
    expect(maxR).toBe(BOSSES[BOSS_INDEX.bulgasal].patterns[3].r);
    expect(maxR).toBeGreaterThan(300);
    expect(many).toBeGreaterThanOrEqual(5);
    // 단단해짐: 같은 피해라도 나중에는 덜 들어간다
    const t = bossRun('bulgasal');
    hurtEnemy(t.s, t.b, 100, -1);
    expect(t.b.maxHp - t.b.hp).toBeCloseTo(100, 6);
    t.b.t = 50;
    const hp = t.b.hp;
    hurtEnemy(t.s, t.b, 100, -1);
    expect(hp - t.b.hp).toBeCloseTo(80, 6);
    t.b.t = 1000;
    const hp2 = t.b.hp;
    hurtEnemy(t.s, t.b, 100, -1);
    expect(hp2 - t.b.hp).toBeCloseTo(60, 6);
  });

  it('보스를 잡으면 보물상자·엽전이 떨어지고, 보물상자로 진화한다', () => {
    const { s, b } = bossRun('bigDokkaebi');
    addWeapon(s, WEAPON_INDEX.claw, 5);
    addPassive(s, PASSIVE_INDEX.might, 1);
    s.weapons[0].cd = 99;
    b.x = 300;
    b.y = 0;
    expect(activeBoss(s)).toBe(b);
    hurtEnemy(s, b, 1e9, -1);
    expect(s.bossKills).toBe(1);
    expect(live({ items: s.events, n: s.evN }).some((e) => e.t === EV.bossDown)).toBe(true);
    const items = live(s.pickups);
    expect(items.filter((p) => p.kind === ITEM.chest).length).toBe(1);
    expect(items.filter((p) => p.kind === ITEM.coin).length).toBe(ITEMS.bossCoins);
    expect(s.phase).toBe('play'); // 중간 보스는 잡아도 판이 이어진다
    s.player.x = 300;
    let evolved = false;
    advance(s, 0.5, { each: (st) => (evolved ||= live({ items: st.events, n: st.evN }).some((e) => e.t === EV.evolve)) });
    expect(evolved).toBe(true);
    expect(s.weapons[0].def).toBe(WEAPON_INDEX.clawEvo);
    expect(activeBoss(s)).toBe(null);
  });
});

describe('4분: 최종 보스와 클리어', () => {
  const s = createRun({ seed: 5, char: 'ox', map: 'field', numbers: false, startAt: 236 });
  s.weapons.length = 0;
  let warned = false;
  advance(s, 5, { immortal: true, each: (st) => (warned ||= live({ items: st.events, n: st.evN }).some((e) => e.t === EV.bossWarn && e.a === BOSS_INDEX.bulgasal)) });

  it('4분이 되면 최종 보스(불가살)가 나온다. 시간은 4분에서 멈춰 보인다', () => {
    expect(warned).toBe(true);
    const boss = activeBoss(s)!;
    expect(BOSSES[boss.boss].id).toBe('bulgasal');
    expect(boss.uid).toBe(s.finalUid);
    expect(s.time).toBeGreaterThan(RUN_SEC);
    expect(s.phase).toBe('play');
    expect(summarize(s).time).toBe(RUN_SEC);
    expect(summarize(s).cleared).toBe(false);
  });

  it('최종 보스를 잡으면 클리어하고 판이 끝난다', () => {
    const boss = activeBoss(s)!;
    // 최종 보스와 싸우는 동안에도 요괴는 계속 나온다
    expect(s.normals).toBeGreaterThan(5);
    addWeapon(s, WEAPON_INDEX.bell, 1);
    boss.hp = 1;
    boss.x = s.player.x + 60;
    boss.y = s.player.y;
    let clear = false;
    advance(s, 1, { immortal: true, each: (st) => (clear ||= live({ items: st.events, n: st.evN }).some((e) => e.t === EV.clear)) });
    expect(clear).toBe(true);
    expect(s.phase).toBe('clear');
    const r = summarize(s);
    expect(r).toMatchObject({ cleared: true, time: RUN_SEC, map: 'field', character: 'ox' });
    const tick = s.tick;
    step(s, makeInput());
    expect(s.tick).toBe(tick);
  });

  it('최종 보스에게 지면 클리어가 아니고, 생존 시간은 4분으로 남는다', () => {
    const t = createRun({ seed: 6, char: 'ox', map: 'field', numbers: false, startAt: 239 });
    t.weapons.length = 0;
    advance(t, 2, { immortal: true });
    put(t, 'imp', t.player.x, t.player.y).dmg = 1e6;
    t.player.inv = 0;
    advance(t, 0.1);
    expect(t.phase).toBe('over');
    expect(summarize(t)).toMatchObject({ cleared: false, time: RUN_SEC });
  });
});

describe('필드 아이템', () => {
  const at = (s: State, kind: number, value = 1) => dropPickup(s, kind, s.player.x, s.player.y, value);

  it('엽전: 맵 배율과 엽전 획득 보너스가 곱해진다', () => {
    const s = disarm(emptyRun({ char: 'pig', upgrades: { coin: 2 } }));
    at(s, ITEM.coin, 10);
    advance(s, 0.1);
    expect(s.coins).toBeCloseTo(10 * 1.2, 6);
    expect(summarize(s).coins).toBe(12);
  });

  it('떡: 체력을 회복한다 (최대 체력까지)', () => {
    const s = disarm(emptyRun());
    s.player.hp = 40;
    at(s, ITEM.cake);
    advance(s, 0.1);
    expect(s.player.hp).toBe(40 + ITEMS.cakeHeal);
    expect(s.cakes).toBe(1);
    s.player.hp = 95;
    at(s, ITEM.cake);
    advance(s, 0.1);
    expect(s.player.hp).toBe(100);
  });

  it('복주머니: 멀리 있는 구슬도 모두 끌려온다', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    s.xpNext = 10; // 구슬 두 개로 레벨이 오르지 않게 (1레벨은 경험치 2면 오른다)
    dropPickup(s, ITEM.gemS, 900, 0, 1);
    dropPickup(s, ITEM.gemS, -700, 500, 1);
    advance(s, 1);
    expect(s.xp).toBe(0);
    at(s, ITEM.pouch);
    advance(s, 3);
    expect(s.xp).toBe(2);
    expect(s.pickups.n).toBe(0);
  });

  it('부적: 화면의 일반 요괴를 모두 물리친다 (보스는 남는다)', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    for (let i = 0; i < 20; i++) put(s, 'club', 100 + i * 12, 300).speed = 0;
    const boss = spawnBoss(s, 0, 200, -300)!;
    boss.speed = 0;
    at(s, ITEM.talisman);
    advance(s, 0.1, { immortal: true });
    expect(s.kills).toBe(20);
    expect(s.normals).toBe(0);
    expect(boss.dead).toBe(false);
    expect(boss.hp).toBe(boss.maxHp);
    // 사라진 요괴도 구슬을 남긴다
    expect(live(s.pickups).filter((p) => p.kind <= ITEM.gemL).length).toBe(20);
  });

  it('구슬 크기: 경험치가 많은 요괴는 중간·큰 구슬을 남긴다', () => {
    const s = disarm(emptyRun());
    const club = put(s, 'club', 500, 0);
    hurtEnemy(s, club, 1e9, -1);
    expect(live(s.pickups)[0].kind).toBe(ITEM.gemM);
    const big = put(s, 'imp', 500, 200);
    big.xp = 30;
    hurtEnemy(s, big, 1e9, -1);
    expect(live(s.pickups).some((p) => p.kind === ITEM.gemL)).toBe(true);
  });

  it('바닥이 가득 차도 경험치는 사라지지 않는다 (놓인 구슬에 합쳐진다)', () => {
    const s = disarm(emptyRun({ char: 'ox' }));
    for (let i = 0; i < LIMIT.pickups + 50; i++) dropPickup(s, ITEM.gemS, 2000 + i, 0, 1);
    expect(s.pickups.n).toBe(LIMIT.pickups);
    expect(live(s.pickups).reduce((n, p) => n + p.value, 0)).toBe(LIMIT.pickups + 50);
  });
});

describe('강화 수준을 정해 바로 시험하기 (개발용 설정)', () => {
  it('?upg=10&t=160 처럼: 강화 10레벨 상태로 2분 40초 시점에서 시작한다', () => {
    const s = createRun({ seed: 9, char: 'tiger', map: 'field', upgrades: presetUpgrades(10), startAt: 160 });
    expect(s.time).toBeCloseTo(160, 3);
    expect(Object.values(s.upgrades).reduce((a, b) => a + b, 0)).toBe(10);
    expect(s.level).toBeGreaterThan(10);
    expect(s.weapons.length + s.passives.length).toBeGreaterThan(4);
    expect(s.player.hp).toBe(s.stats.maxHp);
    // 지나간 보스는 건너뛰고, 2분 40초 보스가 바로 나온다
    advance(s, 0.2, { immortal: true });
    expect(BOSSES[activeBoss(s)!.boss].id).toBe('dueoksini');
  });
});

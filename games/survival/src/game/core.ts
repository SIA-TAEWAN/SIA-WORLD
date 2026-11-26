/**
 * 계산의 공통 도구: 난수, 풀, 범위 안의 적 찾기, 피해·처치·아이템 떨구기, 능력치 계산.
 * 무기(weapons.ts)·요괴(enemies.ts)·보스(bosses.ts)·걸음(sim.ts)이 모두 이것을 쓴다.
 */
import { ARENA, CLAMP, ENDLESS, PLAYER, RUN_SEC, SPAWN, STACKS, TICKS_PER_SEC } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ENEMIES } from '../data/enemies';
import { ITEM, ITEMS } from '../data/items';
import { PASSIVES } from '../data/passives';
import type { StatKey } from '../data/stats';
import { UPGRADES } from '../data/upgrades';
import { EV, FX, type Enemy, type Fx, type Num, type Pickup, type Pool, type Projectile, type State, type Stats, type Zone } from './state';

// ───────────────────────── 난수 (mulberry32, 상태는 State.rng) ─────────────────────────
export function rand(s: State): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ───────────────────────── 풀 ─────────────────────────
export function makePool<T>(size: number, make: () => T): Pool<T> {
  const items: T[] = [];
  for (let i = 0; i < size; i++) items.push(make());
  return { items, n: 0 };
}

/** 빈 것 하나를 꺼낸다 (가득 찼으면 null) */
export function take<T>(p: Pool<T>): T | null {
  return p.n < p.items.length ? p.items[p.n++] : null;
}

/** 죽은 것을 빼낸다 (맨 뒤의 것과 자리를 바꾼다. 객체는 그대로 남아 다시 쓰인다) */
export function sweep<T extends { dead: boolean }>(p: Pool<T>) {
  const a = p.items;
  let n = p.n;
  for (let i = 0; i < n; ) {
    if (a[i].dead) {
      n--;
      const t = a[i];
      a[i] = a[n];
      a[n] = t;
    } else i++;
  }
  p.n = n;
}

// ───────────────────────── 알림 ─────────────────────────
/** 놓치면 판이 멈추거나 끝나지 않는 알림: 칸이 모자라도 빠지지 않는다 */
const mustTell = (t: number) => t === EV.levelup || t === EV.over || t === EV.clear;

export function emit(s: State, t: number, a = 0, b = 0) {
  let e = s.events[s.evN];
  if (s.evN < s.events.length) s.evN++;
  else {
    // 한 걸음의 알림이 가득 찼다: 소리·연출용 알림은 버리고, 꼭 전해야 하는 알림은 덜 중요한 마지막 알림 자리에 적는다
    if (!mustTell(t)) return;
    let i = s.evN - 1;
    while (i >= 0 && mustTell(s.events[i].t)) i--;
    if (i < 0) return;
    e = s.events[i];
  }
  e.t = t;
  e.a = a;
  e.b = b;
}

// ───────────────────────── 능력치 ─────────────────────────
/** 능력치 이름별 합계를 모은다 */
function addMod(sum: Record<StatKey, number>, stat: StatKey, value: number) {
  sum[stat] += value;
}

const ZERO: Record<StatKey, number> = {
  might: 0, area: 0, cooldown: 0, speed: 0, maxHpPct: 0, maxHpFlat: 0, armor: 0, taken: 0,
  pickup: 0, coin: 0, xp: 0, dot: 0, projSpeed: 0, regen: 0, revive: 0, reroll: 0, dodge: 0,
};

/** 캐릭터 특성 + 패시브 + 영구 강화를 더해 지금 능력치를 다시 계산한다 */
export function recalcStats(s: State) {
  const sum = { ...ZERO };
  addMod(sum, s.char.trait.stat, s.char.trait.value);
  for (const p of s.passives) addMod(sum, PASSIVES[p.def].stat, PASSIVES[p.def].perLevel * p.lv);
  for (const u of UPGRADES) addMod(sum, u.stat, u.perLevel * (s.upgrades[u.id] ?? 0));
  for (let i = 0; i < STACKS.length; i++) addMod(sum, STACKS[i].stat, STACKS[i].value * (s.stacks[i] ?? 0));
  const st = s.stats;
  const oldMax = st.maxHp;
  st.might = 1 + sum.might;
  st.area = 1 + sum.area;
  st.cooldown = Math.max(CLAMP.cooldownMin, 1 - sum.cooldown);
  st.speed = PLAYER.speed * (1 + sum.speed);
  st.maxHp = Math.round((PLAYER.hp + sum.maxHpFlat) * (1 + sum.maxHpPct));
  st.armor = sum.armor;
  st.taken = Math.max(CLAMP.takenMin, 1 - sum.taken);
  st.pickup = PLAYER.pickupR * (1 + sum.pickup);
  st.coin = 1 + sum.coin;
  st.xp = 1 + sum.xp;
  st.dot = 1 + sum.dot;
  st.projSpeed = 1 + sum.projSpeed;
  st.regen = sum.regen;
  st.dodge = sum.dodge;
  // 최대 체력이 늘면 늘어난 만큼 지금 체력도 는다
  if (oldMax > 0 && st.maxHp > oldMax) s.player.hp += st.maxHp - oldMax;
  if (s.player.hp > st.maxHp) s.player.hp = st.maxHp;
  return sum;
}

export function makeStats(): Stats {
  return { might: 1, area: 1, cooldown: 1, speed: PLAYER.speed, maxHp: 0, armor: 0, taken: 1, pickup: PLAYER.pickupR, coin: 1, xp: 1, dot: 1, projSpeed: 1, regen: 0, dodge: 0 };
}

// ───────────────────────── 맵 경계 ─────────────────────────
/** 반지름 r 의 몸을 맵(ARENA) 안으로 들여놓는다. 밖에 있었으면 true */
export function keepIn(o: { x: number; y: number }, r: number): boolean {
  const w = ARENA.halfW - r;
  const h = ARENA.halfH - r;
  let out = false;
  if (o.x > w) (o.x = w), (out = true);
  else if (o.x < -w) (o.x = -w), (out = true);
  if (o.y > h) (o.y = h), (out = true);
  else if (o.y < -h) (o.y = -h), (out = true);
  return out;
}

/** 그 자리가 맵 가장자리에서 m 이상 안쪽인가 */
export const insideArena = (x: number, y: number, m: number) => x <= ARENA.halfW - m && x >= m - ARENA.halfW && y <= ARENA.halfH - m && y >= m - ARENA.halfH;

// ───────────────────────── 이펙트·피해 숫자 ─────────────────────────
export function addFx(s: State, kind: number, x: number, y: number, r: number, a = 0, b = 0, life = 0.25): Fx | null {
  const f = take(s.fx);
  if (!f) return null;
  f.kind = kind;
  f.x = x;
  f.y = y;
  f.r = r;
  f.a = a;
  f.b = b;
  f.life = f.maxLife = life;
  f.dead = false;
  return f;
}

export function addNum(s: State, x: number, y: number, v: number, kind = 0): Num | null {
  if (!s.cfg.numbers) return null;
  const n = take(s.nums);
  if (!n) return null;
  n.x = x;
  n.y = y;
  n.v = v;
  n.kind = kind;
  n.life = 0.6;
  n.dead = false;
  return n;
}

// ───────────────────────── 적 찾기 ─────────────────────────
/** 원(x, y, r)에 닿는 살아 있는 적의 번호를 s.hits 에 담고 개수를 돌려준다 */
export function collect(s: State, x: number, y: number, r: number): number {
  const hits = s.hits;
  const m = s.grid.query(x, y, r, hits);
  const list = s.enemies.items;
  let n = 0;
  for (let k = 0; k < m; k++) {
    const e = list[hits[k]];
    if (e.dead || e.hidden) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const rr = r + e.r;
    if (dx * dx + dy * dy <= rr * rr) hits[n++] = hits[k];
  }
  return n;
}

/** 가장 가까운 살아 있는 적의 번호 (maxDist 안에 없으면 -1) */
export function nearestEnemy(s: State, x: number, y: number, maxDist: number): number {
  const list = s.enemies.items;
  let best = -1;
  let bd = maxDist * maxDist;
  for (let i = 0; i < s.enemies.n; i++) {
    const e = list[i];
    if (e.dead || e.hidden) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// ───────────────────────── 아이템 ─────────────────────────
export function dropPickup(s: State, kind: number, x: number, y: number, value: number): Pickup | null {
  let p = take(s.pickups);
  if (!p) {
    // 풀이 가득 찼다: 구슬·엽전은 이미 놓인 같은 종류에 값을 합친다 (값이 사라지지 않게)
    if (kind <= ITEM.coin) {
      const list = s.pickups.items;
      for (let i = s.pickups.n - 1; i >= 0; i--) {
        const q = list[i];
        if (q.dead || (kind === ITEM.coin ? q.kind !== ITEM.coin : q.kind > ITEM.gemL)) continue;
        q.value += value;
        if (kind !== ITEM.coin) q.kind = gemKind(q.value);
        return q;
      }
      return null;
    }
    // 떡·복주머니·부적·보물상자는 반드시 놓는다: 가장 먼 구슬(없으면 엽전)을 다른 것에 합쳐 자리를 만든다
    p = makeRoom(s);
    if (!p) return null;
  }
  p.kind = kind;
  p.x = x;
  p.y = y;
  // 맵 가장자리에서 쓰러진 보스의 엽전 따위가 벽 너머로 흩어지지 않게
  keepIn(p, ITEMS.touch);
  p.value = value;
  p.magnet = false;
  p.dead = false;
  return p;
}

/**
 * 가득 찬 바닥 아이템 풀에서 자리 하나를 비운다: 내게서 가장 먼 구슬을 그와 가장 가까운 다른 구슬에 합친다 (경험치는 그대로).
 * 구슬이 둘 미만이면 엽전으로 같은 일을 한다. 그것도 안 되면(풀이 떡·상자 따위로만 가득) null
 */
function makeRoom(s: State): Pickup | null {
  const list = s.pickups.items;
  const n = s.pickups.n;
  const px = s.player.x;
  const py = s.player.y;
  // 이미 주운(이번 걸음 끝에 치워질) 자리가 있으면 그것을 쓴다
  for (let i = 0; i < n; i++) if (list[i].dead) return list[i];
  for (let pass = 0; pass < 2; pass++) {
    // pass 0: 구슬, pass 1: 엽전
    const same = (q: Pickup) => !q.dead && (pass === 0 ? q.kind <= ITEM.gemL : q.kind === ITEM.coin);
    let far: Pickup | null = null;
    let fd = -1;
    for (let i = 0; i < n; i++) {
      const q = list[i];
      if (!same(q)) continue;
      const d = (q.x - px) * (q.x - px) + (q.y - py) * (q.y - py);
      if (d > fd) {
        fd = d;
        far = q;
      }
    }
    if (!far) continue;
    let near: Pickup | null = null;
    let nd = Infinity;
    for (let i = 0; i < n; i++) {
      const q = list[i];
      if (q === far || !same(q)) continue;
      const d = (q.x - far.x) * (q.x - far.x) + (q.y - far.y) * (q.y - far.y);
      if (d < nd) {
        nd = d;
        near = q;
      }
    }
    if (!near) continue;
    near.value += far.value;
    if (pass === 0) near.kind = gemKind(near.value);
    return far;
  }
  return null;
}

export const gemKind = (xp: number) => (xp >= ITEMS.gemBigXp ? ITEM.gemL : xp >= ITEMS.gemMidXp ? ITEM.gemM : ITEM.gemS);

// ───────────────────────── 피해 ─────────────────────────
/** 요괴 번호 → 되살아나는 데 걸리는 시간 (되살아나지 않으면 0) */
const REVIVE_SEC = ENEMIES.map((d) => (d.move === 'revive' ? (d.extra?.reviveSec ?? 2.5) : 0));
/** 적에게 피해 (slot: 무기 칸, weapon: 무기 번호 — 집계용, 없으면 -1) */
export function hurtEnemy(s: State, e: Enemy, dmg: number, weapon: number) {
  if (e.dead || e.hidden) return;
  dmg *= e.guard;
  if (e.boss >= 0) {
    // 시간이 갈수록 단단해지는 보스
    const h = BOSSES[e.boss].harden;
    if (h) dmg *= Math.max(h.min, 1 - h.perSec * e.t);
  }
  if (dmg > e.hp) dmg = e.hp;
  e.hp -= dmg;
  e.flash = 5;
  if (weapon >= 0) s.dmgByWeapon[weapon] += dmg;
  addNum(s, e.x, e.y - e.r, dmg, 0);
  if (e.hp <= 0.0001) killEnemy(s, e, true);
}

/** 적 처치: 경험치 구슬과 아이템을 떨군다 (drops=false 면 흔적 없이 사라진다) */
export function killEnemy(s: State, e: Enemy, drops: boolean) {
  if (e.dead) return;
  // 해골 병사: 처음 쓰러지면 죽지 않고 잠시 누워 있다가 한 번 되살아난다
  if (drops && e.boss < 0 && e.sub === 0 && REVIVE_SEC[e.kind] > 0 && e.look < 0) {
    e.sub = 1;
    e.hidden = true;
    e.hp = 1;
    e.patT = REVIVE_SEC[e.kind];
    addFx(s, FX.puff, e.x, e.y, e.r, 0, 0, 0.28);
    return;
  }
  e.dead = true;
  e.hp = 0;
  if (!drops) return;
  s.kills++;
  addFx(s, FX.puff, e.x, e.y, e.r, 0, 0, 0.28);
  if (e.boss >= 0) {
    s.bossKills++;
    emit(s, EV.bossDown, e.boss);
    dropPickup(s, ITEM.chest, e.x, e.y, 1);
    dropPickup(s, ITEM.gemL, e.x - 30, e.y + 24, e.xp);
    for (let i = 0; i < ITEMS.bossCoins; i++) {
      const a = rand(s) * Math.PI * 2;
      const d = 30 + rand(s) * 70;
      dropPickup(s, ITEM.coin, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, 1);
    }
    if (e.uid === s.finalUid && !s.endless) {
      // 최종 보스를 물리쳤다: 클리어 (무한 모드는 끝나지 않고 계속된다)
      s.phase = 'clear';
      emit(s, EV.clear);
    }
    return;
  }
  if (!s.killEv) {
    s.killEv = true;
    emit(s, EV.kill, e.kind);
  }
  dropPickup(s, gemKind(e.xp), e.x, e.y, e.xp);
  const d = ITEMS.drop;
  const roll = rand(s);
  if (roll < d.talisman) dropPickup(s, ITEM.talisman, e.x + 12, e.y, 1);
  else if (roll < d.talisman + d.pouch) dropPickup(s, ITEM.pouch, e.x + 12, e.y, 1);
  else if (roll < d.talisman + d.pouch + d.cake) dropPickup(s, ITEM.cake, e.x + 12, e.y, 1);
  else if (roll < d.talisman + d.pouch + d.cake + d.coin) dropPickup(s, ITEM.coin, e.x + 12, e.y, 1);
}

/** 내가 피해를 입는다. 무적 중이면 false */
export function hurtPlayer(s: State, raw: number): boolean {
  const p = s.player;
  if (p.inv > 0 || s.phase !== 'play') return false;
  // 고양이 특성: 몸놀림이 준비돼 있으면 이 피해를 통째로 피하고(맞은 것처럼 잠시 무적), 간격만큼 다시 기다린다
  if (s.stats.dodge > 0 && p.dodge <= 0) {
    p.dodge = Math.round(s.stats.dodge * TICKS_PER_SEC);
    p.inv = Math.round(PLAYER.invSec * TICKS_PER_SEC);
    emit(s, EV.dodge);
    addFx(s, FX.shock, p.x, p.y, PLAYER.r * 3, 0, 0, 0.3);
    return false;
  }
  const dmg = Math.max(1, Math.round(raw * s.stats.taken - s.stats.armor));
  p.hp -= dmg;
  s.dmgTaken += dmg;
  p.inv = Math.round(PLAYER.invSec * TICKS_PER_SEC);
  emit(s, EV.hurt, dmg);
  addNum(s, p.x, p.y - 30, dmg, 1);
  return true;
}

export function healPlayer(s: State, v: number) {
  const p = s.player;
  const before = p.hp;
  p.hp = Math.min(s.stats.maxHp, p.hp + v);
  if (p.hp - before >= 1) addNum(s, p.x, p.y - 30, p.hp - before, 2);
}

/** 경험치를 얻는다 (레벨업은 걸음 끝에 처리) */
export function gainXp(s: State, v: number) {
  s.xp += v * s.stats.xp;
}

export function gainCoins(s: State, n: number) {
  s.coins += n * ITEMS.coinValue * s.map.coinMul * s.stats.coin;
  // 무한 모드: 한 판에 받는 엽전에는 상한이 있다 (오래 버텨도 강화가 빨라지지 않게)
  if (s.coins > s.coinCap) s.coins = s.coinCap;
}

// ───────────────────────── 적 만들기 ─────────────────────────
/**
 * 무한 모드의 추가 배율: 4분 뒤로 m분이 지났을 때 1 + perMin × m + perMin2 × m² (data/balance.ts 의 ENDLESS).
 * 4분 모드와 무한 모드의 4분까지는 언제나 1
 */
export function endlessMul(s: State, k: { perMin: number; perMin2: number }): number {
  if (!s.endless || s.time <= RUN_SEC) return 1;
  const m = (s.time - RUN_SEC) / 60;
  return 1 + k.perMin * m + k.perMin2 * m * m;
}

/** 시간이 갈수록 강해지는 배율 */
export const hpGrowth = (s: State) => (1 + (s.map.growth.hpPerMin * s.time) / 60) * endlessMul(s, ENDLESS.hp);
export const dmgGrowth = (s: State) => (1 + (s.map.growth.dmgPerMin * s.time) / 60) * endlessMul(s, ENDLESS.dmg);

function resetEnemy(s: State, e: Enemy, x: number, y: number) {
  e.uid = s.nextUid++;
  e.x = x;
  e.y = y;
  e.flash = 0;
  e.t = 0;
  e.dead = false;
  e.cd = 0;
  e.pat = 0;
  e.patT = 0;
  e.sub = 0;
  e.ax = 0;
  e.ay = 0;
  e.slow = 0;
  e.hidden = false;
  e.guard = 1;
  e.look = -1;
  e.side = 0;
  e.sideT = 0;
  e.hitAt.fill(-100000);
}

export function spawnEnemy(s: State, kind: number, x: number, y: number): Enemy | null {
  const e = take(s.enemies);
  if (!e) return null;
  const def = ENEMIES[kind];
  resetEnemy(s, e, x, y);
  e.kind = kind;
  e.boss = -1;
  e.maxHp = e.hp = def.hp * s.map.power.hp * hpGrowth(s);
  e.r = def.r;
  keepIn(e, e.r);
  e.speed = def.speed * s.map.power.speed;
  e.dmg = def.dmg * s.map.power.dmg * dmgGrowth(s);
  e.xp = def.xp;
  e.cd = def.shoot ? def.shoot.every * (0.4 + rand(s) * 0.6) : 0;
  s.normals++;
  s.seenEnemy[kind] = 1;
  return e;
}

export function spawnBoss(s: State, boss: number, x: number, y: number): Enemy | null {
  const e = take(s.enemies);
  if (!e) return null;
  const def = BOSSES[boss];
  resetEnemy(s, e, x, y);
  e.kind = -1;
  e.boss = boss;
  // 무한 모드에서 4분 뒤에 다시 나오는 보스는 시간이 갈수록 체력이 많고 세게 때린다
  e.maxHp = e.hp = def.hp * s.map.power.boss * endlessMul(s, ENDLESS.bossHp);
  e.r = def.r;
  keepIn(e, e.r);
  e.speed = def.speed * s.map.power.speed;
  e.dmg = def.dmg * endlessMul(s, ENDLESS.dmg) * s.bossDmg;
  e.xp = def.xp;
  s.seenBoss[boss] = 1;
  emit(s, EV.bossSpawn, boss);
  return e;
}

/**
 * 내 캐릭터를 둘러싼 사각형 둘레 위의 한 점 (화면 밖). out 에 담는다.
 * 맵은 닫혀 있어서(ARENA) 그 변이 맵 밖이면 반대쪽 변에서 나오고(내가 벽에 붙어 있으면 벽 반대쪽·옆에서 온다),
 * 변을 따라가는 자리가 맵 밖이면 내 자리를 사이에 두고 맞은편으로 옮긴다(그래도 밖이면 맵 끝에 붙인다). 사각형이 맵의 절반보다 작아서 반대쪽 변은 언제나 맵 안이다.
 */
export function edgePoint(s: State, out: { x: number; y: number }, side = -1) {
  const p = s.player;
  const w = SPAWN.halfW;
  const h = SPAWN.halfH;
  const lw = ARENA.halfW - SPAWN.inset;
  const lh = ARENA.halfH - SPAWN.inset;
  // 둘레 길이에 맞춰 변을 고른다 (긴 변에서 더 자주)
  let k = side;
  if (k < 0) k = rand(s) * (w + h) < w ? (rand(s) < 0.5 ? 0 : 1) : rand(s) < 0.5 ? 2 : 3;
  // 0 위 · 1 아래 · 2 왼쪽 · 3 오른쪽: 맵 밖의 변이면 반대쪽
  if (k === 0 && p.y - h < -lh) k = 1;
  else if (k === 1 && p.y + h > lh) k = 0;
  else if (k === 2 && p.x - w < -lw) k = 3;
  else if (k === 3 && p.x + w > lw) k = 2;
  const t = rand(s) * 2 - 1;
  if (k <= 1) {
    let o = t * w;
    if (p.x + o > lw || p.x + o < -lw) o = -o;
    out.x = Math.max(-lw, Math.min(lw, p.x + o));
    out.y = k === 0 ? p.y - h : p.y + h;
  } else {
    let o = t * h;
    if (p.y + o > lh || p.y + o < -lh) o = -o;
    out.x = k === 2 ? p.x - w : p.x + w;
    out.y = Math.max(-lh, Math.min(lh, p.y + o));
  }
}

// ───────────────────────── 투사체·지대 ─────────────────────────
export function addProjectile(s: State, kind: number, mode: number, slot: number, weapon: number, x: number, y: number, vx: number, vy: number, r: number, dmg: number, life: number): Projectile | null {
  const p = take(s.projectiles);
  if (!p) return null;
  p.kind = kind;
  p.mode = mode;
  p.slot = slot;
  p.weapon = weapon;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.r = r;
  p.dmg = dmg;
  p.life = life;
  p.pierce = 0;
  p.sx = p.sy = p.tx = p.ty = p.t = p.dur = p.a = p.b = p.c = 0;
  p.every = 0;
  p.hitN = 0;
  p.dead = false;
  return p;
}

export function addZone(s: State, kind: number, owner: number, slot: number, weapon: number, x: number, y: number, r: number, delay: number, life: number, everySec: number, dmg: number): Zone | null {
  const z = take(s.zones);
  if (!z) return null;
  z.kind = kind;
  z.owner = owner;
  z.slot = slot;
  z.weapon = weapon;
  z.x = x;
  z.y = y;
  z.r = r;
  z.delay = z.windup = delay;
  z.life = z.maxLife = life;
  z.every = Math.max(1, Math.round(everySec * TICKS_PER_SEC));
  z.next = 0;
  z.dmg = dmg;
  z.tick = 0;
  z.slow = 0;
  z.dead = false;
  return z;
}

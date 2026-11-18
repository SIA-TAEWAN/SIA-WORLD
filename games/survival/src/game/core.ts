/**
 * 계산의 공통 도구: 난수, 풀, 범위 안의 적 찾기, 피해·처치·아이템 떨구기, 능력치 계산.
 * 무기(weapons.ts)·요괴(enemies.ts)·보스(bosses.ts)·걸음(sim.ts)이 모두 이것을 쓴다.
 */
import { CLAMP, PLAYER, SPAWN, TICKS_PER_SEC } from '../data/balance';
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
export function emit(s: State, t: number, a = 0, b = 0) {
  if (s.evN >= s.events.length) return;
  const e = s.events[s.evN++];
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
  pickup: 0, coin: 0, xp: 0, dot: 0, projSpeed: 0, regen: 0, revive: 0, reroll: 0,
};

/** 캐릭터 특성 + 패시브 + 영구 강화를 더해 지금 능력치를 다시 계산한다 */
export function recalcStats(s: State) {
  const sum = { ...ZERO };
  addMod(sum, s.char.trait.stat, s.char.trait.value);
  for (const p of s.passives) addMod(sum, PASSIVES[p.def].stat, PASSIVES[p.def].perLevel * p.lv);
  for (const u of UPGRADES) addMod(sum, u.stat, u.perLevel * (s.upgrades[u.id] ?? 0));
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
  // 최대 체력이 늘면 늘어난 만큼 지금 체력도 는다
  if (oldMax > 0 && st.maxHp > oldMax) s.player.hp += st.maxHp - oldMax;
  if (s.player.hp > st.maxHp) s.player.hp = st.maxHp;
  return sum;
}

export function makeStats(): Stats {
  return { might: 1, area: 1, cooldown: 1, speed: PLAYER.speed, maxHp: 0, armor: 0, taken: 1, pickup: PLAYER.pickupR, coin: 1, xp: 1, dot: 1, projSpeed: 1, regen: 0 };
}

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
    if (e.dead) continue;
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
    if (e.dead) continue;
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
  const p = take(s.pickups);
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
    }
    return null;
  }
  p.kind = kind;
  p.x = x;
  p.y = y;
  p.value = value;
  p.magnet = false;
  p.dead = false;
  return p;
}

export const gemKind = (xp: number) => (xp >= ITEMS.gemBigXp ? ITEM.gemL : xp >= ITEMS.gemMidXp ? ITEM.gemM : ITEM.gemS);

// ───────────────────────── 피해 ─────────────────────────
/** 적에게 피해 (slot: 무기 칸, weapon: 무기 번호 — 집계용, 없으면 -1) */
export function hurtEnemy(s: State, e: Enemy, dmg: number, weapon: number) {
  if (e.dead) return;
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
    if (e.uid === s.finalUid) {
      // 최종 보스를 물리쳤다: 클리어
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
}

// ───────────────────────── 적 만들기 ─────────────────────────
/** 시간이 갈수록 강해지는 배율 */
export const hpGrowth = (s: State) => 1 + (s.map.growth.hpPerMin * s.time) / 60;
export const dmgGrowth = (s: State) => 1 + (s.map.growth.dmgPerMin * s.time) / 60;

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
  e.speed = def.speed * s.map.power.speed;
  e.dmg = def.dmg * dmgGrowth(s);
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
  e.maxHp = e.hp = def.hp * s.map.power.hp;
  e.r = def.r;
  e.speed = def.speed * s.map.power.speed;
  e.dmg = def.dmg;
  e.xp = def.xp;
  s.seenBoss[boss] = 1;
  emit(s, EV.bossSpawn, boss);
  return e;
}

/** 내 캐릭터를 둘러싼 사각형 둘레 위의 한 점 (화면 밖). out 에 담는다 */
export function edgePoint(s: State, out: { x: number; y: number }, side = -1) {
  const p = s.player;
  const w = SPAWN.halfW;
  const h = SPAWN.halfH;
  // 둘레 길이에 맞춰 변을 고른다 (긴 변에서 더 자주)
  let k = side;
  if (k < 0) k = rand(s) * (w + h) < w ? (rand(s) < 0.5 ? 0 : 1) : rand(s) < 0.5 ? 2 : 3;
  const t = rand(s) * 2 - 1;
  if (k === 0) {
    out.x = p.x + t * w;
    out.y = p.y - h;
  } else if (k === 1) {
    out.x = p.x + t * w;
    out.y = p.y + h;
  } else if (k === 2) {
    out.x = p.x - w;
    out.y = p.y + t * h;
  } else {
    out.x = p.x + w;
    out.y = p.y + t * h;
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
  z.dead = false;
  return z;
}

/**
 * 무기 동작. 무기는 정해진 간격마다 저절로 발동한다 (PRD 3장).
 * 동작 종류마다 함수 하나를 BEHAVIORS 에 등록하고, 수치는 data/weapons.ts 의 레벨 줄에서 읽는다.
 * 새 무기 동작을 더하려면: 여기에 함수 하나 + data/weapons.ts 에 kind 를 적은 항목.
 */
import { TICK, TICKS_PER_SEC } from '../data/balance';
import { WEAPONS, type WeaponDef, type WeaponLevel } from '../data/weapons';
import { addFx, addProjectile, addZone, collect, emit, hurtEnemy, nearestEnemy, rand } from './core';
import { EV, FX, MODE, PROJ, ZONE, type State, type WeaponInst } from './state';

/** 무기 한 번 발동. slot: 무기 칸 번호(0~5), L: 지금 레벨의 수치 */
export type WeaponFire = (s: State, w: WeaponInst, slot: number, L: WeaponLevel, def: WeaponDef) => void;

/** 방향이 있는 무기가 겨눌 쪽: 가까운 적이 있으면 그쪽, 없으면 마지막으로 움직인 쪽 (PRD 9장). 결과는 AIM 에 */
const AIM = { x: 1, y: 0 };
function aim(s: State, range: number) {
  const p = s.player;
  const i = nearestEnemy(s, p.x, p.y, range);
  if (i < 0) {
    AIM.x = p.fx;
    AIM.y = p.fy;
    return;
  }
  const e = s.enemies.items[i];
  const dx = e.x - p.x;
  const dy = e.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  AIM.x = dx / d;
  AIM.y = dy / d;
}

/** 표창: 가까운 적에게 날아간다 (여러 개면 부채꼴로 조금씩 벌려서) */
const seek: WeaponFire = (s, w, slot, L) => {
  const p = s.player;
  aim(s, 520);
  const n = L.count ?? 1;
  const base = Math.atan2(AIM.y, AIM.x);
  const speed = (L.speed ?? 500) * s.stats.projSpeed;
  const evo = WEAPONS[w.def].evolved;
  for (let i = 0; i < n; i++) {
    const a = base + (i - (n - 1) / 2) * 0.2;
    const pr = addProjectile(s, evo ? PROJ.shurikenEvo : PROJ.shuriken, MODE.line, slot, w.def, p.x, p.y, Math.cos(a) * speed, Math.sin(a) * speed, L.size ?? 10, L.dmg * s.stats.might, L.life ?? 1.2);
    if (pr) pr.pierce = L.pierce ?? 0;
  }
};

/** 방울: 내 주변 장판. 간격마다 범위 안의 적 모두에게 피해 */
const aura: WeaponFire = (s, w, _slot, L) => {
  const p = s.player;
  const r = (L.radius ?? 90) * s.stats.area;
  w.view = r;
  const dmg = L.dmg * s.stats.might * s.stats.dot;
  const n = collect(s, p.x, p.y, r);
  const list = s.enemies.items;
  for (let k = 0; k < n; k++) hurtEnemy(s, list[s.hits[k]], dmg, w.def);
  if (n > 0) addFx(s, FX.pulse, p.x, p.y, r, 0, 0, 0.3);
};

/** 발톱: 겨눈 쪽 부채꼴 안의 적 모두에게 피해 */
const cone: WeaponFire = (s, w, _slot, L) => {
  const p = s.player;
  const range = (L.range ?? 120) * s.stats.area;
  aim(s, range * 1.5);
  const half = (((L.arc ?? 100) / 2) * Math.PI) / 180;
  const cosHalf = Math.cos(half);
  const dmg = L.dmg * s.stats.might;
  const n = collect(s, p.x, p.y, range);
  const list = s.enemies.items;
  for (let k = 0; k < n; k++) {
    const e = list[s.hits[k]];
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy);
    // 몸이 겹칠 만큼 가까운 적은 방향과 상관없이 맞는다
    if (half < Math.PI && d > e.r + 10 && (dx * AIM.x + dy * AIM.y) / d < cosHalf) continue;
    hurtEnemy(s, e, dmg, w.def);
  }
  addFx(s, FX.slash, p.x, p.y, range, Math.atan2(AIM.y, AIM.x), half, 0.22);
};

/** 달떡: 적이 있는 곳으로 포물선을 그리며 날아가 떨어진 자리를 터뜨린다 */
const lob: WeaponFire = (s, w, slot, L) => {
  const p = s.player;
  const range = L.range ?? 300;
  const count = L.count ?? 1;
  for (let i = 0; i < count; i++) {
    let tx: number;
    let ty: number;
    const n = collect(s, p.x, p.y, range);
    if (n > 0) {
      const e = s.enemies.items[s.hits[Math.floor(rand(s) * n)]];
      tx = e.x;
      ty = e.y;
    } else {
      const a = Math.atan2(p.fy, p.fx) + (rand(s) - 0.5) * 1.2;
      tx = p.x + Math.cos(a) * range * 0.6;
      ty = p.y + Math.sin(a) * range * 0.6;
    }
    const pr = addProjectile(s, PROJ.cake, MODE.lob, slot, w.def, p.x, p.y, 0, 0, 12, L.dmg * s.stats.might, 5);
    if (!pr) return;
    pr.sx = p.x;
    pr.sy = p.y;
    pr.tx = tx;
    pr.ty = ty;
    pr.dur = 0.5 + i * 0.12;
    // b: 터지는 반지름
    pr.b = (L.radius ?? 70) * s.stats.area;
  }
};

/** 여의주: 구슬 여러 개가 정해진 시간 동안 내 주위를 돈다 */
const orbit: WeaponFire = (s, w, slot, L) => {
  const p = s.player;
  const n = L.count ?? 2;
  const evo = WEAPONS[w.def].evolved;
  for (let i = 0; i < n; i++) {
    const pr = addProjectile(s, evo ? PROJ.pearlEvo : PROJ.pearl, MODE.orbit, slot, w.def, p.x, p.y, 0, 0, (L.size ?? 14) * Math.sqrt(s.stats.area), L.dmg * s.stats.might, L.dur ?? 3);
    if (!pr) return;
    pr.a = w.a + (i * Math.PI * 2) / n;
    pr.b = (L.radius ?? 95) * s.stats.area;
    pr.c = L.spin ?? 3;
    pr.every = Math.round((L.every ?? 0.4) * TICKS_PER_SEC);
  }
  w.a += 0.7;
};

/** 독안개: 적이 있는 바닥에 독 지대를 깐다. 지대 안의 적은 계속 피해를 입는다 */
const pool: WeaponFire = (s, w, slot, L) => {
  const p = s.player;
  const range = L.range ?? 280;
  const count = L.count ?? 1;
  const r = (L.radius ?? 70) * s.stats.area;
  for (let i = 0; i < count; i++) {
    let x: number;
    let y: number;
    const n = collect(s, p.x, p.y, range);
    if (n > 0) {
      const e = s.enemies.items[s.hits[Math.floor(rand(s) * n)]];
      x = e.x;
      y = e.y;
    } else {
      const a = rand(s) * Math.PI * 2;
      x = p.x + Math.cos(a) * range * 0.4;
      y = p.y + Math.sin(a) * range * 0.4;
    }
    addZone(s, ZONE.mist, 0, slot, w.def, x, y, r, 0, L.dur ?? 3, L.every ?? 0.5, L.dmg * s.stats.might * s.stats.dot);
  }
};

export const BEHAVIORS: Record<string, WeaponFire> = { seek, aura, cone, lob, orbit, pool };

/** 발동 간격: 구슬은 도는 시간보다 짧아질 수 없다 (겹쳐서 두 배가 되지 않게) */
function interval(s: State, L: WeaponLevel, def: WeaponDef) {
  const cd = L.cd * s.stats.cooldown;
  return def.kind === 'orbit' ? Math.max(cd, L.dur ?? 0) : cd;
}

/** 걸음마다: 가진 무기의 대기시간을 줄이고, 다 되면 발동한다 */
export function updateWeapons(s: State) {
  for (let slot = 0; slot < s.weapons.length; slot++) {
    const w = s.weapons[slot];
    const def = WEAPONS[w.def];
    const fire = BEHAVIORS[def.kind];
    if (!fire) continue;
    w.cd -= TICK;
    if (w.cd > 0) continue;
    const L = def.levels[Math.min(w.lv, def.levels.length) - 1];
    fire(s, w, slot, L, def);
    emit(s, EV.fire, w.def);
    w.cd += interval(s, L, def);
    if (w.cd < 0) w.cd = 0;
  }
}

/** 무기가 준비됐나 (수치가 있고 동작이 등록돼 있다) */
export const weaponReady = (def: WeaponDef) => def.ready && def.levels.length > 0 && !!BEHAVIORS[def.kind];

import { dirOf, dist2 } from './math.ts';
import { aliveFoes, damageFoe, healHero, settle, type Foe, type RunState, type SimEvent } from './sim.ts';

/**
 * 우정 콤보 12종 · 필살기 12종의 효과 (PRD "캐릭터 12종"). 세기는 초안 — 5단계 밸런스에서 조정.
 * 콤보 세기는 대원 공격력 × 배율 × 콤보 단계 배율(1 + 0.25 × (단계 - 1), 레벨 10·20·30 에 한 단계씩).
 */

/** 콤보 단계 배율 */
export const tierMul = (tier: number) => 1 + 0.25 * (tier - 1);

/** 콤보 범위 (방 좌표 px) */
export const COMBO = {
  /** 땅 울림 반지름 */
  quake: 160,
  /** 레이저 반쪽 두께 */
  laser: 20,
  /** 독 반지름 */
  poison: 200,
  /** 효과 지우기 반지름 */
  cleanse: 200,
  /** 표창 줄 길이 상한 */
  ray: 1200,
};

/** (x,y) 에서 가까운 순서의 살아 있는 요괴 (같으면 먼저 나온 요괴) */
function byDistance(s: RunState, x: number, y: number): Foe[] {
  return aliveFoes(s)
    .map((f, i) => ({ f, i, d: dist2(x, y, f.x, f.y) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((o) => o.f);
}

/** 방 테두리까지의 거리 (방향 dx,dy) */
function toRoomEdge(s: RunState, x: number, y: number, dx: number, dy: number): number {
  let t = COMBO.ray;
  if (dx > 0) t = Math.min(t, (s.cfg.w - x) / dx);
  else if (dx < 0) t = Math.min(t, -x / dx);
  if (dy > 0) t = Math.min(t, (s.cfg.h - y) / dy);
  else if (dy < 0) t = Math.min(t, -y / dy);
  return Math.max(0, t);
}

/** 반직선에 처음 닿는 요괴와 거리 */
function firstOnRay(s: RunState, x: number, y: number, dx: number, dy: number): { f: Foe; t: number } | null {
  let best: { f: Foe; t: number } | null = null;
  for (const f of aliveFoes(s)) {
    const fx = x - f.x;
    const fy = y - f.y;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - f.r * f.r;
    const disc = b * b - c;
    if (disc < 0) continue;
    let t = -b - Math.sqrt(disc);
    if (t < 0) {
      if (c > 0) continue; // 뒤쪽
      t = 0; // 안에 있다
    }
    if (!best || t < best.t) best = { f, t };
  }
  return best;
}

/** j 번째 대원의 우정 콤보 */
export function comboEffect(s: RunState, j: number, ev: SimEvent[]) {
  const h = s.heroes[j];
  const k = tierMul(h.comboTier);
  const atk = h.atk * k;
  const { x, y } = h;
  const lines: [number, number, number, number][] = [];
  const targets: number[] = [];
  let r = 0;
  // 콤보 이벤트를 먼저 보내고 (화면이 효과를 그린 다음) 피해 이벤트가 뒤따른다
  const out: SimEvent = { t: 'combo', hero: j, kind: h.combo, x, y, r, lines, targets };
  ev.push(out);
  const hit = (f: Foe, mul: number) => {
    if (!targets.includes(f.id)) targets.push(f.id);
    damageFoe(s, f, atk * mul, ev);
  };
  switch (h.combo) {
    case 'shuriken':
      for (const a of [450, 1350, 2250, 3150]) {
        const [dx, dy] = dirOf(a);
        const o = firstOnRay(s, x, y, dx, dy);
        const t = o ? o.t : toRoomEdge(s, x, y, dx, dy);
        lines.push([x, y, x + dx * t, y + dy * t]);
        if (o) hit(o.f, 0.6);
      }
      break;
    case 'quake':
      r = COMBO.quake;
      for (const f of aliveFoes(s)) {
        const rr = r + f.r;
        if (dist2(x, y, f.x, f.y) < rr * rr) hit(f, 0.8);
      }
      break;
    case 'laserH':
      lines.push([0, y, s.cfg.w, y]);
      for (const f of aliveFoes(s)) if (Math.abs(f.y - y) < f.r + COMBO.laser) hit(f, 0.7);
      break;
    case 'laserV':
      lines.push([x, 0, x, s.cfg.h]);
      for (const f of aliveFoes(s)) if (Math.abs(f.x - x) < f.r + COMBO.laser) hit(f, 0.7);
      break;
    case 'heal':
      s.heroes.forEach((o, i) => {
        if (o.fallen) return;
        const v = healHero(o, o.maxHp * 0.08 * k);
        if (v > 0) ev.push({ t: 'heal', hero: i, v });
      });
      break;
    case 'poison':
      r = COMBO.poison;
      for (const f of aliveFoes(s)) {
        const rr = r + f.r;
        if (dist2(x, y, f.x, f.y) >= rr * rr) continue;
        targets.push(f.id);
        f.poison = Math.max(f.poison, Math.max(1, Math.round(atk * 0.3)));
        f.poisonTurns = 3;
      }
      break;
    case 'kick': {
      const f = byDistance(s, x, y)[0];
      if (f) {
        lines.push([x, y, f.x, f.y]);
        hit(f, 1.2);
      }
      break;
    }
    case 'guard':
      for (const o of s.heroes) if (!o.fallen) o.shield = true;
      break;
    case 'balls':
      for (const f of byDistance(s, x, y).slice(0, 3)) {
        lines.push([x, y, f.x, f.y]);
        hit(f, 0.5);
      }
      break;
    case 'cleanse':
      // 주변 요괴의 독·똬리를 뺀 나쁜 효과(공격 예고 자리)를 지우고 작은 피해. 대원 쪽 나쁜 효과는 5단계 요괴 행동과 함께
      r = COMBO.cleanse;
      for (const f of aliveFoes(s)) {
        const rr = r + f.r;
        if (dist2(x, y, f.x, f.y) >= rr * rr) continue;
        hit(f, 0.4);
        if (f.alive && f.aim) f.aim = null;
      }
      break;
    case 'fang': {
      const f = byDistance(s, x, y)[0];
      if (f) {
        lines.push([x, y, f.x, f.y]);
        hit(f, 0.6);
        if (f.alive) hit(f, 0.6);
      }
      break;
    }
    case 'coin':
      s.coins += 1 + Math.floor(k);
      break;
  }
  out.r = r;
}

/** i 번째 대원의 필살기 (발사 직전, 조작 각도 a) */
export function specialEffect(s: RunState, i: number, a: number, ev: SimEvent[]) {
  const h = s.heroes[i];
  const m = s.movers[0];
  switch (h.special) {
    case 'swift':
      m.vx *= 2;
      m.vy *= 2;
      m.v0 *= 2;
      break;
    case 'charge':
      m.r = h.r * 2;
      m.pierce = true;
      m.atk = h.atk * 1.2;
      break;
    case 'roar':
      for (const f of aliveFoes(s)) {
        f.left += 1;
        f.aim = null;
      }
      break;
    case 'mooncake': {
      s.heroes.forEach((o, j) => {
        if (o.fallen) return;
        const v = healHero(o, o.maxHp * 0.3);
        if (v > 0) ev.push({ t: 'heal', hero: j, v });
      });
      const j = s.heroes.findIndex((o) => o.fallen);
      if (j >= 0) {
        const o = s.heroes[j];
        o.fallen = false;
        o.hp = Math.max(1, Math.round(o.maxHp * 0.3 * o.healMul));
        o.shield = false;
        settle(s, o);
        ev.push({ t: 'revive', hero: j });
      }
      break;
    }
    case 'dragonfall':
      for (const f of aliveFoes(s)) damageFoe(s, f, h.atk * 2.5, ev);
      break;
    case 'coil': {
      // 가장 먼저 공격할 요괴 (남은 턴이 가장 적은, 같으면 먼저 나온)
      let t: Foe | null = null;
      for (const f of aliveFoes(s)) if (!t || f.left < t.left) t = f;
      if (t) t.frozen = 2;
      break;
    }
    case 'dash':
      m.rerun = true;
      break;
    case 'wool':
      s.guardTurns = 2;
      break;
    case 'clone':
      for (const da of [-300, 300]) {
        const [dx, dy] = dirOf(a + da);
        s.movers.push({ ...m, touching: [], vx: dx * m.v0, vy: dy * m.v0, r: Math.round(h.r * 0.6), atk: h.atk * 0.5, dx, dy, clone: true });
      }
      break;
    case 'dawn':
      s.heroes.forEach((o, j) => {
        if (j !== i && !o.fallen) o.charge = Math.min(o.chargeMax, o.charge + 2);
      });
      break;
    case 'hunt': {
      const weak = aliveFoes(s)
        .map((f, k) => ({ f, k }))
        .sort((x, y) => x.f.hp - y.f.hp || x.k - y.k)
        .slice(0, 3);
      for (const { f } of weak) damageFoe(s, f, h.atk * 1.5, ev);
      break;
    }
    case 'roll':
      m.roll = true;
      break;
  }
}

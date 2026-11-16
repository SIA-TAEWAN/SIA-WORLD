import { ITEMS, ITEM_IDS, TANKS, WEAPONS, type ItemId, type WeaponDef } from './data';
import { Rng } from './rng';
import type { PlayerSetup, ShotResult, SimEvent, TankState, Team, TurnInput, Wall, WallKind, Zone } from './types';
import { MAPS, type MapId } from '../data/maps';
import { Terrain } from '../physics/terrain';
import { fly, tankCenter, TANK_HIT_R, WIND_K, type ImpactHandler } from '../physics/shot';

const MOVE_DELAY_PER_PX = 0.5;
const ULT_PER_DEALT = 0.12;
const ULT_PER_TAKEN = 0.16;
const DIRECT_BONUS = 1.2;
const FALL_OUT_Y = 40;
const LASER_DEPTH = 90;
/** 불·독: 초당 최대체력의 2%, 5초(최대 10%). 장판 크기는 탱크만 하다 */
const DOT_TICKS = 5;
const DOT_RATE = 0.02;
const ZONE_R = 18;
/** 특수 벽이 턴마다 생길 확률 */
const WALL_CHANCE = 0.05;
/** 특수 벽 높이: 탱크 4대 */
const WALL_HEIGHT = 36 * 4;

/** 바람이 바뀌는 빠르기: 턴마다 바뀌는 최대 폭 */
export const WIND_STEPS = { slow: 2, normal: 5, fast: 8 } as const;
export type WindMode = keyof typeof WIND_STEPS;

/** 보급 상자: 10턴마다 비행기가 플레이어마다 하나씩 떨어뜨린다 */
export const DROP_EVERY = 10;
export interface Crate {
  id: number;
  x: number;
  y: number;
  item: ItemId;
}
export interface CrateDrop {
  id: number;
  item: ItemId;
  /** 낙하산 궤적 [x,y,...] (프레임마다). 맵 밖으로 떨어지면 마지막이 맵 아래 */
  path: number[];
  landed: boolean;
}

export interface MatchOptions {
  wind?: WindMode;
  /** 필살기 게이지가 항상 가득 찬 탱크 (AI 대전 '시아') */
  fullUlt?: number[];
}

export class Match {
  readonly mapId: MapId;
  readonly seed: number;
  readonly rng: Rng;
  readonly terrain: Terrain;
  readonly tanks: TankState[];
  wind = 0;
  current = -1;
  turn = 0;
  movedThisTurn = 0;
  moveLeft = 0;
  /** 승리 팀. 무승부는 -1, 진행 중이면 null */
  winner: Team | -1 | null = null;
  crates: Crate[] = [];
  nextCrate = 0;
  /** 땅에 남은 불·독안개 */
  zones: Zone[] = [];
  /** 판마다 무작위 특수 벽 하나 (두 팀 사이 가운데) */
  wall: Wall | null = null;
  nextZone = 0;
  /** 이번 턴 시작에 떨어진 상자 (화면 연출용) */
  lastDrop: CrateDrop[] | null = null;
  /** 상자를 주운 기록 (화면이 꺼내 간다) */
  pickups: { tank: number; crate: number; item: ItemId }[] = [];

  readonly setups: PlayerSetup[];
  readonly options: MatchOptions;

  constructor(setups: PlayerSetup[], mapId: MapId, seed: number, options: MatchOptions = {}) {
    this.setups = setups;
    this.options = options;
    this.mapId = mapId;
    this.seed = seed;
    this.rng = new Rng(seed);
    const map = MAPS[mapId];
    // 특수 맵: 모두 같은 탱크로 고정
    if (map.lockTank) setups = setups.map((s) => ({ ...s, tank: map.lockTank! }));
    this.terrain = map.build(this.rng);

    const byTeam: [PlayerSetup[], PlayerSetup[]] = [[], []];
    setups.forEach((s) => byTeam[s.team].push(s));
    const slotX = new Map<PlayerSetup, number>();
    // 시작 위치는 무작위: 어느 팀이 왼쪽일지, 자기 구역 안 어디에 설지 (같은 팀끼리 70px 이상 떨어지게)
    const swap = this.rng.next() < 0.5;
    ([0, 1] as const).forEach((team) => {
      const [a, b] = (team === 0) !== swap ? map.spawnA : map.spawnB;
      const xs: number[] = [];
      for (const s of byTeam[team]) {
        let x = 0;
        for (let k = 0; k < 30; k++) {
          x = Math.round(this.rng.range(a, b));
          if (xs.every((o) => Math.abs(o - x) >= 70)) break;
        }
        xs.push(x);
        slotX.set(s, x);
      }
    });

    this.tanks = setups.map((s, idx) => {
      const def = TANKS[s.tank];
      const x = slotX.get(s)!;
      const t: TankState = {
        idx,
        name: s.name,
        tankId: s.tank,
        def,
        team: s.team,
        x,
        y: 0,
        hp: def.hp,
        maxHp: def.hp,
        facing: x < this.terrain.w / 2 ? 1 : -1,
        angle: Math.round((def.angleMin + def.angleMax) / 2),
        delay: this.rng.int(0, 120),
        ult: 0,
        alive: true,
        items: [...s.items.slice(0, 3), null, null, null].slice(0, 3) as (ItemId | null)[],
        damageDealt: 0,
        ai: s.ai,
        lastPower: 0,
      };
      // 스폰 위치의 땅이 없으면 가까운 땅을 찾는다
      let gx = x;
      for (let d = 0; d < 300 && this.terrain.surface(gx) < 0; d++) gx = x + (d % 2 ? d : -d);
      t.x = gx;
      t.y = Math.max(0, this.terrain.surface(gx));
      return t;
    });
  }

  /** 두 팀 탱크 사이 가운데에 4종 중 하나 (3턴 동안) */
  private placeWall(): Wall {
    const kinds: WallKind[] = ['amp', 'whirl', 'double', 'triple'];
    const kind = kinds[this.rng.int(0, 3)];
    const avg = (team: number) => {
      const xs = this.tanks.filter((t) => t.team === team).map((t) => t.x);
      return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    };
    const alive = (team: number) => this.tanks.some((t) => t.team === team && t.alive);
    const x = Math.round(Math.max(30, Math.min(this.terrain.w - 30, (alive(0) && alive(1) ? (avg(0) + avg(1)) / 2 : this.terrain.w / 2) + this.rng.range(-20, 20))));
    let bottom = 0;
    while (bottom < this.terrain.h && !this.terrain.solid(x, bottom)) bottom++;
    return { kind, x, bottom, top: Math.max(0, bottom - WALL_HEIGHT), until: this.turn + 3 };
  }

  get cur(): TankState {
    return this.tanks[this.current];
  }

  weaponOf(t: TankState, slot: 0 | 1 | 2): WeaponDef {
    return WEAPONS[t.def.weapons[slot]];
  }

  /** 다음 턴 순서 (딜레이 낮은 순) */
  order(): TankState[] {
    return this.tanks.filter((t) => t.alive).sort((a, b) => a.delay - b.delay || a.idx - b.idx);
  }

  startTurn(): TankState {
    const next = this.order()[0];
    this.current = next.idx;
    this.turn++;
    // 특수 벽: 3턴이 지나면 사라지고, 없을 때만 턴마다 5% 확률로 생긴다
    if (this.wall && this.turn >= this.wall.until) this.wall = null;
    if (!this.wall && this.rng.next() < WALL_CHANCE) this.wall = this.placeWall();
    // 바람은 직전 바람에서 ±0~(빠르기)만 바뀐다 (첫 턴은 -5~5)
    const step = this.turn === 1 ? 5 : WIND_STEPS[this.options.wind ?? 'normal'];
    const dw = this.rng.int(-step, step);
    this.wind = this.turn === 1 ? dw : Math.max(-10, Math.min(10, this.wind + dw));
    this.moveLeft = next.def.move;
    this.refillUlt();
    this.movedThisTurn = 0;
    // 내 차례가 오면 내가 만든 불·독안개는 사라진다
    this.zones = this.zones.filter((z) => (z.until !== undefined ? this.turn < z.until : z.owner !== next.idx));
    this.lastDrop = this.turn % DROP_EVERY === 0 ? this.dropCrates() : null;
    return next;
  }

  /** 비행기가 살아 있는 플레이어마다 상자 하나씩, 그 근처 하늘에서 떨어뜨린다 (바람을 탄다) */
  private dropCrates(): CrateDrop[] {
    const drops: CrateDrop[] = [];
    const T = this.terrain;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const item = ITEM_IDS[this.rng.int(0, ITEM_IDS.length - 1)];
      let x = Math.max(20, Math.min(T.w - 20, t.x + this.rng.int(-160, 160)));
      let y = -60;
      let vx = 0;
      const path = [x, y];
      let landed = false;
      for (let f = 0; f < 60 * 30; f++) {
        vx += this.wind * WIND_K * 0.5 * (1 / 60);
        vx = Math.max(-80, Math.min(80, vx));
        x += vx / 60;
        y += 75 / 60;
        if (f % 2 === 0) path.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
        if (x < 4 || x > T.w - 4 || y > T.h + 40) break;
        if (y > 0 && T.solid(Math.round(x), Math.round(y) + 1)) {
          landed = true;
          break;
        }
      }
      const id = this.nextCrate++;
      path.push(x, y);
      if (landed) this.crates.push({ id, x: Math.round(x), y: Math.round(y), item });
      drops.push({ id, item, path, landed });
    }
    return drops;
  }

  /** 상자 아래 땅이 없어지면 떨어진다 */
  private settleCrates() {
    const T = this.terrain;
    this.crates = this.crates.filter((c) => {
      while (!T.solid(c.x, c.y + 1) && c.y < T.h + 40) c.y++;
      return c.y < T.h + 40;
    });
  }

  /** 탱크가 상자에 닿으면 빈 아이템 칸에 넣는다 (칸이 꽉 차 있으면 그대로 둔다) */
  pickup() {
    for (const t of this.tanks) {
      if (!t.alive) continue;
      for (const c of [...this.crates]) {
        if (Math.abs(t.x - c.x) > 16 || Math.abs(t.y - c.y) > 24) continue;
        const slot = t.items.findIndex((i) => !i);
        if (slot < 0) continue;
        t.items[slot] = c.item;
        this.crates = this.crates.filter((x) => x !== c);
        this.pickups.push({ tank: t.idx, crate: c.id, item: c.item });
      }
    }
  }

  // ---------- 탱크 이동 ----------

  supported(t: { x: number; y: number }): boolean {
    for (let dx = -7; dx <= 7; dx += 2) if (this.terrain.solid(t.x + dx, t.y)) return true;
    return false;
  }

  /** 땅에 묻혔으면 위로, 공중이면 아래로 내린다. 맵 밖으로 떨어지면 false */
  settle(t: TankState): boolean {
    let up = 0;
    while (this.terrain.solid(t.x, t.y - 1) && up < 160) {
      t.y--;
      up++;
    }
    while (!this.supported(t) && t.y < this.terrain.h + FALL_OUT_Y) t.y++;
    if (t.y >= this.terrain.h + FALL_OUT_Y) {
      t.alive = false;
      t.hp = 0;
      return false;
    }
    return true;
  }

  /** 현재 탱크를 1px 움직인다. 움직였으면 true */
  moveStep(dir: 1 | -1): boolean {
    const t = this.cur;
    t.facing = dir;
    if (this.moveLeft <= 0 || !t.alive) return false;
    const nx = t.x + dir;
    if (nx < 8 || nx > this.terrain.w - 8) return false;
    let ny = t.y;
    if (this.terrain.solid(nx, ny - 1)) {
      let k = 1;
      while (k <= 4 && this.terrain.solid(nx, ny - 1 - k)) k++;
      if (k > 4) return false;
      ny -= k;
    }
    t.x = nx;
    t.y = ny;
    this.moveLeft--;
    this.movedThisTurn++;
    this.settle(t);
    this.pickup();
    if (!t.alive) this.checkWinner();
    return true;
  }

  /**
   * 탱크가 선 땅의 기울기(도). 오른쪽이 높으면 +.
   * 포신 각도는 몸체 기준이라 실제 발사각 = 각도 + 바라보는 방향 × 기울기.
   */
  tilt(t: { x: number; y: number }): number {
    const ground = (x: number) => {
      for (let y = t.y - 22; y <= t.y + 22; y++) if (this.terrain.solid(x, y)) return y;
      return t.y + 6;
    };
    const l = ground(t.x - 10);
    const r = ground(t.x + 10);
    const deg = Math.round((Math.atan2(l - r, 20) * 180) / Math.PI);
    return Math.max(-40, Math.min(40, deg));
  }

  /** 몸체 기준 포신 각도 → 실제 발사각 */
  worldAngle(t: TankState, angle = t.angle, facing: number = t.facing): number {
    return angle + facing * this.tilt(t);
  }

  setAngle(a: number) {
    const t = this.cur;
    t.angle = Math.max(t.def.angleMin, Math.min(t.def.angleMax, a));
  }

  /** 수리킷처럼 누르는 즉시 효과가 나는 아이템. 회복량을 돌려주고, 쓸 수 없으면 null */
  useItemNow(slot: number): number | null {
    const t = this.cur;
    if (!t || !t.alive || t.items[slot] !== 'repair' || t.hp >= t.maxHp) return null;
    const amount = Math.min(t.maxHp - t.hp, Math.round(t.maxHp * 0.2));
    t.hp += amount;
    t.items[slot] = null;
    t.delay += ITEMS.repair.delay;
    return amount;
  }

  /** 이 맵에서 쓸 수 있는 유일한 무기 (없으면 undefined) */
  get weaponLock(): 0 | 1 | 2 | undefined {
    return MAPS[this.mapId].lockWeapon;
  }

  canUseUlt(t: TankState) {
    return t.ult >= 100;
  }

  // ---------- 턴 진행 ----------

  /** 시간 초과 등으로 쏘지 않고 넘어간다 */
  skipTurn() {
    const t = this.cur;
    t.delay += t.def.delay + this.movedThisTurn * MOVE_DELAY_PER_PX;
  }

  fire(input: TurnInput): ShotResult {
    const t = this.cur;
    const events: SimEvent[] = [];
    t.facing = input.facing;
    this.setAngle(input.angle);
    t.lastPower = input.power;

    let slot = this.weaponLock ?? input.weapon;
    if (slot === 2 && !this.canUseUlt(t)) slot = 0;
    if (slot === 2) t.ult = 0;
    const w = this.weaponOf(t, slot);

    let item: ItemId | null = null;
    if (input.itemSlot !== null && t.items[input.itemSlot]) {
      item = t.items[input.itemSlot];
      t.items[input.itemSlot] = null;
    }

    t.delay += t.def.delay + w.delay + (item ? ITEMS[item].delay : 0) + this.movedThisTurn * MOVE_DELAY_PER_PX;

    if (item === 'repair') {
      const amount = Math.min(t.maxHp - t.hp, Math.round(t.maxHp * 0.2));
      t.hp += amount;
      events.push({ f: 0, type: 'heal', target: t.idx, amount });
    }
    const damageMul = item === 'power' ? 1.3 : 1;
    // 세게 쏠수록(파워·파워업) 땅을 더 크게 판다: 파워 0이면 기본 크기, 100이면 1.5배
    const crater = Math.round(w.crater * (1 + (0.5 * Math.max(0, Math.min(100, input.power))) / 100) * damageMul);
    const volleys = item === 'double' ? 2 : 1;

    const moved = new Set<number>();
    const knockPos = (target: TankState, f: number) => {
      moved.add(target.idx);
      events.push({ f, type: 'move', target: target.idx, x: target.x, y: target.y, kind: 'knock' });
    };

    const hurt = (f: number, target: TankState, raw: number, direct: boolean) => {
      if (!target.alive) return;
      // 내 포탄·팀 포탄에도 피해를 입는다 (게이지·딜량은 적에게 준 것만)
      const enemy = target.team !== t.team;
      const dmg = Math.round(raw * (1 - target.def.defense));
      if (dmg <= 0) return;
      const real = Math.min(dmg, target.hp);
      target.hp -= real;
      if (enemy) t.damageDealt += real;
      // 필살기로 준 피해로는 게이지가 다시 차지 않는다
      if (slot !== 2 && enemy) t.ult = Math.min(100, t.ult + real * ULT_PER_DEALT);
      // 맞으면 (적·아군·내 포탄 모두) 게이지가 찬다. 단, 내 필살기에 내가 맞은 건 빼고
      if (!(slot === 2 && target === t)) target.ult = Math.min(100, target.ult + real * ULT_PER_TAKEN);
      events.push({ f, type: 'damage', target: target.idx, amount: real, direct });
      if (target.hp <= 0) {
        target.alive = false;
        events.push({ f, type: 'death', target: target.idx });
      }
    };

    /** 이번 발사로 불·독에 걸린 탱크 */
    const afflicted = new Map<number, 'fire' | 'poison'>();
    /** 이번 발사로 막 중독된 탱크 (피해는 다음 차례부터) */
    const fresh = new Set<number>();
    let result: ShotResult;
    {
      const handler: ImpactHandler = {
        explode: (f, x, y, direct, scale = 1, boost = 1) => {
          // boost: 증폭벽을 지난 탄 (파워업처럼 피해·구덩이 증가)
          const cr = Math.max(4, Math.round(crater * scale * boost));
          this.terrain.carve(x, y, cr);
          // 폭발이 덮친 불은 꺼진다
          this.zones = this.zones.filter((z) => z.kind !== 'fire' || Math.hypot(z.x - x, z.y - y) > cr + z.r);
          let zone: Zone | undefined;
          if (w.zone) {
            // 불·독안개는 터진 자리 아래 땅 위에 생긴다
            const zx = Math.round(x);
            let zy = Math.max(0, Math.round(y));
            while (zy < this.terrain.h && !this.terrain.solid(zx, zy + 1)) zy++;
            zone = { id: this.nextZone++, kind: w.zone, x: zx, y: zy, r: w.zoneR ?? ZONE_R, h: w.zoneH, owner: t.idx, until: w.zone === 'fire' ? this.turn + 3 : undefined };
            this.zones.push(zone);
          }
          events.push({ f, type: 'explode', x, y, radius: w.radius, crater: cr, big: slot === 2, fx: w.fx, zone: zone ? { ...zone } : undefined });
          for (const o of this.tanks) {
            if (!o.alive) continue;
            const c = tankCenter(o);
            const d = o.idx === direct ? 0 : Math.max(0, Math.hypot(c.x - x, c.y - y) - TANK_HIT_R * 0.5);
            if (d > w.radius) continue;
            const raw = w.damage * damageMul * boost * (1 - d / w.radius) * (o.idx === direct ? DIRECT_BONUS : 1);
            const wasAlive = o.alive;
            hurt(f, o, raw, o.idx === direct);
            // 중독: 맞은 탱크의 다음 차례 3번 동안 피해
            if (w.poison && o.alive && o.team !== t.team && o.idx !== t.idx) {
              if (!(o.poison ?? 0)) events.push({ f, type: 'poisoned', target: o.idx });
              o.poison = 3;
              fresh.add(o.idx);
            }
            if (w.behavior === 'push' && wasAlive && o.alive && o.team !== t.team) {
              const k = (w.knockback ?? 100) * (1 - d / w.radius);
              const dir = c.x >= x ? 1 : -1;
              o.x = Math.max(8, Math.min(this.terrain.w - 8, Math.round(o.x + dir * k)));
              o.y = Math.min(o.y, this.terrain.h - 1);
              this.settle(o);
              knockPos(o, f);
              if (!o.alive) events.push({ f, type: 'death', target: o.idx });
            }
          }
        },
        build: (f, x, y) => {
          this.terrain.circle(x, y, w.crater, 1);
          events.push({ f, type: 'build', x, y, r: w.crater });
        },
        laser: (f, x, y) => {
          const y2 = Math.min(this.terrain.h + 50, y + LASER_DEPTH);
          this.terrain.carveLine(x, -60, x, y2, w.crater);
          events.push({ f, type: 'laser', x1: x, y1: -400, x2: x, y2, r: w.crater });
          for (const o of this.tanks) {
            const c = tankCenter(o);
            if (Math.abs(c.x - x) <= w.radius + TANK_HIT_R && c.y <= y2 + TANK_HIT_R) hurt(f, o, w.damage * damageMul, true);
          }
        },
        carveLine: (f, x1, y1, x2, y2, r) => {
          this.terrain.carveLine(x1, y1, x2, y2, r);
          events.push({ f, type: 'carveLine', x1, y1, x2, y2, r });
        },
      };
      const out = fly(this, { owner: t.idx, facing: input.facing, angle: this.worldAngle(t, t.angle, input.facing), power: input.power, weapon: w, damageMul, volleys, tilt: this.tilt(t), big: slot === 2 }, handler);
      const firstImpact = out.impacts[0] ? { x: out.impacts[0].x, y: out.impacts[0].y } : null;
      result = { frames: out.frames, shells: out.shells, events, firstImpact };

      if (item === 'teleport' && firstImpact && t.alive && firstImpact.x > 8 && firstImpact.x < this.terrain.w - 8 && firstImpact.y < this.terrain.h) {
        t.x = Math.round(firstImpact.x);
        t.y = Math.round(Math.max(0, firstImpact.y));
        events.push({ f: out.frames, type: 'move', target: t.idx, x: t.x, y: t.y, kind: 'teleport' });
        moved.add(t.idx);
      }
    }

    // 땅이 사라진 탱크는 떨어진다
    // 폭죽처럼 늦게 터지는 폭발까지 기다린다
    const endF = Math.max(result.frames, ...events.map((e) => e.f + 1));
    for (const o of this.tanks) {
      if (!o.alive) continue;
      const before = { x: o.x, y: o.y };
      const ok = this.settle(o);
      if (o.y !== before.y || o.x !== before.x || moved.has(o.idx)) {
        events.push({ f: endF, type: 'move', target: o.idx, x: o.x, y: o.y, kind: 'fall' });
      }
      if (!ok) events.push({ f: endF, type: 'death', target: o.idx });
    }
    result.frames = endF;
    this.settleCrates();
    this.settleZones();
    result.frames = this.applyDots(t, afflicted, events, endF, fresh);
    events.sort((a, b) => a.f - b.f);
    this.refillUlt();
    this.pickup();
    this.checkWinner();
    return result;
  }

  /**
   * 불·독안개 위에 있는 적, 중독된 적에게 초당 2%씩 5번 (최대 10%) 피해. 체력 1은 남긴다.
   * 누군가를 태운(중독시킨) 장판은 사라진다. 끝나는 프레임을 돌려준다.
   */
  private applyDots(shooter: TankState, afflicted: Map<number, 'fire' | 'poison'>, events: SimEvent[], endF: number, fresh = new Set<number>()): number {
    for (const z of [...this.zones]) {
      let used = false;
      for (const o of this.tanks) {
        if (!o.alive || o.team === this.tanks[z.owner].team) continue;
        const c = tankCenter(o);
        // 장판: 가로는 반지름, 위로는 높이(h)까지
        const up = z.h ?? z.r;
        if (Math.abs(c.x - z.x) > z.r + TANK_HIT_R || c.y < z.y - up - TANK_HIT_R || c.y > z.y + TANK_HIT_R) continue;
        if (!afflicted.has(o.idx)) afflicted.set(o.idx, z.kind);
        used = true;
      }
      if (used) this.zones = this.zones.filter((x) => x !== z);
    }
    // 중독(꼬꼬댁): 3턴 동안 턴마다 피해
    // 중독: 누구 차례든 차례가 끝날 때마다 (3번). 막 중독된 탱크는 다음 차례부터
    const sick = new Set<number>();
    for (const o of this.tanks)
      if (o.alive && (o.poison ?? 0) > 0 && !fresh.has(o.idx)) {
        sick.add(o.idx);
        if (!afflicted.has(o.idx)) afflicted.set(o.idx, 'poison');
      }
    if (!afflicted.size) return endF;
    let last = endF;
    for (const [idx, kind] of [...afflicted].sort((a, b) => a[0] - b[0])) {
      const o = this.tanks[idx];
      const per = Math.max(1, Math.round(o.maxHp * DOT_RATE));
      for (let i = 0; i < DOT_TICKS; i++) {
        const f = endF + 40 + i * 60;
        const amount = Math.max(0, Math.min(per, o.hp - 1));
        o.hp -= amount;
        shooter.damageDealt += amount;
        const lastTick = i === DOT_TICKS - 1;
        if (lastTick && sick.has(o.idx)) o.poison!--;
        events.push({ f, type: 'dot', target: idx, amount, kind, last: lastTick, stay: lastTick && (o.poison ?? 0) > 0 });
        last = Math.max(last, f);
      }
    }
    // 지속 피해는 게임을 멈추지 않는다 (다음 차례와 함께 화면에서 이어서 보여 준다)
    void last;
    return endF;
  }

  /** 발밑 땅이 사라진 장판은 아래 땅으로 내려온다 */
  private settleZones() {
    this.zones = this.zones.filter((z) => {
      while (z.y < this.terrain.h && !this.terrain.solid(z.x, z.y + 1)) z.y++;
      return z.y < this.terrain.h;
    });
  }

  /** 필살기 무한 탱크는 게이지를 다시 채운다 */
  refillUlt() {
    for (const i of this.options.fullUlt ?? []) if (this.tanks[i]) this.tanks[i].ult = 100;
  }

  checkWinner() {
    const teams = new Set(this.tanks.filter((t) => t.alive).map((t) => t.team));
    if (teams.size === 0) this.winner = -1;
    else if (teams.size === 1) this.winner = [...teams][0];
  }

  /** 기기 간 비교용 상태 지문 (지형 + 탱크 + 난수 상태) */
  stateHash(): string {
    const tanks = this.tanks.map((t) => [t.x, t.y, t.hp, t.alive ? 1 : 0, Math.round(t.delay * 10), Math.round(t.ult * 10), t.poison ?? 0].join(',')).join(';');
    const crates = this.crates.map((c) => `${c.id}:${c.x},${c.y}`).join(';');
    const zones = this.zones.map((z) => `${z.id}:${z.kind}:${z.x},${z.y}`).join(';');
    const wall = this.wall ? `${this.wall.kind}:${this.wall.x}:${this.wall.until}` : '';
    return `${this.turn}|${this.rng.state}|${this.terrain.hash()}|${tanks}|${crates}|${zones}|${wall}`;
  }

  snapshot(): MatchSnapshot {
    return {
      setups: this.setups,
      options: this.options,
      mapId: this.mapId,
      seed: this.seed,
      turn: this.turn,
      current: this.current,
      wind: this.wind,
      moveLeft: this.moveLeft,
      movedThisTurn: this.movedThisTurn,
      rng: this.rng.state,
      winner: this.winner,
      terrain: this.terrain.encode(),
      crates: this.crates.map((c) => ({ ...c })),
      nextCrate: this.nextCrate,
      zones: this.zones.map((z) => ({ ...z })),
      nextZone: this.nextZone,
      wall: this.wall ? { ...this.wall } : null,
      tanks: this.tanks.map((t) => ({
        x: t.x, y: t.y, hp: t.hp, facing: t.facing, angle: t.angle, delay: t.delay, ult: t.ult,
        alive: t.alive, items: [...t.items], damageDealt: t.damageDealt, ai: t.ai, lastPower: t.lastPower, poison: t.poison ?? 0,
      })),
    };
  }

  static fromSnapshot(s: MatchSnapshot): Match {
    const m = new Match(s.setups, s.mapId, s.seed, s.options ?? {});
    m.turn = s.turn;
    m.current = s.current;
    m.wind = s.wind;
    m.moveLeft = s.moveLeft;
    m.movedThisTurn = s.movedThisTurn;
    m.rng.state = s.rng;
    m.winner = s.winner;
    m.terrain.decode(s.terrain);
    m.crates = (s.crates ?? []).map((c) => ({ ...c }));
    m.nextCrate = s.nextCrate ?? 0;
    m.zones = (s.zones ?? []).map((z) => ({ ...z }));
    m.nextZone = s.nextZone ?? 0;
    m.wall = s.wall ? { ...s.wall } : null;
    s.tanks.forEach((d, i) => Object.assign(m.tanks[i], d));
    return m;
  }

  get over() {
    return this.winner !== null;
  }
}

export interface MatchSnapshot {
  setups: PlayerSetup[];
  options?: MatchOptions;
  mapId: MapId;
  seed: number;
  turn: number;
  current: number;
  wind: number;
  moveLeft: number;
  movedThisTurn: number;
  rng: number;
  winner: Team | -1 | null;
  terrain: string;
  crates?: Crate[];
  nextCrate?: number;
  zones?: Zone[];
  nextZone?: number;
  wall?: Wall | null;
  tanks: Pick<TankState, 'x' | 'y' | 'hp' | 'facing' | 'angle' | 'delay' | 'ult' | 'alive' | 'items' | 'damageDealt' | 'ai' | 'lastPower' | 'poison'>[];
}

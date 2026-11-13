import { ITEMS, ITEM_IDS, TANKS, WEAPONS, type ItemId, type WeaponDef } from './data';
import { Rng } from './rng';
import type { PlayerSetup, ShotResult, SimEvent, TankState, Team, TurnInput } from './types';
import { MAPS, type MapId } from '../data/maps';
import { Terrain } from '../physics/terrain';
import { fly, tankCenter, TANK_HIT_R, WIND_K, type ImpactHandler } from '../physics/shot';

const MOVE_DELAY_PER_PX = 0.5;
const ULT_PER_DEALT = 0.12;
const ULT_PER_TAKEN = 0.16;
const DIRECT_BONUS = 1.2;
const FALL_OUT_Y = 40;
const LASER_DEPTH = 90;

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
    this.terrain = map.build(this.rng);

    const byTeam: [PlayerSetup[], PlayerSetup[]] = [[], []];
    setups.forEach((s) => byTeam[s.team].push(s));
    const slotX = new Map<PlayerSetup, number>();
    ([0, 1] as const).forEach((team) => {
      const [a, b] = team === 0 ? map.spawnA : map.spawnB;
      const list = byTeam[team];
      list.forEach((s, i) => {
        const span = (b - a) / list.length;
        const center = a + span * (i + 0.5);
        slotX.set(s, Math.round(center + this.rng.range(-span * 0.25, span * 0.25)));
      });
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
        facing: s.team === 0 ? 1 : -1,
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
    // 바람은 직전 바람에서 ±0~(빠르기)만 바뀐다 (첫 턴은 -5~5)
    const step = this.turn === 1 ? 5 : WIND_STEPS[this.options.wind ?? 'normal'];
    const dw = this.rng.int(-step, step);
    this.wind = this.turn === 1 ? dw : Math.max(-10, Math.min(10, this.wind + dw));
    this.moveLeft = next.def.move;
    this.movedThisTurn = 0;
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

    let slot = input.weapon;
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
      if (!target.alive || target.team === t.team) return;
      const dmg = Math.round(raw * (1 - target.def.defense));
      if (dmg <= 0) return;
      const real = Math.min(dmg, target.hp);
      target.hp -= real;
      t.damageDealt += real;
      t.ult = Math.min(100, t.ult + real * ULT_PER_DEALT);
      target.ult = Math.min(100, target.ult + real * ULT_PER_TAKEN);
      events.push({ f, type: 'damage', target: target.idx, amount: real, direct });
      if (target.hp <= 0) {
        target.alive = false;
        events.push({ f, type: 'death', target: target.idx });
      }
    };

    let result: ShotResult;
    {
      const handler: ImpactHandler = {
        explode: (f, x, y, direct) => {
          this.terrain.carve(x, y, crater);
          events.push({ f, type: 'explode', x, y, radius: w.radius, crater, big: slot === 2 });
          for (const o of this.tanks) {
            if (!o.alive) continue;
            const c = tankCenter(o);
            const d = o.idx === direct ? 0 : Math.max(0, Math.hypot(c.x - x, c.y - y) - TANK_HIT_R * 0.5);
            if (d > w.radius) continue;
            const raw = w.damage * damageMul * (1 - d / w.radius) * (o.idx === direct ? DIRECT_BONUS : 1);
            const wasAlive = o.alive;
            hurt(f, o, raw, o.idx === direct);
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
    const endF = result.frames;
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
    this.pickup();
    this.checkWinner();
    return result;
  }

  checkWinner() {
    const teams = new Set(this.tanks.filter((t) => t.alive).map((t) => t.team));
    if (teams.size === 0) this.winner = -1;
    else if (teams.size === 1) this.winner = [...teams][0];
  }

  /** 기기 간 비교용 상태 지문 (지형 + 탱크 + 난수 상태) */
  stateHash(): string {
    const tanks = this.tanks.map((t) => [t.x, t.y, t.hp, t.alive ? 1 : 0, Math.round(t.delay * 10), Math.round(t.ult * 10)].join(',')).join(';');
    const crates = this.crates.map((c) => `${c.id}:${c.x},${c.y}`).join(';');
    return `${this.turn}|${this.rng.state}|${this.terrain.hash()}|${tanks}|${crates}`;
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
      tanks: this.tanks.map((t) => ({
        x: t.x, y: t.y, hp: t.hp, facing: t.facing, angle: t.angle, delay: t.delay, ult: t.ult,
        alive: t.alive, items: [...t.items], damageDealt: t.damageDealt, ai: t.ai, lastPower: t.lastPower,
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
  tanks: Pick<TankState, 'x' | 'y' | 'hp' | 'facing' | 'angle' | 'delay' | 'ult' | 'alive' | 'items' | 'damageDealt' | 'ai' | 'lastPower'>[];
}

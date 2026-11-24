/**
 * 자동 조종 봇: 시뮬레이션(src/game/sim.ts)을 사람처럼 눌러서 층을 끝까지 오른다 (밸런스·막힘 확인용).
 * - 잠긴 방: 가장 가까운 적에게 붙어 3타 콤보, 예고(분홍 범위)가 보이면 피한다, 혼력이 차면 스킬
 * - 열린 방: 상자 → 퍼즐(쥐: 스위치를 맞힐 자리에서 참격, 소: 바위 옆에서 영체 팔) → 구슬 → 샘 → 상점 → 적이 남은 방 → 계단
 */
import { T, TILE, type FloorMap } from '../src/game/floorgen';
import { generateFloor } from '../src/game/floorgen';
import { buy, clearFloor, die, type TowerData } from '../src/game/progress';
import { BODY_UP, FACE_VEC, blockedFor, createRun, maxHp, maxMp, noInput, step, tileOf, type Enemy, type Input, type RunState } from '../src/game/sim';
import type { ItemId } from '../src/data';

interface Goal {
  /** 목표 칸 */
  tx: number;
  ty: number;
  /** 도착하면 바라볼 쪽 (FACE_VEC 번호) */
  face?: number;
  act: 'interact' | 'skill' | 'walk' | 'shop';
  key: string;
}

export interface BotOptions {
  /** 최대 시뮬레이션 시간 (초) */
  maxTime?: number;
  /** 휴식층에서 살 것 */
  shopping?: boolean;
}

const center = (t: number) => t * TILE + TILE / 2;

function bfs(s: RunState, sx: number, sy: number, goal: (x: number, y: number) => boolean): [number, number][] | null {
  const w = s.map.w;
  const prev = new Int32Array(w * s.map.h).fill(-2);
  const q: number[] = [sy * w + sx];
  prev[q[0]] = -1;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    const x = cur % w;
    const y = (cur - x) / w;
    if (goal(x, y)) {
      const path: [number, number][] = [];
      for (let c = cur; c !== -1; c = prev[c]) path.push([c % w, Math.floor(c / w)]);
      return path.reverse();
    }
    for (const [dx, dy] of FACE_VEC) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= s.map.h) continue;
      const n = ny * w + nx;
      if (prev[n] !== -2 || blockedFor(s, nx, ny, 'p')) continue;
      prev[n] = cur;
      q.push(n);
    }
  }
  return null;
}

export class Bot {
  private path: [number, number][] = [];
  private pathFor = '';
  private repath = 0;
  private done = new Set<string>();
  private stuck = 0;
  private lastPos = { x: 0, y: 0 };
  shopped = false;

  constructor(private opts: BotOptions = {}) {}

  decide(s: RunState): Input {
    const inp = noInput();
    const p = s.p;
    if (p.hp < maxHp(s) * 0.4 && (s.data.items.potionL > 0 || s.data.items.potionS > 0)) inp.potion = true;
    if ((p.poison > 0 || p.slow > 0) && s.data.items.cleanse > 0 && s.locked.size) inp.potion = false;

    // 1) 예고 피하기
    const dodge = this.dodge(s);
    if (dodge) {
      inp.mx = dodge[0];
      inp.my = dodge[1];
      return inp;
    }
    // 2) 싸움
    const room = s.room;
    const foes = s.enemies.filter((e) => e.alive && e.active && (e.room === room || s.locked.has(e.room)));
    if (foes.length) return this.fight(s, foes, inp);

    // 3) 할 일
    const g = this.goal(s);
    if (!g) return inp;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor((p.y - 2) / TILE);
    if (ptx === g.tx && pty === g.ty && Math.abs(p.x - center(g.tx)) < 3 && Math.abs(p.y - (center(g.ty) + 3)) < 4) {
      if (g.face !== undefined && p.face !== g.face) {
        // 제자리에서 그쪽으로 한 걸음 (돌아보기)
        inp.mx = FACE_VEC[g.face][0];
        inp.my = FACE_VEC[g.face][1];
        return inp;
      }
      if (g.act === 'interact') inp.interact = true;
      if (g.act === 'skill' && !p.swing && p.skillCd <= 0) {
        inp.skill = true;
        this.done.add(g.key);
      }
      if (g.act === 'shop') this.shop(s);
      if (g.act === 'walk') this.done.add(g.key);
      return inp;
    }
    this.walkTo(s, g.tx, g.ty, g.key, inp);
    return inp;
  }

  private shop(s: RunState) {
    this.shopped = true;
    this.done.add('shop');
    if (this.opts.shopping === false) return;
    const f = s.map.floor;
    const want: ItemId[] = ['shard', 'revive', 'potionL', 'potionL', 'potionL', 'mana', 'cleanse', 'map', 'potionL', 'potionL', 'potionL', 'potionS', 'potionS'];
    for (const id of want) buy(s.data, id, f);
  }

  private walkTo(s: RunState, tx: number, ty: number, key: string, inp: Input) {
    const p = s.p;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor((p.y - 2) / TILE);
    if (this.pathFor !== key || --this.repath <= 0 || !this.path.length) {
      this.path = bfs(s, ptx, pty, (x, y) => x === tx && y === ty) ?? [];
      this.pathFor = key;
      this.repath = 30;
      if (!this.path.length) {
        this.done.add(key);
        return;
      }
    }
    // 지나온 칸은 버린다
    while (this.path.length > 1 && this.path[0][0] === ptx && this.path[0][1] === pty) this.path.shift();
    const [nx, ny] = this.path[0];
    const gx = center(nx);
    const gy = center(ny) + 3;
    const dx = gx - p.x;
    const dy = gy - p.y;
    if (Math.abs(dx) > Math.abs(dy)) inp.mx = Math.sign(dx);
    else if (Math.abs(dy) > 0.5) inp.my = Math.sign(dy);
    else if (Math.abs(dx) > 0.5) inp.mx = Math.sign(dx);
    // 오래 못 움직이면 다른 길
    if (Math.hypot(p.x - this.lastPos.x, p.y - this.lastPos.y) < 0.05) {
      if (++this.stuck > 90) {
        this.stuck = 0;
        this.done.add(key);
      }
    } else this.stuck = 0;
    this.lastPos = { x: p.x, y: p.y };
  }

  private dodge(s: RunState): [number, number] | null {
    const p = s.p;
    const px = p.x;
    const py = p.y - BODY_UP;
    for (const e of s.enemies) {
      const t = e.tele;
      if (!e.alive || !t) continue;
      if (t.kind === 'circle') {
        const d = Math.hypot(px - t.x, py - t.y);
        if (d < t.r + 10) {
          const dx = px - t.x || 0.1;
          const dy = py - t.y || 0.1;
          return this.free(s, Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)], [Math.sign(dx), Math.sign(dy)]);
        }
      } else {
        // 선: 옆으로 비킨다
        const rx = px - t.x;
        const ry = py - t.y;
        const along = rx * t.dx + ry * t.dy;
        const side = rx * -t.dy + ry * t.dx;
        if (along > -8 && along < t.len + 8 && Math.abs(side) < t.r + 10) {
          const sg = side >= 0 ? 1 : -1;
          const perp: [number, number] = [-t.dy * sg, t.dx * sg];
          return this.free(s, Math.abs(perp[0]) > Math.abs(perp[1]) ? [Math.sign(perp[0]), 0] : [0, Math.sign(perp[1])], [Math.sign(perp[0]), Math.sign(perp[1])]);
        }
      }
    }
    for (const pr of s.projs) {
      if (pr.from !== 'e') continue;
      const rx = px - pr.x;
      const ry = py - pr.y;
      const v = Math.hypot(pr.vx, pr.vy) || 1;
      const along = (rx * pr.vx + ry * pr.vy) / v;
      const side = (rx * -pr.vy + ry * pr.vx) / v;
      if (along > 0 && along < 50 && Math.abs(side) < pr.r + 7) {
        const sg = side >= 0 ? 1 : -1;
        const perp: [number, number] = [(-pr.vy / v) * sg, (pr.vx / v) * sg];
        return this.free(s, Math.abs(perp[0]) > Math.abs(perp[1]) ? [Math.sign(perp[0]), 0] : [0, Math.sign(perp[1])], [Math.sign(perp[0]), Math.sign(perp[1])]);
      }
    }
    return null;
  }

  /** 막히지 않은 쪽 (첫째, 아니면 다른 축) */
  private free(s: RunState, a: [number, number], both: [number, number]): [number, number] {
    const p = s.p;
    const ok = (v: [number, number]) => !blockedFor(s, Math.floor((p.x + v[0] * 9) / TILE), Math.floor((p.y + v[1] * 9) / TILE), 'p');
    if (ok(a)) return a;
    const b: [number, number] = a[0] ? [0, both[1] || 1] : [both[0] || 1, 0];
    if (ok(b)) return b;
    return [-b[0], -b[1]];
  }

  private fight(s: RunState, foes: Enemy[], inp: Input): Input {
    const p = s.p;
    const px = p.x;
    const py = p.y - BODY_UP;
    const e = foes.reduce((a, b) => (Math.hypot(a.x - px, a.y - py) <= Math.hypot(b.x - px, b.y - py) ? a : b));
    const dx = e.x - px;
    const dy = e.y - py;
    const reach = 14 + e.def.r;
    // 혼력이 넉넉하면 스킬 (쥐: 줄이 맞으면 멀리서도 / 소: 가까이서)
    const orb = s.data.equipped;
    const aligned = Math.abs(dx) < 8 || Math.abs(dy) < 8;
    if (orb && s.data.awakened.includes(orb) && p.awakenCd <= 0 && p.mp >= 30 && (e.def.boss || e.def.elite || foes.length >= 3)) inp.awaken = true;
    if (orb && p.skillCd <= 0 && !p.swing && p.mp >= maxMp(s) * 0.35) {
      if (orb === 'rat' && aligned && Math.hypot(dx, dy) < 120) {
        const f = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : dy > 0 ? 0 : 3;
        if (p.face === f) inp.skill = true;
      } else if (orb === 'ox' && Math.hypot(dx, dy) < reach + 8) inp.skill = true;
    }
    if (Math.abs(dx) <= reach && Math.abs(dy) <= 10) {
      inp.mx = Math.sign(dx) * 0.5;
      if (Math.abs(dx) > 6) inp.mx = Math.sign(dx);
      inp.attack = true;
      if (Math.abs(dx) < 6) inp.mx = 0;
      if (p.face !== (dx > 0 ? 2 : 1) && !p.swing) inp.mx = Math.sign(dx) || 1;
      return inp;
    }
    if (Math.abs(dy) <= reach && Math.abs(dx) <= 10) {
      inp.attack = true;
      if (p.face !== (dy > 0 ? 0 : 3) && !p.swing) inp.my = Math.sign(dy) || 1;
      return inp;
    }
    // 가까운 줄로 맞춘다 (가로가 더 멀면 세로부터 맞춘다)
    const tx = Math.floor(e.x / TILE);
    const ty = Math.floor((e.y + BODY_UP) / TILE);
    const spots: [number, number][] = [
      [tx - 1, ty],
      [tx + 1, ty],
      [tx, ty - 1],
      [tx, ty + 1],
    ];
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor((p.y - 2) / TILE);
    const good = spots.filter(([x, y]) => !blockedFor(s, x, y, 'p')).sort((a, b) => Math.hypot(a[0] - ptx, a[1] - pty) - Math.hypot(b[0] - ptx, b[1] - pty));
    if (good.length && Math.hypot(dx, dy) > 30) {
      this.walkTo(s, good[0][0], good[0][1], `foe:${e.id}:${good[0][0]},${good[0][1]}`, inp);
      if (inp.mx || inp.my) return inp;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      inp.my = Math.abs(dy) > 2 ? Math.sign(dy) : 0;
      if (!inp.my) inp.mx = Math.sign(dx);
    } else {
      inp.mx = Math.abs(dx) > 2 ? Math.sign(dx) : 0;
      if (!inp.mx) inp.my = Math.sign(dy);
    }
    return inp;
  }

  private goal(s: RunState): Goal | null {
    const m: FloorMap = s.map;
    const p = s.p;
    const goals: Goal[] = [];
    const objT = (x: number, y: number) => tileOf(s, x, y);
    const nearSpots = (x: number, y: number) =>
      [0, 1, 2, 3]
        .map((f) => ({ tx: x - FACE_VEC[f][0], ty: y - FACE_VEC[f][1], face: f }))
        .filter((g) => !blockedFor(s, g.tx, g.ty, 'p'));
    // 상자
    for (const o of m.objs) {
      if (o.kind === 'chest' && objT(o.x, o.y) === T.CHEST) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `chest:${o.id}:${g.face}` });
    }
    // 쥐 퍼즐: 스위치와 같은 줄, 날아갈 수 있는 길
    if (s.data.orbs.rat) {
      for (const o of m.objs) {
        const t = objT(o.x, o.y);
        if (o.kind !== 'switch' || (t !== T.SWITCH && t !== T.VINE)) continue;
        for (let f = 0; f < 4; f++) {
          for (let d = 2; d <= 7; d++) {
            const tx = o.x - FACE_VEC[f][0] * d;
            const ty = o.y - FACE_VEC[f][1] * d;
            if (blockedFor(s, tx, ty, 'p')) continue;
            let clear = true;
            for (let k = 1; k < d; k++) {
              const k2 = objT(o.x - FACE_VEC[f][0] * k, o.y - FACE_VEC[f][1] * k);
              if (k2 !== T.WATER && k2 !== T.FLOOR && k2 !== T.RUBBLE) clear = false;
            }
            if (clear) goals.push({ tx, ty, face: f, act: 'skill', key: `sw:${o.id}:${f}:${d}` });
          }
        }
      }
    }
    // 소 퍼즐: 바위 옆
    if (s.data.orbs.ox) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (objT(x, y) === T.ROCK) for (const g of nearSpots(x, y)) goals.push({ ...g, act: 'skill', key: `rock:${x},${y}:${g.face}` });
    }
    for (const o of m.objs) {
      if (o.kind === 'pedestal' && objT(o.x, o.y) === T.PEDESTAL) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `orb:${o.id}:${g.face}` });
      if (o.kind === 'fountain' && objT(o.x, o.y) === T.FOUNTAIN && p.hp < maxHp(s) * 0.9) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `ft:${o.id}:${g.face}` });
      if (o.kind === 'shop' && !this.shopped) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'shop', key: 'shop' });
    }
    // 적이 남은 방
    for (const r of m.rooms) {
      if (s.enemies.some((e) => e.room === r.id && e.alive)) goals.push({ tx: r.x0 + 8, ty: r.y0 + 6, act: 'walk', key: `room:${r.id}` });
    }
    // 계단 (상자·퍼즐 다 끝낸 뒤)
    for (const o of m.objs) if (o.kind === 'stairs' && objT(o.x, o.y) === T.STAIRS) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `stairs:${g.face}` });
    goals.push(...m.objs.filter((o) => o.kind === 'stairs' && objT(o.x, o.y) === T.STAIRS).map((o) => ({ tx: o.x, ty: o.y, act: 'interact' as const, key: 'stairs-on' })));

    // 퍼즐을 풀 구슬 바꿔 끼기 (메뉴에서 바꾸는 것과 같다)
    const first = goals.find((g) => !this.done.has(g.key) && this.reachable(s, g));
    if (first) {
      if (first.key.startsWith('rock:') && s.data.equipped !== 'ox') s.data.equipped = 'ox';
      else if (first.key.startsWith('sw:') && s.data.equipped !== 'rat') s.data.equipped = 'rat';
      else if (!first.key.startsWith('rock:') && !first.key.startsWith('sw:') && s.data.orbs.rat && s.data.equipped !== 'rat') s.data.equipped = 'rat';
    }
    return first ?? null;
  }

  private reach = new Map<string, boolean>();
  private reachSig = '';
  private reachable(s: RunState, g: Goal): boolean {
    // 문이 잠기거나 열리면, 또는 1초마다 다시 잰다 (바위·문이 열려 길이 생긴다)
    const sig = `${[...s.locked].join(',')}:${Math.floor(s.t)}`;
    if (sig !== this.reachSig) {
      this.reach.clear();
      this.reachSig = sig;
    }
    if (this.reach.has(g.key)) return this.reach.get(g.key)!;
    const p = s.p;
    const ok = !!bfs(s, Math.floor(p.x / TILE), Math.floor((p.y - 2) / TILE), (x, y) => x === g.tx && y === g.ty);
    this.reach.set(g.key, ok);
    return ok;
  }
}

export interface FloorRun {
  floor: number;
  s: RunState;
  result: 'clear' | 'dead' | 'timeout';
  time: number;
}

/** 봇이 한 층을 끝까지 (또는 maxTime 까지) */
export function botFloor(data: TowerData, floor: number, opts: BotOptions & { god?: boolean } = {}): FloorRun {
  const s = createRun(generateFloor(data.seed, floor), data, { god: opts.god });
  const bot = new Bot(opts);
  const maxSteps = Math.round((opts.maxTime ?? 900) * 60);
  for (let i = 0; i < maxSteps && !s.over; i++) {
    const inp = bot.decide(s);
    step(s, inp);
    s.events.length = 0;
  }
  return { floor, s, result: s.over ?? 'timeout', time: s.t };
}

export interface TowerLog {
  floors: { floor: number; level: number; coins: number; time: number; result: string; kills: number; bossTime: number; killHits: number[]; shards: number; orbs: string }[];
  data: TowerData;
  deaths: number;
}

/** 1층부터 lastFloor 까지 봇으로 (죽으면 체크포인트부터 다시, 최대 tries 번) */
export function botTower(data: TowerData, lastFloor: number, tries = 3, opts: BotOptions = {}): TowerLog {
  const log: TowerLog = { floors: [], data, deaths: 0 };
  let d = data;
  let guard = 0;
  while (d.floor <= lastFloor && guard++ < lastFloor * (tries + 1)) {
    const floor = d.floor;
    const r = botFloor(d, floor, opts);
    const nd = r.s.data;
    log.floors.push({ floor, level: nd.level, coins: nd.coins, time: r.time, result: r.result, kills: r.s.stats.kills, bossTime: r.s.stats.bossTime, killHits: r.s.stats.killHits, shards: nd.shards, orbs: Object.keys(nd.orbs).join(',') });
    if (r.result === 'clear') {
      clearFloor(nd, floor);
      d = nd;
    } else {
      die(nd);
      d = nd;
      log.deaths++;
      if (log.deaths >= tries) break;
    }
  }
  log.data = d;
  return log;
}

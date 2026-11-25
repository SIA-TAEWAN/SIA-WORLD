/**
 * 자동 조종 봇: 시뮬레이션(src/game/sim.ts)을 사람처럼 눌러서 층을 끝까지 오른다 (밸런스·막힘 확인용).
 * - 잠긴 방: 가장 가까운 적에게 붙어 3타 콤보, 예고(분홍 범위)가 보이면 피한다, 혼력이 차면 스킬
 * - 열린 방: 상자 → 퍼즐(쥐: 스위치를 맞힐 자리에서 참격, 소: 바위 옆에서 영체 팔, 발판: 가까운 것부터 밟기, 용: 화로 옆에서 화염 강타,
 *   뱀: 말뚝과 한 줄인 자리에서 채찍 — 건너편에 아직 못 간 상자·계단이 있을 때만, 토끼: 찬물 앞에서 얼음 칼날, 닭: 풍경 가운데에서 4~5칸 떨어져 깃털,
 *   개: 징 줄 끝에서 음파, 호랑이: 둥근 바위 뒤에서 맹호 강타 — 굴러가 구덩이를 메울 때만) → 구슬 → 샘 → 상점 → 적이 남은 방 → 계단
 * - 떨어지는 공격(원)·여러 갈래 선은 피하고, 남는 바닥(서리·불)은 사람처럼 참고 싸운다
 * - 구슬은 전투용으로 BOT_ORBS 앞쪽 것을 끼고, 퍼즐 앞에서만 그 퍼즐 구슬로 바꿔 낀다 (메뉴에서 바꾸는 것과 같다)
 */
import { ROOM_H, ROOM_W, T, TILE, flyable, type FloorMap } from '../src/game/floorgen';
import { generateFloor } from '../src/game/floorgen';
import { buy, clearFloor, die, type TowerData } from '../src/game/progress';
import { BODY_UP, FACE_VEC, blockedFor, boulderSlide, createRun, maxHp, maxMp, noInput, step, tileOf, useItem, type Enemy, type Input, type RunState } from '../src/game/sim';
import { orbDef, type ItemId } from '../src/data';

/** 봇이 싸울 때 끼는 구슬 순서 (가진 것 중 앞쪽) */
export const BOT_ORBS = ['blueDragon', 'phoenix', 'whiteTiger', 'turtle', 'horse', 'tiger', 'dog', 'sheep', 'rooster', 'monkey', 'rabbit', 'dragon', 'snake', 'rat', 'ox', 'pig'];
/** 칼처럼 앞을 치는 구슬 (가까이서) · 줄이 맞으면 멀리서 쏘는 구슬 */
const MELEE_ORBS = new Set(['ox', 'dragon', 'sheep', 'tiger', 'whiteTiger']);
const LINE_ORBS = new Set(['rat', 'rabbit', 'dog', 'phoenix', 'pig', 'blueDragon', 'rooster', 'snake']);

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
  /** 이 구슬만 낀다 (구슬 시험) */
  orb?: string;
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
    // 독이 길게 남았으면 정화 부적 (메뉴에서 쓰는 것과 같다)
    if ((p.poison > 2 || p.burn > 2) && s.data.items.cleanse > 0 && !inp.potion) useItem(s, 'cleanse');
    if (p.pull || p.dashChain) return inp;

    // 0) 원숭이: 날아오는 투사체·내리치기 직전에 막기
    if (s.data.equipped === 'monkey' && p.skillCd <= 0 && p.mp >= 6 && !p.swing && this.threat(s)) {
      inp.skill = true;
      return inp;
    }
    // 1) 예고 피하기
    const dodge = this.dodge(s);
    if (dodge) {
      inp.mx = dodge[0];
      inp.my = dodge[1];
      return inp;
    }
    // 2) 싸움
    const room = s.room;
    const foes = s.enemies.filter((e) => e.alive && e.active && !e.hidden && !e.guard && !e.pending && (e.room === room || s.locked.has(e.room)));
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
    const want: ItemId[] = ['potionL', 'potionL', 'potionL', 'potionL', 'revive', 'shard', 'potionL', 'potionL', 'mana', 'cleanse', 'map', 'potionL', 'potionS', 'potionS'];
    for (const id of want) buy(s.data, id, f);
  }

  /** 곧 맞을 것 (원숭이 막기) */
  private threat(s: RunState): boolean {
    const p = s.p;
    const px = p.x;
    const py = p.y - BODY_UP;
    for (const pr of s.projs) {
      if (pr.from !== 'e') continue;
      const d = Math.hypot(px - pr.x, py - pr.y);
      const v = Math.hypot(pr.vx, pr.vy) || 1;
      if (d < 26 && ((px - pr.x) * pr.vx + (py - pr.y) * pr.vy) / v > 0) return true;
    }
    for (const e of s.enemies) {
      const t = e.tele;
      if (!e.alive || !t || t.kind !== 'circle' || t.total - t.t > 0.25) continue;
      if (Math.hypot(px - t.x, py - t.y) < t.r + 6) return true;
    }
    return false;
  }

  /** 싸울 구슬 */
  private fightOrb(s: RunState): string | null {
    if (this.opts.orb && s.data.orbs[this.opts.orb]) return this.opts.orb;
    return BOT_ORBS.find((id) => s.data.orbs[id]) ?? null;
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
    // 떨어지는 공격: 원 밖으로 (남는 바닥은 상태만 걸려 사람처럼 참고 싸운다)
    for (const c of s.strikes.map((k) => ({ x: k.x, y: k.y, r: k.r + 10 }))) {
      if (Math.hypot(px - c.x, py - c.y) >= c.r) continue;
      const dx = px - c.x || 0.1;
      const dy = py - c.y || 0.1;
      return this.free(s, Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)], [Math.sign(dx), Math.sign(dy)]);
    }
    for (const e of s.enemies) {
      const t = e.tele;
      if (!e.alive || !t) continue;
      if (t.kind === 'cross') {
        const n = t.n ?? 8;
        for (let i = 0; i < n; i++) {
          const a = (t.ang ?? 0) + (i / n) * Math.PI * 2;
          const lx = Math.cos(a);
          const ly = Math.sin(a);
          const rx = px - t.x;
          const ry = py - t.y;
          const along = rx * lx + ry * ly;
          const side = rx * -ly + ry * lx;
          if (along > 0 && along < 160 && Math.abs(side) < 10) {
            const sg = side >= 0 ? 1 : -1;
            const perp: [number, number] = [-ly * sg, lx * sg];
            return this.free(s, Math.abs(perp[0]) > Math.abs(perp[1]) ? [Math.sign(perp[0]), 0] : [0, Math.sign(perp[1])], [Math.sign(perp[0]), Math.sign(perp[1])]);
          }
        }
        continue;
      }
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
    // 혼력이 넉넉하면 스킬 (멀리 쏘는 구슬: 줄이 맞으면 / 칼 구슬: 가까이서)
    const want = this.fightOrb(s);
    if (want && s.data.equipped !== want && !p.swing) s.data.equipped = want;
    const orb = s.data.equipped;
    const def = orbDef(orb);
    const aligned = Math.abs(dx) < 8 || Math.abs(dy) < 8;
    const dist = Math.hypot(dx, dy);
    const near = foes.filter((f) => Math.hypot(f.x - px, f.y - py) < 70).length;
    if (orb && def && s.data.awakened.includes(orb) && p.awakenCd <= 0 && p.mp >= def.awaken.mp) {
      const big = !!(e.def.boss || e.def.elite) || foes.length >= 3;
      let go = big;
      if (orb === 'turtle') go = p.hp < maxHp(s) * 0.5;
      else if (orb === 'tiger') go = big && p.hp > maxHp(s) * 0.6;
      else if (['rabbit', 'dragon', 'sheep', 'dog', 'phoenix', 'snake'].includes(orb)) go = (near >= 2 || !!e.def.boss) && dist < 60;
      else if (orb === 'whiteTiger') go = big && dist < 120;
      if (go) inp.awaken = true;
    }
    if (orb && def && p.skillCd <= 0 && !p.swing && p.mp >= Math.max(def.basic.mp, maxMp(s) * 0.3)) {
      const f = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 1) : dy > 0 ? 0 : 3;
      if (LINE_ORBS.has(orb) && aligned && dist < (orb === 'snake' ? 56 : 120) && p.face === f) inp.skill = true;
      else if (MELEE_ORBS.has(orb) && dist < reach + 8 && p.face === f) inp.skill = true;
      else if (orb === 'horse' && dist < 85) inp.skill = true;
      else if (orb === 'turtle' && !p.shield) inp.skill = true;
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
    const ty = Math.floor(e.y / TILE);
    const spots: [number, number][] = [
      [tx - 1, ty],
      [tx + 1, ty],
      [tx, ty - 1],
      [tx, ty + 1],
    ];
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor((p.y - 2) / TILE);
    // 맞출 자리: 적 칸의 네 이웃 중 걸어서 가장 가까운 곳 (물·기둥 너머는 길로 돌아간다)
    const path = bfs(s, ptx, pty, (x, y) => spots.some(([sx, sy]) => sx === x && sy === y) && !blockedFor(s, x, y, 'p'));
    const spot = path ? path[path.length - 1] : null;
    if (spot && (spot[0] !== ptx || spot[1] !== pty)) {
      this.walkTo(s, spot[0], spot[1], `foe:${e.id}:${spot[0]},${spot[1]}`, inp);
      if (inp.mx || inp.my) return inp;
    }
    // 그 자리에 왔다: 적과 줄을 맞춘다 (옆이면 세로를, 위아래면 가로를)
    const side = spot ? spot[1] === ty : Math.abs(dx) > Math.abs(dy);
    if (side) {
      inp.my = Math.abs(dy) > 6 ? Math.sign(dy) : 0;
      if (!inp.my) inp.mx = Math.sign(dx);
    } else {
      inp.mx = Math.abs(dx) > 6 ? Math.sign(dx) : 0;
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
    // 용 퍼즐: 꺼진 화로 옆
    if (s.data.orbs.dragon) {
      for (const o of m.objs) if (o.kind === 'brazier' && objT(o.x, o.y) === T.BRAZIER) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'skill', key: `br:${o.id}:${g.face}:${Math.floor(s.t / 3)}` });
    }
    // 발판: 가까운 것부터 (시간 안에)
    const plates = m.objs.filter((o) => o.kind === 'plate' && objT(o.x, o.y) === T.PLATE && !s.solved.has(o.room));
    plates.sort((a, b) => Math.hypot(a.x * TILE - p.x, a.y * TILE - p.y) - Math.hypot(b.x * TILE - p.x, b.y * TILE - p.y));
    for (const o of plates) goals.push({ tx: o.x, ty: o.y, act: 'walk', key: `plate:${o.id}:${s.plateAt.get(o.room) ?? 'n'}:${Math.floor(s.t / 20)}` });
    // 뱀 퍼즐: 말뚝을 감아 건너편으로 (건너편에 아직 못 간 상자·계단이 있을 때만)
    if (s.data.orbs.snake) goals.push(...this.grapples(s));
    // 3~5구역 퍼즐: 찬물 얼리기(토끼) · 풍경(닭) · 징(개) · 둥근 바위(호랑이). 판을 훑는 데 오래 걸려 0.25초마다 다시 잰다
    if (!this.pz || s.t - this.pz.t >= 0.25) {
      const pz: Goal[] = [];
      if (s.data.orbs.rabbit) pz.push(...this.iceShots(s));
      if (s.data.orbs.rooster) pz.push(...this.ringShots(s, 'bell'));
      if (s.data.orbs.dog) pz.push(...this.ringShots(s, 'gong'));
      if (s.data.orbs.tiger) pz.push(...this.boulderPushes(s));
      this.pz = { t: s.t, goals: pz };
    }
    goals.push(...this.pz.goals);
    for (const o of m.objs) {
      if (o.kind === 'pedestal' && objT(o.x, o.y) === T.PEDESTAL) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `orb:${o.id}:${g.face}` });
      if (o.kind === 'fountain' && objT(o.x, o.y) === T.FOUNTAIN && p.hp < maxHp(s) * 0.9) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `ft:${o.id}:${g.face}` });
      if (o.kind === 'shop' && !this.shopped) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'shop', key: 'shop' });
    }
    // 적이 남은 방 (가운데에서 가까운 걸을 수 있는 칸)
    for (const r of m.rooms) {
      if (!s.enemies.some((e) => e.room === r.id && e.alive)) continue;
      const c = this.roomSpot(s, r.x0, r.y0);
      if (c) goals.push({ tx: c[0], ty: c[1], act: 'walk', key: `room:${r.id}:${Math.floor(s.t / 8)}` });
    }
    // 계단 (상자·퍼즐 다 끝낸 뒤)
    for (const o of m.objs) if (o.kind === 'stairs' && objT(o.x, o.y) === T.STAIRS) for (const g of nearSpots(o.x, o.y)) goals.push({ ...g, act: 'interact', key: `stairs:${g.face}` });
    goals.push(...m.objs.filter((o) => o.kind === 'stairs' && objT(o.x, o.y) === T.STAIRS).map((o) => ({ tx: o.x, ty: o.y, act: 'interact' as const, key: 'stairs-on' })));

    // 퍼즐을 풀 구슬 바꿔 끼기 (메뉴에서 바꾸는 것과 같다)
    const first = goals.find((g) => !this.done.has(g.key) && this.reachable(s, g));
    if (first) {
      const PUZZLE_ORB: Record<string, string> = { 'rock:': 'ox', 'sw:': 'rat', 'br:': 'dragon', 'gr:': 'snake', 'ic:': 'rabbit', 'bell:': 'rooster', 'gong:': 'dog', 'bd:': 'tiger' };
      const need = Object.entries(PUZZLE_ORB).find(([k]) => first.key.startsWith(k))?.[1] ?? this.fightOrb(s);
      if (need && s.data.equipped !== need && !p.swing) s.data.equipped = need;
    }
    return first ?? null;
  }

  private pz: { t: number; goals: Goal[] } | null = null;

  private roomSpot(s: RunState, x0: number, y0: number): [number, number] | null {
    const cx = x0 + Math.floor(ROOM_W / 2);
    const cy = y0 + Math.floor(ROOM_H / 2);
    for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!blockedFor(s, cx + dx, cy + dy, 'p')) return [cx + dx, cy + dy];
    return null;
  }

  /** 말뚝 감기 자리: 말뚝과 한 줄 · 사이는 물·바닥 · 너머에 내릴 칸 · 그 너머 땅에 아직 못 간 볼일 */
  private grapples(s: RunState): Goal[] {
    const m = s.map;
    const out: Goal[] = [];
    const p = s.p;
    const here = this.region(s, Math.floor(p.x / TILE), Math.floor((p.y - 2) / TILE));
    for (const o of m.objs) {
      if (o.kind !== 'post') continue;
      for (let f = 0; f < 4; f++) {
        const [fx, fy] = FACE_VEC[f];
        const lx = o.x + fx;
        const ly = o.y + fy;
        if (blockedFor(s, lx, ly, 'p') || here.has(ly * m.w + lx)) continue;
        for (let d = 2; d <= 7; d++) {
          const tx = o.x - fx * d;
          const ty = o.y - fy * d;
          if (blockedFor(s, tx, ty, 'p') || !here.has(ty * m.w + tx)) continue;
          let clear = true;
          for (let k = 1; k < d; k++) if (!flyable(tileOf(s, o.x - fx * k, o.y - fy * k))) clear = false;
          if (!clear) continue;
          if (!this.useful(s, lx, ly, here)) continue;
          out.push({ tx, ty, face: f, act: 'skill', key: `gr:${o.id}:${f}:${d}:${Math.floor(s.t / 4)}` });
        }
      }
    }
    return out;
  }
  /** 찬물 얼리기 자리: 찬물 바로 앞, 그 줄로 얼리면 건너편 땅(아직 못 간 상자)에 닿는다 */
  private iceShots(s: RunState): Goal[] {
    const m = s.map;
    const out: Goal[] = [];
    const p = s.p;
    const here = this.region(s, Math.floor(p.x / TILE), Math.floor((p.y - 2) / TILE));
    // 칸 순서대로 (지금 자리에 따라 목표가 바뀌지 않게)
    for (const c of [...here].sort((a, b) => a - b)) {
      const x = c % m.w;
      const y = (c - x) / m.w;
      for (let f = 0; f < 4; f++) {
        const [fx, fy] = FACE_VEC[f];
        if (tileOf(s, x + fx, y + fy) !== T.COLD_WATER) continue;
        let k = 1;
        while (k <= 5 && (tileOf(s, x + fx * k, y + fy * k) === T.COLD_WATER || tileOf(s, x + fx * k, y + fy * k) === T.ICE)) k++;
        const lx = x + fx * k;
        const ly = y + fy * k;
        if (k > 5 || blockedFor(s, lx, ly, 'p') || here.has(ly * m.w + lx) || !this.useful(s, lx, ly, here)) continue;
        out.push({ tx: x, ty: y, face: f, act: 'skill', key: `ic:${x},${y}:${f}:${Math.floor(s.t / 3)}` });
      }
    }
    return out;
  }
  /** 풍경(닭 깃털 부채꼴: 가운데 풍경에서 5~6칸 떨어져 수직으로) · 징(개 음파: 줄 끝에서 줄을 따라) */
  private ringShots(s: RunState, kind: 'bell' | 'gong'): Goal[] {
    const m = s.map;
    const out: Goal[] = [];
    const isOn = (x: number, y: number) => {
      const k = tileOf(s, x, y);
      return kind === 'bell' ? k === T.BELL || k === T.BELL_ON : k === T.GONG || k === T.GONG_ON;
    };
    for (const room of new Set(m.objs.filter((o) => o.kind === kind && !s.solved.has(o.room)).map((o) => o.room))) {
      const list = m.objs.filter((o) => o.kind === kind && o.room === room);
      if (!m.objs.some((o) => o.kind === 'chest' && o.room === room && tileOf(s, o.x, o.y) === T.CHEST)) continue;
      for (const o of list) {
        for (let f = 0; f < 4; f++) {
          const [fx, fy] = FACE_VEC[f];
          if (kind === 'bell') {
            // 가운데 풍경 (양옆이 풍경) 에서 수직으로 떨어진 자리
            const side = fx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
            if (!side.every(([sx, sy]) => isOn(o.x + sx, o.y + sy))) continue;
            for (const d of [4, 5]) {
              const tx = o.x - fx * d;
              const ty = o.y - fy * d;
              if (blockedFor(s, tx, ty, 'p')) continue;
              let clear = true;
              for (let k = 1; k < d; k++) if (!flyable(tileOf(s, o.x - fx * k, o.y - fy * k))) clear = false;
              if (clear) out.push({ tx, ty, face: f, act: 'skill', key: `bell:${o.id}:${f}:${d}:${Math.floor(s.t / 3)}` });
            }
          } else {
            // 줄의 첫 징 앞 1~3칸에서, 줄을 따라 8칸 안에 그 방 징이 모두 있으면
            if (isOn(o.x - fx, o.y - fy)) continue;
            for (let d = 1; d <= 3; d++) {
              const tx = o.x - fx * d;
              const ty = o.y - fy * d;
              if (blockedFor(s, tx, ty, 'p')) continue;
              let n = 0;
              let clear = true;
              for (let k = 1; k <= 8 && clear; k++) {
                const kx = tx + fx * k;
                const ky = ty + fy * k;
                if (isOn(kx, ky)) n++;
                else if (!flyable(tileOf(s, kx, ky))) clear = false;
              }
              if (n === list.length) out.push({ tx, ty, face: f, act: 'skill', key: `gong:${o.id}:${f}:${d}:${Math.floor(s.t / 3)}` });
            }
          }
        }
      }
    }
    return out;
  }
  /** 둥근 바위 밀기 자리: 바위 뒤에서, 굴러간 끝이 구덩이이고 그 너머 땅에 아직 못 간 상자가 있을 때 */
  private boulderPushes(s: RunState): Goal[] {
    const m = s.map;
    const out: Goal[] = [];
    const p = s.p;
    const here = this.region(s, Math.floor(p.x / TILE), Math.floor((p.y - 2) / TILE));
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (tileOf(s, x, y) !== T.BOULDER) continue;
        for (let f = 0; f < 4; f++) {
          const [fx, fy] = FACE_VEC[f];
          const ax = x - fx;
          const ay = y - fy;
          if (blockedFor(s, ax, ay, 'p') || !here.has(ay * m.w + ax)) continue;
          const end = boulderSlide(s, x, y, fx, fy);
          if (!end.pit) continue;
          const ok = [[0, 0], ...FACE_VEC].some(([dx, dy]) => {
            const nx = end.x + fx + dx;
            const ny = end.y + fy + dy;
            return !blockedFor(s, nx, ny, 'p') && !here.has(ny * m.w + nx) && this.useful(s, nx, ny, here);
          });
          if (ok) out.push({ tx: ax, ty: ay, face: f, act: 'skill', key: `bd:${x},${y}:${f}:${Math.floor(s.t / 3)}` });
        }
      }
    }
    return out;
  }
  private region(s: RunState, sx: number, sy: number): Set<number> {
    const w = s.map.w;
    const seen = new Set<number>([sy * w + sx]);
    const q = [sy * w + sx];
    while (q.length) {
      const c = q.pop()!;
      const x = c % w;
      const y = (c - x) / w;
      for (const [dx, dy] of FACE_VEC) {
        const n = (y + dy) * w + x + dx;
        if (seen.has(n) || blockedFor(s, x + dx, y + dy, 'p')) continue;
        seen.add(n);
        q.push(n);
      }
    }
    return seen;
  }
  /** 내릴 칸에서 닿는 땅에 아직 못 간 볼일(닫힌 상자 · 계단)이 있다 */
  private useful(s: RunState, lx: number, ly: number, here: Set<number>): boolean {
    const there = this.region(s, lx, ly);
    const w = s.map.w;
    for (const o of s.map.objs) {
      const t = tileOf(s, o.x, o.y);
      const want = (o.kind === 'chest' && t === T.CHEST) || (o.kind === 'stairs' && t === T.STAIRS);
      if (!want) continue;
      const adj = [[0, 0], ...FACE_VEC].map(([dx, dy]) => (o.y + dy) * w + o.x + dx);
      if (adj.some((i) => there.has(i)) && !adj.some((i) => here.has(i))) return true;
    }
    return false;
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
  floors: { floor: number; level: number; coins: number; time: number; result: string; kills: number; bossTime: number; killHits: number[]; shards: number; orbs: string; skills: Record<string, number>; potions: number }[];
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
    log.floors.push({ floor, level: nd.level, coins: nd.coins, time: r.time, result: r.result, kills: r.s.stats.kills, bossTime: r.s.stats.bossTime, killHits: r.s.stats.killHits, shards: nd.shards, orbs: Object.keys(nd.orbs).join(','), skills: r.s.stats.skills, potions: r.s.stats.potions });
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

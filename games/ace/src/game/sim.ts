// 시아에이스 시뮬레이션 (화면과 따로, 순수 TypeScript).
// 고정 스텝 1/60초. 탄·적·아이템은 미리 만든 칸(풀)을 돌려 쓰고, 충돌은 원 대 원.
// 화면(StageScene)은 매 프레임 이 상태를 읽어 같은 칸 번호의 그림을 옮기기만 한다.
//
// 스테이지 흐름: 등장표(waves) → 중간 보스(등장표 멈춤) → 등장표 → 남은 적이 사라지면 스테이지 보스 → 정산(clear).
import { FIRE, PATTERNS, type PatternName } from './patterns';
import { SHIPS, type ShipId } from '../data/ships';
import { BOSSES, BOSS_SCORE_PER_STAGE, MID_SCORE, PART_SCORE, type BossDef } from '../data/bosses';
import type { WaveScript } from '../data/waves';

export const W = 720;
export const H = 1280;
/** 풀 크기: 적 탄은 화면에 동시에 최대 400발 */
export const CAP = { eb: 400, ps: 160, en: 48, item: 48 } as const;

export const MAX_POWER = 4;
export const MAX_BOMBS = 5;
export const START_BOMBS = 2;
/** 피격 판정 반지름 (기체 가운데 약 6px 점 → 반지름 3, 탄 반지름과 더해 잰다) */
export const HIT_R = 3;
export const PICK_R = 56;
/** 무적 시간 (프레임) */
export const HIT_IFRAMES = 120;
export const BOMB_IFRAMES = 90;
/** 목숨이 늘어나는 점수 */
export const EXTENDS = [2_000_000, 5_000_000];
export const SCORE = { small: 100, medium: 1000, carrier: 500, ground: 500, maxPowerP: 1000 } as const;
/** 금화 연속: 100 → 200 → … → 2,000 (놓치면 처음부터) */
export const COIN_STEP = 100;
export const COIN_MAX = 2000;
/** 정산 */
export const BONUS = { bomb: 5000, noMiss: 30000 } as const;
/** 바닥이 흐르는 속도 (월드 px/스텝). 지상 목표도 이 속도로 같이 내려온다 */
export const SCROLL = 2.2;
/** 차지: 한 칸 차는 데 걸리는 스텝, 최대 3칸 */
export const CHARGE_CELL = 36;
export const CHARGE_MAX = 3;

export type EnemyKind = 'small' | 'medium' | 'carrier' | 'ground';
export type PathName = 'dive' | 'swoopL' | 'swoopR' | 'hover' | 'cross' | 'ground';
export type ItemKind = 'P' | 'B' | 'C';

export interface Input {
  /** 손가락·마우스가 이번 스텝에 움직인 거리 (월드 px, 상대 이동) */
  dx: number;
  dy: number;
  /** 키보드 방향 -1..1 */
  kx: number;
  ky: number;
  bomb: boolean;
  /** 차지 버튼을 누르고 있는가 (손가락을 대고 있는 동안 · PC Shift) */
  charge: boolean;
}
export const NO_INPUT: Input = { dx: 0, dy: 0, kx: 0, ky: 0, bomb: false, charge: false };

export interface Bullet { alive: boolean; x: number; y: number; vx: number; vy: number; r: number; big: boolean }
export interface Shot { alive: boolean; x: number; y: number; vx: number; vy: number; dmg: number }
export interface Item { alive: boolean; kind: ItemKind; x: number; y: number; vx: number; vy: number }
export interface Enemy {
  alive: boolean; kind: EnemyKind; path: PathName;
  x: number; y: number; x0: number; y0: number; vx: number; vy: number;
  hp: number; maxHp: number; r: number; t: number; flash: number;
  group: number; drop: ItemKind | null;
  fire: PatternName | null; fireEvery: number; fireAt: number;
}
export interface BossPart { x: number; y: number; r: number; hp: number; maxHp: number; alive: boolean; flash: number }
export interface Boss {
  def: BossDef;
  x: number; y: number;
  hp: number; maxHp: number;
  phase: number;
  t: number;
  /** 남은 시간 (스텝) */
  left: number;
  state: 'enter' | 'fight' | 'flee' | 'down';
  parts: BossPart[];
  flash: number;
}
export interface Laser { t: number; max: number; cells: number }

export type SimEvent =
  | { t: 'kill'; x: number; y: number; kind: EnemyKind; score: number }
  | { t: 'hit'; x: number; y: number }
  | { t: 'bomb'; x: number; y: number }
  | { t: 'pick'; x: number; y: number; kind: ItemKind; score: number }
  | { t: 'coinLost' }
  | { t: 'charge'; cells: number }
  | { t: 'bossIn'; name: string; mid: boolean }
  | { t: 'phase'; phase: number }
  | { t: 'partDown'; x: number; y: number; score: number }
  | { t: 'bossDown'; x: number; y: number; score: number; mid: boolean }
  | { t: 'flee'; mid: boolean }
  | { t: 'extend' }
  | { t: 'clear' }
  | { t: 'over' };

export interface SimOptions {
  seed: number;
  ship: ShipId;
  waves: WaveScript;
  /** 스테이지 번호 (보스 점수 = 50,000 × 번호) */
  stage?: number;
  /** 난이도 탄 속도 배율 (쉬움 0.7) */
  bulletSpeed?: number;
  lives?: number;
  /** 시험용: 화면 위에서 나선탄을 계속 뿜어 400발 가까이 채운다 */
  stress?: boolean;
}

export interface ClearTally {
  kills: number; bombs: number; bombBonus: number; noMiss: boolean; noMissBonus: number;
  bossScore: number; partScore: number; coinBest: number; total: number;
}

/** 재현 가능한 난수 (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENEMY_BASE: Record<EnemyKind, { hp: number; r: number }> = {
  small: { hp: 3, r: 30 },
  medium: { hp: 70, r: 54 },
  carrier: { hp: 24, r: 40 },
  ground: { hp: 30, r: 44 },
};

export class Sim {
  readonly opt: Required<Omit<SimOptions, 'stress'>> & { stress: boolean };
  readonly rand: () => number;
  frame = 0;
  state: 'play' | 'over' | 'clear' = 'play';
  score = 0;
  lives: number;
  bombs = START_BOMBS;
  power = 1;
  kills = 0;
  misses = 0;
  /** 플레이어 */
  px = W / 2;
  py = H - 220;
  /** 이번 스텝 가로 이동량 (기울임 그림용) */
  pvx = 0;
  iframes = 60;
  bombFx = 0;
  /** 차지 (스텝 수). 칸 = floor(chargeT / CHARGE_CELL) */
  chargeT = 0;
  laser: Laser = { t: 0, max: 1, cells: 0 };
  /** 금화 연속 */
  coinChain = 0;
  coinBest = 0;
  /** 보조기 2대 (3단계부터) 위치: 기체를 조금 늦게 따라온다 */
  opts = [{ x: W / 2 - 80, y: H - 200 }, { x: W / 2 + 80, y: H - 200 }];
  boss: Boss | null = null;
  bossScore = 0;
  partScore = 0;
  tally: ClearTally | null = null;
  /** 이번 스텝에 생긴 일 (화면이 효과·소리로 쓴다) */
  events: SimEvent[] = [];

  readonly eb: Bullet[] = [];
  readonly ps: Shot[] = [];
  readonly en: Enemy[] = [];
  readonly items: Item[] = [];
  ebCount = 0;

  /** 등장표 시간 (스텝). 보스가 있는 동안은 멈춘다 */
  stageT = 0;
  private nextExtend = 0;
  private waveIdx = 0;
  private loop = 0;
  private midDone = false;
  private bossDone = false;
  private clearAt = 0;
  private groupLeft = new Map<number, { left: number; broken: boolean }>();
  private groupSeq = 0;
  private ebCursor = 0;

  constructor(o: SimOptions) {
    this.opt = { bulletSpeed: 1, lives: 3, stress: false, stage: 1, ...o } as Sim['opt'];
    this.rand = rng(o.seed);
    this.lives = this.opt.lives;
    for (let i = 0; i < CAP.eb; i++) this.eb.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 8, big: false });
    for (let i = 0; i < CAP.ps; i++) this.ps.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1 });
    for (let i = 0; i < CAP.item; i++) this.items.push({ alive: false, kind: 'P', x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < CAP.en; i++) {
      this.en.push({
        alive: false, kind: 'small', path: 'dive', x: 0, y: 0, x0: 0, y0: 0, vx: 0, vy: 0,
        hp: 0, maxHp: 0, r: 0, t: 0, flash: 0, group: 0, drop: null, fire: null, fireEvery: 0, fireAt: 0,
      });
    }
  }

  get ship() { return SHIPS[this.opt.ship]; }
  get chargeCells() { return Math.min(CHARGE_MAX, Math.floor(this.chargeT / CHARGE_CELL)); }
  /** 적 탄 속도: 난이도 × 스테이지 × (반복할수록 조금씩 빨라짐) */
  get speedMul() { return this.opt.bulletSpeed * (this.opt.waves.bulletSpeed ?? 1) * (1 + this.loop * 0.08); }

  // ---------------- 한 스텝 ----------------
  step(inp: Input) {
    this.events.length = 0;
    if (this.state !== 'play') return;
    this.frame++;
    this.timeline();
    if (this.opt.stress) this.stressEmit();
    this.movePlayer(inp);
    if (inp.bomb) this.useBomb();
    this.chargeStep(inp.charge);
    this.fireShots();
    this.moveShots();
    this.moveEnemies();
    this.moveBoss();
    this.moveBullets();
    this.moveItems();
    this.collide();
    if (this.iframes > 0) this.iframes--;
    if (this.bombFx > 0) this.bombFx--;
    if (this.clearAt && this.frame >= this.clearAt && this.state === 'play') this.finish();
  }

  /** 개발용: 등장표를 sec 초로 건너뛴다 (그 앞의 적은 나오지 않음) */
  skipTo(sec: number) {
    const sc = this.opt.waves;
    this.stageT = Math.round(sec * 60);
    while (this.waveIdx < sc.waves.length && sc.waves[this.waveIdx].at * 60 < this.stageT) this.waveIdx++;
    if (sc.midboss && sc.midboss.at * 60 < this.stageT) this.midDone = true;
  }

  // ---------------- 등장표 ----------------
  private timeline() {
    if (this.boss) return;
    const sc = this.opt.waves;
    this.stageT++;
    const t = this.stageT;
    if (sc.midboss && !this.midDone && t >= sc.midboss.at * 60) {
      this.midDone = true;
      this.spawnBoss(sc.midboss.id);
      return;
    }
    while (this.waveIdx < sc.waves.length && sc.waves[this.waveIdx].at * 60 <= t) {
      const w = sc.waves[this.waveIdx++];
      const g = ++this.groupSeq;
      const n = w.count ?? 1;
      if (w.kind === 'small' && n > 1) this.groupLeft.set(g, { left: n, broken: false });
      for (let i = 0; i < n; i++) {
        const dx = (w.dx ?? 0) * i, delay = (w.gap ?? 0) * i;
        this.spawnEnemy(w.kind, w.path, w.x * W + dx, -40 - delay * 6, g, w.drop ?? null, w.fire ?? null, w.fireEvery ?? 0);
      }
    }
    if (this.waveIdx < sc.waves.length || t < sc.length * 60) return;
    if (sc.loop) {
      this.loop++;
      this.stageT = 0;
      this.waveIdx = 0;
      this.midDone = false;
      return;
    }
    // 등장표가 끝나고 남은 적이 사라지면 보스 (최대 6초 기다림)
    if (sc.boss && !this.bossDone && (!this.en.some(e => e.alive && e.kind !== 'ground') || t >= (sc.length + 6) * 60)) {
      this.bossDone = true;
      this.spawnBoss(sc.boss);
    } else if (!sc.boss && !this.clearAt) {
      this.clearAt = this.frame + 120;
    }
  }

  // ---------------- 플레이어 ----------------
  private movePlayer(inp: Input) {
    const sp = this.ship.speed;
    let dx = inp.dx + inp.kx * sp;
    let dy = inp.dy + inp.ky * sp;
    // 한 스텝에 너무 멀리 뛰지 않게 (손가락을 확 끌어도 기체는 빠르게 따라가는 정도)
    const m = Math.hypot(dx, dy), lim = sp * 4;
    if (m > lim) { dx *= lim / m; dy *= lim / m; }
    const ox = this.px;
    this.px = clamp(this.px + dx, 36, W - 36);
    this.py = clamp(this.py + dy, 120, H - 60);
    this.pvx = this.px - ox;
    // 보조기: 양옆 뒤에서 부드럽게 따라온다
    const tx = [this.px - 84, this.px + 84];
    for (let i = 0; i < 2; i++) {
      this.opts[i].x += (tx[i] - this.opts[i].x) * 0.25;
      this.opts[i].y += (this.py + 26 - this.opts[i].y) * 0.25;
    }
  }

  /** 누르고 있는 동안 게이지가 차고, 1칸 이상일 때 떼면 차지샷 (청룡호: 관통 레이저) */
  private chargeStep(held: boolean) {
    if (this.laser.t > 0) { this.laser.t--; this.chargeT = 0; return; }
    if (held) { this.chargeT = Math.min(this.chargeT + 1, CHARGE_CELL * CHARGE_MAX); return; }
    const cells = this.chargeCells;
    this.chargeT = 0;
    if (cells < 1) return;
    this.laser = { t: 24 + cells * 14, max: 24 + cells * 14, cells };
    this.events.push({ t: 'charge', cells });
  }

  /** 레이저 너비 (반폭, 월드 px) */
  laserHalf() { return 22 + this.laser.cells * 12; }

  private fireShots() {
    if (this.frame % FIRE.every !== 0) return;
    for (const s of FIRE.main[this.power - 1]) this.addShot(this.px + s.x, this.py - 40, s.vx, -FIRE.speed, s.dmg);
    if (this.power >= 3 && this.frame % (FIRE.every * 2) === 0) {
      for (const o of this.opts) this.addShot(o.x, o.y - 20, 0, -FIRE.speed, FIRE.optDmg);
    }
  }

  private addShot(x: number, y: number, vx: number, vy: number, dmg: number) {
    for (const s of this.ps) if (!s.alive) { s.alive = true; s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.dmg = dmg; return; }
  }

  private moveShots() {
    for (const s of this.ps) {
      if (!s.alive) continue;
      s.x += s.vx; s.y += s.vy;
      if (s.y < -40 || s.x < -40 || s.x > W + 40) s.alive = false;
    }
  }

  useBomb() {
    if (this.bombs <= 0 || this.bombFx > 0 || this.state !== 'play') return false;
    this.bombs--;
    this.bombFx = 50;
    this.iframes = Math.max(this.iframes, BOMB_IFRAMES);
    this.clearBullets();
    for (const e of this.en) if (e.alive && e.y > -20) this.damage(e, 40);
    if (this.boss?.state === 'fight') this.hitBoss(60);
    this.events.push({ t: 'bomb', x: this.px, y: this.py });
    return true;
  }

  clearBullets() {
    for (const b of this.eb) b.alive = false;
    this.ebCount = 0;
  }

  // ---------------- 적 탄 ----------------
  /** 빈 칸에 적 탄 하나. 400발이 다 차 있으면 쏘지 않는다 */
  addBullet(x: number, y: number, vx: number, vy: number, big = false) {
    if (this.ebCount >= CAP.eb) return;
    for (let n = 0; n < CAP.eb; n++) {
      const i = (this.ebCursor + n) % CAP.eb, b = this.eb[i];
      if (b.alive) continue;
      b.alive = true; b.x = x; b.y = y; b.vx = vx * this.speedMul; b.vy = vy * this.speedMul; b.big = big; b.r = big ? 11 : 7;
      this.ebCount++;
      this.ebCursor = (i + 1) % CAP.eb;
      return;
    }
  }

  private moveBullets() {
    for (const b of this.eb) {
      if (!b.alive) continue;
      b.x += b.vx; b.y += b.vy;
      if (b.y < -30 || b.y > H + 30 || b.x < -30 || b.x > W + 30) { b.alive = false; this.ebCount--; }
    }
  }

  private stressEmit() {
    if (this.frame % 3 !== 0) return;
    const a0 = this.frame * 0.07;
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k * Math.PI) / 2;
      this.addBullet(W / 2, 300, Math.cos(a) * 3.2, Math.sin(a) * 3.2);
    }
  }

  // ---------------- 적 ----------------
  spawnEnemy(kind: EnemyKind, path: PathName, x: number, y: number, group = 0, drop: ItemKind | null = null, fire: PatternName | null = null, fireEvery = 0) {
    const e = this.en.find(v => !v.alive);
    if (!e) return null;
    const base = ENEMY_BASE[kind];
    const hp = Math.round(base.hp * (1 + this.loop * 0.15));
    Object.assign(e, {
      alive: true, kind, path, x, y, x0: x, y0: y, vx: 0, vy: 0, hp, maxHp: hp, r: base.r, t: 0, flash: 0,
      group, drop, fire, fireEvery, fireAt: fireEvery ? 40 + Math.floor(this.rand() * fireEvery) : 0,
    });
    if (path === 'cross') { e.y = 160 + this.rand() * 200; e.x = x < W / 2 ? -50 : W + 50; e.y0 = e.y; e.x0 = e.x; }
    if (path === 'ground') e.y = -60;
    return e;
  }

  private moveEnemies() {
    for (const e of this.en) {
      if (!e.alive) continue;
      e.t++;
      if (e.flash > 0) e.flash--;
      const t = e.t;
      switch (e.path) {
        case 'dive':
          e.vx = 0; e.vy = 4.2;
          break;
        case 'swoopL': case 'swoopR': {
          // 내려오다가 한쪽으로 휘어 나간다
          const dir = e.path === 'swoopL' ? -1 : 1;
          e.vy = t < 70 ? 5 : 2.2;
          e.vx = t < 70 ? 0 : dir * Math.min(6, (t - 70) * 0.12);
          break;
        }
        case 'hover': {
          // 자리 잡고 좌우로 흔들리다 시간이 지나면 위로 빠진다
          const stopY = 260 + (e.x0 % 3) * 40;
          if (t < 90) { e.vy = (stopY - e.y) * 0.05 + 0.5; e.vx = 0; }
          else if (t < 640) { e.vy = 0; e.vx = Math.sin(t / 50) * 1.6; }
          else { e.vy = -3; e.vx = 0; }
          break;
        }
        case 'cross':
          // 공격 없이 옆으로 도망치는 아이템 운반기
          e.vx = e.x0 < 0 ? 3.4 : -3.4; e.vy = Math.sin(t / 30) * 0.8;
          break;
        case 'ground':
          // 지상·해상 목표: 바닥과 같이 흘러내린다 (보스가 있어도 바닥은 계속 흐른다)
          e.vx = 0; e.vy = SCROLL;
          break;
      }
      e.x += e.vx; e.y += e.vy;
      if (e.fire && e.y > 0 && e.y < H * 0.7 && t >= e.fireAt) {
        e.fireAt = t + e.fireEvery;
        PATTERNS[e.fire](this, e.x, e.y + e.r * 0.5, t);
      }
      const out = e.y > H + 80 || e.x < -100 || e.x > W + 100 || (e.path === 'hover' && t > 640 && e.y < -80);
      if (out) {
        e.alive = false;
        const g = this.groupLeft.get(e.group);
        if (g) { g.broken = true; g.left--; if (g.left <= 0) this.groupLeft.delete(e.group); }
      }
    }
  }

  private damage(e: Enemy, dmg: number) {
    e.hp -= dmg;
    e.flash = 3;
    if (e.hp > 0) return;
    e.alive = false;
    this.kills++;
    const score = SCORE[e.kind];
    this.addScore(score);
    this.events.push({ t: 'kill', x: e.x, y: e.y, kind: e.kind, score });
    if (e.drop) this.dropItem(e.drop, e.x, e.y);
    if (e.kind === 'medium') for (let i = 0; i < 3; i++) this.dropItem('C', e.x + (i - 1) * 40, e.y);
    if (e.kind === 'ground') this.dropItem('C', e.x, e.y);
    // 편대를 전멸시키면 P 또는 금화 (최대 파워면 금화)
    const g = this.groupLeft.get(e.group);
    if (g) {
      g.left--;
      if (g.left <= 0) {
        this.groupLeft.delete(e.group);
        if (!g.broken) this.dropItem(this.power < MAX_POWER && this.rand() < 0.6 ? 'P' : 'C', e.x, e.y);
      }
    }
  }

  // ---------------- 보스 ----------------
  private spawnBoss(id: string) {
    const def = BOSSES[id];
    if (!def) return;
    const hp = def.hp;
    this.boss = {
      def, x: W / 2, y: -def.width * 0.45, hp, maxHp: hp, phase: 0, t: 0, left: def.time * 60, state: 'enter', flash: 0,
      parts: def.parts.map(p => ({ x: p.x, y: p.y, r: p.r, hp: p.hp, maxHp: p.hp, alive: true, flash: 0 })),
    };
    this.events.push({ t: 'bossIn', name: def.name, mid: def.kind === 'mid' });
  }

  private moveBoss() {
    const b = this.boss;
    if (!b) return;
    b.t++;
    if (b.flash > 0) b.flash--;
    for (const p of b.parts) if (p.flash > 0) p.flash--;
    const def = b.def;
    if (b.state === 'enter') {
      b.y += (def.restY - b.y) * 0.03 + 0.6;
      if (b.y >= def.restY - 2) { b.y = def.restY; b.state = 'fight'; b.t = 0; }
      return;
    }
    if (b.state === 'flee' || b.state === 'down') {
      b.y -= b.state === 'flee' ? 5 : 0;
      if (b.state === 'down' || b.y < -def.width) this.endBoss();
      return;
    }
    // 싸우는 중: 시간 제한
    b.left--;
    if (b.left <= 0) {
      b.state = 'flee';
      this.clearBullets();
      this.events.push({ t: 'flee', mid: def.kind === 'mid' });
      return;
    }
    const ph = def.phases[b.phase];
    switch (ph.move) {
      case 'sway': b.x = W / 2 + Math.sin(b.t / 90) * 110; break;
      case 'figure8': b.x = W / 2 + Math.sin(b.t / 70) * 130; b.y = def.restY + Math.sin(b.t / 35) * 40; break;
      case 'still': break;
    }
    for (const f of ph.fire) {
      if ((b.t + (f.delay ?? 0)) % f.every !== 0) continue;
      let x = b.x + def.core.x, y = b.y + def.core.y;
      if (f.from !== 'core') {
        const p = b.parts[f.from];
        if (!p?.alive) continue;
        x = b.x + p.x; y = b.y + p.y;
      }
      PATTERNS[f.pattern](this, x, y, b.t);
    }
  }

  /** 보스 몸통 피해 (페이즈 전환·격파) */
  private hitBoss(dmg: number) {
    const b = this.boss;
    if (!b || b.state !== 'fight') return;
    b.hp -= dmg;
    b.flash = 3;
    if (b.hp <= 0) {
      b.hp = 0;
      b.state = 'down';
      this.clearBullets();
      const mid = b.def.kind === 'mid';
      const score = mid ? MID_SCORE : BOSS_SCORE_PER_STAGE * this.opt.stage;
      this.bossScore += score;
      this.addScore(score);
      this.kills++;
      for (let i = 0; i < 8; i++) this.dropItem('C', b.x + (i - 3.5) * 50, b.y + 40, -4 - (i % 3));
      if (mid) this.dropItem('P', b.x, b.y);
      this.events.push({ t: 'bossDown', x: b.x, y: b.y, score, mid });
      return;
    }
    const next = b.def.phases[b.phase];
    if (b.hp / b.maxHp < next.until && b.phase < b.def.phases.length - 1) {
      b.phase++;
      b.t = 0;
      this.clearBullets();
      this.events.push({ t: 'phase', phase: b.phase });
    }
  }

  private hitPart(p: BossPart, dmg: number) {
    if (this.boss?.state !== 'fight' || !p.alive) return;
    p.hp -= dmg;
    p.flash = 3;
    if (p.hp > 0) return;
    p.alive = false;
    this.partScore += PART_SCORE;
    this.addScore(PART_SCORE);
    const b = this.boss!;
    this.dropItem('C', b.x + p.x, b.y + p.y);
    this.events.push({ t: 'partDown', x: b.x + p.x, y: b.y + p.y, score: PART_SCORE });
  }

  private endBoss() {
    const b = this.boss!;
    const mid = b.def.kind === 'mid';
    this.boss = null;
    if (!mid) this.clearAt = this.frame + 150;
  }

  // ---------------- 아이템 ----------------
  dropItem(kind: ItemKind, x: number, y: number, vy = -3) {
    const it = this.items.find(v => !v.alive);
    if (!it) return;
    Object.assign(it, { alive: true, kind, x: clamp(x, 30, W - 30), y, vx: (this.rand() - 0.5) * 2, vy });
  }

  private moveItems() {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.vy = Math.min(it.kind === 'C' ? 3.2 : 2.4, it.vy + 0.1);
      it.x += it.vx; it.y += it.vy;
      if (it.x < 24 || it.x > W - 24) it.vx = -it.vx;
      if (it.y > H + 40) {
        it.alive = false;
        // 금화를 놓치면 연속이 처음부터
        if (it.kind === 'C' && this.coinChain > 0) { this.coinChain = 0; this.events.push({ t: 'coinLost' }); }
      }
    }
  }

  /** 다음 금화 값 */
  get nextCoin() { return Math.min(COIN_MAX, COIN_STEP * (this.coinChain + 1)); }

  private pick(it: Item) {
    it.alive = false;
    let score = 0;
    if (it.kind === 'P') {
      if (this.power < MAX_POWER) this.power++;
      else score = SCORE.maxPowerP;
    } else if (it.kind === 'B') {
      if (this.bombs < MAX_BOMBS) this.bombs++;
    } else {
      score = this.nextCoin;
      this.coinChain++;
      this.coinBest = Math.max(this.coinBest, this.coinChain);
    }
    if (score) this.addScore(score);
    this.events.push({ t: 'pick', x: it.x, y: it.y, kind: it.kind, score });
  }

  private addScore(n: number) {
    this.score += n;
    while (this.nextExtend < EXTENDS.length && this.score >= EXTENDS[this.nextExtend]) {
      this.nextExtend++;
      this.lives++;
      this.events.push({ t: 'extend' });
    }
  }

  // ---------------- 충돌 (원 대 원) ----------------
  private collide() {
    const b = this.boss;
    const bossHit = b && b.state === 'fight';
    // 내 탄 → 적 · 보스 (부위 먼저)
    for (const s of this.ps) {
      if (!s.alive) continue;
      let used = false;
      for (const e of this.en) {
        if (!e.alive || e.y < -10) continue;
        const dx = s.x - e.x, dy = s.y - e.y, r = e.r + 8;
        if (dx * dx + dy * dy < r * r) { s.alive = false; this.damage(e, s.dmg); used = true; break; }
      }
      if (used || !bossHit) continue;
      for (const p of b.parts) {
        if (!p.alive) continue;
        const dx = s.x - (b.x + p.x), dy = s.y - (b.y + p.y), r = p.r + 8;
        if (dx * dx + dy * dy < r * r) { s.alive = false; this.hitPart(p, s.dmg); used = true; break; }
      }
      if (used) continue;
      const dx = s.x - (b.x + b.def.core.x), dy = s.y - (b.y + b.def.core.y), r = b.def.core.r + 8;
      if (dx * dx + dy * dy < r * r) { s.alive = false; this.hitBoss(s.dmg); }
    }
    // 레이저: 기체 위쪽 세로 띠에 닿는 모든 것에 매 스텝 피해 (관통)
    if (this.laser.t > 0) {
      const half = this.laserHalf(), dmg = 0.6 * this.laser.cells;
      for (const e of this.en) {
        if (e.alive && e.y < this.py && e.y > -10 && Math.abs(e.x - this.px) < half + e.r) this.damage(e, dmg);
      }
      if (bossHit && this.boss?.state === 'fight') {
        const bb = this.boss;
        for (const p of bb.parts) if (p.alive && Math.abs(bb.x + p.x - this.px) < half + p.r) this.hitPart(p, dmg);
        if (Math.abs(bb.x + bb.def.core.x - this.px) < half + bb.def.core.r) this.hitBoss(dmg);
      }
    }
    // 아이템 줍기
    for (const it of this.items) {
      if (!it.alive) continue;
      const dx = it.x - this.px, dy = it.y - this.py;
      if (dx * dx + dy * dy < PICK_R * PICK_R) this.pick(it);
    }
    if (this.iframes > 0) return;
    // 적 탄 → 나 (기체 가운데 작은 점)
    for (const bl of this.eb) {
      if (!bl.alive) continue;
      const dx = bl.x - this.px, dy = bl.y - this.py, r = bl.r + HIT_R;
      if (dx * dx + dy * dy < r * r) { bl.alive = false; this.ebCount--; this.hit(); return; }
    }
    // 적 몸통 → 나 (지상 목표는 부딪히지 않는다)
    for (const e of this.en) {
      if (!e.alive || e.kind === 'ground') continue;
      const dx = e.x - this.px, dy = e.y - this.py, r = e.r * 0.7 + HIT_R;
      if (dx * dx + dy * dy < r * r) { this.hit(); return; }
    }
  }

  private hit() {
    this.lives--;
    this.misses++;
    this.events.push({ t: 'hit', x: this.px, y: this.py });
    if (this.power > 1) { this.power--; this.dropItem('P', this.px, this.py - 30, -6); }
    this.chargeT = 0;
    if (this.lives <= 0) {
      this.state = 'over';
      this.events.push({ t: 'over' });
      return;
    }
    this.iframes = HIT_IFRAMES;
  }

  /** 스테이지 클리어 정산: 남은 폭탄 × 5,000 · 노미스 30,000 */
  private finish() {
    const noMiss = this.misses === 0;
    const bombBonus = this.bombs * BONUS.bomb, noMissBonus = noMiss ? BONUS.noMiss : 0;
    this.addScore(bombBonus + noMissBonus);
    this.tally = {
      kills: this.kills, bombs: this.bombs, bombBonus, noMiss, noMissBonus,
      bossScore: this.bossScore, partScore: this.partScore, coinBest: this.coinBest, total: this.score,
    };
    this.state = 'clear';
    this.events.push({ t: 'clear' });
  }
}

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }

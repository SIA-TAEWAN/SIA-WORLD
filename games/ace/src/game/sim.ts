// 시아에이스 시뮬레이션 (화면과 따로, 순수 TypeScript).
// 고정 스텝 1/60초. 탄·적·아이템은 미리 만든 칸(풀)을 돌려 쓰고, 충돌은 원 대 원.
// 화면(StageScene)은 매 프레임 이 상태를 읽어 같은 칸 번호의 그림을 옮기기만 한다.
//
// 스테이지 흐름: 등장표(waves) → 중간 보스(등장표 멈춤) → 등장표 → 남은 적이 사라지면 스테이지 보스 → 정산(clear).
// 기체 13종의 기본샷 · 보조기 · 차지샷 · 폭탄은 data/ships.ts 의 이름으로 고르고, 동작은 이 파일 아래쪽 "무기" 부분.
import { PATTERNS, aimed, type PatternName } from './patterns';
import { SHIPS, type ShipId, type ShotSpec } from '../data/ships';
import { BOSSES, BOSS_SCORE_PER_STAGE, MID_SCORE, PART_SCORE, RUSH, type BossDef } from '../data/bosses';
import type { WaveScript } from '../data/waves';

export const W = 720;
export const H = 1280;
/** 풀 크기: 적 탄은 화면에 동시에 최대 400발 */
export const CAP = { eb: 400, ps: 200, en: 48, item: 48, zone: 4, bolt: 6 } as const;

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
/** 황소호 실드가 다시 차는 시간 */
export const SHIELD_REGEN = 1200;
/** 번개 예고 (스텝) → 내리치는 시간 */
export const BOLT_WARN = 70;
export const BOLT_HIT = 22;

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { bulletSpeed: number; lives: number; revenge: boolean; label: string }> = {
  easy: { bulletSpeed: 0.7, lives: 5, revenge: false, label: '쉬움' },
  normal: { bulletSpeed: 1, lives: 3, revenge: false, label: '보통' },
  hard: { bulletSpeed: 1, lives: 3, revenge: true, label: '어려움' },
};

export type EnemyKind = 'small' | 'medium' | 'carrier' | 'ground';
export type PathName = 'dive' | 'swoopL' | 'swoopR' | 'hover' | 'cross' | 'ground' | 'rise' | 'popup';
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

export interface Bullet { alive: boolean; x: number; y: number; vx: number; vy: number; r: number; big: boolean; turn: number }
/** 내 탄. kind: 0 직진 · 1 유도 · 2 파동 · 3 반사 */
export interface Shot {
  alive: boolean; x: number; y: number; vx: number; vy: number; dmg: number;
  kind: number; pierce: boolean; r: number; life: number; t: number; x0: number; cd: number; bounced: boolean; big: boolean;
}
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
/** 지금 쓰는 중인 차지샷 (레이저 · 돌진 · 방어막 · 자석 · 흡수) */
export interface Act { kind: string; t: number; max: number; cells: number; n: number }
export interface Zone { alive: boolean; x: number; y: number; r: number; t: number; max: number; dmg: number }
/** 번개(위에서) · 불기둥(fire: 아래에서) 예고 구역 */
export interface Bolt { alive: boolean; x: number; w: number; t: number; fire: boolean }

export type SimEvent =
  | { t: 'kill'; x: number; y: number; kind: EnemyKind; score: number }
  | { t: 'hit'; x: number; y: number }
  | { t: 'shield'; x: number; y: number }
  | { t: 'bomb'; x: number; y: number; kind: string }
  | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'pick'; x: number; y: number; kind: ItemKind; score: number }
  | { t: 'coinLost' }
  | { t: 'charge'; cells: number; kind: string; x: number; y: number }
  | { t: 'bossIn'; name: string; mid: boolean }
  | { t: 'phase'; phase: number }
  | { t: 'partDown'; x: number; y: number; score: number }
  | { t: 'bossDown'; x: number; y: number; score: number; mid: boolean }
  | { t: 'flee'; mid: boolean }
  | { t: 'extend' }
  | { t: 'clear' }
  | { t: 'over' };

/** 다음 스테이지로 이어 가는 것 (아케이드) */
export interface Carry { score: number; lives: number; bombs: number; power: number; nextExtend: number }

export interface SimOptions {
  seed: number;
  ship: ShipId;
  waves: WaveScript;
  /** 스테이지 번호 (보스 점수 = 50,000 × 번호) */
  stage?: number;
  difficulty?: Difficulty;
  /** 난이도 탄 속도 배율 (없으면 difficulty 값) */
  bulletSpeed?: number;
  lives?: number;
  carry?: Carry;
  /** 시험용: 화면 위에서 나선탄을 계속 뿜어 400발 가까이 채운다 */
  stress?: boolean;
}

export interface ClearTally {
  kills: number; bombs: number; bombBonus: number; noMiss: boolean; noMissBonus: number;
  bossScore: number; partScore: number; coinBest: number; total: number; frames: number;
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
  readonly opt: { seed: number; ship: ShipId; waves: WaveScript; stage: number; difficulty: Difficulty; bulletSpeed: number; lives: number; stress: boolean };
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
  act: Act = { kind: '', t: 0, max: 1, cells: 0, n: 0 };
  /** 폭탄의 이어지는 효과 (연쇄 · 화염 · 독안개 · 말발굽 · 깃털 방어막) */
  bombAct = { kind: '', t: 0 };
  /** 고양이 폭탄: 적·탄이 멈춘 남은 스텝 */
  freezeT = 0;
  /** 황소호 실드 */
  shieldUp = false;
  shieldT = 0;
  /** 금화 연속 */
  coinChain = 0;
  coinBest = 0;
  /** 보조기 2대 (3단계부터) 위치 */
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
  readonly zones: Zone[] = [];
  readonly bolts: Bolt[] = [];
  ebCount = 0;

  /** 등장표 시간 (스텝). 보스가 있는 동안은 멈춘다 */
  stageT = 0;
  /** 보스 러시: 다음 보스 번호 · 나오는 때 */
  rushIdx = 0;
  private rushNext = 0;
  /** 끝없는 모드: 다음 잡몹 · 다음 보스 (등장표 시간 기준) */
  private nextSpawn = 60;
  private nextEndlessBoss = 5 * 60 * 60;
  /** 이어하기를 썼는가 */
  continued = false;
  nextExtend = 0;
  private waveIdx = 0;
  private loop = 0;
  private midDone = false;
  private bossDone = false;
  private clearAt = 0;
  private groupLeft = new Map<number, { left: number; broken: boolean }>();
  private groupSeq = 0;
  private ebCursor = 0;

  constructor(o: SimOptions) {
    const d = DIFFICULTY[o.difficulty ?? 'normal'];
    this.opt = {
      seed: o.seed, ship: o.ship, waves: o.waves, stage: o.stage ?? 1, difficulty: o.difficulty ?? 'normal',
      bulletSpeed: o.bulletSpeed ?? d.bulletSpeed, lives: o.lives ?? d.lives, stress: !!o.stress,
    };
    this.rand = rng(o.seed);
    this.lives = this.opt.lives;
    if (o.carry) {
      this.score = o.carry.score; this.lives = o.carry.lives; this.bombs = o.carry.bombs;
      this.power = o.carry.power; this.nextExtend = o.carry.nextExtend;
    }
    this.shieldUp = !!this.ship.shield;
    for (let i = 0; i < CAP.eb; i++) this.eb.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 8, big: false, turn: 0 });
    for (let i = 0; i < CAP.ps; i++) this.ps.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 1, kind: 0, pierce: false, r: 8, life: 0, t: 0, x0: 0, cd: 0, bounced: false, big: false });
    for (let i = 0; i < CAP.item; i++) this.items.push({ alive: false, kind: 'P', x: 0, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < CAP.zone; i++) this.zones.push({ alive: false, x: 0, y: 0, r: 0, t: 0, max: 1, dmg: 0 });
    for (let i = 0; i < CAP.bolt; i++) this.bolts.push({ alive: false, x: 0, w: 0, t: 0, fire: false });
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
  get speedMul() { return this.opt.bulletSpeed * (this.opt.waves.bulletSpeed ?? 1) * (1 + this.loop * 0.08) * this.endlessMul; }
  /** 끝없는 모드: 1분마다 10%씩 빨라진다 (최대 2배) */
  get endlessMul() { return this.opt.waves.endless ? Math.min(2, 1 + (this.stageT / 3600) * 0.1) : 1; }
  get mode(): 'stage' | 'rush' | 'endless' { return this.opt.waves.endless ? 'endless' : this.opt.waves.rush ? 'rush' : 'stage'; }

  /** 이어하기 (아케이드 1회): 점수는 0부터, 목숨·폭탄은 처음처럼, 파워와 진행은 그대로 */
  continueRun() {
    if (this.state !== 'over') return;
    this.state = 'play';
    this.continued = true;
    this.lives = this.opt.lives;
    this.score = 0;
    this.nextExtend = 0;
    this.bombs = START_BOMBS;
    this.iframes = 180;
    this.clearBullets();
  }
  /** 다음 스테이지로 넘길 것 */
  carry(): Carry { return { score: this.score, lives: this.lives, bombs: this.bombs, power: this.power, nextExtend: this.nextExtend }; }

  // ---------------- 한 스텝 ----------------
  step(inp: Input) {
    this.events.length = 0;
    if (this.state !== 'play') return;
    this.frame++;
    const frozen = this.freezeT > 0;
    if (frozen) this.freezeT--;
    else this.timeline();
    if (this.opt.stress) this.stressEmit();
    this.movePlayer(inp);
    if (inp.bomb) this.useBomb();
    this.chargeStep(inp.charge);
    this.bombStep();
    this.fireShots();
    this.moveShots();
    if (!frozen) { this.moveEnemies(); this.moveBoss(); this.moveBullets(); }
    this.moveItems();
    this.zonesStep();
    if (!frozen) this.boltsStep();
    this.collide();
    if (this.iframes > 0) this.iframes--;
    if (this.bombFx > 0) this.bombFx--;
    if (this.ship.shield && !this.shieldUp && ++this.shieldT >= SHIELD_REGEN) { this.shieldUp = true; this.shieldT = 0; }
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
    const sc = this.opt.waves;
    if (sc.rush) { this.rushTimeline(sc.rush); return; }
    if (this.boss) return;
    if (sc.endless) { this.endlessTimeline(); return; }
    this.stageT++;
    const t = this.stageT;
    if (sc.midboss && !this.midDone && t >= sc.midboss.at * 60) {
      this.midDone = true;
      this.spawnBoss(sc.midboss.id);
      return;
    }
    while (this.waveIdx < sc.waves.length && sc.waves[this.waveIdx].at * 60 <= t) {
      const w = sc.waves[this.waveIdx++];
      if (w.kind === 'bolt' || w.kind === 'pillar') { this.addBolt(w.x * W, w.w ?? 90, w.kind === 'pillar'); continue; }
      const g = ++this.groupSeq;
      const n = w.count ?? 1;
      if (w.kind === 'small' && n > 1) this.groupLeft.set(g, { left: n, broken: false });
      for (let i = 0; i < n; i++) {
        const dx = (w.dx ?? 0) * i, delay = (w.gap ?? 0) * i;
        const y = w.path === 'rise' ? (w.y ?? 0.3) * H + delay * 4 : -40 - delay * 6;
        this.spawnEnemy(w.kind, w.path, w.x * W + dx, y, g, w.drop ?? null, w.fire ?? null, w.fireEvery ?? 0, w.hp);
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

  /** 보스 러시: 보스 12마리를 차례로. 사이사이 3초 쉬며 P · B 보급 */
  private rushTimeline(list: string[]) {
    if (this.boss || this.clearAt) return;
    if (!this.rushNext) this.rushNext = this.frame + 60;
    if (this.frame >= this.rushNext && this.rushIdx < list.length) this.spawnBoss(list[this.rushIdx++]);
  }

  /** 끝없는 모드: 잡몹이 점점 빨리 · 많이, 5분마다 무작위 보스 */
  private endlessTimeline() {
    const t = ++this.stageT, min = t / 3600;
    if (t >= this.nextEndlessBoss) {
      this.nextEndlessBoss += 5 * 60 * 60;
      this.spawnBoss(RUSH[Math.floor(this.rand() * RUSH.length)]);
      return;
    }
    if (t < this.nextSpawn) return;
    this.nextSpawn = t + Math.max(36, Math.round(150 - min * 16));
    const r = this.rand(), x = 0.15 + this.rand() * 0.7, hp = 1 + min * 0.15, fe = Math.max(50, Math.round(150 - min * 12));
    const g = ++this.groupSeq;
    if (r < 0.5) {
      const path = (['dive', 'swoopL', 'swoopR'] as const)[Math.floor(this.rand() * 3)], n = 5 + Math.floor(this.rand() * 3);
      this.groupLeft.set(g, { left: n, broken: false });
      for (let i = 0; i < n; i++) this.spawnEnemy('small', path, x * W, -40 - i * 60, g, null, t > 1800 ? 'aim1' : null, fe, hp);
    } else if (r < 0.72) this.spawnEnemy('medium', 'hover', x * W, -40, 0, null, (['aim3', 'ring16', 'petal', 'aim5'] as const)[Math.floor(this.rand() * 4)], Math.round(fe * 0.6), hp);
    else if (r < 0.9) this.spawnEnemy('ground', 'ground', x * W, -60, 0, null, 'aim3', fe, hp);
    else this.spawnEnemy('carrier', 'cross', this.rand() < 0.5 ? 0 : W, 0, 0, this.rand() < 0.5 ? 'B' : 'P');
  }

  // ---------------- 플레이어 ----------------
  private movePlayer(inp: Input) {
    const sp = this.ship.speed;
    let dx = inp.dx + inp.kx * sp;
    let dy = inp.dy + inp.ky * sp;
    // 한 스텝에 너무 멀리 뛰지 않게 (느린 기체는 손가락을 확 끌어도 조금 늦게 따라온다)
    const m = Math.hypot(dx, dy), lim = sp * 2.6;
    if (m > lim) { dx *= lim / m; dy *= lim / m; }
    const ox = this.px;
    this.px = clamp(this.px + dx, 36, W - 36);
    this.py = clamp(this.py + dy, 120, H - 60);
    this.pvx = this.px - ox;
    this.moveOptions();
  }

  private moveOptions() {
    const kind = this.ship.option;
    for (let i = 0; i < 2; i++) {
      const o = this.opts[i];
      let tx = this.px + (i ? 84 : -84), ty = this.py + 26;
      if (kind === 'hunter' && this.power >= 3) {
        // 견우호: 가까운 적을 쫓아가 그 아래에서 쏜다
        const tg = this.target(o.x, o.y, i);
        if (tg) { tx = tg.x + (i ? 40 : -40); ty = Math.min(H - 80, tg.y + 170); }
      }
      if (kind === 'cloud') ty = this.py - 70;
      const k = kind === 'hunter' ? 0.08 : 0.25;
      o.x += (tx - o.x) * k;
      o.y += (ty - o.y) * k;
    }
  }

  /** 가장 가까운 목표 (적 또는 보스) */
  target(x: number, y: number, skip = 0): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null, bd = Infinity, n = 0;
    for (const e of this.en) {
      if (!e.alive || e.y < 0 || this.hidden(e)) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd || (d === bd && n++ === skip)) { bd = d; best = e; }
    }
    const b = this.boss;
    if (b && b.state === 'fight') {
      const bx = b.x + b.def.core.x, by = b.y + b.def.core.y;
      const d = (bx - x) ** 2 + (by - y) ** 2;
      if (d < bd) best = { x: bx, y: by };
    }
    return best;
  }

  // ---------------- 무기: 기본샷 ----------------
  private fireShots() {
    const s = this.ship;
    // 돌진 중에는 기본샷을 쉬고 몸으로 부딪힌다 (돌진이 끝나면 다시 쏜다)
    const dashing = this.act.t > 0 && (this.act.kind === 'dash' || this.act.kind === 'tigerDash' || this.act.kind === 'pierceDash');
    if (this.frame % s.every !== 0 || dashing) return;
    for (const sp of s.fire[this.power - 1]) this.shotFrom(this.px, this.py - 40, sp);
    if (this.power < 3 || this.frame % (s.every * 2) !== 0) return;
    for (const o of this.opts) {
      if (s.option === 'clone') for (const sp of s.fire[0]) this.shotFrom(o.x, o.y - 20, { ...sp, dmg: sp.dmg * 0.6 });
      else if (s.option === 'hunter') {
        const tg = this.target(o.x, o.y);
        const a = tg ? Math.atan2(tg.x - o.x, -(tg.y - o.y)) : 0;
        this.shotFrom(o.x, o.y - 20, { x: 0, a, dmg: 1 });
      } else this.shotFrom(o.x, o.y - 20, { x: 0, dmg: 1 });
    }
  }

  /** ShotSpec 대로 한 발 (a = 위쪽에서 시계 방향 각도) */
  private shotFrom(x: number, y: number, sp: ShotSpec) {
    const kind = sp.kind === 'homing' ? 1 : sp.kind === 'wave' ? 2 : sp.kind === 'bounce' ? 3 : 0;
    const v = sp.v ?? (kind === 1 ? 17 : kind === 2 ? 22 : 30), a = sp.a ?? 0;
    this.addShot(x + sp.x, y, Math.sin(a) * v, -Math.cos(a) * v, sp.dmg * this.ship.dmg, kind, !!sp.pierce, sp.r ?? 8, sp.life ?? 0);
  }

  addShot(x: number, y: number, vx: number, vy: number, dmg: number, kind = 0, pierce = false, r = 8, life = 0, big = false) {
    for (const s of this.ps) {
      if (s.alive) continue;
      s.alive = true; s.x = x; s.y = y; s.vx = vx; s.vy = vy; s.dmg = dmg; s.kind = kind; s.pierce = pierce;
      s.r = r; s.life = life; s.t = 0; s.x0 = x; s.cd = 0; s.bounced = false; s.big = big;
      return;
    }
  }

  private moveShots() {
    for (const s of this.ps) {
      if (!s.alive) continue;
      s.t++;
      if (s.cd > 0) s.cd--;
      if (s.life && s.t >= s.life) { s.alive = false; continue; }
      if (s.kind === 1 && s.t > 6 && s.t % 3 === 0) {
        // 유도: 가까운 목표 쪽으로 조금씩 꺾는다
        const tg = this.target(s.x, s.y);
        if (tg) {
          const sp = Math.hypot(s.vx, s.vy), a = Math.atan2(s.vy, s.vx), want = Math.atan2(tg.y - s.y, tg.x - s.x);
          let d = want - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
          const na = a + clamp(d, -0.3, 0.3);
          s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp;
        }
      }
      if (s.kind === 2) { s.x0 += s.vx; s.x = s.x0 + Math.sin(s.t * 0.22) * 30; } else s.x += s.vx;
      s.y += s.vy;
      if (s.kind === 3 && !s.bounced && (s.x < 12 || s.x > W - 12)) { s.vx = -s.vx; s.bounced = true; s.x = clamp(s.x, 12, W - 12); }
      if (s.y < -60 || s.y > H + 60 || s.x < -60 || s.x > W + 60) s.alive = false;
    }
  }

  // ---------------- 무기: 차지샷 ----------------
  /** 누르고 있는 동안 게이지가 차고, 1칸 이상일 때 떼면 기체마다 다른 차지샷 */
  private chargeStep(held: boolean) {
    if (this.act.t > 0) { this.actStep(); this.chargeT = 0; return; }
    if (held) { this.chargeT = Math.min(this.chargeT + 1, CHARGE_CELL * CHARGE_MAX); return; }
    const c = this.chargeCells;
    this.chargeT = 0;
    if (c < 1) return;
    const kind = this.ship.charge;
    const start = (t: number) => { this.act = { kind, t, max: t, cells: c, n: 0 }; };
    switch (kind) {
      case 'laser': start(24 + c * 14); break;
      case 'dash': start(26 + c * 12); break;
      case 'tigerDash': case 'pierceDash': start(26 + c * 12); this.iframes = Math.max(this.iframes, 30 + c * 12); break;
      case 'wool': start(90 + c * 60); break;
      case 'magnet': start(180 + c * 90); break;
      case 'absorb': start(50 + c * 25); break;
      case 'burst':
        for (let i = 0, n = 6 + c * 6; i < n; i++) { const a = (i / n) * Math.PI * 2; this.addShot(this.px, this.py, Math.cos(a) * 16, Math.sin(a) * 16, 2.5, 0, true, 12, 40, true); }
        break;
      case 'teleport':
        this.py = clamp(this.py - (200 + c * 50), 120, H - 60);
        this.iframes = Math.max(this.iframes, 40 + c * 15);
        for (let i = 0, n = 6 * c; i < n; i++) { const a = (i / n) * Math.PI * 2; this.addShot(this.px, this.py, Math.cos(a) * 14, Math.sin(a) * 14, 3, 0, true, 12, 30, true); }
        break;
      case 'poison': {
        const z = this.zones.find(v => !v.alive);
        if (z) Object.assign(z, { alive: true, x: this.px, y: Math.max(160, this.py - 330), r: 100 + c * 25, t: 150 + c * 60, max: 150 + c * 60, dmg: 0.12 + c * 0.1 });
        break;
      }
      case 'cloneRush':
        for (let i = 0, n = 2 + c * 2; i < n; i++) this.addShot(this.px + (i - (n - 1) / 2) * 50, this.py - 30, 0, -15, 1.4, 0, true, 26, 90, true);
        break;
      case 'homing':
        for (let i = 0, n = 5 * c; i < n; i++) { const a = -Math.PI / 2 + (i / (n - 1 || 1) - 0.5) * 2.4; this.addShot(this.px, this.py - 20, Math.cos(a) * 15, Math.sin(a) * 15, 2, 1, false, 10, 140); }
        break;
      case 'bite':
        this.areaDamage(this.px, this.py - 120, 150, 25 * c, true);
        this.events.push({ t: 'boom', x: this.px, y: this.py - 120, r: 150 });
        break;
    }
    this.events.push({ t: 'charge', cells: c, kind, x: this.px, y: this.py });
  }

  /** 이어지는 차지샷 (매 스텝) */
  private actStep() {
    const a = this.act, c = a.cells;
    a.t--;
    switch (a.kind) {
      case 'dash': case 'tigerDash': case 'pierceDash': {
        const r = 90 + c * 20;
        this.areaDamage(this.px, this.py - 80, r, 1.1 * c);
        this.clearBulletsIn(this.px, this.py - 80, r);
        break;
      }
      case 'wool': this.clearBulletsIn(this.px, this.py, 125); break;
      case 'absorb': a.n += this.clearBulletsIn(this.px, this.py, 150);
        if (a.t === 0) {
          // 흡수한 탄만큼 유도탄으로 되돌려 준다
          for (let i = 0, n = Math.min(48, 6 + a.n); i < n; i++) { const an = -Math.PI / 2 + (i / n - 0.5) * 2.8; this.addShot(this.px, this.py - 20, Math.cos(an) * 15, Math.sin(an) * 15, 1.4, 1, false, 10, 140); }
          this.events.push({ t: 'boom', x: this.px, y: this.py, r: 150 });
        }
        break;
    }
  }

  /** 레이저 너비 (반폭, 월드 px) */
  laserHalf() { return 22 + this.act.cells * 12; }
  get laserOn() { return this.act.t > 0 && this.act.kind === 'laser'; }

  private zonesStep() {
    for (const z of this.zones) {
      if (!z.alive) continue;
      z.y += SCROLL * 0.5;
      if (--z.t <= 0) { z.alive = false; continue; }
      this.areaDamage(z.x, z.y, z.r, z.dmg);
    }
  }

  // ---------------- 무기: 폭탄 ----------------
  useBomb() {
    if (this.bombs <= 0 || this.bombFx > 0 || this.state !== 'play') return false;
    const kind = this.ship.bomb;
    this.bombs--;
    this.bombFx = 50;
    this.iframes = Math.max(this.iframes, BOMB_IFRAMES);
    this.clearBullets();
    const all = (d: number) => this.allDamage(d);
    switch (kind) {
      case 'chain': this.bombAct = { kind, t: 48 }; all(10); break;
      case 'quake': all(50); break;
      case 'roar': all(55); break;
      case 'moon': all(48); break;
      case 'barrage': all(50); break;
      case 'track': all(45); break;
      case 'flame': this.bombAct = { kind, t: 60 }; all(20); break;
      case 'mist': this.bombAct = { kind, t: 90 }; all(20); break;
      case 'hooves': this.bombAct = { kind, t: 60 }; all(10); break;
      case 'longGuard': this.iframes = Math.max(this.iframes, 240); all(25); break;
      case 'feather': this.bombAct = { kind, t: 240 }; all(20); break;
      case 'coinRain': all(30); for (let i = 0; i < 14; i++) this.dropItem('C', 40 + (i * (W - 80)) / 13, -20 - (i % 3) * 40, 1); break;
      case 'freeze': this.freezeT = 120; all(20); break;
    }
    this.events.push({ t: 'bomb', x: this.px, y: this.py, kind });
    return true;
  }

  private bombStep() {
    const b = this.bombAct;
    if (b.t <= 0) return;
    b.t--;
    switch (b.kind) {
      case 'chain':
        if (b.t % 12 === 0) { this.allDamage(12); this.events.push({ t: 'boom', x: 120 + this.rand() * (W - 240), y: 200 + this.rand() * 600, r: 120 }); }
        break;
      case 'flame': this.areaDamage(this.px, H / 2, 0, 2.5, false, 150); this.clearBulletsIn(this.px, H / 2, 0, 150); break;
      case 'mist': this.allDamage(0.8); break;
      case 'hooves':
        if (b.t % 10 === 0) {
          const tg = this.target(this.px, this.py - 300) ?? { x: 120 + this.rand() * (W - 240), y: 300 };
          this.areaDamage(tg.x, tg.y, 120, 35, true);
          this.events.push({ t: 'boom', x: tg.x, y: tg.y, r: 120 });
        }
        break;
      case 'feather': this.clearBulletsIn(this.px, this.py, 160); break;
    }
  }

  clearBullets() {
    for (const b of this.eb) b.alive = false;
    this.ebCount = 0;
  }

  /** 원(또는 세로 띠: halfW > 0) 안의 적 탄 지우기. 지운 수를 돌려준다 */
  private clearBulletsIn(x: number, y: number, r: number, halfW = 0) {
    let n = 0;
    for (const b of this.eb) {
      if (!b.alive) continue;
      const inside = halfW ? Math.abs(b.x - x) < halfW : (b.x - x) ** 2 + (b.y - y) ** 2 < r * r;
      if (inside) { b.alive = false; this.ebCount--; n++; }
    }
    return n;
  }

  /** 원(또는 세로 띠) 안의 적 · 보스 부위 · 보스 몸통에 피해 */
  private areaDamage(x: number, y: number, r: number, dmg: number, once = false, halfW = 0) {
    const hit = (tx: number, ty: number, tr: number) => halfW ? Math.abs(tx - x) < halfW + tr : (tx - x) ** 2 + (ty - y) ** 2 < (r + tr) ** 2;
    for (const e of this.en) if (e.alive && e.y > -10 && !this.hidden(e) && hit(e.x, e.y, e.r)) this.damage(e, dmg);
    const b = this.boss;
    if (!b || b.state !== 'fight') return;
    for (const p of b.parts) if (p.alive && hit(b.x + p.x, b.y + p.y, p.r)) this.hitPart(p, dmg);
    if (hit(b.x + b.def.core.x, b.y + b.def.core.y, b.def.core.r)) this.hitBoss(once ? dmg * 0.8 : dmg);
  }

  /** 화면 안 모든 적 + 보스 몸통 */
  private allDamage(dmg: number) {
    for (const e of this.en) if (e.alive && e.y > -20 && !this.hidden(e)) this.damage(e, dmg);
    if (this.boss?.state === 'fight') this.hitBoss(dmg * 1.2);
  }

  // ---------------- 적 탄 · 번개 ----------------
  /** 빈 칸에 적 탄 하나. 400발이 다 차 있으면 쏘지 않는다. turn = 스텝마다 도는 각도 (곡선 탄) */
  addBullet(x: number, y: number, vx: number, vy: number, big = false, turn = 0) {
    if (this.ebCount >= CAP.eb) return;
    for (let n = 0; n < CAP.eb; n++) {
      const i = (this.ebCursor + n) % CAP.eb, b = this.eb[i];
      if (b.alive) continue;
      b.alive = true; b.x = x; b.y = y; b.vx = vx * this.speedMul; b.vy = vy * this.speedMul; b.big = big; b.r = big ? 11 : 7; b.turn = turn;
      this.ebCount++;
      this.ebCursor = (i + 1) % CAP.eb;
      return;
    }
  }

  /** 8 바람 고원: 지금 부는 바람 (적 탄이 옆으로 밀린다) */
  get wind() { const w = this.opt.waves.wind ?? 0; return w ? Math.sin(this.frame / 240) * w : 0; }

  private moveBullets() {
    const wind = this.wind * 0.035;
    for (const b of this.eb) {
      if (!b.alive) continue;
      if (wind) b.vx += wind;
      if (b.turn) { const c = Math.cos(b.turn), s = Math.sin(b.turn), vx = b.vx; b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c; }
      b.x += b.vx; b.y += b.vy;
      if (b.y < -30 || b.y > H + 30 || b.x < -30 || b.x > W + 30) { b.alive = false; this.ebCount--; }
    }
  }

  /** 번개 예고 구역 (5스테이지): BOLT_WARN 동안 예고, 그 뒤 BOLT_HIT 동안 세로 띠 안에 있으면 맞는다 */
  addBolt(x: number, w: number, fire = false) {
    const b = this.bolts.find(v => !v.alive);
    if (b) Object.assign(b, { alive: true, x: clamp(x, w, W - w), w, t: 0, fire });
  }

  private boltsStep() {
    for (const b of this.bolts) {
      if (!b.alive) continue;
      if (++b.t > BOLT_WARN + BOLT_HIT) b.alive = false;
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
  spawnEnemy(kind: EnemyKind, path: PathName, x: number, y: number, group = 0, drop: ItemKind | null = null, fire: PatternName | null = null, fireEvery = 0, hpMul = 1) {
    const e = this.en.find(v => !v.alive);
    if (!e) return null;
    const base = ENEMY_BASE[kind];
    const hp = Math.round(base.hp * hpMul * (1 + this.loop * 0.15) * (1 + (this.opt.stage - 1) * 0.06));
    Object.assign(e, {
      alive: true, kind, path, x, y, x0: x, y0: y, vx: 0, vy: 0, hp, maxHp: hp, r: base.r, t: 0, flash: 0,
      group, drop, fire, fireEvery, fireAt: fireEvery ? 40 + Math.floor(this.rand() * fireEvery) : 0,
    });
    if (path === 'cross') { e.y = 160 + this.rand() * 200; e.x = x < W / 2 ? -50 : W + 50; e.y0 = e.y; e.x0 = e.x; }
    if (path === 'ground' || path === 'popup') e.y = -60;
    return e;
  }

  /** 물·안개 속에서 솟는 중이라 아직 맞지도 않고 부딪히지도 않는 적 */
  hidden(e: Enemy) {
    if (e.path === 'rise') return e.t < 36 || e.t > 330;
    // 10 폐허 성곽: 벽 뒤에 숨었다가 잠깐 나와 쏜다
    if (e.path === 'popup') return e.t % 200 < 90;
    return false;
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
        case 'ground': case 'popup':
          // 지상·해상 목표: 바닥과 같이 흘러내린다
          e.vx = 0; e.vy = SCROLL;
          break;
        case 'rise':
          // 물·안개 속에서 솟아 잠시 쏘고 다시 가라앉는다
          e.vx = Math.sin(t / 40) * 0.8; e.vy = SCROLL * 0.4;
          if (t > 366) e.alive = false;
          break;
      }
      e.x += e.vx; e.y += e.vy;
      if (e.fire && e.y > 0 && e.y < H * 0.7 && t >= e.fireAt && !this.hidden(e)) {
        e.fireAt = t + e.fireEvery;
        PATTERNS[e.fire](this, e.x, e.y + e.r * 0.5, t);
      }
      const out = !e.alive || e.y > H + 80 || e.x < -100 || e.x > W + 100 || (e.path === 'hover' && t > 640 && e.y < -80);
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
    // 어려움: 격추한 적이 되받아치기탄을 쏜다
    if (DIFFICULTY[this.opt.difficulty].revenge && e.kind !== 'carrier' && e.y < this.py - 120) aimed(this, e.x, e.y, 3.6);
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
      if (b.state === 'down' || b.y < -def.width * 1.4) this.endBoss();
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
      const score = mid ? MID_SCORE : BOSS_SCORE_PER_STAGE * (this.mode === 'rush' ? this.rushIdx : this.opt.stage);
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
    if (this.mode === 'rush') {
      // 다음 보스까지 3초, P · B 보급
      if (this.rushIdx >= (this.opt.waves.rush?.length ?? 0)) this.clearAt = this.frame + 150;
      else { this.rushNext = this.frame + 180; this.dropItem('P', W * 0.35, 120, 1); this.dropItem('B', W * 0.65, 120, 1); }
      return;
    }
    if (this.mode === 'endless') return;
    if (!mid) this.clearAt = this.frame + 150;
  }

  // ---------------- 아이템 ----------------
  dropItem(kind: ItemKind, x: number, y: number, vy = -3) {
    const it = this.items.find(v => !v.alive);
    if (!it) return;
    Object.assign(it, { alive: true, kind, x: clamp(x, 30, W - 30), y, vx: (this.rand() - 0.5) * 2, vy });
  }

  get magnetOn() { return this.act.t > 0 && this.act.kind === 'magnet'; }

  private moveItems() {
    const mag = this.magnetOn;
    for (const it of this.items) {
      if (!it.alive) continue;
      if (mag && it.y > 0) {
        // 복돼지호 금화 자석: 화면의 아이템이 기체로 빨려 온다
        const dx = this.px - it.x, dy = this.py - it.y, d = Math.hypot(dx, dy) || 1;
        it.x += (dx / d) * 14; it.y += (dy / d) * 14;
        continue;
      }
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
      // 자석을 켠 동안 금화는 두 배
      score = this.nextCoin * (this.magnetOn ? 2 : 1);
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
    const bossHit = !!b && b.state === 'fight';
    // 내 탄 → 적 · 보스 (부위 먼저)
    for (const s of this.ps) {
      if (!s.alive || s.cd > 0) continue;
      let hitSomething = false;
      for (const e of this.en) {
        if (!e.alive || e.y < -10 || this.hidden(e)) continue;
        const dx = s.x - e.x, dy = s.y - e.y, r = e.r + s.r;
        if (dx * dx + dy * dy < r * r) { this.damage(e, s.dmg); hitSomething = true; break; }
      }
      if (!hitSomething && bossHit && b) {
        for (const p of b.parts) {
          if (!p.alive) continue;
          const dx = s.x - (b.x + p.x), dy = s.y - (b.y + p.y), r = p.r + s.r;
          if (dx * dx + dy * dy < r * r) { this.hitPart(p, s.dmg); hitSomething = true; break; }
        }
        if (!hitSomething) {
          const dx = s.x - (b.x + b.def.core.x), dy = s.y - (b.y + b.def.core.y), r = b.def.core.r + s.r;
          if (dx * dx + dy * dy < r * r) { this.hitBoss(s.dmg); hitSomething = true; }
        }
      }
      if (hitSomething) { if (s.pierce) s.cd = 6; else s.alive = false; }
    }
    // 레이저: 기체 위쪽 세로 띠에 닿는 모든 것에 매 스텝 피해 (관통)
    if (this.laserOn) {
      const half = this.laserHalf(), dmg = 0.6 * this.act.cells;
      for (const e of this.en) {
        if (e.alive && e.y < this.py && e.y > -10 && !this.hidden(e) && Math.abs(e.x - this.px) < half + e.r) this.damage(e, dmg);
      }
      const bb = this.boss;
      if (bb && bb.state === 'fight') {
        for (const p of bb.parts) if (p.alive && Math.abs(bb.x + p.x - this.px) < half + p.r) this.hitPart(p, dmg);
        if (Math.abs(bb.x + bb.def.core.x - this.px) < half + bb.def.core.r) this.hitBoss(dmg);
      }
    }
    // 구름 보조기 (운양호): 닿는 적 탄을 막는다
    if (this.ship.option === 'cloud' && this.power >= 3) for (const o of this.opts) this.clearBulletsIn(o.x, o.y, 36);
    // 아이템 줍기
    for (const it of this.items) {
      if (!it.alive) continue;
      const dx = it.x - this.px, dy = it.y - this.py;
      if (dx * dx + dy * dy < PICK_R * PICK_R) this.pick(it);
    }
    if (this.iframes > 0) return;
    // 번개
    for (const bo of this.bolts) {
      if (bo.alive && bo.t > BOLT_WARN && Math.abs(this.px - bo.x) < bo.w) { this.hit(); return; }
    }
    // 적 탄 → 나 (기체 가운데 작은 점)
    for (const bl of this.eb) {
      if (!bl.alive) continue;
      const dx = bl.x - this.px, dy = bl.y - this.py, r = bl.r + HIT_R;
      if (dx * dx + dy * dy < r * r) { bl.alive = false; this.ebCount--; this.hit(); return; }
    }
    // 적 몸통 → 나 (지상 목표 · 솟는 중인 적은 부딪히지 않는다)
    for (const e of this.en) {
      if (!e.alive || e.kind === 'ground' || e.path === 'popup' || this.hidden(e)) continue;
      const dx = e.x - this.px, dy = e.y - this.py, r = e.r * 0.7 + HIT_R;
      if (dx * dx + dy * dy < r * r) { this.hit(); return; }
    }
  }

  private hit() {
    // 황소호 실드: 한 번 막고 20초 뒤 다시 찬다
    if (this.shieldUp) {
      this.shieldUp = false;
      this.shieldT = 0;
      this.iframes = 60;
      this.events.push({ t: 'shield', x: this.px, y: this.py });
      return;
    }
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
      bossScore: this.bossScore, partScore: this.partScore, coinBest: this.coinBest, total: this.score, frames: this.frame,
    };
    this.state = 'clear';
    this.events.push({ t: 'clear' });
  }
}

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }

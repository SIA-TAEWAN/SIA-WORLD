import Phaser from 'phaser';
import { artUrl, zodiacFaceUrl } from '../assets';
import { choose } from '../game/autopilot';
import { DEV_AUTO, DEV_SPEED } from '../net/local';
import {
  DEBUFF_NAMES,
  HEROES,
  PORTAL_R,
  STEP,
  dirOf,
  aimPreview,
  beginShot,
  canSpecial,
  endTurn,
  shotDone,
  stepShot,
  threats,
  type RunState,
  type ShotInput,
  type SimEvent,
} from '../sim';
import { COLOR, FONT } from '../theme';
import { ensureArt, makeBall } from './art';

/** 기준 화면 크기 (세로 9:16) */
export const W = 720;
export const H = 1280;
/** 방을 그리는 자리 (방 좌표 + 이 값 = 화면 좌표) */
export const RX = 40;
export const RY = 150;
/** 아래 파티 줄 */
const BAR_Y = 1124;
const SLOT_W = 150;
/** 필살기 버튼 */
const SP_X = 4 * SLOT_W + 14;
const SP_W = W - SP_X - 8;
/** 이만큼 당기면 힘 100 */
const PULL_FULL = 300;
/** 시작 자리에서 이 거리 안으로 돌아와 떼면 취소 */
const CANCEL_R = 40;

export interface SceneHooks {
  /** 판이 끝났다 (클리어·실패 연출 뒤) */
  onEnd(s: RunState): void;
  /** 매 화면마다 (HUD 갱신) */
  onFrame(s: RunState): void;
  /** 효과음 */
  sound(name: string, opts?: { volume?: number; rate?: number }): void;
}

type Mode = 'aim' | 'fly' | 'wait' | 'enemy' | 'end';

interface FoeView {
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  num: Phaser.GameObjects.Text;
}

interface SlotView {
  img: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
}

const ringOf = (type: string) => (type === 'pierce' ? COLOR.accent : COLOR.teamA);

export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private hooks!: SceneHooks;
  private ground = 'tile-field';
  paused = false;
  private mode: Mode = 'aim';
  private acc = 0;
  private waitUntil = 0;
  private queue: SimEvent[] = [];
  private nextEventAt = 0;
  private endAt = 0;

  private floor!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private aimG!: Phaser.GameObjects.Graphics;
  private barG!: Phaser.GameObjects.Graphics;
  private heroImgs: Phaser.GameObjects.Image[] = [];
  private cloneImgs: Phaser.GameObjects.Image[] = [];
  private foeViews = new Map<number, FoeView>();
  private pickViews = new Map<number, Phaser.GameObjects.Image | Phaser.GameObjects.Graphics>();
  private slots: SlotView[] = [];
  private spText!: Phaser.GameObjects.Text;
  /** 표시용 체력 (실제 값을 천천히 따라간다) */
  private shownHp: number[] = [];

  /** 당기는 중: 손가락 번호(음수일 수 있으므로 null 로 없음 판정) · 시작 자리 */
  private drag: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  /** 날아가는 동안 누르고 있는 손가락 (2배속) */
  private fastId: number | null = null;
  /** 필살기를 이번 발사에 쓴다 */
  private armed = false;
  /** 자동 플레이: 고른 수와 쏠 시각 */
  private autoPick: { inp: ShotInput; at: number } | null = null;
  private autoAt = 0;

  constructor() {
    super('game');
  }

  init(data: { run: RunState; hooks: SceneHooks; ground?: string }) {
    this.run = data.run;
    this.hooks = data.hooks;
    this.ground = `tile-${data.ground ?? 'field'}`;
    this.paused = false;
    this.mode = this.run.phase === 'aim' ? 'aim' : 'end';
    this.acc = 0;
    this.queue = [];
    this.heroImgs = [];
    this.cloneImgs = [];
    this.foeViews.clear();
    this.pickViews.clear();
    this.slots = [];
    this.drag = null;
    this.fastId = null;
    this.armed = false;
    this.autoPick = null;
    this.autoAt = 0;
    this.shownHp = this.run.heroes.map((h) => h.hp);
  }

  /** 이번 판에 쓰는 그림 키 */
  private artKeys(): string[] {
    const keys = new Set<string>([this.ground, 'fx-pop', 'fx-coin', 'p-shuriken']);
    for (const w of this.run.cfg.waves) for (const f of w) keys.add(f.art);
    return [...keys];
  }

  preload() {
    for (const k of this.artKeys()) this.load.image(k, artUrl(k));
    for (const h of this.run.heroes) this.load.image(`face-${h.id}`, zodiacFaceUrl(h.id));
  }

  create() {
    ensureArt(this, this.artKeys());
    const s = this.run;
    const { w, h } = s.cfg;
    // 바닥 · 벽
    const tile = this.add.tileSprite(RX + w / 2, RY + h / 2, w, h, this.ground).setDepth(-20);
    tile.tileScaleX = tile.tileScaleY = 0.5;
    const walls = this.add.graphics().setDepth(-10);
    walls.lineStyle(10, COLOR.outline, 1).strokeRoundedRect(RX - 5, RY - 5, w + 10, h + 10, 14);
    // 돌기둥 (방 테두리 4개 다음부터 4개씩)
    for (let i = 4; i + 3 < s.cfg.walls.length; i += 4) {
      const [x0, y0] = s.cfg.walls[i];
      const [x1, y1] = s.cfg.walls[i + 1].slice(2);
      walls.fillStyle(COLOR.inkSoft, 1).fillRect(RX + x0, RY + y0, x1 - x0, y1 - y0);
      walls.fillStyle(COLOR.emptyLine, 1).fillRect(RX + x0 + 4, RY + y0 + 4, x1 - x0 - 8, (y1 - y0) / 2 - 4);
      walls.lineStyle(5, COLOR.outline, 1).strokeRect(RX + x0, RY + y0, x1 - x0, y1 - y0);
    }
    this.drawObstacles();
    this.floor = this.add.graphics().setDepth(-5);
    this.fx = this.add.graphics().setDepth(800);
    this.aimG = this.add.graphics().setDepth(900);
    this.barG = this.add.graphics().setDepth(1000);

    // 대원 구슬
    s.heroes.forEach((hero, i) => {
      makeBall(this, `ball-${hero.id}`, `face-${hero.id}`, ringOf(hero.type), HEROES[hero.id].name.slice(0, 1));
      this.heroImgs[i] = this.add.image(0, 0, `ball-${hero.id}`).setDepth(500);
      const slotImg = this.add.image(i * SLOT_W + 44, BAR_Y + 58, `ball-${hero.id}`).setDisplaySize(64, 64).setDepth(1001);
      const name = this.add
        .text(i * SLOT_W + 82, BAR_Y + 22, HEROES[hero.id].name, { fontFamily: FONT, fontSize: '24px', color: '#2a1a10' })
        .setOrigin(0, 0.5)
        .setDepth(1001);
      this.slots.push({ img: slotImg, name });
    });
    this.spText = this.add
      .text(SP_X + SP_W / 2, BAR_Y + 70, '필살기', { fontFamily: FONT, fontSize: '24px', color: '#2a1a10', align: 'center' })
      .setOrigin(0.5)
      .setDepth(1002);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.drag && p.id === this.drag.id) {
        this.drag.x = p.x;
        this.drag.y = p.y;
      }
    });
    const up = (p: Phaser.Input.Pointer) => this.up(p);
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    this.input.keyboard?.on('keydown-SPACE', () => this.toggleSpecial());
  }

  /** 장애물 코드 그림 (전용 그림은 7단계): 가시밭 · 빨래판 · 둥근 돌기둥 · 순간이동 구멍 */
  private drawObstacles() {
    const cfg = this.run.cfg;
    const g = this.add.graphics().setDepth(-8);
    for (const z of cfg.zones ?? []) {
      const x = RX + z.x;
      const y = RY + z.y;
      if (z.k === 'thorn') {
        g.fillStyle(COLOR.win, 0.45).fillRoundedRect(x, y, z.w, z.h, 12);
        g.lineStyle(4, COLOR.outline, 0.8).strokeRoundedRect(x, y, z.w, z.h, 12);
        // 가시 (작은 세모)
        g.fillStyle(COLOR.outline, 0.75);
        for (let yy = y + 14; yy < y + z.h - 4; yy += 22)
          for (let xx = x + 12 + ((yy - y) % 44 ? 11 : 0); xx < x + z.w - 8; xx += 22) g.fillTriangle(xx - 6, yy + 6, xx + 6, yy + 6, xx, yy - 7);
      } else {
        g.fillStyle(COLOR.emptyLine, 0.9).fillRoundedRect(x, y, z.w, z.h, 8);
        g.lineStyle(3, COLOR.inkSoft, 1);
        for (let xx = x + 10; xx < x + z.w - 4; xx += 12) g.lineBetween(xx, y + 6, xx, y + z.h - 6);
        g.lineStyle(4, COLOR.outline, 0.9).strokeRoundedRect(x, y, z.w, z.h, 8);
      }
    }
    for (const [px, py, pr] of cfg.pillars ?? []) {
      g.fillStyle(COLOR.outline, 0.35).fillEllipse(RX + px + 4, RY + py + 8, pr * 2, pr * 1.6);
      g.fillStyle(COLOR.inkSoft, 1).fillCircle(RX + px, RY + py, pr);
      g.fillStyle(COLOR.emptyLine, 1).fillCircle(RX + px - pr * 0.25, RY + py - pr * 0.25, pr * 0.55);
      g.lineStyle(5, COLOR.outline, 1).strokeCircle(RX + px, RY + py, pr);
    }
    (cfg.portals ?? []).forEach((p, k) => {
      const color = k % 2 ? COLOR.pink : COLOR.teamA;
      for (const [x, y] of [
        [p[0], p[1]],
        [p[2], p[3]],
      ]) {
        g.fillStyle(COLOR.outline, 0.85).fillCircle(RX + x, RY + y, PORTAL_R);
        g.lineStyle(6, color, 1).strokeCircle(RX + x, RY + y, PORTAL_R);
      }
    });
  }

  /** 필살기 켜기/끄기 (버튼 · 스페이스) */
  toggleSpecial() {
    if (this.paused || this.mode !== 'aim' || DEV_AUTO) return;
    if (!canSpecial(this.run)) {
      this.armed = false;
      return;
    }
    this.armed = !this.armed;
    this.hooks.sound(this.armed ? 'cutin' : 'click');
  }

  private down(p: Phaser.Input.Pointer) {
    if (this.paused) return;
    if (p.y >= BAR_Y) {
      if (p.x >= SP_X) this.toggleSpecial();
      return;
    }
    if (this.mode === 'fly') {
      this.fastId = p.id;
      return;
    }
    if (this.mode !== 'aim' || DEV_AUTO || this.drag) return;
    this.drag = { id: p.id, x0: p.x, y0: p.y, x: p.x, y: p.y };
  }

  private up(p: Phaser.Input.Pointer) {
    if (this.fastId !== null && p.id === this.fastId) this.fastId = null;
    const d = this.drag;
    if (!d || p.id !== d.id) return;
    this.drag = null;
    if (this.paused || this.mode !== 'aim') return;
    const pull = this.pullOf(d.x0, d.y0, p.x, p.y);
    if (!pull) return; // 시작 자리 근처로 돌아와 뗐다: 취소
    this.fire({ a: pull.a, p: pull.p, s: this.armed ? 1 : 0 });
  }

  /** 당긴 벡터 → 각도(0.1° 정수) · 힘(1~100 정수). 취소 거리 안이면 null. 화면에서만 쓰는 삼각 함수 (조작을 정수로 바꾸는 데만) */
  private pullOf(x0: number, y0: number, x: number, y: number): { a: number; p: number } | null {
    const dx = x0 - x;
    const dy = y0 - y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < CANCEL_R) return null;
    let a = Math.round((Math.atan2(dy, dx) * 1800) / Math.PI);
    a = ((a % 3600) + 3600) % 3600;
    const pw = Math.max(1, Math.min(100, Math.round(((len - CANCEL_R) / (PULL_FULL - CANCEL_R)) * 100)));
    return { a, p: pw };
  }

  private fire(inp: ShotInput) {
    const ev = beginShot(this.run, inp);
    this.armed = false;
    this.handle(ev);
    this.mode = 'fly';
    this.acc = 0;
  }

  update(time: number, deltaMs: number) {
    const s = this.run;
    if (!this.paused) {
      if (this.mode === 'aim' && DEV_AUTO) this.autoStep(time);
      if (this.mode === 'fly') {
        const mul = (this.fastId !== null ? 2 : 1) * DEV_SPEED;
        this.acc = Math.min(this.acc + (deltaMs / 1000) * mul, 0.25 * mul);
        while (this.acc >= STEP && this.mode === 'fly') {
          this.acc -= STEP;
          this.handle(stepShot(s));
          if (shotDone(s)) {
            this.mode = 'wait';
            this.waitUntil = time + 220 / DEV_SPEED;
          }
        }
      } else if (this.mode === 'wait' && time >= this.waitUntil) {
        this.queue = endTurn(s);
        this.mode = 'enemy';
        this.nextEventAt = time;
      }
      if (this.mode === 'enemy' && time >= this.nextEventAt) this.playQueue(time);
      if (this.mode === 'end' && this.endAt && time >= this.endAt) {
        this.endAt = 0;
        this.hooks.onEnd(s);
      }
    }
    this.draw(time);
    this.hooks.onFrame(s);
  }

  private autoStep(time: number) {
    if (!this.autoPick) {
      if (!this.autoAt) this.autoAt = time + 450 / DEV_SPEED;
      if (time < this.autoAt) return;
      this.autoPick = { inp: choose(this.run), at: time + 450 / DEV_SPEED };
      return;
    }
    if (time < this.autoPick.at) return;
    const inp = this.autoPick.inp;
    this.autoPick = null;
    this.autoAt = 0;
    this.fire(inp);
  }

  /** 요괴 차례 이벤트를 하나씩 보여 준다 */
  private playQueue(time: number) {
    while (this.queue.length) {
      const e = this.queue.shift()!;
      this.handle([e]);
      const wait = e.t === 'wave' ? 700 : e.t === 'attack' ? 420 : e.t === 'spawn' || e.t === 'foeHeal' || e.t === 'rise' || e.t === 'tick' ? 300 : 0;
      if (wait) {
        this.nextEventAt = time + wait / DEV_SPEED;
        return;
      }
    }
    const s = this.run;
    if (s.phase === 'clear' || s.phase === 'fail') {
      this.mode = 'end';
      this.endAt = time + (s.phase === 'clear' ? 1200 : 900);
    } else this.mode = 'aim';
  }

  // ---------- 이벤트 → 소리 · 효과 ----------

  private handle(ev: SimEvent[]) {
    for (const e of ev) {
      switch (e.t) {
        case 'wall':
          this.hooks.sound('volleyWall', { rate: Math.min(2, 0.85 + e.n * 0.07), volume: 0.6 });
          this.spark(e.x, e.y);
          break;
        case 'hit':
          this.hooks.sound('survPop', { rate: e.weak ? 1.3 : 1 });
          this.pop(e.x, e.y, e.weak ? 1.1 : 0.7);
          this.floatText(e.x, e.y - 30, `${e.dmg}`, e.weak ? '#ff4d6d' : '#ffffff', e.weak ? 40 : 30);
          if (e.weak) this.floatText(e.x, e.y - 72, '약점!', '#ffd34d', 28);
          else if (e.shield) this.floatText(e.x, e.y - 72, '방패!', '#9fd6ff', 26);
          this.shake(this.foeViews.get(e.id)?.img);
          break;
        case 'down':
          this.hooks.sound('survSlash', { rate: 0.8 });
          this.pop(e.x, e.y, 1.2);
          this.floatText(e.x, e.y - 50, '다시 일어나요…', '#e2d3b5', 24);
          break;
        case 'rise':
          this.hooks.sound('survLevel', { rate: 0.8 });
          this.floatText(e.x, e.y - 50, '되살아났다!', '#e86a5a', 30);
          break;
        case 'spawn': {
          this.hooks.sound('survPop', { rate: 0.7 });
          for (const id of e.kids) {
            const f = this.run.foes.find((x) => x.id === id);
            if (f) this.pop(f.x, f.y, 0.9);
          }
          const f = this.run.foes.find((x) => x.id === e.id);
          if (f && e.why === 'summon') this.floatText(f.x, f.y - f.r - 20, '부하를 불렀다!', '#ffd34d', 26);
          break;
        }
        case 'foeHeal': {
          this.hooks.sound('tankHeal', { rate: 0.8 });
          for (const h of e.heals) {
            const f = this.run.foes.find((x) => x.id === h.id);
            if (f) this.floatText(f.x, f.y - 30, `+${h.v}`, '#4cb86a', 26);
          }
          break;
        }
        case 'hide': {
          const f = this.run.foes.find((x) => x.id === e.id);
          if (f) {
            this.ring(f.x, f.y, f.r + 16, COLOR.teamA);
            this.floatText(f.x, f.y - 40, e.hidden ? '숨었다' : '나왔다', '#9fd6ff', 24);
          }
          break;
        }
        case 'debuff': {
          const h = this.run.heroes[e.hero];
          this.floatText(h.x, h.y - 70, DEBUFF_NAMES[e.kind], '#ff4d6d', 24);
          break;
        }
        case 'tick': {
          const h = this.run.heroes[e.hero];
          this.floatText(h.x, h.y - 40, `-${e.dmg}`, e.kind === 'fire' ? '#f0a500' : '#4cb86a', 26);
          this.shake(this.heroImgs[e.hero]);
          break;
        }
        case 'skip': {
          const h = this.run.heroes[e.hero];
          this.floatText(h.x, h.y - 40, '얼어서 쉼', '#9fd6ff', 26);
          break;
        }
        case 'cleanse':
          for (const i of e.heroes) {
            const h = this.run.heroes[i];
            this.floatText(h.x, h.y - 60, '깨끗!', '#ffffff', 24);
          }
          break;
        case 'thorn':
          this.hooks.sound('survHurt', { volume: 0.4, rate: 1.4 });
          this.floatText(e.x, e.y - 40, `-${e.dmg}`, '#e86a5a', 24);
          break;
        case 'board':
          this.hooks.sound('click', { rate: 0.6 });
          this.spark(e.x, e.y);
          break;
        case 'warp':
          this.hooks.sound('boost', { rate: 1.3, volume: 0.6 });
          this.ring(e.x0, e.y0, PORTAL_R + 14, COLOR.teamA);
          this.ring(e.x1, e.y1, PORTAL_R + 14, COLOR.teamA);
          break;
        case 'kill':
          this.hooks.sound('survSlash');
          this.pop(e.x, e.y, 1.6);
          if (navigator.vibrate) navigator.vibrate(20);
          break;
        case 'drop':
          break;
        case 'combo':
          this.combo(e);
          break;
        case 'special': {
          const h = this.run.heroes[e.hero];
          this.hooks.sound('cutin');
          this.banner(`${HEROES[h.id].name} · ${HEROES[h.id].specialName}`, 40);
          if (e.kind === 'dragonfall') this.cameras.main.flash(250, 255, 211, 77);
          if (e.kind === 'roar' || e.kind === 'dragonfall') this.cameras.main.shake(250, 0.008);
          break;
        }
        case 'dash':
          this.hooks.sound('boost');
          break;
        case 'revive': {
          const h = this.run.heroes[e.hero];
          this.shownHp[e.hero] = h.hp;
          this.floatText(h.x, h.y - 40, '일어났다!', '#ffd34d', 30);
          break;
        }
        case 'heal': {
          const h = this.run.heroes[e.hero];
          this.floatText(h.x, h.y - 30, `+${e.v}`, '#4cb86a', 26);
          break;
        }
        case 'pick':
          this.hooks.sound(e.kind === 'heal' ? 'tankHeal' : 'coin');
          this.floatText(e.x, e.y - 20, e.kind === 'heal' ? `+${e.v}` : `🪙+${e.v}`, e.kind === 'heal' ? '#4cb86a' : '#f0a500', 28);
          break;
        case 'attack': {
          this.hooks.sound('survHurt');
          if (e.kind === 'area') {
            this.ring(e.x, e.y, e.area, COLOR.lose);
            if (e.x2 !== undefined && e.y2 !== undefined) this.ring(e.x2, e.y2, e.area, COLOR.lose);
          }
          for (const hit of e.hits) {
            const h = this.run.heroes[hit.hero];
            this.floatText(h.x, h.y - 40, `-${hit.dmg}`, '#e86a5a', 30);
            this.shake(this.heroImgs[hit.hero]);
            const f = this.run.foes.find((x) => x.id === e.id);
            if (f && (e.kind === 'near' || e.kind === 'double')) this.zap(f.x, f.y, h.x, h.y);
          }
          if (e.hits.length && navigator.vibrate) navigator.vibrate(30);
          break;
        }
        case 'fall':
          this.hooks.sound('lose', { volume: 0.5 });
          break;
        case 'wave':
          this.hooks.sound('survLevel');
          this.banner(`웨이브 ${e.n + 1}`);
          break;
        case 'clear':
          this.hooks.sound('win');
          this.banner('클리어!');
          break;
        case 'fail':
          this.banner(e.why === 'turns' ? '턴을 다 썼어요' : '모두 쓰러졌어요');
          break;
        default:
          break;
      }
    }
  }

  /** 우정 콤보 효과: 줄(레이저·표창·날려차기) · 원(땅 울림·독·효과 지우기) · 이름 */
  private combo(e: Extract<SimEvent, { t: 'combo' }>) {
    const h = this.run.heroes[e.hero];
    const sounds: Record<string, string> = { heal: 'tankHeal', guard: 'tankHeal', coin: 'coin', quake: 'tankBoom', poison: 'tankBoom', cleanse: 'tankBoom' };
    this.hooks.sound(sounds[e.kind] ?? 'tankLaser');
    const color = e.kind === 'poison' ? COLOR.win : e.kind === 'heal' || e.kind === 'guard' ? COLOR.white : e.kind === 'laserH' || e.kind === 'laserV' ? COLOR.pink : COLOR.primary;
    const g = this.add.graphics().setDepth(780);
    for (const [x0, y0, x1, y1] of e.lines) {
      const thick = e.kind === 'laserH' || e.kind === 'laserV' ? 26 : 10;
      g.lineStyle(thick + 8, COLOR.outline, 0.6).lineBetween(RX + x0, RY + y0, RX + x1, RY + y1);
      g.lineStyle(thick, color, 1).lineBetween(RX + x0, RY + y0, RX + x1, RY + y1);
      if (e.kind === 'shuriken' || e.kind === 'balls') {
        const img = this.add.image(RX + x0, RY + y0, e.kind === 'shuriken' ? 'p-shuriken' : 'fx-pop').setDisplaySize(36, 36).setDepth(790);
        this.tweens.add({ targets: img, x: RX + x1, y: RY + y1, angle: 360, duration: 220, onComplete: () => img.destroy() });
      }
    }
    if (e.r > 0) {
      g.fillStyle(color, 0.35).fillCircle(RX + e.x, RY + e.y, e.r);
      g.lineStyle(6, color, 1).strokeCircle(RX + e.x, RY + e.y, e.r);
    }
    if (e.kind === 'heal' || e.kind === 'guard') {
      for (const o of this.run.heroes) if (!o.fallen) g.lineStyle(6, e.kind === 'heal' ? COLOR.win : COLOR.white, 1).strokeCircle(RX + o.x, RY + o.y, o.r + 10);
    }
    this.tweens.add({ targets: g, alpha: 0, delay: 120, duration: 380, onComplete: () => g.destroy() });
    this.floatText(h.x, h.y - 46, HEROES[h.id].comboName, '#ffffff', 24);
  }

  private spark(x: number, y: number) {
    const g = this.add.graphics().setDepth(700);
    g.fillStyle(COLOR.white, 0.9).fillCircle(RX + x, RY + y, 10);
    this.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
  }

  private pop(x: number, y: number, scale: number) {
    const img = this.add.image(RX + x, RY + y, 'fx-pop').setDepth(750);
    const k = (64 * scale) / (img.height || 64);
    img.setScale(k * 0.6);
    this.tweens.add({ targets: img, scale: k, alpha: 0, duration: 260, onComplete: () => img.destroy() });
  }

  private ring(x: number, y: number, r: number, color: number) {
    const g = this.add.graphics().setDepth(760);
    g.fillStyle(color, 0.45).fillCircle(RX + x, RY + y, r);
    this.tweens.add({ targets: g, alpha: 0, duration: 420, onComplete: () => g.destroy() });
  }

  private zap(x0: number, y0: number, x1: number, y1: number) {
    const g = this.add.graphics().setDepth(760);
    g.lineStyle(8, COLOR.lose, 0.9).lineBetween(RX + x0, RY + y0, RX + x1, RY + y1);
    this.tweens.add({ targets: g, alpha: 0, duration: 320, onComplete: () => g.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: string, size: number) {
    const t = this.add
      .text(RX + x, RY + y, text, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#2a1a10', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(950);
    this.tweens.add({ targets: t, y: t.y - 40, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private banner(text: string, size = 64) {
    const t = this.add
      .text(W / 2, RY + 360, text, { fontFamily: FONT, fontSize: `${size}px`, color: '#ffd34d', stroke: '#2a1a10', strokeThickness: 10 })
      .setOrigin(0.5)
      .setDepth(1100)
      .setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 700, duration: 300, onComplete: () => t.destroy() });
  }

  private shake(img: Phaser.GameObjects.Image | undefined) {
    if (!img) return;
    img.setData('shakeUntil', this.time.now + 180);
  }

  private shakeOff(img: Phaser.GameObjects.Image, time: number) {
    const until = (img.getData('shakeUntil') as number | undefined) ?? 0;
    return until > time ? ((time * 0.9) % 2 < 1 ? 4 : -4) : 0;
  }

  // ---------- 그리기 ----------

  private draw(time: number) {
    this.drawThreats(time);
    this.drawFoes(time);
    this.drawPickups();
    this.drawHeroes(time);
    this.drawClones();
    this.drawAim();
    this.drawBar(time);
  }

  private drawThreats(time: number) {
    const g = this.floor;
    g.clear();
    // 순간이동 구멍 (도는 고리)
    (this.run.cfg.portals ?? []).forEach((p, k) => {
      const color = k % 2 ? COLOR.pink : COLOR.teamA;
      const a = time / 300;
      for (const [x, y] of [
        [p[0], p[1]],
        [p[2], p[3]],
      ]) {
        g.lineStyle(4, color, 0.9);
        g.beginPath();
        g.arc(RX + x, RY + y, PORTAL_R * 0.62, a, a + Math.PI * 1.2);
        g.strokePath();
      }
    });
    // 바닥 불길 (남은 턴)
    for (const f of this.run.fires) {
      const k = 0.3 + 0.1 * Math.sin(time / 90);
      g.fillStyle(COLOR.accent, k).fillCircle(RX + f.x, RY + f.y, f.r);
      g.lineStyle(4, COLOR.pink, 0.8).strokeCircle(RX + f.x, RY + f.y, f.r);
    }
    if (this.mode === 'fly' || this.mode === 'aim' || this.mode === 'wait') {
      const blink = 0.22 + 0.12 * Math.sin(time / 120);
      for (const t of threats(this.run)) {
        if (t.kind === 'area') {
          g.fillStyle(COLOR.lose, blink).fillCircle(RX + t.x, RY + t.y, t.r);
          g.lineStyle(4, COLOR.lose, 0.9).strokeCircle(RX + t.x, RY + t.y, t.r);
        } else if ((t.kind === 'near' || t.kind === 'double') && t.hero !== null) {
          const h = this.run.heroes[t.hero];
          g.lineStyle(3, COLOR.lose, 0.55);
          dashed(g, RX + t.x, RY + t.y, RX + h.x, RY + h.y, 12, 10);
        } else if (t.kind === 'all') {
          for (const h of this.run.heroes) if (!h.fallen) g.lineStyle(4, COLOR.lose, blink * 2.5).strokeCircle(RX + h.x, RY + h.y, h.r + 14);
        }
      }
    }
  }

  private drawFoes(time: number) {
    const seen = new Set<number>();
    const next = new Map<number, string>();
    for (const t of threats(this.run)) if (t.kind === 'heal' || t.kind === 'summon' || t.kind === 'all') next.set(t.id, t.kind === 'heal' ? '회복' : t.kind === 'summon' ? '부르기' : '모두');
    for (const f of this.run.foes) {
      if (!f.alive && !f.down) continue;
      seen.add(f.id);
      let v = this.foeViews.get(f.id);
      if (!v) {
        const img = this.add.image(0, 0, f.art).setDepth(400);
        v = {
          img,
          bar: this.add.graphics().setDepth(420),
          num: this.add
            .text(0, 0, '', { fontFamily: FONT, fontSize: f.rank === 2 ? '40px' : '30px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 7 })
            .setOrigin(0.5)
            .setDepth(430),
        };
        const size = f.r * (f.rank === 2 ? 2.4 : 2.5);
        img.setDisplaySize(size, size);
        this.foeViews.set(f.id, v);
        img.setAlpha(0);
        this.tweens.add({ targets: img, alpha: 1, duration: 250 });
      }
      const x = RX + f.x + this.shakeOff(v.img, time);
      const y = RY + f.y;
      v.img.setPosition(x, y);
      // 쓰러져 되살아나기를 기다림 · 물웅덩이에 숨음 (흐리게)
      if (!this.tweens.isTweening(v.img)) v.img.setAlpha(f.down ? 0.3 : f.hidden ? 0.28 : 1);
      v.img.setTint(f.down ? 0x888888 : 0xffffff);
      v.bar.clear();
      if (f.hidden) {
        v.bar.fillStyle(COLOR.teamA, 0.35).fillEllipse(x, y + f.r * 0.5, f.r * 2.6, f.r * 1.1);
        v.bar.lineStyle(3, COLOR.white, 0.7).strokeEllipse(x, y + f.r * 0.5, f.r * 2.6, f.r * 1.1);
      }
      if (f.down) {
        v.num.setText('부활').setPosition(x, y - f.r * 0.9).setColor('#e86a5a');
        continue;
      }
      const bw = Math.max(60, f.r * 1.6);
      const by = y + f.r + 8;
      v.bar.fillStyle(COLOR.outline, 1).fillRoundedRect(x - bw / 2 - 3, by - 3, bw + 6, 14, 6);
      v.bar.fillStyle(COLOR.track, 1).fillRoundedRect(x - bw / 2, by, bw, 8, 4);
      v.bar.fillStyle(COLOR.lose, 1).fillRoundedRect(x - bw / 2, by, Math.max(0, (bw * f.hp) / f.maxHp), 8, 4);
      // 약점 표시 (보스: 등 뒤)
      if (f.weak !== null) {
        const ang = (f.weak / 10) * (Math.PI / 180);
        const wx = x + Math.cos(ang) * (f.r + 6);
        const wy = y + Math.sin(ang) * (f.r + 6);
        const k = 1 + 0.15 * Math.sin(time / 150);
        v.bar.fillStyle(COLOR.primary, 1).fillCircle(wx, wy, 13 * k);
        v.bar.lineStyle(4, COLOR.outline, 1).strokeCircle(wx, wy, 13 * k);
      }
      // 독(초록 고리) · 똬리(파란 고리)
      if (f.poisonTurns > 0) v.bar.lineStyle(5, COLOR.win, 0.9).strokeCircle(x, y, f.r + 4);
      if (f.frozen > 0) v.bar.lineStyle(6, COLOR.teamA, 0.9).strokeCircle(x, y, f.r + 10);
      // 방패 (방패 방향 반원)
      const sh = f.traits?.shield;
      if (sh) {
        const [sx, sy] = dirOf(sh.dir);
        const a0 = Math.atan2(sy, sx);
        v.bar.lineStyle(9, COLOR.outline, 1);
        v.bar.beginPath();
        v.bar.arc(x, y, f.r + 7, a0 - Math.PI / 3, a0 + Math.PI / 3);
        v.bar.strokePath();
        v.bar.lineStyle(5, COLOR.teamA, 1);
        v.bar.beginPath();
        v.bar.arc(x, y, f.r + 7, a0 - Math.PI / 3, a0 + Math.PI / 3);
        v.bar.strokePath();
      }
      // 단단해짐 (회색 고리, 두꺼울수록 단단)
      if (f.hard > 0 && f.traits?.harden) v.bar.lineStyle(Math.min(10, 2 + f.hard * 1.5), COLOR.draw, 0.9).strokeCircle(x, y, f.r + 2);
      // 머리 위 남은 턴 (다음 행동이 공격이 아니면 이름도)
      const act = f.left === 1 ? next.get(f.id) : undefined;
      v.num.setText(f.frozen > 0 ? '멈춤' : act ? `${f.left} ${act}` : String(f.left)).setPosition(x - f.r * 0.7, y - f.r * 0.8);
      v.num.setColor(f.left <= 1 ? '#ff4d6d' : '#ffffff');
    }
    for (const [id, v] of this.foeViews) {
      if (seen.has(id)) continue;
      v.img.destroy();
      v.bar.destroy();
      v.num.destroy();
      this.foeViews.delete(id);
    }
  }

  private drawPickups() {
    const seen = new Set<number>();
    for (const p of this.run.pickups) {
      seen.add(p.id);
      if (this.pickViews.has(p.id)) continue;
      if (p.kind === 'coin') this.pickViews.set(p.id, this.add.image(RX + p.x, RY + p.y, 'fx-coin').setDisplaySize(40, 40).setDepth(300));
      else {
        const g = this.add.graphics().setDepth(300);
        g.fillStyle(COLOR.win, 1).fillCircle(RX + p.x, RY + p.y, 18);
        g.lineStyle(4, COLOR.outline, 1).strokeCircle(RX + p.x, RY + p.y, 18);
        g.fillStyle(COLOR.white, 1).fillRect(RX + p.x - 9, RY + p.y - 3, 18, 6).fillRect(RX + p.x - 3, RY + p.y - 9, 6, 18);
        this.pickViews.set(p.id, g);
      }
    }
    for (const [id, v] of this.pickViews) {
      if (seen.has(id)) continue;
      v.destroy();
      this.pickViews.delete(id);
    }
  }

  private drawHeroes(time: number) {
    const s = this.run;
    const g = this.fx;
    g.clear();
    s.heroes.forEach((h, i) => {
      const img = this.heroImgs[i];
      this.shownHp[i] += (h.hp - this.shownHp[i]) * 0.15;
      if (h.fallen) {
        img.setVisible(false);
        return;
      }
      const m = s.movers.find((x) => x.hero === i);
      const x = RX + (m ? m.x : h.x) + this.shakeOff(img, time);
      const y = RY + (m ? m.y : h.y);
      const r = m ? m.r : h.r;
      img.setVisible(true).setPosition(x, y).setDisplaySize(r * 2.1, r * 2.1);
      // 이번 차례 표시
      if (i === s.cur && this.mode === 'aim') {
        const k = 1 + 0.08 * Math.sin(time / 140);
        g.lineStyle(6, this.armed ? COLOR.pink : COLOR.primary, 1).strokeCircle(x, y, (r + 9) * k);
      }
      if (h.shield || this.run.guardTurns > 0) g.lineStyle(4, COLOR.white, 0.9).strokeCircle(x, y, r + 5);
      // 나쁜 효과 (작은 점: 독 초록 · 느려짐 파랑 · 약해짐 분홍 · 얼음 흰 고리)
      if (h.frozen > 0) g.lineStyle(6, COLOR.skyMid, 0.95).strokeCircle(x, y, r + 3);
      const dots = [h.poisonTurns > 0 ? COLOR.win : -1, h.slow > 0 ? COLOR.teamA : -1, h.weak > 0 ? COLOR.pink : -1].filter((c) => c >= 0);
      dots.forEach((c, k) => {
        const dx = x - r + 6 + k * 16;
        g.fillStyle(c, 1).fillCircle(dx, y - r - 6, 7);
        g.lineStyle(3, COLOR.outline, 1).strokeCircle(dx, y - r - 6, 7);
      });
      if (!m) {
        g.fillStyle(COLOR.outline, 1).fillRoundedRect(x - 30, y + r + 4, 60, 10, 5);
        g.fillStyle(COLOR.win, 1).fillRoundedRect(x - 28, y + r + 6, Math.max(0, (56 * this.shownHp[i]) / h.maxHp), 6, 3);
      }
    });
  }

  /** 원숭이 분신 */
  private drawClones() {
    const clones = this.run.movers.filter((m) => m.clone);
    while (this.cloneImgs.length < clones.length) this.cloneImgs.push(this.add.image(0, 0, `ball-${this.run.heroes[this.run.cur].id}`).setDepth(490).setAlpha(0.8));
    this.cloneImgs.forEach((img, i) => {
      const m = clones[i];
      if (!m) return img.setVisible(false);
      img.setTexture(`ball-${this.run.heroes[m.hero].id}`).setVisible(true).setPosition(RX + m.x, RY + m.y).setDisplaySize(m.r * 2.1, m.r * 2.1);
    });
  }

  private drawAim() {
    const g = this.aimG;
    g.clear();
    if (this.mode !== 'aim') return;
    let pull: { a: number; p: number } | null = null;
    if (this.autoPick) pull = this.autoPick.inp;
    else if (this.drag) pull = this.pullOf(this.drag.x0, this.drag.y0, this.drag.x, this.drag.y);
    if (this.drag) {
      // 당기는 손가락 자리 (시작 → 지금)
      g.lineStyle(4, COLOR.white, 0.6).lineBetween(this.drag.x0, this.drag.y0, this.drag.x, this.drag.y);
      g.lineStyle(3, COLOR.white, 0.6).strokeCircle(this.drag.x0, this.drag.y0, CANCEL_R);
    }
    if (!pull) return;
    const pts = aimPreview(this.run, pull.a);
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[pts.length - 1];
    const color = pull.p >= 80 ? COLOR.pink : pull.p >= 45 ? COLOR.primary : COLOR.white;
    g.lineStyle(8, COLOR.outline, 0.5);
    dashed(g, RX + x0, RY + y0, RX + x1, RY + y1, 18, 14);
    g.lineStyle(5, color, 1);
    dashed(g, RX + x0, RY + y0, RX + x1, RY + y1, 18, 14);
    g.fillStyle(color, 1).fillCircle(RX + x1, RY + y1, 8);
    // 힘 게이지 (대원 둘레 호)
    const h = this.run.heroes[this.run.cur];
    g.lineStyle(7, color, 1);
    g.beginPath();
    g.arc(RX + h.x, RY + h.y, h.r + 18, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pull.p) / 100);
    g.strokePath();
  }

  private drawBar(time: number) {
    const s = this.run;
    const g = this.barG;
    g.clear();
    g.fillStyle(COLOR.panel, 1).fillRoundedRect(4, BAR_Y, W - 8, H - BAR_Y - 6, 18);
    g.lineStyle(4, COLOR.outline, 1).strokeRoundedRect(4, BAR_Y, W - 8, H - BAR_Y - 6, 18);
    s.heroes.forEach((h, i) => {
      const x = i * SLOT_W + 8;
      const sl = this.slots[i];
      const cur = i === s.cur && !h.fallen;
      if (cur) {
        g.fillStyle(COLOR.primary, 1).fillRoundedRect(x + 2, BAR_Y + 6, SLOT_W - 8, H - BAR_Y - 18, 14);
      }
      sl.img.setAlpha(h.fallen ? 0.35 : 1);
      if (h.fallen) sl.img.setTint(0x888888);
      else sl.img.clearTint();
      sl.name.setColor(h.fallen ? '#8a6a4a' : '#2a1a10');
      // 체력 바
      const bx = x + 74;
      const bw = SLOT_W - 86;
      g.fillStyle(COLOR.outline, 1).fillRoundedRect(bx - 2, BAR_Y + 46, bw + 4, 16, 6);
      g.fillStyle(COLOR.track, 1).fillRoundedRect(bx, BAR_Y + 48, bw, 12, 5);
      g.fillStyle(COLOR.win, 1).fillRoundedRect(bx, BAR_Y + 48, Math.max(0, (bw * this.shownHp[i]) / h.maxHp), 12, 5);
      // 필살기 게이지
      const full = h.charge >= h.chargeMax;
      g.fillStyle(COLOR.outline, 1).fillRoundedRect(bx - 2, BAR_Y + 72, bw + 4, 14, 6);
      g.fillStyle(COLOR.track, 1).fillRoundedRect(bx, BAR_Y + 74, bw, 10, 4);
      g.fillStyle(full ? COLOR.pink : COLOR.teamA, 1).fillRoundedRect(bx, BAR_Y + 74, (bw * Math.min(h.charge, h.chargeMax)) / h.chargeMax, 10, 4);
      if (full && !h.fallen) {
        const k = 0.6 + 0.4 * Math.sin(time / 160);
        g.lineStyle(3, COLOR.pink, k).strokeRoundedRect(bx - 4, BAR_Y + 70, bw + 8, 18, 7);
      }
    });
    // 필살기 버튼
    const ready = canSpecial(s) && !DEV_AUTO;
    const by = BAR_Y + 14;
    const bh = H - BAR_Y - 34;
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(SP_X, by + 4, SP_W, bh, 14);
    g.fillStyle(this.armed ? COLOR.pink : ready ? COLOR.primary : COLOR.track, 1).fillRoundedRect(SP_X, by, SP_W, bh, 14);
    g.lineStyle(4, COLOR.outline, 1).strokeRoundedRect(SP_X, by, SP_W, bh, 14);
    const h = s.heroes[s.cur];
    this.spText.setText(this.armed ? '필살기\n켜짐' : ready ? '필살기' : `필살기\n${Math.max(0, h.chargeMax - h.charge)}턴`);
    this.spText.setColor(ready || this.armed ? '#2a1a10' : '#8a6a4a');
  }
}

/** 점선 */
function dashed(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, on: number, off: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  for (let d = 0; d < len; d += on + off) {
    const e = Math.min(len, d + on);
    g.lineBetween(x0 + ux * d, y0 + uy * d, x0 + ux * e, y0 + uy * e);
  }
}

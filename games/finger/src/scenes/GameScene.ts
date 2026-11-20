import Phaser from 'phaser';
import { artUrl, zodiacFaceUrl } from '../assets';
import { choose } from '../game/autopilot';
import { DEV_AUTO, DEV_SPEED } from '../net/local';
import {
  HEROES,
  STEP,
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
      if (e.t === 'attack' || e.t === 'wave') {
        this.nextEventAt = time + (e.t === 'wave' ? 700 : 420) / DEV_SPEED;
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
          this.shake(this.foeViews.get(e.id)?.img);
          break;
        case 'kill':
          this.hooks.sound('survSlash');
          this.pop(e.x, e.y, 1.6);
          if (navigator.vibrate) navigator.vibrate(20);
          break;
        case 'drop':
          break;
        case 'pick':
          this.hooks.sound(e.kind === 'heal' ? 'tankHeal' : 'coin');
          this.floatText(e.x, e.y - 20, e.kind === 'heal' ? `+${e.v}` : `🪙+${e.v}`, e.kind === 'heal' ? '#4cb86a' : '#f0a500', 28);
          break;
        case 'attack': {
          this.hooks.sound('survHurt');
          if (e.kind === 'area') this.ring(e.x, e.y, e.area, COLOR.lose);
          for (const hit of e.hits) {
            const h = this.run.heroes[hit.hero];
            this.floatText(h.x, h.y - 40, `-${hit.dmg}`, '#e86a5a', 30);
            this.shake(this.heroImgs[hit.hero]);
            const f = this.run.foes.find((x) => x.id === e.id);
            if (f && e.kind === 'near') this.zap(f.x, f.y, h.x, h.y);
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

  private banner(text: string) {
    const t = this.add
      .text(W / 2, RY + 360, text, { fontFamily: FONT, fontSize: '64px', color: '#ffd34d', stroke: '#2a1a10', strokeThickness: 10 })
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
    this.drawAim();
    this.drawBar(time);
  }

  private drawThreats(time: number) {
    const g = this.floor;
    g.clear();
    if (this.mode === 'fly' || this.mode === 'aim' || this.mode === 'wait') {
      const blink = 0.22 + 0.12 * Math.sin(time / 120);
      for (const t of threats(this.run)) {
        if (t.kind === 'area') {
          g.fillStyle(COLOR.lose, blink).fillCircle(RX + t.x, RY + t.y, t.r);
          g.lineStyle(4, COLOR.lose, 0.9).strokeCircle(RX + t.x, RY + t.y, t.r);
        } else if (t.kind === 'near' && t.hero !== null) {
          const h = this.run.heroes[t.hero];
          g.lineStyle(3, COLOR.lose, 0.55);
          dashed(g, RX + t.x, RY + t.y, RX + h.x, RY + h.y, 12, 10);
        }
      }
    }
  }

  private drawFoes(time: number) {
    const seen = new Set<number>();
    for (const f of this.run.foes) {
      if (!f.alive) continue;
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
      const bw = Math.max(60, f.r * 1.6);
      const by = y + f.r + 8;
      v.bar.clear();
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
      // 머리 위 남은 턴
      v.num.setText(String(f.left)).setPosition(x - f.r * 0.7, y - f.r * 0.8);
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
      if (!m) {
        g.fillStyle(COLOR.outline, 1).fillRoundedRect(x - 30, y + r + 4, 60, 10, 5);
        g.fillStyle(COLOR.win, 1).fillRoundedRect(x - 28, y + r + 6, Math.max(0, (56 * this.shownHp[i]) / h.maxHp), 6, 3);
      }
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

import Phaser from 'phaser';
import { artUrl, heroFullUrl } from '../assets';
import type { Shape } from '../data/acts';
import { MAP_W, PLAYER_R, TILE } from '../data/balance';
import { itemDef } from '../data/items';
import { envOf } from '../data/maps';
import type { Drop } from '../game/drops';
import { STEP, sightOf, step, type Enemy, type Input, type RunState, type SimEvent, type Warn } from '../game/sim';
import { COLOR, css } from '../theme';
import { ENEMY_TINT, artFor, groundOf } from './art';

/** 기준 화면 크기 (세로 9:16). 더 긴 화면(아이폰 19.5:9 등)은 위아래로 더 보여 준다 — 띠를 남기지 않게 */
export const W = 720;
export const H = 1280;
export const H_MAX = 1600;
/** 화면 비율에 맞는 그림판 높이 (9:16 보다 넓은 화면은 기준 높이 그대로 두고 가운데에 맞춘다) */
export const viewHeight = (w: number, h: number) => (w > 0 && h > 0 ? Math.round(Math.min(H_MAX, Math.max(H, (W * h) / w))) : H);
const WORLD_W = MAP_W * TILE;
/** 바닥을 미리 그려 두는 조각의 높이 (칸). 화면 가까이의 조각만 만들어 두고 멀어지면 지운다 (아이폰 메모리) */
const CHUNK_ROWS = 16;
const CHUNK_H = CHUNK_ROWS * TILE;
/** 화면 밖 이만큼까지 그린다 */
const MARGIN = 120;
/** 카메라가 맵 위·아래 끝을 넘어가도 되는 만큼 (화면 높이 비율): HUD 와 아래 조작 버튼이 덮는 자리 */
const CAM_OVER_TOP = 0.1;
const CAM_OVER_BOTTOM = 0.3;
const DIGITS = '0123456789';
const DIGIT_W = 22;
const DIGIT_H = 40;
const NUM_POOL = 28;
const POP_POOL = 14;
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

export interface SceneHooks {
  /** 지금 입력 (조이스틱·버튼·키보드) */
  input(): Input;
  /** 한 간격을 돌린 뒤: 눌렀다 떼는 버튼을 내린다 */
  consume(): void;
  /** 판이 끝났다 (클리어·쓰러짐 연출 뒤) */
  onEnd(s: RunState): void;
  /** 매 화면마다 (HUD 갱신) */
  onFrame(s: RunState): void;
  sound(name: string, opts?: { volume?: number; rate?: number }): void;
  /** 화면 가운데 짧은 안내 */
  note(text: string): void;
  /** 맞았을 때 (진동) */
  hurt(): void;
  /** 피해 숫자를 그릴지 (설정) */
  numbers(): boolean;
  /** 레어·열쇠가 떨어졌다 (진동) */
  rare(): void;
}

/** 떨어진 것의 그림 글자 · 이름 */
export const dropIcon = (d: Drop) => (d.t === 'potion' ? (d.slot ? '💧' : '❤️') : d.t === 'stone' ? '💎' : d.t === 'key' ? '🗝️' : (itemDef(d.base)?.icon ?? '🎁'));
export const dropName = (d: Drop) =>
  d.t === 'potion' ? `${d.slot ? '마력' : '체력'} 물약(${'소중대'[d.size]})` : d.t === 'stone' ? `강화석 ${d.n}개` : d.t === 'key' ? '지형 열쇠' : (itemDef(d.base)?.name ?? '장비');
const isRare = (d: Drop) => d.t === 'key' || (d.t === 'item' && d.rare);

interface Num {
  o: Phaser.GameObjects.BitmapText;
  t: number;
  life: number;
}
interface Fx {
  shape: Shape;
  x: number;
  y: number;
  ang: number;
  t: number;
}

export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private hooks!: SceneHooks;
  private acc = 0;
  paused = false;
  private endT = -1;
  private ended = false;

  private under!: Phaser.GameObjects.Graphics;
  private over!: Phaser.GameObjects.Graphics;
  private hero!: Phaser.GameObjects.Image;
  private heroScale = 1;
  private faceLeft = false;
  private exitMark!: Phaser.GameObjects.Text;
  private chestMark!: Phaser.GameObjects.Text;
  private chunks = new Map<number, Phaser.GameObjects.Image>();
  private views = new Map<number, Phaser.GameObjects.Image>();
  private free: Phaser.GameObjects.Image[] = [];
  private nums: Num[] = [];
  private numNext = 0;
  private pops: { o: Phaser.GameObjects.Image; t: number; size: number }[] = [];
  private popNext = 0;
  private fx: Fx[] = [];
  private chains: { pts: number[]; t: number }[] = [];
  /** 땅에 떨어진 것 (번호 → 그림 글자). 떨어질 때 한 번 만들고 주우면 지운다 */
  private dropMarks = new Map<number, { o: Phaser.GameObjects.Text; x: number; y: number; rare: boolean; born: number }>();
  private lastSound = new Map<string, number>();
  private camX = 0;
  private camY = 0;
  private shake = 0;
  /** 이 판의 그림판 높이 (viewHeight) */
  private vh = H;

  constructor() {
    super('game');
  }

  init(data: { run: RunState; hooks: SceneHooks }) {
    this.run = data.run;
    this.hooks = data.hooks;
    this.acc = 0;
    this.paused = false;
    this.endT = -1;
    this.ended = false;
    this.chunks.clear();
    this.views.clear();
    this.free = [];
    this.nums = [];
    this.pops = [];
    this.fx = [];
    this.chains = [];
    this.lastSound.clear();
  }

  preload() {
    this.load.image('hero', heroFullUrl(this.run.hero.id));
    for (const n of artFor(this.run.map)) this.load.image(n, artUrl(n));
  }

  create() {
    const s = this.run;
    this.vh = this.scale.height;
    this.makeFallbacks();
    this.makeDigits();
    this.under = this.add.graphics().setDepth(2);
    this.over = this.add.graphics().setDepth(60);
    this.exitMark = this.add.text(s.exitX, s.exitY, '🔒', { fontFamily: FONT, fontSize: '44px' }).setOrigin(0.5).setDepth(3);
    this.chestMark = this.add.text(s.chestX, s.chestY, '🎁', { fontFamily: FONT, fontSize: '40px' }).setOrigin(0.5).setDepth(3);
    this.hero = this.add.image(s.p.x, s.p.y, this.textures.exists('hero') ? 'hero' : 'hero-fallback').setOrigin(0.5, 0.86);
    this.heroScale = 92 / this.hero.height;
    this.hero.setScale(this.heroScale);
    for (let i = 0; i < NUM_POOL; i++) {
      const o = this.add.bitmapText(0, 0, 'digits', '0', DIGIT_H).setOrigin(0.5).setDepth(70).setVisible(false);
      this.nums.push({ o, t: 0, life: 0 });
    }
    for (let i = 0; i < POP_POOL; i++) this.pops.push({ o: this.add.image(0, 0, this.textures.exists('fx-pop') ? 'fx-pop' : 'fx-pop-fallback').setDepth(55).setVisible(false), t: 0, size: 0 });
    this.camX = Phaser.Math.Clamp(s.p.x - W / 2, 0, WORLD_W - W);
    this.camY = this.camTargetY();
    this.draw(0);
  }

  /** 그림을 못 읽었을 때 쓰는 코드 그림 (대원 · 요괴 · 터짐) */
  private makeFallbacks() {
    const circle = (key: string, size: number, fill: number, text: string) => {
      if (this.textures.exists(key)) return;
      const t = this.textures.createCanvas(key, size, size)!;
      const c = t.getContext();
      c.fillStyle = css(fill);
      c.strokeStyle = css(COLOR.outline);
      c.lineWidth = 6;
      c.beginPath();
      c.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.font = `${size * 0.5}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, size / 2, size / 2 + 4);
      t.refresh();
    };
    circle('hero-fallback', 128, COLOR.panel, this.run.hero.unique.icon);
    circle('enemy-fallback', 128, COLOR.pink, '👹');
    circle('fx-pop-fallback', 96, COLOR.white, '');
  }

  /** 피해 숫자용 글자판: 숫자 10개를 한 번만 그려 두고 BitmapText 로 찍는다 (Text 는 찍을 때마다 캔버스를 새로 올린다) */
  private makeDigits() {
    const t = this.textures.createCanvas('digits', DIGIT_W * DIGITS.length, DIGIT_H)!;
    const c = t.getContext();
    c.font = `34px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 7;
    c.strokeStyle = css(COLOR.outline);
    c.fillStyle = css(COLOR.white);
    for (let i = 0; i < DIGITS.length; i++) {
      c.strokeText(DIGITS[i], i * DIGIT_W + DIGIT_W / 2, DIGIT_H / 2 + 2);
      c.fillText(DIGITS[i], i * DIGIT_W + DIGIT_W / 2, DIGIT_H / 2 + 2);
    }
    t.refresh();
    const cfg = { image: 'digits', width: DIGIT_W, height: DIGIT_H, chars: DIGITS, charsPerRow: DIGITS.length, 'offset.x': 0, 'offset.y': 0, 'spacing.x': 0, 'spacing.y': 0, lineSpacing: 0 };
    this.cache.bitmapFont.add('digits', Phaser.GameObjects.RetroFont.Parse(this, cfg));
  }

  update(_time: number, delta: number) {
    const s = this.run;
    const dt = Math.min(delta, 100) / 1000;
    if (!this.paused && !this.ended) {
      if (s.phase === 'play') {
        this.acc += dt;
        let n = 0;
        while (this.acc >= STEP && n++ < 6) {
          this.acc -= STEP;
          step(s, this.hooks.input());
          this.hooks.consume();
          if (s.events.length) this.takeEvents(s.events);
        }
        if (this.acc > STEP * 6) this.acc = 0;
      } else if (this.endT < 0) {
        // 끝: 잠깐 보여 주고 결과로
        this.endT = s.phase === 'clear' ? 0.7 : 1.1;
        this.hooks.sound(s.phase === 'clear' ? 'goal' : 'survHurt');
      } else {
        this.endT -= dt;
        if (this.endT <= 0) {
          this.ended = true;
          this.hooks.onEnd(s);
        }
      }
    }
    this.draw(this.paused ? 0 : dt);
    this.hooks.onFrame(s);
  }

  private sfx(name: string, gap = 70, opts?: { volume?: number; rate?: number }) {
    const now = this.time.now;
    if (now - (this.lastSound.get(name) ?? -1000) < gap) return;
    this.lastSound.set(name, now);
    this.hooks.sound(name, opts);
  }

  private takeEvents(evs: SimEvent[]) {
    const numbers = this.hooks.numbers();
    let shown = 0;
    for (const ev of evs) {
      switch (ev.e) {
        case 'dmg':
          if (numbers && shown++ < 10) this.number(ev.x, ev.y, ev.n, ev.crit ? COLOR.primary : COLOR.white, ev.crit ? 1.25 : 0.85);
          break;
        case 'hurt':
          this.number(ev.x, ev.y, ev.n, COLOR.pink, 1.1);
          this.sfx('survHurt', 150);
          this.shake = 0.18;
          this.hooks.hurt();
          break;
        case 'kill':
          this.pop(ev.x, ev.y, ev.size * (ev.boss ? 5 : 3.4));
          this.sfx(ev.boss ? 'survBossDown' : 'survPop', 60, { volume: ev.boss ? 1 : 0.7 });
          break;
        case 'fx':
          this.fx.push({ shape: ev.shape, x: ev.x, y: ev.y, ang: ev.ang, t: 0.16 });
          break;
        case 'chain':
          this.chains.push({ pts: ev.pts, t: 0.22 });
          break;
        case 'boom':
          this.shake = Math.max(this.shake, 0.12);
          this.sfx('tankBoom', 120, { volume: 0.5 });
          break;
        case 'sound':
          this.sfx(ev.name, 60);
          break;
        case 'chest':
          this.sfx('survChest', 0);
          this.hooks.note(`🎁 숨은 상자! 엽전 +${ev.coins}`);
          break;
        case 'drop': {
          const rare = isRare(ev.drop);
          if (ev.pick >= 0) {
            const o = this.add.text(ev.x, ev.y, dropIcon(ev.drop), { fontFamily: FONT, fontSize: rare ? '42px' : '32px' }).setOrigin(0.5).setDepth(3);
            this.dropMarks.set(ev.pick, { o, x: ev.x, y: ev.y, rare, born: this.time.now / 1000 });
          } else this.hooks.note(`${dropIcon(ev.drop)} ${dropName(ev.drop)}`);
          if (rare) {
            // 레어·열쇠: 빛기둥 + 특별한 소리 + 진동 (PRD '드랍 보이기')
            this.sfx('newRecord', 0, { rate: 1.5 });
            this.hooks.rare();
            this.hooks.note(`✨ ${dropName(ev.drop)}!`);
          }
          break;
        }
        case 'pick': {
          const m = this.dropMarks.get(ev.id);
          m?.o.destroy();
          this.dropMarks.delete(ev.id);
          this.sfx(isRare(ev.drop) ? 'survChest' : 'coin', 80, { volume: 0.7 });
          this.hooks.note(`${dropIcon(ev.drop)} ${dropName(ev.drop)}`);
          break;
        }
        case 'phase':
          // 최종보스가 다음 단계로: 화면이 흔들리고 알림이 뜬다
          this.cameras.main.shake(380, 0.012);
          this.sfx('survBossWarn', 0, { rate: 0.7 });
          this.hooks.note(`👹 ${ev.text}`);
          break;
        case 'env':
          if (ev.id === 'arrow') {
            // 성벽 화살 (7지형)
            this.sfx('survBossWarn', 0, { volume: 0.4, rate: 1.3 });
            this.hooks.note(this.run.env.f > 0 ? '🏹 성벽에서 화살이 쏟아져요!' : `🏹 화살! ${this.run.hero.name}가 다 잡아냈어요`);
            break;
          }
          if (ev.id === 'sleep') {
            // 졸음 꽃가루 (8지형): 졸기 시작할 때
            this.hooks.note('🌼 꾸벅… 졸려요. 움직이거나 구르면 깨요');
            break;
          }
          if (ev.id === 'glare') {
            // 새벽빛 (10지형) 예고
            this.sfx('boost', 0, { volume: 0.4, rate: 1.4 });
            this.hooks.note(this.run.env.f > 0 ? '🌅 곧 새벽빛이 비쳐요. 눈이 부셔요!' : `🌅 새벽빛! ${this.run.hero.name}는 눈이 부시지 않아요`);
            break;
          }
          // 골바람 예고
          this.sfx('boost', 0, { volume: 0.5, rate: 0.7 });
          this.hooks.note(this.run.env.f > 0 ? `🌬️ 골바람이 불어와요 ${ev.dir > 0 ? '→' : '←'}` : `🌬️ 골바람! ${this.run.hero.name}는 밀리지 않아요`);
          break;
        case 'exit':
          this.sfx('newRecord', 0);
          this.hooks.note(this.run.map.boss ? '보스를 쓰러뜨렸어요! 출구가 열렸어요' : '출구가 열렸어요!');
          break;
        case 'nope':
          this.sfx('fold', 300);
          this.hooks.note(ev.why === 'mp' ? '마력이 모자라요' : '가까이에 요괴가 없어요');
          break;
        case 'heal':
          if (ev.hp > 0 && numbers) this.number(this.run.p.x, this.run.p.y - 60, ev.hp, COLOR.win, 1.1);
          break;
      }
    }
    evs.length = 0;
  }

  private number(x: number, y: number, n: number, tint: number, scale: number) {
    const u = this.nums[this.numNext];
    this.numNext = (this.numNext + 1) % this.nums.length;
    u.t = 0;
    u.life = 0.6;
    u.o.setText(String(n)).setPosition(x + (Math.random() - 0.5) * 26, y - 6).setTint(tint).setScale(scale).setAlpha(1).setVisible(true);
  }

  private pop(x: number, y: number, size: number) {
    const u = this.pops[this.popNext];
    this.popNext = (this.popNext + 1) % this.pops.length;
    u.t = 0.26;
    u.size = size;
    u.o.setPosition(x, y).setVisible(true);
  }

  // ---------- 그리기 ----------

  /**
   * 카메라 세로 목표: 대원을 가운데보다 조금 아래에. 맵 끝에서는 맵 밖(벽 색)을 조금 보여 준다 —
   * 위는 HUD, 아래는 조이스틱·버튼이 덮어서, 맵 끝에 딱 맞추면 시작 자리의 대원이 버튼 밑에 깔린다.
   */
  private camTargetY() {
    const lo = -this.vh * CAM_OVER_TOP;
    const hi = this.run.rows * TILE - this.vh * (1 - CAM_OVER_BOTTOM);
    return hi < lo ? (lo + hi) / 2 : Phaser.Math.Clamp(this.run.p.y - this.vh * 0.56, lo, hi);
  }

  private onScreen(x: number, y: number, pad: number) {
    return x > this.camX - pad && x < this.camX + W + pad && y > this.camY - pad && y < this.camY + this.vh + pad;
  }

  private draw(dt: number) {
    const s = this.run;
    const p = s.p;
    const now = this.time.now / 1000;

    // 카메라: 대원을 화면 가운데보다 조금 아래에 둔다 (위쪽 = 가는 방향이 더 보이게)
    const tx = Phaser.Math.Clamp(p.x - W / 2, 0, WORLD_W - W);
    const ty = this.camTargetY();
    const k = dt ? Math.min(1, dt * 9) : 1;
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      this.shake -= dt;
      sx = (Math.random() - 0.5) * 10;
      sy = (Math.random() - 0.5) * 10;
    }
    this.cameras.main.setScroll(Math.round(this.camX + sx), Math.round(this.camY + sy));
    this.ensureChunks();

    const g = this.under;
    g.clear();
    // 출구 · 상자
    const open = s.exitOpen;
    g.fillStyle(open ? COLOR.primary : COLOR.track, open ? 0.75 + 0.2 * Math.sin(now * 6) : 0.8).fillCircle(s.exitX, s.exitY, 40);
    g.lineStyle(5, COLOR.outline, 1).strokeCircle(s.exitX, s.exitY, 40);
    this.exitMark.setText(open ? '🚪' : '🔒');
    this.chestMark.setVisible(!s.chest);
    // 떨어진 것: 통통 튀고, 레어·열쇠는 빛기둥이 선다
    for (const m of this.dropMarks.values()) {
      if (!this.onScreen(m.x, m.y, 320)) continue;
      const age = now - m.born;
      m.o.setY(m.y - Math.abs(Math.sin(age * 4)) * 8 - Math.max(0, 0.3 - age) * 120);
      g.fillStyle(COLOR.outline, 0.25).fillEllipse(m.x, m.y + 16, 34, 12);
      if (!m.rare) continue;
      const a = 0.55 + 0.2 * Math.sin(now * 5);
      g.fillStyle(COLOR.primary, a * 0.7).fillRect(m.x - 22, m.y - 300, 44, 310);
      g.fillStyle(COLOR.white, a).fillRect(m.x - 8, m.y - 300, 16, 310);
      g.lineStyle(4, COLOR.primary, 0.9).strokeCircle(m.x, m.y + 6, 30 + 4 * Math.sin(now * 5));
    }
    // 요괴가 남긴 독 웅덩이: 서 있으면 다친다 (사라지기 전에 옅어진다)
    for (const z of s.pools) {
      if (!this.onScreen(z.x, z.y, z.r)) continue;
      const f = Math.min(1, z.left / 0.6);
      g.fillStyle(z.fire ? COLOR.lose : COLOR.win, (z.fire ? 0.5 : 0.42) * f).fillCircle(z.x, z.y, z.r);
      g.lineStyle(4, COLOR.outline, 0.7 * f).strokeCircle(z.x, z.y, z.r);
      for (let i = 0; i < 4; i++) g.fillStyle(z.fire ? COLOR.primary : COLOR.white, (z.fire ? 0.8 : 0.5) * f).fillCircle(z.x + Math.cos(i * 1.7 + now * 1.3) * z.r * 0.55, z.y + Math.sin(i * 2.3 + now * 1.1) * z.r * 0.5, 5 + 2 * Math.sin(now * 4 + i));
    }
    // 땅에 남는 범위 (화살 비 · 회오리 · 독안개)
    for (const z of s.zones) {
      if (!this.onScreen(z.x, z.y, z.r)) continue;
      const col = z.look === 'rain' ? COLOR.teamA : z.look === 'wind' ? COLOR.white : COLOR.win;
      const a = Math.min(1, z.left / 0.3);
      g.fillStyle(col, 0.22 * a).fillCircle(z.x, z.y, z.r);
      g.lineStyle(4, col, 0.8 * a).strokeCircle(z.x, z.y, z.r);
      if (z.look === 'wind') {
        for (let i = 0; i < 3; i++) {
          const st = now * 7 + (i * Math.PI * 2) / 3;
          g.beginPath().arc(z.x, z.y, z.r * (0.35 + 0.22 * i), st, st + 1.6).strokePath();
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const a2 = i * 1.047 + Math.floor(now * 5) * 0.7;
          const rr = z.r * (0.25 + 0.6 * ((i * 37 + Math.floor(now * 5) * 13) % 10) * 0.1);
          g.fillStyle(col, 0.7 * a).fillCircle(z.x + Math.cos(a2) * rr, z.y + Math.sin(a2) * rr, 6);
        }
      }
    }
    // 공격 예고 (빨간 범위: 옅은 전체 + 차오르는 안쪽)
    for (const w of s.warns) this.drawWarn(g, w);
    // 대원 발밑: 바라보는 방향
    g.fillStyle(COLOR.outline, 0.25).fillEllipse(p.x, p.y + 4, 46, 20);
    const fa = Math.atan2(p.fy, p.fx);
    g.fillStyle(COLOR.primary, 0.95).fillTriangle(
      p.x + Math.cos(fa) * 44, p.y + Math.sin(fa) * 44,
      p.x + Math.cos(fa + 0.5) * 28, p.y + Math.sin(fa + 0.5) * 28,
      p.x + Math.cos(fa - 0.5) * 28, p.y + Math.sin(fa - 0.5) * 28,
    );

    const o = this.over;
    o.clear();
    this.drawEnemies(g, o, now);

    // 대원
    if (p.fx < -0.2) this.faceLeft = true;
    else if (p.fx > 0.2) this.faceLeft = false;
    const dead = s.phase === 'dead';
    const rolling = p.rollT > 0;
    const bob = p.moving && !rolling ? Math.abs(Math.sin(now * 12)) * 5 : 0;
    this.hero
      .setPosition(p.x, p.y + PLAYER_R - bob)
      .setFlipX(this.faceLeft)
      .setDepth(10 + p.y / 100000)
      .setRotation(dead ? Math.PI / 2 : rolling ? (1 - p.rollT / 0.28) * Math.PI * 2 * (this.faceLeft ? -1 : 1) : p.swing > 0 ? (this.faceLeft ? -0.18 : 0.18) : 0)
      .setScale(this.heroScale * (p.dashT > 0 ? 1.1 : 1))
      .setAlpha(p.invuln > 0 && !rolling && Math.floor(now * 20) % 2 ? 0.45 : 1);
    if (p.hurt > 0) this.hero.setTint(COLOR.pink);
    else if (p.buff.atkT > 0 || p.buff.speedT > 0 || p.buff.guardT > 0 || p.buff.critT > 0) this.hero.setTint(COLOR.primaryLight);
    else this.hero.clearTint();

    // 휘두른 자국
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.fx.splice(i, 1);
        continue;
      }
      this.drawShape(o, f.shape, f.x, f.y, f.ang, COLOR.white, 0.75 * (f.t / 0.16), COLOR.white, 0);
    }
    // 번개
    for (let i = this.chains.length - 1; i >= 0; i--) {
      const c = this.chains[i];
      c.t -= dt;
      if (c.t <= 0) {
        this.chains.splice(i, 1);
        continue;
      }
      for (const [w, col] of [[9, COLOR.outline], [4, COLOR.primaryLight]] as const) {
        o.lineStyle(w, col, 1).beginPath().moveTo(c.pts[0], c.pts[1] - 20);
        for (let j = 2; j < c.pts.length; j += 2) {
          const mx = (c.pts[j - 2] + c.pts[j]) / 2 + Math.sin(j * 7 + i) * 18;
          const my = (c.pts[j - 1] + c.pts[j + 1]) / 2 - 10 + Math.cos(j * 5 + i) * 18;
          o.lineTo(mx, my).lineTo(c.pts[j], c.pts[j + 1]);
        }
        o.strokePath();
      }
    }
    // 날아가는 것
    for (const sh of s.shots) {
      if (!sh.on || !this.onScreen(sh.x, sh.y, 40)) continue;
      if (sh.look === 'orb' || sh.look === 'fire') {
        const col = sh.look === 'fire' ? COLOR.pink : COLOR.primaryLight;
        o.fillStyle(COLOR.outline, 1).fillCircle(sh.x, sh.y, sh.r + 3);
        o.fillStyle(col, 1).fillCircle(sh.x, sh.y, sh.r);
        o.fillStyle(COLOR.white, 0.9).fillCircle(sh.x - sh.r * 0.3, sh.y - sh.r * 0.3, sh.r * 0.35);
      } else {
        const v = Math.hypot(sh.vx, sh.vy) || 1;
        const len = sh.look === 'spear' ? 62 : 38;
        const ux = (sh.vx / v) * len;
        const uy = (sh.vy / v) * len;
        o.lineStyle(sh.look === 'spear' ? 11 : 8, COLOR.outline, 1).lineBetween(sh.x - ux, sh.y - uy, sh.x, sh.y);
        o.lineStyle(sh.look === 'spear' ? 5 : 3, sh.look === 'spear' ? COLOR.lineSoft : COLOR.panel, 1).lineBetween(sh.x - ux, sh.y - uy, sh.x, sh.y);
        o.fillStyle(COLOR.primary, 1).fillCircle(sh.x, sh.y, sh.look === 'spear' ? 6 : 4);
      }
    }

    // 달그림자 (4지형): 보이는 거리 밖을 어둡게 덮는다
    const see = sightOf(s);
    if (see !== Infinity) {
      // 새벽빛 (10지형)은 어둠 대신 흰빛으로 덮는다
      const glare = s.env.id === 'glare';
      const thick = 1500;
      o.lineStyle(thick, glare ? COLOR.panelStrong : COLOR.outline, glare ? 0.8 : 0.42).strokeCircle(p.x, p.y, see + 50 + thick / 2);
      o.lineStyle(50, glare ? COLOR.panelStrong : COLOR.outline, glare ? 0.4 : 0.2).strokeCircle(p.x, p.y, see + 25);
    }
    // 졸음 (8지형): 졸음이 쌓이면 머리 위에 Z 가 떠오른다 · 꽃가루에 맞아 느려진 동안에는 발밑에 고리
    if (s.env.id === 'sleep' && s.env.acc > 0) {
      for (let i = 0; i < 3; i++) {
        const f = (now * 0.8 + i / 3) % 1;
        const zx = p.x + 16 + f * 22;
        const zy = p.y - 64 - f * 34;
        const k = (5 + i * 2) * (0.5 + s.env.acc * 0.5);
        o.lineStyle(4, COLOR.outline, (1 - f) * s.env.acc).beginPath().moveTo(zx - k, zy - k).lineTo(zx + k, zy - k).lineTo(zx - k, zy + k).lineTo(zx + k, zy + k).strokePath();
        o.lineStyle(2, COLOR.white, (1 - f) * s.env.acc).beginPath().moveTo(zx - k, zy - k).lineTo(zx + k, zy - k).lineTo(zx - k, zy + k).lineTo(zx + k, zy + k).strokePath();
      }
    }
    if (p.slowT > 0) o.lineStyle(4, COLOR.pink, 0.8).strokeEllipse(p.x, p.y + 14, 58 + 6 * Math.sin(now * 8), 22);
    // 새벽빛 예고: 화면 가장자리가 깜박인다
    if (s.env.id === 'glare' && s.env.warn && s.env.f > 0 && Math.floor(now * 6) % 2) o.lineStyle(26, COLOR.panelStrong, 0.7).strokeRect(this.camX, this.camY, W, this.vh);

    // 골바람 (3지형): 예고 = 대원 옆 화살표, 부는 동안 = 바람 줄기가 화면을 가로지른다
    const env = s.env;
    if (env.id === 'wind' && env.warn && Math.floor(now * 6) % 2) {
      for (let i = 0; i < 3; i++) {
        const ax = p.x + env.warn * (58 + i * 22);
        o.lineStyle(7, COLOR.outline, 1).beginPath().moveTo(ax - env.warn * 10, p.y - 34).lineTo(ax + env.warn * 4, p.y - 20).lineTo(ax - env.warn * 10, p.y - 6).strokePath();
        o.lineStyle(3, COLOR.white, 1).beginPath().moveTo(ax - env.warn * 10, p.y - 34).lineTo(ax + env.warn * 4, p.y - 20).lineTo(ax - env.warn * 10, p.y - 6).strokePath();
      }
    }
    if (env.gust) {
      o.lineStyle(4, COLOR.white, 0.6);
      for (let i = 0; i < 12; i++) {
        const span = W + 260;
        const off = (((now * 760 + i * 197) % span) + span) % span;
        const wx = this.camX + (env.gust > 0 ? off - 130 : W + 130 - off);
        const wy = this.camY + ((i * 109 + 60) % this.vh) + Math.sin(now * 3 + i) * 12;
        o.lineBetween(wx, wy, wx - env.gust * (70 + (i % 3) * 30), wy);
      }
    }

    // 피해 숫자 · 터짐
    for (const u of this.nums) {
      if (u.life <= 0) continue;
      u.t += dt;
      if (u.t >= u.life) {
        u.life = 0;
        u.o.setVisible(false);
        continue;
      }
      u.o.y -= dt * 70;
      u.o.setAlpha(u.t > u.life * 0.6 ? 1 - (u.t - u.life * 0.6) / (u.life * 0.4) : 1);
    }
    for (const u of this.pops) {
      if (u.t <= 0) continue;
      u.t -= dt;
      if (u.t <= 0) {
        u.o.setVisible(false);
        continue;
      }
      const f = 1 - u.t / 0.26;
      u.o.setDisplaySize(u.size * (0.5 + f * 0.7), u.size * (0.5 + f * 0.7)).setAlpha(1 - f * f);
    }
  }

  private drawEnemies(g: Phaser.GameObjects.Graphics, o: Phaser.GameObjects.Graphics, now: number) {
    const s = this.run;
    // 달그림자(4지형): 보이는 거리 밖의 요괴는 그리지 않는다 (가장자리에서 서서히 사라진다)
    const sight = sightOf(s);
    for (const e of s.enemies) {
      const far = sight === Infinity ? 0 : Math.hypot(e.x - s.p.x, e.y - s.p.y) - e.r - sight;
      const show = !e.dead && far < 60 && this.onScreen(e.x, e.y, MARGIN);
      let v = this.views.get(e.id);
      if (!show) {
        if (v) {
          // 화면 밖·쓰러진 요괴의 그림은 돌려 두었다가 다시 쓴다
          v.setVisible(false);
          this.free.push(v);
          this.views.delete(e.id);
        }
        continue;
      }
      const key = this.enemyKey(e);
      if (!v) {
        v = this.free.pop() ?? this.add.image(0, 0, key);
        v.setTexture(key).setOrigin(0.5, 0.82).setVisible(true);
        this.views.set(e.id, v);
      }
      // 정예는 크게, 갈라져 나온 것은 작게 (몸 반지름 비율대로)
      const size = e.bossDef ? (e.bossDef.phases?.[e.phase - 1]?.size ?? e.bossDef.size) : e.def.size * (e.r / e.def.r);
      const tint = e.bossDef ? undefined : ENEMY_TINT[e.kind];
      const wob = e.awake && e.busy <= 0 && e.stun <= 0 ? Math.sin(now * 9 + e.id) * 2.5 : 0;
      // 공격을 예고하는 동안 몸을 부풀린다
      const puff = e.busy > 0 ? 1.08 : 1;
      // 숨은 요괴(그슨대)는 아지랑이처럼 희미하게만 보인다
      const alpha = (e.hidden ? 0.16 + 0.06 * Math.sin(now * 5 + e.id) : 1) * (far > 0 ? 1 - far / 60 : 1);
      v.setPosition(e.x, e.y + e.r * 0.8 + wob).setDisplaySize(size * puff, size * puff).setFlipX(!e.left).setDepth(10 + e.y / 100000).setAlpha(alpha);
      if (e.hidden) continue;
      if (e.flash > 0) v.setTintFill(COLOR.white);
      else if (e.stun > 0) v.setTint(COLOR.primaryLight);
      else if (e.slowT > 0) v.setTint(COLOR.skyMid);
      else if (e.dotT > 0) v.setTint(COLOR.lose);
      // 날뛰는 야차 (10지형): 붉게 깜박인다
      else if (e.def.rage && !e.bossDef && e.hp <= e.maxHp * e.def.rage.at && Math.floor(now * 8) % 2) v.setTint(COLOR.primary);
      else if (tint !== undefined) v.setTint(tint);
      else v.clearTint();
      g.fillStyle(COLOR.outline, 0.22).fillEllipse(e.x, e.y + e.r * 0.7, e.r * 2.2, e.r * 0.9);
      if (e.elite) g.lineStyle(5, COLOR.primary, 0.95).strokeEllipse(e.x, e.y + e.r * 0.7, e.r * 2.8, e.r * 1.3);
      if (e.stun > 0) {
        for (let i = 0; i < 3; i++) o.fillStyle(COLOR.primary, 1).fillCircle(e.x + Math.cos(now * 6 + i * 2.09) * e.r, e.y - size * 0.7 + Math.sin(now * 6 + i * 2.09) * 6, 5);
      }
      // 체력 바: 다친 요괴만 (보스는 HUD 에 따로 있다)
      if (!e.bossDef && e.hp < e.maxHp) {
        const bw = e.elite ? 64 : 44;
        const by = e.y - size * 0.72;
        o.fillStyle(COLOR.outline, 1).fillRect(e.x - bw / 2 - 2, by - 2, bw + 4, 10);
        o.fillStyle(COLOR.track, 1).fillRect(e.x - bw / 2, by, bw, 6);
        o.fillStyle(e.elite ? COLOR.primary : COLOR.pink, 1).fillRect(e.x - bw / 2, by, bw * (e.hp / e.maxHp), 6);
      }
    }
  }

  private enemyKey(e: Enemy): string {
    const key = e.bossDef ? e.bossDef.art : e.def.art;
    return this.textures.exists(key) ? key : 'enemy-fallback';
  }

  private drawWarn(g: Phaser.GameObjects.Graphics, w: Warn) {
    if (w.delay > 0 || w.shape === 'none') return;
    const f = 1 - Math.max(0, w.t) / w.total;
    const a = w.big ? 1 : 0.6;
    const shape: Shape = w.shape === 'circle' ? { k: 'circle', r: w.r } : w.shape === 'arc' ? { k: 'arc', r: w.r, half: w.half } : { k: 'line', len: w.len, w: w.w };
    this.drawShape(g, shape, w.x, w.y, w.ang, COLOR.pink, 0.2 * a, COLOR.pink, w.big ? 4 : 2);
    // 차오르는 안쪽: 다 차면 터진다
    const inner: Shape = shape.k === 'circle' ? { k: 'circle', r: shape.r * f } : shape.k === 'arc' ? { k: 'arc', r: shape.r * f, half: shape.half } : { k: 'line', len: shape.len * f, w: shape.w };
    this.drawShape(g, inner, w.x, w.y, w.ang, COLOR.pink, 0.4 * a, COLOR.pink, 0);
  }

  private drawShape(g: Phaser.GameObjects.Graphics, shape: Shape, x: number, y: number, ang: number, fill: number, alpha: number, line: number, lineW: number) {
    g.fillStyle(fill, alpha);
    if (lineW) g.lineStyle(lineW, line, 0.9);
    if (shape.k === 'circle') {
      g.fillCircle(x, y, shape.r);
      if (lineW) g.strokeCircle(x, y, shape.r);
    } else if (shape.k === 'arc') {
      g.slice(x, y, shape.r, ang - shape.half, ang + shape.half, false).fillPath();
      if (lineW) g.strokePath();
    } else {
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const hw = shape.w / 2;
      g.beginPath()
        .moveTo(x - sn * hw, y + c * hw)
        .lineTo(x + c * shape.len - sn * hw, y + sn * shape.len + c * hw)
        .lineTo(x + c * shape.len + sn * hw, y + sn * shape.len - c * hw)
        .lineTo(x + sn * hw, y - c * hw)
        .closePath()
        .fillPath();
      if (lineW) g.strokePath();
    }
  }

  // ---------- 바닥 조각 ----------

  private ensureChunks() {
    const first = Math.max(0, Math.floor(this.camY / CHUNK_H));
    const last = Math.min(Math.ceil((this.run.rows * TILE) / CHUNK_H) - 1, Math.floor((this.camY + this.vh) / CHUNK_H));
    for (let i = first; i <= last; i++) if (!this.chunks.has(i)) this.chunks.set(i, this.makeChunk(i));
    for (const [i, img] of this.chunks) {
      if (i >= first - 1 && i <= last + 1) continue;
      img.destroy();
      this.textures.remove(`chunk${i}`);
      this.chunks.delete(i);
    }
  }

  /** 바닥 조각 하나를 캔버스에 한 번 그려 둔다: 바닥 무늬(절반 섞기) · 물 · 벽 */
  private makeChunk(idx: number): Phaser.GameObjects.Image {
    const s = this.run;
    const look = groundOf(s.map.region);
    const envId = envOf(s.map);
    const mud = envId === 'mud' || envId === 'poison';
    const y0 = idx * CHUNK_ROWS;
    const rows = Math.min(CHUNK_ROWS, s.rows - y0);
    const tex = this.textures.createCanvas(`chunk${idx}`, WORLD_W, rows * TILE)!;
    const c = tex.getContext();
    const tile = (x: number, y: number) => (x < 0 || y < 0 || x >= s.cols || y >= s.rows ? 1 : s.grid[y * s.cols + x]);
    c.fillStyle = css(look.floor);
    c.fillRect(0, 0, WORLD_W, rows * TILE);
    if (this.textures.exists(look.tile)) {
      // 받은 바닥 무늬를 바닥색과 절반쯤 섞는다 (DESIGN.md: 시아디펜스 바닥과 같은 방식). 512px 무늬를 256px 로 깐다
      const img = this.textures.get(look.tile).getSourceImage() as HTMLImageElement;
      c.globalAlpha = 0.5;
      const off = (idx * CHUNK_H) % 256;
      for (let y = -off; y < rows * TILE; y += 256) for (let x = 0; x < WORLD_W; x += 256) c.drawImage(img, x, y, 256, 256);
      c.globalAlpha = 1;
    }
    const hash = (x: number, y: number, k: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
      return n - Math.floor(n);
    };
    for (let ry = 0; ry < rows; ry++) {
      for (let x = 0; x < s.cols; x++) {
        const y = y0 + ry;
        const t = tile(x, y);
        const px = x * TILE;
        const py = ry * TILE;
        if (t === 2) {
          c.fillStyle = css(look.slow);
          c.globalAlpha = 0.85;
          c.fillRect(px, py, TILE, TILE);
          c.globalAlpha = 1;
          c.strokeStyle = css(envId === 'poison' ? COLOR.win : envId === 'fire' ? COLOR.primary : mud ? COLOR.emptyLine : COLOR.white);
          c.lineWidth = 3;
          c.beginPath();
          const wx = px + 10 + hash(x, y, 1) * 20;
          const wy = py + 16 + hash(x, y, 2) * 26;
          c.moveTo(wx, wy);
          c.quadraticCurveTo(wx + 8, wy - 7, wx + 16, wy);
          c.stroke();
        } else if (t === 1) {
          c.fillStyle = css(look.wall);
          c.fillRect(px, py, TILE, TILE);
          // 덤불 느낌의 점
          c.fillStyle = css(look.wallDark);
          c.globalAlpha = 0.22;
          for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.arc(px + 8 + hash(x, y, i) * 44, py + 8 + hash(x, y, i + 5) * 44, 5 + hash(x, y, i + 9) * 5, 0, Math.PI * 2);
            c.fill();
          }
          c.globalAlpha = 1;
        }
      }
    }
    // 테두리: 벽과 바닥이 만나는 변에 굵은 갈색 선, 물과 바닥이 만나는 변에 옅은 선
    c.lineCap = 'round';
    for (let ry = 0; ry < rows; ry++) {
      for (let x = 0; x < s.cols; x++) {
        const y = y0 + ry;
        const t = tile(x, y);
        if (t === 0) continue;
        const px = x * TILE;
        const py = ry * TILE;
        c.strokeStyle = css(t === 1 || mud ? COLOR.outline : COLOR.skyDeep);
        c.lineWidth = t === 1 ? 5 : 2;
        c.globalAlpha = t === 1 ? 1 : 0.5;
        const edge = (nx: number, ny: number, x1: number, y1: number, x2: number, y2: number) => {
          const n = tile(nx, ny);
          if (n === t || (t === 2 && n === 1)) return;
          c.beginPath();
          c.moveTo(x1, y1);
          c.lineTo(x2, y2);
          c.stroke();
        };
        edge(x, y - 1, px, py, px + TILE, py);
        edge(x, y + 1, px, py + TILE, px + TILE, py + TILE);
        edge(x - 1, y, px, py, px, py + TILE);
        edge(x + 1, y, px + TILE, py, px + TILE, py + TILE);
        c.globalAlpha = 1;
      }
    }
    tex.refresh();
    return this.add.image(0, idx * CHUNK_H, `chunk${idx}`).setOrigin(0, 0).setDepth(0);
  }
}

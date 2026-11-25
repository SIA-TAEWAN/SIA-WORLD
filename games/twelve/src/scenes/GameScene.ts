import Phaser from 'phaser';
import { artUrl, heroFullUrl } from '../assets';
import type { Shape } from '../data/acts';
import { MAP_W, PLAYER_R, TILE } from '../data/balance';
import { itemDef } from '../data/items';
import { BOSSES } from '../data/bosses';
import { bossIdOf, envOf } from '../data/maps';
import type { Drop } from '../game/drops';
import { eunNeun, iGa } from '../game/progress';
import { STEP, sightOf, step, type Enemy, type Input, type RunState, type SimEvent, type Warn } from '../game/sim';
import { COLOR, css } from '../theme';
import { BOSS_ATK_FRAME, ENEMY_TINT, EXIT_FRAME, HARD_BOSS_TINT, HERO_COLS, HERO_FRAME, HERO_FRAMES, HERO_ROLL_ORIGIN, HERO_ROWS, DECO_CELL, DECO_SKIP, DUAL_FRAME, TILESET_CELL, artFor, bossAtkArt, decoArt, eliteArt, floorOf, groundOf, hasArt, slowArt, slowTiles, wallArt, wallTiles } from './art';

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
/** 떨어진 것의 아이콘 그림 이름 (판이 받아 둔 ic-* — 없으면 글자 그림으로 그린다) */
const dropArt = (d: Drop): string => {
  if (d.t === 'potion') return d.slot ? 'ic-mp' : 'ic-hp';
  if (d.t === 'stone') return 'ic-stone';
  if (d.t === 'key') return 'ic-key';
  const def = itemDef(d.base);
  if (!def) return '';
  return def.slot === 'weapon' ? `ic-${def.kind}` : def.slot === 'armor' ? 'ic-armor' : def.id.startsWith('s-') ? 'ic-star' : `ic-acc-${def.stat}`;
};

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
  /** 대원 시트(앞 · 옆 · 뒤)를 받았는지. 못 받았으면 공용 전신 그림 한 장을 쓴다 */
  private heroSheet = false;
  private exitMark!: Phaser.GameObjects.Text;
  /** 출구 그림 (잠김 · 열림 두 칸). 없으면 동그라미 + 글자 그림 */
  private exitImg: Phaser.GameObjects.Image | null = null;
  private chestMark!: Phaser.GameObjects.Text | Phaser.GameObjects.Image;
  /** 효과 그림(날아가는 것 · 자국 · 범위 …): 프레임마다 앞에서부터 다시 나눠 쓴다 */
  private sprites: Phaser.GameObjects.Image[] = [];
  private spriteN = 0;
  /** 충격 고리 (터짐 · 고유 스킬): 잠깐 커지며 사라진다 */
  private shocks: { x: number; y: number; r: number; t: number }[] = [];
  /** 고유 스킬을 쓴 순간 머리 위에 뜨는 그림 */
  private uniquePop: Phaser.GameObjects.Image | null = null;
  private uniqueT = 0;
  private lastUniqueCd = 0;
  /** 보스 공격 동작: 예고가 끝난 뒤 내려치기 칸을 보여 줄 시각 · 지난 프레임의 예고 여부 */
  private bossStrikeUntil = 0;
  private bossWasBusy = false;
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
  private dropMarks = new Map<number, { o: Phaser.GameObjects.Text | Phaser.GameObjects.Image; x: number; y: number; rare: boolean; born: number }>();
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
    // paused 는 여기서 되돌리지 않는다: 가려진 탭에서 시작한 판은 화면(playRun)이 init 보다 먼저 멈춰 둔다 (판마다 새 장면이라 처음 값은 false)
    this.endT = -1;
    this.ended = false;
    this.chunks.clear();
    this.views.clear();
    this.free = [];
    this.nums = [];
    this.pops = [];
    this.fx = [];
    this.chains = [];
    this.sprites = [];
    this.spriteN = 0;
    this.shocks = [];
    this.uniquePop = null;
    this.uniqueT = 0;
    this.lastUniqueCd = 0;
    this.bossStrikeUntil = 0;
    this.bossWasBusy = false;
    this.exitImg = null;
    this.lastSound.clear();
  }

  preload() {
    // 대원: 전용 시트(앞 · 옆 · 뒤)가 있으면 그것, 없거나 못 읽으면 공용 전신 그림 한 장
    const id = this.run.hero.id;
    if (hasArt(`hero-${id}`)) {
      this.load.spritesheet('hero', artUrl(`hero-${id}`), { frameWidth: HERO_FRAME, frameHeight: HERO_FRAME });
      this.load.once('loaderror', (f: Phaser.Loader.File) => f.key === 'hero' && this.load.image('hero', heroFullUrl(id)));
    } else this.load.image('hero', heroFullUrl(id));
    if (hasArt('exit')) this.load.spritesheet('exit', artUrl('exit'), { frameWidth: EXIT_FRAME, frameHeight: EXIT_FRAME });
    if (hasArt(`ic-u-${id}`)) this.load.image(`ic-u-${id}`, artUrl(`ic-u-${id}`));
    // 보스 공격 동작 (예고 · 내려치기 두 칸)
    const atk = this.run.map.boss ? bossAtkArt(BOSSES[bossIdOf(this.run.map)].art) : null;
    if (atk) this.load.spritesheet(atk, artUrl(atk), { frameWidth: BOSS_ATK_FRAME, frameHeight: BOSS_ATK_FRAME });
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
    if (this.textures.exists('exit')) {
      this.exitImg = this.add.image(s.exitX, s.exitY, 'exit', 0).setDepth(3);
      this.exitMark.setVisible(false);
    }
    this.chestMark = this.textures.exists('chest')
      ? this.add.image(s.chestX, s.chestY, 'chest').setDisplaySize(64, 64).setDepth(3)
      : this.add.text(s.chestX, s.chestY, '🎁', { fontFamily: FONT, fontSize: '40px' }).setOrigin(0.5).setDepth(3);
    this.heroSheet = this.textures.exists('hero') && this.textures.get('hero').has(String(HERO_COLS * 3 - 1));
    this.hero = this.add.image(s.p.x, s.p.y, this.textures.exists('hero') ? 'hero' : 'hero-fallback', this.heroSheet ? 0 : undefined).setOrigin(0.5, 0.86);
    if (this.textures.exists(`ic-u-${s.hero.id}`)) this.uniquePop = this.add.image(0, 0, `ic-u-${s.hero.id}`).setDepth(64).setVisible(false);
    this.heroScale = (this.heroSheet ? 98 : 92) / this.hero.height;
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
          this.sfx('twelveHurt', 150);
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
          this.shocks.push({ x: ev.x, y: ev.y, r: ev.r, t: 0.3 });
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
            const art = dropArt(ev.drop);
            const o = this.textures.exists(art)
              ? this.add.image(ev.x, ev.y, art).setDisplaySize(rare ? 56 : 44, rare ? 56 : 44).setDepth(3)
              : this.add.text(ev.x, ev.y, dropIcon(ev.drop), { fontFamily: FONT, fontSize: rare ? '42px' : '32px' }).setOrigin(0.5).setDepth(3);
            this.dropMarks.set(ev.pick, { o, x: ev.x, y: ev.y, rare, born: this.time.now / 1000 });
          } else this.hooks.note(`${dropIcon(ev.drop)} ${dropName(ev.drop)}`);
          if (rare) {
            // 레어·열쇠: 빛기둥 + 특별한 소리 + 진동 (PRD '드랍 보이기')
            this.sfx('twelveRare', 0);
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
            this.hooks.note(this.run.env.f > 0 ? '🏹 성벽에서 화살이 쏟아져요!' : `🏹 화살! ${this.run.hero.name}${iGa(this.run.hero.name)} 다 잡아냈어요`);
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
            this.hooks.note(this.run.env.f > 0 ? '🌅 곧 새벽빛이 비쳐요. 눈이 부셔요!' : `🌅 새벽빛! ${this.run.hero.name}${eunNeun(this.run.hero.name)} 눈이 부시지 않아요`);
            break;
          }
          // 골바람 예고
          this.sfx('boost', 0, { volume: 0.5, rate: 0.7 });
          this.hooks.note(this.run.env.f > 0 ? `🌬️ 골바람이 불어와요 ${ev.dir > 0 ? '→' : '←'}` : `🌬️ 골바람! ${this.run.hero.name}${eunNeun(this.run.hero.name)} 밀리지 않아요`);
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

  /** 효과 그림 하나를 꺼낸다 (이번 프레임에 쓰는 만큼만 보인다). 꺼낼 때마다 기본 모습으로 되돌린다 */
  private sprite(key: string, depth: number): Phaser.GameObjects.Image {
    const v = this.sprites[this.spriteN] ?? (this.sprites[this.spriteN] = this.add.image(0, 0, key));
    this.spriteN++;
    return v.setTexture(key).setDepth(depth).setVisible(true).setAlpha(1).setRotation(0).setOrigin(0.5).setFlip(false, false).setScale(1);
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
    this.spriteN = 0;
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
    if (this.exitImg) {
      // 열리면 빛이 숨 쉬듯 커졌다 작아진다
      const size = open ? 104 + 6 * Math.sin(now * 6) : 100;
      if (open) g.fillStyle(COLOR.primary, 0.3 + 0.15 * Math.sin(now * 6)).fillCircle(s.exitX, s.exitY, 62);
      this.exitImg.setFrame(open ? 1 : 0).setDisplaySize(size, size);
    } else {
      g.fillStyle(open ? COLOR.primary : COLOR.track, open ? 0.75 + 0.2 * Math.sin(now * 6) : 0.8).fillCircle(s.exitX, s.exitY, 40);
      g.lineStyle(5, COLOR.outline, 1).strokeCircle(s.exitX, s.exitY, 40);
      this.exitMark.setText(open ? '🚪' : '🔒');
    }
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
      const poolKey = z.fire ? 'fx-flame' : 'fx-pool';
      if (this.textures.exists(poolKey)) {
        // 그림: 불길은 일렁이고, 독 웅덩이는 천천히 숨 쉰다 (범위는 옅은 테로 남긴다)
        g.lineStyle(3, z.fire ? COLOR.lose : COLOR.win, 0.45 * f).strokeCircle(z.x, z.y, z.r);
        const k = z.fire ? 1 + 0.08 * Math.sin(now * 14 + z.x) : 1 + 0.04 * Math.sin(now * 3 + z.x);
        this.sprite(poolKey, 3)
          .setPosition(z.x, z.y)
          .setDisplaySize(z.r * (z.fire ? 2 : 2.3), z.r * (z.fire ? 2 * k : 1.8 * k))
          .setAlpha((z.fire ? 0.92 : 0.85) * f);
        continue;
      }
      g.fillStyle(z.fire ? COLOR.lose : COLOR.win, (z.fire ? 0.5 : 0.42) * f).fillCircle(z.x, z.y, z.r);
      g.lineStyle(4, COLOR.outline, 0.7 * f).strokeCircle(z.x, z.y, z.r);
      for (let i = 0; i < 4; i++) g.fillStyle(z.fire ? COLOR.primary : COLOR.white, (z.fire ? 0.8 : 0.5) * f).fillCircle(z.x + Math.cos(i * 1.7 + now * 1.3) * z.r * 0.55, z.y + Math.sin(i * 2.3 + now * 1.1) * z.r * 0.5, 5 + 2 * Math.sin(now * 4 + i));
    }
    // 땅에 남는 범위 (화살 비 · 회오리 · 독안개)
    for (const z of s.zones) {
      if (!this.onScreen(z.x, z.y, z.r)) continue;
      const col = z.look === 'rain' ? COLOR.teamA : z.look === 'wind' ? COLOR.white : COLOR.win;
      const a = Math.min(1, z.left / 0.3);
      if (this.textures.exists(`fx-${z.look}`)) {
        // 그림: 화살 비는 위에서 거듭 떨어지고, 회오리는 돌고, 독안개는 숨 쉰다 (범위는 옅은 테로 남긴다)
        g.fillStyle(col, 0.12 * a).fillCircle(z.x, z.y, z.r);
        g.lineStyle(3, col, 0.6 * a).strokeCircle(z.x, z.y, z.r);
        const v = this.sprite(`fx-${z.look}`, 57).setPosition(z.x, z.y);
        if (z.look === 'rain') {
          const fall = (now * 3.2 + z.x * 0.01) % 1;
          v.setPosition(z.x, z.y - (1 - fall) * z.r * 0.9).setDisplaySize(z.r * 1.5, z.r * 1.5).setAlpha(a * Math.min(1, fall * 4) * (fall > 0.85 ? (1 - fall) / 0.15 : 1));
        } else if (z.look === 'wind') v.setDisplaySize(z.r * 1.7, z.r * 1.7).setRotation(Math.sin(now * 9) * 0.2).setFlipX(Math.floor(now * 8) % 2 === 0).setAlpha(0.9 * a);
        else v.setDisplaySize(z.r * 2.1 * (1 + 0.04 * Math.sin(now * 4)), z.r * 2.1).setAlpha(0.62 * a);
        continue;
      }
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
    for (const w of s.warns) {
      this.drawWarn(g, w);
      // 성벽 화살 (7지형): 예고 자리로 화살이 떨어진다
      if (s.env.id === 'arrow' && w.src < 0 && w.shape === 'circle' && w.delay <= 0 && this.textures.exists('fx-arrowfall')) {
        const left = Math.max(0, w.t) / w.total;
        this.sprite('fx-arrowfall', 57).setOrigin(0.5, 1).setPosition(w.x, w.y - left * 420).setScale(0.8).setAlpha(Math.min(1, (1 - left) * 3));
      }
    }
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
    const bob = p.moving && !rolling ? Math.abs(Math.sin(now * 12)) * (this.heroSheet ? 3 : 5) : 0;
    // 시트가 있으면 바라보는 쪽의 줄(위아래가 뚜렷하면 뒤 · 앞, 아니면 옆 — 왼쪽은 뒤집는다)에서 동작에 맞는 칸을 쓴다
    let rollLift = 0;
    if (this.heroSheet) {
      const row = Math.abs(p.fy) > Math.abs(p.fx) * 1.3 ? (p.fy > 0 ? HERO_ROWS.front : HERO_ROWS.back) : HERO_ROWS.side;
      const walk = [HERO_FRAMES.walkA, HERO_FRAMES.stand, HERO_FRAMES.walkB, HERO_FRAMES.stand][Math.floor(now * 9) % 4];
      const col = dead ? HERO_FRAMES.stand : rolling ? HERO_FRAMES.roll : p.swing > 0 ? HERO_FRAMES.attack : p.moving ? walk : HERO_FRAMES.stand;
      // 구르기 칸은 공의 가운데를 축으로 돌린다
      this.hero.setFrame(row * HERO_COLS + col).setOrigin(0.5, rolling ? HERO_ROLL_ORIGIN : 0.86);
      if (rolling) rollLift = (0.86 - HERO_ROLL_ORIGIN) * HERO_FRAME * this.heroScale;
    }
    this.hero
      .setPosition(p.x, p.y + PLAYER_R - bob - rollLift)
      .setFlipX(this.faceLeft)
      .setDepth(10 + p.y / 100000)
      .setRotation(dead ? Math.PI / 2 : rolling ? (1 - p.rollT / 0.28) * Math.PI * 2 * (this.faceLeft ? -1 : 1) : p.swing > 0 && !this.heroSheet ? (this.faceLeft ? -0.18 : 0.18) : 0)
      .setScale(this.heroScale * (p.dashT > 0 ? 1.1 : 1))
      .setAlpha(p.invuln > 0 && !rolling && Math.floor(now * 20) % 2 ? 0.45 : 1);
    if (p.hurt > 0) this.hero.setTint(COLOR.pink);
    else if (p.buff.atkT > 0 || p.buff.speedT > 0 || p.buff.guardT > 0 || p.buff.critT > 0) this.hero.setTint(COLOR.primaryLight);
    else this.hero.clearTint();

    // 고유 스킬을 쓴 순간: 머리 위에 스킬 그림이 떠오르고, 발밑에 충격 고리
    if (p.uniqueCd > this.lastUniqueCd + 0.5) {
      this.uniqueT = 0.8;
      this.shocks.push({ x: p.x, y: p.y, r: 110, t: 0.3 });
    }
    this.lastUniqueCd = p.uniqueCd;
    if (this.uniquePop) {
      this.uniqueT -= dt;
      const f = Math.max(0, this.uniqueT) / 0.8;
      this.uniquePop
        .setVisible(this.uniqueT > 0)
        .setPosition(p.x, p.y - 96 - (1 - f) * 36)
        .setDisplaySize(64 * (1 + 0.25 * Math.sin(Math.min(1, (1 - f) * 4) * Math.PI)), 64 * (1 + 0.25 * Math.sin(Math.min(1, (1 - f) * 4) * Math.PI)))
        .setAlpha(Math.min(1, f * 3));
    }
    // 충격 고리 (터짐 · 고유 스킬)
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const k = this.shocks[i];
      k.t -= dt;
      if (k.t <= 0) {
        this.shocks.splice(i, 1);
        continue;
      }
      if (!this.textures.exists('fx-shock')) continue;
      const f = 1 - k.t / 0.3;
      this.sprite('fx-shock', 9).setPosition(k.x, k.y).setDisplaySize(k.r * 2.3 * (0.4 + 0.6 * f), k.r * 2.3 * (0.4 + 0.6 * f)).setAlpha(1 - f * f);
    }
    // 휘두른 자국
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.fx.splice(i, 1);
        continue;
      }
      if (f.shape.k === 'line' && this.textures.exists('fx-thrust')) {
        // 찌르기 자국: 오른쪽이 뾰족한 줄기를 찌른 쪽으로 뻗는다
        const k = 1 - f.t / 0.16;
        this.sprite('fx-thrust', 59)
          .setOrigin(0, 0.5)
          .setPosition(f.x + Math.cos(f.ang) * f.shape.len * 0.15, f.y + Math.sin(f.ang) * f.shape.len * 0.15)
          .setRotation(f.ang)
          .setDisplaySize(f.shape.len * (0.6 + 0.35 * k), Math.max(34, f.shape.w * 0.9))
          .setAlpha(Math.min(1, (f.t / 0.16) * 1.6));
        continue;
      }
      if (f.shape.k === 'circle' && this.textures.exists('fx-spin')) {
        // 회전 자국: 고리가 돌면서 퍼진다
        const k = 1 - f.t / 0.16;
        this.sprite('fx-spin', 59)
          .setPosition(f.x, f.y)
          .setRotation(k * 2.4)
          .setDisplaySize(f.shape.r * 2 * (0.7 + 0.3 * k), f.shape.r * 2 * (0.7 + 0.3 * k))
          .setAlpha(Math.min(1, (f.t / 0.16) * 1.4));
        continue;
      }
      if (f.shape.k === 'arc' && this.textures.exists('fx-slash')) {
        // 베기 자국 그림: 오른쪽으로 볼록한 초승달을 휘두른 쪽으로 돌려 놓는다
        const v = this.sprite('fx-slash', 59);
        const size = f.shape.r * 1.3 * Math.min(1, f.shape.half / 1.2);
        v.setPosition(f.x + Math.cos(f.ang) * f.shape.r * 0.78, f.y + Math.sin(f.ang) * f.shape.r * 0.78)
          .setRotation(f.ang)
          .setDisplaySize(size * (1.05 - 0.3 * (f.t / 0.16)), size * 1.3)
          .setAlpha(Math.min(1, (f.t / 0.16) * 1.6));
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
      // 그림: 부채의 번개는 마디마다 번개 그림, 그 밖(물어뜯기 · 발톱 춤)은 맞은 자리마다 할퀸 자국
      const claw = s.weapon.kind !== 'fan' && this.textures.exists('fx-claw');
      if (claw || this.textures.exists('fx-bolt')) {
        for (let j = 2; j < c.pts.length; j += 2) {
          if (claw) {
            this.sprite('fx-claw', 59).setPosition(c.pts[j], c.pts[j + 1] - 14).setDisplaySize(84, 84).setFlipX(j % 4 === 0).setAlpha(Math.min(1, (c.t / 0.22) * 1.5));
            continue;
          }
          const dx = c.pts[j] - c.pts[j - 2];
          const dy = c.pts[j + 1] - c.pts[j - 1];
          this.sprite('fx-bolt', 59)
            .setPosition((c.pts[j] + c.pts[j - 2]) / 2, (c.pts[j + 1] + c.pts[j - 1]) / 2 - 16)
            .setRotation(Math.atan2(dy, dx))
            .setDisplaySize(Math.hypot(dx, dy) * 1.08, 46)
            .setFlipY(Math.floor(now * 30 + j) % 2 === 0)
            .setAlpha(Math.min(1, (c.t / 0.22) * 1.5));
        }
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
    const foxBoss = s.map.boss && bossIdOf(s.map) === 'gumiho';
    for (const sh of s.shots) {
      if (!sh.on || !this.onScreen(sh.x, sh.y, 40)) continue;
      // 요괴가 쏜 것: 졸음 꽃가루(느려진다) · 밤송이(튕긴다) · 구미호의 여우구슬은 저마다의 그림
      const special = !sh.foe ? '' : sh.slowDur > 0 ? 'p-pollen' : sh.bounce > 0 ? 'p-burr' : foxBoss ? 'p-foxorb' : '';
      if (special && this.textures.exists(special)) {
        const v = this.sprite(special, 58).setPosition(sh.x, sh.y);
        if (special === 'p-foxorb') v.setOrigin(0.3, 0.6).setRotation(Math.atan2(sh.vy, sh.vx)).setScale((sh.r * 2 + 12) / 60);
        else v.setRotation(special === 'p-burr' ? now * 9 : Math.sin(now * 6) * 0.3).setScale((sh.r * 2 + 16) / 72);
        continue;
      }
      const key = `p-${sh.look}`;
      if (this.textures.exists(key)) {
        // 그림이 있으면 그림으로: 오른쪽을 보는 그림을 날아가는 쪽으로 돌린다 (화살 · 창은 촉이 맞는 자리)
        const scale = sh.look === 'orb' ? (sh.r * 2 + 14) / 72 : sh.look === 'fire' ? (sh.r * 2 + 12) / 72 : sh.look === 'spear' ? 0.78 : 0.56;
        this.sprite(key, 58)
          .setOrigin(sh.look === 'orb' ? 0.5 : sh.look === 'fire' ? 0.68 : 0.94, 0.5)
          .setPosition(sh.x, sh.y)
          .setRotation(sh.look === 'orb' ? 0 : Math.atan2(sh.vy, sh.vx))
          .setScale(scale);
        continue;
      }
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
        if (this.textures.exists('fx-gust')) this.sprite('fx-gust', 61).setPosition(wx, wy).setFlipX(env.gust < 0).setScale(0.55 + (i % 3) * 0.15).setAlpha(0.75);
        else o.lineBetween(wx, wy, wx - env.gust * (70 + (i % 3) * 30), wy);
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
    // 이번 프레임에 쓰지 않은 효과 그림은 숨긴다
    for (let i = this.spriteN; i < this.sprites.length; i++) this.sprites[i].setVisible(false);
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
      const tint = e.bossDef ? (this.run.mode === 'hard' ? HARD_BOSS_TINT : undefined) : ENEMY_TINT[e.kind];
      const wob = e.awake && e.busy <= 0 && e.stun <= 0 ? Math.sin(now * 9 + e.id) * 2.5 : 0;
      // 공격을 예고하는 동안 몸을 부풀린다
      const puff = e.busy > 0 ? 1.08 : 1;
      // 숨은 요괴(그슨대)는 아지랑이처럼 희미하게만 보인다
      const alpha = (e.hidden ? 0.16 + 0.06 * Math.sin(now * 5 + e.id) : 1) * (far > 0 ? 1 - far / 60 : 1);
      if (e.bossDef) {
        // 보스 공격 동작: 예고하는 동안은 치켜든 모습, 예고가 끝난 바로 뒤에는 내려친 모습 (그림이 없으면 한 장 그대로)
        const atk = `${e.bossDef.art}-atk`;
        if (this.textures.exists(atk)) {
          if (this.bossWasBusy && e.busy <= 0) this.bossStrikeUntil = now + 0.32;
          this.bossWasBusy = e.busy > 0;
          if (e.busy > 0) v.setTexture(atk, 0);
          else if (now < this.bossStrikeUntil) v.setTexture(atk, 1);
          else v.setTexture(key);
        }
      }
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
    // 정예는 전용 모습이 있으면 그것 (없으면 같은 그림을 크게)
    const elite = !e.bossDef && e.elite ? eliteArt(e.kind) : null;
    const key = e.bossDef ? e.bossDef.art : elite && this.textures.exists(elite) ? elite : e.def.art;
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
    const floor = floorOf(s.map.region);
    if (this.textures.exists(floor.key)) {
      // 받은 바닥 무늬를 이어 깐다 (지형 전용 무늬는 그대로, 시아디펜스 바닥은 바닥색과 절반쯤 섞는다 — DESIGN.md)
      const img = this.textures.get(floor.key).getSourceImage() as HTMLImageElement;
      c.globalAlpha = floor.alpha;
      const off = (idx * CHUNK_H) % floor.size;
      for (let y = -off; y < rows * TILE; y += floor.size) for (let x = 0; x < WORLD_W; x += floor.size) c.drawImage(img, x, y, floor.size, floor.size);
      c.globalAlpha = 1;
    }
    // 벽 · 느린 바닥 무늬 (이어 붙는 그림을 칸 자리에 맞춰 잘라 깐다 — 없으면 바닥색과 코드 그림)
    const patternOf = (name: string | null) => (name && this.textures.exists(name) ? (this.textures.get(name).getSourceImage() as HTMLImageElement) : null);
    const wallImg = patternOf(wallArt(s.map.region));
    const slowImg = patternOf(slowArt(s.map.region));
    const stamp = (img: HTMLImageElement, x: number, y: number, px: number, py: number) => {
      const n = Math.max(1, Math.round(img.width / TILE));
      const cell = img.width / n;
      c.drawImage(img, (x % n) * cell, (y % n) * cell, cell, cell, px, py, TILE, TILE);
    };
    const hash = (x: number, y: number, k: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
      return n - Math.floor(n);
    };
    // 오토타일셋 (dual-grid): 칸 네 개가 만나는 꼭짓점마다 둘레 네 칸을 보고 한 조각을 놓는다 → 가장자리가 모서리 · 곡선으로 이어진다
    const wallSet = patternOf(wallTiles(s.map.region));
    const slowSet = patternOf(slowTiles(s.map.region));
    const dual = (img: HTMLImageElement, filled: (x: number, y: number) => boolean) => {
      for (let vy = y0; vy <= y0 + rows; vy++) {
        for (let vx = 0; vx <= s.cols; vx++) {
          const mask = (filled(vx - 1, vy - 1) ? 1 : 0) | (filled(vx, vy - 1) ? 2 : 0) | (filled(vx - 1, vy) ? 4 : 0) | (filled(vx, vy) ? 8 : 0);
          const f = DUAL_FRAME[mask];
          if (f < 0) continue;
          c.drawImage(img, (f % 4) * TILESET_CELL, Math.floor(f / 4) * TILESET_CELL, TILESET_CELL, TILESET_CELL, (vx - 0.5) * TILE, (vy - y0 - 0.5) * TILE, TILE, TILE);
        }
      }
    };
    // 장식 (그림일 뿐 — 충돌 없음): 자리와 종류는 맵과 칸 번호로 정해져 언제나 같다
    const decoImg = patternOf(decoArt(s.map.region));
    const salt = s.map.region * 31 + s.map.no * 7;
    const near = (x: number, y: number, wx: number, wy: number, d: number) => Math.hypot((x + 0.5) * TILE - wx, (y + 0.5) * TILE - wy) < d;
    const all8 = (x: number, y: number, t: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tile(x + dx, y + dy) !== t) return false;
      return true;
    };
    const decoAt = (x: number, y: number, frame: number, h: number, alpha: number) => {
      if (!decoImg) return;
      const w = h;
      c.globalAlpha = alpha;
      c.drawImage(decoImg, (frame % 4) * DECO_CELL, Math.floor(frame / 4) * DECO_CELL, DECO_CELL, DECO_CELL, (x + 0.5) * TILE - w / 2 + (hash(x, y, salt + 3) - 0.5) * 18, (y - y0 + 0.5) * TILE + 18 - h, w, h);
      c.globalAlpha = 1;
    };
    const groundFrames = [0, 1, 2, 3, 4, 5, 6, 7].filter((f) => !(DECO_SKIP[s.map.region] ?? []).includes(f));
    for (let ry = 0; ry < rows; ry++) {
      for (let x = 0; x < s.cols; x++) {
        const y = y0 + ry;
        const t = tile(x, y);
        const px = x * TILE;
        const py = ry * TILE;
        if (t === 2 && slowSet) continue;
        if (t === 1 && wallSet) continue;
        if (t === 2 && slowImg) stamp(slowImg, x, y, px, py);
        else if (t === 1 && wallImg) stamp(wallImg, x, y, px, py);
        else if (t === 2) {
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
    // 바닥 장식: 둘레가 모두 바닥인 칸에 드문드문 (좁은 통로 · 출발 자리 · 출구 · 상자 둘레는 비운다)
    if (decoImg) {
      for (let y = y0 - 1; y <= y0 + rows; y++) {
        for (let x = 0; x < s.cols; x++) {
          if (tile(x, y) !== 0 || hash(x, y, salt) > 0.2 || !all8(x, y, 0)) continue;
          if (near(x, y, s.exitX, s.exitY, 150) || near(x, y, s.chestX, s.chestY, 100) || near(x, y, (s.map.start[0] + 0.5) * TILE, (s.map.start[1] + 0.5) * TILE, 130)) continue;
          decoAt(x, y, groundFrames[Math.floor(hash(x, y, salt + 1) * groundFrames.length)], 40 + hash(x, y, salt + 2) * 14, 0.92);
        }
      }
    }
    // 느린 바닥 → 벽 차례로 오토타일을 놓는다 (느린 바닥은 벽 밑까지 이어진 것으로 본다 — 벽 옆에 틈이 생기지 않게)
    if (slowSet) dual(slowSet, (x, y) => tile(x, y) !== 0 && (tile(x, y) === 2 || [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => tile(x + dx, y + dy) === 2)));
    if (wallSet) dual(wallSet, (x, y) => tile(x, y) === 1);
    // 큰 장식: 벽 안쪽(둘레와 위 두 칸이 모두 벽)에만 얹는다 — 길을 가리지 않는다
    if (decoImg) {
      for (let y = y0 - 1; y <= y0 + rows + 2; y++) {
        for (let x = 0; x < s.cols; x++) {
          if (tile(x, y) !== 1 || hash(x, y, salt + 5) > 0.3 || !all8(x, y, 1) || !all8(x, y - 1, 1)) continue;
          decoAt(x, y, 8 + Math.floor(hash(x, y, salt + 6) * 8), 88 + hash(x, y, salt + 7) * 26, 1);
        }
      }
    }
    // 테두리: 벽과 바닥이 만나는 변에 굵은 갈색 선, 물과 바닥이 만나는 변에 옅은 선 (오토타일셋이 있으면 그 그림의 테두리를 쓴다)
    c.lineCap = 'round';
    for (let ry = 0; ry < rows; ry++) {
      for (let x = 0; x < s.cols; x++) {
        const y = y0 + ry;
        const t = tile(x, y);
        if (t === 0 || (t === 1 && wallSet) || (t === 2 && slowSet)) continue;
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

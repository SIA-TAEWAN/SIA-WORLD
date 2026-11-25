import Phaser from 'phaser';
import { FRAME, TS, attackCol, enemySize, frameIndex, tileArtIndex, walkCol, type TileArt } from '../art/sheets';
import { T, TILE } from '../game/floorgen';
import { BODY_UP, STEP, prm, step, tileOf, type Enemy, type Fx, type Input, type RunState, type SimEvent } from '../game/sim';
import { COLOR } from '../theme';

/**
 * 탑 한 층 그리기 (Phaser). 시뮬레이션은 sim.ts 의 step() 이 하고, 여기는 그림만.
 * 픽셀 선명: pixelArt + 정수 배율 카메라 (화면 크기에 맞는 가장 큰 정수 배율) + roundPixels.
 */
export interface SceneHooks {
  input(): Input;
  consume(): void;
  /** 한 간격의 사건들 (HUD·소리·안내·상점·층 끝) */
  onEvents(evs: SimEvent[], s: RunState): void;
  onFrame(s: RunState): void;
}
export interface SceneArt {
  /** 캐릭터 레이어 4장 (몸 → 얼굴 → 옷 → 머리) */
  layers: HTMLCanvasElement[];
  tiles: HTMLCanvasElement;
  enemies: Record<string, HTMLCanvasElement>;
}

/** 화면에 늘 보이는 넓이 (월드 픽셀, 가로 180 · 세로 190 이상) 를 지키는 가장 큰 정수 배율. 폰 세로·가로 2배, PC 3~4배 */
export const zoomFor = (w: number, h: number) => Math.max(1, Math.floor(Math.min(w / 180, h / 190)));

const DIGITS = '0123456789';
const DW = 5;
const DH = 7;
/** 3×5 숫자 (가로 3칸 비트, 위에서 아래로) */
const FONT3 = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111'];

interface Num {
  o: Phaser.GameObjects.BitmapText;
  t: number;
  vy: number;
}

export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private hooks!: SceneHooks;
  private art!: SceneArt;
  private acc = 0;
  paused = false;
  private map!: Phaser.Tilemaps.Tilemap;
  private layer!: Phaser.Tilemaps.TilemapLayer;
  private shown: number[] = [];
  private hero!: Phaser.GameObjects.Container;
  private heroParts: Phaser.GameObjects.Sprite[] = [];
  private shadow!: Phaser.GameObjects.Ellipse;
  private foes = new Map<number, Phaser.GameObjects.Sprite>();
  private projs = new Map<number, Phaser.GameObjects.Image>();
  private under!: Phaser.GameObjects.Graphics;
  private over!: Phaser.GameObjects.Graphics;
  private nums: Num[] = [];
  private numNext = 0;
  private slash: { t: number; face: number; big: boolean } | null = null;
  private shake = 0;
  private zoom = 1;

  constructor() {
    super('tower');
  }

  init(data: { run: RunState; hooks: SceneHooks; art: SceneArt }) {
    this.run = data.run;
    this.hooks = data.hooks;
    this.art = data.art;
    this.acc = 0;
    this.foes.clear();
    this.projs.clear();
    this.nums = [];
    this.heroParts = [];
    this.slash = null;
  }

  /** 캐릭터 외형이 바뀌었다 (메뉴의 외형 바꾸기) */
  setLayers(layers: HTMLCanvasElement[]) {
    this.art.layers = layers;
    layers.forEach((cv, i) => this.sheetTexture(`L${i}`, cv, FRAME, FRAME, true));
    this.heroParts.forEach((p, i) => p.setTexture(`L${i}`, 0));
  }

  private sheetTexture(key: string, cv: HTMLCanvasElement, fw: number, fh: number, replace = false) {
    if (this.textures.exists(key)) {
      if (!replace) return;
      this.textures.remove(key);
    }
    const tex = this.textures.addCanvas(key, cv)!;
    const cols = Math.floor(cv.width / fw);
    const rows = Math.floor(cv.height / fh);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tex.add(y * cols + x, 0, x * fw, y * fh, fw, fh);
  }

  create() {
    const s = this.run;
    const art = this.art;
    art.layers.forEach((cv, i) => this.sheetTexture(`L${i}`, cv, FRAME, FRAME, true));
    this.sheetTexture('tiles', art.tiles, TS, TS, true);
    for (const [id, cv] of Object.entries(art.enemies)) this.sheetTexture(`E:${id}`, cv, enemySize(id), enemySize(id), true);
    this.makeFx();

    // 바닥 (타일맵)
    this.map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: s.map.w, height: s.map.h });
    const set = this.map.addTilesetImage('tiles', 'tiles', TS, TS, 0, 0)!;
    this.layer = this.map.createBlankLayer('floor', set, 0, 0)!;
    this.shown = new Array(s.map.w * s.map.h).fill(-2);
    this.refreshTiles();

    this.under = this.add.graphics().setDepth(1);
    this.over = this.add.graphics().setDepth(5000);
    this.shadow = this.add.ellipse(0, 0, 12, 5, COLOR.outline, 0.25).setDepth(2);
    this.hero = this.add.container(s.p.x, s.p.y);
    for (let i = 0; i < 4; i++) {
      const sp = this.add.sprite(0, 0, `L${i}`, 0).setOrigin(0.5, 1);
      this.heroParts.push(sp);
      this.hero.add(sp);
    }
    for (const e of s.enemies) this.foeSprite(e);
    for (let i = 0; i < 24; i++) {
      const o = this.add.bitmapText(0, 0, 'pdigits', '0').setOrigin(0.5).setDepth(6000).setVisible(false);
      this.nums.push({ o, t: 0, vy: 0 });
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor(COLOR.inkSoft);
    cam.setRoundPixels(true);
    cam.setBounds(0, 0, s.map.w * TILE, s.map.h * TILE);
    cam.startFollow(this.hero, true, 0.18, 0.18, 0, 8);
    this.fitZoom();
    this.scale.on('resize', this.fitZoom, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fitZoom, this));
    this.draw(0);
  }

  private fitZoom() {
    const cam = this.cameras.main;
    // 화면을 돌리거나 창 크기가 바뀌면 카메라 크기도 새 그림판에 맞춘다
    cam.setSize(this.scale.width, this.scale.height);
    this.zoom = zoomFor(this.scale.width, this.scale.height);
    cam.setZoom(this.zoom);
    // 층이 화면보다 작으면 가운데 (경계를 화면 크기만큼 넓힌다)
    const vw = this.scale.width / this.zoom;
    const vh = this.scale.height / this.zoom;
    const mw = this.run.map.w * TILE;
    const mh = this.run.map.h * TILE;
    cam.setBounds(Math.min(0, (mw - vw) / 2), Math.min(0, (mh - vh) / 2), Math.max(mw, vw), Math.max(mh, vh));
  }

  /** 투사체·숫자 글자판 (코드 그림) */
  private makeFx() {
    const mk = (key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const t = this.textures.createCanvas(key, w, h)!;
      paint(t.getContext());
      t.refresh();
    };
    const px = (g: CanvasRenderingContext2D, c: number, x: number, y: number, w = 1, h = 1) => {
      g.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
      g.fillRect(x, y, w, h);
    };
    mk('crescent', 12, 12, (g) => {
      // 오른쪽으로 날아가는 초승달 (돌려서 쓴다)
      for (let y = 0; y < 12; y++) {
        const off = Math.round(Math.abs(y - 5.5) * 0.6);
        px(g, COLOR.outline, 5 - off, y, 1, 1);
        px(g, COLOR.white, 6 - off, y, 3, 1);
        px(g, COLOR.skyMid, 9 - off, y, 1, 1);
      }
    });
    mk('spore', 6, 6, (g) => {
      px(g, COLOR.outline, 1, 0, 4, 6);
      px(g, COLOR.outline, 0, 1, 6, 4);
      px(g, COLOR.win, 1, 1, 4, 4);
      px(g, COLOR.pink, 2, 2, 1, 1);
    });
    mk('rock', 8, 8, (g) => {
      px(g, COLOR.outline, 1, 0, 6, 8);
      px(g, COLOR.outline, 0, 1, 8, 6);
      px(g, COLOR.draw, 1, 1, 6, 6);
      px(g, COLOR.lineSoft, 2, 2, 2, 2);
    });
    // 2구역 적 투사체
    mk('thorn', 8, 6, (g) => {
      // 오른쪽으로 나는 가시 (돌려서 쓴다)
      px(g, COLOR.outline, 0, 2, 7, 2);
      px(g, COLOR.win, 1, 2, 5, 1);
      px(g, COLOR.outline, 6, 1, 2, 4);
      px(g, COLOR.white, 7, 2, 1, 1);
    });
    mk('venom', 8, 8, (g) => {
      px(g, COLOR.outline, 1, 0, 6, 8);
      px(g, COLOR.outline, 0, 1, 8, 6);
      px(g, COLOR.win, 1, 1, 6, 6);
      px(g, COLOR.pink, 2, 2, 2, 2);
    });
    // 3~5구역 적 투사체 (오른쪽으로 나는 모양 — 돌려서 쓴다)
    mk('shard', 9, 5, (g) => {
      px(g, COLOR.outline, 0, 1, 8, 3);
      px(g, COLOR.skyMid, 1, 2, 6, 1);
      px(g, COLOR.outline, 7, 0, 2, 5);
      px(g, COLOR.white, 8, 2, 1, 1);
    });
    mk('dart', 8, 6, (g) => {
      px(g, COLOR.outline, 0, 1, 8, 4);
      px(g, COLOR.lose, 1, 2, 6, 2);
      px(g, COLOR.panel, 5, 2, 2, 1);
    });
    mk('straw', 8, 4, (g) => {
      px(g, COLOR.outline, 0, 0, 8, 4);
      px(g, COLOR.primary, 1, 1, 6, 2);
    });
    mk('quill', 10, 6, (g) => {
      px(g, COLOR.outline, 0, 1, 10, 4);
      px(g, COLOR.primary, 1, 2, 8, 2);
      px(g, COLOR.lose, 7, 2, 2, 1);
    });
    mk('leaf', 8, 8, (g) => {
      px(g, COLOR.outline, 1, 0, 6, 8);
      px(g, COLOR.outline, 0, 1, 8, 6);
      px(g, COLOR.pink, 1, 1, 6, 6);
      px(g, COLOR.white, 2, 2, 2, 2);
    });
    mk('whirl', 14, 14, (g) => {
      px(g, COLOR.outline, 2, 1, 10, 3);
      px(g, COLOR.white, 3, 2, 8, 1);
      px(g, COLOR.outline, 3, 5, 8, 3);
      px(g, COLOR.skyMid, 4, 6, 6, 1);
      px(g, COLOR.outline, 5, 9, 5, 3);
      px(g, COLOR.white, 6, 10, 3, 1);
    });
    mk('arrow', 12, 5, (g) => {
      px(g, COLOR.outline, 0, 1, 10, 3);
      px(g, COLOR.inkSoft, 1, 2, 8, 1);
      px(g, COLOR.outline, 9, 0, 3, 5);
      px(g, COLOR.primary, 10, 1, 2, 3);
    });
    mk('spike', 10, 6, (g) => {
      px(g, COLOR.outline, 0, 1, 8, 4);
      px(g, COLOR.draw, 1, 2, 6, 2);
      px(g, COLOR.outline, 7, 0, 3, 6);
      px(g, COLOR.lineSoft, 8, 2, 2, 2);
    });
    // 구슬 스킬 투사체 (코드 그림)
    mk('ice', 10, 8, (g) => {
      px(g, COLOR.outline, 0, 2, 10, 4);
      px(g, COLOR.skyMid, 1, 3, 8, 2);
      px(g, COLOR.white, 6, 3, 3, 1);
    });
    mk('feather', 10, 6, (g) => {
      px(g, COLOR.outline, 0, 1, 10, 4);
      px(g, COLOR.white, 1, 2, 8, 2);
      px(g, COLOR.lineSoft, 1, 3, 4, 1);
    });
    mk('fireFeather', 10, 6, (g) => {
      px(g, COLOR.outline, 0, 1, 10, 4);
      px(g, COLOR.pink, 1, 2, 8, 2);
      px(g, COLOR.primary, 5, 2, 4, 1);
    });
    mk('sonic', 8, 14, (g) => {
      px(g, COLOR.outline, 2, 0, 3, 14);
      px(g, COLOR.primaryLight, 3, 1, 1, 12);
      px(g, COLOR.outline, 5, 3, 2, 8);
      px(g, COLOR.white, 6, 4, 1, 6);
    });
    mk('wind', 12, 12, (g) => {
      for (let y = 0; y < 12; y++) {
        const off = Math.round(Math.abs(y - 5.5) * 0.5);
        px(g, COLOR.skyMid, 6 - off, y, 2, 1);
        px(g, COLOR.white, 8 - off, y, 1, 1);
      }
    });
    mk('tornado', 18, 18, (g) => {
      px(g, COLOR.outline, 3, 2, 12, 3);
      px(g, COLOR.skyMid, 4, 3, 10, 1);
      px(g, COLOR.outline, 5, 6, 9, 3);
      px(g, COLOR.teamA, 6, 7, 7, 1);
      px(g, COLOR.outline, 7, 10, 6, 3);
      px(g, COLOR.skyMid, 8, 11, 4, 1);
      px(g, COLOR.outline, 8, 14, 3, 3);
      px(g, COLOR.primaryLight, 9, 15, 1, 1);
    });
    if (!this.cache.bitmapFont.exists('pdigits')) {
      mk('pdigits-img', DW * DIGITS.length, DH, (g) => {
        // 3×5 흰 숫자 + 둘레 1칸 테두리 (칸 5×7)
        for (let i = 0; i < DIGITS.length; i++) {
          const on = (x: number, y: number) => x >= 0 && x < 3 && y >= 0 && y < 5 && FONT3[i][y * 3 + x] === '1';
          for (let y = -1; y <= 5; y++) for (let x = -1; x <= 3; x++) {
            if (on(x, y)) px(g, COLOR.white, i * DW + 1 + x, 1 + y);
            else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) px(g, COLOR.outline, i * DW + 1 + x, 1 + y);
          }
        }
      });
      const cfg = { image: 'pdigits-img', width: DW, height: DH, chars: DIGITS, charsPerRow: DIGITS.length, 'offset.x': 0, 'offset.y': 0, 'spacing.x': 0, 'spacing.y': 0, lineSpacing: 0 };
      this.cache.bitmapFont.add('pdigits', Phaser.GameObjects.RetroFont.Parse(this, cfg));
    }
  }

  // ---------- 타일 ----------
  private visual(x: number, y: number): number {
    const s = this.run;
    const t = tileOf(s, x, y);
    const k = (a: TileArt) => tileArtIndex(a);
    switch (t) {
      case T.VOID: return -1;
      case T.FLOOR: return ((x * 7 + y * 13) % 9 === 0 ? k('floor2') : k('floor'));
      case T.WALL: {
        const below = tileOf(s, x, y + 1);
        return below !== T.WALL && below !== T.VOID ? k('wallFace') : k('wallTop');
      }
      case T.DOOR: {
        const owner = s.doorOwner.get(y * s.map.w + x);
        return owner !== undefined && s.locked.has(owner) ? k('doorLocked') : k('doorOpen');
      }
      case T.WATER: return k('water');
      case T.PILLAR: return k('pillar');
      case T.GATE: return k('gate');
      case T.ROCK: return k('rock');
      case T.SWITCH: return k('switch');
      case T.SWITCH_ON: return k('switchOn');
      case T.VINE: return k('vine');
      case T.STAIRS: return k('stairs');
      case T.CHEST: return k('chest');
      case T.CHEST_OPEN: return k('chestOpen');
      case T.PEDESTAL: return k('pedestal');
      case T.PEDESTAL_EMPTY: return k('pedestalEmpty');
      case T.SHOP: return k('shop');
      case T.FOUNTAIN: return k('fountain');
      case T.FOUNTAIN_DRY: return k('fountainDry');
      case T.RUBBLE: return k('rubble');
      case T.PLATE: return k('plate');
      case T.PLATE_ON: return k('plateOn');
      case T.BRAZIER: return k('brazier');
      case T.BRAZIER_LIT: return k('brazierLit');
      case T.POST: return k('post');
      case T.COLD_WATER: return k('coldWater');
      case T.ICE: return k('ice');
      case T.BELL: return k('bell');
      case T.BELL_ON: return k('bellOn');
      case T.GONG: return k('gong');
      case T.GONG_ON: return k('gongOn');
      case T.BOULDER: return k('boulder');
      case T.PIT: return k('pit');
    }
    return k('floor');
  }
  private refreshTiles() {
    const s = this.run;
    for (let y = 0; y < s.map.h; y++) {
      for (let x = 0; x < s.map.w; x++) {
        const v = this.visual(x, y);
        const i = y * s.map.w + x;
        if (this.shown[i] === v) continue;
        this.shown[i] = v;
        if (v < 0) this.layer.removeTileAt(x, y);
        else this.layer.putTileAt(v, x, y);
      }
    }
  }

  // ---------- 돌리기 ----------
  update(_time: number, delta: number) {
    const s = this.run;
    const dt = Math.min(delta, 100) / 1000;
    if (!this.paused && !s.over) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n++ < 6 && !s.over) {
        this.acc -= STEP;
        step(s, this.hooks.input());
        this.hooks.consume();
        if (s.events.length) {
          const evs = s.events.splice(0);
          this.takeEvents(evs);
          this.hooks.onEvents(evs, s);
        }
      }
      if (this.acc > STEP * 6) this.acc = 0;
    }
    this.draw(this.paused ? 0 : dt);
    this.hooks.onFrame(s);
  }

  private takeEvents(evs: SimEvent[]) {
    let tiles = false;
    for (const ev of evs) {
      switch (ev.t) {
        case 'swing':
          if (ev.kind !== 'snake') this.slash = { t: 0.14, face: this.run.p.face, big: ev.combo === 3 || ev.kind !== 'basic' };
          break;
        case 'hit':
          this.number(ev.x, ev.y, ev.dmg, ev.big);
          break;
        case 'hurt':
          if (ev.dmg > 0) this.number(this.run.p.x, this.run.p.y - 22, ev.dmg, false, true);
          this.shake = 0.15;
          break;
        case 'kill': {
          const sp = this.foes.get(ev.id);
          if (sp) this.tweens.add({ targets: sp, alpha: 0, scale: 1.4, duration: 260, onComplete: () => sp.setVisible(false) });
          break;
        }
        case 'bossDown':
          this.shake = 0.5;
          this.cameras.main.flash(300, 255, 255, 255);
          break;
        case 'gate':
        case 'plate':
        case 'plateReset':
        case 'fire':
        case 'rock':
        case 'chest':
        case 'lock':
        case 'unlock':
        case 'orb':
        case 'fountain':
        case 'stairsShown':
        case 'legend':
        case 'ice':
        case 'ring':
        case 'ringReset':
        case 'boulder':
          tiles = true;
          break;
      }
    }
    if (tiles) this.refreshTiles();
  }

  private number(x: number, y: number, n: number, big: boolean, hurt = false) {
    const it = this.nums[this.numNext++ % this.nums.length];
    it.o.setText(String(n)).setPosition(Math.round(x), Math.round(y)).setVisible(true).setScale(1).setTint(hurt ? COLOR.pink : big ? COLOR.primary : COLOR.white);
    it.t = 0.7;
    it.vy = -18;
  }

  private draw(dt: number) {
    const s = this.run;
    const p = s.p;
    // 캐릭터
    this.hero.setPosition(Math.round(p.x), Math.round(p.y + 3));
    this.hero.setDepth(p.y);
    this.shadow.setPosition(Math.round(p.x), Math.round(p.y + 2));
    let col = 0;
    if (p.swing) col = attackCol(p.swing.t / p.swing.dur);
    else if (p.moving) col = walkCol(p.walkT);
    const f = frameIndex(p.face, col);
    const blink = (p.inv > 0 && Math.floor(s.t * 20) % 2 === 0) || p.hurtT > 0.2;
    for (const part of this.heroParts) {
      part.setFrame(f);
      if (p.hurtT > 0.15) part.setTintFill(COLOR.pink);
      else if (p.gale > 0 && Math.floor(s.t * 6) % 2 === 0) part.setTint(COLOR.primaryLight);
      else part.clearTint();
    }
    this.hero.setAlpha(blink ? 0.55 : 1);

    // 적 (보스가 부른 졸개처럼 나중에 생긴 적도)
    for (const e of s.enemies) {
      const sp = this.foes.get(e.id) ?? this.foeSprite(e);
      if (!e.alive) continue;
      // 아직 나오지 않은 무리 · 땅속의 이무기는 보이지 않는다
      sp.setVisible(!e.pending && !e.hidden);
      if (e.pending || e.hidden) continue;
      // 하늘에 오른 영등할미·뛰어오른 정예: 높이 띄우고 그림자 쪽으로 옮긴다
      const air = e.guard === 'air' ? 26 : 0;
      const S = enemySize(e.def.id);
      const frozen = e.freeze > 0 || e.stun > 0;
      const bob = e.active && e.def.ai !== 'ranged' && !frozen ? Math.floor(s.t * 6 + e.id) % 2 : 0;
      const wind = e.state === 'windup' || e.state.endsWith('Wind');
      sp.setFrame(e.hitFlash > 0 ? 3 : wind ? 2 : bob);
      // 두꺼비가 뛰어오르는 중: 포물선으로 들어 올린다
      const hopLift = e.state === 'hop' && e.def.hop ? Math.sin(Math.PI * (1 - Math.max(0, e.t) / e.def.hop.time)) * 14 : 0;
      const leapLift = e.state === 'leap' && e.def.leap ? Math.sin(Math.PI * (1 - Math.max(0, e.t) / e.def.leap.time)) * 18 : 0;
      const lift = hopLift + leapLift + air;
      sp.setPosition(Math.round(e.x), Math.round(e.y - (e.def.fly ? 4 : 0) - (S > 16 ? S / 2 - e.def.r : 0) - lift));
      sp.setFlipX(e.faceX < 0);
      sp.setDepth(e.y + e.def.r + (lift ? 200 : 0));
      sp.setAlpha(e.wake > 0 ? 0.5 + 0.5 * (Math.floor(s.t * 12) % 2) : 1);
      if (e.guard === 'ice') sp.setTint(Math.floor(s.t * 3) % 2 === 0 ? COLOR.white : COLOR.skyMid);
      else if (e.state === 'stun' || e.stun > 0) sp.setTint(COLOR.skyMid);
      else if (e.freeze > 0) sp.setTintFill(COLOR.skyMid);
      else if (e.burn > 0 && Math.floor(s.t * 8) % 2 === 0) sp.setTint(COLOR.primaryDeep);
      else if (e.slowT > 0) sp.setTint(COLOR.skyTop);
      else if (e.rage && Math.floor(s.t * 4) % 2 === 0) sp.setTint(COLOR.pink);
      else sp.clearTint();
    }

    // 투사체
    const live = new Set<number>();
    for (const pr of s.projs) {
      live.add(pr.id);
      let o = this.projs.get(pr.id);
      if (!o) {
        const key = this.textures.exists(pr.kind) ? pr.kind : 'spore';
        o = this.add.image(pr.x, pr.y, key).setDepth(4000);
        this.projs.set(pr.id, o);
      }
      o.setPosition(Math.round(pr.x), Math.round(pr.y));
      if (['crescent', 'thorn', 'ice', 'feather', 'fireFeather', 'sonic', 'wind', 'shard', 'dart', 'straw', 'quill', 'arrow', 'spike'].includes(pr.kind)) o.setRotation(Math.atan2(pr.vy, pr.vx));
      else if (pr.kind === 'tornado' || pr.kind === 'whirl') o.setFlipX(Math.floor(s.t * 10) % 2 === 0);
      else if (pr.kind === 'leaf') o.setRotation(s.t * 6);
      // 되받아친 투사체는 흰빛
      if (pr.from === 'p' && ['spore', 'rock', 'thorn', 'venom', 'shard', 'dart', 'straw', 'quill', 'leaf', 'whirl', 'arrow', 'spike'].includes(pr.kind)) o.setTint(COLOR.white);
    }
    for (const [id, o] of this.projs) {
      if (!live.has(id)) {
        o.destroy();
        this.projs.delete(id);
      }
    }

    // 바닥 위: 남는 바닥(서리 · 불) · 공격 예고 · 떨어지는 공격 · 수호 거인
    const g = this.under;
    g.clear();
    for (const h of s.hazards) {
      const fade = Math.min(1, h.t / 0.5);
      const c = h.status.kind === 'slow' ? COLOR.skyMid : h.status.kind === 'burn' ? COLOR.primaryDeep : COLOR.win;
      g.fillStyle(c, 0.32 * fade);
      g.fillCircle(h.x, h.y, h.r);
      g.lineStyle(1, h.status.kind === 'slow' ? COLOR.white : COLOR.pink, 0.6 * fade);
      g.strokeCircle(h.x, h.y, h.r);
    }
    for (const k of s.strikes) {
      const t = Math.min(1, k.t / k.total);
      g.fillStyle(COLOR.pink, 0.15 + t * 0.25);
      g.fillCircle(k.x, k.y, k.r * (0.3 + 0.7 * t));
      g.lineStyle(1, COLOR.pink, 0.9);
      g.strokeCircle(k.x, k.y, k.r);
    }
    for (const e of s.enemies) {
      const t = e.tele;
      if (!e.alive || !t) continue;
      const k = Math.min(1, t.t / t.total);
      g.fillStyle(COLOR.pink, 0.18 + k * 0.22);
      g.lineStyle(1, COLOR.pink, 0.9);
      if (t.kind === 'circle') {
        g.fillCircle(t.x, t.y, t.r * (0.35 + 0.65 * k));
        g.strokeCircle(t.x, t.y, t.r);
      } else if (t.kind === 'cross') {
        // 여러 갈래 선 (불가사리 쇠가시)
        g.lineStyle(t.r * 2 * (0.4 + 0.6 * k), COLOR.pink, 0.22 + k * 0.2);
        const n = t.n ?? 8;
        for (let i = 0; i < n; i++) {
          const a = (t.ang ?? 0) + (i / n) * Math.PI * 2;
          g.lineBetween(t.x, t.y, t.x + Math.cos(a) * t.len, t.y + Math.sin(a) * t.len);
        }
      } else {
        const ex = t.x + t.dx * t.len;
        const ey = t.y + t.dy * t.len;
        g.lineStyle(t.r * 2 * (0.4 + 0.6 * k), COLOR.pink, 0.22 + k * 0.2);
        g.lineBetween(t.x, t.y, ex, ey);
      }
    }
    for (const f of s.fx) this.drawFx(g, f, false);
    if (p.giant) {
      // 거대 무사 (반투명, 캐릭터 뒤)
      const gx = Math.round(p.x);
      const gy = Math.round(p.y);
      g.fillStyle(COLOR.teamA, 0.35);
      g.fillRoundedRect(gx - 11, gy - 40, 22, 30, 4);
      g.fillCircle(gx, gy - 44, 7);
      g.lineStyle(1, COLOR.outline, 0.6);
      g.strokeRoundedRect(gx - 11, gy - 40, 22, 30, 4);
      g.fillStyle(COLOR.primary, 0.8);
      g.fillRect(gx - 9, gy - 8, Math.round(18 * (p.giant.hp / p.giant.max)), 2);
    }

    // 위: 칼 자국 · 영체 팔 · 적 체력
    const o = this.over;
    o.clear();
    if (this.slash) {
      this.slash.t -= dt;
      if (this.slash.t <= 0) this.slash = null;
      else this.drawSlash(o, this.slash.face, this.slash.big, this.slash.t / 0.14);
    }
    if (p.armFx > 0) {
      const [fx, fy] = [[0, 1], [-1, 0], [1, 0], [0, -1]][p.face];
      const cx = p.x + fx * 17;
      const cy = p.y - BODY_UP + fy * 17;
      o.fillStyle(COLOR.skyMid, 0.55 * (p.armFx / 0.25));
      o.fillCircle(cx, cy, 10);
      o.lineStyle(1, COLOR.white, 0.9);
      o.strokeCircle(cx, cy, 10);
    }
    for (const e of s.enemies) if (e.alive && e.active && !e.pending && e.hp < e.max && !e.def.boss) this.hpBar(o, e);
    for (const f of s.fx) this.drawFx(o, f, true);
    this.drawAura(o);
    if (s.wind) this.drawWind(o, s.wind.dx, s.wind.dy);

    // 숫자
    for (const n of this.nums) {
      if (n.t <= 0) continue;
      n.t -= dt;
      n.o.y += n.vy * dt;
      n.vy += 30 * dt;
      if (n.t <= 0) n.o.setVisible(false);
    }
    // 흔들림
    if (this.shake > 0) {
      this.shake -= dt;
      this.cameras.main.setFollowOffset(Math.round((Math.random() - 0.5) * 3), 8 + Math.round((Math.random() - 0.5) * 3));
    } else this.cameras.main.setFollowOffset(0, 8);
  }

  private foeSprite(e: Enemy) {
    const sp = this.add.sprite(e.x, e.y, `E:${e.def.id}`, 0).setOrigin(0.5, 0.5);
    if (e.pending) sp.setVisible(false);
    this.foes.set(e.id, sp);
    return sp;
  }

  /** 구슬 스킬·장치 효과 (코드 그림). top = 캐릭터 위에 그리는 것 */
  private drawFx(g: Phaser.GameObjects.Graphics, f: Fx, top: boolean) {
    const k = Math.max(0, f.t / f.dur);
    const grow = 1 - k;
    const ring = (color: number, fill: number) => {
      g.fillStyle(color, fill * k);
      g.fillCircle(f.x, f.y, f.r * (0.4 + 0.6 * grow));
      g.lineStyle(2, color, 0.9 * k);
      g.strokeCircle(f.x, f.y, f.r * (0.4 + 0.6 * grow));
    };
    const line = (color: number, w: number) => {
      g.lineStyle(w, color, 0.9 * k);
      g.lineBetween(f.x, f.y, f.x2 ?? f.x, f.y2 ?? f.y);
    };
    switch (f.kind) {
      case 'fireWave': if (!top) ring(COLOR.primaryDeep, 0.35); break;
      case 'fireHit': if (top) ring(COLOR.pink, 0.5); break;
      case 'freeze': if (!top) ring(COLOR.skyMid, 0.4); break;
      case 'wool': if (!top) ring(COLOR.white, 0.45); break;
      case 'chord': if (!top) { ring(COLOR.primaryLight, 0.2); g.strokeCircle(f.x, f.y, f.r * 0.6 * (0.4 + 0.6 * grow)); } break;
      case 'explode': if (!top) ring(COLOR.pink, 0.4); break;
      case 'burst': if (!top) ring(COLOR.skyTop, 0.35); break;
      case 'storm': if (!top) ring(COLOR.teamA, 0.25); break;
      case 'dust': if (!top) ring(COLOR.draw, 0.4); break;
      case 'spawn': if (!top) ring(COLOR.pink, 0.25); break;
      case 'wispBurst': if (!top) ring(COLOR.skyTop, 0.45); break;
      case 'icicle': if (!top) ring(COLOR.white, 0.5); break;
      case 'ember': if (!top) ring(COLOR.primaryDeep, 0.45); break;
      case 'gust': if (top) { g.lineStyle(f.r * 2 * k, COLOR.white, 0.35 * k); g.lineBetween(f.x, f.y, f.x2 ?? f.x, f.y2 ?? f.y); } break;
      case 'orbRise':
        // 전설 구슬이 솟아오른다: 빛기둥 + 퍼지는 원
        if (top) {
          g.fillStyle(COLOR.primaryLight, 0.35 * k);
          g.fillRect(f.x - 6, f.y - 80 * grow, 12, 80 * grow);
        } else ring(COLOR.primary, 0.3);
        break;
      case 'spark': if (top) ring(COLOR.white, 0.8); break;
      case 'parry': if (top) { g.lineStyle(2, COLOR.primary, 0.9 * k); g.strokeCircle(f.x, f.y, f.r); } break;
      case 'bolt':
        if (top) {
          // 하늘에서 떨어지는 번개 + 땅의 원
          g.lineStyle(3, COLOR.primaryLight, k);
          g.lineBetween(f.x - 3, f.y - 60, f.x + 4, f.y - 30);
          g.lineBetween(f.x + 4, f.y - 30, f.x - 2, f.y - 14);
          g.lineBetween(f.x - 2, f.y - 14, f.x, f.y);
        } else ring(COLOR.primaryLight, 0.3);
        break;
      case 'chain': if (top) { line(COLOR.primaryLight, 3); line(COLOR.white, 1); } break;
      case 'whip': if (top) { line(COLOR.win, 3); line(COLOR.outline, 1); } break;
      case 'slash': if (top) { line(COLOR.white, 3); line(COLOR.lineSoft, 1); } break;
      case 'sweep':
        if (top) {
          g.lineStyle(4, COLOR.win, 0.8 * k);
          g.beginPath();
          g.arc(f.x, f.y, f.r * (0.6 + 0.4 * grow), (f.ang ?? 0) - (f.arc ?? 2) / 2, (f.ang ?? 0) + (f.arc ?? 2) / 2);
          g.strokePath();
        }
        break;
    }
  }

  /** 영등할미 샛바람: 화면을 가로지르는 흰 바람 줄 (부는 쪽으로 흐른다) */
  private drawWind(g: Phaser.GameObjects.Graphics, dx: number, dy: number) {
    const cam = this.cameras.main;
    const v = cam.worldView;
    const t = this.run.t;
    g.lineStyle(1, COLOR.white, 0.55);
    for (let i = 0; i < 14; i++) {
      const a = (i * 0.618) % 1;
      const b = (i * 0.377 + 0.13) % 1;
      const span = dx ? v.width : v.height;
      const off = ((a * span + t * 90) % span + span) % span;
      if (dx) {
        const x = dx > 0 ? v.x + off : v.right - off;
        const y = v.y + b * v.height;
        g.lineBetween(x, y, x - dx * 14, y);
      } else {
        const y = dy > 0 ? v.y + off : v.bottom - off;
        const x = v.x + b * v.width;
        g.lineBetween(x, y, x, y - dy * 14);
      }
    }
  }

  /** 캐릭터 둘레: 물 보호막 · 결계 · 막기 · 깃털 방벽 · 혈기 · 시전 · 쌓은 연타 */
  private drawAura(g: Phaser.GameObjects.Graphics) {
    const s = this.run;
    const p = s.p;
    const x = p.x;
    const y = p.y - BODY_UP;
    if (p.shield) {
      g.fillStyle(COLOR.teamA, 0.18);
      g.fillCircle(x, y, 14);
      g.lineStyle(1, COLOR.skyMid, 0.9);
      g.strokeCircle(x, y, 14);
    }
    if (p.barrier > 0) {
      g.fillStyle(COLOR.win, 0.22);
      g.fillCircle(x, y, 17);
      g.lineStyle(2, COLOR.win, 0.9);
      g.strokeCircle(x, y, 17);
    }
    if (p.parry > 0) {
      g.lineStyle(2, COLOR.primary, 0.9);
      g.strokeCircle(x, y, 13);
    }
    if (p.gap > 0) {
      g.lineStyle(1, COLOR.pink, 0.7);
      g.strokeCircle(x, y, 12);
    }
    if (p.reflect > 0 && Math.floor(s.t * 8) % 2 === 0) {
      g.lineStyle(1, COLOR.pink, 0.9);
      g.strokeCircle(x, y, 15);
    }
    if (p.blades > 0) {
      const R = prm('rooster', 'bladeR', 20);
      for (let i = 0; i < 4; i++) {
        const a = s.t * 6 + (i * Math.PI) / 2;
        g.fillStyle(COLOR.white, 1);
        g.fillRect(Math.round(x + Math.cos(a) * R) - 2, Math.round(y + Math.sin(a) * R) - 1, 4, 3);
        g.lineStyle(1, COLOR.outline, 1);
        g.strokeRect(Math.round(x + Math.cos(a) * R) - 2, Math.round(y + Math.sin(a) * R) - 1, 4, 3);
      }
    }
    if (p.blood > 0) {
      g.lineStyle(1, COLOR.pink, 0.5 + 0.4 * (Math.floor(s.t * 6) % 2));
      g.strokeCircle(x, y, 11);
    }
    if (p.cast) {
      const k = p.cast.t / p.cast.total;
      g.fillStyle(COLOR.primaryDeep, 0.25 + 0.3 * k);
      g.fillCircle(x, y + 6, 8 + 10 * k);
    }
    if (p.storm > 0 && p.stacks > 0) {
      g.fillStyle(COLOR.skyTop, 0.9);
      for (let i = 0; i < Math.min(20, p.stacks); i++) g.fillRect(Math.round(x - 10 + (i % 10) * 2), Math.round(y - 20 - Math.floor(i / 10) * 2), 1, 1);
    }
  }

  private drawSlash(o: Phaser.GameObjects.Graphics, face: number, big: boolean, k: number) {
    const p = this.run.p;
    const base = [Math.PI / 2, Math.PI, 0, -Math.PI / 2][face];
    const cx = p.x;
    const cy = p.y - BODY_UP;
    const r = big ? 19 : 16;
    o.lineStyle(big ? 3 : 2, COLOR.white, 0.4 + 0.6 * k);
    o.beginPath();
    o.arc(cx, cy, r, base - 1.1 + (1 - k) * 0.6, base + 1.1 - (1 - k) * 0.2);
    o.strokePath();
  }

  private hpBar(o: Phaser.GameObjects.Graphics, e: Enemy) {
    const w = Math.max(10, e.def.r * 2);
    const x = Math.round(e.x - w / 2);
    const y = Math.round(e.y - e.def.r - (e.def.size > 16 ? e.def.size / 2 : 6) - 3);
    o.fillStyle(COLOR.outline, 1);
    o.fillRect(x - 1, y - 1, w + 2, 4);
    o.fillStyle(COLOR.pink, 1);
    o.fillRect(x, y, Math.max(1, Math.round((w * e.hp) / e.max)), 2);
  }
}

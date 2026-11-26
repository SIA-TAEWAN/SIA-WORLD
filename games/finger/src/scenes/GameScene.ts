import Phaser from 'phaser';
import { artUrl, zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { choose } from '../game/autopilot';
import { hintJoined, hintPath, hintSearch, type HintSearch } from '../game/hint';
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
  towerFloor,
  type Room,
  type RunState,
  type ShotInput,
  type SimEvent,
} from '../sim';
import { ART_SLICE, SLICE_GAP, WALL_INSET, artFor, floorOf, hasArt, type GroundName, type OptionalArt } from '../artlist';
import { groundOf } from '../data/regions';
import { COLOR, FONT, MATGO, css } from '../theme';
import { chainRate, makeBuzzer } from '../ui/feel';
import { ensureArt, makeBall, tiled9 } from './art';
import { Fx, G, ensureFxArt } from './fx';

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
  /** 상태 아이콘 (방패 · 숨음 · 독 · 단단함), 필요할 때 만든다 */
  icons: Phaser.GameObjects.Image[];
  /** 그림 배율 (맞으면 잠깐 커진다) */
  base: number;
  art: string;
  /** 맞을 때 표정 그림 (있으면) */
  hitArt: string | null;
}

/** 요괴 상태 아이콘: 그림 · 색 */
const FOE_ICONS = {
  shield: [G.shield, COLOR.teamA],
  hide: [G.drop, COLOR.skyMid],
  poison: [G.bubble, COLOR.win],
  hard: [G.rock, COLOR.draw],
} as const;
/** 대원 나쁜 효과 아이콘 (독 · 느려짐 · 약해짐) */
const HERO_ICONS = [
  [G.bubble, COLOR.win],
  [G.arrow, COLOR.teamA],
  [G.arrow, COLOR.pink],
] as const;

const HEX = {
  white: css(COLOR.white),
  primary: css(COLOR.primary),
  pink: css(COLOR.pink),
  win: css(COLOR.win),
  lose: css(COLOR.lose),
  accent: css(COLOR.accent),
  sky: css(COLOR.skyMid),
  soft: css(COLOR.lineSoft),
  ink: css(COLOR.outline),
  inkSoft: css(COLOR.inkSoft),
};

/** 글자 색이 바뀔 때만 setColor (setColor 는 같은 색이어도 글자 캔버스를 다시 그린다 — 매 프레임 부르면 아이폰이 뜨거워진다) */
function colorOf(t: Phaser.GameObjects.Text, c: string) {
  if (t.style.color !== c) t.setColor(c);
}

interface SlotView {
  img: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
}

const ringOf = (type: string) => (type === 'pierce' ? COLOR.accent : COLOR.teamA);
/** 판 위 대원 그림 높이 = 판정 원 반지름 × 이 값 (전신 그림). 못 읽어 구슬로 그릴 때는 지름 × 1.05 */
const BODY_H = 2.6;
/** 필살기 컷인 그림은 게이지가 이만큼(턴) 남았을 때 받는다 */
const CUT_AHEAD = 2;
/** 바닥 그림을 하나도 못 읽었을 때의 코드 그림 바닥 */
const FLOOR_CODE = 'tile-code';
/** 발밑(그림자·차례 표시) 높이: 판정 원 가운데에서 반지름 × 이 값만큼 아래 */
const FOOT_FULL = 1.12;
const FOOT_BALL = 0.95;

export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private hooks!: SceneHooks;
  private ground = 'tile-field';
  /** 끝없는 탑: 층(방)마다 바뀌는 바닥 그림들 */
  private grounds: string[] = [];
  /** 스테이지의 지역 (방 바닥 그림). 끝없는 탑은 방마다 room.region */
  private region = 1;
  /** 판이 열린 뒤 받는 그림 (컷인 · 탑의 다음 지역 바닥): 키 → 받으면 부를 함수들. 못 받은 키도 남겨 다시 부르지 않는다 */
  private lazy = new Map<string, Array<() => void>>();
  /** 지금 깔린 바닥 그림 키 */
  private floorKey = '';
  /** 지금 깔아야 할 바닥 [지역, 옛 바닥 키] */
  private floorWant: [number, string] = [1, 'tile-field'];
  /** 판이 열린 뒤 받다가 못 받은 그림 */
  private failed = new Set<string>();
  private tile!: Phaser.GameObjects.TileSprite;
  private roomG!: Phaser.GameObjects.Graphics;
  /** 지금 그려 둔 방 (끝없는 탑은 층마다 바뀐다) */
  private roomShown: Room | null = null;
  paused = false;
  private mode: Mode = 'aim';
  private acc = 0;
  private waitUntil = 0;
  private queue: SimEvent[] = [];
  private nextEventAt = 0;
  private endAt = 0;

  private floor!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  /** 대원 발밑 (그림자 · 타입 색 타원 · 차례 표시) — 대원 그림보다 아래 */
  private footG!: Phaser.GameObjects.Graphics;
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
  /** 힌트 한 수 (game/hint.ts): 계산 중인 탐색 · 보여 주는 조준 (쏘면 사라진다) */
  private hintJob: HintSearch | null = null;
  private hint: ShotInput | null = null;
  /** 힌트대로 쏘면 지나가는 길 (방 좌표) */
  private hintPts: [number, number][] = [];
  private hintText!: Phaser.GameObjects.Text;

  // ---------- 7단계: 효과 · 컷인 · 소리 · 진동 ----------
  private efx!: Fx;
  private buzz = makeBuzzer();
  /** 이번 발사에서 이어진 튕김·타격 수 (소리가 점점 높아진다) */
  private chain = 0;
  /** 필살기 컷인이 지나가는 동안 발사를 잠깐 멈춘다 (화면만, 판 계산은 그대로) */
  private holdUntil = 0;
  private held: SimEvent[] = [];
  private heldSpecial: Extract<SimEvent, { t: 'special' }> | null = null;
  /** 요괴마다 이미 알린 큰 공격 자리 */
  private lastAim = new Map<number, string>();
  /** 방이 바뀌면 지우는 그림 (전용 그림 · 순간이동 소용돌이) */
  private roomObjs: Phaser.GameObjects.GameObject[] = [];
  private portalImgs: Phaser.GameObjects.Image[] = [];
  private warnImgs: Phaser.GameObjects.Image[] = [];
  private heroIcons: Phaser.GameObjects.Image[][] = [];
  /** 대원 구슬 그림 키 (전용 그림 h-<id> 가 있으면 그것) */
  private ballKeys: string[] = [];
  /** 판 위 대원 그림 키: 십이지 전신 그림(full-<id>), 못 읽었으면 구슬 */
  private bodyKeys: string[] = [];
  /** 전신 그림인가 (구슬이면 false — 크기·기울임 규칙이 다르다) */
  private bodyFull: boolean[] = [];
  private trailAt = 0;
  private lastShakeAt = 0;

  constructor() {
    super('game');
  }

  init(data: { run: RunState; hooks: SceneHooks; ground?: string; grounds?: string[]; region?: number }) {
    this.run = data.run;
    this.hooks = data.hooks;
    this.ground = `tile-${data.ground ?? 'field'}`;
    this.grounds = (data.grounds ?? []).map((g) => `tile-${g}`);
    this.region = data.region ?? this.run.room.region ?? 1;
    this.lazy = new Map();
    this.failed = new Set();
    this.floorKey = '';
    this.roomShown = null;
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
    this.hintJob = null;
    this.hint = null;
    this.shownHp = this.run.heroes.map((h) => h.hp);
    this.chain = 0;
    this.holdUntil = 0;
    this.held = [];
    this.roomObjs = [];
    this.portalImgs = [];
    this.warnImgs = [];
    this.heroIcons = [];
    this.ballKeys = [];
    this.bodyKeys = [];
    this.bodyFull = [];
    this.heldSpecial = null;
    this.lastAim.clear();
    this.trailAt = 0;
    this.lastShakeAt = 0;
  }

  /** 이번 판에 쓰는 그림 키 */
  private artKeys(): string[] {
    // 바닥: 지역 바닥 그림(floor-rNN)을 받으면 옛 4종(tile-*)은 받지 않는다 (못 읽었을 때만 판이 열린 뒤 받는다)
    const floors = hasArt(floorOf(this.region)) ? [] : [this.ground, ...this.grounds];
    const keys = new Set<string>([...floors, 'fx-pop', 'fx-coin', 'p-shuriken']);
    for (const k of this.foeArts()) keys.add(k);
    return [...keys];
  }

  /** 이번 판에 나오는 요괴 그림 (부하로 불려 나오는 요괴까지) */
  private foeArts(): string[] {
    const keys = new Set<string>();
    for (const w of this.run.cfg.waves)
      for (const f of w) {
        keys.add(f.art);
        if (f.summon) keys.add(f.summon.art);
      }
    return [...keys];
  }

  /** 판을 열 때 받을 전용 그림 (artlist.ts 의 ART_FILES 에 적힌 것만. 컷인 · 탑의 다음 지역 바닥은 fetchArt 로 나중에) */
  private optionalArt(): OptionalArt[] {
    const grounds = [this.ground, ...this.grounds].map((g) => g.slice(5) as GroundName);
    // 끝없는 탑은 보스 12종이 다 나올 수 있어 보스 맞는 표정은 그 보스가 나올 때 받는다 (drawFoes)
    const foes = this.grounds.length ? this.foeArts().filter((a) => !a.startsWith('b-')) : this.foeArts();
    return artFor(this.run.heroes.map((h) => h.id), foes, grounds, [this.region]);
  }

  /**
   * 판이 열린 뒤 그림 하나를 받는다 (Phaser 로더를 다시 돌린다). 이미 있으면 done 을 바로 부른다.
   * 못 받으면 done 을 부르지 않는다 — 부르는 쪽은 그동안 대체 그림을 쓴다.
   */
  private fetchArt(key: string, done?: () => void) {
    if (this.textures.exists(key)) {
      done?.();
      return;
    }
    const waiting = this.lazy.get(key);
    if (waiting) {
      if (done) waiting.push(done);
      return;
    }
    this.lazy.set(key, done ? [done] : []);
    this.load.image(key, artUrl(key));
    if (!this.load.isLoading()) this.load.start();
  }

  /** 판이 열린 뒤 받은 그림을 텍스처에서 뺀다 (다음에 쓸 때 fetchArt 가 다시 받는다) */
  private dropArt(key: string) {
    const waiting = this.lazy.get(key);
    if (!waiting || waiting.length || !this.textures.exists(key)) return;
    this.lazy.delete(key);
    this.textures.remove(key);
  }

  /** 필살기 컷인: 게이지가 CUT_AHEAD 턴 안으로 남았거나 필살기를 쓸 때 그 대원 것만 받는다 */
  private wantCut(id: string) {
    const key = `cut-${id}` as OptionalArt;
    if (hasArt(key)) this.fetchArt(key);
  }

  /** 바닥 그림을 바꾼다. 지역 바닥(320px)은 1:1, 옛 바닥(512px)·코드 그림은 반으로 (TileSprite 가 반 크기 × 2배라서 ×0.5 · ×0.25) */
  private setFloor(key: string) {
    if (!this.textures.exists(key) || key === this.floorKey) return;
    const old = this.floorKey;
    this.floorKey = key;
    this.tile.setTexture(key);
    this.tile.tileScaleX = this.tile.tileScaleY = key.startsWith('floor-') ? 0.5 : 0.25;
    // 끝없는 탑: 지나간 지역의 바닥은 텍스처에서 뺀다 (아이폰 메모리. 다시 쓰면 fetchArt 가 다시 받는다)
    if (old.startsWith('floor-') && this.textures.exists(old)) {
      this.lazy.delete(old);
      this.textures.remove(old);
    }
  }

  /** 지역의 바닥을 깐다: 지역 바닥 그림 → 없거나 못 받았으면 옛 4종 바닥(tile-*) → 그것도 없으면 코드 그림 */
  private showFloor(region: number, ground: string) {
    this.floorWant = [region, ground];
    const floor = floorOf(region);
    const want = () => this.floorWant[0] === region;
    if (hasArt(floor) && !this.failed.has(floor)) {
      if (this.textures.exists(floor)) return this.setFloor(floor);
      this.fetchArt(floor, () => want() && this.setFloor(floor));
      if (this.floorKey !== FLOOR_CODE) return; // 받는 동안은 지금 바닥 그대로
    }
    if (this.textures.exists(ground)) return this.setFloor(ground);
    if (!this.failed.has(ground)) this.fetchArt(ground, () => want() && !this.floorKey.startsWith('floor-') && this.setFloor(ground));
  }

  /** 전용 그림이 목록에 있고 실제로 읽혔나 (못 읽었으면 코드 그림·있는 그림으로) */
  private has(name: OptionalArt): boolean {
    return hasArt(name) && this.textures.exists(name);
  }

  preload() {
    for (const k of this.artKeys()) this.load.image(k, artUrl(k));
    for (const k of this.optionalArt()) this.load.image(k, artUrl(k));
    for (const h of this.run.heroes) {
      this.load.image(`face-${h.id}`, zodiacFaceUrl(h.id));
      this.load.image(`full-${h.id}`, zodiacFullUrl(h.id));
    }
  }

  create() {
    ensureArt(this, this.artKeys());
    // 판이 열린 뒤 받는 그림이 도착하면 기다리던 쪽을 부른다
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
      const cbs = this.lazy.get(key);
      if (!cbs || !this.sys.isActive()) return;
      this.lazy.set(key, []);
      for (const f of cbs) f();
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (!this.lazy.has(file.key) || !this.sys.isActive()) return;
      this.failed.add(file.key);
      // 지역 바닥을 못 받았으면 옛 바닥으로
      if (file.key.startsWith('floor-')) this.showFloor(...this.floorWant);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // 판을 닫을 때: 받는 중인 것은 버리고, 나중에 받은 그림(컷인 · 바닥)은 텍스처에서 뺀다
      this.load.off(Phaser.Loader.Events.FILE_COMPLETE);
      this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR);
      this.load.reset();
      for (const k of this.lazy.keys()) if (this.textures.exists(k)) this.textures.remove(k);
      this.lazy.clear();
    });
    ensureFxArt(this);
    const s = this.run;
    const { w, h } = s.cfg;
    this.efx = new Fx(this, RX, RY, w, h);
    // 개발용 배속(?speed=)이면 효과도 같이 빨라진다
    this.tweens.timeScale = DEV_SPEED;
    // 바닥 · 벽 · 장애물 (끝없는 탑은 층이 바뀌면 다시 그린다).
    // TileSprite 는 보이는 크기만큼 캔버스를 만든다 → 반 크기로 만들고 2배로 늘인다 (아이폰 메모리)
    // 처음 깔 바닥: 지역 바닥 그림이 읽혔으면 그것, 아니면 옛 바닥(못 읽었으면 그것도 판이 열린 뒤 받는다)
    const first = this.textures.exists(floorOf(this.region)) ? floorOf(this.region) : this.textures.exists(this.ground) ? this.ground : FLOOR_CODE;
    ensureArt(this, [FLOOR_CODE]);
    this.tile = this.add.tileSprite(RX + w / 2, RY + h / 2, w / 2, h / 2, first).setScale(2).setDepth(-20);
    this.floorKey = first;
    this.tile.tileScaleX = this.tile.tileScaleY = this.floorKey.startsWith('floor-') ? 0.5 : 0.25;
    this.roomG = this.add.graphics().setDepth(-8);
    this.drawRoom();
    this.floor = this.add.graphics().setDepth(-5);
    this.footG = this.add.graphics().setDepth(470);
    this.fx = this.add.graphics().setDepth(800);
    this.aimG = this.add.graphics().setDepth(900);
    this.barG = this.add.graphics().setDepth(1000);

    // 대원: 판 위는 전신 그림, 아래 파티 줄은 구슬
    s.heroes.forEach((hero, i) => {
      // 구슬: 구슬형 대원 그림(h-<id>)이 있으면 그것, 없으면 얼굴을 동그랗게 잘라 만든 구슬
      const own = `h-${hero.id}` as const;
      if (this.has(own)) this.ballKeys[i] = own;
      else {
        makeBall(this, `ball-${hero.id}`, `face-${hero.id}`, ringOf(hero.type), HEROES[hero.id].name.slice(0, 1));
        this.ballKeys[i] = `ball-${hero.id}`;
      }
      // 판 위: 십이지 전신 그림. 못 읽었으면 구슬로 대신
      const full = `full-${hero.id}`;
      this.bodyFull[i] = this.textures.exists(full);
      this.bodyKeys[i] = this.bodyFull[i] ? full : this.ballKeys[i];
      this.heroImgs[i] = this.add.image(0, 0, this.bodyKeys[i]).setDepth(500);
      this.heroIcons[i] = HERO_ICONS.map(([key, tint]) => this.add.image(0, 0, key).setTint(tint).setDisplaySize(26, 26).setDepth(520).setVisible(false));
      const slotImg = this.add.image(i * SLOT_W + 44, BAR_Y + 58, this.ballKeys[i]).setDisplaySize(64, 64).setDepth(1001);
      const name = this.add
        .text(i * SLOT_W + 82, BAR_Y + 22, HEROES[hero.id].name, { fontFamily: FONT, fontSize: '24px', color: css(COLOR.outline) })
        .setOrigin(0, 0.5)
        .setDepth(1001);
      this.slots.push({ img: slotImg, name });
    });
    this.spText = this.add
      .text(SP_X + SP_W / 2, BAR_Y + 70, '필살기', { fontFamily: FONT, fontSize: '24px', color: css(COLOR.outline), align: 'center' })
      .setOrigin(0.5)
      .setDepth(1002);
    this.hintText = this.add
      .text(0, 0, '힌트', { fontFamily: FONT, fontSize: '26px', color: HEX.white, stroke: css(COLOR.outline), strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(901)
      .setVisible(false);

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

  /** 방 그림: 테두리 · 돌기둥 · 장애물 (지금 방이 바뀌었을 때만 다시 그린다) */
  private drawRoom() {
    const room = this.run.room;
    if (room === this.roomShown) return;
    this.roomShown = room;
    const { w, h } = this.run.cfg;
    const g = this.roomG.clear();
    for (const o of this.roomObjs) o.destroy();
    this.roomObjs = [];
    this.portalImgs = [];
    // 바닥: 스테이지는 그 지역, 끝없는 탑은 방을 가져온 지역의 바닥 (다음 지역 바닥은 그때 받는다)
    let ground = this.ground;
    let region = this.region;
    if (this.grounds.length && room.region) {
      ground = `tile-${groundOf(room.region)}`;
      region = room.region;
    }
    this.showFloor(region, ground);
    // 바닥 위쪽 가장자리의 옅은 그늘 (벽 두께)
    g.fillStyle(COLOR.outline, 0.16).fillRect(RX, RY, w, 10);
    const wall = `wall-${ground.slice(5) as GroundName}` as const;
    if (this.has(wall)) {
      // 전용 방 테두리: 그림 파일은 화면의 2배, 벽 안쪽 선(WALL_INSET)이 방 가장자리에 오게 바깥으로 둘러 9칸을 이어 붙인다
      const o = WALL_INSET / 2;
      this.roomObjs.push(tiled9(this, wall, ART_SLICE[wall]!, SLICE_GAP, RX - o, RY - o, w + o * 2, h + o * 2, 0.5, true).setDepth(-7));
    } else {
      // 코드 그림: 굵은 갈색 외곽선 + 나무 띠 + 밝은 줄 + 모서리 못
      g.lineStyle(22, COLOR.outline, 1).strokeRoundedRect(RX - 11, RY - 11, w + 22, h + 22, 16);
      g.lineStyle(12, COLOR.inkSoft, 1).strokeRoundedRect(RX - 11, RY - 11, w + 22, h + 22, 14);
      g.lineStyle(3, COLOR.emptyLine, 1).strokeRoundedRect(RX - 14, RY - 14, w + 28, h + 28, 16);
      for (const [cx, cy] of [[RX - 11, RY - 11], [RX + w + 11, RY - 11], [RX - 11, RY + h + 11], [RX + w + 11, RY + h + 11]]) {
        g.fillStyle(COLOR.outline, 1).fillCircle(cx, cy, 10);
        g.fillStyle(COLOR.primary, 1).fillCircle(cx, cy, 6.5);
      }
    }
    // 네모 돌기둥 (방 테두리 4개 다음부터 4개씩)
    for (let i = 4; i + 3 < room.walls.length; i += 4) {
      const [x0, y0] = room.walls[i];
      const [x1, y1] = room.walls[i + 1].slice(2);
      const bw = x1 - x0;
      const bh = y1 - y0;
      const X = RX + x0;
      const Y = RY + y0;
      if (this.has('o-block')) {
        this.roomObjs.push(tiled9(this, 'o-block', ART_SLICE['o-block']!, SLICE_GAP, X, Y, bw, bh, 0.5, false).setDepth(-7));
        continue;
      }
      // 돌: 어두운 옆면 위에 밝은 윗면 (아래쪽 두께로 입체감)
      const side = Math.min(14, bh * 0.28);
      g.fillStyle(COLOR.outline, 1).fillRoundedRect(X, Y, bw, bh, 9);
      g.fillStyle(COLOR.inkSoft, 1).fillRoundedRect(X + 4, Y + 4, bw - 8, bh - 8, 6);
      g.fillStyle(COLOR.emptyLine, 1).fillRoundedRect(X + 4, Y + 4, bw - 8, bh - 8 - side, 6);
      g.fillStyle(COLOR.lineSoft, 1).fillRoundedRect(X + 10, Y + 9, Math.max(6, bw - 20), 6, 3);
      // 돌 이음매
      g.lineStyle(3, COLOR.inkSoft, 0.55);
      if (bw >= bh) for (let xx = X + 44; xx < X + bw - 20; xx += 56) g.lineBetween(xx, Y + 20, xx, Y + bh - side - 8);
      else for (let yy = Y + 48; yy < Y + bh - side - 16; yy += 56) g.lineBetween(X + 12, yy, X + bw - 12, yy);
    }
    this.drawObstacles(g, room);
  }

  /** 장애물: 가시밭 · 빨래판 · 둥근 돌기둥 · 순간이동 구멍. 전용 그림(o-*)이 있으면 그것, 없으면 코드 그림 */
  private drawObstacles(g: Phaser.GameObjects.Graphics, cfg: Room) {
    for (const z of cfg.zones ?? []) {
      const x = RX + z.x;
      const y = RY + z.y;
      const art = z.k === 'thorn' ? 'o-thorn' : 'o-board';
      if (this.has(art)) {
        this.roomObjs.push(tiled9(this, art, ART_SLICE[art]!, SLICE_GAP, x, y, z.w, z.h, 0.5, false).setDepth(-7));
        continue;
      }
      if (z.k === 'thorn') {
        // 가시밭: 초록 덤불 + 크림색 가시
        g.fillStyle(COLOR.outline, 0.85).fillRoundedRect(x, y, z.w, z.h, 14);
        g.fillStyle(COLOR.win, 1).fillRoundedRect(x + 4, y + 4, z.w - 8, z.h - 8, 11);
        g.fillStyle(MATGO.matDark, 1).fillRoundedRect(x + 4, y + z.h * 0.55, z.w - 8, z.h * 0.45 - 4, 11);
        for (let yy = y + 20, row = 0; yy < y + z.h - 8; yy += 26, row++)
          for (let xx = x + 18 + (row % 2 ? 13 : 0); xx < x + z.w - 12; xx += 26) {
            g.fillStyle(COLOR.outline, 1).fillTriangle(xx - 9, yy + 8, xx + 9, yy + 8, xx, yy - 11);
            g.fillStyle(COLOR.panel, 1).fillTriangle(xx - 5, yy + 5, xx + 5, yy + 5, xx, yy - 6);
          }
      } else {
        // 빨래판: 나무 틀 + 가로 골
        g.fillStyle(COLOR.outline, 1).fillRoundedRect(x, y, z.w, z.h, 10);
        g.fillStyle(COLOR.inkSoft, 1).fillRoundedRect(x + 4, y + 4, z.w - 8, z.h - 8, 7);
        g.fillStyle(COLOR.lineSoft, 1).fillRoundedRect(x + 10, y + 10, z.w - 20, z.h - 20, 5);
        g.fillStyle(COLOR.emptyLine, 1);
        if (z.w >= z.h) for (let xx = x + 16; xx < x + z.w - 18; xx += 14) g.fillRoundedRect(xx, y + 13, 7, z.h - 26, 3);
        else for (let yy = y + 16; yy < y + z.h - 18; yy += 14) g.fillRoundedRect(x + 13, yy, z.w - 26, 7, 3);
      }
    }
    for (const [px, py, pr] of cfg.pillars ?? []) {
      if (this.has('o-pillar')) {
        this.roomObjs.push(this.add.image(RX + px, RY + py, 'o-pillar').setDisplaySize(pr * 2, pr * 2).setDepth(-7));
        continue;
      }
      g.fillStyle(COLOR.outline, 1).fillCircle(RX + px, RY + py, pr);
      g.fillStyle(COLOR.inkSoft, 1).fillCircle(RX + px, RY + py, pr - 4);
      g.fillStyle(COLOR.emptyLine, 1).fillCircle(RX + px, RY + py - pr * 0.12, pr * 0.8);
      g.fillStyle(COLOR.lineSoft, 1).fillCircle(RX + px - pr * 0.22, RY + py - pr * 0.36, pr * 0.24);
    }
    (cfg.portals ?? []).forEach((p, k) => {
      const color = k % 2 ? COLOR.pink : COLOR.teamA;
      for (const [x, y] of [
        [p[0], p[1]],
        [p[2], p[3]],
      ]) {
        if (this.has('o-portal')) {
          const img = this.add.image(RX + x, RY + y, 'o-portal').setTint(color).setDisplaySize(PORTAL_R * 2.2, PORTAL_R * 2.2).setDepth(-7);
          this.roomObjs.push(img);
          this.portalImgs.push(img);
          continue;
        }
        g.fillStyle(COLOR.outline, 1).fillCircle(RX + x, RY + y, PORTAL_R + 3);
        g.fillStyle(color, 1).fillCircle(RX + x, RY + y, PORTAL_R - 2);
        g.fillStyle(COLOR.outline, 0.9).fillCircle(RX + x, RY + y, PORTAL_R - 9);
        // 도는 소용돌이 (그림 하나를 돌린다)
        const img = this.add.image(RX + x, RY + y, G.swirl).setTint(color).setDisplaySize(PORTAL_R * 1.5, PORTAL_R * 1.5).setDepth(-7);
        this.roomObjs.push(img);
        this.portalImgs.push(img);
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
    this.hooks.sound(this.armed ? 'toggle' : 'click');
    // 힌트는 필살기를 켠 수 · 끈 수가 다르다: 보여 주던(계산하던) 힌트를 지금 상태로 다시 고른다 (횟수는 더 쓰지 않는다)
    if (this.hint || this.hintJob) {
      this.hint = null;
      this.hintPts = [];
      this.hintJob = hintSearch(this.run, this.armed ? 1 : 0);
    }
  }

  /** 힌트 상태 (HUD 버튼): 쓸 수 있음 · 계산 중 · 보여 주는 중 · 지금은 못 씀(날아가는 중 등) */
  get hintState(): 'ready' | 'thinking' | 'shown' | 'off' {
    if (this.mode !== 'aim' || DEV_AUTO) return 'off';
    return this.hintJob ? 'thinking' : this.hint ? 'shown' : 'ready';
  }

  /** 힌트 한 수를 청한다: 자동 조종이 고른 조준선을 이번 차례 동안 보여 준다 (쏘지는 않는다). 시작했으면 true */
  requestHint(): boolean {
    if (this.paused || this.hintState !== 'ready') return false;
    this.hintJob = hintSearch(this.run, this.armed && canSpecial(this.run) ? 1 : 0);
    return true;
  }

  /** 힌트 계산을 화면 한 장에 조금씩 (HINT_SLICE_MS) */
  private hintStep() {
    const got = this.hintJob?.step();
    if (!got) return;
    this.hintJob = null;
    this.hint = got;
    this.hintPts = hintPath(this.run, got);
    this.hooks.sound('toggle');
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
    // touchcancel 도 pointerup 으로 온다 (전화·알림 등): 쏘지 않고 조준만 취소
    if (p.wasCanceled) return;
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
    this.hintJob = null;
    this.hint = null;
    this.mode = 'fly';
    this.acc = 0;
    const k = ev.findIndex((e) => e.t === 'special');
    if (k >= 0) {
      // 필살기: 컷인이 지나간 뒤에 그 효과(피해 숫자 · 회복 등)를 보여 준다
      this.handle(ev.slice(0, k + 1));
      this.held = ev.slice(k + 1);
    } else this.handle(ev);
  }

  /** 컷인이 끝났다: 미뤄 둔 필살기 효과를 보여 준다 */
  private release() {
    const sp = this.heldSpecial;
    const ev = this.held;
    this.heldSpecial = null;
    this.held = [];
    if (sp) this.specialFx(sp);
    if (ev.length) this.handle(ev);
  }

  update(time: number, deltaMs: number) {
    const s = this.run;
    if (!this.paused) {
      if (this.mode === 'aim' && DEV_AUTO) this.autoStep(time);
      if (this.mode === 'aim' && this.hintJob) this.hintStep();
      if (this.mode === 'fly' && time < this.holdUntil) {
        // 필살기 컷인이 지나가는 중
      } else if (this.mode === 'fly') {
        if (this.heldSpecial || this.held.length) this.release();
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
      this.endAt = time + (s.phase === 'clear' ? 1500 : 1200) / DEV_SPEED;
    } else {
      this.mode = 'aim';
      this.announce();
    }
  }

  // ---------- 이벤트 → 소리 · 효과 · 진동 ----------

  /** 약한 화면 흔들림 (세기는 0.006 까지, 0.2초에 한 번) */
  private quake(strength: number, ms = 140) {
    const now = this.time.now;
    if (now - this.lastShakeAt < 200) return;
    this.lastShakeAt = now;
    this.cameras.main.shake(ms, Math.min(0.006, strength));
  }

  /** 전용 효과 그림이 있으면 그것(물들이지 않음), 없으면 흰 코드 그림 + 색 */
  /** 레이저 그림: 세로는 파랑(fx-laser-v), 가로는 분홍(fx-laser). 없으면 코드 줄 */
  private laserArt(vertical: boolean): string | undefined {
    const k = vertical ? 'fx-laser-v' : 'fx-laser';
    return this.has(k) ? k : undefined;
  }

  private fxKey(art: OptionalArt, fallback: string, tint: number): [string, number | null] {
    return this.has(art) ? [art, null] : [fallback, tint];
  }

  /** 요괴가 맞았다: 잠깐 하얗게 · 커졌다 돌아옴 · 흔들림 (맞는 표정 그림이 있으면 그 그림으로) */
  private hitFoe(id: number, weak: boolean) {
    const v = this.foeViews.get(id);
    if (!v) return;
    v.img.setData('hitUntil', this.time.now + (weak ? 240 : 160));
    this.shake(v.img);
  }

  /** 이번 발사에서 이어진 튕김·타격: 소리가 한 음씩 높아진다 */
  private chainSound(name: string, volume: number, mul = 1) {
    this.chain++;
    this.hooks.sound(name, { rate: chainRate(this.chain) * mul, volume });
  }

  private handle(ev: SimEvent[]) {
    const fx = this.efx;
    for (const e of ev) {
      switch (e.t) {
        case 'shot':
          this.chain = 0;
          this.hooks.sound('volleyServe', { rate: 0.8 + e.p / 200, volume: 0.8 });
          break;
        case 'wall':
          this.chainSound('volleyWall', 0.6, 0.8);
          fx.ring(e.x, e.y, 26, COLOR.white, 220, 0.4);
          fx.burst(e.x, e.y, G.dot, COLOR.white, 3, 30, 10, 220);
          break;
        case 'hit': {
          this.chainSound('survPop', 1, e.weak ? 1.5 : 1);
          if (e.weak) this.hooks.sound('chip', { volume: 0.9 });
          fx.pop(e.x, e.y, e.weak ? 110 : 64);
          if (e.weak) {
            fx.burst(e.x, e.y, G.star, COLOR.primary, 5, 70, 26, 360);
            fx.text(e.x, e.y - 34, `${e.dmg}`, HEX.pink, 50, true);
            fx.text(e.x, e.y - 86, '약점!', HEX.primary, 30);
          } else {
            fx.text(e.x, e.y - 30, `${e.dmg}`, e.shield ? HEX.sky : HEX.white, e.shield ? 26 : 32);
            if (e.shield) fx.text(e.x, e.y - 66, '방패!', HEX.sky, 24);
          }
          this.hitFoe(e.id, e.weak);
          this.buzz(e.weak ? 22 : 10);
          break;
        }
        case 'down':
          this.hooks.sound('survSlash', { rate: 0.8 });
          fx.pop(e.x, e.y, 80);
          fx.text(e.x, e.y - 50, '다시 일어나요…', HEX.soft, 24);
          break;
        case 'rise':
          this.hooks.sound('survLevel', { rate: 0.8 });
          fx.ring(e.x, e.y, 70, COLOR.lose, 420);
          fx.text(e.x, e.y - 50, '되살아났다!', HEX.lose, 30);
          break;
        case 'spawn': {
          this.hooks.sound('survPop', { rate: 0.7 });
          for (const id of e.kids) {
            const f = this.run.foes.find((x) => x.id === id);
            if (f) {
              fx.pop(f.x, f.y, 60);
              fx.ring(f.x, f.y, f.r + 18, COLOR.white, 300);
            }
          }
          const f = this.run.foes.find((x) => x.id === e.id);
          if (f && e.why === 'summon') fx.text(f.x, f.y - f.r - 20, '부하를 불렀다!', HEX.primary, 26);
          break;
        }
        case 'foeHeal': {
          this.hooks.sound('tankHeal', { rate: 0.8 });
          const [key, tint] = this.fxKey('fx-heal', G.plus, COLOR.lose);
          for (const h of e.heals) {
            const f = this.run.foes.find((x) => x.id === h.id);
            if (!f) continue;
            fx.text(f.x, f.y - 30, `+${h.v}`, HEX.win, 26);
            fx.rise(f.x + f.r * 0.4, f.y, key, tint, 28);
          }
          break;
        }
        case 'hide': {
          const f = this.run.foes.find((x) => x.id === e.id);
          if (f) {
            this.hooks.sound('mud', { volume: 0.5, rate: 1.3 });
            fx.ring(f.x, f.y, f.r + 20, COLOR.skyMid, 420);
            fx.burst(f.x, f.y, G.drop, COLOR.skyMid, 4, f.r + 20, 18, 380);
            fx.text(f.x, f.y - 40, e.hidden ? '숨었다' : '나왔다', HEX.sky, 24);
          }
          break;
        }
        case 'debuff': {
          const h = this.run.heroes[e.hero];
          fx.text(h.x, h.y - 70, DEBUFF_NAMES[e.kind], HEX.pink, 24);
          break;
        }
        case 'tick': {
          const h = this.run.heroes[e.hero];
          fx.text(h.x, h.y - 40, `-${e.dmg}`, e.kind === 'fire' ? HEX.accent : HEX.win, 26);
          if (e.kind === 'poison') fx.rise(h.x, h.y - 10, G.bubble, COLOR.win, 24, 36, 480);
          else fx.burst(h.x, h.y, G.dot, COLOR.accent, 4, 40, 12, 300);
          this.shake(this.heroImgs[e.hero]);
          break;
        }
        case 'skip': {
          const h = this.run.heroes[e.hero];
          fx.text(h.x, h.y - 40, '얼어서 쉼', HEX.sky, 26);
          break;
        }
        case 'cleanse':
          for (const i of e.heroes) {
            const h = this.run.heroes[i];
            fx.text(h.x, h.y - 60, '깨끗!', HEX.white, 24);
            fx.burst(h.x, h.y, G.star, COLOR.white, 4, 50, 18, 360);
          }
          break;
        case 'thorn':
          this.hooks.sound('survHurt', { volume: 0.4, rate: 1.4 });
          fx.text(e.x, e.y - 40, `-${e.dmg}`, HEX.lose, 24);
          fx.burst(e.x, e.y, G.fang, COLOR.panel, 3, 34, 14, 260);
          this.buzz(12);
          break;
        case 'board':
          this.hooks.sound('slide', { rate: 1.3, volume: 0.6 });
          fx.burst(e.x, e.y, G.dot, COLOR.lineSoft, 4, 34, 12, 260);
          break;
        case 'warp':
          this.hooks.sound('boost', { rate: 1.3, volume: 0.6 });
          fx.ring(e.x0, e.y0, PORTAL_R + 20, COLOR.white, 320, 1.2);
          fx.ring(e.x1, e.y1, PORTAL_R + 26, COLOR.white, 320);
          fx.burst(e.x1, e.y1, G.dot, COLOR.white, 5, 50, 12, 300);
          break;
        case 'kill': {
          const boss = this.run.foes.find((x) => x.id === e.id)?.rank === 2;
          this.hooks.sound(boss ? 'survBossDown' : 'survSlash');
          fx.pop(e.x, e.y, boss ? 220 : 110);
          fx.burst(e.x, e.y, G.dot, COLOR.white, boss ? 10 : 5, boss ? 130 : 60, boss ? 22 : 14, boss ? 520 : 320);
          if (boss) {
            fx.burst(e.x, e.y, G.star, COLOR.primary, 8, 170, 34, 620);
            fx.ring(e.x, e.y, 200, COLOR.primary, 520);
            this.quake(0.006, 260);
          }
          this.buzz(boss ? 45 : 22);
          break;
        }
        case 'drop':
          fx.ring(e.x, e.y, 34, e.kind === 'heal' ? COLOR.win : COLOR.primary, 360);
          break;
        case 'combo':
          this.combo(e);
          break;
        case 'special': {
          const h = this.run.heroes[e.hero];
          const d = HEROES[h.id];
          this.hooks.sound('cutin');
          const cut = `cut-${h.id}` as const;
          // 아직 못 받았으면 이번에는 얼굴 그림 컷인, 다음부터 그림 컷인
          this.wantCut(h.id);
          const [title, desc] = d.specialName.includes(': ') ? d.specialName.split(': ') : [d.specialName, ''];
          // 컷인이 지나가 지워지면 그 그림은 텍스처에서 뺀다 (게이지가 다시 차 가면 브라우저 캐시에서 다시 받는다)
          const ms = fx.cutin(this.has(cut) ? cut : `face-${h.id}`, this.has(cut), d.name, title, desc, ringOf(h.type), () => this.dropArt(cut));
          // 컷인이 지나가는 동안 발사를 멈춘다 (화면만 — 판 계산은 이미 끝났다)
          this.holdUntil = this.time.now + ms / DEV_SPEED;
          this.heldSpecial = e;
          this.buzz(30);
          break;
        }
        case 'dash': {
          this.hooks.sound('boost');
          const m = this.run.movers[0];
          if (m) fx.ring(m.x, m.y, m.r + 40, COLOR.primary, 300);
          break;
        }
        case 'pounce': {
          // 고양이 덮치기: 노린 요괴까지 가는 길을 잠깐 긋고, 멈췄던 자리에 고리
          this.hooks.sound('jump', { rate: 1.5 });
          fx.ring(e.x, e.y, 70, COLOR.primary, 300);
          fx.beam(e.x, e.y, e.tx, e.ty, 6, COLOR.white, 220);
          fx.text(e.x, e.y - 56, '덮치기!', HEX.primary, 26);
          break;
        }
        case 'revive': {
          const h = this.run.heroes[e.hero];
          this.shownHp[e.hero] = h.hp;
          this.hooks.sound('survChest');
          fx.ring(h.x, h.y, h.r + 40, COLOR.primary, 460);
          fx.burst(h.x, h.y, G.star, COLOR.primary, 6, 70, 22, 460);
          fx.text(h.x, h.y - 40, '일어났다!', HEX.primary, 30);
          break;
        }
        case 'heal': {
          const h = this.run.heroes[e.hero];
          fx.text(h.x, h.y - 30, `+${e.v}`, HEX.win, 26);
          break;
        }
        case 'pick': {
          this.hooks.sound(e.kind === 'heal' ? 'tankHeal' : 'coin');
          fx.text(e.x, e.y - 20, e.kind === 'heal' ? `+${e.v}` : `엽전 +${e.v}`, e.kind === 'heal' ? HEX.win : HEX.accent, 28);
          if (e.kind === 'heal') {
            const [key, tint] = this.fxKey('fx-heal', G.plus, COLOR.win);
            fx.rise(e.x, e.y, key, tint, 34);
          } else fx.burst(e.x, e.y, 'fx-coin', null, 4, 46, 22, 380);
          break;
        }
        case 'attack': {
          this.hooks.sound('survHurt');
          const f = this.run.foes.find((x) => x.id === e.id);
          this.lastAim.delete(e.id);
          if (e.kind === 'area') {
            const spots = e.x2 !== undefined && e.y2 !== undefined ? [[e.x, e.y], [e.x2, e.y2]] : [[e.x, e.y]];
            for (const [ax, ay] of spots) {
              fx.disc(ax, ay, e.area, COLOR.lose, 0.55, 460);
              fx.ring(ax, ay, e.area * 1.15, COLOR.white, 380, 0.5);
              fx.pop(ax, ay, e.area * 1.1);
              fx.burst(ax, ay, G.dot, COLOR.lose, 6, e.area, 16, 380);
            }
            this.hooks.sound('tankBoom', { volume: 0.5, rate: 1.2 });
            this.quake(0.005, 180);
          } else if (e.kind === 'all' && f) {
            fx.ring(f.x, f.y, 420, COLOR.lose, 520, 0.1);
            fx.ring(f.x, f.y, 300, COLOR.white, 520, 0.1, 80);
          }
          for (const hit of e.hits) {
            const h = this.run.heroes[hit.hero];
            fx.text(h.x, h.y - 40, `-${hit.dmg}`, HEX.lose, 32);
            fx.burst(h.x, h.y, G.dot, COLOR.lose, 4, 44, 12, 280);
            this.shake(this.heroImgs[hit.hero]);
            if (f && (e.kind === 'near' || e.kind === 'double')) fx.beam(f.x, f.y, h.x, h.y, 9, COLOR.lose, 300);
          }
          if (e.hits.length) this.buzz(35);
          break;
        }
        case 'fall': {
          const h = this.run.heroes[e.hero];
          this.hooks.sound('volleyMiss');
          const ghost = fx.spawn(this.bodyKeys[e.hero], h.x, h.y, 510);
          if (ghost) {
            ghost.setScale(this.bodyScale(e.hero, h.r, ghost)).setFlipX(this.heroImgs[e.hero].flipX).setTint(COLOR.draw);
            fx.go(ghost, { angle: 200, alpha: 0, scale: ghost.scale * 0.5, y: ghost.y + 20 }, 520);
          }
          fx.text(h.x, h.y - 50, '쓰러졌다…', HEX.soft, 28);
          this.buzz(50);
          break;
        }
        case 'wave':
          this.hooks.sound('survLevel');
          this.lastAim.clear();
          if (this.run.cfg.mode === 'tower') {
            const tf = towerFloor(e.n + 1);
            fx.banner(tf.boss ? `${e.n + 1}층 · 보스!` : `${e.n + 1}층`, tf.boss ? HEX.pink : HEX.primary);
            if (tf.boss) this.hooks.sound('survBossWarn', { volume: 0.6 });
          } else {
            const last = e.n + 1 === this.run.cfg.waves.length;
            fx.banner(last ? '마지막 웨이브!' : `웨이브 ${e.n + 1}`, last ? HEX.pink : HEX.primary);
            if (last) this.hooks.sound('survBossWarn', { volume: 0.6 });
          }
          break;
        case 'clear':
          this.hooks.sound('goal');
          fx.banner('클리어!', HEX.primary, 88, 0);
          fx.confetti();
          this.buzz(40);
          break;
        case 'fail':
          this.hooks.sound('bust');
          fx.dim();
          fx.banner(e.why === 'turns' ? '턴을 다 썼어요' : '모두 쓰러졌어요', HEX.lose, 52, 0);
          break;
        default:
          break;
      }
    }
  }

  /** 필살기 효과 (컷인이 지나간 뒤) */
  private specialFx(e: Extract<SimEvent, { t: 'special' }>) {
    const fx = this.efx;
    const s = this.run;
    const h = s.heroes[e.hero];
    const m = s.movers[0];
    const x = m ? m.x : h.x;
    const y = m ? m.y : h.y;
    const alive = s.heroes.filter((o) => !o.fallen);
    switch (e.kind) {
      case 'swift':
      case 'roll':
      case 'dash':
      case 'pounce':
        this.hooks.sound('boost', { rate: 1.2 });
        fx.ring(x, y, h.r + 60, COLOR.primary, 320);
        fx.burst(x, y, G.dot, COLOR.primary, 6, 70, 14, 320);
        break;
      case 'charge':
        this.hooks.sound('tankFire');
        fx.ring(x, y, h.r * 2 + 50, COLOR.accent, 360);
        fx.ring(x, y, h.r * 2 + 20, COLOR.white, 360, 0.3, 80);
        break;
      case 'clone':
        this.hooks.sound('jump', { rate: 1.4 });
        fx.ring(x, y, h.r + 70, COLOR.teamA, 340);
        fx.burst(x, y, G.star, COLOR.white, 5, 70, 20, 340);
        break;
      case 'roar':
        this.hooks.sound('survBossWarn', { rate: 1.6, volume: 0.8 });
        fx.ring(x, y, 520, COLOR.primary, 560, 0.1);
        fx.ring(x, y, 380, COLOR.white, 560, 0.1, 100);
        for (const f of s.foes) if (f.alive) fx.text(f.x, f.y - f.r - 10, '+1턴', HEX.primary, 26);
        this.quake(0.005, 220);
        break;
      case 'mooncake': {
        this.hooks.sound('tankHeal', { rate: 1.2 });
        const [key, tint] = this.fxKey('fx-heal', G.plus, COLOR.win);
        for (const o of alive) {
          fx.ring(o.x, o.y, o.r + 26, COLOR.win, 460, 0.5);
          fx.rise(o.x, o.y - 6, key, tint, 40);
        }
        break;
      }
      case 'dragonfall':
        this.hooks.sound('tankBigBoom', { volume: 0.6 });
        this.cameras.main.flash(200, 255, 211, 77);
        for (const f of s.foes.filter((o) => o.alive || o.down).slice(0, 6)) fx.beam(f.x, 0, f.x, f.y, 22, COLOR.primary, 360);
        this.quake(0.006, 260);
        break;
      case 'coil':
        this.hooks.sound('slip');
        for (const f of s.foes)
          if (f.alive && f.frozen > 0) {
            fx.ring(f.x, f.y, f.r + 30, COLOR.teamA, 460, 1.6);
            fx.text(f.x, f.y - f.r - 10, '꽁꽁!', HEX.sky, 28);
          }
        break;
      case 'wool': {
        this.hooks.sound('tankBuild', { rate: 1.4 });
        const [key, tint] = this.fxKey('fx-shield', G.shield, COLOR.white);
        for (const o of alive) {
          fx.ring(o.x, o.y, o.r + 24, COLOR.white, 420, 0.5);
          fx.rise(o.x, o.y - 6, key, tint, 40);
        }
        break;
      }
      case 'dawn':
        this.hooks.sound('survChest');
        fx.ring(x, y, 460, COLOR.primaryLight, 560, 0.1);
        for (const o of alive)
          if (o !== h) {
            fx.rise(o.x, o.y - 6, G.star, COLOR.primary, 34);
            fx.text(o.x, o.y - 56, '충전 +2', HEX.primary, 24);
          }
        break;
      case 'hunt':
        this.hooks.sound('survSlash', { rate: 1.3 });
        fx.burst(x, y, G.fang, COLOR.white, 3, 70, 26, 340);
        break;
    }
  }

  /** 날아가는 조각 (방 좌표 → 방 좌표) */
  private fly(key: string, tint: number | null, size: number, x0: number, y0: number, x1: number, y1: number, ms: number, delay = 0, spin = 0) {
    const img = this.efx.spawn(key, x0, y0, 790);
    if (!img) return;
    if (tint !== null) img.setTint(tint);
    img.setScale(size / img.width);
    if (delay) img.setVisible(false);
    this.tweens.add({ targets: img, x: RX + x1, y: RY + y1, angle: spin, duration: ms, delay, onStart: () => img.setVisible(true), onComplete: () => img.destroy() });
  }

  /** 우정 콤보 효과 (콤보마다 다른 그림 · 소리) */
  private combo(e: Extract<SimEvent, { t: 'combo' }>) {
    const fx = this.efx;
    const h = this.run.heroes[e.hero];
    const alive = this.run.heroes.filter((o) => !o.fallen);
    fx.text(h.x, h.y - 50, HEROES[h.id].comboName, HEX.primary, 26);
    fx.ring(h.x, h.y, h.r + 30, COLOR.primary, 300, 0.6);
    this.buzz(14);
    switch (e.kind) {
      case 'shuriken':
        this.hooks.sound('survShot', { rate: 1.2 });
        for (const [x0, y0, x1, y1] of e.lines) {
          fx.beam(x0, y0, x1, y1, 5, COLOR.white, 260);
          this.fly('p-shuriken', null, 40, x0, y0, x1, y1, 220, 0, 720);
        }
        break;
      case 'quake':
        this.hooks.sound('tankBoom', { volume: 0.6, rate: 1.2 });
        fx.disc(e.x, e.y, e.r, COLOR.accent, 0.4, 460);
        fx.ring(e.x, e.y, e.r, COLOR.primary, 420);
        fx.ring(e.x, e.y, e.r * 0.7, COLOR.white, 420, 0.3, 90);
        fx.burst(e.x, e.y, G.rock, COLOR.emptyLine, 6, e.r * 0.85, 20, 440);
        if (this.has('fx-boom')) fx.pop(e.x, e.y, e.r * 1.4, 'fx-boom');
        this.quake(0.004);
        break;
      case 'laserH':
      case 'laserV':
        this.hooks.sound('tankLaser', { volume: 0.7, rate: e.kind === 'laserV' ? 0.85 : 1 });
        for (const [x0, y0, x1, y1] of e.lines) fx.beam(x0, y0, x1, y1, 28, e.kind === 'laserV' ? COLOR.teamA : COLOR.pink, 360, this.laserArt(e.kind === 'laserV'));
        fx.burst(h.x, h.y, G.dot, COLOR.white, 5, 50, 12, 260);
        break;
      case 'heal': {
        this.hooks.sound('tankHeal');
        const [key, tint] = this.fxKey('fx-heal', G.plus, COLOR.win);
        for (const o of alive) {
          fx.ring(o.x, o.y, o.r + 20, COLOR.win, 420, 0.5);
          fx.rise(o.x, o.y - 6, key, tint, 34);
        }
        break;
      }
      case 'poison': {
        this.hooks.sound('mud', { rate: 1.2 });
        const [key, tint] = this.fxKey('fx-poison', G.bubble, COLOR.win);
        fx.disc(e.x, e.y, e.r, COLOR.win, 0.4, 560);
        fx.ring(e.x, e.y, e.r, COLOR.win, 460);
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI * 2 * i) / 6 + 0.4;
          fx.rise(e.x + Math.cos(a) * e.r * 0.55, e.y + Math.sin(a) * e.r * 0.55, key, tint, 26, 40, 520, i * 45);
        }
        break;
      }
      case 'kick':
        this.hooks.sound('volleyHit');
        for (const [x0, y0, x1, y1] of e.lines) {
          fx.beam(x0, y0, x1, y1, 14, COLOR.accent, 260);
          fx.burst(x1, y1, G.star, COLOR.primary, 5, 80, 28, 380);
          fx.ring(x1, y1, 70, COLOR.white, 300);
        }
        this.quake(0.003);
        break;
      case 'guard': {
        this.hooks.sound('tankBuild', { rate: 1.4 });
        const [key, tint] = this.fxKey('fx-shield', G.shield, COLOR.skyMid);
        for (const o of alive) {
          fx.ring(o.x, o.y, o.r + 20, COLOR.white, 420, 0.5);
          fx.rise(o.x, o.y - 6, key, tint, 36, 30);
        }
        break;
      }
      case 'balls': {
        this.hooks.sound('jump', { rate: 1.3 });
        const [key, tint] = this.fxKey('fx-ball', G.ball, COLOR.pink);
        e.lines.forEach(([x0, y0, x1, y1], i) => {
          fx.beam(x0, y0, x1, y1, 4, COLOR.white, 240 + i * 60);
          this.fly(key, tint, 34, x0, y0, x1, y1, 220, i * 60, 360);
        });
        break;
      }
      case 'cleanse':
        this.hooks.sound('volleySpeed', { rate: 1.3 });
        fx.disc(e.x, e.y, e.r, COLOR.white, 0.3, 420);
        fx.ring(e.x, e.y, e.r, COLOR.white, 460);
        fx.ring(e.x, e.y, e.r * 0.8, COLOR.skyMid, 460, 0.3, 100);
        fx.burst(e.x, e.y, G.star, COLOR.white, 8, e.r * 0.8, 22, 460);
        break;
      case 'fang': {
        this.hooks.sound('survSlash', { rate: 1.3 });
        const [key, tint] = this.fxKey('fx-fang', G.fang, COLOR.white);
        for (const [x0, y0, x1, y1] of e.lines) {
          fx.beam(x0, y0, x1, y1, 4, COLOR.white, 220);
          // 위아래 이빨이 두 번 문다
          for (const dir of [-1, 1]) {
            const img = fx.spawn(key, x1, y1 + dir * 46, 790);
            if (!img) break;
            if (tint !== null) img.setTint(tint);
            img.setScale(40 / img.width).setFlipY(dir > 0);
            this.tweens.add({ targets: img, y: RY + y1 + dir * 10, duration: 100, delay: 80, yoyo: true, repeat: 1, onComplete: () => img.destroy() });
          }
        }
        break;
      }
      case 'scratch': {
        // 냥냥 펀치: 노린 요괴에 할퀸 자국 세 줄
        this.hooks.sound('survSlash', { rate: 1.6 });
        for (const [x0, y0, x1, y1] of e.lines) {
          fx.beam(x0, y0, x1, y1, 4, COLOR.white, 200);
          for (let i = 0; i < 3; i++) fx.beam(x1 - 30 + i * 20, y1 - 34, x1 - 10 + i * 20, y1 + 34, 6, COLOR.white, 220 + i * 60);
          fx.burst(x1, y1, G.star, COLOR.primary, 4, 60, 22, 320);
        }
        break;
      }
      case 'coin':
        this.hooks.sound('coin');
        for (let i = 0; i < 3; i++) fx.rise(h.x + (i - 1) * 26, h.y - 10, 'fx-coin', null, 30, 50, 520, i * 70);
        break;
    }
  }

  /** 다음 요괴 차례에 떨어질 큰 공격을 새로 알린다 (조준이 시작될 때 한 번씩) */
  private announce() {
    let fresh = false;
    for (const t of threats(this.run)) {
      if (t.kind !== 'area') continue;
      const key = `${t.x}:${t.y}`;
      const was = this.lastAim.get(t.id) ?? '';
      if (was.includes(key)) continue;
      this.lastAim.set(t.id, `${was}|${key}`);
      fresh = true;
      this.efx.ring(t.x, t.y, t.r, COLOR.lose, 520, 1.5);
      this.efx.text(t.x, t.y - 56, '큰 공격 예고!', HEX.lose, 28);
    }
    if (fresh) this.hooks.sound('survBossWarn', { volume: 0.5, rate: 1.2 });
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
    this.drawRoom();
    this.drawThreats(time);
    this.drawFoes(time);
    this.drawPickups();
    this.drawHeroes(time);
    this.drawClones();
    this.drawAim(time);
    this.drawBar(time);
  }

  /** 큰 공격 예고의 느낌표 (필요한 만큼만 만들어 돌려 쓴다) */
  private warnImg(i: number): Phaser.GameObjects.Image {
    this.warnImgs[i] ??= this.add.image(0, 0, G.warn).setDepth(600);
    return this.warnImgs[i];
  }

  private drawThreats(time: number) {
    const g = this.floor;
    g.clear();
    // 순간이동 구멍 (소용돌이 그림을 돌린다)
    for (const img of this.portalImgs) img.rotation = time / 320;
    // 바닥 불길 (남은 턴)
    for (const f of this.run.fires) {
      const k = 0.3 + 0.1 * Math.sin(time / 90);
      g.fillStyle(COLOR.accent, k).fillCircle(RX + f.x, RY + f.y, f.r);
      g.lineStyle(4, COLOR.pink, 0.8).strokeCircle(RX + f.x, RY + f.y, f.r);
    }
    let warns = 0;
    if (this.mode === 'fly' || this.mode === 'aim' || this.mode === 'wait') {
      const blink = 0.24 + 0.14 * Math.sin(time / 120);
      for (const t of threats(this.run)) {
        if (t.kind === 'area') {
          // 큰 공격이 떨어질 자리: 깜빡이는 빨간 원 + 굵은 두 겹 테두리 + 도는 흰 점선 + 느낌표, 요괴와 점선으로 잇는다
          const cx = RX + t.x;
          const cy = RY + t.y;
          const f = this.run.foes.find((x) => x.id === t.id);
          if (f) {
            g.lineStyle(4, COLOR.lose, 0.6);
            dashed(g, RX + f.x, RY + f.y, cx, cy, 10, 12);
          }
          g.fillStyle(COLOR.lose, blink).fillCircle(cx, cy, t.r);
          g.lineStyle(10, COLOR.outline, 0.85).strokeCircle(cx, cy, t.r);
          g.lineStyle(5, COLOR.lose, 1).strokeCircle(cx, cy, t.r);
          g.lineStyle(4, COLOR.white, 0.9);
          const a0 = time / 600;
          for (let k = 0; k < 8; k++) {
            g.beginPath();
            g.arc(cx, cy, Math.max(8, t.r - 14), a0 + (k * Math.PI) / 4, a0 + (k * Math.PI) / 4 + 0.42);
            g.strokePath();
          }
          const size = Math.min(72, Math.max(40, t.r * 0.55)) * (1 + 0.08 * Math.sin(time / 130));
          // 원 위쪽 가장자리에 (대원·요괴에 가리지 않게 맨 위에 그린다)
          this.warnImg(warns++).setVisible(true).setPosition(cx, Math.max(RY + 30, cy - t.r)).setDisplaySize(size, size);
        } else if ((t.kind === 'near' || t.kind === 'double') && t.hero !== null) {
          const h = this.run.heroes[t.hero];
          g.lineStyle(3, COLOR.lose, 0.55);
          dashed(g, RX + t.x, RY + t.y, RX + h.x, RY + h.y, 12, 10);
        } else if (t.kind === 'all') {
          for (const h of this.run.heroes) if (!h.fallen) g.lineStyle(4, COLOR.lose, blink * 2.2).strokeCircle(RX + h.x, RY + h.y, h.r + 14);
        }
      }
    }
    for (let i = warns; i < this.warnImgs.length; i++) this.warnImgs[i].setVisible(false);
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
        const size = f.r * (f.rank === 2 ? 2.4 : 2.5);
        img.setDisplaySize(size, size);
        const hit = `${f.art}-hit` as const;
        v = {
          img,
          bar: this.add.graphics().setDepth(420),
          num: this.add
            .text(0, 0, '', { fontFamily: FONT, fontSize: f.rank === 2 ? '40px' : '30px', color: css(COLOR.white), stroke: css(COLOR.outline), strokeThickness: 7 })
            .setOrigin(0.5)
            .setDepth(430),
          icons: [],
          base: img.scaleX,
          art: f.art,
          hitArt: this.has(hit) ? hit : null,
        };
        this.foeViews.set(f.id, v);
        // 아직 없는 맞는 표정(끝없는 탑의 보스): 지금 받고, 받기 전에는 하얗게 번쩍
        if (!v.hitArt && hasArt(hit)) {
          const view = v;
          this.fetchArt(hit, () => (view.hitArt = hit));
        }
        img.setAlpha(0);
        this.tweens.add({ targets: img, alpha: 1, duration: 250 });
      }
      const x = RX + f.x + this.shakeOff(v.img, time);
      const y = RY + f.y;
      v.img.setPosition(x, y);
      // 맞은 직후: 잠깐 하얗게 · 살짝 커짐 (맞는 표정 그림이 있으면 그 그림)
      const left = ((v.img.getData('hitUntil') as number | undefined) ?? 0) - time;
      const hot = left > 0;
      v.img.setScale(v.base * (hot ? 1 + 0.14 * Math.min(1, left / 160) : 1));
      const want = hot && v.hitArt ? v.hitArt : v.art;
      if (v.img.texture.key !== want) v.img.setTexture(want);
      if (f.down) v.img.setTint(COLOR.draw);
      else if (hot && left > 110 && !v.hitArt) v.img.setTintFill(COLOR.white);
      else v.img.clearTint();
      // 쓰러져 되살아나기를 기다림 · 물웅덩이에 숨음 (흐리게)
      if (!this.tweens.isTweening(v.img)) v.img.setAlpha(f.down ? 0.3 : f.hidden ? 0.28 : 1);
      v.bar.clear();
      if (f.hidden) {
        v.bar.fillStyle(COLOR.teamA, 0.35).fillEllipse(x, y + f.r * 0.5, f.r * 2.6, f.r * 1.1);
        v.bar.lineStyle(3, COLOR.white, 0.7).strokeEllipse(x, y + f.r * 0.5, f.r * 2.6, f.r * 1.1);
      }
      if (f.down) {
        colorOf(v.num.setText('부활').setPosition(x, y - f.r * 0.9), HEX.lose);
        for (const ic of v.icons) ic.setVisible(false);
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
        v.bar.fillStyle(COLOR.outline, 1).fillCircle(wx, wy, 13 * k + 4);
        v.bar.fillStyle(COLOR.primary, 1).fillCircle(wx, wy, 13 * k);
        v.bar.fillStyle(COLOR.white, 1).fillCircle(wx - 4, wy - 4, 4);
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
      const hard = f.hard > 0 && !!f.traits?.harden;
      if (hard) v.bar.lineStyle(Math.min(10, 2 + f.hard * 1.5), COLOR.draw, 0.9).strokeCircle(x, y, f.r + 2);
      // 상태 아이콘 (오른쪽 위에서 아래로): 방패 · 숨음 · 독 · 단단함
      let n = 0;
      const isz = f.rank === 2 ? 36 : 28;
      const icon = (kind: keyof typeof FOE_ICONS) => {
        const [key, tint] = FOE_ICONS[kind];
        const ic = (v.icons[n] ??= this.add.image(0, 0, key).setDepth(431));
        if (ic.texture.key !== key) ic.setTexture(key);
        ic.setTint(tint).setVisible(true).setDisplaySize(isz, isz).setPosition(x + f.r * 0.78, y - f.r * 0.78 + n * (isz + 2));
        n++;
      };
      if (sh) icon('shield');
      if (f.hidden) icon('hide');
      if (f.poisonTurns > 0) icon('poison');
      if (hard) icon('hard');
      for (let i = n; i < v.icons.length; i++) v.icons[i].setVisible(false);
      // 머리 위 남은 턴 (다음 행동이 공격이 아니면 이름도)
      const act = f.left === 1 ? next.get(f.id) : undefined;
      v.num.setText(f.frozen > 0 ? '멈춤' : act ? `${f.left} ${act}` : String(f.left)).setPosition(x - f.r * 0.7, y - f.r * 0.8);
      colorOf(v.num, f.left <= 1 ? HEX.pink : HEX.white);
    }
    // 필살기 컷인이 지나가는 동안은 쓰러진 요괴도 그대로 둔다 (컷인 뒤에 한꺼번에 터진다)
    if (this.heldSpecial) return;
    for (const [id, v] of this.foeViews) {
      if (seen.has(id)) continue;
      v.bar.destroy();
      v.num.destroy();
      for (const ic of v.icons) ic.destroy();
      this.foeViews.delete(id);
      // 쓰러짐: 하얗게 번쩍이며 작아지고 돌면서 사라진다
      const img = v.img;
      this.tweens.killTweensOf(img);
      img.setTexture(v.hitArt ?? v.art).setTintFill(COLOR.white).setAlpha(0.95);
      const hit = v.hitArt;
      this.tweens.add({
        targets: img,
        scale: v.base * 0.35,
        alpha: 0,
        angle: 40,
        y: img.y - 18,
        duration: 260,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          img.destroy();
          // 판이 열린 뒤 받은 맞는 표정(탑의 보스)은 같은 요괴가 더 없으면 뺀다
          if (hit && ![...this.foeViews.values()].some((o) => o.hitArt === hit)) this.dropArt(hit);
        },
      });
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
        g.fillStyle(COLOR.outline, 1).fillCircle(RX + p.x, RY + p.y, 21);
        g.fillStyle(COLOR.win, 1).fillCircle(RX + p.x, RY + p.y, 17);
        g.fillStyle(COLOR.white, 1).fillRoundedRect(RX + p.x - 10, RY + p.y - 3.5, 20, 7, 2).fillRoundedRect(RX + p.x - 3.5, RY + p.y - 10, 7, 20, 2);
        this.pickViews.set(p.id, g);
      }
    }
    for (const [id, v] of this.pickViews) {
      if (seen.has(id)) continue;
      v.destroy();
      this.pickViews.delete(id);
    }
  }

  /** 대원 그림 배율: 전신 그림은 높이 = 반지름 × BODY_H (가로세로 비율 유지), 구슬은 지름 × 1.05 */
  private bodyScale(hero: number, r: number, img: Phaser.GameObjects.Image): number {
    return this.bodyFull[hero] ? (r * BODY_H) / img.frame.height : (r * 2.1) / img.frame.width;
  }

  private drawHeroes(time: number) {
    const s = this.run;
    const g = this.fx;
    const fg = this.footG;
    g.clear();
    fg.clear();
    s.heroes.forEach((h, i) => {
      const img = this.heroImgs[i];
      const icons = this.heroIcons[i];
      this.shownHp[i] += (h.hp - this.shownHp[i]) * 0.15;
      if (h.fallen) {
        img.setVisible(false);
        for (const ic of icons) ic.setVisible(false);
        return;
      }
      const m = s.movers.find((x) => x.hero === i && !x.clone);
      const x = RX + (m ? m.x : h.x) + this.shakeOff(img, time);
      const y = RY + (m ? m.y : h.y);
      const r = m ? m.r : h.r;
      const full = this.bodyFull[i];
      const base = this.bodyScale(i, r, img);
      // 날아갈 때: 가는 쪽을 보고, 살짝 기울고 늘어난다. 멈추면 똑바로
      const sp = m && !m.stopped ? Math.hypot(m.vx, m.vy) : 0;
      const k = full && m && sp > 0.01 ? Math.min(1, sp / Math.max(1, m.v0 * 0.5)) : 0;
      if (full && m && sp > 0.01 && Math.abs(m.vx) > sp * 0.12) img.setFlipX(m.vx < 0);
      img
        .setVisible(true)
        .setPosition(x, y)
        .setScale(base * (1 - 0.05 * k), base * (1 + 0.07 * k))
        .setAngle(k && m ? (m.vx / sp) * 13 * k : 0)
        .setDepth(500 + y * 0.001);
      // 발밑: 그림자 + 타입 색 타원 (반사형 파랑 · 관통형 주황)
      const fy = y + r * (full ? FOOT_FULL : FOOT_BALL);
      const fw = r * 1.75;
      const fh = r * 0.58;
      const mine = i === s.cur && this.mode === 'aim';
      if (mine) {
        // 이번 차례: 발밑에서 빛나는 타원이 숨 쉬듯 커졌다 작아진다
        const p = 0.5 + 0.5 * Math.sin(time / 140);
        const tint = this.armed ? COLOR.pink : COLOR.primary;
        fg.fillStyle(tint, 0.22 + 0.1 * p).fillEllipse(x, fy, fw * (1.75 + 0.2 * p), fh * (1.75 + 0.2 * p));
        fg.fillStyle(COLOR.outline, 0.55).fillEllipse(x, fy, fw * 1.32 + 8, fh * 1.32 + 6);
        fg.fillStyle(tint, 1).fillEllipse(x, fy, fw * 1.32, fh * 1.32);
      }
      fg.fillStyle(COLOR.outline, mine ? 0.3 : 0.24).fillEllipse(x, fy, fw, fh);
      fg.lineStyle(3, ringOf(h.type), 0.95).strokeEllipse(x, fy, fw, fh);
      if (h.frozen > 0) {
        // 얼음: 발밑 얼음판 + 흰 반짝임
        fg.fillStyle(COLOR.skyMid, 0.85).fillEllipse(x, fy, fw * 1.2, fh * 1.2);
        fg.fillStyle(COLOR.white, 0.85).fillEllipse(x - fw * 0.22, fy - fh * 0.12, fw * 0.3, fh * 0.22);
      }
      // 날아가는 꼬리 (옅은 점, 0.05초에 하나)
      if (m && !m.stopped && time >= this.trailAt && time >= this.holdUntil) {
        this.trailAt = time + 50;
        const dot = this.efx.spawn(G.dot, m.x, m.y, 480);
        if (dot) {
          dot.setTint(ringOf(h.type)).setAlpha(0.45).setScale((r * 1.5) / 32);
          this.efx.go(dot, { alpha: 0, scale: 0.2 }, 240);
        }
      }
      const top = y - r * (full ? BODY_H / 2 : 1.05);
      // 보호막: 몸을 덮는 옅은 흰 막 (세로로 긴 타원, 위쪽 반짝임)
      if (h.shield || this.run.guardTurns > 0) {
        const sw = r * (full ? 2.5 : 2.4);
        const sh = r * (full ? BODY_H + 0.25 : 2.4);
        g.fillStyle(COLOR.white, 0.16).fillEllipse(x, y, sw, sh);
        g.lineStyle(3, COLOR.white, 0.75).strokeEllipse(x, y, sw, sh);
        g.fillStyle(COLOR.white, 0.7).fillEllipse(x - sw * 0.24, y - sh * 0.3, sw * 0.16, sh * 0.09);
      }
      // 얼음: 몸을 가둔 하늘색 얼음덩이 (둥근 네모 + 흰 빗금 반짝임)
      if (h.frozen > 0) {
        const iw = r * (full ? 2.3 : 2.3);
        const ih = r * (full ? BODY_H + 0.15 : 2.3);
        g.fillStyle(COLOR.skyMid, 0.42).fillRoundedRect(x - iw / 2, y - ih / 2, iw, ih, 14);
        g.lineStyle(3, COLOR.white, 0.85).strokeRoundedRect(x - iw / 2, y - ih / 2, iw, ih, 14);
        g.lineStyle(4, COLOR.white, 0.7).lineBetween(x - iw * 0.3, y - ih * 0.18, x - iw * 0.12, y - ih * 0.36);
        g.lineStyle(3, COLOR.white, 0.55).lineBetween(x - iw * 0.3, y - ih * 0.02, x - iw * 0.02, y - ih * 0.36);
      }
      // 나쁜 효과: 독 · 느려짐 · 약해짐 = 머리 위 아이콘
      const on = [h.poisonTurns > 0, h.slow > 0, h.weak > 0];
      let n = 0;
      icons.forEach((ic, k2) => {
        ic.setVisible(on[k2]);
        if (on[k2]) ic.setPosition(x - r + 8 + n++ * 26, top - 10);
      });
      // 이번 차례: 머리 위에서 까딱이는 작은 화살표
      if (mine) {
        const ay = top - (n ? 34 : 10) + 4 * Math.sin(time / 180);
        g.fillStyle(COLOR.outline, 1).fillTriangle(x - 14, ay - 15, x + 14, ay - 15, x, ay + 4);
        g.fillStyle(this.armed ? COLOR.pink : COLOR.primary, 1).fillTriangle(x - 9, ay - 12, x + 9, ay - 12, x, ay);
      }
      if (!m) {
        const by = fy + fh / 2 + 5;
        g.fillStyle(COLOR.outline, 1).fillRoundedRect(x - 30, by, 60, 10, 5);
        g.fillStyle(COLOR.win, 1).fillRoundedRect(x - 28, by + 2, Math.max(0, (56 * this.shownHp[i]) / h.maxHp), 6, 3);
      }
    });
  }

  /** 원숭이 분신: 같은 전신 그림을 작고 반투명하게 */
  private drawClones() {
    const clones = this.run.movers.filter((m) => m.clone);
    while (this.cloneImgs.length < clones.length) this.cloneImgs.push(this.add.image(0, 0, this.bodyKeys[this.run.cur]).setDepth(490).setAlpha(0.6));
    this.cloneImgs.forEach((img, i) => {
      const m = clones[i];
      if (!m) return img.setVisible(false);
      const full = this.bodyFull[m.hero];
      if (img.texture.key !== this.bodyKeys[m.hero]) img.setTexture(this.bodyKeys[m.hero]);
      const sp = m.stopped ? 0 : Math.hypot(m.vx, m.vy);
      if (full && sp > 0.01 && Math.abs(m.vx) > sp * 0.12) img.setFlipX(m.vx < 0);
      img
        .setVisible(true)
        .setPosition(RX + m.x, RY + m.y)
        .setScale(this.bodyScale(m.hero, m.r, img))
        .setAngle(full && sp > 0.01 ? (m.vx / sp) * 10 : 0);
      this.footG.fillStyle(COLOR.outline, 0.16).fillEllipse(RX + m.x, RY + m.y + m.r * (full ? FOOT_FULL : FOOT_BALL), m.r * 1.6, m.r * 0.5);
    });
  }

  private drawAim(time: number) {
    const g = this.aimG;
    g.clear();
    this.hintText.setVisible(false);
    if (this.mode !== 'aim') return;
    let pull: { a: number; p: number } | null = null;
    if (this.autoPick) pull = this.autoPick.inp;
    else if (this.drag) pull = this.pullOf(this.drag.x0, this.drag.y0, this.drag.x, this.drag.y);
    // 힌트: 내 조준선 아래에 파란 점선(흐르는 무늬) + 바깥쪽 힘 고리 + '힌트' 글자. 내 선을 여기에 겹치게 당기면 된다
    if (this.hint) {
      const [hx, hy] = this.hintLine(time);
      this.powerRing(this.hint.p, COLOR.teamA, 12);
      // 글자는 길 끝 위에 (대원 바로 위면 더 위로 올려 대원을 가리지 않게)
      const h = this.run.heroes[this.run.cur];
      const near = Math.abs(hx - (RX + h.x)) < 150 && Math.abs(hy - (RY + h.y)) < 90;
      this.hintText
        .setPosition(Math.max(RX + 130, Math.min(W - RX - 130, hx)), Math.max(RY + 30, Math.min(BAR_Y - 40, (near ? RY + h.y - 80 : hy) - 34)))
        .setText(`힌트 · 힘 ${this.hint.p}`)
        .setVisible(true);
    }
    if (this.drag) {
      // 당기는 손가락 자리 (시작 → 지금)
      g.lineStyle(4, COLOR.white, 0.6).lineBetween(this.drag.x0, this.drag.y0, this.drag.x, this.drag.y);
      g.lineStyle(3, COLOR.white, 0.6).strokeCircle(this.drag.x0, this.drag.y0, CANCEL_R);
    }
    if (!pull) return;
    const color = pull.p >= 80 ? COLOR.pink : pull.p >= 45 ? COLOR.primary : COLOR.white;
    const pts = aimPreview(this.run, pull.a);
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[pts.length - 1];
    g.lineStyle(8, COLOR.outline, 0.5);
    dashed(g, RX + x0, RY + y0, RX + x1, RY + y1, 18, 14);
    g.lineStyle(5, color, 1);
    dashed(g, RX + x0, RY + y0, RX + x1, RY + y1, 18, 14);
    g.fillStyle(color, 1).fillCircle(RX + x1, RY + y1, 8);
    this.powerRing(pull.p, color, 0);
    // 힌트를 보는 중이면 내 힘도 숫자로 (힌트의 힘과 맞춰 보게)
    if (this.hint && this.drag) {
      this.hintText.setText(`힌트 · 힘 ${this.hint.p} (지금 ${pull.p})`);
    }
  }

  /** 힌트 길: 힌트대로 쏘면 지나가는 자리를 파란 토막으로 (토막이 앞으로 흐른다). 길 끝의 화면 좌표를 돌려준다 */
  private hintLine(time: number): [number, number] {
    const g = this.aimG;
    const pts = this.hintPts;
    const flow = Math.floor(time / 140) % 2;
    for (const [wd, c, al] of [[10, COLOR.outline, 0.5], [6, COLOR.teamA, 1]] as const) {
      g.lineStyle(wd, c, al);
      for (let i = 1; i < pts.length; i++) {
        if ((i + flow) % 2) continue;
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        // 순간이동 구멍을 지난 자리는 잇지 않는다 (직선 거리 기준: 빠른 대각선 발사가 구멍으로 잘못 걸리지 않게)
        if (!hintJoined(pts[i - 1], pts[i])) continue;
        g.lineBetween(RX + ax, RY + ay, RX + bx, RY + by);
      }
    }
    const [ex, ey] = pts[pts.length - 1];
    g.fillStyle(COLOR.outline, 0.5).fillCircle(RX + ex, RY + ey, 12);
    g.fillStyle(COLOR.teamA, 1).fillCircle(RX + ex, RY + ey, 9);
    return [RX + ex, RY + ey];
  }

  /** 발밑 힘 고리 (grow 만큼 바깥) */
  private powerRing(p: number, color: number, grow: number) {
    const g = this.aimG;
    const pull = { p };
    // 힘 게이지 (발밑 타원을 따라 도는 호 — 뒤쪽 가운데에서 시계 방향)
    const h = this.run.heroes[this.run.cur];
    const cx = RX + h.x;
    const cy = RY + h.y + h.r * (this.bodyFull[this.run.cur] ? FOOT_FULL : FOOT_BALL);
    const ax = h.r * 1.75 * 0.66 + 12 + grow;
    const ay = h.r * 0.58 * 0.66 + 10 + grow;
    const n = Math.max(1, Math.ceil((32 * pull.p) / 100));
    for (const [wd, c, al] of [[11, COLOR.outline, 0.55], [7, color, 1]] as const) {
      g.lineStyle(wd, c, al);
      g.beginPath();
      for (let j = 0; j <= n; j++) {
        const t = -Math.PI / 2 + (Math.PI * 2 * pull.p * j) / (100 * n);
        if (j === 0) g.moveTo(cx + Math.cos(t) * ax, cy + Math.sin(t) * ay);
        else g.lineTo(cx + Math.cos(t) * ax, cy + Math.sin(t) * ay);
      }
      g.strokePath();
    }
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
      if (h.fallen) sl.img.setTint(COLOR.draw);
      else sl.img.clearTint();
      colorOf(sl.name, h.fallen ? HEX.inkSoft : HEX.ink);
      // 체력 바
      const bx = x + 74;
      const bw = SLOT_W - 86;
      g.fillStyle(COLOR.outline, 1).fillRoundedRect(bx - 2, BAR_Y + 46, bw + 4, 16, 6);
      g.fillStyle(COLOR.track, 1).fillRoundedRect(bx, BAR_Y + 48, bw, 12, 5);
      g.fillStyle(COLOR.win, 1).fillRoundedRect(bx, BAR_Y + 48, Math.max(0, (bw * this.shownHp[i]) / h.maxHp), 12, 5);
      // 필살기 게이지 (CUT_AHEAD 턴 안으로 남으면 그 대원의 컷인 그림을 받아 둔다)
      const full = h.charge >= h.chargeMax;
      if (!h.fallen && h.chargeMax - h.charge <= CUT_AHEAD) this.wantCut(h.id);
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
    colorOf(this.spText, ready || this.armed ? HEX.ink : HEX.inkSoft);
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

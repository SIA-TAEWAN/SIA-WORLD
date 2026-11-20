import Phaser from 'phaser';
import { CAPPED, GRID_MAX, lookOf } from '../data/balance';
import { BUILDING, recipeOf, upgradable, type BuildingType } from '../data/buildings';
import type { ResidentId } from '../data/residents';
import { feasting, isFull, landRect, pavilionRange, placeError, ratePct, storageCap, stored, workplace, type Building, type VillageState } from '../game/rules';
import { COLOR, FONT, MATGO, TABLE, css } from '../theme';
import { ART_FILES, BUBBLE, CELL, GLOWS, bubbleKey, makeTextures, pickNature, texKey, texSize } from './art';
import { skyAt } from './sky';

/**
 * 마을 화면: 격자 땅 + 건물. 서버가 준 상태를 그리기만 한다 (계산은 서버, 미리 보기는 game/rules.ts).
 *   끌기 = 이동 · 두 손가락/휠 = 확대축소 · 건물 누르기 = 관리 · 수확 방울 누르기/끌고 지나가기 = 수확 · 주민 누르기 = 한마디/부탁
 *   주민(십이지)은 공용 전신 그림 한 장을 코드로 움직인다: 마을을 걸어 다니고, 일터가 있으면 그 둘레를 맴돈다
 *   놓을 자리 고르기(짓기 · 옮기기): 칸을 누르거나 건물 그림을 끌어서 옮긴다. 확인/취소는 화면 아래 버튼(DOM)
 */
export interface SceneHooks {
  state(): VillageState;
  /** 서버 시각 (ms) */
  now(): number;
  tapBuilding(id: string): void;
  tapGround(): void;
  /** 걸어 다니는 주민을 눌렀다 */
  tapResident(id: ResidentId): void;
  /** 수확할 건물 하나 (끌면 지나가는 건물마다 불린다) */
  harvest(id: string): void;
  /** 손을 뗐다: 모은 수확을 보낸다 */
  harvestEnd(): void;
  placeChanged(p: { x: number; y: number; ok: boolean }): void;
  /** 짓기 · 업그레이드가 끝날 시각이 지났다 → 서버에 다시 묻는다 */
  due(): void;
  /** 지금 한국 시각 (0 ~ 24, 서버 시각 기준. 하늘 색) */
  hour(): number;
}

export interface SceneData {
  hooks: SceneHooks;
  /** 캔버스 픽셀 ÷ 기준 화면(가로 720) */
  unit: number;
  /** 십이지 전신 그림의 주소 (shared/images/zodiac/full) */
  zodiacUrl(id: string): string;
}

/** 걸어 다니는 주민 한 명 */
interface Walker {
  box: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image | null;
  mark: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** 서 있는 시간 (ms) · 걸음 흔들림 */
  rest: number;
  step: number;
  sayLeft: number;
}

/** 주민의 키 (장면 좌표) · 걷는 빠르기 (초당) */
const WALK_H = 84;
const WALK_SPEED = 44;

interface View {
  box: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text;
  tag: Phaser.GameObjects.Graphics;
  /** 생산 보너스를 받고 있다는 표시 (정자 · 잔치) */
  boost: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Image;
  /** 밤에 켜지는 등불 빛 (없으면 null) */
  glow: Phaser.GameObjects.Image | null;
  sig: string;
}

const ZOOM_MIN = 0.34;
/** 땅 밖의 나무: 이 칸 범위(20×20 좌표 기준, 끝은 빼고)는 한 그루씩, 그 밖은 숲 무늬를 깔아 끝까지 줄여도 빈 바탕이 보이지 않게 */
const NEAR0 = -6;
const NEAR1 = GRID_MAX + 6;
const FOREST_PAD = 40; // 숲 무늬 한 장(art.ts 의 FOREST_CELLS = 8칸)의 배수: NEAR1 - NEAR0 도 8의 배수
const ZOOM_MAX = 1.8;
const DRAG_PX = 10;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class VillageScene extends Phaser.Scene {
  private hooks!: SceneHooks;
  private unit = 1;
  private zoom = 0.82;
  private ground!: Phaser.GameObjects.Graphics;
  /** 땅 위: 바닥 무늬(그림 파일) · 체크 무늬와 외곽선 */
  private grass: Phaser.GameObjects.TileSprite | null = null;
  private groundTop!: Phaser.GameObjects.Graphics;
  /** 그림 파일로 불러온 텍스처 이름 */
  private files = new Set<string>();
  /** 하늘 색 (마을 전체에 곱하기로 덮는다) · 등불의 세기 */
  private tint!: Phaser.GameObjects.Rectangle;
  private glowLevel = 0;
  private trees!: Phaser.GameObjects.Container;
  private landStage = -1;
  private views = new Map<string, View>();
  /** 수확을 보내고 답을 기다리는 건물 (방울을 숨긴다) */
  private pending = new Set<string>();
  private zodiacUrl: (id: string) => string = () => '';
  private walkers = new Map<ResidentId, Walker>();
  private loading = new Set<string>();
  private tick = 0;
  private dueAsked = 0;

  // 놓을 자리 고르기
  private place: { type: BuildingType; movingId: string | null; x: number; y: number; ok: boolean } | null = null;
  private ghost!: Phaser.GameObjects.Container;
  private ghostTile!: Phaser.GameObjects.Graphics;
  private ghostImg!: Phaser.GameObjects.Image;

  // 손가락
  private down: { x: number; y: number; scrollX: number; scrollY: number; mode: 'none' | 'pan' | 'harvest' | 'ghost'; moved: boolean; gx: number; gy: number } | null = null;
  private pinch: { dist: number; zoom: number } | null = null;

  constructor() {
    super('village');
  }

  init(data: SceneData) {
    this.hooks = data.hooks;
    this.unit = data.unit;
    this.zodiacUrl = data.zodiacUrl;
  }

  preload() {
    const base = `${import.meta.env.BASE_URL}art/`;
    this.load.on('filecomplete', (key: string) => this.files.add(key));
    // 못 불러온 그림은 코드 그림으로 채운다 (makeTextures)
    this.load.on('loaderror', () => undefined);
    for (const k of ART_FILES) this.load.image(k, `${base}${k}.png`);
  }

  create() {
    makeTextures(this, this.files);
    const big = (GRID_MAX + 120) * CELL;
    this.tint = this.add.rectangle(-60 * CELL, -60 * CELL, big, big, 0xffffff, 0).setOrigin(0, 0).setDepth(70000).setBlendMode(Phaser.BlendModes.MULTIPLY);
    // 숲 무늬: 무늬 한 장의 경계가 NEAR0 에 맞게 깐다 (무늬 속 나무는 가장자리에 걸치지 않는다)
    const f0 = (NEAR0 - FOREST_PAD) * CELL;
    const fw = (NEAR1 - NEAR0 + FOREST_PAD * 2) * CELL;
    // 땅 밖 들판 무늬 (SpriteCook tile-meadow, 384px = 4칸 한 장): 숲 무늬와 땅 둘레 아래에 깐다
    if (this.files.has('tile-meadow')) {
      this.add.tileSprite(f0, f0, fw, fw, 'tile-meadow').setOrigin(0, 0).setDepth(-12);
      // 숲 무늬는 땅 둘레(한 그루씩 찍는 곳)를 비운 네 띠로 깐다. 띠의 시작이 무늬 한 장(8칸)의 배수라 무늬가 이어진다
      const p = FOREST_PAD * CELL;
      const n0 = NEAR0 * CELL;
      const nw = (NEAR1 - NEAR0) * CELL;
      for (const [x, y, w, h] of [[f0, f0, fw, p], [f0, n0 + nw, fw, p], [f0, n0, p, nw], [n0 + nw, n0, p, nw]]) {
        this.add.tileSprite(x, y, w, h, 'forest').setOrigin(0, 0).setDepth(-11);
      }
    } else this.add.tileSprite(f0, f0, fw, fw, 'forest').setOrigin(0, 0).setDepth(-11);
    this.ground = this.add.graphics().setDepth(-10);
    this.groundTop = this.add.graphics().setDepth(-9);
    this.trees = this.add.container(0, 0).setDepth(-5);
    this.ghostTile = this.add.graphics();
    this.ghostImg = this.add.image(0, 0, texKey('paddy', 1)).setOrigin(0, 1).setAlpha(0.8);
    this.ghost = this.add.container(0, 0, [this.ghostImg, this.ghostTile]).setDepth(50000).setVisible(false);
    this.input.addPointer(2);
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.zoomAt(this.zoom * (dy > 0 ? 0.9 : 1.1), p.x, p.y));
    this.fit();
    this.refresh();
  }

  // ───────────────────────── 밖에서 부르는 것 ─────────────────────────

  /** 땅 전체가 화면 너비에 들어오게 맞춘다 (처음 들어올 때 · 땅을 넓혔을 때) */
  fit() {
    const { x0, size } = landRect(this.hooks.state().profile.landStage);
    const c = (x0 + size / 2) * CELL;
    this.zoom = Math.max(ZOOM_MIN, Math.min(0.82, 720 / ((size + 0.8) * CELL)));
    this.cameras.main.setZoom(this.unit * this.zoom).centerOn(c, c - CELL * 0.4);
  }

  /** 화면 크기가 바뀌었다 */
  setUnit(unit: number) {
    this.unit = unit;
    this.cameras.main.setZoom(this.unit * this.zoom);
    this.clampCamera();
  }

  /** 서버가 준 새 상태로 다시 그린다 */
  refresh() {
    const s = this.hooks.state();
    if (s.profile.landStage !== this.landStage) {
      const first = this.landStage < 0;
      this.drawGround(s.profile.landStage);
      if (!first) this.fit();
    }
    const seen = new Set<string>();
    for (const b of s.buildings) {
      // 보관함에 든 것은 마을에 없다
      if (b.state === 'stored') continue;
      seen.add(b.id);
      this.syncView(b);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      // 방울의 흔들림 트윈도 함께 지운다 (구경을 오갈 때마다 쌓이지 않게)
      this.tweens.killTweensOf(v.bubble);
      v.box.destroy();
      v.bubble.destroy();
      v.glow?.destroy();
      this.views.delete(id);
    }
    this.syncWalkers();
    this.tickViews();
    if (this.place) this.updateGhost();
  }

  /** 다른 마을로 바뀌었다 (구경하러 가거나 돌아옴): 주민은 새 마을의 마을 회관 앞에서 다시 나타난다 */
  switchVillage() {
    for (const w of this.walkers.values()) w.box.destroy();
    this.walkers.clear();
    this.pending.clear();
  }

  /** 수확 답이 왔다: 방울을 다시 계산하고, 거둔 양을 띄운다 */
  harvested(ids: string[], per: Record<string, number>) {
    for (const id of ids) this.pending.delete(id);
    for (const [id, n] of Object.entries(per)) {
      const b = this.hooks.state().buildings.find((v) => v.id === id);
      if (b && n > 0) this.floatText(b, `+${n}`);
    }
    this.tickViews();
  }

  floatText(b: Building, text: string) {
    const d = BUILDING[b.type];
    const t = this.add
      .text((b.x + d.w / 2) * CELL, b.y * CELL - 6, text, { fontFamily: FONT, fontSize: '34px', color: css(COLOR.white), stroke: css(COLOR.outline), strokeThickness: 7 })
      .setOrigin(0.5, 1)
      .setDepth(60000)
      .setResolution(2);
    this.tweens.add({ targets: t, y: t.y - 70, alpha: { from: 1, to: 0 }, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // ───────────────────────── 주민 ─────────────────────────

  /** 이사 온 주민마다 걸어 다니는 그림 하나 */
  private syncWalkers() {
    const s = this.hooks.state();
    const { x0, size } = landRect(s.profile.landStage);
    // 떠난 주민 (다른 마을을 구경하러 갔다 올 때)
    for (const [id, w] of this.walkers) {
      if (s.residents.some((r) => r.id === id)) continue;
      w.box.destroy();
      this.walkers.delete(id);
    }
    for (const r of s.residents) {
      let w = this.walkers.get(r.id);
      if (!w) {
        // 마을 회관 앞에서 나타난다
        const hall = s.buildings.find((b) => b.type === 'hall');
        const x = ((hall?.x ?? x0 + size / 2) + 1) * CELL + (this.walkers.size % 5) * 26 - 52;
        const y = ((hall?.y ?? x0 + size / 2) + 2.4) * CELL;
        const mark = this.add.text(0, -WALK_H - 4, '!', { fontFamily: FONT, fontSize: '30px', color: css(COLOR.white), backgroundColor: css(COLOR.pink), padding: { x: 10, y: 0 } }).setOrigin(0.5, 1).setResolution(2).setVisible(false);
        const bubble = this.add
          .text(0, -WALK_H - 8, '', { fontFamily: FONT, fontSize: '24px', color: css(COLOR.ink), backgroundColor: css(COLOR.white), padding: { x: 10, y: 6 }, align: 'center', wordWrap: { width: 300 } })
          .setOrigin(0.5, 1)
          .setResolution(2)
          .setVisible(false);
        const box = this.add.container(x, y, [mark, bubble]);
        w = { box, img: null, mark, bubble, x, y, tx: x, ty: y, rest: 400 + this.walkers.size * 300, step: 0, sayLeft: 0 };
        this.walkers.set(r.id, w);
        this.loadWalker(r.id);
      }
      w.mark.setVisible(s.requests.some((q) => q.state === 'open' && q.resident === r.id) && w.sayLeft <= 0);
    }
  }

  /** 주민 그림을 받아 붙인다 (못 받으면 이름 없는 동그라미 대신 그림 없이 표시만 남는다) */
  private loadWalker(id: ResidentId) {
    const key = `z-${id}`;
    const attach = () => {
      const w = this.walkers.get(id);
      if (!w || w.img || !this.textures.exists(key)) return;
      const img = this.add.image(0, 0, key).setOrigin(0.5, 0.96);
      img.setDisplaySize((WALK_H * img.width) / img.height, WALK_H);
      w.img = img;
      w.box.addAt(img, 0);
    };
    if (this.textures.exists(key)) return attach();
    if (this.loading.has(key)) return;
    this.loading.add(key);
    this.load.image(key, this.zodiacUrl(id));
    this.load.once(`filecomplete-image-${key}`, attach);
    this.load.start();
  }

  /** 주민이 한마디 한다 (2.8초) */
  say(id: ResidentId, text: string) {
    const w = this.walkers.get(id);
    if (!w) return;
    w.bubble.setText(text).setVisible(true);
    w.mark.setVisible(false);
    w.sayLeft = 2800;
    w.rest = Math.max(w.rest, 2800);
  }

  /** 그 칸에 서 있는 건물 (길은 밟고 다닌다 · 보관함은 없다) */
  private occupied(cx: number, cy: number): Building | null {
    for (const b of this.hooks.state().buildings) {
      const d = BUILDING[b.type];
      if (b.state === 'stored' || d.kind === 'road') continue;
      if (cx >= b.x && cx < b.x + d.w && cy >= b.y && cy < b.y + d.h) return b;
    }
    return null;
  }

  /** 다음에 갈 곳: 일터가 있으면 그 둘레, 없으면 땅 안의 아무 곳. 건물 칸 위에는 서지 않는다 (누르면 건물이 눌리게) */
  private nextSpot(id: ResidentId, w: Walker) {
    const s = this.hooks.state();
    const { x0, size } = landRect(s.profile.landStage);
    const lo = x0 * CELL + 30;
    const hi = (x0 + size) * CELL - 30;
    const at = workplace(s, id);
    const near = !!at && Math.random() < 0.75;
    for (let i = 0; i < 24; i++) {
      if (near && at && i < 12) {
        const d = BUILDING[at.type];
        w.tx = (at.x + d.w / 2) * CELL + (Math.random() - 0.5) * (d.w + 1.4) * CELL;
        w.ty = (at.y + d.h) * CELL + 14 + Math.random() * 50;
      } else {
        w.tx = lo + Math.random() * (hi - lo);
        w.ty = lo + Math.random() * (hi - lo);
      }
      w.tx = Math.max(lo, Math.min(hi, w.tx));
      w.ty = Math.max(lo + 40, Math.min(hi, w.ty));
      if (!this.occupied(Math.floor(w.tx / CELL), Math.floor(w.ty / CELL))) return;
    }
    // 빈 칸이 없으면 그 자리에 선다
    w.tx = w.x;
    w.ty = w.y;
  }

  private moveWalkers(dt: number) {
    for (const [id, w] of this.walkers) {
      if (w.sayLeft > 0) {
        w.sayLeft -= dt;
        if (w.sayLeft <= 0) {
          w.bubble.setVisible(false);
          w.mark.setVisible(this.hooks.state().requests.some((q) => q.state === 'open' && q.resident === id));
        }
      }
      if (w.rest > 0) {
        w.rest -= dt;
        if (w.rest <= 0) this.nextSpot(id, w);
      } else {
        const dx = w.tx - w.x;
        const dy = w.ty - w.y;
        const dist = Math.hypot(dx, dy);
        const go = (WALK_SPEED * dt) / 1000;
        if (dist <= go) {
          w.x = w.tx;
          w.y = w.ty;
          w.rest = 1200 + Math.random() * 3200;
        } else {
          w.x += (dx / dist) * go;
          w.y += (dy / dist) * go;
          w.step += dt;
          if (w.img) w.img.setFlipX(dx < 0);
        }
      }
      // 통통 걷기
      const hop = w.rest > 0 ? 0 : Math.abs(Math.sin(w.step / 130)) * 7;
      w.box.setPosition(w.x, w.y - hop).setDepth(w.y);
      if (w.img) w.img.setAngle(w.rest > 0 ? 0 : Math.sin(w.step / 130) * 5);
    }
  }

  /** 그 점 가까이에 있는 주민. 건물 칸 위를 지나가는 주민은 뺀다 (그때는 건물이 눌린다) */
  private walkerAt(px: number, py: number): ResidentId | null {
    const p = this.worldAt(px, py);
    let best: ResidentId | null = null;
    let bestD = 36;
    for (const [id, w] of this.walkers) {
      if (this.occupied(Math.floor(w.x / CELL), Math.floor(w.y / CELL))) continue;
      const d = Math.hypot(p.x - w.x, p.y - (w.y - WALK_H / 2));
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** 주민이 화면(CSS 픽셀)의 어디에 있나 (점검용) */
  walkerScreen(id: ResidentId): { x: number; y: number } | null {
    const w = this.walkers.get(id);
    if (!w) return null;
    const cam = this.cameras.main;
    const k = this.scale.displayScale.x || 1;
    return { x: ((w.x - cam.scrollX - cam.width / 2) * cam.zoom + cam.width / 2) / k, y: ((w.y - WALK_H / 2 - cam.scrollY - cam.height / 2) * cam.zoom + cam.height / 2) / k };
  }

  /** 놓을 자리 고르기 시작 (movingId: 옮기는 건물) */
  startPlacing(type: BuildingType, movingId: string | null = null) {
    const s = this.hooks.state();
    let x: number;
    let y: number;
    const moving = movingId ? s.buildings.find((b) => b.id === movingId) : null;
    if (moving && moving.state !== 'stored') {
      x = moving.x;
      y = moving.y;
    } else {
      // 화면 가운데에서 가장 가까운 빈 자리
      const cam = this.cameras.main;
      const c = this.worldAt(cam.width / 2, cam.height / 2);
      const cx = c.x / CELL - 0.5;
      const cy = c.y / CELL - 0.5;
      let best = { x: Math.round(cx), y: Math.round(cy), d: Infinity };
      for (let yy = 0; yy < GRID_MAX; yy++) {
        for (let xx = 0; xx < GRID_MAX; xx++) {
          if (placeError(s, type, xx, yy)) continue;
          const dd = (xx - cx) ** 2 + (yy - cy) ** 2;
          if (dd < best.d) best = { x: xx, y: yy, d: dd };
        }
      }
      x = best.x;
      y = best.y;
    }
    this.place = { type, movingId, x, y, ok: false };
    const d = BUILDING[type];
    const sz = texSize(d.w, d.h);
    this.ghostImg.setTexture(texKey(type, lookOf(moving?.level ?? 1))).setDisplaySize(sz.w, sz.h).setPosition(0, d.h * CELL);
    this.ghost.setVisible(true);
    if (movingId) this.views.get(movingId)?.box.setAlpha(0.25);
    this.updateGhost();
    this.tickViews();
  }

  stopPlacing() {
    if (this.place?.movingId) this.views.get(this.place.movingId)?.box.setAlpha(1);
    this.place = null;
    this.ghost.setVisible(false);
    this.tickViews();
  }

  get placing() {
    return this.place;
  }

  /** 칸의 한가운데가 화면(CSS 픽셀)의 어디인가 (점검용) */
  cellToScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const px = ((x + 0.5) * CELL - cam.scrollX - cam.width / 2) * cam.zoom + cam.width / 2;
    const py = ((y + 0.5) * CELL - cam.scrollY - cam.height / 2) * cam.zoom + cam.height / 2;
    const k = this.scale.displayScale.x || 1;
    return { x: px / k, y: py / k };
  }

  // ───────────────────────── 그리기 ─────────────────────────

  private drawGround(stage: number) {
    this.landStage = stage;
    const { x0, size } = landRect(stage);
    const g = this.ground.clear();
    // 들판 무늬가 없을 때만 땅 둘레를 단색으로 덮는다 (숲 무늬 속 나무가 둘레에 비치지 않게)
    if (!this.files.has('tile-meadow')) g.fillStyle(MATGO.matDark, 1).fillRect(NEAR0 * CELL, NEAR0 * CELL, (NEAR1 - NEAR0) * CELL, (NEAR1 - NEAR0) * CELL);
    const l = x0 * CELL;
    const w = size * CELL;
    // 땅: 아래 두께 + (풀밭 무늬) + 체크 무늬 + 굵은 외곽선
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(l - 6, l - 6 + 12, w + 12, w + 12, 18);
    g.fillStyle(TABLE.matgo, 1).fillRoundedRect(l - 6, l - 6, w + 12, w + 12, 18);
    const hasGrass = this.files.has('tile-grass');
    if (hasGrass) {
      this.grass ??= this.add.tileSprite(0, 0, 1, 1, 'tile-grass').setOrigin(0, 0).setDepth(-9.5).setTileScale(CELL / 192, CELL / 192);
      this.grass.setPosition(l - 2, l - 2).setSize(w + 4, w + 4);
    }
    const top = this.groundTop.clear();
    top.fillStyle(MATGO.matLight, hasGrass ? 0.35 : 1);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x + y) % 2 === 0) top.fillRoundedRect(l + x * CELL + 3, l + y * CELL + 3, CELL - 6, CELL - 6, 10);
    top.lineStyle(5, COLOR.outline, 1).strokeRoundedRect(l - 6, l - 6, w + 12, w + 12, 18);
    // 땅 밖: 나무 (자리는 좌표로 정해 늘 같다)
    this.trees.removeAll(true);
    for (let y = NEAR0; y < NEAR1; y++) {
      for (let x = NEAR0; x < NEAR1; x++) {
        if (x >= x0 - 1 && x <= x0 + size && y >= x0 - 1 && y <= x0 + size) continue;
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        if (h % 3 !== 0) continue;
        const n = pickNature(h, this.files);
        if (n) {
          // 그림 파일의 자연물 (나무 · 소나무 · 대나무 · 덤불 · 바위 · 들꽃, 조금 어둡게)
          const img = this.add.image(x * CELL + (h % 17) - 8 + CELL / 2, (y + 1) * CELL + ((h >> 5) % 17) - 8, n.key).setOrigin(0.5, 1).setTint(0xd6e8d6);
          this.trees.add(img.setDisplaySize(CELL * n.size, (CELL * n.size * img.height) / img.width));
        } else this.trees.add(this.add.image(x * CELL + (h % 17) - 8, y * CELL + ((h >> 5) % 17) - 8, 'tree').setOrigin(0, 0).setDisplaySize(CELL, CELL));
      }
    }
  }

  private syncView(b: Building) {
    const d = BUILDING[b.type];
    const sig = `${b.type}|${b.level}|${b.x}|${b.y}|${b.state}`;
    let v = this.views.get(b.id);
    if (!v) {
      const img = this.add.image(0, d.h * CELL, texKey(b.type, 1)).setOrigin(0, 1);
      const bar = this.add.graphics();
      const label = this.add.text((d.w * CELL) / 2, d.h * CELL - 30, '', { fontFamily: FONT, fontSize: '22px', color: css(COLOR.white), stroke: css(COLOR.outline), strokeThickness: 5 }).setOrigin(0.5, 1).setResolution(2);
      // 레벨: 오른쪽 아래 귀퉁이의 작은 동그라미 (그림을 덜 가리게)
      const tag = this.add.graphics();
      tag.fillStyle(COLOR.outline, 1).fillCircle(d.w * CELL - 13, d.h * CELL - 13, 12);
      const badge = this.add.text(d.w * CELL - 13, d.h * CELL - 13, '', { fontFamily: FONT, fontSize: '17px', color: css(COLOR.white) }).setOrigin(0.5, 0.5).setResolution(2);
      const boost = this.add.text(4, d.h * CELL - 4, '▲', { fontFamily: FONT, fontSize: '22px', color: css(COLOR.pink), stroke: css(COLOR.outline), strokeThickness: 5 }).setOrigin(0, 1).setResolution(2).setVisible(false);
      const box = this.add.container(0, 0, [img, bar, label, tag, badge, boost]);
      const bubble = this.add.image(0, 0, bubbleKey(b.type, recipeOf(b.type)?.out ?? null) ?? 'bubble-rice').setOrigin(0.5, 1).setDisplaySize(BUBBLE, BUBBLE + 10).setVisible(false);
      this.tweens.add({ targets: bubble, angle: { from: -7, to: 7 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      v = { box, img, bar, label, badge, tag, boost, bubble, glow: null, sig: '' };
      this.views.set(b.id, v);
    }
    if (v.sig === sig) return;
    v.sig = sig;
    const sz = texSize(d.w, d.h);
    v.img.setTexture(b.state === 'building' ? `site-${d.w}` : texKey(b.type, lookOf(b.level))).setDisplaySize(sz.w, sz.h);
    // 길은 바닥에 깔린다 (다른 것보다 늘 아래)
    v.box.setPosition(b.x * CELL, b.y * CELL).setDepth(d.kind === 'road' ? 1 + b.y : (b.y + d.h) * CELL);
    v.bubble.setPosition((b.x + d.w / 2) * CELL, b.y * CELL + 18).setDepth(40000 + b.y);
    // 밤의 등불 빛
    const from = GLOWS[b.type];
    const lit = from !== undefined && b.state !== 'building' && lookOf(b.level) >= from;
    if (lit && !v.glow) v.glow = this.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(70001);
    if (!lit && v.glow) {
      v.glow.destroy();
      v.glow = null;
    }
    if (v.glow) {
      const r = (b.type === 'lantern' ? 1.5 : d.w > 1 ? 1.3 : 1.6) * d.w * CELL;
      // 등불은 등이 달린 높이, 건물은 앞쪽 가운데
      v.glow.setPosition((b.x + d.w / 2) * CELL, b.type === 'lantern' ? b.y * CELL - 4 : (b.y + d.h * 0.62) * CELL).setDisplaySize(r, r).setAlpha(this.glowLevel).setVisible(this.glowLevel > 0.02);
    }
    const lv = upgradable(b.type) && b.state !== 'building';
    v.badge.setText(String(b.level)).setVisible(lv);
    v.tag.setVisible(lv);
  }

  /** 시간에 따라 바뀌는 것: 진행 막대 · 남은 시간 · 수확 방울 */
  private tickViews() {
    const s = this.hooks.state();
    const now = this.hooks.now();
    const cap = storageCap(s);
    let due = false;
    for (const b of s.buildings) {
      const v = this.views.get(b.id);
      if (!v) continue;
      const d = BUILDING[b.type];
      v.bar.clear();
      // 가공이 다 끝난 건물은 막대 대신 방울이 뜬다
      const timed = b.finishAt !== null && (b.state === 'building' || b.state === 'upgrading' || (b.state === 'working' && b.finishAt > now));
      if (timed && b.finishAt !== null) {
        const total = Math.max(1, b.finishAt - (b.startAt ?? b.finishAt));
        const left = b.finishAt - now;
        const rate = Math.max(0, Math.min(1, 1 - left / total));
        const w = d.w * CELL - 20;
        const y = d.h * CELL - 26;
        v.bar.fillStyle(COLOR.outline, 1).fillRoundedRect(10 - 3, y - 3, w + 6, 20, 10);
        v.bar.fillStyle(COLOR.track, 1).fillRoundedRect(10, y, w, 14, 7);
        if (rate > 0.04) v.bar.fillStyle(COLOR.primary, 1).fillRoundedRect(10, y, w * rate, 14, 7);
        v.label.setText(left > 0 ? mmss(left) : '완성!').setVisible(true);
        if (left <= 0) due = true;
      } else v.label.setVisible(false);
      v.boost.setVisible(b.state === 'done' && !!d.product && (ratePct(s, b) > 0 || feasting(s, now)));
      const n = this.place || this.pending.has(b.id) ? 0 : stored(s, b, now);
      v.bubble.setVisible(n >= 1);
      // 가득 차면 방울이 커진다. 그 자원의 창고가 가득 찼으면 흐리게 (거두면 넘친 만큼은 버려진다)
      if (n >= 1) {
        const k = isFull(s, b, now) ? 1.25 : 1;
        v.bubble.setDisplaySize(BUBBLE * k, (BUBBLE + 10) * k);
        const res = b.state === 'working' ? recipeOf(b.type)?.out : d.product;
        const shut = !!res && CAPPED.includes(res) && s.profile.resources[res] >= cap;
        v.bubble.setAlpha(shut ? 0.45 : 1).setTint(shut ? 0x9a9a9a : 0xffffff);
      }
    }
    this.updateSky();
    // 끝날 시각이 지난 건물이 있으면 서버에 묻는다 (2초에 한 번까지)
    if (due && now - this.dueAsked > 2000) {
      this.dueAsked = now;
      this.hooks.due();
    }
  }

  /** 하늘 색 · 등불 (200ms 마다). 등불은 하나씩 조금씩 다르게 깜박인다 */
  private updateSky() {
    const sky = skyAt(this.hooks.hour());
    this.tint.setFillStyle(sky.color, sky.alpha);
    this.glowLevel = sky.glow;
    const on = sky.glow > 0.02;
    const t = this.time.now / 600;
    for (const v of this.views.values()) {
      if (!v.glow) continue;
      v.glow.setVisible(on);
      if (on) v.glow.setAlpha(sky.glow * (0.85 + Math.sin(t + v.glow.x * 0.013 + v.glow.y * 0.029) * 0.15));
    }
  }

  update(_t: number, dt: number) {
    this.moveWalkers(Math.min(dt, 100));
    this.tick += dt;
    if (this.tick < 200) return;
    this.tick = 0;
    this.tickViews();
  }

  private updateGhost() {
    const p = this.place;
    if (!p) return;
    const d = BUILDING[p.type];
    p.ok = placeError(this.hooks.state(), p.type, p.x, p.y, p.movingId ?? undefined) === null;
    this.ghost.setPosition(p.x * CELL, p.y * CELL);
    // 놓을 수 있으면 초록, 없으면 빨강 (그림 위에 덮어 한눈에 보이게)
    const tone = p.ok ? COLOR.win : COLOR.lose;
    this.ghostTile.clear().fillStyle(tone, p.ok ? 0.3 : 0.55).fillRoundedRect(2, 2, d.w * CELL - 4, d.h * CELL - 4, 12);
    this.ghostTile.lineStyle(10, COLOR.outline, 1).strokeRoundedRect(2, 2, d.w * CELL - 4, d.h * CELL - 4, 12);
    this.ghostTile.lineStyle(5, tone, 1).strokeRoundedRect(2, 2, d.w * CELL - 4, d.h * CELL - 4, 12);
    this.ghostImg.setTint(p.ok ? 0xffffff : COLOR.lose);
    // 정자: 영향이 닿는 둘레를 보여 준다
    if (p.type === 'pavilion') {
      const r = pavilionRange(this.hooks.state()) * CELL;
      this.ghostTile.lineStyle(8, COLOR.outline, 1).strokeRoundedRect(-r, -r, d.w * CELL + r * 2, d.h * CELL + r * 2, 16);
      this.ghostTile.lineStyle(4, COLOR.primary, 1).strokeRoundedRect(-r, -r, d.w * CELL + r * 2, d.h * CELL + r * 2, 16);
    }
    this.hooks.placeChanged({ x: p.x, y: p.y, ok: p.ok });
  }

  // ───────────────────────── 조작 ─────────────────────────

  /** 캔버스의 점 → 장면 좌표 (카메라는 화면 가운데를 중심으로 확대한다) */
  private worldAt(px: number, py: number) {
    const cam = this.cameras.main;
    return { x: (px - cam.width / 2) / cam.zoom + cam.scrollX + cam.width / 2, y: (py - cam.height / 2) / cam.zoom + cam.scrollY + cam.height / 2 };
  }

  private cellAt(px: number, py: number) {
    const w = this.worldAt(px, py);
    return { x: Math.floor(w.x / CELL), y: Math.floor(w.y / CELL), wx: w.x, wy: w.y };
  }

  /** 그 점의 건물. 수확 방울(건물 위쪽)이 먼저다. onBubble: 방울 그림을 짚었나 · bubble: 수확할 것이 있나 */
  private buildingAt(px: number, py: number): { b: Building; bubble: boolean; onBubble: boolean } | null {
    const c = this.cellAt(px, py);
    const s = this.hooks.state();
    for (const b of s.buildings) {
      const v = this.views.get(b.id);
      if (!v?.bubble.visible) continue;
      const bx = v.bubble.x;
      const by = v.bubble.y - BUBBLE / 2;
      if ((c.wx - bx) ** 2 + (c.wy - by) ** 2 <= (BUBBLE * 0.62) ** 2) return { b, bubble: true, onBubble: true };
    }
    for (const b of s.buildings) {
      if (b.state === 'stored') continue;
      const d = BUILDING[b.type];
      if (c.x >= b.x && c.x < b.x + d.w && c.y >= b.y && c.y < b.y + d.h) return { b, bubble: this.views.get(b.id)?.bubble.visible === true, onBubble: false };
    }
    return null;
  }

  private touches() {
    return [this.input.pointer1, this.input.pointer2].filter((p) => p.isDown);
  }

  private onDown(p: Phaser.Input.Pointer) {
    const t = this.touches();
    if (t.length >= 2) {
      // 두 손가락: 확대축소
      this.pinch = { dist: Phaser.Math.Distance.Between(t[0].x, t[0].y, t[1].x, t[1].y), zoom: this.zoom };
      this.down = null;
      return;
    }
    const cam = this.cameras.main;
    const c = this.cellAt(p.x, p.y);
    let mode: 'none' | 'ghost' | 'harvest' = 'none';
    if (this.place) {
      const d = BUILDING[this.place.type];
      if (c.x >= this.place.x && c.x < this.place.x + d.w && c.y >= this.place.y && c.y < this.place.y + d.h) mode = 'ghost';
    } else if (this.buildingAt(p.x, p.y)?.onBubble) mode = 'harvest';
    this.down = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY, mode, moved: false, gx: c.x - (this.place?.x ?? 0), gy: c.y - (this.place?.y ?? 0) };
    if (mode === 'harvest') this.sweep(p.x, p.y);
  }

  private onMove(p: Phaser.Input.Pointer) {
    const t = this.touches();
    if (this.pinch && t.length >= 2) {
      const dist = Phaser.Math.Distance.Between(t[0].x, t[0].y, t[1].x, t[1].y);
      if (this.pinch.dist > 0) this.zoomAt(this.pinch.zoom * (dist / this.pinch.dist), (t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2);
      return;
    }
    const d = this.down;
    if (!d || !p.isDown) return;
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < DRAG_PX * this.unit) return;
    d.moved = true;
    if (d.mode === 'harvest') this.sweep(p.x, p.y);
    else if (d.mode === 'ghost' && this.place) {
      const c = this.cellAt(p.x, p.y);
      this.moveGhost(c.x - d.gx, c.y - d.gy);
    } else {
      d.mode = 'pan';
      const cam = this.cameras.main;
      cam.setScroll(d.scrollX - (p.x - d.x) / cam.zoom, d.scrollY - (p.y - d.y) / cam.zoom);
      this.clampCamera();
    }
  }

  private onUp(p: Phaser.Input.Pointer) {
    if (this.pinch) {
      if (this.touches().length < 2) this.pinch = null;
      this.down = null;
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (d.mode === 'harvest') {
      this.hooks.harvestEnd();
      return;
    }
    if (d.moved) return;
    // 누르기
    const c = this.cellAt(p.x, p.y);
    if (this.place) {
      const def = BUILDING[this.place.type];
      // 누른 칸이 건물 가운데에 오게
      this.moveGhost(c.x - Math.floor((def.w - 1) / 2), c.y - Math.floor((def.h - 1) / 2));
      return;
    }
    // 빈 칸에 선 주민이 먼저 (건물 앞에 서 있으면 그림이 건물을 가린다). 건물 칸 위를 지나가는 주민은 건물이 먼저. 수확 방울은 위에서 이미 걸렀다
    const who = this.walkerAt(p.x, p.y);
    if (who) return this.hooks.tapResident(who);
    const hit = this.buildingAt(p.x, p.y);
    if (hit) this.hooks.tapBuilding(hit.b.id);
    else this.hooks.tapGround();
  }

  private sweep(px: number, py: number) {
    const hit = this.buildingAt(px, py);
    if (!hit || !hit.bubble || this.pending.has(hit.b.id)) return;
    this.pending.add(hit.b.id);
    this.views.get(hit.b.id)?.bubble.setVisible(false);
    this.hooks.harvest(hit.b.id);
  }

  private moveGhost(x: number, y: number) {
    const p = this.place;
    if (!p) return;
    const d = BUILDING[p.type];
    const nx = Math.max(0, Math.min(GRID_MAX - d.w, x));
    const ny = Math.max(0, Math.min(GRID_MAX - d.h, y));
    if (nx === p.x && ny === p.y) return;
    p.x = nx;
    p.y = ny;
    this.updateGhost();
  }

  private zoomAt(z: number, px: number, py: number) {
    const cam = this.cameras.main;
    const before = this.worldAt(px, py);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    cam.setZoom(this.unit * this.zoom);
    // 손가락 아래의 점이 그대로 있게
    const after = this.worldAt(px, py);
    cam.setScroll(cam.scrollX + before.x - after.x, cam.scrollY + before.y - after.y);
    this.clampCamera();
  }

  /** 화면 가운데가 땅(둘레 한 칸 포함)을 벗어나지 않게 */
  private clampCamera() {
    const cam = this.cameras.main;
    const { x0, size } = landRect(this.hooks.state().profile.landStage);
    const lo = (x0 - 1) * CELL;
    const hi = (x0 + size + 1) * CELL;
    const cx = Math.max(lo, Math.min(hi, cam.scrollX + cam.width / 2));
    const cy = Math.max(lo, Math.min(hi, cam.scrollY + cam.height / 2));
    cam.setScroll(cx - cam.width / 2, cy - cam.height / 2);
  }
}

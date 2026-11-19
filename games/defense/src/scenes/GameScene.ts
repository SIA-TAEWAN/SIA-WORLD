import Phaser from 'phaser';
import { BOARD_H, BOARD_W, CELL, ROAD_W, SLOT_SIZE, type ZodiacId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { TOWERS } from '../data/characters';
import { ENEMIES } from '../data/enemies';
import { stageBg, stageEnemies } from '../data/stages';
import { DASH } from '../game/bosses';
import { makePoint, routePos, type Route } from '../game/path';
import { FX, PROJ, type State } from '../game/state';
import type { Run } from '../run/run';
import { COLOR, FONT, css } from '../theme';
import { BG, PROJ_KEYS, bossKey, enemyKey, ensureArt, pipKey, preloadArt, tileKey, zKey } from './art';

export interface SceneData {
  run: Run;
  /** 기준 1px(가로 720 기준)이 캔버스 몇 픽셀인가 (화면 배율 × 기기 픽셀 배율) */
  zoom: number;
  /** 화면 맨 위가 판 좌표로 몇 y 인가 (판은 위 HUD 와 아래 카드 사이 가운데에 온다) */
  offY: number;
  /** 매 프레임, 계산이 끝난 뒤 (HUD 갱신용) */
  onFrame: () => void;
}

type Img = Phaser.GameObjects.Image;

/** 캐릭터 그림 높이 (배치 칸보다 조금 크게) */
const CHAR_H = 86;
const CHAR_MAX_W = 84;
/** 그림 깊이 */
const D = { ground: 0, road: 1, sign: 1.5, slot: 2, range: 3, sel: 4, shadow: 5, enemy: 6, tower: 7, boss: 8, bar: 9, proj: 10, fx: 11 };

/** 같은 종류의 그림을 미리 만들어 두고 돌려 쓰는 묶음 (프레임마다 새로 만들지 않는다) */
class SpritePool {
  readonly list: Img[] = [];
  private shown = 0;
  constructor(private scene: Phaser.Scene, private key: string, private depth: number) {}
  /** i번째 그림 (없으면 만든다) */
  get(i: number): Img {
    while (this.list.length <= i) this.list.push(this.scene.add.image(0, 0, this.key).setDepth(this.depth).setVisible(false));
    return this.list[i];
  }
  /** 이번 프레임에 n개를 썼다: 나머지는 숨긴다 */
  end(n: number) {
    for (let i = n; i < this.shown; i++) this.list[i].setVisible(false);
    this.shown = n;
  }
}

/**
 * 게임 화면. 계산(game/sim.ts)의 상태를 그리기만 한다. 좌표는 계산과 같다 (판 720 × 880, 왼쪽 위가 0,0).
 * 길·배치 칸·입구/출구 표시는 처음에 한 번 그리고, 요괴·투사체·이펙트는 미리 만든 그림을 돌려 쓴다.
 */
export class GameScene extends Phaser.Scene {
  private run!: Run;
  private zoom = 1;
  private offY = 0;
  private onFrame!: () => void;
  private ground!: Phaser.GameObjects.TileSprite;
  private slots: Img[] = [];
  private towers: Img[] = [];
  private pips: Img[] = [];
  private charBase: number[] = [];
  private rangeG!: Phaser.GameObjects.Graphics;
  private selRing!: Img;
  private shadows!: SpritePool;
  private enemies!: SpritePool;
  private barBacks!: SpritePool;
  private barFills!: SpritePool;
  private dizzy!: SpritePool;
  private projs!: SpritePool;
  private fxs!: SpritePool;
  /** 그림 크기 (그리는 크기에 맞춰 줄이려고) */
  private texW = new Map<string, number>();
  /** 고른 칸과 사거리 (view 가 정한다). hint: 빈 칸들이 '여기에 놓을 수 있어요' 하고 통통거린다 */
  private selSlot = -1;
  private selRange = 0;
  private drawnSlot = -2;
  private drawnRange = -1;
  private hint = false;

  constructor() {
    super('game');
  }

  init(d: SceneData) {
    this.run = d.run;
    this.zoom = d.zoom;
    this.offY = d.offY;
    this.onFrame = d.onFrame;
    this.slots = [];
    this.towers = [];
    this.pips = [];
    this.charBase = [];
    this.texW.clear();
    this.selSlot = -1;
    this.drawnSlot = -2;
  }

  preload() {
    const s = this.run.state;
    const keys = stageEnemies(s.stage).map((id) => `e-${id}`);
    if (s.bossId >= 0) keys.push(bossKey(s.bossId));
    preloadArt(this, keys, s.squad.map((c) => TOWERS[c].id as ZodiacId));
    // 그림을 못 불러와도 게임은 진행한다 (create 에서 코드 그림으로 채운다)
    this.load.on('loaderror', () => undefined);
  }

  /** 화면 크기가 바뀌었을 때 (판은 그대로, 배율과 위치만) */
  setView(zoom: number, offY: number) {
    this.zoom = zoom;
    this.offY = offY;
    this.fitCamera();
  }

  /** 고른 칸(없으면 -1)과 보여 줄 사거리(0이면 원을 그리지 않는다) */
  setSelection(slot: number, range: number) {
    this.selSlot = slot;
    this.selRange = range;
  }

  /** 빈 칸들을 통통거리게 할까 (놓을 캐릭터를 고른 상태) */
  setHint(on: boolean) {
    this.hint = on;
  }

  /** 큰 일이 생겼을 때의 연출: boss 보스 처치(흔들림 + 번쩍) · leak 요괴가 지나감(짧은 흔들림) */
  burst(kind: 'boss' | 'leak') {
    const cam = this.cameras.main;
    if (!cam) return;
    if (kind === 'boss') {
      cam.shake(320, 0.012);
      cam.flash(220, 255, 255, 255);
    } else cam.shake(140, 0.006);
  }

  private fitCamera() {
    const cam = this.cameras.main;
    if (!cam) return;
    const viewH = this.scale.height / this.zoom;
    cam.setZoom(this.zoom);
    cam.centerOn(BOARD_W / 2, this.offY + viewH / 2);
    if (this.ground) this.ground.setPosition(BOARD_W / 2, this.offY + viewH / 2).setSize(BOARD_W + 16, viewH + 16);
    // 바닥 무늬를 판의 칸에 맞춘다 (타일 160 = 두 칸)
    if (this.ground) this.ground.setTilePosition(-8, this.offY - 8);
  }

  private w(key: string) {
    let v = this.texW.get(key);
    if (v === undefined) {
      v = this.textures.get(key).getSourceImage().width || 64;
      this.texW.set(key, v);
    }
    return v;
  }

  create() {
    const s = this.run.state;
    const bg = stageBg(s.stage);
    const squadIds = s.squad.map((c) => TOWERS[c].id as ZodiacId);
    ensureArt(this, bg, squadIds);
    this.cameras.main.setBackgroundColor(css(BG[bg].ground));
    this.cameras.main.setRoundPixels(false);
    this.ground = this.add.tileSprite(0, 0, 16, 16, tileKey(bg)).setDepth(D.ground);
    this.fitCamera();
    this.drawBoard(s);

    // 배치 칸과 그 위의 캐릭터·강화 별 (칸마다 하나씩 미리 만든다)
    for (let i = 0; i < s.towers.length; i++) {
      const x = s.slotX[i];
      const y = s.slotY[i];
      this.slots.push(this.add.image(x, y, 'slot').setDepth(D.slot).setScale(0.5));
      this.towers.push(this.add.image(x, y, 'px').setDepth(D.tower + y / 10000).setOrigin(0.5, 0.93).setVisible(false));
      this.pips.push(this.add.image(x, y + SLOT_SIZE / 2 + 4, pipKey(1)).setDepth(D.tower + 0.5).setScale(0.72).setVisible(false));
    }
    for (const c of s.squad) {
      const src = this.textures.get(zKey(TOWERS[c].id as ZodiacId)).getSourceImage();
      this.charBase[c] = Math.min(CHAR_H / src.height, CHAR_MAX_W / src.width);
    }
    this.rangeG = this.add.graphics().setDepth(D.range);
    this.selRing = this.add.image(0, 0, 'sel').setDepth(D.sel).setScale(0.5).setVisible(false);
    this.shadows = new SpritePool(this, 'shadow', D.shadow);
    this.enemies = new SpritePool(this, enemyKey(0), D.enemy);
    this.barBacks = new SpritePool(this, 'px', D.bar);
    this.barFills = new SpritePool(this, 'px', D.bar + 0.1);
    this.dizzy = new SpritePool(this, 'dizzy', D.bar + 0.2);
    this.projs = new SpritePool(this, PROJ_KEYS[0], D.proj);
    this.fxs = new SpritePool(this, 'ring', D.fx);
  }

  /** 길 · 입구 · 출구(마을 입구): 처음에 한 번만 그린다 */
  private drawBoard(s: State) {
    const c = BG[stageBg(s.stage)];
    const g = this.add.graphics().setDepth(D.road);
    const roads = s.routes.filter((r) => !r.air);
    // 테두리를 모든 길에 먼저, 그 위에 길 바닥 (갈라지고 합쳐지는 곳이 한 덩어리로 보인다)
    const pass = (w: number, color: number) => {
      g.lineStyle(w, color, 1).fillStyle(color, 1);
      for (const r of roads) {
        for (let i = 0; i + 1 < r.xs.length; i++) g.lineBetween(r.xs[i], r.ys[i], r.xs[i + 1], r.ys[i + 1]);
        for (let i = 0; i < r.xs.length; i++) g.fillCircle(r.xs[i], r.ys[i], w / 2);
      }
    };
    pass(ROAD_W + 10, COLOR.outline);
    pass(ROAD_W, c.road);
    // 길 가운데의 발자국 점
    const p = makePoint();
    g.fillStyle(c.dot, 1);
    for (const r of roads) for (let d = 20; d < r.len; d += 40) g.fillCircle(routePos(r, d, p.seg, p).x, p.y, 4);

    // 입구(요괴가 나오는 곳)와 출구(마을 입구) 표지판: 길이 판 가장자리를 지나는 자리에 세운다
    for (const r of s.routes) {
      const a = this.edge(r, false);
      const b = this.edge(r, true);
      if (!r.air) this.sign(a.x, a.y, '요괴', COLOR.pink, COLOR.white);
      this.sign(b.x, b.y, '마을', COLOR.primary, COLOR.ink);
    }
  }

  /** 길이 판 안으로 들어오는(또는 나가는) 자리에서 반 칸 안쪽 */
  private edge(r: Route, fromEnd: boolean) {
    const p = makePoint();
    const inside = (d: number) => {
      routePos(r, d, 0, p);
      return p.x >= 0 && p.x <= BOARD_W && p.y >= 0 && p.y <= BOARD_H;
    };
    let d = fromEnd ? r.len : 0;
    const stepLen = fromEnd ? -8 : 8;
    while (d >= 0 && d <= r.len && !inside(d)) d += stepLen;
    routePos(r, Math.max(0, Math.min(r.len, d + stepLen * (CELL / 16))), 0, p);
    return { x: p.x, y: p.y };
  }

  private sign(x: number, y: number, label: string, fill: number, ink: number) {
    const g = this.add.graphics().setDepth(D.sign);
    g.fillStyle(COLOR.outline, 1).fillRoundedRect(x - 34, y - 16, 68, 38, 14);
    g.fillStyle(fill, 1).fillRoundedRect(x - 34, y - 20, 68, 36, 14);
    g.lineStyle(3, COLOR.outline, 1).strokeRoundedRect(x - 34, y - 20, 68, 36, 14);
    this.add.text(x, y - 2, label, { fontFamily: FONT, fontSize: '22px', color: css(ink) }).setOrigin(0.5).setDepth(D.sign + 0.1).setResolution(Math.min(3, Math.max(1, this.zoom)));
  }

  update(time: number) {
    const run = this.run;
    run.update(time);
    const t0 = performance.now();
    const s = run.state;
    const sec = time / 1000;
    this.drawTowers(s, sec);
    this.drawSelection(s, sec);
    this.drawEnemies(s, sec);
    this.drawProjectiles(s, sec);
    this.drawFx(s);
    run.perf.drawMs = performance.now() - t0;
    this.onFrame();
  }

  private drawTowers(s: State, sec: number) {
    for (let i = 0; i < s.towers.length; i++) {
      const tw = s.towers[i];
      const slot = this.slots[i];
      const img = this.towers[i];
      const pip = this.pips[i];
      if (tw.char < 0) {
        if (img.visible) {
          img.setVisible(false);
          pip.setVisible(false);
          slot.setTexture('slot');
        }
        // 놓을 캐릭터를 골랐으면 빈 칸이 통통거린다
        slot.setScale(this.hint ? 0.5 * (1 + Math.sin(sec * 6 + i) * 0.05) : 0.5);
        continue;
      }
      const key = zKey(TOWERS[tw.char].id as ZodiacId);
      if (!img.visible || img.texture.key !== key) {
        img.setTexture(key).setVisible(true);
        slot.setTexture('slotOn').setScale(0.5);
      }
      const pk = pipKey(tw.lv);
      if (!pip.visible || pip.texture.key !== pk) pip.setTexture(pk).setVisible(true);
      // 공격하는 순간 겨눈 쪽으로 살짝 내밀며 늘어난다. 평소에는 숨 쉬듯 조금 움직인다
      const k = tw.since < 0.18 ? 1 - tw.since / 0.18 : 0;
      const breathe = Math.sin(sec * 3 + i * 1.7) * 0.025;
      const base = this.charBase[tw.char] ?? 0.4;
      // 십이지 그림은 모두 오른쪽을 본다: 왼쪽을 겨눌 때는 뒤집는다
      img
        .setPosition(s.slotX[i] + tw.face * 7 * k, s.slotY[i] + SLOT_SIZE / 2 - 8)
        .setScale(base * (1 - breathe + k * 0.06), base * (1 + breathe + k * 0.12))
        .setFlipX(tw.face < 0);
    }
  }

  private drawSelection(s: State, sec: number) {
    const slot = this.selSlot;
    if (slot !== this.drawnSlot || this.selRange !== this.drawnRange) {
      this.drawnSlot = slot;
      this.drawnRange = this.selRange;
      this.rangeG.clear();
      if (slot >= 0 && this.selRange > 0) {
        this.rangeG.fillStyle(COLOR.primary, 0.2).fillCircle(s.slotX[slot], s.slotY[slot], this.selRange);
        this.rangeG.lineStyle(4, COLOR.outline, 0.85).strokeCircle(s.slotX[slot], s.slotY[slot], this.selRange);
      }
      this.selRing.setVisible(slot >= 0);
      if (slot >= 0) this.selRing.setPosition(s.slotX[slot], s.slotY[slot]);
    }
    if (slot >= 0) this.selRing.setScale(0.5 * (1 + Math.sin(sec * 7) * 0.035));
  }

  private drawEnemies(s: State, sec: number) {
    let n = 0;
    let bars = 0;
    let stars = 0;
    for (let i = 0; i < s.enemyHi; i++) {
      const e = s.enemies[i];
      if (!e.alive) continue;
      const boss = e.boss >= 0;
      const key = boss ? bossKey(e.boss) : enemyKey(e.kind);
      const size = boss ? BOSSES[e.boss].size : ENEMIES[e.kind].size;
      const spr = this.enemies.get(n);
      const shadow = this.shadows.get(n);
      n++;
      if (spr.texture.key !== key) spr.setTexture(key).setDepth(boss ? D.boss : D.enemy);
      // 무리가 한 줄로 겹치지 않게 요괴마다 길 가운데에서 조금씩 비켜 걷는다 (그리기만. 판정은 길 가운데)
      const off = boss ? 0 : ((e.uid * 7919) % 17) - 8;
      let x = e.x - e.dy * off;
      const y = e.y + e.dx * off;
      const sc = size / this.w(key);
      // 걸으며 통통 (멈춘 요괴는 가만히). 벼르는 보스는 부들부들 떤다
      const wob = e.stun > 0 ? 0 : Math.sin(e.t * 9 + e.uid) * 0.06;
      if (boss && e.b === DASH.windup) x += Math.sin(sec * 70) * 3;
      const lift = e.air ? 26 : 0;
      spr.setPosition(x, y - size * 0.12 - lift).setScale(sc * (1 - wob), sc * (1 + wob)).setFlipX(e.dx < -0.1).setVisible(true);
      if (e.flash > 0) spr.setTintFill(COLOR.white);
      else if (e.stun > 0) spr.setTint(COLOR.skyMid);
      else if (boss && e.b === DASH.dash) spr.setTint(COLOR.primaryLight);
      else if (spr.isTinted) spr.clearTint();
      shadow.setPosition(x, y + size * 0.28).setScale(size / 96, size / 110).setAlpha(0.22).setVisible(true);
      // 체력 바: 다친 요괴와 보스만
      if (boss || e.hp < e.maxHp) {
        const w = boss ? 96 : 40;
        const k = Math.max(0, e.hp / e.maxHp);
        const by = y - size * 0.62 - lift;
        this.barBacks.get(bars).setPosition(x, by).setDisplaySize(w + 6, boss ? 14 : 10).setTint(COLOR.outline).setVisible(true);
        this.barFills.get(bars).setOrigin(0, 0.5).setPosition(x - w / 2, by).setDisplaySize(w * k, boss ? 8 : 5).setTint(k < 0.35 ? COLOR.lose : boss ? COLOR.pink : COLOR.win).setVisible(true);
        bars++;
      }
      if (e.stun > 0) this.dizzy.get(stars++).setPosition(x, y - size * 0.8 - lift).setScale(0.55).setRotation(sec * 5).setVisible(true);
    }
    this.enemies.end(n);
    this.shadows.end(n);
    this.barBacks.end(bars);
    this.barFills.end(bars);
    this.dizzy.end(stars);
  }

  private drawProjectiles(s: State, sec: number) {
    const list = s.projectiles.items;
    const n = s.projectiles.n;
    for (let i = 0; i < n; i++) {
      const pr = list[i];
      const spr = this.projs.get(i);
      const key = PROJ_KEYS[pr.kind] ?? PROJ_KEYS[0];
      if (spr.texture.key !== key) spr.setTexture(key);
      if (pr.kind === PROJ.cake) {
        // 포물선: 가운데에서 가장 높이 뜨고 조금 커 보인다
        const h = Math.sin(Math.PI * Math.min(1, pr.t / pr.dur));
        spr.setPosition(pr.x, pr.y - h * 70).setScale(0.5 * (1 + h * 0.4)).setRotation(sec * 6).setVisible(true);
      } else spr.setPosition(pr.x, pr.y).setScale(0.5).setRotation(sec * 18).setVisible(true);
    }
    this.projs.end(n);
  }

  private drawFx(s: State) {
    const list = s.fx.items;
    const n = s.fx.n;
    for (let i = 0; i < n; i++) {
      const f = list[i];
      const spr = this.fxs.get(i);
      const k = 1 - f.life / f.maxLife; // 0 → 1
      let key = 'ring';
      let sc = (f.r * 2) / 242;
      let tint: number = COLOR.white;
      let alpha = 1 - k;
      let rot = 0;
      switch (f.kind) {
        case FX.pulse:
          // 소의 방울: 노란 고리가 사거리까지 퍼진다
          tint = COLOR.primary;
          sc *= 0.25 + k * 0.75;
          alpha = 0.9 * (1 - k * k);
          break;
        case FX.slash:
          key = 'slash';
          sc = (f.r * 2.2) / 256;
          rot = f.a;
          alpha = 1 - k * k;
          break;
        case FX.burst:
          // 달떡이 터진 자리
          key = 'disc';
          sc = ((f.r * 2) / 252) * (0.5 + k * 0.5);
          tint = COLOR.primaryLight;
          alpha = 0.75 * (1 - k);
          break;
        case FX.pop:
          sc *= 0.5 + k * 0.7;
          alpha = 0.9 * (1 - k);
          break;
        case FX.leak:
          tint = COLOR.pink;
          sc *= 0.3 + k * 0.9;
          break;
      }
      if (spr.texture.key !== key) spr.setTexture(key);
      spr.setPosition(f.x, f.y).setScale(sc).setRotation(rot).setTint(tint).setAlpha(alpha).setVisible(true);
    }
    this.fxs.end(n);
  }
}

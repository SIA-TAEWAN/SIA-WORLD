import Phaser from 'phaser';
import { PLAYER } from '../data/balance';
import { ENEMIES } from '../data/enemies';
import { bossWinding } from '../game/bosses';
import { FX, MODE, PROJ, ZONE, type State } from '../game/state';
import { eachObstacle } from '../game/terrain';
import type { Run } from '../run/run';
import { COLOR, css } from '../theme';
import { BOSS_DRAW, ENEMY_DRAW, ITEM_KEYS, MAP_BG, NUM_FONT, PROJ_KEYS, bossKey, enemyKey, ensureArt, obstacleKey, preloadArt, tileKey, zKey } from './art';

export interface SceneData {
  run: Run;
  /** 기준 1px(가로 720 기준)이 캔버스 몇 픽셀인가 (화면 배율 × 기기 픽셀 배율) */
  zoom: number;
  /** 피해 숫자를 보여 줄까 (설정) */
  showNumbers: () => boolean;
  /** 매 프레임, 계산이 끝난 뒤 (HUD 갱신용) */
  onFrame: () => void;
}

type Img = Phaser.GameObjects.Image;

/** 캐릭터 그림 높이 (판정 원 지름 32보다 넉넉하게) */
const CHAR_H = 92;
const CHAR_MAX_W = 96;
/** 그림 깊이 */
const D = { ground: 0, water: 0.5, zone: 1, aura: 2, item: 3, wall: 3.5, enemy: 4, boss: 5, ring: 6, player: 8, proj: 9, fx: 10, bar: 11, num: 12 };
/** 지대 색 (state.ts 의 ZONE 순서): 독안개 · 예고 · 독 · 불길 · 물기둥 · 양털 구름 · 말발굽 */
const ZONE_TINT = [COLOR.win, COLOR.pink, COLOR.draw, COLOR.lose, COLOR.teamA, COLOR.white, COLOR.inkSoft];
/** 두 색을 섞는다 (t: b 쪽으로 얼마나) */
const mix = (a: number, b: number, t: number) => {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
/**
 * 헬 모드의 색 (DESIGN.md 의 --pink 와 어두운 갈색 --outline 만 섞어 쓴다. 그림에 곱해진다):
 *   바닥·장애물만 검붉게 어둡게, 요괴·보스는 약한 붉은 기운만. 내 캐릭터·투사체·아이템·숫자는 그대로라 대비로 더 잘 보인다
 */
const HELL_TINT = {
  // 바닥·장애물: 검붉은 갈색으로 크게 어둡게 (밝은 캐릭터·요괴가 대비로 살아난다)
  ground: mix(COLOR.pink, COLOR.outline, 0.52),
  // 요괴·보스: 아주 약한 붉은 기운만 (윤곽·눈은 또렷하게)
  enemy: mix(COLOR.pink, COLOR.white, 0.78),
  boss: mix(COLOR.pink, COLOR.white, 0.7),
};

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
 * 게임 화면. 계산(game/sim.ts)의 상태를 그리기만 한다. 좌표는 계산과 같고, 카메라가 내 캐릭터를 따라다닌다.
 * 그림은 임시(코드로 그린 도형 + 십이지 전신 그림을 코드로 움직임).
 */
export class GameScene extends Phaser.Scene {
  private run!: Run;
  private zoom = 1;
  private showNumbers!: () => boolean;
  private onFrame!: () => void;
  private ground!: Phaser.GameObjects.TileSprite;
  private player!: Img;
  private outline: Img[] = [];
  private ring!: Img;
  private shadow!: Img;
  private hpBack!: Phaser.GameObjects.Rectangle;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private charBase = 1;
  private stride = 0;
  private enemies!: SpritePool;
  private projs!: SpritePool;
  private zones!: SpritePool;
  private zoneCores!: SpritePool;
  private auras!: SpritePool;
  private items!: SpritePool;
  private fxs!: SpritePool;
  private obstacles!: SpritePool;
  private obN = 0;
  /** 레벨업·진화 때 내 둘레로 퍼지는 고리 (남은 시간) */
  private glow!: Img;
  private glowT = 0;
  private glowTint: number = COLOR.primary;
  private nums: Phaser.GameObjects.BitmapText[] = [];
  private numShown = 0;
  /** 그림 크기 (판정 반지름에 맞춰 줄이려고) */
  private texW = new Map<string, number>();

  constructor() {
    super('game');
  }

  init(d: SceneData) {
    this.run = d.run;
    this.zoom = d.zoom;
    this.showNumbers = d.showNumbers;
    this.onFrame = d.onFrame;
    this.outline = [];
    this.nums = [];
    this.numShown = 0;
    this.texW.clear();
  }

  preload() {
    preloadArt(this, this.run.state.char.id);
    // 그림을 못 불러와도 게임은 진행한다 (create에서 코드 그림으로 채운다)
    this.load.on('loaderror', () => undefined);
  }

  /**
   * 큰 일이 생겼을 때의 연출: level 레벨업(노란 고리) · evolve 진화·부활(분홍 고리 + 번쩍) · boss 보스 처치(흔들림 + 번쩍)
   */
  burst(kind: 'level' | 'evolve' | 'boss') {
    const cam = this.cameras.main;
    if (!cam) return;
    if (kind === 'boss') {
      cam.shake(320, 0.012);
      cam.flash(220, 255, 255, 255);
      return;
    }
    this.glowT = 0.55;
    this.glowTint = kind === 'level' ? COLOR.primary : COLOR.pink;
    if (kind === 'evolve') cam.flash(260, 255, 224, 102);
  }

  /** 화면 크기가 바뀌었을 때 (판은 그대로, 배율만) */
  setZoom(zoom: number) {
    this.zoom = zoom;
    this.cameras.main?.setZoom(zoom);
    this.fitGround();
  }

  private viewW() {
    return this.scale.width / this.zoom;
  }
  private viewH() {
    return this.scale.height / this.zoom;
  }

  private fitGround() {
    if (this.ground) this.ground.setSize(this.viewW() + 8, this.viewH() + 8);
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
    ensureArt(this, s.char.id, s.map.id);
    const cam = this.cameras.main;
    cam.setZoom(this.zoom);
    cam.setBackgroundColor(css(MAP_BG[s.map.id] ?? COLOR.skyMid));
    cam.setRoundPixels(false);

    // 바닥: 타일 무늬가 캐릭터를 따라 흘러서 움직임이 보인다
    this.ground = this.add.tileSprite(0, 0, 16, 16, tileKey(s.map.id)).setDepth(D.ground);
    if (s.hell) this.ground.setTint(HELL_TINT.ground);
    this.fitGround();

    this.zones = new SpritePool(this, 'disc', D.zone);
    this.zoneCores = new SpritePool(this, 'disc', D.zone);
    this.auras = new SpritePool(this, 'disc', D.aura);
    this.items = new SpritePool(this, ITEM_KEYS[0], D.item);
    this.enemies = new SpritePool(this, enemyKey(0), D.enemy);
    this.projs = new SpritePool(this, PROJ_KEYS[0], D.proj);
    this.fxs = new SpritePool(this, 'ring', D.fx);
    // 장애물: 물길은 바닥에 깔리고, 대나무·담은 아이템 위·요괴 아래에 선다
    this.obstacles = new SpritePool(this, obstacleKey(s.map.terrain.kind === 'none' ? 'scatter' : s.map.terrain.kind), s.map.terrain.kind === 'pools' ? D.water : D.wall);

    // 내 캐릭터: 발밑 원 + 흰 테두리(같은 그림을 흰색으로 네 방향에 겹침) + 그림. 적이 많아도 잘 보이게 가장 위에 그린다
    this.shadow = this.add.image(0, 0, 'shadow').setAlpha(0.25).setDepth(D.ring);
    this.ring = this.add.image(0, 0, 'pring').setDepth(D.ring).setScale((PLAYER.r * 2 + 20) / 128);
    const key = zKey(s.char.id);
    const src = this.textures.get(key).getSourceImage();
    this.charBase = Math.min(CHAR_H / src.height, CHAR_MAX_W / src.width);
    for (let i = 0; i < 4; i++) this.outline.push(this.add.image(0, 0, key).setOrigin(0.5, 0.9).setDepth(D.player).setTintFill(COLOR.white));
    this.player = this.add.image(0, 0, key).setOrigin(0.5, 0.9).setDepth(D.player + 1);
    this.glow = this.add.image(0, 0, 'ring').setDepth(D.fx).setVisible(false);
    // 캐릭터 아래 작은 체력 바
    this.hpBack = this.add.rectangle(0, 0, 60, 11, COLOR.outline).setDepth(D.bar);
    this.hpFill = this.add.rectangle(0, 0, 54, 5, COLOR.win).setOrigin(0, 0.5).setDepth(D.bar);
  }

  update(time: number) {
    const run = this.run;
    run.update(time);
    const t0 = performance.now();
    const s = run.state;
    const p = s.player;
    const cam = this.cameras.main;
    cam.centerOn(p.x, p.y);
    this.ground.setPosition(p.x, p.y);
    this.ground.tilePositionX = p.x;
    this.ground.tilePositionY = p.y;
    const halfW = this.viewW() / 2 + 70;
    const halfH = this.viewH() / 2 + 70;
    const sec = time / 1000;

    this.drawObstacles(s, halfW, halfH);
    this.drawZones(s, sec);
    this.drawItems(s, halfW, halfH, sec);
    this.drawEnemies(s, halfW, halfH);
    this.drawPlayer(s, run.paused ? 0 : (this.game.loop.delta / 1000) * run.speed);
    this.drawProjectiles(s, sec);
    this.drawFx(s);
    // 레벨업·진화: 내 둘레로 고리가 퍼진다
    if (this.glowT > 0) {
      this.glowT -= this.game.loop.delta / 1000;
      const k = 1 - Math.max(0, this.glowT) / 0.55;
      this.glow.setPosition(p.x, p.y).setScale(0.3 + k * 1.5).setTint(this.glowTint).setAlpha(1 - k).setVisible(this.glowT > 0);
    }
    this.drawNums(s);
    run.perf.drawMs = performance.now() - t0;
    this.onFrame();
  }

  /** 화면에 보이는 칸의 장애물 (칸 좌표와 시드로 그때그때 계산한다) */
  private putObstacle = (x: number, y: number, r: number) => {
    const spr = this.obstacles.get(this.obN++);
    // 물길은 판정 원 그대로, 대나무·담은 조금 크게 (위로 솟은 그림)
    const k = this.run.state.map.terrain.kind === 'pools' ? 2.06 : 2.5;
    spr.setPosition(x, y - (k > 2.1 ? r * 0.2 : 0)).setScale((r * k) / 128).setVisible(true);
    if (this.run.state.hell && !spr.isTinted) spr.setTint(HELL_TINT.ground);
  };
  private drawObstacles(s: State, halfW: number, halfH: number) {
    this.obN = 0;
    eachObstacle(s.map.terrain, s.terrainSeed, s.player.x, s.player.y, halfW + 80, halfH + 80, this.putObstacle);
    this.obstacles.end(this.obN);
  }

  private drawEnemies(s: State, halfW: number, halfH: number) {
    const p = s.player;
    const list = s.enemies.items;
    const n = s.enemies.n;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      const spr = this.enemies.get(i);
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      // 화면 밖의 적은 그리지 않는다
      if (dx > halfW + e.r || dx < -halfW - e.r || dy > halfH + e.r || dy < -halfH - e.r) {
        spr.setVisible(false);
        continue;
      }
      const boss = e.boss >= 0;
      // 분신·부하는 보스 그림을 작게 그린다
      const big = boss || e.look >= 0;
      const key = boss ? bossKey(e.boss) : e.look >= 0 ? bossKey(e.look) : enemyKey(e.kind);
      if (spr.texture.key !== key) spr.setTexture(key).setDepth(boss ? D.boss : D.enemy);
      let sc = (e.r * 2 * (big ? BOSS_DRAW : ENEMY_DRAW)) / this.w(key);
      // 걸으며 통통: 요괴마다 박자가 다르게
      const wob = Math.sin(e.t * 9 + e.uid) * 0.06;
      let x = e.x;
      let alpha = e.look >= 0 ? 0.82 : 1;
      let rot = 0;
      if (boss && bossWinding(s, e)) x += Math.sin(e.patT * 60) * 4;
      if (e.hidden) {
        if (boss) alpha = 0.08; // 숨은 보스(장산범): 거의 보이지 않는다
        else if (e.sub === 0) sc *= 0.45; // 땅속의 죽순: 작은 싹만 보인다
        else if (ENEMIES[e.kind].move === 'ambush') sc *= 0.45 + 0.55 * (1 - Math.max(0, e.patT) / 0.4); // 튀어나오는 중
        else {
          // 쓰러진 해골 병사: 옆으로 누워 있다
          rot = Math.PI / 2;
          alpha = 0.55;
        }
      }
      spr.setPosition(x, e.y).setScale(sc * (1 - wob), sc * (1 + wob)).setFlipX(dx > 0).setRotation(rot).setAlpha(alpha).setVisible(true);
      if (e.flash > 0) spr.setTintFill(COLOR.white);
      else if (e.slow > 0) spr.setTint(COLOR.skyMid); // 느려진 요괴
      else if (e.guard < 1) spr.setTint(COLOR.primaryLight); // 방패를 든 보스
      else if (s.hell) spr.setTint(boss ? HELL_TINT.boss : HELL_TINT.enemy); // 헬 모드: 요괴에 붉은 기운
      else if (spr.isTinted) spr.clearTint();
    }
    this.enemies.end(n);
  }

  private drawPlayer(s: State, dt: number) {
    const p = s.player;
    if (p.moving) this.stride += dt * 13;
    const bob = p.moving ? Math.abs(Math.sin(this.stride)) * 6 : 0;
    const tilt = p.moving ? Math.sin(this.stride) * 0.09 : 0;
    const breathe = p.moving ? 0 : Math.sin(this.time.now / 320) * 0.025;
    const sx = this.charBase * (1 - breathe);
    const sy = this.charBase * (1 + breathe);
    const y = p.y + 26 - bob;
    // 십이지 그림은 모두 오른쪽을 본다: 왼쪽으로 갈 때는 뒤집는다
    const flip = p.fx < -0.05 ? true : p.fx > 0.05 ? false : this.player.flipX;
    // 무적 중에는 깜빡인다
    const alpha = p.inv > 0 && Math.floor(p.inv / 4) % 2 === 0 ? 0.45 : 1;
    this.player.setPosition(p.x, y).setScale(sx, sy).setRotation(tilt).setFlipX(flip).setAlpha(alpha);
    // 느려졌을 때는 푸르스름하게
    if (p.slow > 0) this.player.setTint(COLOR.skyMid);
    else if (this.player.isTinted) this.player.clearTint();
    const o = 2.6;
    for (let i = 0; i < 4; i++) {
      this.outline[i]
        .setPosition(p.x + (i === 0 ? -o : i === 1 ? o : 0), y + (i === 2 ? -o : i === 3 ? o : 0))
        .setScale(sx, sy)
        .setRotation(tilt)
        .setFlipX(flip)
        .setAlpha(alpha);
    }
    // 발밑 원은 숨 쉬듯 조금 커졌다 작아진다 (적 사이에서도 내 자리가 눈에 띄게)
    this.ring.setPosition(p.x, p.y + 14).setScale(((PLAYER.r * 2 + 26) / 128) * (1 + Math.sin(this.time.now / 260) * 0.06));
    this.shadow.setPosition(p.x, p.y + 26).setScale(1 - bob / 30);
    const k = Math.max(0, Math.min(1, p.hp / s.stats.maxHp));
    this.hpBack.setPosition(p.x, p.y + 42);
    this.hpFill.setPosition(p.x - 27, p.y + 42).setSize(54 * k, 5).setFillStyle(k < 0.3 ? COLOR.lose : COLOR.win);
  }

  private drawProjectiles(s: State, sec: number) {
    const list = s.projectiles.items;
    const n = s.projectiles.n;
    for (let i = 0; i < n; i++) {
      const pr = list[i];
      const spr = this.projs.get(i);
      const key = PROJ_KEYS[pr.kind] ?? PROJ_KEYS[0];
      if (spr.texture.key !== key) spr.setTexture(key);
      let y = pr.y;
      // 강아지는 판정 원보다 넉넉하게 그린다 (작아서 안 보이지 않게)
      let sc = (pr.r * (pr.kind === PROJ.puppy ? 3.6 : 2.4)) / this.w(key);
      if (pr.mode === MODE.lob) {
        // 포물선: 가운데에서 가장 높이 뜨고 조금 커 보인다
        const h = Math.sin(Math.PI * pr.t);
        y -= h * 110;
        sc *= 1 + h * 0.5;
      }
      spr.setPosition(pr.x, y).setScale(sc).setVisible(true).setFlipX(false);
      if (pr.kind === PROJ.shuriken || pr.kind === PROJ.shurikenEvo) spr.setRotation(sec * 16);
      else if (pr.kind === PROJ.feather) spr.setRotation(pr.a);
      else if (pr.kind === PROJ.pig) {
        // 복돼지: 달리는 쪽을 본다 (왼쪽으로 갈 때는 뒤집는다), 통통 튄다
        spr.setRotation(0).setFlipX(pr.vx < 0).setY(y - Math.abs(Math.sin(sec * 18)) * 8);
      } else if (pr.kind === PROJ.puppy) spr.setRotation(0).setFlipX(pr.vx < 0).setY(y - Math.abs(Math.sin(sec * 12 + i)) * 5);
      else spr.setRotation(0);
    }
    this.projs.end(n);
  }

  private drawZones(s: State, sec: number) {
    const list = s.zones.items;
    const n = s.zones.n;
    let cores = 0;
    for (let i = 0; i < n; i++) {
      const z = list[i];
      const spr = this.zones.get(i);
      const sc = (z.r * 2) / 252;
      const tint = ZONE_TINT[z.kind] ?? COLOR.pink;
      if (z.owner === 0) {
        // 내 지대: 독안개(초록)·양털 구름(흰색)은 숨 쉬듯 일렁이고 끝날 때 옅어진다, 말발굽은 한 번 번쩍
        const fade = Math.min(1, z.life / 0.4) * Math.min(1, (z.maxLife - z.life) / 0.2);
        const a = z.kind === ZONE.hoof ? 0.55 * (z.life / z.maxLife) : z.kind === ZONE.cloud ? 0.5 * fade : 0.38 * fade;
        spr.setPosition(z.x, z.y).setScale(sc * (1 + Math.sin(sec * 5 + i) * 0.04)).setTint(tint).setAlpha(a).setVisible(true);
      } else if (z.delay > 0) {
        // 보스의 범위 공격: 분홍 원이 미리 보이고, 안쪽 원이 다 차면 터진다
        spr.setPosition(z.x, z.y).setScale(sc).setTint(COLOR.pink).setAlpha(0.26).setVisible(true);
        const k = 1 - z.delay / z.windup;
        this.zoneCores.get(cores++).setPosition(z.x, z.y).setScale(sc * k).setTint(tint).setAlpha(0.42).setVisible(true);
      } else {
        // 터진 뒤: 불길·독은 바닥에 남아 일렁인다 (그 안에 있으면 계속 아프다)
        const stay = z.tick > 0 ? 0.5 * Math.min(1, z.life / 0.5) * (0.85 + Math.sin(sec * 9 + i) * 0.15) : 0.5 * (z.life / z.maxLife);
        spr.setPosition(z.x, z.y).setScale(sc).setTint(tint).setAlpha(stay).setVisible(true);
      }
    }
    this.zones.end(n);
    this.zoneCores.end(cores);
    // 방울 장판: 내 둘레의 노란 원
    let a = 0;
    for (const w of s.weapons) {
      if (w.view <= 0) continue;
      this.auras.get(a++).setPosition(s.player.x, s.player.y).setScale((w.view * 2) / 252).setTint(COLOR.primary).setAlpha(0.2 + Math.sin(sec * 6) * 0.04).setVisible(true);
    }
    this.auras.end(a);
  }

  private drawItems(s: State, halfW: number, halfH: number, sec: number) {
    const p = s.player;
    const list = s.pickups.items;
    const n = s.pickups.n;
    for (let i = 0; i < n; i++) {
      const it = list[i];
      const spr = this.items.get(i);
      const dx = it.x - p.x;
      const dy = it.y - p.y;
      if (dx > halfW || dx < -halfW || dy > halfH || dy < -halfH) {
        spr.setVisible(false);
        continue;
      }
      const key = ITEM_KEYS[it.kind] ?? ITEM_KEYS[0];
      if (spr.texture.key !== key) spr.setTexture(key);
      // 구슬·엽전은 작게, 떡·복주머니·부적·보물상자는 눈에 띄게 통통 뛴다
      const big = it.kind >= 4;
      const sc = (it.kind === 7 ? 0.85 : big ? 0.7 : 0.72) * (big ? 1 + Math.sin(sec * 6 + i) * 0.08 : 1);
      spr.setPosition(it.x, it.y).setScale(sc).setVisible(true);
    }
    this.items.end(n);
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
        case FX.slash:
          // 발톱: 부채꼴이 휙 그어진다 (사방 베기는 둥근 원)
          key = f.b >= Math.PI ? 'disc' : 'slash';
          sc = (f.r * 2) / 248;
          rot = f.b >= Math.PI ? 0 : f.a;
          alpha = 0.6 * (1 - k);
          sc *= 0.75 + k * 0.25;
          break;
        case FX.burst:
          key = 'disc';
          sc = ((f.r * 2) / 252) * (0.5 + k * 0.5);
          tint = COLOR.primaryLight;
          alpha = 0.7 * (1 - k);
          break;
        case FX.pulse:
          tint = COLOR.primary;
          sc *= 0.85 + k * 0.15;
          alpha = 0.5 * (1 - k);
          break;
        case FX.puff:
          key = 'disc';
          sc = ((f.r * 2.4) / 252) * (0.6 + k * 0.7);
          alpha = 0.6 * (1 - k);
          break;
        case FX.shock:
          tint = COLOR.pink;
          sc *= 0.4 + k * 0.6;
          alpha = 0.9 * (1 - k);
          break;
        case FX.beam:
          // 여의봉: 손에서 길게 뻗었다가 사라진다 (그림의 왼쪽 끝이 손)
          key = 'beam';
          rot = f.a;
          alpha = 1 - k * k;
          break;
      }
      if (spr.texture.key !== key) spr.setTexture(key);
      if (f.kind === FX.beam) {
        const grow = Math.min(1, k * 4 + 0.35);
        spr.setOrigin(0, 0.5).setPosition(f.x, f.y).setScale((f.r * grow) / 256, f.b / 36).setRotation(rot).clearTint().setAlpha(alpha).setVisible(true);
        continue;
      }
      spr.setOrigin(0.5, 0.5).setPosition(f.x, f.y).setScale(sc).setRotation(rot).setTint(tint).setAlpha(alpha).setVisible(true);
    }
    this.fxs.end(n);
  }

  private drawNums(s: State) {
    const n = this.showNumbers() ? s.nums.n : 0;
    const list = s.nums.items;
    for (let i = 0; i < n; i++) {
      const m = list[i];
      let t = this.nums[i];
      if (!t) {
        t = this.add.bitmapText(0, 0, NUM_FONT, '0').setOrigin(0.5).setDepth(D.num);
        t.setData('v', -1);
        this.nums[i] = t;
      }
      const v = Math.max(1, Math.round(m.v));
      if (t.getData('v') !== v) {
        t.setText(String(v));
        t.setData('v', v);
      }
      const k = 1 - m.life / 0.6;
      // 내가 받은 피해는 분홍으로 크게, 회복은 초록
      t.setPosition(m.x, m.y - k * 34)
        .setScale(m.kind === 1 ? 0.8 : 0.5)
        .setTint(m.kind === 1 ? COLOR.pink : m.kind === 2 ? COLOR.win : COLOR.white)
        .setAlpha(Math.min(1, m.life / 0.2))
        .setVisible(true);
    }
    for (let i = n; i < this.numShown; i++) this.nums[i]?.setVisible(false);
    this.numShown = n;
  }
}

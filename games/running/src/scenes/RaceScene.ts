import Phaser from 'phaser';
import { JUMP_TIME, LANES, SLIDE_TIME, TRACK_LEN, isCharId, type ZodiacId } from '../game/constants';
import { livePlace } from '../game/ranking';
import type { RunState } from '../game/sim';
import type { Obstacle } from '../game/track';
import type { RaceEvent, RaceGame, RunnerView } from '../race/game';
import { COLOR, FONT, css } from '../theme';
import { zodiacFaceUrl } from '../assets';
import { ensureArt, preloadArt, zKey } from './art';

export interface SceneData {
  race: RaceGame;
  /** 화면 CSS 크기 (픽셀 배율은 카메라가 곱한다) */
  width: number;
  height: number;
  dpr: number;
  /** 효과음 (내 캐릭터에게 생긴 일) */
  sfx: (name: string, opts?: { volume?: number; rate?: number }) => void;
  /** 매 프레임 (HUD 갱신용) */
  onFrame: () => void;
}

/** 화면 왼쪽에서 내 캐릭터까지 (화면 너비 비율) */
const FOCUS = 0.15;
/** 내 캐릭터 앞으로 보이는 거리 (m) */
const AHEAD_M = 7;
/** 배경(하늘·관중석)이 차지하는 높이 비율 */
const BG_RATIO = 0.2;

interface Actor {
  slot: number;
  row: number;
  char: ZodiacId;
  spr: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  labelText: Phaser.GameObjects.Text;
  labelBg: Phaser.GameObjects.Graphics;
  rankText: Phaser.GameObjects.Text;
  arrow: Phaser.GameObjects.Container;
  arrowText: Phaser.GameObjects.Text;
  arrowBg: Phaser.GameObjects.Graphics;
  /** 달리기 걸음 위상 */
  stride: number;
  lastX: number;
  state: RunState;
  /** 지금 상태가 된 뒤 흐른 시간 (초) */
  since: number;
  dustT: number;
  ghostT: number;
  mudT: number;
  lastRank: number;
  lastArrow: string;
  logSpr: Phaser.GameObjects.Image | null;
  logLastX: number;
}

interface ObSprite {
  o: Obstacle;
  row: number;
  img: Phaser.GameObjects.Image;
  /** 낮은 막대 위의 '슬라이딩' 표시 (내 레인만) */
  badge?: Phaser.GameObjects.Container;
}

/** 경주 화면: 가로 레인 4줄, 내 캐릭터가 맨 아래 레인. 카메라는 내 캐릭터를 화면 왼쪽 15%에 둔다 */
export class RaceScene extends Phaser.Scene {
  private race!: RaceGame;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private sfx!: SceneData['sfx'];
  private onFrame!: () => void;
  private ppm = 40;
  private bgH = 0;
  private laneH = 0;
  private camX = 0;
  private sky!: Phaser.GameObjects.TileSprite;
  private stands!: Phaser.GameObjects.TileSprite;
  private lanes: Phaser.GameObjects.TileSprite[] = [];
  private actors: Actor[] = [];
  private obSprites: ObSprite[] = [];
  private lineSprites: { x: number; img: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite; text?: Phaser.GameObjects.Text; dy?: number }[] = [];
  private stepT = 0;

  constructor() {
    super('race');
  }

  init(d: SceneData) {
    this.race = d.race;
    this.W = d.width;
    this.H = d.height;
    this.dpr = d.dpr;
    this.sfx = d.sfx;
    this.onFrame = d.onFrame;
    this.lanes = [];
    this.actors = [];
    this.obSprites = [];
    this.lineSprites = [];
  }

  preload() {
    const chars = this.race.roster.map((r) => r.char);
    preloadArt(this, chars);
    for (const id of chars) if (isCharId(id) && !this.textures.exists(`f-${id}`)) this.load.image(`f-${id}`, zodiacFaceUrl(id));
    // 그림을 못 불러와도 게임은 진행한다 (create에서 코드 그림으로 채운다)
    this.load.on('loaderror', () => undefined);
  }

  /** 내 자리가 맨 아래(3), 고스트는 내 바로 위(2), 나머지(AI)는 자리 순서대로 위에서부터 */
  private rowOf(slot: number): number {
    const me = this.race.mySlot;
    if (me < 0) return slot;
    if (slot === me) return LANES - 1;
    const roster = this.race.roster;
    const ghost = roster.find((r) => r.role === 'ghost')?.slot ?? -1;
    if (slot === ghost) return LANES - 2;
    return roster.filter((r) => r.slot !== me && r.slot !== ghost && r.slot < slot).length;
  }

  /** 고스트 자리인가 (반투명으로 그린다) */
  private isGhost(slot: number): boolean {
    return this.race.roster[slot]?.role === 'ghost';
  }

  private laneTop(row: number) {
    return this.bgH + row * this.laneH;
  }
  /** 발이 닿는 높이 */
  private groundY(row: number) {
    return this.laneTop(row) + this.laneH * 0.86;
  }
  private sx(xm: number) {
    return (xm - this.camX) * this.ppm;
  }

  private text(x: number, y: number, s: string, size: number, color = COLOR.ink) {
    return this.add
      .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color: css(color) })
      .setOrigin(0.5)
      .setResolution(Math.max(2, this.dpr));
  }

  create() {
    const { W, H } = this;
    const chars = this.race.roster.map((r) => r.char);
    ensureArt(this, chars);
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    cam.setZoom(this.dpr);
    cam.setBackgroundColor(css(COLOR.skyMid));

    this.ppm = (W * (1 - FOCUS)) / AHEAD_M;
    this.bgH = Math.round(H * BG_RATIO);
    this.laneH = (H - this.bgH) / LANES;

    // 배경 2겹 (하늘 느리게, 관중석 조금 빠르게)
    const skyTex = this.textures.get('sky').getSourceImage();
    const standsTex = this.textures.get('stands').getSourceImage();
    const skyS = this.bgH / skyTex.height;
    this.sky = this.add.tileSprite(0, 0, W, this.bgH, 'sky').setOrigin(0).setTileScale(skyS).setDepth(0);
    const standsH = this.bgH * 0.78;
    const stS = standsH / standsTex.height;
    this.stands = this.add.tileSprite(0, this.bgH - standsH, W, standsH, 'stands').setOrigin(0).setTileScale(stS).setDepth(1);

    // 레인 4줄: 내 레인(맨 아래)은 밝게, 나머지는 조금 어둡게
    const trackTex = this.textures.get('track').getSourceImage();
    for (let row = 0; row < LANES; row++) {
      const lane = this.add.tileSprite(0, this.laneTop(row), W, this.laneH, 'track').setOrigin(0).setDepth(2);
      lane.setTileScale(this.laneH / trackTex.height);
      if (row !== this.rowOf(Math.max(0, this.race.mySlot))) lane.setTint(0xe6e6e6);
      this.lanes.push(lane);
    }
    const g = this.add.graphics().setDepth(3);
    g.fillStyle(COLOR.outline, 1).fillRect(0, this.bgH - 2, W, 4);
    for (let row = 1; row < LANES; row++) g.fillStyle(COLOR.white, 0.9).fillRect(0, this.laneTop(row) - 1.5, W, 3);

    // 출발선·결승선·10m 표지
    const trackH = H - this.bgH;
    const mkLine = (key: string, x: number, wM: number) => {
      const tex = this.textures.get(key).getSourceImage();
      const w = wM * this.ppm;
      const img = this.add.tileSprite(0, this.bgH, w, trackH, key).setOrigin(0.5, 0).setDepth(4);
      img.setTileScale(w / tex.width);
      this.lineSprites.push({ x, img });
    };
    mkLine('start', 0, 0.45);
    mkLine('finish', TRACK_LEN, 0.9);
    {
      // 결승선 깃발 (관중석 앞)
      const tex = this.textures.get('flag').getSourceImage();
      const fh = this.bgH * 0.62;
      const img = this.add.image(0, this.bgH + 3, 'flag').setOrigin(0.1, 1).setDepth(5);
      img.setScale(fh / tex.height);
      this.lineSprites.push({ x: TRACK_LEN, img });
    }
    for (let m = 10; m < TRACK_LEN; m += 10) {
      const mw = Math.min(58, this.bgH * 0.56);
      const tex = this.textures.get('marker').getSourceImage();
      const img = this.add.image(0, this.bgH + 2, 'marker').setOrigin(0.5, 1).setDepth(5);
      img.setScale(mw / tex.width);
      const mh = (mw / tex.width) * tex.height;
      const text = this.text(0, 0, `${m}m`, Math.max(11, Math.round(mw * 0.27))).setDepth(6);
      this.lineSprites.push({ x: m, img, text, dy: this.bgH + 2 - mh * 0.66 });
    }

    // 방해물: 4개 레인에 같은 배치
    for (let row = 0; row < LANES; row++) {
      for (const o of this.race.obs) {
        if (o.kind === 'log') continue;
        const img = this.add.image(0, 0, o.kind).setDepth(10 + row * 10);
        const tex = img.texture.getSourceImage();
        const gy = this.groundY(row);
        if (o.kind === 'mudShort' || o.kind === 'mudLong') {
          img.setOrigin(0, 0.5).setDisplaySize(o.len * this.ppm, Math.min(this.laneH * 0.34, ((o.len * this.ppm) / tex.width) * tex.height)).setY(gy);
        } else if (o.kind === 'boost') {
          const w = o.len * this.ppm * 1.15;
          img.setOrigin(0, 0.5).setDisplaySize(w, (w / tex.width) * tex.height).setY(gy);
        } else if (o.kind === 'hurdle') {
          const h = this.laneH * 0.5;
          img.setOrigin(0.5, 1).setDisplaySize((h / tex.height) * tex.width, h).setY(gy + this.laneH * 0.06);
        } else if (o.kind === 'bar') {
          // 낮은 막대: 막대가 캐릭터 머리 높이에 오게 (서서 지나가면 머리가 걸리고, 슬라이딩하면 아래로 지나간다)
          const h = this.laneH * 0.92;
          img.setOrigin(0.5, 1).setDisplaySize((h / tex.height) * tex.width, h).setY(gy + this.laneH * 0.07);
        } else {
          const w = this.laneH * 0.36;
          img.setOrigin(0.5, 1).setDisplaySize(w, (w / tex.width) * tex.height).setY(gy + this.laneH * 0.06);
        }
        let badge: Phaser.GameObjects.Container | undefined;
        if (o.kind === 'bar' && row === LANES - 1 && this.race.mySlot >= 0) {
          // 내 레인의 낮은 막대 위에 아래 화살표 (슬라이딩 버튼과 같은 파란색)
          const rad = Math.max(9, Math.min(13, this.laneH * 0.13));
          const bg = this.add.graphics();
          bg.fillStyle(COLOR.teamA, 1).fillCircle(0, 0, rad).lineStyle(2, COLOR.outline, 1).strokeCircle(0, 0, rad);
          bg.fillStyle(COLOR.white, 1).fillTriangle(-rad * 0.55, -rad * 0.3, rad * 0.55, -rad * 0.3, 0, rad * 0.6);
          const y0 = gy + this.laneH * 0.07 - img.displayHeight - rad * 0.4;
          badge = this.add.container(0, y0, [bg]).setDepth(99).setData('y0', y0);
        }
        this.obSprites.push({ o, row, img, badge });
      }
    }

    // 주자
    for (const r of this.race.roster) {
      const row = this.rowOf(r.slot);
      const mine = r.slot === this.race.mySlot;
      const depth = 15 + row * 10;
      const shadow = this.add.image(0, this.groundY(row), 'shadow').setAlpha(0.22).setDepth(depth - 1);
      const spr = this.add.image(0, this.groundY(row), zKey(r.char)).setOrigin(0.5, 1).setDepth(depth);
      const tex = spr.texture.getSourceImage();
      const h = this.laneH * 0.74;
      spr.setScale(h / tex.height);
      shadow.setDisplaySize(spr.displayWidth * 0.8, this.laneH * 0.14);
      // 고스트: 반투명 (이름표는 읽히게 그대로)
      if (this.isGhost(r.slot)) {
        spr.setAlpha(0.5);
        shadow.setAlpha(0.11);
      }

      // 머리 위 이름표: 순위 + ID. 내 것은 노란 바탕
      const fs = Math.max(10, Math.min(13, Math.round(this.laneH * 0.14)));
      const labelText = this.text(0, 0, r.name, fs);
      const rankText = this.text(0, 0, '1', fs, mine ? COLOR.ink : COLOR.white);
      const labelBg = this.add.graphics();
      const label = this.add.container(0, 0, [labelBg, labelText, rankText]).setDepth(100 + row);
      const padX = 6;
      const rankW = fs + 4;
      const w = labelText.width + rankW + padX * 2 + 2;
      const hh = fs + 5;
      labelBg.fillStyle(mine ? COLOR.primary : COLOR.white, 1).fillRoundedRect(-w / 2, -hh / 2, w, hh, hh / 2);
      labelBg.lineStyle(2, COLOR.outline, 1).strokeRoundedRect(-w / 2, -hh / 2, w, hh, hh / 2);
      labelBg.fillStyle(mine ? COLOR.white : COLOR.outline, 1).fillCircle(-w / 2 + hh / 2, 0, hh / 2 - 2.5);
      rankText.setPosition(-w / 2 + hh / 2, 0);
      labelText.setPosition(-w / 2 + rankW + padX + labelText.width / 2 - 1, 0);

      // 화면 밖에 있을 때: 가장자리에 얼굴 + 거리
      const face = this.add.image(0, 0, this.textures.exists(`f-${r.char}`) ? `f-${r.char}` : zKey(r.char));
      const fsz = Math.min(30, this.laneH * 0.36);
      face.setDisplaySize(fsz, fsz);
      const arrowText = this.text(0, 0, '', fs);
      const arrowBg = this.add.graphics();
      const arrow = this.add.container(0, this.laneTop(row) + this.laneH * 0.52, [arrowBg, face, arrowText]).setDepth(120).setVisible(false);
      arrow.setData('face', face);
      if (this.isGhost(r.slot)) face.setAlpha(0.6);

      const logO = this.race.obs.find((o) => o.kind === 'log');
      let logSpr: Phaser.GameObjects.Image | null = null;
      if (logO) {
        logSpr = this.add.image(0, 0, 'log').setDepth(depth + 1);
        const d = this.laneH * 0.5;
        const lt = logSpr.texture.getSourceImage();
        logSpr.setDisplaySize(d, (d / lt.width) * lt.height).setY(this.groundY(row) - d * 0.42);
      }
      this.actors.push({
        slot: r.slot, row, char: r.char, spr, shadow, label, labelText, labelBg, rankText, arrow, arrowText, arrowBg,
        stride: r.slot * 1.7, lastX: 0, state: 'wait', since: 0, dustT: 0, ghostT: 0, mudT: 0, lastRank: 0, lastArrow: '', logSpr, logLastX: logO?.x ?? 0,
      });
    }
    this.draw(0);
  }

  update(_time: number, delta: number) {
    const dt = Math.min(0.1, delta / 1000);
    this.race.update();
    const evs = this.race.events.splice(0);
    this.draw(dt);
    for (const e of evs) this.onEvent(e);
    this.footsteps(dt);
    this.onFrame();
  }

  /** 카메라가 따라갈 위치: 내 캐릭터 (출전하지 않았으면 맨 앞 주자) */
  private focusX(views: RunnerView[]): number {
    const me = this.race.mySlot;
    const x = me >= 0 ? views[me].x : Math.max(...views.map((v) => v.x));
    return Math.min(x, TRACK_LEN + 1.5);
  }

  private draw(dt: number) {
    const { W } = this;
    const views = this.race.roster.map((r) => this.race.view(r.slot));
    this.camX = this.focusX(views) - (W * FOCUS) / this.ppm;
    const px = this.camX * this.ppm;

    this.sky.tilePositionX = (px * 0.12) / this.sky.tileScaleX;
    this.stands.tilePositionX = (px * 0.4) / this.stands.tileScaleX;
    for (const lane of this.lanes) lane.tilePositionX = px / lane.tileScaleX;

    for (const l of this.lineSprites) {
      const x = this.sx(l.x);
      const vis = x > -80 && x < W + 80;
      l.img.setVisible(vis);
      l.text?.setVisible(vis);
      if (!vis) continue;
      l.img.x = x;
      if (l.text) l.text.setPosition(x, l.dy ?? 0);
    }
    for (const s of this.obSprites) {
      const x = this.sx(s.o.kind === 'hurdle' || s.o.kind === 'banana' || s.o.kind === 'bar' ? s.o.x + s.o.len / 2 : s.o.x);
      const vis = x > -s.img.displayWidth - 20 && x < W + 60;
      s.img.setVisible(vis);
      if (vis) s.img.x = x;
      if (s.badge) {
        s.badge.setVisible(vis);
        // 가까이 오면 콩콩 뛰어 눈에 띄게
        if (vis) s.badge.setPosition(x, s.badge.getData('y0') + Math.sin(this.time.now / 110) * 2.5);
      }
    }

    const entries = this.race.entries();
    const phase = this.race.phase();
    const now = this.time.now / 1000;
    for (const a of this.actors) {
      const v = views[a.slot];
      if (v.state !== a.state) {
        a.state = v.state;
        a.since = 0;
      } else a.since += dt;
      this.pose(a, v, phase, now, dt);

      // 통나무 (레인마다 그 주자를 향해 굴러온다)
      if (a.logSpr) {
        const lx = v.logX === undefined ? this.race.obs.find((o) => o.kind === 'log')!.x : v.logX;
        const x = this.sx(lx);
        const vis = lx >= 0 && x > -60 && x < W + 80;
        a.logSpr.setVisible(vis);
        if (vis) {
          // 구르는 동안 통통 튀며 흔들린다
          const roll = lx * 2.4;
          a.logSpr.x = x + a.logSpr.displayWidth * 0.3;
          a.logSpr.y = this.groundY(a.row) - a.logSpr.displayHeight * 0.42 - (v.logX === undefined ? 0 : Math.abs(Math.sin(roll * 2)) * this.laneH * 0.07);
          a.logSpr.rotation = v.logX === undefined ? 0 : Math.sin(roll * 2) * 0.16;
        }
        a.logLastX = lx;
      }

      // 이름표의 순위
      const place = livePlace(entries, a.slot);
      if (place !== a.lastRank) {
        a.lastRank = place;
        a.rankText.setText(String(place));
      }

      // 화면 밖 상대: 가장자리에 화살표와 거리
      const x = this.sx(v.x);
      const out = x < -a.spr.displayWidth * 0.3 ? -1 : x > W + a.spr.displayWidth * 0.3 ? 1 : 0;
      const me = this.race.mySlot >= 0 ? views[this.race.mySlot] : null;
      if (out !== 0 && me && a.slot !== this.race.mySlot) {
        const d = Math.round(v.x - me.x);
        const s = `${d > 0 ? '+' : ''}${d}m`;
        const key = `${out}${s}`;
        if (key !== a.lastArrow) {
          a.lastArrow = key;
          this.paintArrow(a, out, s);
        }
        a.arrow.setVisible(true);
      } else if (a.arrow.visible) a.arrow.setVisible(false);
    }
  }

  private paintArrow(a: Actor, side: number, s: string) {
    const face = a.arrow.getData('face') as Phaser.GameObjects.Image;
    a.arrowText.setText(s);
    const fw = face.displayWidth;
    const w = fw + a.arrowText.width + 22;
    const h = fw + 6;
    const tip = 9;
    a.arrowBg.clear();
    a.arrowBg.fillStyle(COLOR.white, 1).lineStyle(2, COLOR.outline, 1);
    a.arrowBg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    // 방향 삼각형
    const tx = side > 0 ? w / 2 : -w / 2;
    a.arrowBg.fillStyle(COLOR.outline, 1).fillTriangle(tx - side * 1, -6, tx + side * tip, 0, tx - side * 1, 6);
    face.x = side > 0 ? -w / 2 + fw / 2 + 4 : w / 2 - fw / 2 - 4;
    a.arrowText.x = side > 0 ? face.x + fw / 2 + a.arrowText.width / 2 + 3 : face.x - fw / 2 - a.arrowText.width / 2 - 3;
    a.arrow.x = side > 0 ? this.W - w / 2 - tip - 3 : w / 2 + tip + 3;
  }

  /** 캐릭터 동작 (그림 한 장을 코드로 움직인다): 달리기 흔들림·점프·슬라이딩·넘어짐·미끄러짐·골인 */
  private pose(a: Actor, v: RunnerView, phase: string, now: number, dt: number) {
    const h = a.spr.displayHeight;
    const gy = this.groundY(a.row);
    const base = a.spr.getData('s') ?? a.spr.scaleX;
    a.spr.setData('s', base);
    let oy = 0;
    let ox = 0;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    let shadowK = 1;
    const dx = v.x - a.lastX;
    a.lastX = v.x;

    switch (v.state) {
      case 'wait':
        if (phase === 'ready' || phase === 'go') {
          // 준비: 몸을 낮추고 앞으로 기울인다
          sy = 0.9 + Math.sin(now * 16 + a.slot) * 0.012;
          sx = 1.06;
          rot = 0.12;
        } else sy = 1 + Math.sin(now * 3 + a.slot) * 0.02;
        break;
      case 'run': {
        a.stride += Math.max(0, dx) * 5.6;
        const s = Math.sin(a.stride);
        oy = -Math.abs(s) * h * 0.075;
        rot = 0.16 + Math.sin(a.stride * 0.5) * 0.07;
        sy = 1 + Math.cos(a.stride * 2) * 0.045;
        sx = 1 - Math.cos(a.stride * 2) * 0.045;
        if (v.mud) {
          oy += h * 0.06;
          rot *= 0.5;
        }
        // 막 착지했을 때 살짝 납작
        if (a.since < 0.12) {
          const k = 1 - a.since / 0.12;
          sy -= 0.14 * k;
          sx += 0.12 * k;
        }
        shadowK = 1 - Math.abs(s) * 0.15;
        break;
      }
      case 'jump': {
        const p = Math.min(1, v.jumpT / JUMP_TIME);
        const arc = 4 * p * (1 - p);
        oy = -arc * this.laneH * 0.5;
        rot = -0.28 + p * 0.56;
        sy = 1.1 - 0.12 * arc;
        sx = 0.94 + 0.08 * arc;
        shadowK = 1 - arc * 0.45;
        break;
      }
      case 'slide': {
        // 슬라이딩: 발을 앞으로 내밀고 몸을 뒤로 눕혀 납작하게 미끄러진다 (들어갈 때·일어날 때는 부드럽게)
        const p = Math.min(1, v.slideT / SLIDE_TIME);
        const k = Math.min(1, p / 0.18, (1 - p) / 0.2);
        rot = -1.12 * k;
        sy = 1 - 0.2 * k;
        sx = 1 + 0.1 * k;
        ox = h * 0.14 * k;
        oy = h * 0.02 * k + Math.sin(now * 40 + a.slot) * h * 0.006;
        shadowK = 1 + 0.25 * k;
        break;
      }
      case 'fall': {
        // 앞으로 엎어졌다가 일어난다
        const inK = Math.min(1, a.since / 0.16);
        const outK = v.stunT < 0.22 ? 1 - v.stunT / 0.22 : 0;
        rot = 1.45 * inK * (1 - outK);
        oy = -h * 0.06 * Math.sin(inK * Math.PI) + h * 0.04 * inK * (1 - outK);
        ox = h * 0.18 * inK * (1 - outK);
        break;
      }
      case 'slip': {
        // 발이 앞으로 미끄러져 뒤로 벌렁
        const inK = Math.min(1, a.since / 0.2);
        const outK = v.stunT < 0.2 ? 1 - v.stunT / 0.2 : 0;
        rot = -1.5 * inK * (1 - outK);
        oy = -h * 0.22 * Math.sin(inK * Math.PI) - h * 0.05 * inK * (1 - outK);
        ox = -h * 0.12 * inK * (1 - outK);
        break;
      }
      case 'done': {
        // 골인: 폴짝폴짝
        const s = Math.abs(Math.sin(a.since * 7));
        oy = -s * h * 0.2;
        rot = Math.sin(a.since * 7) * 0.14;
        sy = 1 + s * 0.06;
        shadowK = 1 - s * 0.3;
        break;
      }
      case 'foul':
        rot = 0.06 + Math.sin(now * 2) * 0.02;
        sy = 0.94;
        break;
    }

    const x = this.sx(v.x);
    a.spr.setPosition(x + ox, gy + oy);
    a.spr.setRotation(rot);
    a.spr.setScale(base * sx, base * sy);
    if (v.state === 'foul') a.spr.setTint(0x9a9a9a);
    else if (v.boost) a.spr.setTint(0xfff2b0);
    else a.spr.clearTint();
    a.shadow.setPosition(x, gy + this.laneH * 0.02);
    a.shadow.setScale((a.spr.displayWidth * 0.8 * shadowK) / 64, (this.laneH * 0.14 * shadowK) / 24);
    const vis = x > -h && x < this.W + h;
    a.spr.setVisible(vis);
    a.shadow.setVisible(vis);
    a.label.setVisible(vis);
    const lying = v.state === 'fall' || v.state === 'slip' || v.state === 'slide';
    a.label.setPosition(Phaser.Math.Clamp(x, 44, this.W - 44), gy - h * (lying ? 0.62 : 1.0) + Math.min(0, oy) * 0.5 - 7);
    if (!vis || dt <= 0) return;

    // 달릴 때 먼지, 진흙 튀김, 부스트 잔상
    if (v.state === 'slide') {
      // 슬라이딩: 발 앞에서 먼지가 계속 인다
      a.dustT -= dt;
      if (a.dustT <= 0) {
        a.dustT = 0.05;
        this.puff('dust', x + h * 0.2, gy - 3, a.row, 0.36, -70 - Math.random() * 40, -18 - Math.random() * 14, 300);
      }
    } else if (v.state === 'run' && v.v > 2) {
      a.dustT -= dt;
      if (a.dustT <= 0) {
        a.dustT = 0.16;
        if (v.mud) this.puff('splash', x - 6, gy - 4, a.row, 0.5, -30 - Math.random() * 30, -60 - Math.random() * 50, 380);
        else this.puff('dust', x - h * 0.18, gy - 3, a.row, 0.34, -30, -14, 320);
      }
    }
    if (v.boost && v.state !== 'fall' && v.state !== 'slip') {
      a.ghostT -= dt;
      if (a.ghostT <= 0) {
        a.ghostT = 0.06;
        const gimg = this.add.image(a.spr.x, a.spr.y, a.spr.texture.key).setOrigin(0.5, 1).setDepth(a.spr.depth - 1);
        gimg.setScale(a.spr.scaleX, a.spr.scaleY).setRotation(a.spr.rotation).setTintFill(COLOR.primary).setAlpha(0.45 * a.spr.alpha);
        this.tweens.add({ targets: gimg, alpha: 0, x: gimg.x - 26, duration: 260, onComplete: () => gimg.destroy() });
        if (Math.random() < 0.5) this.puff('spark', x - h * 0.4, gy - h * (0.2 + Math.random() * 0.6), a.row, 0.5, -90, 0, 220);
      }
    }
  }

  /** 작은 이펙트 하나: 날아가며 사라진다 */
  private puff(key: string, x: number, y: number, row: number, size: number, vx: number, vy: number, ms: number, tint?: number) {
    const img = this.add.image(x, y, key).setDepth(16 + row * 10);
    const tex = img.texture.getSourceImage();
    const s = (this.laneH * size) / Math.max(tex.width, tex.height);
    img.setScale(s * 0.6);
    if (tint !== undefined) img.setTint(tint);
    this.tweens.add({
      targets: img, x: x + (vx * ms) / 1000, y: y + (vy * ms) / 1000, scaleX: s, scaleY: s, alpha: 0, angle: (Math.random() - 0.5) * 60, duration: ms, ease: 'Quad.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  private stars(a: Actor) {
    const x = a.spr.x;
    const y = this.groundY(a.row) - a.spr.displayHeight * 0.75;
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI / 2 + (i - 1.5) * 0.7;
      this.puff('star', x, y, a.row, 0.34, Math.cos(ang) * 120, Math.sin(ang) * 120, 520);
    }
  }

  private confetti(a: Actor) {
    const cols = [COLOR.primary, COLOR.pink, COLOR.teamA, COLOR.win, COLOR.white];
    const x = a.spr.x;
    const y = this.groundY(a.row) - a.spr.displayHeight * 0.6;
    for (let i = 0; i < 16; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 90 + Math.random() * 160;
      this.puff('confetti', x, y, a.row, 0.1 + Math.random() * 0.06, Math.cos(ang) * sp, Math.sin(ang) * sp + 60, 700 + Math.random() * 300, cols[i % cols.length]);
    }
  }

  private onEvent(e: RaceEvent) {
    const a = this.actors.find((x) => x.slot === e.slot);
    if (!a) return;
    const mine = e.slot === this.race.mySlot;
    const vis = a.spr.visible;
    // 내 소리는 그대로, 화면에 보이는 상대 소리는 작게
    const say = (name: string, rate = 1) => {
      if (mine) this.sfx(name, { rate });
      else if (vis) this.sfx(name, { volume: 0.35, rate: rate * 1.1 });
    };
    const gy = this.groundY(a.row);
    switch (e.ev) {
      case 'start':
        if (vis) this.puff('dust', a.spr.x - 10, gy - 4, a.row, 0.5, -70, -20, 380);
        break;
      case 'jump':
        say('jump');
        if (vis) this.puff('dust', a.spr.x - 4, gy - 3, a.row, 0.4, -40, -6, 300);
        break;
      case 'land':
        say('land');
        if (vis) {
          this.puff('dust', a.spr.x - 12, gy - 3, a.row, 0.4, -50, -10, 300);
          this.puff('dust', a.spr.x + 12, gy - 3, a.row, 0.4, 40, -10, 300);
        }
        break;
      case 'slide':
        say('slide');
        if (vis) this.puff('dust', a.spr.x + 6, gy - 3, a.row, 0.5, -90, -12, 320);
        break;
      case 'slideEnd':
        break;
      case 'bar':
        say('hurdleHit', 0.85);
        if (vis) this.stars(a);
        if (mine) this.cameras.main.shake(150, 0.007);
        break;
      case 'mud':
        say('mud');
        if (vis) for (let i = 0; i < 4; i++) this.puff('splash', a.spr.x, gy - 4, a.row, 0.5, (Math.random() - 0.5) * 160, -80 - Math.random() * 80, 420);
        break;
      case 'hurdle':
        say('hurdleHit');
        if (vis) this.stars(a);
        if (mine) this.cameras.main.shake(140, 0.006);
        break;
      case 'log':
        say('logHit');
        if (vis) this.stars(a);
        if (mine) this.cameras.main.shake(180, 0.008);
        break;
      case 'banana':
        say('slip');
        if (vis) this.stars(a);
        break;
      case 'boost':
        say('boost');
        break;
      case 'finish':
        say('goal');
        if (vis) this.confetti(a);
        break;
      case 'foul':
        if (mine) this.sfx('raceFoul');
        break;
      case 'getup':
        break;
    }
  }

  /** 발소리 (내 캐릭터가 달리는 동안) — update 뒤에 부른다 */
  private footsteps(dt: number) {
    const me = this.race.mySlot;
    if (me < 0) return;
    const v = this.race.view(me);
    if (v.state !== 'run' || v.v < 1) return;
    this.stepT -= dt * (v.v / 5);
    if (this.stepT <= 0) {
      this.stepT = 0.2;
      this.sfx('step', { volume: 0.5, rate: 0.9 + Math.random() * 0.25 });
    }
  }
}

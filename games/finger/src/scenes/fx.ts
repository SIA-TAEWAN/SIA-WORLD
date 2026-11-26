import Phaser from 'phaser';
import { COLOR, FONT, css } from '../theme';

/**
 * 판 효과 (7단계). 아이폰에서 가볍게:
 * - 효과 그림은 판을 열 때 한 번만 코드로 만든다 (흰 그림 → 쓸 때 물들인다). 매 프레임 텍스처·Graphics 를 새로 만들지 않는다.
 * - 한 번에 떠 있는 효과 조각은 MAX_FX 개까지, 넘으면 새 조각은 건너뛴다.
 * - 떠오르는 글자는 TEXT_POOL 개를 돌려 쓴다 (Text 는 하나마다 캔버스를 만든다).
 * 색은 shared/theme 값만 쓴다 (DESIGN.md).
 */

export const MAX_FX = 48;
const TEXT_POOL = 14;
const INK = css(COLOR.outline);

/** 흰 그림 키 (물들여 쓴다) */
export const G = {
  px: 'g-px', // 4×4 흰 점 (늘여서 띠·레이저·어둡게)
  dot: 'g-dot', // 둥근 점
  disc: 'g-disc', // 큰 원 (반지름 64)
  ring: 'g-ring', // 고리 (반지름 118)
  star: 'g-star', // 별 (외곽선)
  plus: 'g-plus', // 십자 (회복)
  shield: 'g-shield', // 방패
  fang: 'g-fang', // 이빨
  ball: 'g-ball', // 구슬
  drop: 'g-drop', // 물방울 (숨음)
  bubble: 'g-bubble', // 방울 셋 (독)
  rock: 'g-rock', // 바위 (단단함)
  arrow: 'g-arrow', // 아래 화살표 (느려짐·약해짐)
  warn: 'g-warn', // 느낌표 세모 (큰 공격 예고, 물들이지 않는다)
  rays: 'g-rays', // 방사형 빛 (컷인)
  swirl: 'g-swirl', // 소용돌이 (순간이동 구멍)
} as const;

function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({}, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

const starPoints = (cx: number, cy: number, r0: number, r1: number, n = 5) => {
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    const r = i % 2 ? r1 : r0;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
};

/** 효과용 흰 그림을 만든다 (한 판에 한 번) */
export function ensureFxArt(scene: Phaser.Scene) {
  const O = COLOR.outline;
  tex(scene, G.px, 4, 4, (g) => g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4));
  tex(scene, G.dot, 32, 32, (g) => g.fillStyle(0xffffff, 1).fillCircle(16, 16, 15));
  tex(scene, G.disc, 128, 128, (g) => g.fillStyle(0xffffff, 1).fillCircle(64, 64, 64));
  tex(scene, G.ring, 256, 256, (g) => g.lineStyle(12, 0xffffff, 1).strokeCircle(128, 128, 118));
  tex(scene, G.star, 48, 48, (g) => {
    const p = starPoints(24, 25, 21, 10);
    g.fillStyle(0xffffff, 1).fillPoints(p, true);
    g.lineStyle(4, O, 1).strokePoints(p, true, true);
  });
  tex(scene, G.plus, 48, 48, (g) => {
    g.fillStyle(O, 1).fillRoundedRect(15, 3, 18, 42, 6).fillRoundedRect(3, 15, 42, 18, 6);
    g.fillStyle(0xffffff, 1).fillRoundedRect(19, 7, 10, 34, 3).fillRoundedRect(7, 19, 34, 10, 3);
  });
  tex(scene, G.shield, 56, 56, (g) => {
    const p = [
      { x: 28, y: 4 }, { x: 50, y: 12 }, { x: 48, y: 32 }, { x: 28, y: 52 }, { x: 8, y: 32 }, { x: 6, y: 12 },
    ];
    g.fillStyle(0xffffff, 1).fillPoints(p, true);
    g.lineStyle(5, O, 1).strokePoints(p, true, true);
    g.lineStyle(4, O, 0.35).lineBetween(28, 12, 28, 42);
  });
  tex(scene, G.fang, 48, 48, (g) => {
    const p = [{ x: 8, y: 6 }, { x: 40, y: 6 }, { x: 24, y: 44 }];
    g.fillStyle(0xffffff, 1).fillPoints(p, true);
    g.lineStyle(5, O, 1).strokePoints(p, true, true);
  });
  tex(scene, G.ball, 40, 40, (g) => {
    g.fillStyle(0xffffff, 1).fillCircle(20, 20, 16);
    g.lineStyle(4, O, 1).strokeCircle(20, 20, 16);
    g.fillStyle(O, 0.25).fillCircle(25, 25, 6);
  });
  tex(scene, G.drop, 40, 40, (g) => {
    g.fillStyle(O, 1).fillTriangle(20, 1, 34, 24, 6, 24).fillCircle(20, 25, 14);
    g.fillStyle(0xffffff, 1).fillTriangle(20, 8, 29, 23, 11, 23).fillCircle(20, 25, 10);
  });
  tex(scene, G.bubble, 40, 40, (g) => {
    for (const [x, y, r] of [[14, 25, 11], [28, 15, 8], [29, 31, 6]]) {
      g.fillStyle(O, 1).fillCircle(x, y, r + 3);
      g.fillStyle(0xffffff, 1).fillCircle(x, y, r);
    }
  });
  tex(scene, G.rock, 40, 40, (g) => {
    const p = [{ x: 12, y: 4 }, { x: 30, y: 5 }, { x: 37, y: 20 }, { x: 28, y: 36 }, { x: 10, y: 35 }, { x: 3, y: 19 }];
    g.fillStyle(0xffffff, 1).fillPoints(p, true);
    g.lineStyle(4, O, 1).strokePoints(p, true, true);
    g.lineStyle(3, O, 0.4).lineBetween(14, 12, 24, 20).lineBetween(24, 20, 20, 30);
  });
  tex(scene, G.arrow, 40, 40, (g) => {
    const p = [{ x: 14, y: 4 }, { x: 26, y: 4 }, { x: 26, y: 20 }, { x: 35, y: 20 }, { x: 20, y: 37 }, { x: 5, y: 20 }, { x: 14, y: 20 }];
    g.fillStyle(0xffffff, 1).fillPoints(p, true);
    g.lineStyle(4, O, 1).strokePoints(p, true, true);
  });
  tex(scene, G.warn, 64, 64, (g) => {
    const p = [{ x: 32, y: 5 }, { x: 60, y: 56 }, { x: 4, y: 56 }];
    g.fillStyle(COLOR.primary, 1).fillPoints(p, true);
    g.lineStyle(6, O, 1).strokePoints(p, true, true);
    g.fillStyle(O, 1).fillRoundedRect(28, 22, 8, 18, 3).fillCircle(32, 47, 4.5);
  });
  tex(scene, G.rays, 256, 256, (g) => {
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      const b = a + Math.PI / 18;
      g.fillTriangle(128, 128, 128 + Math.cos(a) * 128, 128 + Math.sin(a) * 128, 128 + Math.cos(b) * 128, 128 + Math.sin(b) * 128);
    }
  });
  tex(scene, G.swirl, 96, 96, (g) => {
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3;
      g.lineStyle(7, 0xffffff, 1).beginPath();
      g.arc(48, 48, 30, a, a + 1.5);
      g.strokePath();
      g.lineStyle(5, 0xffffff, 0.7).beginPath();
      g.arc(48, 48, 16, a + 1, a + 2.3);
      g.strokePath();
    }
  });
}

type Img = Phaser.GameObjects.Image;

export class Fx {
  private live = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private textAt = 0;
  private bannerBand: Img | null = null;
  private bannerText: Phaser.GameObjects.Text | null = null;

  constructor(
    private scene: Phaser.Scene,
    private ox: number,
    private oy: number,
    private w: number,
    private h: number,
  ) {}

  /** 효과 조각 하나 (방 좌표). 너무 많으면 null */
  spawn(key: string, x: number, y: number, depth = 760): Img | null {
    if (this.live >= MAX_FX) return null;
    this.live++;
    const img = this.scene.add.image(this.ox + x, this.oy + y, key).setDepth(depth);
    img.once(Phaser.GameObjects.Events.DESTROY, () => this.live--);
    return img;
  }

  /** 움직인 뒤 사라진다 */
  go(img: Img, props: Record<string, unknown>, duration: number, delay = 0) {
    this.scene.tweens.add({ targets: img, ...props, duration, delay, onComplete: () => img.destroy() });
  }

  /** 퍼지는 고리 */
  ring(x: number, y: number, r: number, tint: number, duration = 380, from = 0.3, delay = 0) {
    const img = this.spawn(G.ring, x, y);
    if (!img) return;
    const k = r / 118;
    img.setTint(tint).setScale(k * from);
    if (delay) img.setVisible(false);
    this.scene.tweens.add({ targets: img, scale: k, alpha: 0, duration, delay, ease: 'Cubic.easeOut', onStart: () => img.setVisible(true), onComplete: () => img.destroy() });
  }

  /** 옅어지는 원 */
  disc(x: number, y: number, r: number, tint: number, alpha = 0.4, duration = 420) {
    const img = this.spawn(G.disc, x, y, 755);
    if (!img) return;
    img.setTint(tint).setAlpha(alpha).setScale((r / 64) * 0.85);
    this.go(img, { alpha: 0, scale: r / 64 }, duration);
  }

  /** 줄 (레이저·궤적): 갈색 바깥 + 색 안쪽, 가늘어지며 사라진다. art 가 있으면 그 그림을 늘여 쓴다 */
  beam(x0: number, y0: number, x1: number, y1: number, thick: number, tint: number, duration = 320, art?: string) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1) return;
    const rot = Math.atan2(y1 - y0, x1 - x0);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    if (art) {
      const img = this.spawn(art, mx, my, 770);
      if (!img) return;
      img.setRotation(rot).setDisplaySize(len, thick * 2);
      this.go(img, { scaleY: 0, alpha: 0.6 }, duration);
      return;
    }
    const out = this.spawn(G.px, mx, my, 768);
    const core = this.spawn(G.px, mx, my, 769);
    const white = this.spawn(G.px, mx, my, 770);
    out?.setTint(COLOR.outline).setAlpha(0.55).setRotation(rot).setScale(len / 4, (thick + 10) / 4);
    core?.setTint(tint).setRotation(rot).setScale(len / 4, thick / 4);
    white?.setRotation(rot).setScale(len / 4, thick / 10);
    for (const img of [out, core, white]) if (img) this.go(img, { scaleY: 0 }, duration, 60);
  }

  /** 사방으로 튀는 조각 */
  burst(x: number, y: number, key: string, tint: number | null, n: number, dist: number, size: number, duration = 320) {
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const img = this.spawn(key, x, y);
      if (!img) return;
      const a = a0 + (Math.PI * 2 * i) / n;
      const d = dist * (0.7 + Math.random() * 0.5);
      if (tint !== null) img.setTint(tint);
      img.setScale(size / img.width);
      this.go(img, { x: img.x + Math.cos(a) * d, y: img.y + Math.sin(a) * d, alpha: 0, scale: (size / img.width) * 0.4, angle: 120 }, duration);
    }
  }

  /** 터짐 그림 (fx-pop) */
  pop(x: number, y: number, size: number, key = 'fx-pop') {
    const img = this.spawn(key, x, y, 750);
    if (!img) return;
    const k = size / (img.height || 64);
    img.setScale(k * 0.55);
    this.go(img, { scale: k, alpha: 0 }, 260);
  }

  /** 위로 떠올랐다 사라지는 조각 (회복 십자·독 방울·엽전) */
  rise(x: number, y: number, key: string, tint: number | null, size: number, up = 46, duration = 600, delay = 0) {
    const img = this.spawn(key, x, y, 775);
    if (!img) return;
    if (tint !== null) img.setTint(tint);
    const k = size / img.width;
    img.setScale(k * 0.4);
    if (delay) img.setVisible(false);
    this.scene.tweens.add({ targets: img, scale: k, duration: 160, delay, ease: 'Back.easeOut', onStart: () => img.setVisible(true) });
    this.go(img, { y: img.y - up, alpha: 0 }, duration, delay + 120);
  }

  /** 떠오르는 글자 (방 좌표). big = 약점처럼 크게 튀어나온다 */
  text(x: number, y: number, str: string, color: string, size: number, big = false) {
    let t = this.texts.find((o) => !o.visible);
    if (!t) {
      if (this.texts.length < TEXT_POOL) {
        t = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '30px', color: css(COLOR.white), stroke: INK, strokeThickness: 6 }).setOrigin(0.5).setDepth(950);
        this.texts.push(t);
      } else {
        t = this.texts[this.textAt++ % TEXT_POOL];
        this.scene.tweens.killTweensOf(t);
      }
    }
    const o = t;
    o.setFontSize(size).setColor(color).setStroke(INK, big ? 8 : 6).setText(str);
    o.setPosition(this.ox + x, this.oy + y).setAlpha(1).setScale(big ? 1.7 : 0.8).setVisible(true);
    this.scene.tweens.add({ targets: o, scale: 1, duration: big ? 220 : 120, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: o, y: o.y - (big ? 56 : 40), alpha: 0, delay: big ? 260 : 120, duration: 620, ease: 'Cubic.easeIn', onComplete: () => o.setVisible(false) });
  }

  /** 가운데 띠 + 큰 글자 (웨이브 · 클리어 · 실패). hold = 머무는 시간(ms), 0 이면 끝까지 남는다 */
  banner(str: string, color: string, size = 64, hold = 700) {
    const cx = this.ox + this.w / 2;
    const cy = this.oy + 360;
    const sc = this.scene;
    this.bannerBand ??= sc.add.image(cx, cy, G.px).setDepth(1099).setTint(COLOR.outline);
    this.bannerText ??= sc.add.text(cx, cy, '', { fontFamily: FONT, fontSize: '64px', color, stroke: INK, strokeThickness: 10 }).setOrigin(0.5).setDepth(1100);
    const band = this.bannerBand;
    const t = this.bannerText;
    sc.tweens.killTweensOf([band, t]);
    band.setVisible(true).setAlpha(0.5).setScale((this.w + this.ox * 2) / 4, 0);
    t.setVisible(true).setFontSize(size).setColor(color).setText(str).setAlpha(1).setScale(0.5).setX(cx);
    sc.tweens.add({ targets: band, scaleY: (size + 56) / 4, duration: 160, ease: 'Cubic.easeOut' });
    sc.tweens.add({ targets: t, scale: 1, duration: 240, ease: 'Back.easeOut' });
    if (hold > 0) {
      sc.tweens.add({ targets: t, alpha: 0, x: cx + 60, delay: hold, duration: 220, onComplete: () => t.setVisible(false) });
      sc.tweens.add({ targets: band, scaleY: 0, delay: hold + 60, duration: 200, onComplete: () => band.setVisible(false) });
    }
  }

  /**
   * 필살기 컷인: 기울어진 색 띠가 지나가며 얼굴(또는 컷인 그림) + 필살기 이름. DESIGN.md "컷인"(방사형 노란 빛, 흰 글자 + 외곽선).
   * 걸리는 시간(ms)을 돌려준다. 다 지나가 지워지면 done 을 부른다.
   */
  cutin(faceKey: string, isArt: boolean, hero: string, title: string, desc: string, color: number, done?: () => void): number {
    const sc = this.scene;
    const W = this.w + this.ox * 2;
    const cy = this.oy + 330;
    const IN = 150;
    const HOLD = 460;
    const OUT = 140;
    const box = sc.add.container(-W, cy).setDepth(1200);
    const px = (tint: number, y: number, hgt: number, alpha = 1) => sc.add.image(W / 2, y, G.px).setTint(tint).setAlpha(alpha).setScale((W + 80) / 4, hgt / 4);
    box.add([px(COLOR.outline, 0, 236), px(color, 0, 216), px(COLOR.white, -96, 8, 0.5), px(COLOR.outline, 96, 8, 0.25)]);
    const rays = sc.add.image(150, 0, G.rays).setTint(COLOR.primary).setScale(1.5).setAlpha(0.9);
    box.add(rays);
    if (sc.textures.exists(faceKey)) {
      const face = sc.add.image(150, isArt ? 0 : 6, faceKey);
      const size = isArt ? 300 : 220;
      face.setScale(size / Math.max(face.width, face.height));
      if (!isArt) box.add(sc.add.image(150, 6, G.disc).setTint(COLOR.outline).setScale(126 / 64));
      if (!isArt) box.add(sc.add.image(150, 6, G.disc).setTint(COLOR.panel).setScale(118 / 64));
      box.add(face);
      sc.tweens.add({ targets: face, scale: face.scale * 1.08, duration: IN + HOLD, ease: 'Sine.easeOut' });
    }
    const tx = 300;
    const name = sc.add.text(tx, desc ? -70 : -52, hero, { fontFamily: FONT, fontSize: '30px', color: css(COLOR.primary), stroke: INK, strokeThickness: 7 }).setOrigin(0, 0.5);
    const big = sc.add
      .text(tx, desc ? -14 : 12, title, { fontFamily: FONT, fontSize: title.length > 7 ? '44px' : '64px', color: css(COLOR.white), stroke: INK, strokeThickness: 9, wordWrap: { width: W - tx - 20, useAdvancedWrap: true } })
      .setOrigin(0, 0.5);
    box.add([name, big]);
    if (desc) box.add(sc.add.text(tx, 54, desc, { fontFamily: FONT, fontSize: '28px', color: css(COLOR.white), stroke: INK, strokeThickness: 6, wordWrap: { width: W - tx - 20, useAdvancedWrap: true } }).setOrigin(0, 0.5));
    box.setAngle(-4);
    sc.tweens.add({ targets: rays, angle: 60, duration: IN + HOLD + OUT });
    sc.tweens.add({ targets: box, x: 0, duration: IN, ease: 'Back.easeOut' });
    sc.tweens.add({
      targets: box,
      x: W,
      delay: IN + HOLD,
      duration: OUT,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        box.destroy();
        done?.();
      },
    });
    return IN + HOLD + OUT;
  }

  /** 클리어: 위에서 떨어지는 별·색종이 */
  confetti() {
    const tints = [COLOR.primary, COLOR.pink, COLOR.teamA, COLOR.win, COLOR.white];
    for (let i = 0; i < 22; i++) {
      const star = i % 3 === 0;
      const img = this.spawn(star ? G.star : G.px, Math.random() * this.w, -40 - Math.random() * 120, 1090);
      if (!img) return;
      img.setTint(tints[i % tints.length]).setScale(star ? 0.7 + Math.random() * 0.5 : 3 + Math.random() * 2).setAngle(Math.random() * 360);
      this.go(img, { y: img.y + this.h * (0.75 + Math.random() * 0.3), x: img.x + (Math.random() - 0.5) * 160, angle: img.angle + 360 * (Math.random() < 0.5 ? 1 : -1) }, 1100 + Math.random() * 500, Math.random() * 250);
    }
  }

  /** 실패: 방을 어둡게 (끝까지 남는다) */
  dim(alpha = 0.4) {
    const img = this.scene.add.image(this.ox + this.w / 2, this.oy + this.h / 2, G.px).setDepth(1080).setTint(COLOR.outline).setAlpha(0).setScale(this.w / 4, this.h / 4);
    this.scene.tweens.add({ targets: img, alpha, duration: 400 });
  }
}

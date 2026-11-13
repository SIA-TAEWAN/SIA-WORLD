import Phaser from 'phaser';
import type { MapTheme } from '../data/maps';
import { hex, makeFxTextures } from './art';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

/** 폭발·연기·흙먼지 같은 화면 효과 (게임 결과에는 영향 없음) */
export class Fx {
  private fire: Emitter;
  private smoke: Emitter;
  private debris: Emitter;
  private sparks: Emitter;
  private dustE: Emitter;
  private trailE: Emitter;

  constructor(
    private scene: Phaser.Scene,
    theme: MapTheme,
  ) {
    makeFxTextures(scene);
    const dirt = [hex(theme.dirtTop), hex(theme.dirtBottom), hex(theme.grass), hex(theme.speck)];
    this.smoke = scene.add
      .particles(0, 0, 'fx-puff', {
        emitting: false,
        lifespan: { min: 900, max: 1600 },
        speed: { min: 20, max: 70 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.5, end: 1.4 },
        alpha: { start: 0.6, end: 0 },
        rotate: { min: 0, max: 360 },
        tint: [0x9a929c, 0xb3acb5, 0x8a8490],
        gravityY: -30,
      })
      .setDepth(23);
    this.fire = scene.add
      .particles(0, 0, 'fx-soft', {
        emitting: false,
        lifespan: { min: 350, max: 650 },
        speed: { min: 40, max: 160 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.1, end: 0.2 },
        alpha: { start: 1, end: 0 },
        color: [0xfff6c0, 0xffd23a, 0xff8a1a, 0xd8361a, 0x6a2a1a],
        colorEase: 'Quad.easeIn',
      })
      .setDepth(25);
    this.debris = scene.add
      .particles(0, 0, 'fx-chunk', {
        emitting: false,
        lifespan: { min: 700, max: 1200 },
        speed: { min: 120, max: 320 },
        angle: { min: 200, max: 340 },
        scale: { min: 0.6, max: 1.3 },
        rotate: { start: 0, end: 540 },
        alpha: { start: 1, end: 0.6 },
        tint: dirt,
        gravityY: 700,
      })
      .setDepth(24);
    this.sparks = scene.add
      .particles(0, 0, 'fx-spark', {
        emitting: false,
        lifespan: { min: 250, max: 500 },
        speed: { min: 200, max: 420 },
        angle: { min: 0, max: 360 },
        scale: { start: 1, end: 0.2 },
        tint: [0xfff3a0, 0xffc040],
        rotate: 0,
        gravityY: 300,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(26);
    this.dustE = scene.add
      .particles(0, 0, 'fx-soft', {
        emitting: false,
        lifespan: { min: 350, max: 600 },
        speed: { min: 10, max: 40 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.25, end: 0.6 },
        alpha: { start: 0.55, end: 0 },
        tint: dirt[0],
      })
      .setDepth(9);
    this.trailE = scene.add
      .particles(0, 0, 'fx-soft', {
        emitting: false,
        lifespan: 420,
        speed: { min: 0, max: 12 },
        scale: { start: 0.32, end: 0.05 },
        alpha: { start: 0.7, end: 0 },
      })
      .setDepth(19);
  }

  /** 폭발: 섬광 → 불덩이 → 충격파 → 파편 → 연기 */
  boom(x: number, y: number, r: number, big: boolean) {
    const s = this.scene;
    const flash = s.add.image(x, y, 'fx-soft').setDepth(27).setTint(0xfff3b0).setAlpha(0.85).setScale(r / 70);
    s.tweens.add({ targets: flash, scale: r / 36, alpha: 0, duration: 150, onComplete: () => flash.destroy() });
    const ring = s.add.circle(x, y, r, 0xffffff, 0).setStrokeStyle(big ? 6 : 4, 0xfff1a8, 0.95).setDepth(26).setScale(0.25);
    s.tweens.add({ targets: ring, scale: 1.25, alpha: 0, duration: big ? 520 : 380, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    if (big) {
      const ring2 = s.add.circle(x, y, r * 1.4, 0xffffff, 0).setStrokeStyle(3, 0xffffff, 0.7).setDepth(26).setScale(0.2);
      s.tweens.add({ targets: ring2, scale: 1.3, alpha: 0, duration: 700, delay: 80, ease: 'Cubic.easeOut', onComplete: () => ring2.destroy() });
    }
    const k = r / 40;
    this.fire.updateConfig({ speed: { min: 30 * k, max: 150 * k }, scale: { start: 1.1 * k + 0.5, end: 0.2 } });
    this.fire.explode(big ? 44 : 24, x, y);
    this.sparks.explode(big ? 22 : 10, x, y);
    this.debris.updateConfig({ speed: { min: 100 + 60 * k, max: 240 + 120 * k } });
    this.debris.explode(big ? 30 : 14, x, y - 4);
    this.smoke.updateConfig({ scale: { start: 0.4 * k + 0.3, end: 1.1 * k + 0.6 } });
    s.time.delayedCall(220, () => this.smoke.explode(big ? 10 : 5, x, y - r * 0.3));
  }

  /** 색 있는 연기 뭉치 (순간이동·지형 생성·K.O.) */
  puff(x: number, y: number, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const c = this.scene.add.image(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 10, 'fx-puff').setTint(color).setAlpha(0.8).setScale(0.25 + Math.random() * 0.2).setDepth(23);
      this.scene.tweens.add({
        targets: c,
        y: c.y - 20 - Math.random() * 30,
        x: c.x + (Math.random() - 0.5) * 30,
        scale: c.scale * 2.2,
        alpha: 0,
        angle: (Math.random() - 0.5) * 90,
        duration: 700 + Math.random() * 500,
        onComplete: () => c.destroy(),
      });
    }
  }

  /** 무한궤도 흙먼지 */
  dust(x: number, y: number) {
    this.dustE.explode(1, x, y);
  }

  /** 포구 불꽃 */
  muzzle(x: number, y: number, angleRad: number) {
    const st = this.scene.add.image(x, y, 'fx-star').setDepth(27).setTint(0xfff1a0).setBlendMode(Phaser.BlendModes.ADD).setRotation(angleRad).setScale(0.4);
    this.scene.tweens.add({ targets: st, scale: 1.1, alpha: 0, duration: 160, onComplete: () => st.destroy() });
    this.smoke.updateConfig({ scale: { start: 0.25, end: 0.7 } });
    this.smoke.explode(3, x, y);
  }

  /** 포탄 꼬리 */
  trail(x: number, y: number, color: number) {
    this.trailE.setParticleTint(color);
    this.trailE.explode(1, x, y);
  }
}

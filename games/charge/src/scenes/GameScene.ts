import Phaser from 'phaser';
import { artUrl, zodiacFullUrl } from '../assets';
import { BOSS_ART, CRATE_HP, DRAW_MAX, ENEMIES, MOVE_SPEED, OBSTACLES, ROAD_W, bossArt, crowdRadius } from '../data/balance';
import { groundOf } from '../data/growth';
import { autopilot } from '../game/autopilot';
import { CRATE_HALF, STEP, isGood, obstacleX, setTarget, step, type Gate, type Horde, type RunState, type SimEvent } from '../game/sim';
import { DEV_AUTO, DEV_SPEED } from '../net/local';
import { COLOR } from '../theme';

/** 기준 화면 크기 (세로 9:16) */
export const W = 720;
export const H = 1280;
/** 무리 앞쪽이 서는 화면 높이 */
const CROWD_Y = 980;
const CX = W / 2;
/** 한 요괴 무리에 그리는 최대 마리 수 */
const HORDE_DRAW = 70;
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
/** 지역 바닥 그림과 길 색 (DESIGN.md 의 기존 값) */
const GROUND: Record<string, { tile: string; road: number }> = {
  field: { tile: 'tile-field', road: COLOR.track },
  bamboo: { tile: 'tile-bamboo', road: COLOR.track },
  palace: { tile: 'tile-palace', road: COLOR.panel },
  underworld: { tile: 'tile-underworld', road: COLOR.lineSoft },
};

export interface SceneHooks {
  /** 판이 끝났다 (클리어·실패 연출 뒤) */
  onEnd(s: RunState): void;
  /** 매 화면마다 (HUD 갱신) */
  onFrame(s: RunState): void;
  /** 효과음 */
  sound(name: string, opts?: { volume?: number; rate?: number }): void;
}

interface GateView {
  box: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  text: string;
  good: boolean;
}

interface HordeView {
  imgs: Phaser.GameObjects.Image[];
  label: Phaser.GameObjects.Text;
  hide: Phaser.GameObjects.Graphics;
}

const opText = (g: Gate) => `${g.op === 'x' ? '×' : g.op === '/' ? '÷' : g.op === '-' ? '−' : '+'}${g.v}`;

/** 해바라기 씨 배치: i번째 대원의 상대 위치 */
function seed(i: number): [number, number] {
  const r = Math.sqrt(i + 0.5);
  const a = i * 2.399963;
  return [r * Math.cos(a), r * Math.sin(a)];
}

export class GameScene extends Phaser.Scene {
  private run!: RunState;
  private hooks!: SceneHooks;
  private acc = 0;
  paused = false;
  private ended = false;

  private grass!: Phaser.GameObjects.TileSprite;
  private road!: Phaser.GameObjects.Graphics;
  private things!: Phaser.GameObjects.Graphics;
  private crowd: Phaser.GameObjects.Image[] = [];
  private leaderImg!: Phaser.GameObjects.Image;
  private count!: Phaser.GameObjects.Text;
  private gateViews = new Map<number, GateView>();
  private hordeViews = new Map<number, HordeView>();
  private crateLabels = new Map<number, Phaser.GameObjects.Text>();
  private bossImg!: Phaser.GameObjects.Image;
  private bossKey = '';
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private band!: Phaser.GameObjects.Graphics;
  private bullets: Phaser.GameObjects.Image[] = [];
  private bulletAcc = 0;
  private troopScale = 1;
  /** 터지는 연출 횟수 제한 */
  private popBudget = 0;
  private burnLost = 0;
  private burnShown = -1;
  private ground = GROUND.field;

  private drag: { id: number; x0: number; t0: number } | null = null;
  private keys!: { left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[] };

  constructor() {
    super('game');
  }

  init(data: { run: RunState; hooks: SceneHooks }) {
    this.run = data.run;
    this.hooks = data.hooks;
    this.acc = 0;
    this.ended = false;
    this.paused = false;
    this.gateViews.clear();
    this.hordeViews.clear();
    this.crateLabels.clear();
    this.crowd = [];
    this.bullets = [];
    this.bossKey = '';
    this.burnLost = 0;
    this.burnShown = -1;
    this.ground = GROUND[groundOf(Math.max(1, this.run.stage.region))];
  }

  preload() {
    this.load.image('troop', zodiacFullUrl(this.run.leader.id));
    for (const e of Object.values(ENEMIES)) this.load.image(e.art, artUrl(e.art));
    // 끝없는 모드는 구간마다 보스가 바뀌므로 다 받는다
    const bosses = this.run.endless ? Object.values(BOSS_ART) : [bossArt(this.run.boss.kind, this.run.stage.region)];
    for (const b of bosses) this.load.image(b.art, artUrl(b.art));
    for (const n of [this.ground.tile, 'p-shuriken', 'fx-pop', 'fx-coin']) this.load.image(n, artUrl(n));
  }

  create() {
    this.grass = this.add.tileSprite(CX, H / 2, W, H, this.ground.tile).setDepth(-20);
    this.grass.tileScaleX = this.grass.tileScaleY = 0.5;
    this.road = this.add.graphics().setDepth(-10);
    this.things = this.add.graphics().setDepth(900);

    // 대원 무리 (최대 DRAW_MAX 명만 그리고 나머지는 숫자로)
    const src = this.textures.get('troop').getSourceImage() as HTMLImageElement;
    this.troopScale = 34 / src.height;
    for (let i = 0; i < DRAW_MAX; i++) this.crowd.push(this.add.image(CX, CROWD_Y, 'troop').setScale(this.troopScale).setVisible(false));
    this.leaderImg = this.add.image(CX, CROWD_Y, 'troop').setScale(58 / src.height);
    this.count = this.add
      .text(CX, CROWD_Y - 60, '', { fontFamily: FONT, fontSize: '40px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(5000);

    this.bossImg = this.add.image(CX, -999, 'fx-pop').setDepth(1500);
    this.setBossArt();
    this.bossBar = this.add.graphics().setDepth(4000);
    this.bossName = this.add
      .text(CX, -999, '', { fontFamily: FONT, fontSize: '26px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(4001);
    this.band = this.add.graphics().setDepth(3000);

    const shSrc = this.textures.get('p-shuriken').getSourceImage() as HTMLImageElement;
    const shScale = 28 / (shSrc.height || 28);
    for (let i = 0; i < 48; i++) this.bullets.push(this.add.image(-99, -99, 'p-shuriken').setScale(shScale).setVisible(false).setDepth(3500));

    // 조작: 화면 아무 곳이나 누른 채 좌우로 끈다 (끈 거리만큼 움직인다)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.paused) return;
      this.drag = { id: p.id, x0: p.x, t0: this.run.targetX };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || p.id !== this.drag.id || !p.isDown || this.paused) return;
      setTarget(this.run, this.drag.t0 + (p.x - this.drag.x0) * 1.3);
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (this.drag && p.id === this.drag.id) this.drag = null;
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = { left: [kb.addKey(K.LEFT), kb.addKey(K.A)], right: [kb.addKey(K.RIGHT), kb.addKey(K.D)] };
  }

  /** 지금 보스 그림으로 (끝없는 모드는 구간마다 바뀐다) */
  private setBossArt() {
    const art = bossArt(this.run.boss.kind, this.run.stage.region);
    if (this.bossKey === `${art.art}:${art.size}`) return;
    this.bossKey = `${art.art}:${art.size}`;
    const src = this.textures.get(art.art).getSourceImage() as HTMLImageElement;
    this.bossImg.setTexture(art.art).setScale(art.size / (src.height || art.size));
  }

  /** 길 위치 z → 화면 y */
  private sy(z: number) {
    return CROWD_Y - (z - this.run.z);
  }

  update(_t: number, deltaMs: number) {
    const s = this.run;
    if (!this.paused && !this.ended) {
      const dir = (this.keys.right.some((k) => k.isDown) ? 1 : 0) - (this.keys.left.some((k) => k.isDown) ? 1 : 0);
      if (dir) setTarget(s, s.x + dir * MOVE_SPEED * 0.12);
      this.acc = Math.min(this.acc + (deltaMs / 1000) * DEV_SPEED, 0.25 * DEV_SPEED);
      while (this.acc >= STEP) {
        if (DEV_AUTO) setTarget(s, autopilot(s));
        step(s);
        this.acc -= STEP;
        for (const e of s.events) this.onEvent(e);
        s.events.length = 0;
        if (s.phase === 'clear' || s.phase === 'fail') break;
      }
      this.popBudget = Math.min(3, this.popBudget + (deltaMs / 1000) * 10);
      this.bullet(deltaMs / 1000);
      if (s.phase === 'clear' || s.phase === 'fail') {
        this.ended = true;
        this.time.delayedCall(s.phase === 'clear' ? 1400 : 1000, () => this.hooks.onEnd(s));
      }
    }
    this.draw();
    this.hooks.onFrame(s);
  }

  private draw() {
    const s = this.run;
    const now = this.time.now / 1000;
    this.grass.tilePositionY = -s.z * 2;

    // 길: 흙길 + 테두리 + 움직이는 가운데 점선
    const g = this.road;
    g.clear();
    const x0 = CX - ROAD_W / 2;
    g.fillStyle(this.ground.road, 1).fillRect(x0, 0, ROAD_W, H);
    g.fillStyle(COLOR.outline, 1).fillRect(x0 - 8, 0, 8, H).fillRect(x0 + ROAD_W, 0, 8, H);
    g.fillStyle(COLOR.emptyLine, 0.6);
    const off = s.z % 120;
    for (let y = -120 + off; y < H; y += 120) g.fillRect(CX - 4, y, 8, 60);
    // 화력 강화 중: 무리 아래가 노랗게 빛난다
    if (s.t < s.powerUntil) g.fillStyle(COLOR.primary, 0.35 + 0.15 * Math.sin(now * 12)).fillEllipse(CX + s.x, CROWD_Y + 40, crowdRadius(s.troops) * 2 + 60, 130);

    this.things.clear();
    this.drawObstacles(now);
    this.drawCrates();
    this.drawGates();
    this.drawHordes(now);
    this.drawCrowd(now);
    this.drawBoss(now);
  }

  private drawObstacles(now: number) {
    const g = this.things;
    for (const o of this.run.obstacles) {
      const y = this.sy(o.z);
      if (y < -80 || y > H + 80) continue;
      const x = CX + obstacleX(this.run, o);
      const half = OBSTACLES[o.kind].half;
      if (o.kind === 'log') {
        g.fillStyle(0x9a6a3a, 1).fillRoundedRect(x - half, y - 26, half * 2, 52, 24);
        g.lineStyle(5, COLOR.outline, 1).strokeRoundedRect(x - half, y - 26, half * 2, 52, 24);
        g.fillStyle(0xc89a5a, 1).fillCircle(x + half - 22, y, 16);
        g.lineStyle(3, COLOR.outline, 1).strokeCircle(x + half - 22, y, 16);
      } else if (o.kind === 'blade') {
        g.fillStyle(0xcfd6de, 1);
        const a = now * 9;
        for (let i = 0; i < 4; i++) {
          const t = a + (i * Math.PI) / 2;
          g.fillTriangle(x, y, x + Math.cos(t) * half, y + Math.sin(t) * half * 0.6, x + Math.cos(t + 0.6) * half * 0.7, y + Math.sin(t + 0.6) * half * 0.42);
        }
        g.lineStyle(4, COLOR.outline, 1).strokeEllipse(x, y, half * 2, half * 1.2);
        g.fillStyle(COLOR.outline, 1).fillCircle(x, y, 10);
      } else {
        g.fillStyle(0x3a2a1c, 1).fillEllipse(x, y, half * 2, 70);
        g.lineStyle(5, COLOR.outline, 1).strokeEllipse(x, y, half * 2, 70);
        g.fillStyle(0x5a4030, 1).fillEllipse(x, y - 8, half * 1.5, 34);
      }
    }
  }

  private drawCrates() {
    const g = this.things;
    for (const c of this.run.crates) {
      const y = this.sy(c.z);
      let label = this.crateLabels.get(c.id);
      if (c.broken || y < -80 || y > H + 80) {
        label?.destroy();
        this.crateLabels.delete(c.id);
        continue;
      }
      const x = CX + c.x;
      const h = CRATE_HALF;
      g.fillStyle(0xd9a05b, 1).fillRect(x - h, y - h * 1.6, h * 2, h * 1.6);
      g.lineStyle(5, COLOR.outline, 1).strokeRect(x - h, y - h * 1.6, h * 2, h * 1.6);
      g.lineStyle(4, COLOR.outline, 0.7).lineBetween(x - h, y - h * 0.8, x + h, y - h * 0.8);
      g.fillStyle(COLOR.outline, 1).fillRect(x - h, y + 6, h * 2, 10);
      g.fillStyle(COLOR.primary, 1).fillRect(x - h + 2, y + 8, Math.max(0, (h * 2 - 4) * (c.hp / CRATE_HP)), 6);
      const icon = c.reward.kind === 'troops' ? `+${c.reward.v}` : c.reward.kind === 'coins' ? '엽전' : '⚡';
      if (!label) {
        label = this.add.text(0, 0, icon, { fontFamily: FONT, fontSize: '28px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 6 }).setOrigin(0.5).setDepth(1001);
        this.crateLabels.set(c.id, label);
      }
      label.setPosition(x, y - h * 0.8);
    }
  }

  private drawGates() {
    for (const gate of this.run.gates) {
      const y = this.sy(gate.z);
      let v = this.gateViews.get(gate.id);
      if (gate.used || y < -80 || y > H + 80) {
        if (v) {
          v.box.destroy();
          v.label.destroy();
          this.gateViews.delete(gate.id);
        }
        continue;
      }
      const text = opText(gate);
      const good = isGood(gate.op);
      if (!v) {
        v = {
          box: this.add.graphics().setDepth(1000),
          label: this.add
            .text(0, 0, text, { fontFamily: FONT, fontSize: gate.rail ? '30px' : '44px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 7 })
            .setOrigin(0.5)
            .setDepth(1001),
          text,
          good,
        };
        this.gateViews.set(gate.id, v);
      }
      if (v.text !== text || v.good !== good) {
        this.tweens.add({ targets: v.label, scale: { from: 1.35, to: 1 }, duration: 160 });
        v.text = text;
        v.good = good;
        v.label.setText(text);
      }
      const h = gate.rail ? 46 : 70;
      const w = gate.x1 - gate.x0;
      v.box.clear();
      v.box.fillStyle(good ? COLOR.teamA : COLOR.teamB, gate.rail ? 0.75 : 0.85);
      v.box.fillRoundedRect(CX + gate.x0 + 3, y - h, w - 6, h, 12);
      v.box.lineStyle(5, COLOR.outline, 1).strokeRoundedRect(CX + gate.x0 + 3, y - h, w - 6, h, 12);
      v.label.setPosition(CX + (gate.x0 + gate.x1) / 2, y - h / 2);
    }
  }

  private drawHordes(now: number) {
    for (const h of this.run.hordes) {
      const y = this.sy(h.z);
      let v = this.hordeViews.get(h.id);
      if (h.count <= 0 || y < -400 || y > H + 120) {
        if (v) {
          for (const i of v.imgs) i.destroy();
          v.label.destroy();
          v.hide.destroy();
          this.hordeViews.delete(h.id);
        }
        continue;
      }
      const def = ENEMIES[h.kind];
      if (!v) {
        const src = this.textures.get(def.art).getSourceImage() as HTMLImageElement;
        const sc = def.size / (src.height || def.size);
        v = {
          imgs: Array.from({ length: Math.min(HORDE_DRAW, Math.max(h.start, h.count)) }, () => this.add.image(0, 0, def.art).setScale(sc)),
          label: this.add
            .text(0, 0, '', { fontFamily: FONT, fontSize: '32px', color: '#ffffff', stroke: '#e8564a', strokeThickness: 7 })
            .setOrigin(0.5)
            .setDepth(4500),
          hide: this.add.graphics().setDepth(1800),
        };
        this.hordeViews.set(h.id, v);
      }
      v.hide.clear();
      if (!h.shown) {
        // 숨은 요괴: 물귀신은 물웅덩이, 죽순 요괴는 흙더미만 보인다
        for (const i of v.imgs) i.setVisible(false);
        const cx = CX + (h.x0 + h.x1) / 2;
        const w = h.x1 - h.x0 - 20;
        if (h.kind === 'water') {
          v.hide.fillStyle(COLOR.skyMid, 0.9).fillEllipse(cx, y - 20, w, 70);
          v.hide.lineStyle(4, COLOR.outline, 1).strokeEllipse(cx, y - 20, w, 70);
        } else {
          for (let i = 0; i < 6; i++) {
            const bx = CX + h.x0 + 30 + ((w - 40) * i) / 5;
            v.hide.fillStyle(0x8a6a4a, 1).fillEllipse(bx, y - 10, 46, 22);
            v.hide.fillStyle(COLOR.win, 1).fillTriangle(bx - 6, y - 16, bx + 6, y - 16, bx, y - 34);
          }
        }
        v.label.setText('?').setPosition(cx, y - 70);
        continue;
      }
      layoutHorde(h, v.imgs, y, now);
      v.label.setText(String(h.count)).setPosition(CX + (h.x0 + h.x1) / 2, y - rowsOf(h, v.imgs.length) * 30 - 40);
    }
  }

  private drawCrowd(now: number) {
    const s = this.run;
    const shown = Math.min(DRAW_MAX, Math.max(0, s.troops - 1));
    const R = crowdRadius(s.troops);
    const k = shown > 0 ? R / Math.sqrt(shown + 1.5) : 0;
    const cx = CX + s.x;
    const stunned = s.t < s.stunUntil;
    for (let i = 0; i < DRAW_MAX; i++) {
      const img = this.crowd[i];
      if (i >= shown) {
        img.setVisible(false);
        continue;
      }
      const [dx, dy] = seed(i + 1);
      const bob = stunned ? 0 : Math.sin(now * 14 + i * 1.7) * 3;
      const y = CROWD_Y + 34 + dy * k * 0.62 + bob;
      img.setVisible(true).setPosition(cx + dx * k, y).setDepth(2000 + y).setTint(stunned ? 0x9fb6ff : 0xffffff);
    }
    this.leaderImg
      .setVisible(s.troops > 0)
      .setPosition(cx, CROWD_Y + 20 + (stunned ? 0 : Math.sin(now * 12) * 3))
      .setDepth(2000 + CROWD_Y + 400)
      .setTint(stunned ? 0x9fb6ff : 0xffffff);
    this.count.setText(s.troops > 0 ? String(s.troops) : '').setPosition(cx, CROWD_Y - 40);
  }

  private drawBoss(now: number) {
    const s = this.run;
    const b = s.boss;
    this.setBossArt();
    const art = bossArt(b.kind, s.stage.region);
    const y = this.sy(b.z);
    const alive = b.hp > 0;
    this.bossImg.setVisible(alive && y > -art.size && y < H + art.size).setPosition(CX, y - art.size / 2 + Math.sin(now * 3) * 6);
    this.bossBar.clear();
    this.bossName.setVisible(false);
    if (alive && y > 0 && y < H) {
      const bw = 320;
      const by = Math.max(150, y - art.size - 30);
      this.bossBar.fillStyle(COLOR.outline, 1).fillRoundedRect(CX - bw / 2 - 4, by - 4, bw + 8, 26, 10);
      this.bossBar.fillStyle(COLOR.track, 1).fillRoundedRect(CX - bw / 2, by, bw, 18, 8);
      this.bossBar.fillStyle(COLOR.teamB, 1).fillRoundedRect(CX - bw / 2, by, Math.max(0, (bw * b.hp) / b.max), 18, 8);
      this.bossName.setText(art.name).setVisible(true).setPosition(CX, by - 22);
    }
    // 공격 예고: 떨어질 자리가 빨갛게 깜빡인다 · 남은 불길은 주황
    this.band.clear();
    for (const f of s.burns) {
      this.band.fillStyle(COLOR.accent, 0.35 + 0.15 * Math.sin(now * 20)).fillRect(CX + f.band[0], CROWD_Y - 120, f.band[1] - f.band[0], 300);
    }
    if (s.phase === 'boss') {
      const blink = 0.25 + 0.2 * Math.sin(now * 18);
      for (const bd of b.bands) {
        this.band.fillStyle(COLOR.teamB, blink).fillRect(CX + bd[0], CROWD_Y - 120, bd[1] - bd[0], 300);
        this.band.lineStyle(5, COLOR.teamB, 0.9).strokeRect(CX + bd[0], CROWD_Y - 120, bd[1] - bd[0], 300);
      }
    }
  }

  /** 표창 연출 (판정은 시뮬레이션에서 끝났다. 쏘는 쪽으로 날아가는 모습만) */
  private bullet(dt: number) {
    const s = this.run;
    if (!s.shot || s.troops <= 0) return;
    const rate = Math.min(16, 4 + s.troops / 12) * (s.t < s.powerUntil ? 1.5 : 1);
    this.bulletAcc += dt * rate;
    while (this.bulletAcc >= 1) {
      this.bulletAcc -= 1;
      const b = this.bullets.find((o) => !o.visible);
      if (!b) return;
      const r = crowdRadius(s.troops) * 0.7;
      const fromX = CX + s.x + (Math.random() * 2 - 1) * r;
      const toY = s.shot.kind === 'boss' ? this.sy(s.shot.z) - bossArt(s.boss.kind, s.stage.region).size / 2 : this.sy(s.shot.z) - 30;
      const toX = CX + s.shot.x + (Math.random() * 2 - 1) * 30;
      b.setPosition(fromX, CROWD_Y).setVisible(true).setAlpha(1);
      this.tweens.add({ targets: b, x: toX, y: toY, angle: 720, duration: 220, onComplete: () => b.setVisible(false) });
    }
    if (Math.random() < dt * 6) this.hooks.sound('survShot', { volume: 0.3 });
  }

  private float(text: string, x: number, y: number, color: string, size = 46) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#2a1a10', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(6000);
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private pop(x: number, y: number, size = 90) {
    const p = this.add.image(x, y, 'fx-pop').setDepth(5500);
    const src = this.textures.get('fx-pop').getSourceImage() as HTMLImageElement;
    const base = size / (src.height || size);
    p.setScale(base);
    this.tweens.add({ targets: p, scale: base * 1.6, alpha: 0, duration: 320, onComplete: () => p.destroy() });
  }

  private onEvent(e: SimEvent) {
    const s = this.run;
    const hx = (h: Horde) => CX + Math.max(h.x0, Math.min(h.x1, s.x));
    switch (e.type) {
      case 'gate': {
        const d = e.after - e.before;
        this.float(`${d >= 0 ? '+' : ''}${d}`, CX + s.x, CROWD_Y - 110, d >= 0 ? '#9fd6ff' : '#ff4d6d');
        this.hooks.sound(d >= 0 ? 'boost' : 'logHit');
        break;
      }
      case 'gateUp':
        if (Math.random() < 0.4) this.hooks.sound('tick', { volume: 0.4 });
        break;
      case 'gateDown':
        this.float('−1', CX + (e.gate.x0 + e.gate.x1) / 2, this.sy(e.gate.z) - 90, '#ff4d6d', 34);
        break;
      case 'kill':
        if (this.popBudget >= 1) {
          this.popBudget -= 1;
          this.pop(hx(e.horde) + (Math.random() * 2 - 1) * 60, this.sy(e.horde.z) - 20, 70);
          this.hooks.sound('survPop', { volume: 0.5 });
        }
        break;
      case 'emerge':
        this.pop(CX + (e.horde.x0 + e.horde.x1) / 2, this.sy(e.horde.z) - 20, 160);
        this.hooks.sound('slide', { volume: 0.6 });
        break;
      case 'revive':
        this.float('되살아났다!', CX + (e.horde.x0 + e.horde.x1) / 2, this.sy(e.horde.z) - 80, '#ffe066', 34);
        break;
      case 'fire':
        if (e.lost > 0) {
          this.float(`-${e.lost}`, CX + s.x + 40, CROWD_Y - 90, '#ff4d6d', 34);
          this.hooks.sound('survHurt', { volume: 0.5 });
        }
        break;
      case 'clash':
        for (let i = 0; i < 5; i++) this.pop(CX + s.x + (Math.random() * 2 - 1) * 80, CROWD_Y - 20 + Math.random() * 40, 110);
        if (e.lost > 0) this.float(`-${e.lost}`, CX + s.x, CROWD_Y - 110, '#ff4d6d');
        this.cameras.main.shake(160, 0.006);
        this.hooks.sound('survHurt');
        break;
      case 'obstacle':
        if (e.lost > 0) {
          this.float(`-${e.lost}`, CX + s.x, CROWD_Y - 110, '#ff4d6d');
          this.cameras.main.shake(140, 0.008);
          this.hooks.sound('logHit');
        }
        break;
      case 'crate': {
        const rw = e.crate.reward;
        this.pop(CX + e.crate.x, this.sy(e.crate.z) - 40, 150);
        this.float(rw.kind === 'troops' ? `+${rw.v}` : rw.kind === 'coins' ? `엽전 +${rw.v}` : '화력 강화!', CX + e.crate.x, this.sy(e.crate.z) - 100, '#ffe066');
        this.hooks.sound(rw.kind === 'coins' ? 'coin' : 'survChest');
        break;
      }
      case 'bossWarn':
        this.hooks.sound('survBossWarn', { volume: 0.6 });
        break;
      case 'bossHit':
        this.cameras.main.shake(220, 0.012);
        for (const bd of e.bands) this.pop(CX + (bd[0] + bd[1]) / 2, CROWD_Y + 20, 220);
        if (e.lost > 0) {
          this.float(`-${e.lost}`, CX + s.x, CROWD_Y - 110, '#ff4d6d');
          this.hooks.sound('survHurt');
        } else this.hooks.sound('slap', { volume: 0.5 });
        break;
      case 'burn':
        // 불길 피해는 조금씩 자주 나므로 모아서 0.5초마다 보여 준다
        this.burnLost += e.lost;
        if (this.burnLost > 0 && s.t - this.burnShown >= 0.5) {
          this.float(`-${this.burnLost}`, CX + s.x + 40, CROWD_Y - 90, '#f0a500', 30);
          this.burnLost = 0;
          this.burnShown = s.t;
        }
        break;
      case 'summon':
        this.float('부하를 불렀다!', CX, this.sy(e.horde.z) - 60, '#ff4d6d', 34);
        break;
      case 'bossDown':
        this.pop(CX, this.sy(e.boss.z) - bossArt(e.boss.kind, s.stage.region).size / 2, 320);
        this.hooks.sound('survBossDown');
        if (s.endless) this.float('보스 처치!', CX, CROWD_Y - 200, '#ffe066');
        break;
      case 'fail':
        this.hooks.sound('lose');
        break;
      default:
        break;
    }
  }
}

function rowsOf(h: Horde, drawn: number) {
  const cols = Math.max(1, Math.floor((h.x1 - h.x0) / 38));
  return Math.ceil(Math.min(drawn, h.count) / cols);
}

/** 요괴 무리: 차지한 폭 안에 줄지어 선다 (앞줄이 h.z) */
function layoutHorde(h: Horde, imgs: Phaser.GameObjects.Image[], y: number, now: number) {
  const shown = Math.min(imgs.length, h.count);
  const cols = Math.max(1, Math.floor((h.x1 - h.x0) / 38));
  const used = Math.min(cols, shown);
  const left = CX + (h.x0 + h.x1) / 2 - ((used - 1) * 38) / 2;
  imgs.forEach((img, i) => {
    if (i >= shown) {
      img.setVisible(false);
      return;
    }
    const c = i % cols;
    const r = Math.floor(i / cols);
    const iy = y - r * 30 + Math.sin(now * 9 + i) * 2;
    img.setVisible(true).setPosition(left + c * 38 + (r % 2) * 10, iy).setDepth(2000 + iy);
  });
}

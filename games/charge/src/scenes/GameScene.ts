import Phaser from 'phaser';
import { artUrl, zodiacFullUrl } from '../assets';
import { BOSS_ART, DRAW_MAX, ENEMIES, MOVE_SPEED, ROAD_W, crowdRadius } from '../data/balance';
import { STEP, isGood, setTarget, step, type Gate, type Horde, type RunState, type SimEvent } from '../game/sim';
import { autopilot } from '../game/autopilot';
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
}

const opText = (g: Gate) => `${g.op === 'x' ? '×' : g.op === '/' ? '÷' : g.op === '-' ? '−' : '+'}${g.v}`;

/** 해바라기 씨 배치: i번째 대원의 상대 위치 (0번이 가운데) */
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
  private crowd: Phaser.GameObjects.Image[] = [];
  private leaderImg!: Phaser.GameObjects.Image;
  private count!: Phaser.GameObjects.Text;
  private gateViews = new Map<number, GateView>();
  private hordeViews = new Map<number, HordeView>();
  private bossImg!: Phaser.GameObjects.Image;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private band!: Phaser.GameObjects.Graphics;
  private bullets: Phaser.GameObjects.Image[] = [];
  private bulletAcc = 0;
  private troopScale = 1;
  /** 터지는 연출 횟수 제한 (초당) */
  private popBudget = 0;

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
    this.gateViews.clear();
    this.hordeViews.clear();
    this.crowd = [];
    this.bullets = [];
  }

  preload() {
    this.load.image('troop', zodiacFullUrl(this.run.leader.id));
    for (const e of Object.values(ENEMIES)) this.load.image(e.art, artUrl(e.art));
    const b = BOSS_ART[this.run.boss.kind];
    this.load.image(b.art, artUrl(b.art));
    for (const n of ['tile-field', 'p-shuriken', 'fx-pop']) this.load.image(n, artUrl(n));
  }

  create() {
    this.grass = this.add.tileSprite(CX, H / 2, W, H, 'tile-field').setDepth(-20);
    this.road = this.add.graphics().setDepth(-10);

    // 대원 무리 (최대 DRAW_MAX 명만 그린다)
    const src = this.textures.get('troop').getSourceImage() as HTMLImageElement;
    this.troopScale = 34 / src.height;
    for (let i = 0; i < DRAW_MAX; i++) this.crowd.push(this.add.image(CX, CROWD_Y, 'troop').setScale(this.troopScale).setVisible(false));
    this.leaderImg = this.add.image(CX, CROWD_Y, 'troop').setScale(58 / src.height);
    this.count = this.add
      .text(CX, CROWD_Y - 60, '', { fontFamily: FONT, fontSize: '40px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(5000);

    const art = BOSS_ART[this.run.boss.kind];
    const bsrc = this.textures.get(art.art).getSourceImage() as HTMLImageElement;
    this.bossImg = this.add.image(CX, -999, art.art).setScale(art.size / bsrc.height);
    this.bossBar = this.add.graphics().setDepth(4000);
    this.bossName = this.add
      .text(CX, -999, art.name, { fontFamily: FONT, fontSize: '26px', color: '#ffffff', stroke: '#2a1a10', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(4001);
    this.band = this.add.graphics().setDepth(3000);

    for (let i = 0; i < 48; i++) this.bullets.push(this.add.image(-99, -99, 'p-shuriken').setScale(0.7).setVisible(false).setDepth(3500));

    // 조작: 화면 아무 곳이나 누른 채 좌우로 끈다 (끈 거리만큼 움직인다)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.paused) return;
      this.drag = { id: p.id, x0: p.x, t0: this.run.targetX };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || p.id !== this.drag.id || !p.isDown) return;
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

  /** 화면 좌표 */
  private sy(z: number) {
    return CROWD_Y - (z - this.run.z);
  }

  update(_t: number, deltaMs: number) {
    const s = this.run;
    if (!this.paused && !this.ended) {
      // 키보드: 누르는 동안 그쪽으로
      const dir = (this.keys.right.some((k) => k.isDown) ? 1 : 0) - (this.keys.left.some((k) => k.isDown) ? 1 : 0);
      if (dir) setTarget(s, Math.max(-ROAD_W / 2, Math.min(ROAD_W / 2, s.x + dir * MOVE_SPEED * 0.12)));
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
      if ((s.phase === 'clear' || s.phase === 'fail') && !this.ended) {
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
    this.grass.tilePositionY = -s.z * 0.5;
    this.grass.tileScaleX = this.grass.tileScaleY = 0.5;

    // 길: 넓은 흙길 + 테두리 + 움직이는 가운데 점선
    const g = this.road;
    g.clear();
    const x0 = CX - ROAD_W / 2;
    g.fillStyle(COLOR.track, 1).fillRect(x0, 0, ROAD_W, H);
    g.fillStyle(COLOR.outline, 1).fillRect(x0 - 8, 0, 8, H).fillRect(x0 + ROAD_W, 0, 8, H);
    g.fillStyle(COLOR.lineSoft, 1);
    const off = (s.z * 1) % 120;
    for (let y = -120 + off; y < H; y += 120) g.fillRect(CX - 4, y, 8, 60);

    this.drawGates();
    this.drawHordes(now);
    this.drawCrowd(now);
    this.drawBoss(now);
  }

  private drawGates() {
    for (const gate of this.run.gates) {
      const y = this.sy(gate.z);
      let v = this.gateViews.get(gate.id);
      const visible = !gate.used && y > -80 && y < H + 80;
      if (!visible) {
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
          text: '',
          good: !good,
        };
        this.gateViews.set(gate.id, v);
      }
      const h = gate.rail ? 46 : 70;
      const w = gate.x1 - gate.x0;
      if (v.text !== text || v.good !== good) {
        if (v.text && v.text !== text) this.tweens.add({ targets: v.label, scale: { from: 1.35, to: 1 }, duration: 160 });
        v.text = text;
        v.good = good;
        v.label.setText(text);
      }
      v.box.clear();
      v.box.fillStyle(good ? COLOR.teamA : COLOR.teamB, gate.rail ? 0.75 : 0.85);
      v.box.fillRoundedRect(CX + gate.x0, y - h, w, h, 12);
      v.box.lineStyle(5, COLOR.outline, 1).strokeRoundedRect(CX + gate.x0, y - h, w, h, 12);
      v.label.setPosition(CX + (gate.x0 + gate.x1) / 2, y - h / 2);
    }
  }

  private drawHordes(now: number) {
    for (const h of this.run.hordes) {
      const y = this.sy(h.z);
      let v = this.hordeViews.get(h.id);
      const visible = h.count > 0 && y > -400 && y < H + 120;
      if (!visible) {
        if (v) {
          for (const i of v.imgs) i.destroy();
          v.label.destroy();
          this.hordeViews.delete(h.id);
        }
        continue;
      }
      const def = ENEMIES[h.kind];
      if (!v) {
        const src = this.textures.get(def.art).getSourceImage() as HTMLImageElement;
        const sc = (h.kind === 'club' ? 58 : 42) / src.height;
        v = {
          imgs: Array.from({ length: Math.min(HORDE_DRAW, h.start) }, () => this.add.image(0, 0, def.art).setScale(sc)),
          label: this.add
            .text(0, 0, '', { fontFamily: FONT, fontSize: '32px', color: '#ffffff', stroke: '#ff4d6d', strokeThickness: 7 })
            .setOrigin(0.5)
            .setDepth(4500),
        };
        this.hordeViews.set(h.id, v);
      }
      layoutHorde(h, v.imgs, y, now);
      v.label.setText(String(h.count)).setPosition(CX + (h.x0 + h.x1) / 2, y - rowsOf(h) * 34 - 30);
    }
  }

  private drawCrowd(now: number) {
    const s = this.run;
    const shown = Math.min(DRAW_MAX, Math.max(0, s.troops - 1));
    const R = crowdRadius(s.troops);
    const k = shown > 0 ? R / Math.sqrt(shown + 0.5) : 0;
    const cx = CX + s.x;
    for (let i = 0; i < DRAW_MAX; i++) {
      const img = this.crowd[i];
      if (i >= shown) {
        img.setVisible(false);
        continue;
      }
      const [dx, dy] = seed(i + 1);
      const bob = Math.sin(now * 14 + i * 1.7) * 3;
      const y = CROWD_Y + 34 + dy * k * 0.62 + bob;
      img.setVisible(true).setPosition(cx + dx * k, y).setDepth(2000 + y);
    }
    this.leaderImg.setVisible(s.troops > 0).setPosition(cx, CROWD_Y + 20 + Math.sin(now * 12) * 3).setDepth(2000 + CROWD_Y + 400);
    this.count.setText(s.troops > 0 ? String(s.troops) : '').setPosition(cx, CROWD_Y - 40);
  }

  private drawBoss(now: number) {
    const s = this.run;
    const b = s.boss;
    const art = BOSS_ART[b.kind];
    const y = this.sy(b.z);
    const alive = b.hp > 0;
    this.bossImg
      .setVisible(y > -art.size && alive)
      .setPosition(CX, y - art.size / 2 + Math.sin(now * 3) * 6)
      .setDepth(1500);
    this.bossBar.clear();
    this.bossName.setVisible(false);
    if (alive && y > 0 && y < H) {
      const bw = 320;
      const by = Math.max(150, y - art.size - 30);
      this.bossBar.fillStyle(COLOR.outline, 1).fillRoundedRect(CX - bw / 2 - 4, by - 4, bw + 8, 26, 10);
      this.bossBar.fillStyle(COLOR.track, 1).fillRoundedRect(CX - bw / 2, by, bw, 18, 8);
      this.bossBar.fillStyle(COLOR.teamB, 1).fillRoundedRect(CX - bw / 2, by, Math.max(0, (bw * b.hp) / b.max), 18, 8);
      this.bossName.setVisible(true).setPosition(CX, by - 22);
    }
    // 공격 예고: 떨어질 자리가 빨갛게 깜빡인다
    this.band.clear();
    if (b.band && s.phase === 'boss') {
      const blink = 0.25 + 0.2 * Math.sin(now * 18);
      this.band.fillStyle(COLOR.teamB, blink).fillRect(CX + b.band[0], CROWD_Y - 120, b.band[1] - b.band[0], 300);
      this.band.lineStyle(5, COLOR.teamB, 0.9).strokeRect(CX + b.band[0], CROWD_Y - 120, b.band[1] - b.band[0], 300);
    }
  }

  /** 총알 연출 (판정은 시뮬레이션에서 이미 끝났다. 쏘는 쪽으로 표창이 날아가는 모습만) */
  private bullet(dt: number) {
    const s = this.run;
    if (!s.shot || s.troops <= 0) return;
    const rate = Math.min(16, 4 + s.troops / 12);
    this.bulletAcc += dt * rate;
    while (this.bulletAcc >= 1) {
      this.bulletAcc -= 1;
      const b = this.bullets.find((o) => !o.visible);
      if (!b) return;
      const r = crowdRadius(s.troops) * 0.7;
      const fromX = CX + s.x + (Math.random() * 2 - 1) * r;
      const toY = s.shot.kind === 'boss' ? this.sy(s.shot.z) - BOSS_ART[s.boss.kind].size / 2 : this.sy(s.shot.z) - 30;
      const toX = CX + s.shot.x + (Math.random() * 2 - 1) * 30;
      b.setPosition(fromX, CROWD_Y).setVisible(true).setAlpha(1);
      this.tweens.add({ targets: b, x: toX, y: toY, angle: 720, duration: 220, onComplete: () => b.setVisible(false) });
    }
    if (Math.random() < dt * 6) this.hooks.sound('survShot', { volume: 0.35 });
  }

  private float(text: string, x: number, y: number, color: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '46px', color, stroke: '#2a1a10', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(6000);
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private pop(x: number, y: number, size = 90) {
    const p = this.add.image(x, y, 'fx-pop').setDepth(5500).setScale(size / 192);
    this.tweens.add({ targets: p, scale: (size * 1.6) / 192, alpha: 0, duration: 320, onComplete: () => p.destroy() });
  }

  private onEvent(e: SimEvent) {
    const s = this.run;
    switch (e.type) {
      case 'gate': {
        const d = e.after - e.before;
        this.float(`${d >= 0 ? '+' : ''}${d}`, CX + s.x, CROWD_Y - 110, d >= 0 ? '#9fd6ff' : '#ff4d6d');
        this.hooks.sound(d >= 0 ? 'boost' : 'logHit');
        break;
      }
      case 'gateUp':
        if (Math.random() < 0.5) this.hooks.sound('tick', { volume: 0.4 });
        break;
      case 'kill': {
        const y = this.sy(e.horde.z) - 20;
        if (this.popBudget >= 1) {
          this.popBudget -= 1;
          this.pop(CX + Math.max(e.horde.x0, Math.min(e.horde.x1, s.x)) + (Math.random() * 2 - 1) * 60, y, 70);
        }
        this.hooks.sound('survPop', { volume: 0.5 });
        break;
      }
      case 'clash':
        for (let i = 0; i < 5; i++) this.pop(CX + s.x + (Math.random() * 2 - 1) * 80, CROWD_Y - 20 + Math.random() * 40, 110);
        if (e.lost > 0) this.float(`-${e.lost}`, CX + s.x, CROWD_Y - 110, '#ff4d6d');
        this.cameras.main.shake(160, 0.006);
        this.hooks.sound('survHurt');
        break;
      case 'bossWarn':
        this.hooks.sound('survBossWarn', { volume: 0.6 });
        break;
      case 'bossHit':
        this.cameras.main.shake(220, 0.012);
        this.pop(CX + (e.band[0] + e.band[1]) / 2, CROWD_Y + 20, 220);
        if (e.lost > 0) {
          this.float(`-${e.lost}`, CX + s.x, CROWD_Y - 110, '#ff4d6d');
          this.hooks.sound('survHurt');
        } else this.hooks.sound('slap', { volume: 0.5 });
        break;
      case 'clear':
        this.pop(CX, this.sy(s.boss.z) - BOSS_ART[s.boss.kind].size / 2, 320);
        this.hooks.sound('survBossDown');
        break;
      case 'fail':
        this.hooks.sound('lose');
        break;
    }
  }
}

function rowsOf(h: Horde) {
  const cols = Math.max(1, Math.floor((h.x1 - h.x0) / 38));
  return Math.ceil(Math.min(HORDE_DRAW, h.count) / cols);
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
    const iy = y - r * 34 + Math.sin(now * 9 + i) * 2;
    img.setVisible(true).setPosition(left + c * 38 + (r % 2) * 10, iy).setDepth(2000 + iy);
  });
}

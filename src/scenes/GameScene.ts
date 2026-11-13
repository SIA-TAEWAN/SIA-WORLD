import Phaser from 'phaser';
import { Match } from '../game/match';
import { Rng } from '../game/rng';
import { TURN_SECONDS, ITEMS } from '../game/data';
import type { PlayerSetup, ShotResult, SimEvent, TankState, TurnInput } from '../game/types';
import { MAPS, type MapId } from '../data/maps';
import { Terrain } from '../physics/terrain';
import { decideMove, decideShot } from '../ai/ai';
import { buildTerrainArt, drawBackground, hex, makeTankTextures, TEAM_COLORS } from './art';
import { Hud } from '../ui/hud';
import { Input, type ControlEvent } from '../ui/input';
import { sfx } from '../ui/sfx';

export interface MatchSummary {
  winner: 0 | 1 | -1;
  players: { name: string; tank: string; team: 0 | 1; damage: number; alive: boolean; ai: boolean }[];
  turns: number;
}

export interface GameConfig {
  setups: PlayerSetup[];
  mapId: MapId;
  seed: number;
  touch: boolean;
  hudParent: HTMLElement;
  onEnd: (s: MatchSummary) => void;
  onQuit: () => void;
}

type Phase = 'intro' | 'aim' | 'ai' | 'fly' | 'settle' | 'over';

class TankView {
  cont: Phaser.GameObjects.Container;
  barrel: Phaser.GameObjects.Graphics;
  body: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  arrow: Phaser.GameObjects.Text;
  x: number;
  y: number;
  hp: number;
  tweening = false;
  dead = false;

  constructor(
    private scene: Phaser.Scene,
    readonly t: TankState,
  ) {
    this.x = t.x;
    this.y = t.y;
    this.hp = t.hp;
    this.barrel = scene.add.graphics();
    this.barrel.fillStyle(0x3a2a1e).fillRoundedRect(-1, -3.5, 24, 7, 2.5);
    this.barrel.fillStyle(hex(t.def.accent)).fillRoundedRect(1, -2, 20, 4, 2);
    this.barrel.fillStyle(0x3a2a1e).fillRect(18, -4, 5, 8);
    this.barrel.setPosition(0, -15);
    this.body = scene.add.image(0, 0, `tank-${t.tankId}`).setOrigin(0.5, 38 / 40);
    this.cont = scene.add.container(t.x, t.y, [this.barrel, this.body]).setDepth(10);

    const name = scene.add
      .text(0, -52, t.name, { fontFamily: 'Jua, sans-serif', fontSize: '14px', color: '#fff', stroke: TEAM_COLORS[t.team], strokeThickness: 4 })
      .setOrigin(0.5, 1);
    this.hpBar = scene.add.graphics();
    this.arrow = scene.add.text(0, -72, '▼', { fontSize: '18px', color: '#ffe14d', stroke: '#7a4b00', strokeThickness: 3 }).setOrigin(0.5).setVisible(false);
    scene.tweens.add({ targets: this.arrow, y: -66, duration: 400, yoyo: true, repeat: -1 });
    this.label = scene.add.container(t.x, t.y, [name, this.hpBar, this.arrow]).setDepth(30);
    this.drawHp();
  }

  drawHp() {
    const g = this.hpBar;
    const w = 40;
    const r = Math.max(0, this.hp / this.t.maxHp);
    g.clear();
    g.fillStyle(0x1b1b28, 0.85).fillRoundedRect(-w / 2 - 2, -48, w + 4, 8, 3);
    g.fillStyle(hex(TEAM_COLORS[this.t.team])).fillRoundedRect(-w / 2, -46, w * r, 4, 2);
  }

  sync(facing: number, angle: number) {
    this.cont.setPosition(this.x, this.y);
    this.label.setPosition(this.x, this.y);
    this.cont.scaleX = facing;
    this.barrel.rotation = (-angle * Math.PI) / 180;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.body.setTint(0x555555);
    this.barrel.setAlpha(0.6);
    this.label.setAlpha(0.35);
    this.arrow.setVisible(false);
    this.scene.tweens.add({ targets: this.cont, angle: this.t.facing * 18, duration: 400, ease: 'Back.easeOut' });
  }
}

export class GameScene extends Phaser.Scene {
  private cfg!: GameConfig;
  private match!: Match;
  private hud!: Hud;
  private input2!: Input;
  private aiRng!: Rng;

  private tex!: Phaser.Textures.CanvasTexture;
  private img!: ImageData;
  private art!: Uint8ClampedArray;
  private vis!: Terrain;
  private scorch!: Uint8Array;

  private views: TankView[] = [];
  private shellG!: Phaser.GameObjects.Graphics;
  private phase: Phase = 'intro';
  private timeLeft = TURN_SECONDS;
  private power = 0;
  private charging = false;
  private weapon: 0 | 1 | 2 = 0;
  private itemSlot: number | null = null;
  private moveAcc = 0;
  private angleAcc = 0;
  private manualCam = false;
  private pb: { res: ShotResult; frame: number; ev: number } | null = null;
  private ai: { stage: 'wait' | 'move' | 'aim' | 'charge'; move: number; shot: TurnInput | null; wait: number } | null = null;
  private quitBtn!: HTMLButtonElement;

  constructor() {
    super('game');
  }

  init(cfg: GameConfig) {
    this.cfg = cfg;
  }

  create() {
    const cfg = this.cfg;
    this.match = new Match(cfg.setups, cfg.mapId, cfg.seed);
    this.aiRng = new Rng(cfg.seed ^ 0x5bd1e995);
    const map = MAPS[cfg.mapId];
    const { terrain } = this.match;

    makeTankTextures(this);
    drawBackground(this, map.theme, cfg.mapId, terrain.w);

    // 지형
    this.art = buildTerrainArt(terrain, map.theme);
    if (this.textures.exists('terrain')) this.textures.remove('terrain');
    this.tex = this.textures.createCanvas('terrain', terrain.w, terrain.h)!;
    this.img = this.tex.context.createImageData(terrain.w, terrain.h);
    this.scorch = new Uint8Array(terrain.w * terrain.h);
    this.vis = terrain.clone();
    this.paint(0, 0, terrain.w - 1, terrain.h - 1);
    this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(0);
    // 맵 아래 낭떠러지 표시
    this.add.rectangle(-400, terrain.h, terrain.w + 800, 600, 0x000000, 0.25).setOrigin(0).setDepth(1);

    this.views = this.match.tanks.map((t) => new TankView(this, t));
    this.shellG = this.add.graphics().setDepth(20);

    // UI
    this.input2 = new Input();
    this.hud = new Hud(cfg.hudParent, this.input2, cfg.touch);
    this.hud.drawMiniBase(this.match);
    this.quitBtn = document.createElement('button');
    this.quitBtn.className = 'quit';
    this.quitBtn.textContent = '나가기';
    this.quitBtn.onclick = () => {
      if (confirm('게임을 그만두고 나갈까요?')) cfg.onQuit();
    };
    this.hud.root.querySelector('.hud-top')!.prepend(this.quitBtn);
    this.input2.on((e) => this.onControl(e));

    // 카메라
    this.setupCamera();
    this.scale.on('resize', this.setupCamera, this);
    let drag: { x: number; y: number; sx: number; sy: number } | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      drag = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!drag || !p.isDown) return;
      const cam = this.cameras.main;
      if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 6) this.manualCam = true;
      cam.scrollX = drag.sx - (p.x - drag.x) / cam.zoom;
      cam.scrollY = drag.sy - (p.y - drag.y) / cam.zoom;
    });
    this.input.on('pointerup', () => (drag = null));

    this.events.once('shutdown', () => this.cleanup());
    this.events.once('destroy', () => this.cleanup());

    if (import.meta.env.DEV) (window as unknown as { __match: Match }).__match = this.match;
    this.time.delayedCall(500, () => this.nextTurn());
  }

  private cleanup() {
    this.scale.off('resize', this.setupCamera, this);
    this.input2?.destroy();
    this.hud?.destroy();
  }

  private setupCamera() {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    const hudH = w < 700 ? 150 : 118;
    // 가로 화면은 맵 높이가 거의 다 보이게, 세로(모바일) 화면은 좌우로 둘러보도록 더 확대
    const zoom = h > w ? Phaser.Math.Clamp(w / 620, 0.45, 1) : Phaser.Math.Clamp(Math.min((h - hudH * 0.5) / 860, w / 1050), 0.38, 1.15);
    cam.setZoom(zoom);
    const t = this.match.terrain;
    cam.setBounds(-120, -650, t.w + 240, t.h + 650 + hudH / zoom);
  }

  // ---------- 지형 그리기 ----------

  private paint(x0: number, y0: number, x1: number, y1: number) {
    const W = this.vis.w;
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W - 1, Math.ceil(x1));
    y1 = Math.min(this.vis.h - 1, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return;
    const d = this.img.data;
    const art = this.art;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const o = i * 4;
        if (this.vis.data[i]) {
          const k = 1 - this.scorch[i] / 400;
          d[o] = art[o] * k;
          d[o + 1] = art[o + 1] * k;
          d[o + 2] = art[o + 2] * k;
          d[o + 3] = 255;
        } else d[o + 3] = 0;
      }
    }
    this.tex.context.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.tex.refresh();
  }

  private scorchRing(cx: number, cy: number, r: number) {
    const R = r + 6;
    const W = this.vis.w;
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(this.vis.h - 1, cy + R); y++) {
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, cx + R); x++) {
        const dd = Math.hypot(x - cx, y - cy);
        if (dd > r && dd <= R) {
          const i = y * W + x;
          this.scorch[i] = Math.max(this.scorch[i], 200 * (1 - (dd - r) / 6));
        }
      }
    }
  }

  // ---------- 턴 진행 ----------

  private nextTurn() {
    if (this.match.over) return this.finish();
    const t = this.match.startTurn();
    const human = !t.ai;
    this.timeLeft = TURN_SECONDS;
    this.power = 0;
    this.charging = false;
    this.weapon = 0;
    this.itemSlot = null;
    this.manualCam = false;
    this.views.forEach((v) => v.arrow.setVisible(v.t.idx === t.idx));
    this.hud.setTurn(this.match, t, human);
    sfx.turn();
    this.cameras.main.pan(t.x, t.y - 120, 600, 'Sine.easeInOut');
    if (human) this.phase = 'aim';
    else {
      this.phase = 'ai';
      this.ai = { stage: 'wait', move: 0, shot: null, wait: 0.9 };
    }
  }

  private onControl(e: ControlEvent) {
    if (this.phase !== 'aim' || this.charging) return;
    const t = this.match.cur;
    if (e.type === 'weapon') {
      if (e.slot === 2 && !this.match.canUseUlt(t)) {
        this.hud.toast('필살기 게이지가 아직 안 찼어요');
        return;
      }
      this.weapon = e.slot;
      sfx.click();
    } else {
      if (!t.items[e.slot]) return;
      this.itemSlot = this.itemSlot === e.slot ? null : e.slot;
      sfx.click();
      if (this.itemSlot !== null) this.hud.toast(`${ITEMS[t.items[e.slot]!].name} 준비 — 발사할 때 사용돼요`);
    }
  }

  private fire(input: TurnInput) {
    const t = this.match.cur;
    this.phase = 'fly';
    this.charging = false;
    this.views[t.idx].arrow.setVisible(false);
    const v = this.views[t.idx];
    this.tweens.add({ targets: v.barrel, x: -4 * 1, duration: 60, yoyo: true });
    sfx.fire();
    const res = this.match.fire(input);
    this.pb = { res, frame: 0, ev: 0 };
    this.manualCam = false;
    // 포구 연기
    const m = { x: t.x + t.facing * Math.cos((t.angle * Math.PI) / 180) * 24, y: t.y - 15 - Math.sin((t.angle * Math.PI) / 180) * 24 };
    this.puff(m.x, m.y, 0xffffff, 6);
  }

  private skip(msg: string) {
    this.match.skipTurn();
    this.hud.toast(msg);
    this.phase = 'settle';
    this.views.forEach((v) => v.arrow.setVisible(false));
    this.time.delayedCall(900, () => this.nextTurn());
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000;
    const m = this.match;
    if (m.current < 0) return;
    const t = m.cur;

    if (this.phase === 'aim') this.updateHuman(dt);
    else if (this.phase === 'ai') this.updateAi(dt);
    else if (this.phase === 'fly') this.updatePlayback(dt);

    // 탱크 표시 위치 (조준 중엔 상태를 부드럽게 따라감)
    for (const v of this.views) {
      if (this.phase !== 'fly' && !v.tweening) {
        v.x += (v.t.x - v.x) * Math.min(1, dt * 18);
        v.y += (v.t.y - v.y) * Math.min(1, dt * 14);
        if (Math.abs(v.t.y - v.y) < 0.5) v.y = v.t.y;
      }
      v.sync(v.t.facing, v.t.angle);
    }

    // 카메라: 조준 중엔 현재 탱크를 따라감
    if ((this.phase === 'aim' || this.phase === 'ai') && !this.manualCam && !this.cameras.main.panEffect.isRunning) {
      this.follow(t.x, t.y - 120, 0.06);
    }

    const cam = this.cameras.main;
    const view = cam.worldView;
    const shells: { x: number; y: number }[] = [];
    if (this.pb) {
      for (const s of this.pb.res.shells) {
        const k = Math.floor(this.pb.frame) - s.spawn;
        if (k >= 0 && k * 2 < s.path.length) shells.push({ x: s.path[k * 2], y: s.path[k * 2 + 1] });
      }
    }
    this.hud.drawMini(m, { x: view.x, y: view.y, w: view.width, h: view.height }, shells);
    this.hud.update(m, t, {
      power: this.power,
      charging: this.charging,
      weapon: this.weapon,
      itemSlot: this.itemSlot,
      timeLeft: this.phase === 'aim' || this.phase === 'ai' ? this.timeLeft : this.timeLeft,
      human: !t.ai,
    });
  }

  private follow(x: number, y: number, k: number) {
    const cam = this.cameras.main;
    const mx = cam.scrollX + cam.width / 2;
    const my = cam.scrollY + cam.height / 2;
    cam.scrollX += (x - mx) * k;
    cam.scrollY += (y - my) * k;
  }

  private updateHuman(dt: number) {
    const m = this.match;
    const t = m.cur;
    const c = this.input2.state;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.charging) return this.fire(this.turnInput(this.power));
      return this.skip('시간 초과! 턴이 넘어갑니다');
    }

    if (!this.charging) {
      const dir = c.left && !c.right ? -1 : c.right && !c.left ? 1 : 0;
      if (dir) {
        t.facing = dir;
        this.moveAcc += 48 * dt;
        while (this.moveAcc >= 1) {
          this.moveAcc--;
          if (!m.moveStep(dir)) {
            this.moveAcc = 0;
            break;
          }
        }
        this.manualCam = false;
        if (!t.alive) {
          this.views[t.idx].kill();
          this.hud.toast(`${t.name} 추락!`);
          this.phase = 'settle';
          this.time.delayedCall(900, () => this.nextTurn());
          return;
        }
      } else this.moveAcc = 0;

      const ad = c.up && !c.down ? 1 : c.down && !c.up ? -1 : 0;
      if (ad) {
        this.angleAcc += 28 * dt;
        while (this.angleAcc >= 1) {
          this.angleAcc--;
          m.setAngle(Math.round(t.angle) + ad);
        }
      } else this.angleAcc = 0.99;
    }

    if (c.fire && !this.charging) {
      this.charging = true;
      this.power = 0;
    }
    if (this.charging) {
      this.power = Math.min(100, this.power + 52 * dt);
      if (!c.fire) this.fire(this.turnInput(this.power));
    }
  }

  private turnInput(power: number): TurnInput {
    const t = this.match.cur;
    return { angle: Math.round(t.angle), facing: t.facing, power: Math.round(power * 10) / 10, weapon: this.weapon, itemSlot: this.itemSlot };
  }

  private updateAi(dt: number) {
    const ai = this.ai!;
    const m = this.match;
    const t = m.cur;
    this.timeLeft -= dt;
    if (ai.stage === 'wait') {
      ai.wait -= dt;
      if (ai.wait <= 0) {
        ai.move = decideMove(m, t.ai!, this.aiRng);
        ai.stage = 'move';
      }
    } else if (ai.stage === 'move') {
      if (ai.move !== 0) {
        const dir = ai.move > 0 ? 1 : -1;
        this.moveAcc += 48 * dt;
        while (this.moveAcc >= 1 && ai.move !== 0) {
          this.moveAcc--;
          if (!m.moveStep(dir)) ai.move = 0;
          else ai.move -= dir;
        }
        if (!t.alive) {
          this.views[t.idx].kill();
          this.phase = 'settle';
          this.time.delayedCall(900, () => this.nextTurn());
        }
        return;
      }
      ai.shot = decideShot(m, t.ai!, this.aiRng);
      this.weapon = ai.shot.weapon;
      this.itemSlot = ai.shot.itemSlot;
      t.facing = ai.shot.facing;
      ai.stage = 'aim';
    } else if (ai.stage === 'aim') {
      const target = ai.shot!.angle;
      const step = 40 * dt;
      if (Math.abs(t.angle - target) <= step) {
        t.angle = target;
        ai.stage = 'charge';
        this.charging = true;
        this.power = 0;
      } else t.angle += Math.sign(target - t.angle) * step;
    } else if (ai.stage === 'charge') {
      this.power = Math.min(ai.shot!.power, this.power + 52 * dt);
      if (this.power >= ai.shot!.power) this.fire(ai.shot!);
    }
  }

  // ---------- 발사 재생 ----------

  private updatePlayback(dt: number) {
    const pb = this.pb!;
    pb.frame += dt * 60;
    const evs = pb.res.events;
    while (pb.ev < evs.length && evs[pb.ev].f <= pb.frame) this.applyEvent(evs[pb.ev++]);

    // 포탄 그리기
    const g = this.shellG;
    g.clear();
    let lead: { x: number; y: number } | null = null;
    for (const s of pb.res.shells) {
      const k = Math.floor(pb.frame) - s.spawn;
      if (k < 0 || k * 2 >= s.path.length) continue;
      const x = s.path[k * 2];
      const y = s.path[k * 2 + 1];
      // 꼬리
      for (let j = Math.max(0, k - 14); j < k; j++) {
        const a = (j - (k - 14)) / 14;
        g.fillStyle(0xffffff, a * 0.5).fillCircle(s.path[j * 2], s.path[j * 2 + 1], 1.5 + a * 2.5);
      }
      const col = s.behavior === 'laser' ? 0xff3b6b : s.behavior === 'build' ? 0x8b5a2b : s.behavior === 'drill' ? 0x9aa0b0 : 0x2b2b3a;
      g.fillStyle(0x000000, 0.25).fillCircle(x + 1.5, y + 1.5, 6);
      g.fillStyle(col).fillCircle(x, y, 5.5);
      g.fillStyle(0xffffff, 0.7).fillCircle(x - 1.8, y - 1.8, 1.8);
      if (!lead) lead = { x, y };
    }
    if (lead && !this.manualCam) this.follow(lead.x, lead.y, 0.14);

    if (pb.frame >= pb.res.frames + 2 && pb.ev >= evs.length) {
      g.clear();
      this.endShot();
    }
  }

  private applyEvent(e: SimEvent) {
    switch (e.type) {
      case 'explode': {
        this.vis.carve(e.x, e.y, e.crater);
        this.scorchRing(e.x, e.y, e.crater);
        this.paint(e.x - e.crater - 7, e.y - e.crater - 7, e.x + e.crater + 7, e.y + e.crater + 7);
        this.boom(e.x, e.y, Math.max(e.radius, e.crater), e.big);
        break;
      }
      case 'build': {
        this.vis.circle(e.x, e.y, e.r, 1);
        for (let y = Math.floor(e.y - e.r); y <= e.y + e.r; y++)
          for (let x = Math.floor(e.x - e.r); x <= e.x + e.r; x++) if (x >= 0 && y >= 0 && x < this.vis.w && y < this.vis.h) this.scorch[y * this.vis.w + x] = 0;
        this.paint(e.x - e.r - 1, e.y - e.r - 1, e.x + e.r + 1, e.y + e.r + 1);
        this.puff(e.x, e.y, 0xc49a6c, 10);
        sfx.build();
        break;
      }
      case 'carveLine': {
        this.vis.carveLine(e.x1, e.y1, e.x2, e.y2, e.r);
        this.paint(Math.min(e.x1, e.x2) - e.r - 1, Math.min(e.y1, e.y2) - e.r - 1, Math.max(e.x1, e.x2) + e.r + 1, Math.max(e.y1, e.y2) + e.r + 1);
        if (Math.random() < 0.5) this.puff(e.x2, e.y2, 0x9c7b5b, 2);
        break;
      }
      case 'laser': {
        this.vis.carveLine(e.x1, Math.max(-60, e.y1), e.x2, e.y2, e.r);
        this.paint(e.x1 - e.r - 1, 0, e.x1 + e.r + 1, e.y2 + e.r + 1);
        const beam = this.add.graphics().setDepth(25);
        beam.fillStyle(0xff3b6b, 0.35).fillRect(e.x1 - e.r * 2.2, e.y1, e.r * 4.4, e.y2 - e.y1);
        beam.fillStyle(0xffffff, 0.95).fillRect(e.x1 - e.r * 0.6, e.y1, e.r * 1.2, e.y2 - e.y1);
        this.tweens.add({ targets: beam, alpha: 0, scaleX: 1.4, duration: 650, onComplete: () => beam.destroy() });
        this.cameras.main.flash(120, 255, 200, 220);
        this.cameras.main.shake(300, 0.008);
        sfx.laser();
        break;
      }
      case 'damage': {
        const v = this.views[e.target];
        v.hp = Math.max(0, v.hp - e.amount);
        v.drawHp();
        v.body.setTintFill(0xffffff);
        this.time.delayedCall(90, () => (v.dead ? v.body.setTint(0x555555) : v.body.clearTint()));
        this.floatText(v.x, v.y - 60, `${e.direct ? '직격! ' : ''}-${e.amount}`, e.direct ? '#ffdd33' : '#ff6b6b');
        break;
      }
      case 'heal': {
        const v = this.views[e.target];
        v.hp += e.amount;
        v.drawHp();
        this.floatText(v.x, v.y - 60, `+${e.amount}`, '#5cff8a');
        sfx.heal();
        break;
      }
      case 'move': {
        const v = this.views[e.target];
        v.tweening = true;
        const dur = e.kind === 'teleport' ? 1 : Math.min(900, 120 + Math.abs(e.y - v.y) * 3);
        if (e.kind === 'teleport') this.puff(v.x, v.y - 10, 0xb18cff, 10);
        this.tweens.add({
          targets: v,
          x: e.x,
          y: e.y,
          duration: dur,
          ease: e.kind === 'fall' ? 'Quad.easeIn' : 'Cubic.easeOut',
          onComplete: () => {
            v.tweening = false;
            if (e.kind === 'teleport') this.puff(e.x, e.y - 10, 0xb18cff, 10);
          },
        });
        break;
      }
      case 'death': {
        const v = this.views[e.target];
        this.time.delayedCall(250, () => {
          v.kill();
          this.puff(v.x, v.y - 12, 0x444444, 14);
          this.floatText(v.x, v.y - 80, 'K.O.', '#ffffff');
        });
        break;
      }
    }
  }

  private endShot() {
    this.pb = null;
    this.phase = 'settle';
    // 기기 화면을 시뮬레이션 결과와 정확히 맞춘다
    this.vis = this.match.terrain.clone();
    this.paint(0, 0, this.vis.w - 1, this.vis.h - 1);
    this.hud.drawMiniBase(this.match);
    for (const v of this.views) {
      v.hp = v.t.hp;
      v.drawHp();
      if (!v.t.alive) v.kill();
    }
    this.time.delayedCall(this.views.some((v) => v.tweening) ? 1100 : 700, () => this.nextTurn());
  }

  private finish() {
    this.phase = 'over';
    this.views.forEach((v) => v.arrow.setVisible(false));
    sfx.win();
    const m = this.match;
    const summary: MatchSummary = {
      winner: m.winner as 0 | 1 | -1,
      turns: m.turn,
      players: m.tanks.map((t) => ({ name: t.name, tank: t.tankId, team: t.team, damage: t.damageDealt, alive: t.alive, ai: !!t.ai })),
    };
    this.time.delayedCall(1400, () => this.cfg.onEnd(summary));
  }

  // ---------- 효과 ----------

  private boom(x: number, y: number, r: number, big: boolean) {
    sfx.boom(big);
    const flash = this.add.circle(x, y, r * 0.5, 0xffffff, 1).setDepth(26);
    this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
    const fire = this.add.circle(x, y, r * 0.8, 0xffa020, 0.9).setDepth(25);
    this.tweens.add({ targets: fire, scale: 1.3, alpha: 0, duration: 480, ease: 'Cubic.easeOut', onComplete: () => fire.destroy() });
    const ring = this.add.circle(x, y, r, 0xffffff, 0).setStrokeStyle(4, 0xfff1a8, 0.9).setDepth(26);
    ring.setScale(0.3);
    this.tweens.add({ targets: ring, scale: 1.1, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
    const n = big ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const sp = r * (0.8 + Math.random() * 1.4);
      const p = this.add.rectangle(x, y, 4 + Math.random() * 4, 4 + Math.random() * 4, Math.random() < 0.5 ? 0x8f5f35 : 0xffc240).setDepth(24);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * sp,
        y: y + Math.sin(a) * sp * 0.7 + 40,
        angle: 360,
        alpha: 0,
        duration: 600 + Math.random() * 400,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
    this.puff(x, y - r * 0.3, 0x666666, big ? 10 : 5);
    this.cameras.main.shake(big ? 380 : 200, big ? 0.012 : 0.005);
  }

  private puff(x: number, y: number, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const c = this.add.circle(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 10, 4 + Math.random() * 6, color, 0.7).setDepth(23);
      this.tweens.add({
        targets: c,
        y: c.y - 20 - Math.random() * 30,
        x: c.x + (Math.random() - 0.5) * 30,
        scale: 2,
        alpha: 0,
        duration: 700 + Math.random() * 500,
        onComplete: () => c.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, s: string, color: string) {
    const t = this.add
      .text(x, y, s, { fontFamily: 'Jua, sans-serif', fontSize: '22px', color, stroke: '#2a1a10', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(40);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
}

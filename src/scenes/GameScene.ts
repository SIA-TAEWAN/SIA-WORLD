import Phaser from 'phaser';
import { Match, type MatchSnapshot } from '../game/match';
import { Rng } from '../game/rng';
import { TURN_SECONDS, ITEMS } from '../game/data';
import type { PlayerSetup, ShotResult, SimEvent, TankState, TurnInput } from '../game/types';
import { MAPS, type MapId } from '../data/maps';
import { Terrain } from '../physics/terrain';
import type { LiveState, NetHooks, TurnRecord } from '../net/protocol';
import { decideMove, decideShot } from '../ai/ai';
import { buildTerrainArt, drawBackground, hex, makeTankTextures, TEAM_COLORS } from './art';
import { Fx } from './fx';
import { music } from '../ui/music';
import { Hud } from '../ui/hud';
import { Input, type ControlEvent } from '../ui/input';
import { sfx } from '../ui/sfx';

export interface MatchSummary {
  winner: 0 | 1 | -1;
  players: { name: string; tank: string; team: 0 | 1; damage: number; alive: boolean; ai: boolean; mine: boolean }[];
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
  /** 온라인 대전일 때만 */
  net?: NetHooks;
  /** 재접속: 기준 기기에서 받은 판 상태 */
  resume?: { snap: MatchSnapshot; records: TurnRecord[]; elapsed: number };
}

type Phase = 'intro' | 'aim' | 'ai' | 'remote' | 'fly' | 'settle' | 'over';
type Control = 'human' | 'ai' | 'remote';

class TankView {
  cont: Phaser.GameObjects.Container;
  /** 몸체·포신을 묶어 숨쉬기·반동·흔들림을 주는 틀 */
  rig: Phaser.GameObjects.Container;
  barrel: Phaser.GameObjects.Graphics;
  body: Phaser.GameObjects.Image;
  lids: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  arrow: Phaser.GameObjects.Text;
  x: number;
  y: number;
  hp: number;
  tweening = false;
  dead = false;
  private lastX: number;
  private moveT = 0;
  private dustT = 0;
  private breathe: Phaser.Tweens.Tween;
  private blinkTimer: Phaser.Time.TimerEvent;

  constructor(
    private scene: Phaser.Scene,
    readonly t: TankState,
    private fx: Fx,
  ) {
    this.x = t.x;
    this.y = t.y;
    this.lastX = t.x;
    this.hp = t.hp;
    this.barrel = scene.add.graphics();
    this.barrel.fillStyle(0x3a2a1e).fillRoundedRect(-1, -3.5, 24, 7, 2.5);
    this.barrel.fillStyle(hex(t.def.accent)).fillRoundedRect(1, -2, 20, 4, 2);
    this.barrel.fillStyle(0x3a2a1e).fillRect(18, -4, 5, 8);
    this.barrel.setPosition(0, -15);
    this.body = scene.add.image(0, 0, `tank-${t.tankId}`).setOrigin(0.5, 38 / 40);
    // 눈꺼풀 (깜빡일 때만 보임)
    this.lids = scene.add.graphics().setVisible(false);
    this.lids.fillStyle(hex(t.def.color)).fillEllipse(3, -19, 6, 7).fillEllipse(8, -19, 6, 7);
    this.lids.lineStyle(1.5, 0x1e1e2a).lineBetween(0.5, -18.5, 5.5, -18.5).lineBetween(5.5, -18.5, 10.5, -18.5);
    this.rig = scene.add.container(0, 0, [this.barrel, this.body, this.lids]);
    this.cont = scene.add.container(t.x, t.y, [this.rig]).setDepth(10);

    const name = scene.add
      .text(0, -52, t.name, { fontFamily: 'Jua, sans-serif', fontSize: '14px', color: '#fff', stroke: TEAM_COLORS[t.team], strokeThickness: 4 })
      .setOrigin(0.5, 1);
    this.hpBar = scene.add.graphics();
    this.arrow = scene.add.text(0, -72, '▼', { fontSize: '18px', color: '#ffe14d', stroke: '#7a4b00', strokeThickness: 3 }).setOrigin(0.5).setVisible(false);
    scene.tweens.add({ targets: this.arrow, y: -66, duration: 400, yoyo: true, repeat: -1 });
    this.label = scene.add.container(t.x, t.y, [name, this.hpBar, this.arrow]).setDepth(30);
    this.drawHp();

    // 살아 있는 느낌: 천천히 숨쉬기 + 가끔 눈 깜빡임
    this.breathe = scene.tweens.add({ targets: this.rig, scaleY: 0.955, scaleX: 1.02, duration: 650 + Math.random() * 250, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 600 });
    this.blinkTimer = scene.time.addEvent({
      delay: 2200 + Math.random() * 2000,
      loop: true,
      callback: () => {
        if (this.dead) return;
        this.lids.setVisible(true);
        scene.time.delayedCall(110, () => this.dead || this.lids.setVisible(false));
      },
    });
  }

  drawHp() {
    const g = this.hpBar;
    const w = 40;
    const r = Math.max(0, this.hp / this.t.maxHp);
    g.clear();
    g.fillStyle(0x1b1b28, 0.85).fillRoundedRect(-w / 2 - 2, -48, w + 4, 8, 3);
    g.fillStyle(hex(TEAM_COLORS[this.t.team])).fillRoundedRect(-w / 2, -46, w * r, 4, 2);
  }

  sync(facing: number, angle: number, dt: number) {
    // 굴러가는 중이면 덜컹거리고 흙먼지를 날린다
    const moving = Math.abs(this.x - this.lastX) > 0.05 && !this.dead;
    this.lastX = this.x;
    if (moving) {
      this.moveT += dt;
      this.rig.y = -Math.abs(Math.sin(this.moveT * 26)) * 1.6;
      this.rig.angle = Math.sin(this.moveT * 13) * 1.5;
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.07;
        this.fx.dust(this.x - facing * 14, this.y - 2);
      }
    } else if (this.moveT) {
      this.moveT = 0;
      this.rig.y = 0;
      this.rig.angle = 0;
    }
    this.cont.setPosition(this.x, this.y);
    this.label.setPosition(this.x, this.y);
    this.cont.scaleX = facing;
    this.barrel.rotation = (-angle * Math.PI) / 180;
  }

  /** 발사 반동 */
  recoil() {
    this.scene.tweens.add({ targets: this.barrel, x: -4, duration: 60, yoyo: true });
    this.scene.tweens.add({ targets: this.body, x: -3, scaleY: 0.9, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** 맞았을 때 흔들림 */
  hurt() {
    this.body.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => (this.dead ? this.body.setTint(0x555555) : this.body.clearTint()));
    this.scene.tweens.add({ targets: this.body, x: { from: -3, to: 3 }, duration: 50, yoyo: true, repeat: 2, onComplete: () => (this.body.x = 0) });
  }

  private status: Phaser.GameObjects.Text | null = null;

  setStatus(text: string | null) {
    if (!text) {
      this.status?.destroy();
      this.status = null;
      return;
    }
    if (!this.status) {
      this.status = this.scene.add
        .text(0, -86, '', { fontFamily: 'Jua, sans-serif', fontSize: '13px', color: '#fff', backgroundColor: '#c0392bcc', padding: { x: 6, y: 2 } })
        .setOrigin(0.5);
      this.label.add(this.status);
    }
    this.status.setText(text);
  }

  destroy() {
    this.breathe.remove();
    this.blinkTimer.remove();
    this.cont.destroy();
    this.label.destroy();
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.breathe.remove();
    this.rig.setScale(1);
    this.body.setTint(0x555555);
    this.barrel.setAlpha(0.6);
    this.label.setAlpha(0.35);
    this.arrow.setVisible(false);
    // X자 눈
    this.lids.clear().setVisible(true);
    this.lids.fillStyle(0x555555).fillEllipse(3, -19, 6, 7).fillEllipse(8, -19, 6, 7);
    this.lids.lineStyle(1.6, 0x1e1e2a);
    for (const ex of [3, 8]) this.lids.lineBetween(ex - 2, -21, ex + 2, -17).lineBetween(ex - 2, -17, ex + 2, -21);
    this.scene.tweens.add({ targets: this.cont, angle: this.t.facing * 18, duration: 400, ease: 'Back.easeOut' });
  }
}

/** 무기 동작별 포탄 색 (몸통·코·꼬리) */
const SHELL_LOOK: Record<string, { body: number; nose: number; trail: number }> = {
  normal: { body: 0x2b2b3a, nose: 0xffc240, trail: 0xffffff },
  drop: { body: 0x2b2b3a, nose: 0x7fd3ff, trail: 0xd6f0ff },
  drill: { body: 0x7d8494, nose: 0xdfe3ea, trail: 0xc9a27a },
  laser: { body: 0xff3b6b, nose: 0xffffff, trail: 0xff7aa0 },
  bounce: { body: 0x2fb35f, nose: 0xb6ffcc, trail: 0xa0ffb0 },
  build: { body: 0x8b5a2b, nose: 0xd9b38c, trail: 0xd9b38c },
  push: { body: 0x6b4fe0, nose: 0xd7ccff, trail: 0xc4b0ff },
};

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
  private fx!: Fx;
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
  /** 이번 턴 이동 기록 (부호 = 방향, 크기 = 걸음 수) */
  private runs: number[] = [];
  private records = new Map<number, TurnRecord>();
  private remote: { applied: number; stage: 'wait' | 'move' | 'aim' | 'charge'; rec?: TurnRecord; liveRuns: number[]; moveAcc: number } = {
    applied: 0,
    stage: 'wait',
    liveRuns: [],
    moveAcc: 0,
  };
  private liveTimer = 0;
  private lastLive = '';

  constructor() {
    super('game');
  }

  init(cfg: GameConfig) {
    this.cfg = cfg;
  }

  create() {
    const cfg = this.cfg;
    this.match = cfg.resume ? Match.fromSnapshot(cfg.resume.snap) : new Match(cfg.setups, cfg.mapId, cfg.seed);
    if (cfg.resume) this.records = new Map(cfg.resume.records.map((r) => [r.turn, r]));
    this.aiRng = new Rng(cfg.seed ^ 0x5bd1e995);
    const map = MAPS[cfg.mapId];
    const { terrain } = this.match;

    makeTankTextures(this);
    drawBackground(this, map.theme, cfg.mapId, terrain.w);
    this.fx = new Fx(this, map.theme);

    // 지형
    // 색은 처음 지형 기준으로 칠한다 (재접속해도 같은 모습)
    this.art = buildTerrainArt(map.build(new Rng(this.match.seed)), map.theme, cfg.mapId);
    if (this.textures.exists('terrain')) this.textures.remove('terrain');
    this.tex = this.textures.createCanvas('terrain', terrain.w, terrain.h)!;
    this.img = this.tex.context.createImageData(terrain.w, terrain.h);
    this.scorch = new Uint8Array(terrain.w * terrain.h);
    this.vis = terrain.clone();
    this.paint(0, 0, terrain.w - 1, terrain.h - 1);
    this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(0);
    // 맵 아래 낭떠러지 표시
    this.add.rectangle(-400, terrain.h, terrain.w + 800, 600, 0x000000, 0.25).setOrigin(0).setDepth(1);

    this.views = this.match.tanks.map((t) => new TankView(this, t, this.fx));
    this.shellG = this.add.graphics().setDepth(20);

    // UI
    this.input2 = new Input();
    this.hud = new Hud(cfg.hudParent, this.input2, cfg.touch);
    this.hud.drawMiniBase(this.match);
    this.quitBtn = document.createElement('button');
    this.quitBtn.className = 'quit';
    this.quitBtn.textContent = '나가기';
    this.quitBtn.onclick = () => {
      if (confirm(cfg.net ? '게임에서 나갈까요? 30초 뒤에는 AI가 대신 조종하고 다시 들어올 수 없어요.' : '게임을 그만두고 나갈까요?')) cfg.onQuit();
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

    if (import.meta.env.DEV) Object.assign(window, { __match: this.match, __scene: this });
    if (cfg.resume) {
      const { elapsed } = cfg.resume;
      this.views.forEach((v) => v.t.alive || v.kill());
      this.time.delayedCall(300, () => (this.match.over ? this.finish() : this.match.current < 0 ? this.nextTurn() : this.beginTurn(Math.min(TURN_SECONDS - 3, elapsed))));
    } else this.time.delayedCall(500, () => this.nextTurn());
    cfg.net?.attach(this);
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
    const hudH = this.hud?.bottomHeight || (w < 700 ? 150 : 118);
    const short = h < 520 && w > h;
    // 가로 화면은 맵 높이가 거의 다 보이게, 세로(모바일)·낮은 가로 화면은 둘러보도록 더 확대
    const zoom =
      h > w
        ? Phaser.Math.Clamp(w / 620, 0.45, 1)
        : Phaser.Math.Clamp(Math.min((h - hudH * (short ? 0.85 : 0.5)) / (short ? 520 : 860), w / 1050), 0.38, 1.15);
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

  /** 이 기기에서 이 탱크를 누가 조종하는지 */
  private controlOf(t: TankState): Control {
    const net = this.cfg.net;
    if (!net) return t.ai ? 'ai' : 'human';
    if (t.ai) return net.isHost() ? 'ai' : 'remote';
    return t.idx === net.myIdx ? 'human' : 'remote';
  }

  private nextTurn() {
    if (this.match.over) return this.finish();
    this.match.startTurn();
    this.cfg.net?.turnStarted(this.match);
    this.beginTurn(0);
  }

  private beginTurn(elapsed: number) {
    const t = this.match.cur;
    const ctrl = this.controlOf(t);
    this.timeLeft = TURN_SECONDS - elapsed;
    this.power = 0;
    this.charging = false;
    this.weapon = 0;
    this.itemSlot = null;
    this.manualCam = false;
    this.runs = [];
    this.remote = { applied: 0, stage: 'wait', liveRuns: [], moveAcc: 0 };
    this.lastLive = '';
    this.views.forEach((v) => v.arrow.setVisible(v.t.idx === t.idx));
    const tag = t.ai ? 'AI' : ctrl === 'human' && this.cfg.net ? '내 차례!' : '';
    this.hud.setTurn(this.match, t, ctrl === 'human', tag);
    sfx.turn();
    this.cameras.main.pan(t.x, this.focusY(t.y, 0.7), 600, 'Sine.easeInOut');
    this.ai = null;
    if (ctrl === 'human') this.phase = 'aim';
    else if (ctrl === 'ai') this.startAi();
    else {
      this.phase = 'remote';
      const rec = this.records.get(this.match.turn);
      if (rec) this.onRemoteTurn(rec);
    }
  }

  private startAi() {
    this.phase = 'ai';
    this.ai = { stage: 'wait', move: 0, shot: null, wait: 0.9 };
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

  /** 1px 이동하고, 성공하면 이동 기록에 남긴다 */
  private step(dir: 1 | -1): boolean {
    if (!this.match.moveStep(dir)) return false;
    const last = this.runs[this.runs.length - 1];
    if (last !== undefined && Math.sign(last) === dir) this.runs[this.runs.length - 1] += dir;
    else this.runs.push(dir);
    return true;
  }

  /** 이 기기에서 끝낸 턴을 다른 기기에 알린다 */
  private sendTurn(input: TurnInput | null) {
    const net = this.cfg.net;
    if (!net) return;
    const rec: TurnRecord = { turn: this.match.turn, runs: [...this.runs], input, facing: this.match.cur.facing };
    this.records.set(rec.turn, rec);
    net.sendTurn(rec);
  }

  private turnDone() {
    this.cfg.net?.turnDone(this.match.turn, this.match.stateHash());
  }

  private fire(input: TurnInput) {
    const t = this.match.cur;
    this.phase = 'fly';
    this.charging = false;
    this.views[t.idx].arrow.setVisible(false);
    const v = this.views[t.idx];
    v.recoil();
    sfx.fire();
    const res = this.match.fire(input);
    this.turnDone();
    this.pb = { res, frame: 0, ev: 0 };
    this.manualCam = false;
    // 포구 연기
    const m = { x: t.x + t.facing * Math.cos((t.angle * Math.PI) / 180) * 24, y: t.y - 15 - Math.sin((t.angle * Math.PI) / 180) * 24 };
    this.fx.muzzle(m.x, m.y, Math.atan2(-Math.sin((t.angle * Math.PI) / 180), t.facing * Math.cos((t.angle * Math.PI) / 180)));
  }

  private skip(msg: string) {
    this.match.skipTurn();
    this.turnDone();
    this.hud.toast(msg);
    this.phase = 'settle';
    this.views.forEach((v) => v.arrow.setVisible(false));
    this.time.delayedCall(900, () => this.nextTurn());
  }

  /** 이동 중 맵 밖으로 떨어졌을 때 */
  private fellDuringMove() {
    const t = this.match.cur;
    this.match.checkWinner();
    this.turnDone();
    this.views[t.idx].kill();
    this.hud.toast(`${t.name} 추락!`);
    this.phase = 'settle';
    this.time.delayedCall(900, () => this.nextTurn());
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000;
    const m = this.match;
    if (m.current < 0) return;
    const t = m.cur;

    if (this.phase === 'aim') this.updateHuman(dt);
    else if (this.phase === 'ai') this.updateAi(dt);
    else if (this.phase === 'remote') this.updateRemote(dt);
    else if (this.phase === 'fly') this.updatePlayback(dt);

    // 내가 조종 중이면 다른 기기에 진행 상황을 보낸다
    if ((this.phase === 'aim' || this.phase === 'ai') && this.cfg.net) {
      this.liveTimer -= dt;
      if (this.liveTimer <= 0) {
        this.liveTimer = 0.12;
        const live: LiveState = {
          turn: m.turn,
          runs: this.runs,
          angle: Math.round(t.angle * 10) / 10,
          facing: t.facing,
          power: Math.round(this.power),
          charging: this.charging,
          weapon: this.weapon,
          itemSlot: this.itemSlot,
        };
        const j = JSON.stringify(live);
        if (j !== this.lastLive) {
          this.lastLive = j;
          this.cfg.net.sendLive(live);
        }
      }
    }

    // 탱크 표시 위치 (조준 중엔 상태를 부드럽게 따라감)
    for (const v of this.views) {
      if (this.phase !== 'fly' && !v.tweening) {
        v.x += (v.t.x - v.x) * Math.min(1, dt * 18);
        v.y += (v.t.y - v.y) * Math.min(1, dt * 14);
        if (Math.abs(v.t.y - v.y) < 0.5) v.y = v.t.y;
      }
      v.sync(v.t.facing, v.t.angle, dt);
    }

    // 카메라: 조준 중엔 현재 탱크를 따라감
    if ((this.phase === 'aim' || this.phase === 'ai' || this.phase === 'remote') && !this.manualCam && !this.cameras.main.panEffect.isRunning) {
      this.follow(t.x, this.focusY(t.y, 0.7), 0.06);
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
      timeLeft: this.timeLeft,
      human: this.phase === 'aim',
    });
  }

  /** 화면 아래 조작판을 뺀 보이는 영역의 at(0~1) 높이에 y가 오도록 하는 카메라 중심 y */
  private focusY(y: number, at: number) {
    const h = this.scale.height;
    const vis = h - (this.hud?.bottomHeight ?? 0);
    return y - (vis * at - h / 2) / this.cameras.main.zoom;
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
      if (this.charging) {
        const input = this.turnInput(this.power);
        this.sendTurn(input);
        return this.fire(input);
      }
      this.sendTurn(null);
      return this.skip('시간 초과! 턴이 넘어갑니다');
    }

    if (!this.charging) {
      const dir = c.left && !c.right ? -1 : c.right && !c.left ? 1 : 0;
      if (dir) {
        t.facing = dir;
        this.moveAcc += 48 * dt;
        while (this.moveAcc >= 1) {
          this.moveAcc--;
          if (!this.step(dir)) {
            this.moveAcc = 0;
            break;
          }
        }
        this.manualCam = false;
        if (!t.alive) {
          this.sendTurn(null);
          return this.fellDuringMove();
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
      if (!c.fire) {
        const input = this.turnInput(this.power);
        this.sendTurn(input);
        this.fire(input);
      }
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
          if (!this.step(dir)) ai.move = 0;
          else ai.move -= dir;
        }
        if (!t.alive) {
          this.sendTurn(null);
          this.fellDuringMove();
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
      if (this.power >= ai.shot!.power) {
        this.sendTurn(ai.shot!);
        this.fire(ai.shot!);
      }
    }
  }

  // ---------- 다른 기기의 턴 재생 ----------

  private flatSteps(runs: number[]): (1 | -1)[] {
    const out: (1 | -1)[] = [];
    for (const r of runs) for (let i = 0; i < Math.abs(r); i++) out.push(r > 0 ? 1 : -1);
    return out;
  }

  /** 이동 기록 중 아직 적용하지 않은 걸음을 max개까지 적용. 다 적용했으면 true */
  private applyRemoteSteps(runs: number[], max: number): boolean {
    const steps = this.flatSteps(runs);
    let n = 0;
    while (this.remote.applied < steps.length && n < max) {
      this.match.moveStep(steps[this.remote.applied++]);
      n++;
      if (!this.match.cur.alive) break;
    }
    return this.remote.applied >= steps.length;
  }

  /** 상대 기기의 실시간 진행 상황 (이동·각도·파워) */
  onRemoteLive(l: LiveState) {
    if (this.phase !== 'remote' || l.turn !== this.match.turn || this.remote.stage !== 'wait') return;
    const t = this.match.cur;
    this.remote.liveRuns = l.runs;
    this.applyRemoteSteps(l.runs, 999);
    if (!t.alive) return;
    t.facing = l.facing;
    t.angle = l.angle;
    this.power = l.power;
    this.charging = l.charging;
    this.weapon = l.weapon;
    this.itemSlot = l.itemSlot;
  }

  /** 상대 기기가 턴을 끝냈다 */
  onRemoteTurn(rec: TurnRecord) {
    if (rec.turn < this.match.turn) return;
    if (!this.records.has(rec.turn)) this.records.set(rec.turn, rec);
    if (this.phase !== 'remote' || rec.turn !== this.match.turn || this.remote.stage !== 'wait') return;
    this.remote.rec = this.records.get(rec.turn);
    this.remote.stage = 'move';
  }

  private updateRemote(dt: number) {
    const m = this.match;
    const t = m.cur;
    const net = this.cfg.net!;
    const r = this.remote;
    this.timeLeft -= dt;

    if (r.stage === 'wait') {
      // 조종하던 사람 대신 AI가 넘겨받았으면 기준 기기가 이어서 둔다
      if (this.controlOf(t) === 'ai') {
        if (r.applied === 0) this.startAi();
        else {
          // 이미 움직인 걸음은 그대로 두고 그 자리에서 턴을 넘긴다
          this.runs = [...r.liveRuns];
          this.sendTurn(null);
          this.skip('연결이 끊겨 턴을 넘깁니다');
        }
        return;
      }
      // 시간이 넘었는데 아무 입력도 안 오면 기준 기기가 턴을 넘긴다
      if (this.timeLeft < -4 && net.isHost()) {
        const rec: TurnRecord = { turn: m.turn, runs: [...r.liveRuns], input: null, facing: t.facing };
        this.records.set(rec.turn, rec);
        net.sendTurn(rec);
        r.rec = rec;
        r.stage = 'move';
      }
      return;
    }
    const rec = r.rec!;
    if (r.stage === 'move') {
      r.moveAcc += 120 * dt;
      const n = Math.floor(r.moveAcc);
      r.moveAcc -= n;
      const done = this.applyRemoteSteps(rec.runs, n);
      if (!t.alive) return this.fellDuringMove();
      if (!done) return;
      t.facing = rec.facing;
      if (!rec.input) return this.skip('시간 초과! 턴이 넘어갑니다');
      this.weapon = rec.input.weapon;
      this.itemSlot = rec.input.itemSlot;
      t.facing = rec.input.facing;
      r.stage = 'aim';
    } else if (r.stage === 'aim') {
      const target = rec.input!.angle;
      const s = 90 * dt;
      if (Math.abs(t.angle - target) <= s) {
        t.angle = target;
        r.stage = 'charge';
        this.charging = true;
        if (this.power > rec.input!.power) this.power = 0;
      } else t.angle += Math.sign(target - t.angle) * s;
    } else if (r.stage === 'charge') {
      this.power = Math.min(rec.input!.power, this.power + 140 * dt);
      if (this.power >= rec.input!.power) this.fire(rec.input!);
    }
  }

  // ---------- 온라인: 다시 맞추기 · 접속 끊김 ----------

  /** 기준 기기의 상태로 판 전체를 다시 불러온다 (재접속, 화면 어긋남) */
  loadSnapshot(snap: MatchSnapshot, records: TurnRecord[], elapsed: number) {
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.pb = null;
    this.shellG.clear();
    this.views.forEach((v) => v.destroy());
    this.match = Match.fromSnapshot(snap);
    this.records = new Map(records.map((r) => [r.turn, r]));
    this.vis = this.match.terrain.clone();
    this.scorch.fill(0);
    this.paint(0, 0, this.vis.w - 1, this.vis.h - 1);
    this.hud.drawMiniBase(this.match);
    this.views = this.match.tanks.map((t) => new TankView(this, t, this.fx));
    this.views.forEach((v) => v.t.alive || v.kill());
    if (import.meta.env.DEV) (window as unknown as { __match: Match }).__match = this.match;
    if (this.match.over) return this.finish();
    if (this.match.current < 0) return this.nextTurn();
    this.beginTurn(Math.min(TURN_SECONDS - 3, elapsed));
  }

  /** 접속이 끊긴 플레이어 표시 (null이면 해제) */
  setConn(idx: number, text: string | null) {
    this.views[idx]?.setStatus(text);
  }

  /** 끊긴 플레이어의 탱크를 AI가 넘겨받는다 */
  takeover(idx: number) {
    const t = this.match.tanks[idx];
    if (!t || t.ai) return;
    t.ai = 'normal';
    this.views[idx].setStatus('AI 조종 중');
    if (this.match.current === idx) this.hud.toast(`${t.name}의 탱크를 AI가 이어서 조종합니다`);
  }

  get matchState(): Match {
    return this.match;
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
      // 꼬리 + 날아가는 방향으로 기운 포탄
      const px = k > 0 ? s.path[k * 2 - 2] : x;
      const py = k > 0 ? s.path[k * 2 - 1] : y;
      const look = SHELL_LOOK[s.behavior] ?? SHELL_LOOK.normal;
      this.fx.trail(px, py, look.trail);
      let dx = x - px;
      let dy = y - py;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      if (s.behavior === 'laser') g.fillStyle(0xff7aa0, 0.35).fillCircle(x, y, 11);
      g.fillStyle(0x000000, 0.22).fillCircle(x + 1.5, y + 1.5, 6);
      g.fillStyle(look.body).fillCircle(x - dx * 4, y - dy * 4, 4.2).fillCircle(x, y, 5.5);
      if (s.behavior === 'drill') g.fillStyle(0xdfe3ea).fillTriangle(x + dx * 11, y + dy * 11, x - dy * 5, y + dx * 5, x + dy * 5, y - dx * 5);
      else g.fillStyle(look.nose).fillCircle(x + dx * 2.5, y + dy * 2.5, 2.6);
      g.fillStyle(0xffffff, 0.7).fillCircle(x - 1.8, y - 1.8, 1.6);
      if (!lead) lead = { x, y };
    }
    if (lead && !this.manualCam) this.follow(lead.x, this.focusY(lead.y, 0.5), 0.14);

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
        v.hurt();
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
    music.play(null);
    sfx.win();
    const m = this.match;
    const summary: MatchSummary = {
      winner: m.winner as 0 | 1 | -1,
      turns: m.turn,
      players: m.tanks.map((t) => ({ name: t.name, tank: t.tankId, team: t.team, damage: t.damageDealt, alive: t.alive, ai: !!t.ai, mine: this.cfg.net ? t.idx === this.cfg.net.myIdx : !t.ai })),
    };
    this.time.delayedCall(1400, () => this.cfg.onEnd(summary));
  }

  // ---------- 효과 ----------

  private boom(x: number, y: number, r: number, big: boolean) {
    sfx.boom(big);
    this.fx.boom(x, y, r, big);
    this.cameras.main.shake(big ? 380 : 200, big ? 0.012 : 0.005);
  }

  private puff(x: number, y: number, color: number, n: number) {
    this.fx.puff(x, y, color, n);
  }

  private floatText(x: number, y: number, s: string, color: string) {
    const t = this.add
      .text(x, y, s, { fontFamily: 'Jua, sans-serif', fontSize: '22px', color, stroke: '#2a1a10', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(40);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
}

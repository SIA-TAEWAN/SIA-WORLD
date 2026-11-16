import Phaser from 'phaser';
import { Match, type CrateDrop, type MatchSnapshot, type WindMode, type GameMode } from '../game/match';
import { Rng } from '../game/rng';
import { TURN_SECONDS, ITEMS } from '../game/data';
import type { PlayerSetup, ShotResult, SimEvent, TankState, TurnInput, Zone } from '../game/types';
import { MAPS, type MapId } from '../data/maps';
import { Terrain } from '../physics/terrain';
import type { LiveState, NetHooks, TurnRecord } from '../net/protocol';
import { decideMove, decideShot } from '../ai/ai';
import { buildTerrainArt, drawBackground, hex, TEAM_COLORS } from './art';
import { cloudDataUrl, tierOf, type Tier } from '../ui/rank';
import { ART_SCALE, TANK_ART, faceColor, tankArtUrl, tankTextureSvg, TEX_BOX, TEX_SCALE } from '../ui/tankSvg';
import { ALL_TANK_IDS } from '../game/data';
import { Fx } from './fx';
import { drawShell, SHELL_LOOKS, SPIN_LOOKS, TRAIL } from './shells';
import { music } from '../ui/music';
import { Hud } from '../ui/hud';
import { Input, type ControlEvent } from '../ui/input';
import { sfx } from '../ui/sfx';

export interface MatchSummary {
  winner: 0 | 1 | -1;
  players: { name: string; tank: string; team: 0 | 1; damage: number; alive: boolean; ai: boolean; mine: boolean }[];
  turns: number;
}

export interface GameChat {
  chat: { name: string; text: string; system?: boolean }[];
  sendChat(text: string): void;
  onChat(fn: () => void): () => void;
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
  /** 게임 속도 (포탄·연출 재생 배율) */
  speed?: number;
  /** 게임 중 채팅 (온라인: 같은 방 사람끼리) */
  chat?: GameChat;
  /** 바람이 바뀌는 빠르기 */
  wind?: WindMode;
  /** 게임 모드 (초보: 내 탄이 적 쪽으로 휜다) */
  mode?: GameMode;
  /** 필살기 게이지가 항상 가득 찬 탱크 번호 */
  fullUlt?: number[];
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
  private hasArt = false;
  /** 중독 중 (녹색) */
  poisoned = false;
  private bodyScale = 1;
  private dy = 0;
  label: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  arrow: Phaser.GameObjects.Text;
  x: number;
  y: number;
  hp: number;
  tweening = false;
  dead = false;
  private lastX: number;
  private tiltNow = 0;
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
    this.barrel.fillStyle(hex(t.def.accent)).fillRoundedRect(1, -2, 19, 4, 2);
    this.barrel.fillStyle(0xffffff, 0.45).fillRoundedRect(2, -1.6, 15, 1.2, 0.6);
    this.barrel.fillStyle(0x3a2a1e).fillRoundedRect(18, -4.2, 5.5, 8.4, 1.6);
    this.barrel.setPosition(0, -15);
    const art = TANK_ART[t.tankId];
    this.hasArt = !!art;
    this.bodyScale = art ? 1 / ART_SCALE : 1 / TEX_SCALE;
    this.body = scene.add.image(0, 1, `tank-${t.tankId}`).setScale(this.bodyScale);
    if (art) this.body.setOrigin(art.cx, 1);
    else this.body.setOrigin(0.5, (38 - TEX_BOX.y) / TEX_BOX.h);
    // 그림 높이에 맞춰 이름·체력바를 올린다
    const top = art ? art.h / ART_SCALE : 40;
    this.dy = Math.min(0, 42 - top);
    // 눈꺼풀 (깜빡일 때만 보임)
    this.lids = scene.add.graphics().setVisible(false);
    this.lids.fillStyle(hex(faceColor(t.tankId))).fillEllipse(3, -19, 6, 7).fillEllipse(8, -19, 6, 7);
    this.lids.lineStyle(1.5, 0x1e1e2a).lineBetween(0.5, -18.5, 5.5, -18.5).lineBetween(5.5, -18.5, 10.5, -18.5);
    // 그림 탱크는 머리가 커서 포신을 몸통 앞쪽에서 앞으로 그린다
    if (this.hasArt) this.barrel.setPosition(6, -11);
    this.rig = scene.add.container(0, 0, this.hasArt ? [this.body, this.barrel, this.lids] : [this.barrel, this.body, this.lids]);
    this.cont = scene.add.container(t.x, t.y, [this.rig]).setDepth(10);

    const name = scene.add
      .text(0, -52 + this.dy, t.name, { fontFamily: 'Jua, sans-serif', fontSize: '14px', color: '#fff', stroke: TEAM_COLORS[t.team], strokeThickness: 4 })
      .setOrigin(0.5, 1);
    this.hpBar = scene.add.graphics();
    this.arrow = scene.add.text(0, -72 + this.dy, '▼', { fontSize: '18px', color: '#ffe14d', stroke: '#7a4b00', strokeThickness: 3 }).setOrigin(0.5).setVisible(false);
    scene.tweens.add({ targets: this.arrow, y: -66 + this.dy, duration: 400, yoyo: true, repeat: -1 });
    this.hpBar.y = this.dy;
    // 랭킹 구름 (AI는 없음)
    const parts: Phaser.GameObjects.GameObject[] = [name, this.hpBar, this.arrow];
    if (!t.ai) {
      const cloud = scene.add.image(-name.width / 2 - 2, -60 + this.dy, `cloud-${tierOf(t.name)}`).setOrigin(1, 0.5).setDisplaySize(36, 25);
      name.x = 19;
      cloud.x = name.x - name.width / 2 - 2;
      parts.push(cloud);
    }
    this.label = scene.add.container(t.x, t.y, parts).setDepth(30);
    this.drawHp();

    // 살아 있는 느낌: 천천히 숨쉬기 + 가끔 눈 깜빡임
    this.breathe = scene.tweens.add({ targets: this.rig, scaleY: 0.955, scaleX: 1.02, duration: 650 + Math.random() * 250, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 600 });
    this.blinkTimer = scene.time.addEvent({
      delay: 2200 + Math.random() * 2000,
      loop: true,
      callback: () => {
        if (this.dead || this.hasArt) return;
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

  /** 쓰러질 때 기우는 각도 */
  lean = 0;

  sync(facing: number, angle: number, dt: number, tilt = 0) {
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
    // 경사를 따라 몸체가 기운다 (포신 각도는 몸체 기준)
    this.tiltNow += (tilt - this.tiltNow) * Math.min(1, dt * 12);
    this.cont.angle = -this.tiltNow + this.lean;
    this.barrel.rotation = (-angle * Math.PI) / 180;
  }

  /** 발사 반동 */
  recoil() {
    this.scene.tweens.add({ targets: this.barrel, x: -4, duration: 60, yoyo: true });
    this.scene.tweens.add({ targets: this.body, x: -3, scaleY: 0.9 * this.bodyScale, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
  }

  /** 맞았을 때 흔들림 */
  hurt() {
    this.body.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => (this.dead ? this.body.setTint(0x555555) : this.poisoned ? this.body.setTint(0x6dff7a) : this.body.clearTint()));
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
    this.lids.clear().setVisible(!this.hasArt);
    this.lids.fillStyle(0x555555).fillEllipse(3, -19, 6, 7).fillEllipse(8, -19, 6, 7);
    this.lids.lineStyle(1.6, 0x1e1e2a);
    for (const ex of [3, 8]) this.lids.lineBetween(ex - 2, -21, ex + 2, -17).lineBetween(ex - 2, -17, ex + 2, -21);
    this.scene.tweens.add({ targets: this, lean: this.t.facing * 18, duration: 400, ease: 'Back.easeOut' });
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
  /** 게임 속도 배율 */
  private speed = 1;
  /** 탱크별로 고른 무기 (다음 턴에도 유지) */
  private sel = new Map<number, 0 | 1 | 2>();
  private lastNormal = new Map<number, 0 | 1>();
  /** 탱크별 파워 리미터 (최대로 눌러도 여기까지) */
  private limit = new Map<number, number>();
  private offAngleAcc = 0;
  /** 날아가는 포탄 그림 (포탄 기록별) */
  private shellSprites = new Map<object, Phaser.GameObjects.Image>();
  /** 땅에 놓인 보급 상자 그림 (상자 id별) */
  private crateViews = new Map<number, Phaser.GameObjects.Container>();
  /** 땅에 남은 불·독안개 그림 */
  private zoneViews = new Map<number, Phaser.GameObjects.Container>();

  private addZoneView(z: Zone) {
    if (this.zoneViews.has(z.id)) return;
    const c = this.add.container(z.x, z.y).setDepth(12).setData('kind', z.kind);
    const fire = z.kind === 'fire';
    // 바닥 얼룩
    c.add(this.add.ellipse(0, 0, z.r * 2.4, z.r * 0.7, fire ? 0xff6a00 : 0x5bd16b, 0.35));
    // 불꽃 / 독 구름 덩어리
    for (let i = 0; i < 5; i++) {
      const dx = (i - 2) * z.r * 0.42;
      const blob = fire
        ? this.add.triangle(dx, -6, 0, 10, 5, -8 - (i % 2) * 5, 10, 10, i % 2 ? 0xffb020 : 0xff4d1a, 0.9)
        : this.add.circle(dx, -8 - (i % 2) * 5, 8 + (i % 3) * 2, i % 2 ? 0x8cf06a : 0x2f9e48, 0.75);
      c.add(blob);
      this.tweens.add({
        targets: blob,
        scaleY: fire ? { from: 0.7, to: 1.25 } : { from: 0.9, to: 1.15 },
        scaleX: fire ? 1 : { from: 0.9, to: 1.15 },
        alpha: fire ? { from: 0.65, to: 1 } : { from: 0.6, to: 0.85 },
        y: blob.y - (fire ? 3 : 4),
        duration: fire ? 180 + i * 37 : 900 + i * 120,
        yoyo: true,
        repeat: -1,
      });
    }
    // 위로 높은 독안개는 구름을 한 층 더 쌓는다
    const up = z.h ?? z.r;
    for (let k = 1; up > z.r && k <= Math.round((up - z.r) / 16); k++)
      for (let i = 0; i < 4; i++) {
        const blob = this.add.circle((i - 1.5) * z.r * 0.5, -8 - k * 16, 9 + (i % 2) * 3, i % 2 ? 0x8cf06a : 0x2f9e48, 0.55);
        c.add(blob);
        this.tweens.add({ targets: blob, alpha: { from: 0.35, to: 0.65 }, y: blob.y - 4, duration: 1000 + i * 150 + k * 90, yoyo: true, repeat: -1 });
      }
    this.zoneViews.set(z.id, c);
  }

  private syncZones() {
    const live = new Set(this.match.zones.map((z) => z.id));
    for (const [id, v] of this.zoneViews)
      if (!live.has(id)) {
        this.zoneViews.delete(id);
        this.tweens.add({ targets: v, alpha: 0, duration: 400, onComplete: () => v.destroy() });
      }
    for (const z of this.match.zones) this.addZoneView(z);
  }

  /** 특수 벽 그림 (엔진의 벽과 맞춘다) */
  private wallView: Phaser.GameObjects.Container | null = null;
  private wallKey = '';

  private syncWall() {
    const w = this.match.wall;
    const key = w ? `${w.kind}:${w.x}:${w.until}` : '';
    if (key === this.wallKey) return;
    this.wallKey = key;
    if (this.wallView) {
      const old = this.wallView;
      this.tweens.add({ targets: old, alpha: 0, duration: 500, onComplete: () => old.destroy() });
      this.wallView = null;
    }
    if (!w) return;
    const info = {
      amp: { color: 0xff4d6d, icon: '⚡', label: '증폭벽' },
      whirl: { color: 0x3fc8ff, icon: '🌀', label: '회오리' },
      double: { color: 0xffc83d, icon: '×2', label: '더블벽' },
      triple: { color: 0xb46bff, icon: '×3', label: '트리플벽' },
    }[w.kind];
    // 지형 뒤, 배경 앞 (땅에 묻힌 부분은 가려진다)
    const c = this.add.container(w.x, w.top ?? 0).setDepth(-1).setAlpha(0);
    const h = Math.max(40, w.bottom - (w.top ?? 0) + 6);
    // 빛나는 기둥 (천장부터 바닥까지)
    c.add(this.add.rectangle(0, 0, 48, h, info.color, 0.22).setOrigin(0.5, 0));
    c.add(this.add.rectangle(0, 0, 20, h, info.color, 0.55).setOrigin(0.5, 0));
    c.add(this.add.rectangle(0, 0, 4, h, 0xffffff, 0.9).setOrigin(0.5, 0));
    // 위아래로 흐르는 빛 알갱이
    for (let i = 0; i < 6; i++) {
      const dot = this.add.circle((i % 2 ? 6 : -6), (h * i) / 6, 3, 0xffffff, 0.9);
      c.add(dot);
      this.tweens.add({ targets: dot, y: { from: h, to: 0 }, duration: w.kind === 'whirl' ? 1400 : 2400, repeat: -1, delay: i * 300 });
      if (w.kind === 'whirl') this.tweens.add({ targets: dot, x: { from: -14, to: 14 }, duration: 350, yoyo: true, repeat: -1, delay: i * 90 });
    }
    // 이름표 (기둥 여러 곳에)
    for (let y = Math.min(60, h / 2); y < h - 10; y += 220) {
      const tag = this.add
        .text(0, y, `${info.icon}\n${info.label}`, { fontFamily: 'Jua, sans-serif', fontSize: '20px', color: '#fff', align: 'center', stroke: `#${info.color.toString(16).padStart(6, '0')}`, strokeThickness: 4 })
        .setOrigin(0.5);
      c.add(tag);
    }
    this.tweens.add({ targets: c, alpha: 1, duration: 500 });
    this.wallView = c;
    if (this.match.turn > 0) this.hud.toast(`${info.icon} ${info.label}이(가) 나타났어요! (3턴)`);
  }

  /** 어흥이 할퀴기: 세 줄 발톱 자국 */
  private clawFx(x: number, y: number) {
    const g = this.add.graphics().setDepth(26).setPosition(x, y).setRotation(-0.5);
    for (let i = -1; i <= 1; i++) {
      g.lineStyle(7, 0x2a0d00, 0.5).lineBetween(i * 13 - 4, -30, i * 13 + 4, 30);
      g.lineStyle(4, 0xffffff, 1).lineBetween(i * 13 - 4, -30, i * 13 + 4, 30);
      g.lineStyle(2, 0xff5a3c, 1).lineBetween(i * 13 - 3, -24, i * 13 + 3, 24);
    }
    g.setScale(0.2, 0.2);
    this.tweens.add({ targets: g, scaleX: 1.2, scaleY: 1.2, duration: 120, ease: 'Back.easeOut' });
    this.tweens.add({ targets: g, alpha: 0, delay: 450, duration: 400, onComplete: () => g.destroy() });
  }
  /** 떨어지는 중인 상자 id */
  private falling = new Set<number>();
  /** 이번 턴에 바로 쓴 아이템 칸 */
  private usedNow: number[] = [];
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

  preload() {
    for (const tr of ['gold', 'silver', 'bronze', 'white'] as Tier[]) if (!this.textures.exists(`cloud-${tr}`)) this.load.svg(`cloud-${tr}`, cloudDataUrl(tr), { width: 64, height: 44 });
    for (const l of SHELL_LOOKS) if (!this.textures.exists(`shell-${l}`)) this.load.image(`shell-${l}`, `${import.meta.env.BASE_URL}shells/${l}.png`);
    // 탱크 그림은 메뉴와 같은 SVG를 2배 크기로 굽는다
    for (const id of ALL_TANK_IDS) {
      const key = `tank-${id}`;
      if (this.textures.exists(key)) continue;
      if (TANK_ART[id]) this.load.image(key, tankArtUrl(id));
      else this.load.svg(key, `data:image/svg+xml;base64,${btoa(tankTextureSvg(id))}`, { width: TEX_BOX.w * TEX_SCALE, height: TEX_BOX.h * TEX_SCALE });
    }
  }

  create() {
    const cfg = this.cfg;
    this.match = cfg.resume ? Match.fromSnapshot(cfg.resume.snap) : new Match(cfg.setups, cfg.mapId, cfg.seed, { wind: cfg.wind ?? 'normal', fullUlt: cfg.fullUlt, mode: cfg.mode ?? 'normal' });
    this.speed = cfg.speed ?? 1;
    this.time.timeScale = this.speed;
    this.tweens.timeScale = this.speed;
    if (cfg.resume) this.records = new Map(cfg.resume.records.map((r) => [r.turn, r]));
    this.aiRng = new Rng(cfg.seed ^ 0x5bd1e995);
    const map = MAPS[cfg.mapId];
    const { terrain } = this.match;

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
    // 맵 바깥(아래·양옆)이 보이지 않게 덮는다: 땅이 바닥까지 이어진 맵은 흙, 낭떠러지 맵은 구름
    {
      const last = (terrain.h - 1) * terrain.w;
      let solid = 0;
      for (let x = 0; x < terrain.w; x++) solid += terrain.data[last + x];
      if (solid > terrain.w * 0.5) {
        const dirt = hex(map.theme.dirtBottom);
        this.add.rectangle(-3000, terrain.h - 1, terrain.w + 6000, 3000, dirt).setOrigin(0).setDepth(1);
        const sl = Math.max(0, terrain.surface(0));
        const sr = Math.max(0, terrain.surface(terrain.w - 1));
        this.add.rectangle(-3000, sl, 3000, terrain.h - sl + 1, dirt).setOrigin(0).setDepth(1);
        this.add.rectangle(terrain.w, sr, 3000, terrain.h - sr + 1, dirt).setOrigin(0).setDepth(1);
      } else {
        // 지형 뒤에 깐다 (낮게 뜬 섬이 가려지지 않게)
        const sea = this.add.graphics().setDepth(-1);
        sea.fillStyle(0xffffff, 0.95).fillRect(-3000, terrain.h - 30, terrain.w + 6000, 3000);
        for (let x = -3000; x < terrain.w + 3000; x += 80) sea.fillCircle(x, terrain.h - 30 + Math.sin(x * 0.05) * 8, 40);
      }
    }

    this.views = this.match.tanks.map((t) => new TankView(this, t, this.fx));
    this.shellG = this.add.graphics().setDepth(20);

    // UI
    this.input2 = new Input();
    this.hud = new Hud(cfg.hudParent, this.input2, cfg.touch, cfg.chat);
    this.hud.drawMiniBase(this.match);
    this.hud.onMiniClick = (fx, fy) => {
      const t = this.match.terrain;
      this.manualCam = true;
      this.cameras.main.pan(fx * t.w, fy * t.h, 300, 'Sine.easeInOut');
    };
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
    // 두 손가락으로 오므리면 축소(맵 전체까지), 벌리면 확대
    this.input.addPointer(1);
    let pinch: { d: number; z: number } | null = null;
    const p1 = () => this.input.pointer1;
    const p2 = () => this.input.pointer2;
    const twoDown = () => p1().isDown && p2().isDown;
    const gap = () => Math.hypot(p1().x - p2().x, p1().y - p2().y) || 1;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (twoDown()) {
        pinch = { d: gap(), z: this.cameras.main.zoom };
        drag = null;
        return;
      }
      drag = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomTo(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1)));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (pinch) {
        if (twoDown()) this.zoomTo(pinch.z * (gap() / pinch.d));
        return;
      }
      if (!drag || !p.isDown) return;
      const cam = this.cameras.main;
      if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 6) this.manualCam = true;
      cam.scrollX = drag.sx - (p.x - drag.x) / cam.zoom;
      cam.scrollY = drag.sy - (p.y - drag.y) / cam.zoom;
    });
    this.input.on('pointerup', () => {
      drag = null;
      if (!twoDown()) pinch = null;
    });

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

  /** 사용자가 정한 확대 배율 (핀치·휠). null이면 자동 */
  private userZoom: number | null = null;

  /** 맵 전체가 한 화면에 들어오는 배율 */
  private fitZoom() {
    const hudH = this.hud?.bottomHeight ?? 0;
    const t = this.match.terrain;
    // 가로는 맵 전체가 들어오게 하되, 세로로 맵 아래 바깥이 보일 만큼은 줄이지 않는다
    // 맵 밖(양옆·아래)이 보이기 전까지만 축소된다
    return Math.max(this.scale.width / t.w, (this.scale.height - hudH) / t.h);
  }

  private zoomTo(z: number) {
    const cam = this.cameras.main;
    const min = this.fitZoom();
    const nz = Phaser.Math.Clamp(z, min, 1.6);
    const mid = cam.midPoint.clone();
    cam.setZoom(nz);
    this.userZoom = nz;
    this.manualCam = true;
    this.applyBounds();
    // 가장 작게 줄이면 맵 전체가 보이도록 가운데로
    if (nz <= min + 0.001) {
      const t = this.match.terrain;
      cam.centerOn(t.w / 2, this.focusY(t.h / 2, 0.5) - 10);
    } else cam.centerOn(mid.x, mid.y);
  }

  private applyBounds() {
    const cam = this.cameras.main;
    const hudH = this.hud?.bottomHeight || 118;
    const t = this.match.terrain;
    // 천장(맵 맨 위)보다 위, 맵 양옆·아래 바깥은 보이지 않는다
    cam.setBounds(0, 0, t.w, t.h + hudH / cam.zoom);
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
    cam.setZoom(this.userZoom !== null ? Phaser.Math.Clamp(this.userZoom, this.fitZoom(), 1.6) : zoom);
    this.applyBounds();
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
    if (this.match.lastDrop) this.playDrop(this.match.lastDrop);
    this.cfg.net?.turnStarted(this.match);
    this.beginTurn(0);
  }

  private beginTurn(elapsed: number) {
    const t = this.match.cur;
    const ctrl = this.controlOf(t);
    this.timeLeft = TURN_SECONDS - elapsed;
    this.power = 0;
    this.charging = false;
    // 지난번에 고른 무기를 그대로 (필살기는 게이지가 차 있을 때만)
    const s = this.sel.get(t.idx) ?? 0;
    this.weapon = this.match.weaponLock ?? (s === 2 && !this.match.canUseUlt(t) ? (this.lastNormal.get(t.idx) ?? 0) : s);
    this.itemSlot = null;
    this.manualCam = false;
    this.runs = [];
    this.usedNow = [];
    this.remote = { applied: 0, stage: 'wait', liveRuns: [], moveAcc: 0 };
    this.lastLive = '';
    // 내 차례면 탱크 위 화살표를 2배로
    this.views.forEach((v) => v.arrow.setVisible(v.t.idx === t.idx).setScale(v.t.idx === t.idx && ctrl === 'human' ? 2 : 1));
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

  // ---------- 보급 상자 ----------

  private makeCrate(x: number, y: number, chute: boolean) {
    const g = this.add.graphics();
    if (chute) {
      g.lineStyle(1.2, 0x5a4a3a, 0.9).lineBetween(-8, -14, -11, -34).lineBetween(8, -14, 11, -34).lineBetween(0, -14, 0, -36);
      g.fillStyle(0xff5a6a).slice(0, -34, 16, Math.PI, 0, false).fillPath();
      g.fillStyle(0xffffff).slice(0, -34, 16, Math.PI * 1.33, Math.PI * 1.66, false).fillPath();
      g.lineStyle(1.5, 0x3a2a1e).beginPath().arc(0, -34, 16, Math.PI, 0).strokePath();
    }
    g.fillStyle(0xc98a4a).fillRoundedRect(-9, -15, 18, 15, 2).lineStyle(1.6, 0x3a2a1e).strokeRoundedRect(-9, -15, 18, 15, 2);
    g.lineStyle(1.2, 0x8a5a2a).lineBetween(-9, -7.5, 9, -7.5).lineBetween(0, -15, 0, 0);
    const q = this.add.text(0, -7.5, '?', { fontFamily: 'Jua, sans-serif', fontSize: '11px', color: '#fff', stroke: '#3a2a1e', strokeThickness: 3 }).setOrigin(0.5);
    return this.add.container(x, y, [g, q]).setDepth(9);
  }

  /** 비행기가 지나가며 상자를 낙하산으로 떨어뜨린다 */
  private playDrop(drops: CrateDrop[]) {
    sfx.turn();
    this.hud.toast('✈️ 보급 비행기가 상자를 떨어뜨려요! 닿으면 아이템 획득');
    const W = this.match.terrain.w;
    const plane = this.add.graphics().setDepth(40);
    plane.fillStyle(0xffffff).fillEllipse(0, 0, 70, 18).lineStyle(2, 0x3a2a1e).strokeEllipse(0, 0, 70, 18);
    plane.fillStyle(0xff5a6a).fillTriangle(-30, -2, -42, -20, -22, -4).fillRoundedRect(-10, -3, 22, 26, 4);
    plane.fillStyle(0x6fd8ff).fillCircle(22, -2, 4).fillCircle(10, -3, 3.5);
    plane.setPosition(-200, -60);
    this.tweens.add({ targets: plane, x: W + 200, duration: 4200, onComplete: () => plane.destroy() });
    for (const d of drops) {
      this.falling.add(d.id);
      const box = this.makeCrate(d.path[0], d.path[1], true);
      const n = d.path.length / 2;
      const delay = ((d.path[0] + 200) / (W + 400)) * 4200;
      this.tweens.addCounter({
        from: 0,
        to: n - 1,
        delay,
        duration: (n * 2 * 1000) / 60,
        onUpdate: (tw) => {
          const i = Math.floor(tw.getValue() ?? 0);
          box.setPosition(d.path[i * 2], d.path[i * 2 + 1]);
          box.angle = Math.sin(i / 8) * 8;
        },
        onComplete: () => {
          box.destroy();
          this.falling.delete(d.id);
          if (!d.landed) this.puff(d.path[d.path.length - 2], Math.min(d.path[d.path.length - 1], this.match.terrain.h), 0xffffff, 4);
        },
      });
    }
  }

  /** 땅에 있는 상자를 그리고, 주운 상자는 지운다 */
  private syncCrates() {
    const m = this.match;
    const live = new Set(m.crates.map((c) => c.id));
    for (const c of m.crates) {
      if (this.falling.has(c.id)) continue;
      let v = this.crateViews.get(c.id);
      if (!v) {
        v = this.makeCrate(c.x, c.y, false);
        this.crateViews.set(c.id, v);
      }
      if (this.phase !== 'fly') v.y += (c.y - v.y) * 0.2;
    }
    for (const [id, v] of this.crateViews) {
      if (live.has(id)) continue;
      this.puff(v.x, v.y - 8, 0xffe066, 6);
      v.destroy();
      this.crateViews.delete(id);
    }
    while (m.pickups.length) {
      const p = m.pickups.shift()!;
      const t = m.tanks[p.tank];
      const view = this.views[p.tank];
      this.floatText(view.x, view.y - 70, `📦 ${ITEMS[p.item].name}`, '#ffe066');
      sfx.heal();
      if (t === this.viewer()) this.hud.toast(`보급 상자에서 ${ITEMS[p.item].name}을(를) 얻었어요!`);
    }
  }

  /** 즉시 아이템 사용 (내 기기에서 누르거나, 다른 기기의 턴 기록을 재생) */
  private useNow(slot: number) {
    const t = this.match.cur;
    const amount = this.match.useItemNow(slot);
    if (amount === null) return;
    this.usedNow.push(slot);
    if (this.itemSlot === slot) this.itemSlot = null;
    const v = this.views[t.idx];
    v.hp = t.hp;
    v.drawHp();
    this.floatText(v.x, v.y - 60, `+${amount}`, '#5cff8a');
    this.fx.puff(v.x, v.y - 14, 0x7dffa8, 8);
    sfx.heal();
  }

  /** 내 차례가 아닐 때도 내 탱크 각도를 미리 맞출 수 있다 */
  private updateOffTurn(dt: number) {
    const v = this.viewer();
    if (!v || !v.alive || (this.phase === 'aim' && v === this.match.cur)) return;
    const c = this.input2.state;
    const ad = c.up && !c.down ? 1 : c.down && !c.up ? -1 : 0;
    if (!ad) {
      this.offAngleAcc = 0.99;
      return;
    }
    this.offAngleAcc += 28 * dt;
    while (this.offAngleAcc >= 1) {
      this.offAngleAcc--;
      v.angle = Math.max(v.def.angleMin, Math.min(v.def.angleMax, Math.round(v.angle) + ad));
    }
  }

  /** 이 기기에서 HUD로 보여줄 내 탱크 (내 차례가 아니어도 내 것) */
  private viewer(): TankState | null {
    const m = this.match;
    if (m.current >= 0 && this.controlOf(m.cur) === 'human') return m.cur;
    if (this.cfg.net) return m.tanks[this.cfg.net.myIdx] ?? null;
    return m.tanks.find((t) => !t.ai) ?? null;
  }

  private limitOf(t: TankState) {
    return this.limit.get(t.idx) ?? 100;
  }

  private onControl(e: ControlEvent) {
    const v = this.viewer();
    if (!v || !v.alive) return;
    const myTurn = this.phase === 'aim' && v === this.match.cur;
    if (e.type === 'limit') {
      // 파워 리미터는 언제든 조절
      const val = e.delta !== undefined ? this.limitOf(v) + e.delta : (e.value ?? 100);
      this.limit.set(v.idx, Math.max(10, Math.min(100, Math.round(val))));
      return;
    }
    if (myTurn && this.charging) return;
    if (e.type === 'weapon') {
      const lock = this.match.weaponLock;
      if (lock !== undefined && e.slot !== lock) {
        this.hud.toast(`이 맵에서는 ${lock + 1}번 무기만 쓸 수 있어요`);
        return;
      }
      if (e.slot === 2 && !this.match.canUseUlt(v)) {
        this.hud.toast('필살기 게이지가 아직 안 찼어요');
        return;
      }
      this.sel.set(v.idx, e.slot);
      if (e.slot !== 2) this.lastNormal.set(v.idx, e.slot);
      if (myTurn) this.weapon = e.slot;
      sfx.click();
    } else {
      if (!myTurn) {
        this.hud.toast('아이템은 내 차례에 쓸 수 있어요');
        return;
      }
      const t = v;
      // 수리킷은 누르는 즉시 회복
      if (t.items[e.slot] === 'repair') {
        if (t.hp >= t.maxHp) return this.hud.toast('체력이 이미 가득 찼어요');
        this.useNow(e.slot);
        return;
      }
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
    const rec: TurnRecord = { turn: this.match.turn, runs: [...this.runs], input, facing: this.match.cur.facing, used: [...this.usedNow] };
    this.records.set(rec.turn, rec);
    net.sendTurn(rec);
  }

  private turnDone() {
    this.cfg.net?.turnDone(this.match.turn, this.match.stateHash());
  }

  /** 화면 지형(vis) 기준 경사 */
  private visTilt(x: number, y: number) {
    const ground = (gx: number) => {
      for (let gy = y - 22; gy <= y + 22; gy++) if (this.vis.solid(gx, gy)) return gy;
      return y + 6;
    };
    const deg = Math.round((Math.atan2(ground(x - 10) - ground(x + 10), 20) * 180) / Math.PI);
    return Math.max(-40, Math.min(40, deg));
  }

  /** 포탄이 날아가는 동안 HUD에 보여줄 발사 전 필살기 게이지 */
  private ultShown: Map<number, number> | null = null;

  private fire(input: TurnInput) {
    this.ultShown = new Map(this.match.tanks.map((x) => [x.idx, x.ult]));
    const t = this.match.cur;
    this.phase = 'fly';
    this.charging = false;
    this.views[t.idx].arrow.setVisible(false);
    const v = this.views[t.idx];
    v.recoil();
    sfx.fire();
    const res = this.match.fire(input);
    if (input.weapon === 2 && this.sel.get(t.idx) === 2) this.sel.set(t.idx, this.lastNormal.get(t.idx) ?? 0);
    this.turnDone();
    this.pb = { res, frame: 0, ev: 0 };
    this.manualCam = false;
    // 포구 연기
    const p0 = res.shells[0]?.path;
    const wa = (this.match.worldAngle(t) * Math.PI) / 180;
    if (p0) this.fx.muzzle(p0[0], p0[1], Math.atan2(-Math.sin(wa), t.facing * Math.cos(wa)));
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
    else if (this.phase === 'fly') this.updatePlayback(dt * this.speed);
    this.updateOffTurn(dt);
    this.syncCrates();
    if (this.phase !== 'fly') this.syncZones();
    this.syncWall();

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
          used: this.usedNow,
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
      // 화면에 보이는 지형 기준 (포탄이 날아가는 동안 미리 파인 땅에 기울지 않게)
      v.sync(v.t.facing, v.t.angle, dt, v.dead ? 0 : this.visTilt(Math.round(v.x), Math.round(v.y)));
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
    this.hud.drawMini(m, { x: view.x, y: view.y, w: view.width, h: view.height }, shells, this.views.map((tv) => ({ x: tv.x, y: tv.y, alive: !tv.dead })));
    // HUD는 항상 내 탱크 기준 (상대 차례에도 내 게이지·무기를 보여준다)
    const v = this.viewer() ?? t;
    const mine = v === t;
    const s = this.sel.get(v.idx) ?? 0;
    this.hud.update(m, v, {
      power: mine ? this.power : 0,
      charging: mine && this.charging,
      weapon: m.weaponLock ?? (mine ? this.weapon : s === 2 && !m.canUseUlt(v) ? (this.lastNormal.get(v.idx) ?? 0) : s),
      only: m.weaponLock,
      itemSlot: mine ? this.itemSlot : null,
      timeLeft: this.timeLeft,
      human: this.phase === 'aim' && mine,
      limit: this.limitOf(v),
      spectate: !v.alive || (!mine && !!v.ai),
      ult: this.ultShown?.get(v.idx),
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
      this.power = Math.min(this.limitOf(t), this.power + 52 * dt);
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
      ai.wait -= dt * this.speed;
      if (ai.wait <= 0) {
        ai.move = decideMove(m, t.ai!, this.aiRng);
        ai.stage = 'move';
      }
    } else if (ai.stage === 'move') {
      if (ai.move !== 0) {
        const dir = ai.move > 0 ? 1 : -1;
        this.moveAcc += 48 * dt * this.speed;
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
      const step = 40 * dt * this.speed;
      if (Math.abs(t.angle - target) <= step) {
        t.angle = target;
        ai.stage = 'charge';
        this.charging = true;
        this.power = 0;
      } else t.angle += Math.sign(target - t.angle) * step;
    } else if (ai.stage === 'charge') {
      this.power = Math.min(ai.shot!.power, this.power + 52 * dt * this.speed);
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
    // 상대가 방금 쓴 수리킷은 바로 보여준다
    for (const slot of (l.used ?? []).slice(this.usedNow.length)) this.useNow(slot);
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
    // 상대가 이번 턴에 바로 쓴 아이템(수리킷)을 먼저 적용
    for (const slot of (this.remote.rec?.used ?? []).slice(this.usedNow.length)) this.useNow(slot);
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
      r.moveAcc += 120 * dt * this.speed;
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
      const s = 90 * dt * this.speed;
      if (Math.abs(t.angle - target) <= s) {
        t.angle = target;
        r.stage = 'charge';
        this.charging = true;
        if (this.power > rec.input!.power) this.power = 0;
      } else t.angle += Math.sign(target - t.angle) * s;
    } else if (r.stage === 'charge') {
      this.power = Math.min(rec.input!.power, this.power + 140 * dt * this.speed);
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
    this.shellSprites.forEach((im) => im.destroy());
    this.shellSprites.clear();
    this.views.forEach((v) => v.destroy());
    this.match = Match.fromSnapshot(snap);
    this.records = new Map(records.map((r) => [r.turn, r]));
    this.vis = this.match.terrain.clone();
    this.scorch.fill(0);
    this.paint(0, 0, this.vis.w - 1, this.vis.h - 1);
    this.hud.drawMiniBase(this.match);
    this.views = this.match.tanks.map((t) => new TankView(this, t, this.fx));
    this.views.forEach((v) => v.t.alive || v.kill());
    this.views.forEach((v) => (v.poisoned = (v.t.poison ?? 0) > 0) && v.body.setTint(0x6dff7a));
    this.crateViews.forEach((v) => v.destroy());
    this.crateViews.clear();
    this.falling.clear();
    this.match.pickups = [];
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
      const spr = this.shellSprites.get(s);
      if (k < 0 || k * 2 >= s.path.length) {
        spr?.setVisible(false);
        continue;
      }
      const x = s.path[k * 2];
      const y = s.path[k * 2 + 1];
      // 꼬리 + 날아가는 방향으로 기운 포탄
      const px = k > 0 ? s.path[k * 2 - 2] : x;
      const py = k > 0 ? s.path[k * 2 - 1] : y;
      const look = s.look ?? 'shell';
      this.fx.trail(px, py, TRAIL[look] ?? 0xffffff);
      let dx = x - px;
      let dy = y - py;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      if (s.behavior === 'laser') g.fillStyle(0xff7aa0, 0.35).fillCircle(x, y, 12);
      // 증폭된 탄 (파워업·증폭벽): 붉게 타오르는 기운과 불꽃 꼬리
      if (s.boostFrom !== undefined && k >= s.boostFrom) {
        const pulse = 0.5 + 0.5 * Math.sin(pb.frame * 0.5);
        g.fillStyle(0xff3b3b, 0.22 + pulse * 0.15).fillCircle(x, y, (s.big ? 20 : 15) + pulse * 3);
        g.fillStyle(0xffd23a, 0.35).fillCircle(x, y, s.big ? 11 : 8);
        this.fx.trail(px, py, 0xff5a2a);
      }
      const key = `shell-${look}`;
      if (this.textures.exists(key)) {
        // SpriteCook 포탄 그림: 진행 방향으로 기울이거나, 둥근 것은 빙글빙글
        let im = spr;
        if (!im) {
          im = this.add.image(x, y, key).setDepth(20);
          im.setScale((s.big ? 29 : 20) / Math.max(im.width, im.height));
          this.shellSprites.set(s, im);
        }
        im.setVisible(true).setPosition(x, y);
        im.rotation = SPIN_LOOKS.has(look) ? (pb.frame / 60) * 10 : Math.atan2(dy, dx);
        g.fillStyle(0x000000, 0.18).fillCircle(x + 1.5, y + 2, s.big ? 8 : 5.5);
      } else drawShell(g, look, x, y, dx, dy, pb.frame / 60, s.big);
      if (!lead) lead = { x, y };
    }
    if (lead && !this.manualCam) this.follow(lead.x, this.focusY(lead.y, 0.5), 0.14);

    if (pb.frame >= pb.res.frames + 2) {
      g.clear();
      this.shellSprites.forEach((im) => im.destroy());
      this.shellSprites.clear();
      // 남은 불·독 지속 피해는 다음 차례와 함께 이어서 보여 준다
      this.endShot(evs.slice(pb.ev), pb.frame);
    }
  }

  private applyEvent(e: SimEvent) {
    switch (e.type) {
      case 'explode': {
        this.vis.carve(e.x, e.y, e.crater);
        this.scorchRing(e.x, e.y, e.crater);
        this.paint(e.x - e.crater - 7, e.y - e.crater - 7, e.x + e.crater + 7, e.y + e.crater + 7);
        this.boom(e.x, e.y, Math.max(e.radius, e.crater), e.big);
        if (e.fx === 'claw') this.clawFx(e.x, e.y - 8);
        // 폭발이 덮친 불은 꺼진다 (엔진과 같은 규칙)
        for (const [id, v] of this.zoneViews) {
          const near = Math.hypot(v.x - e.x, v.y - e.y) <= e.crater + 18;
          if (near && v.getData('kind') === 'fire' && id !== e.zone?.id) {
            this.zoneViews.delete(id);
            this.tweens.add({ targets: v, alpha: 0, duration: 300, onComplete: () => v.destroy() });
          }
        }
        if (e.zone) this.addZoneView(e.zone);
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
        // 빛줄기 자리를 기준점으로 그려서, 퍼지며 사라질 때 옆으로 밀리지 않게 한다
        const beam = this.add.graphics().setDepth(25).setPosition(e.x1, 0);
        beam.fillStyle(0xff3b6b, 0.35).fillRect(-e.r * 2.2, e.y1, e.r * 4.4, e.y2 - e.y1);
        beam.fillStyle(0xffffff, 0.95).fillRect(-e.r * 0.6, e.y1, e.r * 1.2, e.y2 - e.y1);
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
      case 'poisoned': {
        const v = this.views[e.target];
        v.poisoned = true;
        v.body.setTint(0x6dff7a);
        this.floatText(v.x, v.y - 78, '☠️ 중독!', '#7dff7a');
        break;
      }
      case 'dot': {
        const v = this.views[e.target];
        v.hp = Math.max(1, v.hp - e.amount);
        v.drawHp();
        const fire = e.kind === 'fire';
        if (fire) {
          v.body.setTintFill(0xff7a2a);
          this.time.delayedCall(120, () => (v.dead ? v.body.setTint(0x555555) : v.poisoned ? v.body.setTint(0x6dff7a) : v.body.clearTint()));
          this.fx.puff(v.x, v.y - 14, 0xff8a3c, 4);
        } else {
          // 중독: 녹색으로 변한다
          v.poisoned = !e.last || !!e.stay;
          if (v.poisoned) v.body.setTint(0x6dff7a);
          else v.body.clearTint();
          this.fx.puff(v.x, v.y - 18, 0x6ad66a, 4);
        }
        if (e.amount > 0) this.floatText(v.x, v.y - 60, `${fire ? '🔥' : '☠️'} -${e.amount}`, fire ? '#ff9a3c' : '#7dff7a');
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

  private endShot(later: SimEvent[] = [], frame = 0) {
    this.pb = null;
    this.ultShown = null;
    this.phase = 'settle';
    // 기기 화면을 시뮬레이션 결과와 정확히 맞춘다
    this.vis = this.match.terrain.clone();
    this.paint(0, 0, this.vis.w - 1, this.vis.h - 1);
    this.hud.drawMiniBase(this.match);
    for (const v of this.views) {
      // 아직 보여 주지 않은 지속 피해만큼은 체력바에 남겨 둔다
      v.hp = v.t.hp + later.reduce((s, e) => s + (e.type === 'dot' && e.target === v.t.idx ? e.amount : 0), 0);
      v.drawHp();
      if (!v.t.alive) v.kill();
    }
    for (const e of later) this.time.delayedCall(Math.max(0, ((e.f - frame) / 60) * 1000), () => this.applyEvent(e));
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

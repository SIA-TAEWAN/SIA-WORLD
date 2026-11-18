import Phaser from 'phaser';
import {
  BALL_R, CEIL, COURT_H, COURT_W, FLOOR_Y, LEFT, NET_R, NET_TOP, NET_W, NET_X, PLAYER_R, RIGHT, WALL, ZODIAC_IDS,
} from '../game/constants';
import type { Side } from '../game/sim';
import type { Match, MatchEvent } from '../match/game';
import { zodiacFaceUrl } from '../assets';
import { COLOR, FONT, css } from '../theme';
import { BALL_TEX, ensureArt, preloadArt, zKey } from './art';
import { BG_COUNT, BG_ZODIAC, drawBackdrop, flagKey } from './backdrop';

export interface SceneData {
  match: Match;
  /** 배경 번호 0~2 (scenes/backdrop.ts) */
  bg: number;
  /** 경기장 한 칸(720 기준 1px)이 캔버스 몇 픽셀인가 (화면 배율 × 기기 픽셀 배율) */
  zoom: number;
  sfx: (name: string, opts?: { volume?: number; rate?: number }) => void;
  /** 매 프레임, 이번 프레임에 생긴 일과 함께 (점수판·큰 글자 갱신용) */
  onFrame: (events: MatchEvent[]) => void;
}

/** 자리 색: 왼쪽 파랑, 오른쪽 빨강 (DESIGN.md 팀 색) */
export const SIDE_COLOR = [COLOR.teamA, COLOR.teamB] as const;

/** 한 프레임에 소리·이펙트로 재생하는 알림 수 한도 */
const FX_PER_FRAME = 12;

/** 캐릭터 그림 높이 (충돌 원 지름 72보다 조금 크게) */
const CHAR_H = 86;
const CHAR_MAX_W = 84;

interface Actor {
  side: Side;
  spr: Phaser.GameObjects.Image;
  base: number;
  ring: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  labelText: Phaser.GameObjects.Text;
  labelBg: Phaser.GameObjects.Graphics;
  /** 걸음 위상 */
  stride: number;
  /** 착지·타격 뒤 흐른 시간 (초) */
  landT: number;
  hitT: number;
}

/**
 * 경기장 화면. 좌표는 계산(sim)과 같은 720×840이고, 카메라 배율로 실제 화면 크기에 맞춘다.
 * 그림은 임시(코드로 그린 도형 + 십이지 전신 그림을 코드로 움직임).
 */
export class CourtScene extends Phaser.Scene {
  private match!: Match;
  private sfx!: SceneData['sfx'];
  private onFrame!: SceneData['onFrame'];
  private zoom = 1;
  private bg = 0;
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private actors: Actor[] = [];
  private spin = 0;
  private trailT = 0;
  /** 공이 맞은 뒤 흐른 시간 (초): 잠깐 눌렸다 펴진다 */
  private ballSquash = 9;

  constructor() {
    super('court');
  }

  init(d: SceneData) {
    this.match = d.match;
    this.zoom = d.zoom;
    this.bg = d.bg;
    this.sfx = d.sfx;
    this.onFrame = d.onFrame;
    this.actors = [];
  }

  preload() {
    preloadArt(this, this.match.setup.fighters.map((f) => f.char).filter((c) => ZODIAC_IDS.includes(c)));
    // 배경의 응원 깃발: 이 배경의 십이지 네 마리 얼굴
    for (const id of BG_ZODIAC[((this.bg % BG_COUNT) + BG_COUNT) % BG_COUNT]) if (!this.textures.exists(flagKey(id))) this.load.image(flagKey(id), zodiacFaceUrl(id));
    // 그림을 못 불러와도 게임은 진행한다 (create에서 코드 그림으로 채운다)
    this.load.on('loaderror', () => undefined);
  }

  /** 화면 크기가 바뀌었을 때 (경기는 그대로, 배율만) */
  setZoom(zoom: number) {
    this.zoom = zoom;
    this.cameras.main?.setZoom(zoom);
  }

  private text(x: number, y: number, s: string, size: number, color = COLOR.ink) {
    return this.add
      .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color: css(color) })
      .setOrigin(0.5)
      .setResolution(Math.max(2, Math.ceil(this.zoom)));
  }

  create() {
    ensureArt(this, this.match.setup.fighters.map((f) => f.char));
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    cam.setZoom(this.zoom);
    cam.setBackgroundColor(css(COLOR.skyMid));
    this.drawCourt();

    this.ballShadow = this.add.image(0, FLOOR_Y + 4, 'shadow').setAlpha(0.22).setDepth(8);
    this.ball = this.add.image(0, 0, 'ball').setDepth(30).setScale((BALL_R * 2 + 4) / BALL_TEX);

    for (const side of [0, 1] as const) {
      const f = this.match.setup.fighters[side];
      const mine = side === this.match.mySide;
      const shadow = this.add.image(0, FLOOR_Y + 4, 'shadow').setAlpha(0.22).setDepth(8);
      // 충돌 판정 원: 자리 색 테두리 (왼쪽 파랑·오른쪽 빨강)
      const ring = this.add.graphics().setDepth(18);
      ring.fillStyle(COLOR.white, 0.28).fillCircle(0, 0, PLAYER_R);
      ring.lineStyle(3, SIDE_COLOR[side], 0.75).strokeCircle(0, 0, PLAYER_R - 1.5);
      // 십이지 그림은 모두 오른쪽을 본다: 오른쪽 자리는 뒤집어 네트(왼쪽)를 보게 한다
      const spr = this.add.image(0, 0, zKey(f.char)).setOrigin(0.5, 1).setDepth(20).setFlipX(side === 1);
      const tex = spr.texture.getSourceImage();
      const base = Math.min(CHAR_H / tex.height, CHAR_MAX_W / tex.width);
      spr.setScale(base);

      // 이름표: 자리 색 테두리, 내 것은 노란 바탕
      const labelText = this.text(0, 0, f.name, 22);
      const labelBg = this.add.graphics();
      const label = this.add.container(0, 0, [labelBg, labelText]).setDepth(40).setAlpha(0.95);
      const a: Actor = { side, spr, base, ring, shadow, label, labelText, labelBg, stride: side * 1.7, landT: 9, hitT: 9 };
      this.paintLabel(a, f.name, mine);
      this.actors.push(a);
    }
    this.draw(0);
  }

  /** 이름표 글자와 바탕을 그린다 (AI가 이어받으면 'AI 이름'으로 바뀐다) */
  private paintLabel(a: Actor, name: string, mine: boolean) {
    a.labelText.setText(name);
    const w = a.labelText.width + 26;
    const h = 34;
    a.labelBg.clear();
    a.labelBg.fillStyle(mine ? COLOR.primary : COLOR.white, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    a.labelBg.lineStyle(4, SIDE_COLOR[a.side], 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    a.label.setData('w', w);
  }

  /** 경기장: 배경(3종) + 코트 표시 + 벽·천장 + 네트. 그림 파일이 있으면 그것을, 없으면 코드 그림 */
  private drawCourt() {
    const painted = this.textures.exists(`bg-${((this.bg % BG_COUNT) + BG_COUNT) % BG_COUNT}`);
    drawBackdrop(this, this.bg);

    // 코트 구분: 왼쪽 파랑·오른쪽 빨강 (바닥 띠 + 옅은 빛)
    const tint = this.add.graphics().setDepth(4);
    tint.fillStyle(SIDE_COLOR[0], 0.07).fillRect(LEFT, FLOOR_Y - 120, NET_X - LEFT, 120);
    tint.fillStyle(SIDE_COLOR[1], 0.07).fillRect(NET_X, FLOOR_Y - 120, RIGHT - NET_X, 120);
    const f = this.add.graphics().setDepth(6);
    for (const [side, x0, x1] of [[0, LEFT + 6, NET_X - 16], [1, NET_X + 16, RIGHT - 6]] as const) {
      f.fillStyle(COLOR.outline, 1).fillRoundedRect(x0 - 3, FLOOR_Y + 7, x1 - x0 + 6, 16, 8);
      f.fillStyle(SIDE_COLOR[side], 1).fillRoundedRect(x0, FLOOR_Y + 10, x1 - x0, 10, 5);
    }
    f.fillStyle(COLOR.outline, 1).fillRect(0, FLOOR_Y - 2, COURT_W, 4);

    // 벽·천장 (크림색 판 + 외곽선). 정식 배경 그림에는 벽이 그려져 있다
    if (!painted) {
      const w = this.add.graphics().setDepth(45);
      w.fillStyle(COLOR.panel, 1);
      w.fillRect(0, 0, COURT_W, CEIL).fillRect(0, 0, WALL, COURT_H).fillRect(RIGHT, 0, WALL, COURT_H);
      w.fillStyle(COLOR.lineSoft, 1);
      for (let y = 60; y < COURT_H; y += 96) w.fillRect(4, y, WALL - 8, 4).fillRect(RIGHT + 4, y, WALL - 8, 4);
      w.fillStyle(COLOR.outline, 1);
      w.fillRect(WALL - 4, CEIL - 4, COURT_W - WALL * 2 + 8, 4).fillRect(WALL - 4, CEIL - 4, 4, COURT_H).fillRect(RIGHT, CEIL - 4, 4, COURT_H);
    }

    // 네트: 기둥 + 둥근 윗면 + 받침
    const nl = NET_X - NET_W / 2;
    if (this.textures.exists('net')) {
      this.add.image(NET_X, FLOOR_Y, 'net').setOrigin(0.5, 1).setDisplaySize(24, FLOOR_Y - NET_TOP + 16).setDepth(25);
      return;
    }
    const n = this.add.graphics().setDepth(25);
    n.fillStyle(COLOR.outline, 1).fillRoundedRect(nl - 4, NET_TOP - 4, NET_W + 8, FLOOR_Y - NET_TOP + 4, { tl: NET_R + 4, tr: NET_R + 4, bl: 0, br: 0 });
    n.fillStyle(COLOR.white, 1).fillRoundedRect(nl, NET_TOP, NET_W, FLOOR_Y - NET_TOP, { tl: NET_R, tr: NET_R, bl: 0, br: 0 });
    n.fillStyle(COLOR.pink, 1);
    for (let y = NET_TOP + 30; y < FLOOR_Y - 20; y += 44) n.fillRect(nl, y, NET_W, 16);
    n.fillStyle(COLOR.primary, 1).fillRoundedRect(nl, NET_TOP, NET_W, 16, { tl: NET_R, tr: NET_R, bl: 0, br: 0 });
    n.fillStyle(COLOR.outline, 1).fillRect(nl, NET_TOP + 16, NET_W, 3);
    n.fillStyle(COLOR.outline, 1).fillRoundedRect(NET_X - 20, FLOOR_Y - 12, 40, 14, { tl: 7, tr: 7, bl: 0, br: 0 });
    n.fillStyle(COLOR.panel, 1).fillRoundedRect(NET_X - 16, FLOOR_Y - 8, 32, 8, { tl: 4, tr: 4, bl: 0, br: 0 });
  }

  update(_time: number, delta: number) {
    const dt = Math.min(0.1, delta / 1000);
    this.match.update(performance.now());
    const evs = this.match.events.splice(0);
    // 탭이 가려졌다 돌아오면 알림이 한꺼번에 쌓여 있다: 소리·파티클은 마지막 몇 개만, 상태 알림(이름표 등)은 모두
    const skip = evs.length > FX_PER_FRAME ? evs.length - FX_PER_FRAME : 0;
    evs.forEach((e, i) => {
      if (i >= skip || e.t === 'takeover') this.onEvent(e);
    });
    this.draw(dt);
    this.onFrame(evs);
  }

  private draw(dt: number) {
    const s = this.match.state;
    const now = this.time.now / 1000;
    const paused = this.match.paused;

    // 공
    const b = this.match.ballView();
    this.ball.setPosition(b.x, b.y);
    if (!paused && this.match.phase === 'play' && s.phase === 'play') this.spin += s.ball.vx * dt * 60 * 0.035;
    this.ball.setRotation(this.spin);
    if (!paused) this.ballSquash += dt;
    const sq = this.ballSquash < 0.12 ? 1 - this.ballSquash / 0.12 : 0;
    const bs = (BALL_R * 2 + 4) / BALL_TEX;
    this.ball.setScale(bs * (1 + sq * 0.16), bs * (1 - sq * 0.14));
    const high = Phaser.Math.Clamp((FLOOR_Y - b.y) / 700, 0, 1);
    this.ballShadow.setPosition(b.x, FLOOR_Y + 4).setScale(1 - high * 0.5, 1 - high * 0.4).setAlpha(0.26 - high * 0.16);

    // 랠리 가속 중에는 공 뒤에 잔상
    if (s.stage > 0 && s.phase === 'play' && !paused && dt > 0) {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.05;
        const ghost = this.add.image(b.x, b.y, 'ball').setDepth(29).setScale(bs).setRotation(this.spin).setTintFill(COLOR.primary).setAlpha(0.14 + s.stage * 0.05);
        this.tweens.add({ targets: ghost, alpha: 0, scale: bs * 0.6, duration: 160 + s.stage * 30, onComplete: () => ghost.destroy() });
      }
    }

    // 캐릭터
    for (const a of this.actors) {
      const p = s.players[a.side];
      const v = this.match.playerView(a.side);
      if (!paused) {
        a.landT += dt;
        a.hitT += dt;
      }
      let sx = 1;
      let sy = 1;
      let rot = 0;
      let oy = 0;
      if (!p.ground) {
        // 점프: 올라갈 때 길쭉하게, 내려올 때 조금 납작하게
        const k = Phaser.Math.Clamp(-p.vy / 14, -1, 1);
        sy = 1 + 0.16 * k;
        sx = 1 - 0.1 * k;
        rot = p.vx * 0.03;
      } else if (p.vx !== 0 && this.match.phase === 'play' && s.phase === 'play') {
        // 이동: 가는 쪽으로 기울이고 통통
        if (!paused) a.stride += dt * 16;
        const hop = Math.abs(Math.sin(a.stride));
        oy = -hop * 7;
        rot = Math.sign(p.vx) * (0.14 + Math.sin(a.stride * 2) * 0.03);
        sy = 1 + Math.cos(a.stride * 2) * 0.04;
        sx = 1 - Math.cos(a.stride * 2) * 0.04;
      } else {
        // 대기: 살짝 숨쉬기
        sy = 1 + Math.sin(now * 3 + a.side * 1.3) * 0.025;
        sx = 1 - Math.sin(now * 3 + a.side * 1.3) * 0.015;
      }
      // 착지: 찌그러졌다 돌아온다
      if (p.ground && a.landT < 0.16) {
        const k = 1 - a.landT / 0.16;
        sy -= 0.2 * k;
        sx += 0.16 * k;
      }
      // 공을 친 순간 살짝 커진다
      if (a.hitT < 0.12) {
        const k = 1 - a.hitT / 0.12;
        sx += 0.08 * k;
        sy += 0.08 * k;
      }
      const feet = v.y + PLAYER_R + 4;
      a.spr.setPosition(v.x, feet + oy).setRotation(rot).setScale(a.base * sx, a.base * sy);
      a.ring.setPosition(v.x, v.y);
      const up = Phaser.Math.Clamp((FLOOR_Y - PLAYER_R - v.y) / 130, 0, 1);
      a.shadow.setPosition(v.x, FLOOR_Y + 4).setScale(1.25 - up * 0.45, 1 - up * 0.3).setAlpha(0.26 - up * 0.12);
      const lw = (a.label.getData('w') as number) / 2;
      a.label.setPosition(Phaser.Math.Clamp(v.x, LEFT + lw + 4, RIGHT - lw - 4), v.y - PLAYER_R - 38 + Math.min(0, oy));
    }
  }

  /** 작은 이펙트 하나: 날아가며 사라진다 */
  private puff(key: string, x: number, y: number, size: number, vx: number, vy: number, ms: number, tint?: number) {
    const img = this.add.image(x, y, key).setDepth(35);
    const tex = img.texture.getSourceImage();
    const sc = size / Math.max(tex.width, tex.height);
    img.setScale(sc * 0.6);
    if (tint !== undefined) img.setTint(tint);
    this.tweens.add({
      targets: img, x: x + (vx * ms) / 1000, y: y + (vy * ms) / 1000, scaleX: sc, scaleY: sc, alpha: 0, angle: (Math.random() - 0.5) * 90, duration: ms, ease: 'Quad.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  private confetti(x: number, y: number) {
    const cols = [COLOR.primary, COLOR.pink, COLOR.teamA, COLOR.win, COLOR.white];
    for (let i = 0; i < 28; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 160 + Math.random() * 340;
      this.puff('confetti', x, y, 14 + Math.random() * 10, Math.cos(ang) * sp, Math.sin(ang) * sp + 120, 800 + Math.random() * 400, cols[i % cols.length]);
    }
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (i - 2) * 0.5;
      this.puff('star', x, y, 44, Math.cos(ang) * 260, Math.sin(ang) * 260, 700);
    }
  }

  /** 퍼지며 사라지는 고리 (타격·벽에 닿은 자리) */
  private ringFx(x: number, y: number, size: number, color: number) {
    const g = this.add.graphics({ x, y }).setDepth(34);
    g.lineStyle(5, COLOR.outline, 1).strokeCircle(0, 0, size);
    g.lineStyle(3, color, 1).strokeCircle(0, 0, size);
    g.setScale(0.3);
    this.tweens.add({ targets: g, scale: 1.25, alpha: 0, duration: 240, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
  }

  /** 가운데 위에 잠깐 뜨는 글자 (빨라질 때) */
  private banner(msg: string) {
    const t = this.text(COURT_W / 2, 150, msg, 52, COLOR.primary).setDepth(60).setStroke(css(COLOR.outline), 10).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: 120, delay: 900, duration: 300, onComplete: () => t.destroy() });
  }

  private onEvent(e: MatchEvent) {
    const me = this.match.mySide;
    switch (e.t) {
      case 'count':
        this.sfx('volleyCount');
        break;
      case 'go':
        this.sfx('volleyGo');
        break;
      case 'serve':
        if (this.match.phase === 'play') this.sfx('volleyServe', { volume: 0.7 });
        break;
      case 'jump': {
        this.sfx('jump', e.side === me ? undefined : { volume: 0.4, rate: 1.1 });
        const p = this.match.state.players[e.side];
        this.puff('dust', p.x - 14, FLOOR_Y - 6, 34, -70, -20, 300);
        this.puff('dust', p.x + 14, FLOOR_Y - 6, 34, 70, -20, 300);
        break;
      }
      case 'land': {
        this.sfx('land', { volume: e.side === me ? 0.8 : 0.35 });
        const a = this.actors[e.side];
        a.landT = 0;
        const p = this.match.state.players[e.side];
        this.puff('dust', p.x - 18, FLOOR_Y - 6, 38, -90, -16, 320);
        this.puff('dust', p.x + 18, FLOOR_Y - 6, 38, 90, -16, 320);
        break;
      }
      case 'hit': {
        // 세게 칠수록 높고 큰 소리
        const k = Phaser.Math.Clamp((e.power - 11) / 19, 0, 1);
        this.sfx('volleyHit', { volume: 0.6 + k * 0.4, rate: 1.15 - k * 0.3 });
        this.actors[e.side].hitT = 0;
        for (let i = 0; i < 3 + Math.round(k * 3); i++) {
          const ang = Math.random() * Math.PI * 2;
          this.puff('star', e.x, e.y, 26 + k * 16, Math.cos(ang) * (120 + k * 160), Math.sin(ang) * (120 + k * 160), 360);
        }
        this.ringFx(e.x, e.y, 22 + k * 26, SIDE_COLOR[e.side]);
        // 공이 맞는 순간 살짝 눌렸다 펴진다
        this.ballSquash = 0;
        if (k > 0.5) this.cameras.main.shake(90, 0.004);
        break;
      }
      case 'wall':
        this.sfx('volleyWall', { volume: 0.8 });
        this.puff('dust', e.x, e.y, 36, e.x <= LEFT ? 60 : e.x >= RIGHT ? -60 : 0, e.y <= CEIL ? 60 : -10, 280);
        break;
      case 'net':
        this.sfx('volleyNet');
        this.puff('dust', e.x, e.y, 32, 0, -50, 280);
        break;
      case 'speedup':
        this.sfx('volleySpeed');
        this.banner(`빨라져요! +${e.stage * 10}%`);
        this.cameras.main.flash(180, 255, 211, 77, false);
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          this.puff('spark', this.ball.x, this.ball.y, 60, Math.cos(ang) * 320, Math.sin(ang) * 320, 320);
        }
        break;
      case 'point': {
        this.sfx(e.side === me ? 'volleyPoint' : 'volleyMiss');
        for (let i = 0; i < 6; i++) this.puff('dust', e.x, FLOOR_Y - 6, 44, (Math.random() - 0.5) * 320, -60 - Math.random() * 120, 420);
        this.cameras.main.shake(140, 0.006);
        const p = this.match.state.players[e.side];
        this.confetti(p.x, FLOOR_Y - 150);
        break;
      }
      case 'takeover': {
        // 나간 사람의 캐릭터를 AI가 이어받는다: 이름표를 'AI 이름'으로
        const a = this.actors[e.side];
        this.paintLabel(a, `AI ${this.match.setup.fighters[e.side].name}`, false);
        this.ringFx(a.spr.x, a.spr.y - 40, 46, SIDE_COLOR[e.side]);
        break;
      }
      case 'over':
        break;
    }
  }
}

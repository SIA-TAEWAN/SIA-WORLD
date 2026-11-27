// 게임 화면: Sim 을 고정 스텝(1/60초)으로 돌리고, 미리 만들어 둔 그림(풀)을 같은 칸 번호대로 옮긴다.
// 새 그림 객체는 실행 중에 만들지 않는다 (모바일 60fps).
import Phaser from 'phaser';
import { CAP, H, NO_INPUT, Sim, W, type Input, type SimEvent, type SimOptions } from '../game/sim';
import { makeArt } from './art';
import { SHIPS } from '../data/ships';
import { FONT, COLOR, css } from '../theme';

export interface HudState {
  score: number; lives: number; bombs: number; power: number; kills: number;
  bullets: number; seconds: number; dragging: boolean;
}
export interface StageHooks {
  hud(s: HudState): void;
  event(e: SimEvent): void;
  over(s: HudState): void;
}

const FX_CAP = 48;
const TXT_CAP = 12;
const STEP_MS = 1000 / 60;

interface Fx { img: Phaser.GameObjects.Image; life: number; max: number; s0: number; s1: number; vy: number }
interface Txt { t: Phaser.GameObjects.Text; life: number }

export class StageScene extends Phaser.Scene {
  sim!: Sim;
  paused = true;
  /** 드래그 감도 (손가락 1px = 기체 몇 px) */
  sens = 1;
  private simOpts!: SimOptions;
  private acc = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private ship!: Phaser.GameObjects.Image;
  private flame!: Phaser.GameObjects.Image;
  private dot!: Phaser.GameObjects.Image;
  private optImgs: Phaser.GameObjects.Image[] = [];
  private ebImgs: Phaser.GameObjects.Image[] = [];
  private psImgs: Phaser.GameObjects.Image[] = [];
  private enImgs: Phaser.GameObjects.Image[] = [];
  private itImgs: Phaser.GameObjects.Image[] = [];
  private twImgs: Phaser.GameObjects.Image[] = [];
  private fx: Fx[] = [];
  private txt: Txt[] = [];
  private drag: { id: number; x: number; y: number } | null = null;
  private pend = { dx: 0, dy: 0 };
  private bombReq = false;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private tilt = 0;
  private lastHud = '';

  constructor(private hooks: StageHooks, opts: SimOptions) {
    super('stage');
    this.simOpts = opts;
  }

  preload() {
    this.load.image('face-dragon', shared('images/zodiac/face/dragon.png'));
    this.load.image('floor', 'art/floor-r01.png');
  }

  create() {
    makeArt(this, SHIPS[this.simOpts.ship]);
    // 바닥: 열두길 1지형 무늬를 깔고 아래로 흐르게. TileSprite 는 보이는 크기만큼 캔버스를 만들므로 화면 크기 그대로 하나만
    this.bg = this.add.tileSprite(W / 2, H / 2, W, H, 'floor').setTileScale(0.9);
    const img = (frame: string, depth: number) => this.add.image(-200, -200, 'art', frame).setVisible(false).setDepth(depth);
    for (let i = 0; i < CAP.item; i++) { this.twImgs.push(img('twinkle', 1)); this.itImgs.push(img('itemP', 2)); }
    for (let i = 0; i < CAP.en; i++) this.enImgs.push(img('small', 3));
    for (let i = 0; i < CAP.ps; i++) this.psImgs.push(img('ps', 4));
    this.flame = img('flame', 5).setOrigin(0.5, 0);
    this.ship = img('ship', 6);
    for (let i = 0; i < 2; i++) this.optImgs.push(img('opt', 6));
    for (let i = 0; i < FX_CAP; i++) this.fx.push({ img: img('boom', 7), life: 0, max: 1, s0: 0, s1: 1, vy: 0 });
    for (let i = 0; i < CAP.eb; i++) this.ebImgs.push(img('eb', 8));
    this.dot = img('dot', 9);
    for (let i = 0; i < TXT_CAP; i++) {
      const t = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '34px', color: css(COLOR.white), stroke: css(COLOR.outline), strokeThickness: 7 })
        .setOrigin(0.5).setDepth(10).setVisible(false);
      this.txt.push({ t, life: 0 });
    }

    // 입력: 화면 어디든 드래그 → 손가락이 움직인 만큼 기체가 움직인다 (기체를 가리지 않게 상대 이동)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.drag || this.paused) return;
      this.drag = { id: p.id, x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || this.drag.id !== p.id) return;
      this.pend.dx += (p.x - this.drag.x) * this.sens;
      this.pend.dy += (p.y - this.drag.y) * this.sens;
      this.drag.x = p.x; this.drag.y = p.y;
    });
    const up = (p: Phaser.Input.Pointer) => { if (this.drag?.id === p.id) this.drag = null; };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-SPACE', () => this.bomb());
    this.newRun();
  }

  /** 새 판 (같은 설정, 다른 씨앗) */
  newRun(opts: Partial<SimOptions> = {}) {
    this.simOpts = { ...this.simOpts, ...opts, seed: (Math.random() * 2 ** 31) | 0 };
    this.sim = new Sim(this.simOpts);
    this.acc = 0;
    this.drag = null;
    this.pend.dx = this.pend.dy = 0;
    for (const f of this.fx) { f.life = 0; f.img.setVisible(false); }
    for (const t of this.txt) { t.life = 0; t.t.setVisible(false); }
    this.lastHud = '';
    this.render();
  }

  bomb() { if (!this.paused) this.bombReq = true; }

  setPaused(p: boolean) {
    this.paused = p;
    this.drag = null;
    this.acc = 0;
  }

  update(_time: number, delta: number) {
    if (this.paused || !this.sim) return;
    this.acc += Math.min(delta, 100);
    let steps = 0;
    while (this.acc >= STEP_MS && steps < 4) {
      this.acc -= STEP_MS; steps++;
      this.sim.step(this.input_(steps === 1));
      for (const e of this.sim.events) this.onEvent(e);
      if (this.sim.state === 'over') break;
    }
    if (steps >= 4) this.acc = 0;
    this.bg.tilePositionY -= 2.2 * steps;
    this.tickFx(steps);
    this.render();
    this.pushHud();
    if (this.sim.state === 'over') { this.setPaused(true); this.hooks.over(this.hudState()); }
  }

  /** 이번 스텝 입력. 드래그 이동량은 첫 스텝에 모두 넣는다 */
  private input_(first: boolean): Input {
    if (!first) return NO_INPUT;
    const k = this.keys;
    const inp: Input = {
      dx: this.pend.dx, dy: this.pend.dy,
      kx: (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0),
      ky: (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0),
      bomb: this.bombReq,
    };
    this.pend.dx = this.pend.dy = 0;
    this.bombReq = false;
    return inp;
  }

  private onEvent(e: SimEvent) {
    switch (e.t) {
      case 'kill':
        this.spawnFx('boom', e.x, e.y, e.kind === 'medium' ? 0.5 : 0.3, e.kind === 'medium' ? 1.6 : 0.9, 18);
        if (e.kind !== 'small') { this.floatText(e.x, e.y - 30, '+' + e.score.toLocaleString()); this.cameras.main.shake(120, 0.006); }
        break;
      case 'hit':
        this.spawnFx('ring', e.x, e.y, 0.2, 1.6, 26);
        this.cameras.main.shake(260, 0.014);
        this.cameras.main.flash(180, 255, 77, 109);
        break;
      case 'bomb':
        this.spawnFx('ring', e.x, e.y, 0.3, 9, 40);
        this.spawnFx('ring', e.x, e.y, 0.2, 6, 30);
        this.cameras.main.flash(260, 255, 248, 232);
        this.cameras.main.shake(300, 0.01);
        break;
      case 'pick':
        this.spawnFx('spark', e.x, e.y, 1, 3, 14);
        this.floatText(e.x, e.y - 34, e.kind === 'B' ? '폭탄 +1' : e.score ? '+' + e.score.toLocaleString() : '파워 업!');
        break;
    }
    this.hooks.event(e);
  }

  private spawnFx(frame: string, x: number, y: number, s0: number, s1: number, life: number) {
    const f = this.fx.find(v => v.life <= 0);
    if (!f) return;
    f.life = f.max = life; f.s0 = s0; f.s1 = s1; f.vy = 0;
    f.img.setFrame(frame).setPosition(x, y).setScale(s0).setAlpha(1).setVisible(true);
  }

  private floatText(x: number, y: number, s: string) {
    const t = this.txt.find(v => v.life <= 0);
    if (!t) return;
    t.life = 50;
    t.t.setText(s).setPosition(Phaser.Math.Clamp(x, 80, W - 80), y).setAlpha(1).setVisible(true);
  }

  private tickFx(steps: number) {
    for (const f of this.fx) {
      if (f.life <= 0) continue;
      f.life -= steps;
      if (f.life <= 0) { f.img.setVisible(false); continue; }
      const k = 1 - f.life / f.max;
      f.img.setScale(f.s0 + (f.s1 - f.s0) * Math.sqrt(k)).setAlpha(1 - k * k);
    }
    for (const t of this.txt) {
      if (t.life <= 0) continue;
      t.life -= steps;
      if (t.life <= 0) { t.t.setVisible(false); continue; }
      t.t.y -= 1.2 * steps;
      t.t.setAlpha(Math.min(1, t.life / 15));
    }
  }

  private render() {
    const s = this.sim;
    // 기체: 좌우로 움직이면 살짝 기울고 납작해진다 (애니메이션 그림 대신 코드)
    this.tilt += (Phaser.Math.Clamp(s.pvx * 0.06, -1, 1) - this.tilt) * 0.3;
    const blink = s.iframes > 0 && (s.frame >> 2) & 1;
    this.ship.setVisible(s.state === 'play').setPosition(s.px, s.py).setRotation(this.tilt * 0.12).setScale(1 - Math.abs(this.tilt) * 0.14, 1).setAlpha(blink ? 0.35 : 1);
    this.flame.setVisible(s.state === 'play').setPosition(s.px - this.tilt * 6, s.py + 56).setScale(1, 0.8 + ((s.frame >> 1) & 1) * 0.35).setAlpha(blink ? 0.35 : 1);
    this.dot.setVisible(!!this.drag && s.state === 'play').setPosition(s.px, s.py);
    for (let i = 0; i < 2; i++) this.optImgs[i].setVisible(s.power >= 3 && s.state === 'play').setPosition(s.opts[i].x, s.opts[i].y).setRotation(s.frame * 0.15);
    for (let i = 0; i < CAP.eb; i++) {
      const b = s.eb[i], im = this.ebImgs[i];
      if (!b.alive) { if (im.visible) im.setVisible(false); continue; }
      if (!im.visible) im.setVisible(true).setFrame(b.big ? 'ebBig' : 'eb');
      im.setPosition(b.x, b.y);
    }
    for (let i = 0; i < CAP.ps; i++) {
      const b = s.ps[i], im = this.psImgs[i];
      if (!b.alive) { if (im.visible) im.setVisible(false); continue; }
      im.setVisible(true).setPosition(b.x, b.y);
    }
    for (let i = 0; i < CAP.en; i++) {
      const e = s.en[i], im = this.enImgs[i];
      if (!e.alive) { if (im.visible) im.setVisible(false); continue; }
      if (im.frame.name !== e.kind) im.setFrame(e.kind);
      im.setVisible(true).setPosition(e.x, e.y).setRotation(e.kind === 'small' ? Math.sin(e.t / 8) * 0.12 : 0);
      if (e.flash > 0) im.setTintFill(0xffffff); else if (im.isTinted) im.clearTint();
    }
    for (let i = 0; i < CAP.item; i++) {
      const it = s.items[i], im = this.itImgs[i], tw = this.twImgs[i];
      if (!it.alive) { if (im.visible) { im.setVisible(false); tw.setVisible(false); } continue; }
      const fr = it.kind === 'P' ? 'itemP' : 'itemB';
      if (im.frame.name !== fr) im.setFrame(fr);
      im.setVisible(true).setPosition(it.x, it.y);
      tw.setVisible(true).setPosition(it.x, it.y).setRotation(s.frame * 0.05).setScale(0.9 + Math.sin(s.frame * 0.2) * 0.15);
    }
  }

  hudState(): HudState {
    const s = this.sim;
    return { score: s.score, lives: s.lives, bombs: s.bombs, power: s.power, kills: s.kills, bullets: s.ebCount, seconds: s.frame / 60, dragging: !!this.drag };
  }

  private pushHud() {
    const h = this.hudState();
    const key = `${h.score}|${h.lives}|${h.bombs}|${h.power}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.hooks.hud(h);
  }
}

/** shared/ 폴더 주소: 배포에서는 games/ace/ 에서 두 단계 위. 미리보기 페이지는 window.ACE_SHARED 로 바꾼다 */
export function shared(rel: string) {
  const base = (window as unknown as { ACE_SHARED?: string }).ACE_SHARED ?? '../../shared/';
  return base + rel;
}

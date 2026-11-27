// 게임 화면: Sim 을 고정 스텝(1/60초)으로 돌리고, 미리 만들어 둔 그림(풀)을 같은 칸 번호대로 옮긴다.
// 새 그림 객체는 실행 중에 만들지 않는다 (모바일 60fps). 그림은 모두 아틀라스 'art' 한 장 + 바닥 무늬.
import Phaser from 'phaser';
import { CAP, CHARGE_MAX, H, NO_INPUT, SCROLL, Sim, W, type Input, type SimEvent, type SimOptions } from '../game/sim';
import { ART_FILES, makeArt, makeSea, type BossArt } from './art';
import { SHIPS } from '../data/ships';
import { BOSSES } from '../data/bosses';
import type { StageDef, WaveScript } from '../data/waves';
import { FONT, COLOR, css } from '../theme';

export interface BossHud { name: string; hp: number; left: number; phase: number; phases: number; mid: boolean }
export interface HudState {
  score: number; lives: number; bombs: number; power: number; kills: number;
  bullets: number; seconds: number; dragging: boolean; coinChain: number; nextCoin: number;
  boss: BossHud | null;
}
export interface StageHooks {
  hud(s: HudState): void;
  event(e: SimEvent): void;
  over(s: HudState): void;
  clear(sim: Sim): void;
}

const FX_CAP = 48;
const TXT_CAP = 12;
const STEP_MS = 1000 / 60;
/** 보스 그림 이름: 보스 id → 텍스처 칸 */
const bossKey = (id: string) => 'boss-' + id;

interface Fx { img: Phaser.GameObjects.Image; life: number; max: number; s0: number; s1: number }
interface Txt { t: Phaser.GameObjects.Text; life: number }

export class StageScene extends Phaser.Scene {
  sim!: Sim;
  paused = true;
  /** 드래그 감도 (손가락 1px = 기체 몇 px) */
  sens = 1;
  private simOpts!: SimOptions;
  private acc = 0;
  private bg!: Phaser.GameObjects.TileSprite;
  private sea: Phaser.GameObjects.TileSprite | null = null;
  private ship!: Phaser.GameObjects.Image;
  private flame!: Phaser.GameObjects.Image;
  private dot!: Phaser.GameObjects.Image;
  private laser!: Phaser.GameObjects.Image;
  private cells: Phaser.GameObjects.Image[] = [];
  private optImgs: Phaser.GameObjects.Image[] = [];
  private ebImgs: Phaser.GameObjects.Image[] = [];
  private psImgs: Phaser.GameObjects.Image[] = [];
  private enImgs: Phaser.GameObjects.Image[] = [];
  private itImgs: Phaser.GameObjects.Image[] = [];
  private twImgs: Phaser.GameObjects.Image[] = [];
  private bossImg!: Phaser.GameObjects.Image;
  private partImgs: Phaser.GameObjects.Image[] = [];
  private fx: Fx[] = [];
  private txt: Txt[] = [];
  private drag: { id: number; x: number; y: number } | null = null;
  private pend = { dx: 0, dy: 0 };
  private bombReq = false;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private tilt = 0;
  private lastHud = '';
  private ended = false;

  constructor(private hooks: StageHooks, opts: SimOptions) {
    super('stage');
    this.simOpts = opts;
  }

  get stage(): WaveScript & Partial<StageDef> { return this.simOpts.waves; }

  preload() {
    this.load.image('face-dragon', shared('images/zodiac/face/dragon.png'));
    this.load.image('floor', `art/${this.stage.floor ?? 'floor-r01'}.png`);
    for (const f of ART_FILES) this.load.image('img:' + f, `art/${f}.png`);
    // 없는 그림은 코드 그림으로 (오류로 멈추지 않음)
    this.load.on('loaderror', () => {});
  }

  create() {
    const bosses: BossArt[] = Object.values(BOSSES).map(b => ({ key: bossKey(b.id), name: b.image, width: b.width }));
    makeArt(this, SHIPS[this.simOpts.ship], bosses);
    makeSea(this);
    // 바닥: 열두길 지형 무늬를 깔고 아래로 흐르게. TileSprite 는 보이는 크기만큼 캔버스를 만들므로 화면 크기 하나 + 바다 띠 하나만
    this.bg = this.add.tileSprite(W / 2, H / 2, W, H, 'floor').setTileScale(0.9);
    if (this.stage.sea) {
      const sw = 190, left = this.stage.sea === 'left';
      this.sea = this.add.tileSprite(left ? sw / 2 : W - sw / 2, H / 2, sw, H, 'sea').setDepth(0.5);
      // 모래 해변 + 외곽선 (곧은 띠라 한 번만 그림)
      const g = this.add.graphics().setDepth(0.6);
      const ex = left ? sw : W - sw;
      g.fillStyle(COLOR.skyBottom, 1).fillRect(left ? ex : ex - 16, 0, 16, H);
      g.lineStyle(4, COLOR.outline, 1).lineBetween(ex, 0, ex, H);
    }
    const img = (frame: string, depth: number) => this.add.image(-300, -300, 'art', frame).setVisible(false).setDepth(depth);
    for (let i = 0; i < CAP.en; i++) this.enImgs.push(img('small', 3));
    this.bossImg = img('boss-crab', 2.8);
    for (let i = 0; i < 6; i++) this.partImgs.push(img('partBroken', 2.9));
    for (let i = 0; i < CAP.item; i++) { this.twImgs.push(img('twinkle', 3.4)); this.itImgs.push(img('itemP', 3.5)); }
    for (let i = 0; i < CAP.ps; i++) this.psImgs.push(img('ps', 4));
    this.laser = img('laser', 4.1).setOrigin(0.5, 1);
    this.flame = img('flame', 5).setOrigin(0.5, 0);
    this.ship = img('ship', 6);
    for (let i = 0; i < 2; i++) this.optImgs.push(img('opt', 6));
    for (let i = 0; i < CHARGE_MAX; i++) this.cells.push(img('cell0', 6.5));
    for (let i = 0; i < FX_CAP; i++) this.fx.push({ img: img('boom', 7), life: 0, max: 1, s0: 0, s1: 1 });
    for (let i = 0; i < CAP.eb; i++) this.ebImgs.push(img('eb', 8));
    this.dot = img('dot', 9);
    for (let i = 0; i < TXT_CAP; i++) {
      const t = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '34px', color: css(COLOR.white), stroke: css(COLOR.outline), strokeThickness: 7 })
        .setOrigin(0.5).setDepth(10).setVisible(false);
      this.txt.push({ t, life: 0 });
    }

    // 입력: 화면 어디든 드래그 → 손가락이 움직인 만큼 기체가 움직인다 (기체를 가리지 않게 상대 이동).
    // 손가락을 대고 있는 동안 차지 게이지가 차고, 떼면 차지샷
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
    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-SPACE', () => this.bomb());
    this.newRun();
  }

  /** 새 판 (같은 설정, 다른 씨앗) */
  newRun(opts: Partial<SimOptions> = {}) {
    this.simOpts = { ...this.simOpts, ...opts, seed: (Math.random() * 2 ** 31) | 0 };
    this.sim = new Sim(this.simOpts);
    this.acc = 0;
    this.drag = null;
    this.ended = false;
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
      if (this.sim.state !== 'play') break;
    }
    if (steps >= 4) this.acc = 0;
    this.bg.tilePositionY -= SCROLL / 0.9 * steps;
    if (this.sea) this.sea.tilePositionY -= SCROLL * steps;
    this.tickFx(steps);
    this.render();
    this.pushHud();
    if (this.sim.state !== 'play' && !this.ended) {
      this.ended = true;
      // 마지막 폭발이 보이게 조금 뒤에 결과
      this.time.delayedCall(this.sim.state === 'over' ? 900 : 300, () => {
        this.setPaused(true);
        if (this.sim.state === 'over') this.hooks.over(this.hudState()); else this.hooks.clear(this.sim);
      });
    }
  }

  /** 이번 스텝 입력. 드래그 이동량은 첫 스텝에 모두 넣는다 */
  private input_(first: boolean): Input {
    const k = this.keys;
    const charge = !!this.drag || k.SHIFT.isDown;
    if (!first) return charge ? { ...NO_INPUT, charge } : NO_INPUT;
    const inp: Input = {
      dx: this.pend.dx, dy: this.pend.dy,
      kx: (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0),
      ky: (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0),
      bomb: this.bombReq,
      charge,
    };
    this.pend.dx = this.pend.dy = 0;
    this.bombReq = false;
    return inp;
  }

  private onEvent(e: SimEvent) {
    const cam = this.cameras.main;
    switch (e.t) {
      case 'kill':
        this.spawnFx('boom', e.x, e.y, e.kind === 'medium' ? 0.5 : 0.3, e.kind === 'medium' ? 1.6 : 0.9, 18);
        if (e.kind !== 'small') { this.floatText(e.x, e.y - 30, '+' + e.score.toLocaleString()); cam.shake(120, 0.006); }
        break;
      case 'hit':
        this.spawnFx('ring', e.x, e.y, 0.2, 1.6, 26);
        cam.shake(260, 0.014);
        cam.flash(180, 255, 77, 109);
        break;
      case 'bomb':
        this.spawnFx('ring', e.x, e.y, 0.3, 9, 40);
        this.spawnFx('ring', e.x, e.y, 0.2, 6, 30);
        cam.flash(260, 255, 248, 232);
        cam.shake(300, 0.01);
        break;
      case 'pick':
        this.spawnFx('spark', e.x, e.y, 1, 3, 14);
        if (e.kind === 'C') this.floatText(e.x, e.y - 30, '+' + e.score.toLocaleString(), true);
        else this.floatText(e.x, e.y - 34, e.kind === 'B' ? '폭탄 +1' : e.score ? '+' + e.score.toLocaleString() : '파워 업!');
        break;
      case 'charge':
        cam.shake(90 + e.cells * 50, 0.004 * e.cells);
        break;
      case 'partDown':
        this.spawnFx('boom', e.x, e.y, 0.4, 1.4, 22);
        this.floatText(e.x, e.y - 40, '부위 파괴 +' + e.score.toLocaleString());
        cam.shake(160, 0.008);
        break;
      case 'phase':
        cam.flash(220, 255, 248, 232);
        break;
      case 'bossDown': {
        for (let i = 0; i < 8; i++) this.spawnFx('boom', e.x + (i % 4 - 1.5) * 70, e.y + (i < 4 ? -40 : 50), 0.5, 1.8, 30 + i * 4);
        this.spawnFx('ring', e.x, e.y, 0.5, 6, 40);
        this.floatText(e.x, e.y, '+' + e.score.toLocaleString(), true);
        cam.shake(600, 0.018);
        cam.flash(300, 255, 248, 232);
        break;
      }
    }
    this.hooks.event(e);
  }

  private spawnFx(frame: string, x: number, y: number, s0: number, s1: number, life: number) {
    const f = this.fx.find(v => v.life <= 0);
    if (!f) return;
    f.life = f.max = life; f.s0 = s0; f.s1 = s1;
    f.img.setFrame(frame).setPosition(x, y).setScale(s0).setAlpha(1).setVisible(true);
  }

  private floatText(x: number, y: number, s: string, gold = false) {
    const t = this.txt.find(v => v.life <= 0);
    if (!t) return;
    t.life = 50;
    t.t.setText(s).setColor(gold ? css(COLOR.primary) : css(COLOR.white)).setFontSize(gold ? 30 : 34)
      .setPosition(Phaser.Math.Clamp(x, 110, W - 110), y).setAlpha(1).setVisible(true);
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
    const alive = s.state === 'play';
    // 기체: 좌우로 움직이면 살짝 기울고 납작해진다 (애니메이션 그림 대신 코드)
    this.tilt += (Phaser.Math.Clamp(s.pvx * 0.06, -1, 1) - this.tilt) * 0.3;
    const blink = s.iframes > 0 && (s.frame >> 2) & 1;
    this.ship.setVisible(alive || s.state === 'clear').setPosition(s.px, s.py).setRotation(this.tilt * 0.12).setScale(1 - Math.abs(this.tilt) * 0.14, 1).setAlpha(blink ? 0.35 : 1);
    this.flame.setVisible(alive || s.state === 'clear').setPosition(s.px - this.tilt * 6, s.py + 56).setScale(1, 0.8 + ((s.frame >> 1) & 1) * 0.35).setAlpha(blink ? 0.35 : 1);
    this.dot.setVisible(!!this.drag && alive).setPosition(s.px, s.py);
    for (let i = 0; i < 2; i++) this.optImgs[i].setVisible(s.power >= 3 && alive).setPosition(s.opts[i].x, s.opts[i].y).setRotation(s.frame * 0.15);
    // 차지 게이지 3칸 (기체 아래, 누르고 있을 때만)
    const cells = s.chargeCells, showCells = alive && s.chargeT > 6 && s.laser.t <= 0;
    for (let i = 0; i < CHARGE_MAX; i++) {
      const im = this.cells[i];
      if (!showCells) { if (im.visible) im.setVisible(false); continue; }
      const fr = i < cells ? 'cell1' : 'cell0';
      if (im.frame.name !== fr) im.setFrame(fr);
      im.setVisible(true).setPosition(s.px + (i - 1) * 24, s.py + 86).setScale(cells === CHARGE_MAX ? 1 + ((s.frame >> 2) & 1) * 0.15 : 1);
    }
    // 관통 레이저
    if (s.laser.t > 0) {
      const k = s.laser.t / s.laser.max, half = s.laserHalf();
      this.laser.setVisible(true).setPosition(s.px, s.py - 40).setDisplaySize(half * 2 * (0.75 + 0.25 * Math.sin(s.frame * 0.8)), s.py - 40).setAlpha(Math.min(1, k * 3));
    } else if (this.laser.visible) this.laser.setVisible(false);
    for (let i = 0; i < CAP.eb; i++) {
      const b = s.eb[i], im = this.ebImgs[i];
      if (!b.alive) { if (im.visible) im.setVisible(false); continue; }
      const fr = b.big ? 'ebBig' : 'eb';
      if (!im.visible) im.setVisible(true);
      if (im.frame.name !== fr) im.setFrame(fr);
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
      const fr = e.kind === 'ground' ? (this.stage.sea && (e.x < 200) === (this.stage.sea === 'left') ? 'groundSea' : 'ground') : e.kind;
      if (im.frame.name !== fr) im.setFrame(fr).setDepth(e.kind === 'ground' ? 1 : 3);
      im.setVisible(true).setPosition(e.x, e.y).setRotation(e.kind === 'small' ? Math.sin(e.t / 8) * 0.12 : 0);
      if (e.flash > 0) im.setTintFill(0xffffff); else if (im.isTinted) im.clearTint();
    }
    for (let i = 0; i < CAP.item; i++) {
      const it = s.items[i], im = this.itImgs[i], tw = this.twImgs[i];
      if (!it.alive) { if (im.visible) { im.setVisible(false); tw.setVisible(false); } continue; }
      const fr = it.kind === 'P' ? 'itemP' : it.kind === 'B' ? 'itemB' : 'itemC';
      if (im.frame.name !== fr) im.setFrame(fr);
      im.setVisible(true).setPosition(it.x, it.y).setScale(it.kind === 'C' ? 0.85 + Math.abs(Math.sin(s.frame * 0.15 + i)) * 0.15 : 1, 1);
      // 반짝임은 P · B 만 (금화는 많이 떨어져서 가볍게)
      if (it.kind === 'C') { if (tw.visible) tw.setVisible(false); }
      else tw.setVisible(true).setPosition(it.x, it.y).setRotation(s.frame * 0.05).setScale(0.9 + Math.sin(s.frame * 0.2) * 0.15);
    }
    // 보스: 그림 한 장 + 부서진 부위 자리
    const b = s.boss;
    if (b) {
      const key = bossKey(b.def.id);
      if (this.bossImg.frame.name !== key) this.bossImg.setFrame(key);
      this.bossImg.setVisible(true).setPosition(b.x, b.y);
      if (b.flash > 0) this.bossImg.setTint(0xffd6de); else if (this.bossImg.isTinted) this.bossImg.clearTint();
      for (let i = 0; i < this.partImgs.length; i++) {
        const p = b.parts[i], im = this.partImgs[i];
        if (!p || p.alive) { if (p && p.flash > 0) im.setFrame('spark').setVisible(true).setPosition(b.x + p.x, b.y + p.y).setScale(p.r / 8).setAlpha(0.6); else im.setVisible(false); continue; }
        im.setFrame('partBroken').setVisible(true).setPosition(b.x + p.x, b.y + p.y).setScale((p.r * 2) / 60).setAlpha(1);
      }
    } else if (this.bossImg.visible) {
      this.bossImg.setVisible(false);
      for (const im of this.partImgs) im.setVisible(false);
    }
  }

  hudState(): HudState {
    const s = this.sim, b = s.boss;
    return {
      score: s.score, lives: s.lives, bombs: s.bombs, power: s.power, kills: s.kills, bullets: s.ebCount,
      seconds: s.frame / 60, dragging: !!this.drag, coinChain: s.coinChain, nextCoin: s.nextCoin,
      boss: b && b.state !== 'down' ? {
        name: b.def.name, hp: b.hp / b.maxHp, left: Math.ceil(b.left / 60), phase: b.phase, phases: b.def.phases.length, mid: b.def.kind === 'mid',
      } : null,
    };
  }

  private pushHud() {
    const h = this.hudState();
    const bk = h.boss ? `${Math.round(h.boss.hp * 200)}|${h.boss.left}|${h.boss.phase}` : '-';
    const key = `${h.score}|${h.lives}|${h.bombs}|${h.power}|${h.coinChain}|${bk}`;
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

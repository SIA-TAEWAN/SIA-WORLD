/**
 * 전투 화면 (세로 430×860). 배치는 PRD [화면]: 위 = 요괴·의도·체력·상태, 가운데 = 영웅, 아래 = 부채꼴 손패·기력 구슬·뽑을/버린 더미·턴 끝 버튼.
 * 화면은 규칙을 직접 바꾸지 않는다 — 입력(Input)을 hooks.send 로 넘기고, 돌아온 연출 사건(SimEvent)을 차례로 보여 준 뒤 상태대로 다시 그린다.
 * 카드는 끌어다 놓거나(대상 카드는 요괴 위에) 탭해서 고른 뒤 한 번 더 탭(대상 카드는 요괴를 탭)해서 쓴다.
 *
 * 그림 (3단계, art.ts 의 ART_FILES — 못 읽으면 코드 그림): 배경 bg-<지역> · 영웅 시트 hero-<id>(앞줄 서기·공격) · 요괴 e-* · b-* (+ 맞은 모습 -hit,
 * 보스 공격 동작 -atk) · 카드 틀 card-frame + 카드 그림 · 의도 시트 intent · 기력 구슬 energy · 효과 fx-* · 상태이상 st-* · 카드 뒷면 back · 컷인 cut-<영웅>.
 * 연출: 공격카드를 쓰면 영웅이 앞으로 튀어 나가고 fx 그림, 요괴는 -hit 그림으로 흔들림, 보스 등장·2단계는 핑거식 컷인 + -atk, 전설 카드는 영웅 컷인.
 */
import Phaser from 'phaser';
import {
  CARDS,
  POTIONS,
  aliveFoes,
  cardDef,
  cardName,
  cardOps,
  cardText,
  enemyDef,
  foeHits,
  heroDef,
  keptBlock,
  moveDef,
  phaseOf,
  playCost,
  potionDef,
  regionDef,
  relicDef,
  STATUS_HELP,
  STATUS_NAME,
  type ApplyResult,
  type BCard,
  type Battle,
  type Foe,
  type Input,
  type RunState,
  type SimEvent,
  type StatusId,
} from '../game/rules';
import { BOSS_ATK_FRAME, FRAME, FX_ARTS, HERO_ATTACK, HERO_FRAME, HERO_STAND, INTENT_FRAME, STATUS_ART, ST_CELL, ST_FULL, artUrl, fxForCard, hasArt } from '../art';
import { COLOR, FONT, css } from '../theme';
import { DESC_BOX, DESC_LINE, fitDesc } from '../ui/fit';

/** 글자 외곽선 (art.ts txt 와 같은 색) */
const INK = '#2a1a10';
import { KIND_COLOR, RARITY_RING, STATUS_COLOR, STATUS_SHORT, drawFoe, drawHero, drawIntent, drawKindGlyph, txt } from './art';

/** 보스 단계 특성 설명 (요괴를 누르면) */
const PASSIVE_HELP: Record<string, string> = {
  cloneShield: '분신이 있으면 받는 피해 -50%',
  revive: '쓰러지면 한 번 체력 30%로 부활 (화상이면 못 함)',
  scorch: '내 화상 피해 2배 · 젖음을 걸면 내 화상이 줄어듦',
  execute: '내 체력 30% 이하면 주는 피해 2배',
};

export const W = 430;
export const H = 860;
const CARD_W = 100;
const CARD_H = 139;
const HAND_Y = 772;
const HERO_Y = 470;
const FOE_Y = 250;
const ROW_Y = 612;
const HERO_SIZE = 168;

export interface BattleHooks {
  run(): RunState;
  send(i: Input): ApplyResult | null;
  /** 전투가 끝나고 연출까지 끝남 */
  done(): void;
  /** 영웅 시트를 못 읽을 때 쓰는 공용 전신 그림 */
  heroUrl: string | null;
  sfx(name: string): void;
  /** 연습 전투(처음 하는 사람): 화살표 안내 + 건너뛰기 */
  tutorial?: { skip(): void };
  /** 처음 만난 의도·상태이상 말풍선 (기기 저장 — 본 것은 다시 안 보임). 없으면 말풍선 없음 */
  seen?: { has(key: string): boolean; add(key: string): void };
}

/** 처음 만나는 의도 아이콘 말풍선 */
const INTENT_TIP: Record<string, string> = {
  atk: '공격 의도: 숫자만큼 때려요 (×2 는 두 번)',
  def: '방어 의도: 요괴가 방어를 얻어요',
  buff: '강화 의도: 요괴가 힘을 키우거나 준비해요',
  debuff: '방해 의도: 나에게 상태이상이나 내림카드를 걸어요',
  unknown: '모름: 무엇을 할지 알 수 없어요 — 대비하세요',
};

type Body = Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;

interface FoeView {
  c: Phaser.GameObjects.Container;
  body: Body;
  /** 그림 이름 (없으면 코드 그림) */
  art: string | null;
  size: number;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  intent: Phaser.GameObjects.Container;
  st: Phaser.GameObjects.Container;
  r: number;
  x: number;
  y: number;
  /** 맞은 모습·공격 동작을 되돌리는 타이머 */
  back?: Phaser.Time.TimerEvent;
}

interface Disp {
  hp: number;
  block: number;
}

/** 그림을 정해진 크기 상자 안에 맞춤 */
function fit(img: Phaser.GameObjects.Image, size: number) {
  img.setScale(size / Math.max(img.frame.width, img.frame.height));
}

export class BattleScene extends Phaser.Scene {
  private hooks!: BattleHooks;
  private foeViews = new Map<number, FoeView>();
  private handViews: { card: BCard; c: Phaser.GameObjects.Container; x: number; y: number; rot: number }[] = [];
  private heroC!: Phaser.GameObjects.Container;
  private heroSprite: Phaser.GameObjects.Image | null = null;
  private heroSheet = false;
  private heroHp!: Phaser.GameObjects.Graphics;
  private heroHpText!: Phaser.GameObjects.Text;
  private heroSt!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private tip!: Phaser.GameObjects.Container;
  private busy = false;
  /** 달빛 구슬: 턴 끝에 손에 남길 카드를 고르는 중 */
  private keepPick = false;
  private selected: number | null = null;
  private potionSel: number | null = null;
  /** 끌기: 손가락 번호(pid)를 기억해 다른 손가락의 move/up 은 무시한다 */
  private drag: { uid: number; pid: number; sx: number; sy: number; moved: boolean } | null = null;
  private disp = { hero: { hp: 0, block: 0 } as Disp, foes: new Map<number, Disp>() };
  /** 지금 보여 주는 카드 효과 (play 사건에서 정함) */
  private cur: { fx: string; atk: boolean; seen: Set<number> } | null = null;
  /** 연습 전투 안내 (화살표·글) */
  private coach!: Phaser.GameObjects.Container;
  private coachIntro = false;
  /** 처음 만난 의도·상태이상 말풍선 */
  private bubble!: Phaser.GameObjects.Container;
  private bubbleKey: string | null = null;

  constructor() {
    super('battle');
  }

  init(data: { hooks: BattleHooks }) {
    this.hooks = data.hooks;
  }

  // ---------- 그림 읽기 ----------
  preload() {
    this.load.on('loaderror', () => null);
    const run = this.run();
    const b = this.battle();
    const img = (key: string) => {
      if (hasArt(key) && !this.textures.exists(key)) this.load.image(key, artUrl(key));
    };
    const sheet = (key: string, fw: number) => {
      if (hasArt(key) && !this.textures.exists(key)) this.load.spritesheet(key, artUrl(key), { frameWidth: fw, frameHeight: fw });
    };
    sheet(`hero-${run.hero}`, HERO_FRAME);
    if (this.hooks.heroUrl) this.load.image('hero-full', this.hooks.heroUrl);
    img(`cut-${run.hero}`);
    img(regionDef(run.map.region).bg);
    // 요괴: 지금 있는 것 + 불러낼 수 있는 것 (분신·병졸)
    const ids = new Set(b.foes.map((f) => f.id));
    for (const id of [...ids]) {
      const d = enemyDef(id);
      for (const ph of [d.phase1, d.phase2, d.phase3]) for (const ops of [...(ph?.moves ?? []).map((m) => m.ops), ph?.turnOps ?? []]) for (const o of ops) if (o.op === 'summon') ids.add(o.id);
    }
    for (const id of ids) {
      const d = enemyDef(id);
      img(d.art);
      img(`${d.art}-hit`);
      if (d.boss) sheet(`${d.art}-atk`, BOSS_ATK_FRAME);
    }
    for (const c of CARDS) img(c.art);
    for (const r of run.relics) img(relicDef(r).art);
    for (const p of POTIONS) img(p.art);
    for (const n of FX_ARTS) img(`fx-${n}`);
    for (const k of Object.values(STATUS_ART)) img(k);
    sheet('intent', 128);
    img('energy');
    img('card-frame');
    img('back');
  }

  create() {
    this.makeStatusIcons();
    this.drawBackdrop();
    this.ui = this.add.container(0, 0).setDepth(5);
    this.hud = this.add.container(0, 0).setDepth(6);
    this.tip = this.add.container(0, 0).setDepth(50);
    this.bubble = this.add.container(0, 0).setDepth(52);
    this.coach = this.add.container(0, 0).setDepth(55);
    this.makeHero();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!over.length) this.onEmptyTap(p);
    });
    this.syncDisp();
    this.render();
    const b = this.battle();
    if (b && b.turn === 1 && b.t.played === 0) void this.intro();
  }

  /** 전투 시작: 보스는 컷인, 그 밖에는 띠 */
  private async intro() {
    const b = this.battle();
    const boss = b.foes.find((f) => f.boss);
    if (b.kind === 'boss' && boss) {
      this.busy = true;
      const d = enemyDef(boss.id);
      this.hooks.sfx('turn');
      const hidden = !!d.grow;
      await this.cutin(d.art, undefined, hidden ? '숨은 최종보스' : '막 보스', d.name, hidden ? '공격카드를 쓸 때마다 힘이 세져요' : '', COLOR.pink);
      this.busy = false;
      this.drawUi();
      return;
    }
    this.banner(b.kind === 'elite' ? '정예 등장!' : '전투 시작!', b.kind === 'elite' ? COLOR.pink : COLOR.primary);
  }

  private run() {
    return this.hooks.run();
  }
  private battle(): Battle {
    return this.run().battle!;
  }

  /** 상태이상 그림: st-* 오토타일셋의 꽉 찬 칸을 동그랗게 잘라 작은 그림으로 */
  private makeStatusIcons() {
    for (const [id, key] of Object.entries(STATUS_ART)) {
      const out = `sti-${id}`;
      if (!this.textures.exists(key) || this.textures.exists(out)) continue;
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const t = this.textures.createCanvas(out, 48, 48);
      if (!t) continue;
      const ctx = t.getContext();
      ctx.save();
      ctx.beginPath();
      ctx.arc(24, 24, 24, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(src, (ST_FULL % 4) * ST_CELL, Math.floor(ST_FULL / 4) * ST_CELL, ST_CELL, ST_CELL, 0, 0, 48, 48);
      ctx.restore();
      t.refresh();
    }
  }

  // ---------- 배경 ----------
  private drawBackdrop() {
    const bg = regionDef(this.run().map.region).bg;
    const g = this.add.graphics();
    if (this.textures.exists(bg)) {
      // 지역 배경 (480×270) 을 위쪽 580 에 꽉 채움 — 가운데를 남기고 양옆을 자른다
      const img = this.add.image(W / 2, 290, bg).setDepth(-1);
      img.setScale(Math.max(W / img.width, 580 / img.height));
      g.fillStyle(COLOR.outline, 0.12);
      g.fillRect(0, 0, W, 580);
    } else {
      // 하늘 → 땅 (DESIGN: 하늘 그라데이션) + 대나무 (코드 그림)
      g.fillGradientStyle(COLOR.skyTop, COLOR.skyTop, COLOR.skyMid, COLOR.skyMid, 1);
      g.fillRect(0, 0, W, 330);
      g.fillGradientStyle(COLOR.skyMid, COLOR.skyMid, COLOR.skyBottom, COLOR.skyBottom, 1);
      g.fillRect(0, 330, W, 250);
      for (let i = 0; i < 9; i++) {
        const x = 10 + i * 52 + (i % 2) * 14;
        g.fillStyle(COLOR.win, 0.35 + (i % 3) * 0.1);
        g.fillRect(x, 70, 12, 420);
        g.fillStyle(COLOR.outline, 0.15);
        for (let k = 0; k < 6; k++) g.fillRect(x, 110 + k * 64, 12, 4);
      }
      g.fillStyle(COLOR.win, 1);
      g.fillRect(0, 520, W, 60);
      g.lineStyle(3, COLOR.outline, 1);
      g.lineBetween(0, 520, W, 520);
    }
    // 아래 손패 판
    g.fillStyle(COLOR.panel, 1);
    g.fillRoundedRect(-10, 578, W + 20, 300, 26);
    g.lineStyle(4, COLOR.outline, 1);
    g.strokeRoundedRect(-10, 578, W + 20, 300, 26);
  }

  // ---------- 영웅 ----------
  private makeHero() {
    const run = this.run();
    this.heroC = this.add.container(W / 2, HERO_Y).setDepth(3);
    const sh = this.add.graphics();
    sh.fillStyle(COLOR.outline, 0.25);
    sh.fillEllipse(0, 62, 110, 22);
    this.heroC.add(sh);
    const key = `hero-${run.hero}`;
    if (this.textures.exists(key)) {
      this.heroSheet = true;
      this.heroSprite = this.add.image(0, 0, key, HERO_STAND);
      this.heroSprite.setScale(HERO_SIZE / HERO_FRAME).setOrigin(0.5, 0.58);
      this.heroC.add(this.heroSprite);
    } else if (this.textures.exists('hero-full')) {
      const img = this.add.image(0, 10, 'hero-full');
      img.setScale(150 / Math.max(img.width, img.height)).setOrigin(0.5, 0.62);
      this.heroSprite = img;
      this.heroC.add(img);
    } else {
      const g = this.add.graphics();
      drawHero(g, 48);
      this.heroC.add(g);
    }
    this.heroHp = this.add.graphics().setDepth(4);
    this.heroHpText = txt(this, W / 2, 0, '', 14, COLOR.white, 3).setDepth(4);
    this.heroSt = this.add.container(0, 0).setDepth(4);
  }

  private drawHeroBar() {
    const run = this.run();
    const d = this.disp.hero;
    this.drawBar(this.heroHp, W / 2, 548, 150, d.hp, run.maxHp, d.block);
    this.heroHpText.setPosition(W / 2, 548).setText(`${Math.max(0, d.hp)}/${run.maxHp}`);
    this.heroSt.removeAll(true);
    this.statusRow(this.heroSt, W / 2, 570, this.battle().st, 0);
  }

  private drawBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, hp: number, max: number, block: number) {
    g.clear();
    const h = 16;
    g.fillStyle(COLOR.track, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 8);
    const f = Math.max(0, Math.min(1, hp / max));
    if (f > 0) {
      g.fillStyle(COLOR.lose, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, Math.max(10, w * f), h, 8);
    }
    g.lineStyle(3, block > 0 ? COLOR.teamA : COLOR.outline, 1);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 8);
    if (block > 0) {
      // 방어 방패 배지
      const bx = x - w / 2 - 6;
      g.fillStyle(COLOR.teamA, 1);
      g.lineStyle(3, COLOR.outline, 1);
      g.beginPath();
      g.moveTo(bx - 14, y - 14);
      g.lineTo(bx + 14, y - 14);
      g.lineTo(bx + 12, y + 4);
      g.lineTo(bx, y + 16);
      g.lineTo(bx - 12, y + 4);
      g.closePath();
      g.fillPath();
      g.strokePath();
      const t = txt(this, bx, y - 1, `${block}`, 14, COLOR.white, 3);
      // 막대 그림과 함께 지우려고 막대 안에 붙인다
      t.setDepth(g.depth + 1);
      (g as unknown as { _labels?: Phaser.GameObjects.Text[] })._labels ??= [];
      (g as unknown as { _labels: Phaser.GameObjects.Text[] })._labels.push(t);
    }
  }

  private clearBarLabels(g: Phaser.GameObjects.Graphics) {
    const l = (g as unknown as { _labels?: Phaser.GameObjects.Text[] })._labels;
    if (l) for (const t of l.splice(0)) t.destroy();
  }

  private statusRow(c: Phaser.GameObjects.Container, x: number, y: number, st: Partial<Record<StatusId, number>>, str: number, dodge = 0, dark = false) {
    const items: [StatusId | 'str', number][] = (Object.entries(st) as [StatusId, number][]).filter(([, n]) => n > 0);
    if (str) items.push(['str', str]);
    const all: { id: string; label: string; n: number; color: number }[] = items.map(([id, n]) => ({ id, label: STATUS_SHORT[id], n, color: STATUS_COLOR[id] }));
    if (dodge) all.push({ id: 'dodge', label: '숨', n: dodge, color: COLOR.skyDeep });
    if (dark) all.push({ id: 'dark', label: '흑', n: 0, color: COLOR.outline });
    const gap = 30;
    let sx = x - ((all.length - 1) * gap) / 2;
    for (const it of all) {
      const g = this.add.graphics();
      g.fillStyle(it.color, 1);
      g.lineStyle(2, COLOR.outline, 1);
      g.fillCircle(sx, y, 12);
      c.add(g);
      const key = `sti-${it.id}`;
      if (this.textures.exists(key)) c.add(this.add.image(sx, y, key).setDisplaySize(24, 24));
      else c.add(txt(this, sx, y, it.label, 12, COLOR.white, 3));
      const ring = this.add.graphics();
      ring.lineStyle(2, COLOR.outline, 1);
      ring.strokeCircle(sx, y, 12);
      c.add(ring);
      if (it.n) c.add(txt(this, sx + 11, y + 9, `${it.n}`, 11, COLOR.white, 3));
      sx += gap;
    }
  }

  // ---------- 요괴 ----------
  private layoutFoes(foes: Foe[]) {
    const n = foes.length;
    const big = foes.filter((f) => !f.minion);
    const out = new Map<number, { x: number; y: number; r: number }>();
    if (n === 0) return out;
    const radius = (f: Foe) => (enemyDef(f.id).grow ? 80 : f.boss || f.elite ? (n > 2 ? 50 : 60) : f.minion ? 28 : n >= 3 ? 36 : 42);
    // 보스를 가운데, 분신은 양옆
    const order = [...foes];
    if (big.length === 1 && n > 1) {
      order.splice(order.indexOf(big[0]), 1);
      order.splice(Math.floor(order.length / 2), 0, big[0]);
    }
    const widths = order.map((f) => radius(f) * 2 + 14);
    const total = widths.reduce((a, b) => a + b, 0);
    const scale = Math.min(1, (W - 20) / total);
    let x = W / 2 - (total * scale) / 2;
    order.forEach((f, i) => {
      const w = widths[i] * scale;
      const r = radius(f) * Math.min(1, scale + 0.15);
      // 어둑시니는 커지므로 조금 위에 (아래쪽 이름·체력이 영웅에 겹치지 않게)
      const lift = enemyDef(f.id).grow ? -30 : 0;
      out.set(f.uid, { x: x + w / 2, y: FOE_Y + lift + (f.minion ? 18 : 0) + (i % 2 && n > 3 ? 14 : 0), r });
      x += w;
    });
    return out;
  }

  private syncFoes() {
    const b = this.battle();
    const alive = aliveFoes(b);
    const lay = this.layoutFoes(alive);
    for (const [uid, v] of this.foeViews) {
      if (!lay.has(uid)) {
        v.c.destroy();
        this.clearBarLabels(v.hpBar);
        this.foeViews.delete(uid);
      }
    }
    for (const f of alive) {
      const p = lay.get(f.uid)!;
      let v = this.foeViews.get(f.uid);
      if (!v || Math.abs(v.r - p.r) > 0.5) {
        if (v) {
          this.clearBarLabels(v.hpBar);
          v.c.destroy();
        }
        v = this.makeFoe(f, p.x, p.y, p.r);
        this.foeViews.set(f.uid, v);
      }
      v.x = p.x;
      v.y = p.y;
      v.c.setPosition(p.x, p.y);
      this.updateFoe(f, v);
    }
  }

  private makeFoe(f: Foe, x: number, y: number, r: number): FoeView {
    const c = this.add.container(x, y).setDepth(2);
    const d = enemyDef(f.id);
    const big = !!(f.boss || f.elite);
    // 어둑시니: 단계마다 그림이 커진다 (230 → 262 → 296), 발밑을 맞춰 위로 자란다
    const size = d.grow ? d.grow[f.phase - 1] : r * (big ? 2.7 : 2.5);
    let body: Body;
    let art: string | null = null;
    if (this.textures.exists(d.art)) {
      art = d.art;
      const sh = this.add.graphics();
      sh.fillStyle(COLOR.outline, 0.25);
      sh.fillEllipse(0, r * 0.95, r * 1.7, r * 0.4);
      c.add(sh);
      const img = this.add.image(0, d.grow ? r - size * 0.45 : 0, d.art);
      fit(img, size);
      if (f.dark) img.setTint(COLOR.outline);
      body = img;
    } else {
      const g = this.add.graphics();
      drawFoe(g, f.id, r, big);
      body = g;
    }
    c.add(body);
    const name = txt(this, 0, r + 12, d.name + (f.elite ? ' (정예)' : ''), 13, COLOR.white, 3);
    c.add(name);
    const hpBar = this.add.graphics();
    c.add(hpBar);
    const hpText = txt(this, 0, r + 32, '', 12, COLOR.white, 3);
    c.add(hpText);
    const st = this.add.container(0, 0);
    c.add(st);
    const intent = this.add.container(0, -r - 30);
    c.add(intent);
    const hit = this.add.zone(0, 0, r * 2 + 10, r * 2 + 40).setInteractive();
    hit.on('pointerdown', () => this.onFoeTap(f.uid));
    c.add(hit);
    return { c, body, art, size, hpBar, hpText, name, intent, st, r, x, y };
  }

  /** 의도 그림 하나 (새 그림 intent 시트 · 못 읽으면 코드 그림) */
  private intentIcon(kind: string, x: number, size: number): Phaser.GameObjects.GameObject {
    if (this.textures.exists('intent')) return this.add.image(x, 0, 'intent', INTENT_FRAME[kind] ?? 4).setDisplaySize(size, size);
    const g = this.add.graphics();
    g.setPosition(x, 0);
    drawIntent(g, kind as 'atk', size);
    return g;
  }

  private updateFoe(f: Foe, v: FoeView) {
    const d = this.disp.foes.get(f.uid) ?? { hp: f.hp, block: f.block };
    this.clearBarLabels(v.hpBar);
    this.drawBar(v.hpBar, 0, v.r + 32, Math.max(70, v.r * 1.9), d.hp, f.maxHp, d.block);
    // 막대 위 방어 숫자는 컨테이너 밖에 생기므로 위치를 옮긴다
    const labels = (v.hpBar as unknown as { _labels?: Phaser.GameObjects.Text[] })._labels ?? [];
    for (const t of labels) {
      v.c.add(t);
    }
    v.hpText.setText(`${Math.max(0, d.hp)}/${f.maxHp}`).setPosition(0, v.r + 32);
    v.st.removeAll(true);
    this.statusRow(v.st, 0, v.r + 56, f.st, f.str, f.dodge, !!f.dark);
    v.intent.removeAll(true);
    if (f.stun && !f.dead) {
      // 시간 멈춤: 다음 행동을 건너뜀
      v.intent.add(txt(this, 0, 0, '멈춤', 18, COLOR.skyDeep, 4));
      return;
    }
    if (f.intent && !f.dead) {
      const m = moveDef(enemyDef(f.id), f.phase, f.intent);
      v.intent.add(this.intentIcon(m.intent, 0, 34));
      // 공격 숫자: 매 턴 행동(업보 등) + 이번 행동, 힘·약화·젖음·저승사자 2배 반영
      const hits = foeHits(this.run(), this.battle(), f);
      if (hits.length) {
        const s = hits.map((h) => `${h.n}${h.times > 1 ? `×${h.times}` : ''}`).join('+');
        v.intent.add(txt(this, 20, 6, s, 18, COLOR.white, 4).setOrigin(0, 0.5));
      }
      // 이무기 승천 예고: 취소까지 남은 피해
      if (f.charge != null) v.intent.add(txt(this, 0, -26, `${f.charge} 더 때리면 취소!`, 13, COLOR.primary, 3));
      if (m.ops.some((o) => o.op === 'status' || o.op === 'curse' || o.op === 'discardNext') && m.intent === 'atk') {
        v.intent.add(this.intentIcon('debuff', -26, 20));
      }
      // 냄새 추적: 그다음 행동까지
      if (f.next) {
        const n2 = moveDef(enemyDef(f.id), f.phase, f.next);
        const ox = m.intent === 'atk' ? 62 : 30;
        v.intent.add(txt(this, ox, 2, '→', 14, COLOR.white, 3));
        const ic = this.intentIcon(n2.intent, ox + 18, 24) as Phaser.GameObjects.Image;
        ic.setAlpha(0.85);
        v.intent.add(ic);
      }
    }
  }

  // ---------- 손패 ----------
  private cardView(card: BCard | { uid: number; id: string; up?: boolean }, x: number, y: number, playable: boolean, cost: number) {
    const d = cardDef(card.id);
    const c = this.add.container(x, y);
    const w = CARD_W;
    const h = CARD_H;
    const L = -w / 2;
    const T = -h / 2;
    const name = cardName(card.id, card.up);
    if (this.textures.exists('card-frame')) {
      const s = w / FRAME.w;
      const P = FRAME.pic;
      const g = this.add.graphics();
      g.fillStyle(COLOR.outline, 1);
      g.fillRoundedRect(L + 2, T + 4, w - 4, h - 2, 10);
      g.fillStyle(COLOR.panel, 1);
      g.fillRect(L + P.x * s, T + P.y * s, P.w * s, P.h * s);
      g.fillStyle(KIND_COLOR[d.kind], 0.22);
      g.fillRect(L + P.x * s, T + P.y * s, P.w * s, P.h * s);
      c.add(g);
      const px = L + (P.x + P.w / 2) * s;
      const py = T + (P.y + P.h / 2) * s;
      if (this.textures.exists(d.art)) {
        const img = this.add.image(px, py, d.art);
        img.setScale(Math.min((P.w * s * 0.82) / img.width, (P.h * s * 0.86) / img.height));
        c.add(img);
      } else {
        const glyph = this.add.graphics();
        glyph.setPosition(px, py);
        drawKindGlyph(glyph, d.kind, 30);
        c.add(glyph);
      }
      // 틀 (그림 칸은 투명) — 종류색을 곱해 입힌다
      c.add(this.add.image(0, 0, 'card-frame').setScale(s).setTint(KIND_COLOR[d.kind]));
      const g2 = this.add.graphics();
      const D = FRAME.desc;
      g2.fillStyle(COLOR.white, 1);
      g2.fillRoundedRect(L + (D.x + 5) * s, T + (D.y + 5) * s, (D.w - 10) * s, (D.h - 10) * s, 6);
      // 등급 테두리
      g2.lineStyle(3, RARITY_RING[d.rarity] ?? COLOR.white, 1);
      g2.strokeRoundedRect(L + 1, T + 1, w - 2, h - 2, 9);
      c.add(g2);
      const cx = L + FRAME.cost.x * s;
      const cy = T + FRAME.cost.y * s;
      if (this.textures.exists('energy')) c.add(this.add.image(cx, cy, 'energy').setDisplaySize(26, 26));
      c.add(txt(this, cx, cy, `${cost}`, 15, cost < cardDef(card.id).cost ? COLOR.win : COLOR.white, 3));
      c.add(txt(this, 0, T + FRAME.name.y * s - 1, name, name.length > 5 ? 11 : 13, card.up ? COLOR.primaryLight : COLOR.white, 3));
      c.add(this.descText(cardText(card.id, card.up), T + (D.y + D.h / 2) * s));
    } else {
      const g = this.add.graphics();
      g.fillStyle(COLOR.outline, 1);
      g.fillRoundedRect(L, T + 4, w, h, 12);
      g.fillStyle(KIND_COLOR[d.kind], 1);
      g.fillRoundedRect(L, T, w, h, 12);
      g.fillStyle(COLOR.panel, 1);
      g.fillRoundedRect(L + 6, T + 26, w - 12, h - 32, 8);
      g.lineStyle(3, COLOR.outline, 1);
      g.strokeRoundedRect(L, T, w, h, 12);
      g.lineStyle(2, RARITY_RING[d.rarity] ?? COLOR.white, 1);
      g.strokeRoundedRect(L + 3, T + 3, w - 6, h - 6, 10);
      c.add(g);
      if (this.textures.exists(d.art)) {
        const img = this.add.image(0, T + 50, d.art);
        img.setScale(Math.min(40 / img.width, 40 / img.height));
        c.add(img);
      } else {
        const glyph = this.add.graphics();
        glyph.setPosition(0, T + 50);
        glyph.fillStyle(KIND_COLOR[d.kind], 0.25);
        glyph.fillCircle(0, 0, 20);
        drawKindGlyph(glyph, d.kind, 30);
        c.add(glyph);
      }
      c.add(txt(this, 4, T + 13, name, name.length > 5 ? 12 : 14, COLOR.white, 3));
      c.add(this.add.text(0, 18, cardText(card.id, card.up), { fontFamily: FONT, fontSize: '11px', color: '#2a1a10', align: 'center', wordWrap: { width: w - 16, useAdvancedWrap: true } }).setOrigin(0.5, 0));
      const cg = this.add.graphics();
      cg.fillStyle(cost < cardDef(card.id).cost ? COLOR.win : COLOR.primary, 1);
      cg.lineStyle(3, COLOR.outline, 1);
      cg.fillCircle(L + 6, T + 6, 13);
      cg.strokeCircle(L + 6, T + 6, 13);
      c.add(cg);
      c.add(txt(this, L + 6, T + 6, `${cost}`, 16, COLOR.ink));
    }
    if (!playable) c.setAlpha(0.6);
    return c;
  }

  /**
   * 카드 설명: 칸(DESC_BOX.canvas)에 맞는 크기로 줄을 나눠 쓰고(ui/fit.ts), 실제로 그린 크기가 넘치면 더 줄인다.
   * 개발 확인: ?local=1 전투에서 window.__cardFit() — 카드 86장(+강화) 중 넘치는 것 목록.
   */
  private descText(text: string, y: number): Phaser.GameObjects.Text {
    const box = DESC_BOX.canvas;
    let f = fitDesc(text, box.w, box.h);
    const t = this.add.text(0, y, '', { fontFamily: FONT, fontSize: `${f.size}px`, color: '#2a1a10', align: 'center' }).setOrigin(0.5, 0.5);
    const set = () => {
      t.setFontSize(f.size);
      t.setLineSpacing(Math.round(f.size * DESC_LINE) - Math.ceil(f.size * 1.25));
      t.setText(f.lines.join('\n'));
    };
    set();
    for (let k = 0; k < 8 && (t.height > box.h + 2 || t.width > box.w + 2) && f.size > 6.5; k++) {
      const size = f.size - 0.5;
      f = { ...fitDesc(text, box.w, box.h, [size]), size };
      set();
    }
    return t;
  }

  /** 개발 확인용: 모든 카드(+강화)의 설명이 칸에 들어가는지 실제로 그려 본다 */
  fitReport(): string[] {
    const bad: string[] = [];
    const box = DESC_BOX.canvas;
    for (const d of CARDS) {
      for (const up of [false, true]) {
        const t = this.descText(cardText(d.id, up), -1000);
        if (t.height > box.h + 2 || t.width > box.w + 2) bad.push(`${d.name}${up ? '+' : ''} ${Math.round(t.width)}×${Math.round(t.height)} @${t.style.fontSize}`);
        t.destroy();
      }
    }
    return bad;
  }

  private layoutHand() {
    for (const v of this.handViews) v.c.destroy();
    this.handViews = [];
    const run = this.run();
    const b = this.battle();
    const n = b.hand.length;
    const span = Math.min(78, n > 1 ? 320 / (n - 1) : 0);
    b.hand.forEach((card, i) => {
      const off = i - (n - 1) / 2;
      const x = W / 2 + off * span;
      const y = HAND_Y + Math.abs(off) * Math.abs(off) * 2.2;
      const rot = off * 0.05;
      const cost = playCost(run, b, card);
      const playable = !b.over && (b.pending || this.keepPick ? true : cost <= b.energy);
      const c = this.cardView(card, x, y, playable, cost);
      c.setRotation(rot).setDepth(10 + i);
      const zone = this.add.zone(0, 0, CARD_W, CARD_H).setInteractive();
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => this.onCardDown(card.uid, p));
      c.add(zone);
      this.handViews.push({ card, c, x, y, rot });
    });
    this.highlightSel();
  }

  private highlightSel() {
    for (const v of this.handViews) {
      const sel = v.card.uid === this.selected;
      v.c.setPosition(v.x, sel ? v.y - 40 : v.y).setRotation(sel ? 0 : v.rot).setScale(sel ? 1.12 : 1).setDepth(sel ? 40 : 10 + this.handViews.indexOf(v));
    }
    for (const [, v] of this.foeViews) {
      const need = (this.selected !== null && this.selectedNeedsTarget()) || (this.potionSel !== null && this.potionNeedsTarget());
      v.c.setScale(need ? 1.05 : 1);
    }
  }

  private selectedNeedsTarget() {
    const c = this.battle().hand.find((x) => x.uid === this.selected);
    return !!c && cardDef(c.id).target === 'enemy';
  }
  private potionNeedsTarget() {
    const id = this.run().potions[this.potionSel ?? -1];
    return !!id && potionDef(id).target === 'enemy';
  }

  // ---------- 아래 줄 · 위 줄 ----------
  private drawUi() {
    this.ui.removeAll(true);
    const run = this.run();
    const b = this.battle();
    // 기력 구슬 (새 그림 energy · 못 읽으면 코드 그림)
    if (this.textures.exists('energy')) {
      this.ui.add(this.add.image(50, ROW_Y, 'energy').setDisplaySize(68, 68));
    } else {
      const g = this.add.graphics();
      g.fillStyle(COLOR.outline, 1);
      g.fillCircle(50, ROW_Y + 4, 30);
      g.fillStyle(COLOR.primary, 1);
      g.fillCircle(50, ROW_Y, 30);
      g.fillStyle(COLOR.primaryLight, 1);
      g.fillCircle(42, ROW_Y - 9, 10);
      g.lineStyle(3, COLOR.outline, 1);
      g.strokeCircle(50, ROW_Y, 30);
      this.ui.add(g);
    }
    this.ui.add(txt(this, 50, ROW_Y, `${b.energy}`, 28, COLOR.white, 5));
    this.ui.add(txt(this, 50, ROW_Y + 42, '기력', 12, COLOR.inkSoft));
    // 더미
    this.pile(124, b.draw.length, '뽑을 더미', true, () => this.showPile('뽑을 더미 (순서는 비밀)', [...b.draw].sort((x, y) => x.id.localeCompare(y.id))));
    this.pile(262, b.discard.length, '버린 더미', false, () => this.showPile('버린 더미', b.discard));
    // 턴 끝
    const bx = 362;
    const bt = this.add.container(bx, ROW_Y);
    const bg = this.add.graphics();
    const on = !b.over && !this.busy && !b.pending;
    bg.fillStyle(COLOR.outline, 1);
    bg.fillRoundedRect(-56, -22 + 4, 112, 46, 16);
    bg.fillStyle(on ? COLOR.primary : COLOR.track, 1);
    bg.fillRoundedRect(-56, -22, 112, 46, 16);
    bg.lineStyle(3, COLOR.outline, 1);
    bg.strokeRoundedRect(-56, -22, 112, 46, 16);
    bt.add(bg);
    bt.add(txt(this, 0, 1, this.keepPick ? '안 남기고 끝' : '턴 끝', this.keepPick ? 15 : 20, COLOR.ink));
    const z = this.add.zone(0, 0, 112, 50).setInteractive({ useHandCursor: true });
    z.on('pointerdown', () => this.endTurn());
    bt.add(z);
    this.ui.add(bt);
    // 손패에서 고르기 (쥐구멍·분신술)
    if ((b.pending || this.keepPick) && !b.over) {
      const msg = this.keepPick ? '달빛 구슬: 손에 남길 카드를 누르세요' : b.pending!.kind === 'discard' ? '버릴 카드를 눌러 고르세요' : '복사할 카드를 눌러 고르세요';
      const t = txt(this, W / 2, 668, msg, 16, COLOR.white, 4);
      const pg = this.add.graphics();
      pg.fillStyle(COLOR.pink, 1);
      pg.lineStyle(3, COLOR.outline, 1);
      pg.fillRoundedRect(W / 2 - t.width / 2 - 14, 652, t.width + 28, 32, 16);
      pg.strokeRoundedRect(W / 2 - t.width / 2 - 14, 652, t.width + 28, 32, 16);
      this.ui.add([pg, t]);
    }
    // 위 줄: 물약 · 부적 · 엽전
    this.hud.removeAll(true);
    const top = this.add.graphics();
    top.fillStyle(COLOR.outline, 0.35);
    top.fillRoundedRect(8, 8, W - 16, 44, 14);
    this.hud.add(top);
    for (let i = 0; i < 3; i++) {
      const x = 32 + i * 42;
      const pg = this.add.graphics();
      const id = run.potions[i];
      pg.fillStyle(id ? COLOR.white : COLOR.track, 1);
      pg.lineStyle(3, this.potionSel === i ? COLOR.primary : COLOR.outline, 1);
      pg.fillCircle(x, 30, 16);
      pg.strokeCircle(x, 30, 16);
      this.hud.add(pg);
      if (id) {
        const art = potionDef(id).art;
        if (this.textures.exists(art)) this.hud.add(this.add.image(x, 30, art).setDisplaySize(24, 24));
        else {
          const pc = this.add.graphics();
          pc.fillStyle(id === 'heal' ? COLOR.lose : id === 'block' ? COLOR.teamA : id === 'energy' ? COLOR.primary : id === 'fire' ? COLOR.accent : COLOR.win, 1);
          pc.fillCircle(x, 33, 9);
          this.hud.add(pc);
        }
        const pz = this.add.zone(x, 30, 38, 40).setInteractive({ useHandCursor: true });
        pz.on('pointerdown', () => this.onPotion(i));
        this.hud.add(pz);
      }
    }
    // 부적
    const rel = run.relics;
    rel.slice(0, 7).forEach((id, i) => {
      const x = 170 + i * 26;
      const r = relicDef(id);
      const rg = this.add.graphics();
      rg.fillStyle(this.textures.exists(r.art) ? COLOR.white : COLOR.primary, 1);
      rg.lineStyle(2, COLOR.outline, 1);
      rg.fillCircle(x, 30, 11);
      rg.strokeCircle(x, 30, 11);
      this.hud.add(rg);
      if (this.textures.exists(r.art)) this.hud.add(this.add.image(x, 30, r.art).setDisplaySize(18, 18));
      else this.hud.add(txt(this, x, 30, r.name.slice(0, 1), 11, COLOR.ink));
      const rz = this.add.zone(x, 30, 24, 30).setInteractive();
      rz.on('pointerdown', () => this.showTip(`${r.name}: ${r.text}`));
      this.hud.add(rz);
    });
    if (rel.length > 7) this.hud.add(txt(this, 170 + 7 * 26, 30, `+${rel.length - 7}`, 12, COLOR.white, 3));
    this.hud.add(txt(this, W - 46, 30, `엽전 ${run.gold}`, 15, COLOR.primary, 3));
    this.hud.add(txt(this, W / 2, 72, `${b.turn}턴`, 14, COLOR.white, 3));
  }

  private pile(x: number, n: number, label: string, back: boolean, onTap: () => void) {
    if (back && this.textures.exists('back')) {
      for (let k = 2; k >= 0; k--) this.ui.add(this.add.image(x + k * 3, ROW_Y - k * 3, 'back').setDisplaySize(36, 50));
    } else {
      const g = this.add.graphics();
      for (let k = 2; k >= 0; k--) {
        g.fillStyle(k ? COLOR.lineSoft : COLOR.white, 1);
        g.lineStyle(2, COLOR.outline, 1);
        g.fillRoundedRect(x - 18 + k * 3, ROW_Y - 24 - k * 3, 36, 48, 6);
        g.strokeRoundedRect(x - 18 + k * 3, ROW_Y - 24 - k * 3, 36, 48, 6);
      }
      this.ui.add(g);
    }
    this.ui.add(txt(this, x, ROW_Y, `${n}`, 18, back ? COLOR.white : COLOR.ink, back ? 4 : 0));
    this.ui.add(txt(this, x, ROW_Y + 42, label, 12, COLOR.inkSoft));
    const z = this.add.zone(x, ROW_Y, 50, 60).setInteractive({ useHandCursor: true });
    z.on('pointerdown', () => !this.busy && onTap());
    this.ui.add(z);
  }

  private showPile(title: string, cards: BCard[]) {
    this.tip.removeAll(true);
    const g = this.add.graphics();
    g.fillStyle(COLOR.outline, 0.55);
    g.fillRect(0, 0, W, H);
    g.setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
    g.on('pointerdown', () => this.tip.removeAll(true));
    this.tip.add(g);
    this.tip.add(txt(this, W / 2, 60, `${title} · ${cards.length}장`, 20, COLOR.white, 4));
    const per = 4;
    cards.forEach((c, i) => {
      const x = 60 + (i % per) * 104;
      const y = 150 + Math.floor(i / per) * 146;
      const v = this.cardView(c, x, y, true, cardDef(c.id).cost);
      v.setScale(0.95);
      this.tip.add(v);
    });
    if (!cards.length) this.tip.add(txt(this, W / 2, 200, '비어 있어요', 18, COLOR.white, 3));
    this.tip.add(txt(this, W / 2, H - 40, '아무 곳이나 누르면 닫혀요', 14, COLOR.white, 3));
  }

  private showTip(s: string) {
    this.tip.removeAll(true);
    const t = this.add.text(W / 2, 108, s, { fontFamily: FONT, fontSize: '14px', color: '#ffffff', align: 'center', wordWrap: { width: W - 60 } }).setOrigin(0.5, 0);
    const g = this.add.graphics();
    g.fillStyle(COLOR.outline, 0.9);
    g.fillRoundedRect(W / 2 - t.width / 2 - 12, 100, t.width + 24, t.height + 16, 12);
    this.tip.add(g);
    this.tip.add(t);
    this.time.delayedCall(2600, () => this.tip.removeAll(true));
  }

  // ---------- 그리기 ----------
  private syncDisp() {
    const run = this.run();
    const b = this.battle();
    this.disp.hero = { hp: run.hp, block: b.block };
    this.disp.foes.clear();
    for (const f of b.foes) this.disp.foes.set(f.uid, { hp: f.hp, block: f.block });
  }

  render() {
    this.syncDisp();
    this.clearBarLabels(this.heroHp);
    this.drawHeroBar();
    this.syncFoes();
    this.layoutHand();
    this.drawUi();
    if (this.hooks.tutorial) this.drawCoach();
    else this.nextBubble();
  }

  // ---------- 연습 전투 안내 ----------
  /** 지금 상태에 맞는 안내 하나: 의도 설명 → 공격 끌어 놓기 → 막기 → (남은 기력) → 턴 끝 → 2턴 마무리 */
  private drawCoach() {
    this.coach.removeAll(true);
    const b = this.battle();
    if (b.over || this.busy) return;
    const run = this.run();
    const foe = aliveFoes(b)[0];
    const fv = foe ? this.foeViews.get(foe.uid) : undefined;
    const playable = (kind?: string, id?: string) =>
      this.handViews.find((h) => playCost(run, b, h.card) <= b.energy && (!kind || cardDef(h.card.id).kind === kind) && (!id || h.card.id === id));
    let text: string;
    let at: { x: number; y: number } | null = null;
    let next = false;
    const cardAt = (h: { x: number; y: number }) => ({ x: h.x, y: h.y - CARD_H / 2 - 8 });
    if (!this.coachIntro && fv) {
      text = '요괴 머리 위 그림은 다음 행동(의도)이에요.\n칼 그림 + 숫자 = 그만큼 공격해요.';
      at = { x: fv.x, y: fv.y - fv.r - 52 };
      next = true;
    } else if (b.turn === 1 && b.t.attacks === 0 && playable('atk')) {
      text = '공격 카드를 요괴 위로 끌어 놓으세요.\n(카드를 누르고 요괴를 눌러도 돼요)';
      at = cardAt(playable('atk')!);
    } else if (b.turn === 1 && b.block === 0 && playable('def')) {
      text = '막기 카드는 위쪽으로 끌어 올려요.\n방어는 이번 턴 받는 피해를 먼저 막아요.';
      at = cardAt(playable('def')!);
    } else if (b.turn >= 2 && playable(undefined, 'tigerClaw')) {
      text = '기력 2짜리 호랑이 발톱(4×3)으로 마무리해요!';
      at = cardAt(playable(undefined, 'tigerClaw')!);
    } else if (playable()) {
      text = '남은 기력(왼쪽 아래 구슬)으로 카드를 더 써요.';
      at = cardAt(playable('atk') ?? playable()!);
    } else {
      text = '기력을 다 썼어요. 턴 끝을 누르면 요괴가 행동해요.\n남은 손패는 버려지고, 다음 턴에 5장을 새로 뽑아요.';
      at = { x: 362, y: ROW_Y - 34 };
    }
    // 글 상자 (요괴 아래 · 영웅 머리 위 — 요괴 의도와 손패를 가리지 않게)
    const BY = 368;
    const t = this.add.text(W / 2, BY + 8, text, { fontFamily: FONT, fontSize: '15px', color: css(COLOR.ink), align: 'center', wordWrap: { width: W - 70 }, lineSpacing: 4 }).setOrigin(0.5, 0);
    const bh = t.height + (next ? 56 : 22);
    const g = this.add.graphics();
    g.fillStyle(COLOR.outline, 1);
    g.fillRoundedRect(22, BY + 4, W - 44, bh, 16);
    g.fillStyle(COLOR.white, 1);
    g.fillRoundedRect(22, BY, W - 44, bh, 16);
    g.lineStyle(3, COLOR.outline, 1);
    g.strokeRoundedRect(22, BY, W - 44, bh, 16);
    this.coach.add([g, t]);
    if (next) {
      const by = BY + bh - 26;
      const btn = this.add.graphics();
      btn.fillStyle(COLOR.primary, 1);
      btn.lineStyle(3, COLOR.outline, 1);
      btn.fillRoundedRect(W / 2 - 56, by - 16, 112, 32, 14);
      btn.strokeRoundedRect(W / 2 - 56, by - 16, 112, 32, 14);
      const z = this.add.zone(W / 2, by, 120, 40).setInteractive({ useHandCursor: true });
      z.on('pointerdown', () => {
        this.hooks.sfx('click');
        this.coachIntro = true;
        this.drawCoach();
      });
      this.coach.add([btn, txt(this, W / 2, by, '알겠어요', 15, COLOR.ink), z]);
    }
    // 화살표 (아래를 가리키며 통통)
    if (at) {
      const a = this.add.container(at.x, at.y);
      const ag = this.add.graphics();
      ag.fillStyle(COLOR.outline, 1);
      ag.fillTriangle(-17, -26, 17, -26, 0, 4);
      ag.fillRect(-8, -50, 16, 26);
      ag.fillStyle(COLOR.pink, 1);
      ag.fillTriangle(-13, -24, 13, -24, 0, -1);
      ag.fillRect(-5, -47, 10, 24);
      a.add(ag);
      this.coach.add(a);
      this.tweens.add({ targets: a, y: at.y - 12, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    // 건너뛰기
    const sk = this.add.container(W - 62, 76);
    const sg = this.add.graphics();
    sg.fillStyle(COLOR.outline, 0.7);
    sg.fillRoundedRect(-50, -14, 100, 28, 14);
    sk.add([sg, txt(this, 0, 0, '건너뛰기 ▶', 13, COLOR.white, 3)]);
    const sz = this.add.zone(0, 0, 104, 34).setInteractive({ useHandCursor: true });
    sz.on('pointerdown', () => {
      this.hooks.sfx('click');
      this.hooks.tutorial?.skip();
    });
    sk.add(sz);
    this.coach.add(sk);
  }

  // ---------- 처음 만난 의도·상태이상 말풍선 ----------
  /** 화면에 보이는 것 중 아직 안 본 의도·상태이상 하나에 말풍선 (본 것은 기기에 저장) */
  private nextBubble() {
    const seen = this.hooks.seen;
    if (!seen || this.busy || this.bubbleKey) return;
    const b = this.battle();
    if (b.over) return;
    const list: { key: string; text: string; x: number; y: number; below: boolean }[] = [];
    for (const f of aliveFoes(b)) {
      const v = this.foeViews.get(f.uid);
      if (!v) continue;
      if (f.intent && !f.stun) {
        const m = moveDef(enemyDef(f.id), f.phase, f.intent);
        list.push({ key: `intent:${m.intent}`, text: INTENT_TIP[m.intent] ?? '', x: v.x, y: v.y - v.r - 48, below: false });
      }
      for (const [id, n] of Object.entries(f.st) as [StatusId, number][])
        if (n > 0) list.push({ key: `st:${id}`, text: `${STATUS_NAME[id]}: ${STATUS_HELP[id]}`, x: v.x, y: v.y + v.r + 72, below: true });
      if (f.str) list.push({ key: 'st:str', text: `힘: 요괴의 ${STATUS_HELP.str}`, x: v.x, y: v.y + v.r + 72, below: true });
    }
    for (const [id, n] of Object.entries(b.st) as [StatusId, number][])
      if (n > 0) list.push({ key: `st:${id}`, text: `${STATUS_NAME[id]}: ${STATUS_HELP[id]}`, x: W / 2, y: 552, below: false });
    const it = list.find((x) => x.text && !seen.has(x.key));
    if (!it) return;
    seen.add(it.key);
    this.bubbleKey = it.key;
    this.showBubble(it.text, it.x, it.y, it.below);
  }

  private showBubble(text: string, x: number, y: number, below: boolean) {
    this.bubble.removeAll(true);
    const t = this.add.text(0, 0, text, { fontFamily: FONT, fontSize: '14px', color: css(COLOR.ink), align: 'center', wordWrap: { width: 230 }, lineSpacing: 3 }).setOrigin(0.5);
    const w = t.width + 24;
    const h = t.height + 18;
    const cx = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, x));
    const cy = below ? y + h / 2 + 10 : y - h / 2 - 10;
    const c = this.add.container(cx, cy);
    const g = this.add.graphics();
    const tx = Math.max(-w / 2 + 16, Math.min(w / 2 - 16, x - cx));
    g.fillStyle(COLOR.outline, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + 3, w, h, 12);
    g.fillStyle(COLOR.primaryLight, 1);
    g.lineStyle(3, COLOR.outline, 1);
    // 꼬리 (가리키는 쪽)
    if (below) g.fillTriangle(tx - 9, -h / 2 + 1, tx + 9, -h / 2 + 1, tx, -h / 2 - 10);
    else g.fillTriangle(tx - 9, h / 2 - 1, tx + 9, h / 2 - 1, tx, h / 2 + 10);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    c.add([g, t, txt(this, w / 2 - 10, -h / 2 + 2, '처음!', 10, COLOR.pink, 3)]);
    this.bubble.add(c);
    c.setScale(0.6);
    this.tweens.add({ targets: c, scale: 1, duration: 160, ease: 'Back.easeOut' });
    const close = () => {
      if (!this.bubbleKey) return;
      this.bubbleKey = null;
      this.tweens.add({ targets: c, alpha: 0, duration: 180, onComplete: () => c.destroy() });
      this.time.delayedCall(220, () => this.nextBubble());
    };
    const z = this.add.zone(0, 0, w, h).setInteractive();
    z.on('pointerdown', close);
    c.add(z);
    this.time.delayedCall(3600, close);
  }

  // ---------- 입력 ----------
  private onCardDown(uid: number, p: Phaser.Input.Pointer) {
    if (this.busy) return;
    // 다른 손가락이 아직 끌고 있으면 무시 (그 손가락이 이미 떨어졌으면 남은 끌기를 버리고 새로)
    const held = this.drag;
    if (held && held.pid !== p.id && this.input.manager.pointers.some((x) => x.id === held.pid && x.isDown)) return;
    this.potionSel = null;
    this.drag = { uid, pid: p.id, sx: p.x, sy: p.y, moved: false };
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (!this.drag || this.drag.pid !== p.id || !p.isDown || this.battle().pending || this.keepPick) return;
    const v = this.handViews.find((h) => h.card.uid === this.drag!.uid);
    if (!v) return;
    if (!this.drag.moved && Math.hypot(p.x - this.drag.sx, p.y - this.drag.sy) > 12) {
      this.drag.moved = true;
      this.selected = this.drag.uid;
      this.highlightSel();
    }
    if (this.drag.moved) {
      v.c.setPosition(p.x, p.y - 30).setRotation(0).setDepth(60).setScale(1);
      const tgt = this.selectedNeedsTarget() ? this.foeAt(p.x, p.y) : null;
      for (const [uid, fv] of this.foeViews) fv.c.setScale(uid === tgt ? 1.12 : 1);
    }
  }

  private onUp(p: Phaser.Input.Pointer) {
    const d = this.drag;
    if (!d || d.pid !== p.id) return;
    // 놓는 순간 먼저 비운다 — 같은 끌기로 카드가 두 번 쓰이지 않게
    this.drag = null;
    if (this.busy) return;
    // 달빛 구슬: 남길 카드 고르기 (탭) → 그 카드를 남기고 턴 끝
    if (this.keepPick) {
      if (!d.moved) this.finishTurn(d.uid);
      return;
    }
    // 쥐구멍·분신술: 손패 카드 고르기
    if (this.battle().pending) {
      if (!d.moved) this.send({ t: 'pick', uid: d.uid });
      return;
    }
    if (!d.moved) {
      // 탭: 고르기 / 이미 고른 카드를 다시 탭하면 쓰기
      if (this.selected === d.uid) {
        if (!this.selectedNeedsTarget()) this.play(d.uid);
        else {
          const alive = aliveFoes(this.battle());
          if (alive.length === 1) this.play(d.uid, alive[0].uid);
          else this.showTip('요괴를 눌러 대상을 고르세요');
        }
      } else {
        this.selected = d.uid;
        this.highlightSel();
      }
      return;
    }
    // 끌어 놓기
    if (this.selectedNeedsTarget()) {
      const t = this.foeAt(p.x, p.y);
      if (t !== null) return this.play(d.uid, t);
    } else if (p.y < 560) {
      return this.play(d.uid);
    }
    this.selected = null;
    this.highlightSel();
  }

  private onEmptyTap(p: Phaser.Input.Pointer) {
    if (this.busy) return;
    // 달빛 구슬 고르기를 그만둔다 (턴은 끝나지 않음)
    if (this.keepPick && p.y < 560) {
      this.keepPick = false;
      this.render();
      return;
    }
    if (p.y < 560 && (this.selected !== null || this.potionSel !== null)) {
      this.selected = null;
      this.potionSel = null;
      this.render();
    }
  }

  private foeAt(x: number, y: number): number | null {
    let best: number | null = null;
    let bd = Infinity;
    for (const [uid, v] of this.foeViews) {
      const dd = Math.hypot(x - v.x, y - v.y);
      if (dd < v.r + 40 && dd < bd) {
        bd = dd;
        best = uid;
      }
    }
    return best;
  }

  private onFoeTap(uid: number) {
    if (this.busy) return;
    if (this.selected !== null && this.selectedNeedsTarget()) return this.play(this.selected, uid);
    if (this.potionSel !== null && this.potionNeedsTarget()) return this.usePotion(this.potionSel, uid);
    const f = this.battle().foes.find((x) => x.uid === uid);
    if (!f) return;
    const d = enemyDef(f.id);
    const m = f.intent ? moveDef(d, f.phase, f.intent) : null;
    const nx = f.next ? moveDef(d, f.phase, f.next) : null;
    const st = (Object.entries(f.st) as [StatusId, number][]).map(([k, n]) => `${STATUS_NAME[k]}${n}: ${STATUS_HELP[k]}`);
    if (f.str) st.push(`힘${f.str}: ${STATUS_HELP.str}`);
    if (f.dodge) st.push(`숨기${f.dodge}: 다음 공격을 피함`);
    if (f.dark) st.push('어둠 속: 받는 피해 -75%, 화상을 걸면 풀림');
    if (f.charge != null) st.push(`승천 예고: 피해 ${f.charge} 더 주면 취소`);
    if (f.stun) st.push('시간 멈춤: 다음 행동을 건너뜀');
    const pas = PASSIVE_HELP[phaseOf(d, f.phase).passive ?? ''];
    if (pas) st.push(pas);
    if (d.rage) st.push(`내가 공격카드를 쓸 때마다 힘 +${d.rage}`);
    const line = `${d.name} — 다음 행동: ${m ? (m.intent === 'unknown' ? '알 수 없음' : m.name) : '-'}${nx ? ` → 그다음: ${nx.name}` : ''}`;
    this.showTip([line, ...st].join('\n'));
  }

  private onPotion(i: number) {
    if (this.busy || this.battle().pending) return;
    this.selected = null;
    this.keepPick = false;
    const id = this.run().potions[i];
    if (!id) return;
    const d = potionDef(id);
    if (this.potionSel === i) {
      if (d.target === 'none') return this.usePotion(i);
      const alive = aliveFoes(this.battle());
      if (alive.length === 1) return this.usePotion(i, alive[0].uid);
      return this.showTip('요괴를 눌러 대상을 고르세요');
    }
    this.potionSel = i;
    this.showTip(`${d.name}: ${d.text} — 한 번 더 누르면 사용`);
    this.render();
  }

  private play(uid: number, target?: number) {
    this.selected = null;
    this.send({ t: 'play', uid, target });
  }
  private usePotion(slot: number, target?: number) {
    this.potionSel = null;
    this.send({ t: 'potion', slot, target });
  }
  private endTurn() {
    const b = this.battle();
    if (this.busy || b.over) return;
    if (b.pending) return this.showTip('먼저 손패에서 카드를 고르세요');
    this.selected = null;
    this.potionSel = null;
    // 달빛 구슬: 손패가 있으면 남길 카드 1장 고르기 (턴 끝을 한 번 더 누르면 안 남김)
    if (!this.keepPick && b.hand.length && this.run().relics.includes('moonOrb')) {
      this.keepPick = true;
      this.render();
      return;
    }
    this.finishTurn();
  }
  private finishTurn(keep?: number) {
    this.keepPick = false;
    this.send(keep === undefined ? { t: 'end' } : { t: 'end', keep });
  }

  private send(i: Input) {
    // 연출 중에는 받지 않는다 (한 번의 손짓이 입력 여러 개가 되지 않게)
    if (this.busy) return;
    // 연출은 바뀌기 전 숫자에서 시작한다
    const before = { hero: { ...this.disp.hero }, foes: new Map(this.disp.foes) };
    const r = this.hooks.send(i);
    if (!r || !r.ok) {
      this.hooks.sfx('fold');
      if (i.t === 'play') {
        const c = this.battle().hand.find((x) => x.uid === i.uid);
        if (c && playCost(this.run(), this.battle(), c) > this.battle().energy) this.showTip('기력이 모자라요');
      }
      this.render();
      return;
    }
    this.disp.hero = before.hero;
    this.disp.foes = before.foes;
    void this.animate(r.ev);
  }

  // ---------- 연출 ----------
  private wait(ms: number) {
    return new Promise<void>((res) => this.time.delayedCall(ms, () => res()));
  }

  private async animate(ev: SimEvent[]) {
    this.busy = true;
    this.coach.removeAll(true);
    this.drawUi();
    for (const e of ev) {
      switch (e.e) {
        case 'play': {
          this.hooks.sfx('deal');
          const d = cardDef(e.id);
          const v = this.handViews.find((h) => h.card.uid === e.uid);
          const fv = e.target ? this.foeViews.get(e.target) : null;
          if (v) this.tweens.add({ targets: v.c, x: fv ? fv.x : W / 2, y: fv ? fv.y + 40 : HERO_Y - 60, scale: 0.5, alpha: 0, duration: 220, ease: 'Quad.easeIn' });
          this.cur = { fx: fxForCard(d.art, cardOps(e.id) as { op: string }[]), atk: d.kind === 'atk', seen: new Set() };
          if (d.rarity === 'legend') {
            await this.wait(160);
            await this.legendCutin(e.id);
          }
          if (d.kind === 'atk') await this.lunge(fv ?? null);
          else {
            if (d.kind === 'power') this.spawnFx('fx-pop', W / 2, HERO_Y - 20, 150);
            await this.wait(200);
          }
          break;
        }
        case 'hit': {
          if (e.to === 'hero') {
            this.disp.hero.hp -= e.n;
            this.disp.hero.block -= e.blocked;
            this.clearBarLabels(this.heroHp);
            this.drawHeroBar();
            if (e.n > 0) {
              this.hooks.sfx('slap');
              if (typeof e.from === 'number') this.spawnFx('fx-claw', W / 2, HERO_Y - 10, 130);
              this.shake(this.heroC, HERO_Y);
              this.heroHurt();
              this.float(W / 2, HERO_Y - 70, `-${e.n}`, COLOR.lose);
              this.cameras.main.shake(120, 0.006);
            } else if (e.blocked) {
              this.spawnFx('fx-shield', W / 2, HERO_Y - 10, 110);
              this.float(W / 2, HERO_Y - 70, '막음', COLOR.teamA);
            }
            await this.wait(e.from === 'status' ? 260 : 200);
          } else {
            const d = this.disp.foes.get(e.to);
            const v = this.foeViews.get(e.to);
            const f = this.battle().foes.find((x) => x.uid === e.to);
            if (d) {
              d.hp -= e.n;
              d.block -= e.blocked;
            }
            if (v && f) {
              this.updateFoe(f, v);
              if (e.from === 'hero' && this.cur?.atk) this.spawnFx(this.cur.fx, v.x, v.y, v.size * 0.9);
              if (e.n > 0) {
                this.hooks.sfx('chip');
                this.shake(v.c, v.y, true);
                this.foeHurt(v);
              }
              this.float(v.x, v.y - v.r, e.n > 0 ? `-${e.n}` : '막음', e.n > 0 ? COLOR.white : COLOR.teamA);
            }
            await this.wait(160);
          }
          break;
        }
        case 'dodge': {
          const v = this.foeViews.get(e.to);
          if (v) this.float(v.x, v.y - v.r, '피함!', COLOR.skyDeep);
          await this.wait(220);
          break;
        }
        case 'block': {
          if (e.to === 'hero') {
            this.disp.hero.block += e.n;
            this.clearBarLabels(this.heroHp);
            this.drawHeroBar();
            if (e.n > 0) {
              this.spawnFx('fx-shield', W / 2, HERO_Y, 120);
              this.float(W / 2 - 60, HERO_Y + 40, `방어 +${e.n}`, COLOR.teamA);
            } else this.float(W / 2 - 60, HERO_Y + 40, '방어 0', COLOR.teamA);
          } else {
            const d = this.disp.foes.get(e.to);
            if (d) d.block += e.n;
            const v = this.foeViews.get(e.to);
            if (v) this.float(v.x, v.y - v.r, `방어 +${e.n}`, COLOR.teamA);
          }
          await this.wait(120);
          break;
        }
        case 'status': {
          const name = e.id === 'str' ? '힘' : STATUS_NAME[e.id];
          const label = e.n < 0 ? `${name} 해제` : `${name} ${e.n}`;
          if (e.to === 'hero') this.float(W / 2 + 60, HERO_Y + 20, label, STATUS_COLOR[e.id]);
          else {
            const v = this.foeViews.get(e.to);
            if (v) {
              if (this.cur && !this.cur.atk && !this.cur.seen.has(e.to)) {
                this.cur.seen.add(e.to);
                this.spawnFx(this.cur.fx, v.x, v.y, v.size * 0.8);
              }
              this.float(v.x + 20, v.y, label, STATUS_COLOR[e.id]);
            }
          }
          await this.wait(100);
          break;
        }
        case 'heal':
          this.disp.hero.hp += e.n;
          this.clearBarLabels(this.heroHp);
          this.drawHeroBar();
          this.spawnFx('fx-heal', W / 2, HERO_Y - 10, 120);
          this.float(W / 2, HERO_Y - 70, `+${e.n}`, COLOR.win);
          await this.wait(160);
          break;
        case 'foeMove': {
          this.cur = null;
          const v = this.foeViews.get(e.uid);
          const d = this.disp.foes.get(e.uid);
          const f = this.battle().foes.find((x) => x.uid === e.uid);
          if (d) d.block = 0;
          if (v && f) {
            this.speech(v.x, v.y - v.r - 50, e.name);
            const m = moveDef(enemyDef(f.id), f.phase, e.move);
            const atkKey = v.art ? `${v.art}-atk` : '';
            if ((f.boss || f.elite) && m.intent === 'atk' && this.textures.exists(atkKey)) await this.bossStrike(v, atkKey);
            else {
              this.tweens.add({ targets: v.c, y: v.y + 34, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
              await this.wait(380);
            }
          } else await this.wait(380);
          break;
        }
        case 'die': {
          const v = this.foeViews.get(e.uid);
          if (v) {
            this.spawnFx('fx-pop', v.x, v.y, v.size);
            this.tweens.add({ targets: v.c, alpha: 0, scale: 0.6, angle: 20, duration: 280 });
            this.foeViews.delete(e.uid);
            this.time.delayedCall(320, () => {
              this.clearBarLabels(v.hpBar);
              v.c.destroy();
            });
          }
          this.hooks.sfx('coin');
          await this.wait(260);
          break;
        }
        case 'summon': {
          this.syncFoes();
          const v = this.foeViews.get(e.uid);
          if (v) {
            v.c.setScale(0.2);
            this.spawnFx('fx-pop', v.x, v.y, v.size);
            this.tweens.add({ targets: v.c, scale: 1, duration: 260, ease: 'Back.easeOut' });
          }
          await this.wait(240);
          break;
        }
        case 'hide': {
          const v = this.foeViews.get(e.uid);
          if (v) this.float(v.x, v.y - v.r, '숨기', COLOR.skyDeep);
          await this.wait(200);
          break;
        }
        case 'phase': {
          const f = this.battle().foes.find((x) => x.uid === e.uid);
          if (f) {
            const d = enemyDef(f.id);
            const atkKey = `${d.art}-atk`;
            const has = this.textures.exists(atkKey);
            const n = e.n ?? 2;
            this.hooks.sfx('turn');
            await this.cutin(has ? atkKey : d.art, has ? 1 : undefined, d.name, d.grow ? '커졌다!' : `${n}단계!`, e.text, COLOR.pink);
            const v = this.foeViews.get(f.uid);
            if (d.grow && v && v.body instanceof Phaser.GameObjects.Image) {
              // 어둑시니가 커진다 (발밑 고정)
              v.size = d.grow[n - 1];
              const img = v.body;
              const to = v.size / Math.max(img.frame.width, img.frame.height);
              this.tweens.add({ targets: img, scale: to, y: v.r - v.size * 0.45, duration: 420, ease: 'Back.easeOut' });
              this.cameras.main.shake(260, 0.01);
              await this.wait(450);
            }
          }
          break;
        }
        case 'foeRevive': {
          const v = this.foeViews.get(e.uid);
          const d = this.disp.foes.get(e.uid);
          if (d) d.hp = e.hp;
          const f = this.battle().foes.find((x) => x.uid === e.uid);
          if (v && f) {
            this.updateFoe(f, v);
            this.spawnFx('fx-heal', v.x, v.y, v.size);
            this.float(v.x, v.y - v.r, '부활!', COLOR.pink);
          }
          this.hooks.sfx('turn');
          await this.wait(500);
          break;
        }
        case 'cancel': {
          const v = this.foeViews.get(e.uid);
          if (v) {
            this.spawnFx('fx-boom', v.x, v.y, v.size);
            this.float(v.x, v.y - v.r - 20, '승천 저지!', COLOR.primary);
            this.cameras.main.shake(200, 0.008);
          }
          await this.wait(400);
          break;
        }
        case 'stunned': {
          if (e.uid === 0) {
            this.float(W / 2, FOE_Y - 80, '시간 멈춤!', COLOR.skyDeep);
            this.render();
          } else {
            const v = this.foeViews.get(e.uid);
            if (v) this.speech(v.x, v.y - v.r - 50, '…멈춤');
          }
          await this.wait(300);
          break;
        }
        case 'dark': {
          const v = this.foeViews.get(e.uid);
          const f = this.battle().foes.find((x) => x.uid === e.uid);
          if (v && f) {
            if (v.body instanceof Phaser.GameObjects.Image) {
              if (e.on) v.body.setTint(COLOR.outline);
              else v.body.clearTint();
            }
            this.float(v.x, v.y - v.r, e.on ? '어둠 속으로…' : '어둠이 걷혔다!', e.on ? COLOR.inkSoft : COLOR.primary);
            this.updateFoe(f, v);
          }
          await this.wait(260);
          break;
        }
        case 'free': {
          this.float(W / 2, 680, '기력 0!', COLOR.win);
          await this.wait(120);
          break;
        }
        case 'ward':
          this.spawnFx('fx-shield', W / 2, HERO_Y, 120);
          this.float(W / 2, HERO_Y - 70, '막아냄!', COLOR.teamA);
          await this.wait(220);
          break;
        case 'drain':
          this.float(W / 2, HERO_Y - 70, `다음 턴 기력 -${e.n}`, COLOR.draw);
          await this.wait(220);
          break;
        case 'turn':
          this.cur = null;
          if (e.who === 'foes') {
            await this.wait(200);
            this.banner('요괴 차례', COLOR.pink);
            await this.wait(500);
          } else if (e.turn > 1) {
            this.disp.hero.block = keptBlock(this.run(), this.disp.hero.block);
            this.render();
            this.banner('내 차례', COLOR.primary);
            this.hooks.sfx('turn');
            await this.wait(450);
          }
          break;
        case 'curse':
          this.showTip(`덱에 ${cardDef(e.id).name} ${e.n}장이 섞였어요`);
          await this.wait(300);
          break;
        case 'relic':
          this.showTip(`${relicDef(e.id).name} 발동!`);
          await this.wait(300);
          break;
        case 'revive':
          if (e.who === 'cat') await this.cutin(`cut-cat`, undefined, heroDef('cat').name, '버텼다!', '체력 1 · 방어 10', COLOR.pink);
          else await this.burst('다시 일어섰다!', e.who === 'phoenix' ? cardDef('phoenixFeather').name : relicDef(e.who).name);
          break;
        case 'echo':
          this.float(W / 2, HERO_Y - 100, `${cardDef(e.id).name} 한 번 더!`, COLOR.primary);
          if (cardDef(e.id).kind === 'atk') await this.lunge(null);
          break;
        case 'mimic':
          this.float(W / 2, HERO_Y - 100, `흉내: ${cardDef(e.id).name}`, COLOR.primary);
          {
            const d = cardDef(e.id);
            this.cur = { fx: fxForCard(d.art, cardOps(e.id) as { op: string }[]), atk: d.kind === 'atk', seen: new Set() };
            if (d.kind === 'atk') await this.lunge(null);
            else await this.wait(200);
          }
          break;
        case 'clone':
          this.float(W / 2, 660, '분신술!', COLOR.primary);
          await this.wait(200);
          break;
        case 'peek': {
          const v = this.foeViews.get(e.uid);
          if (v) this.float(v.x, v.y - v.r - 20, '냄새 추적!', COLOR.primary);
          await this.wait(200);
          break;
        }
        case 'win':
          this.hooks.sfx('win');
          for (let k = 0; k < 6; k++) this.coinPop(k);
          await this.burst('승리!', '');
          break;
        case 'lose':
          this.hooks.sfx('lose');
          await this.burst('쓰러졌다…', '');
          break;
        default:
          break;
      }
    }
    this.cur = null;
    this.busy = false;
    if (this.battle().over) {
      this.hooks.done();
      return;
    }
    this.render();
  }

  /** 영웅이 앞으로(대상 쪽으로) 튀어 나갔다 돌아온다 — 시트가 있으면 공격 칸 */
  private async lunge(target: FoeView | null) {
    const dx = target ? (target.x - W / 2) * 0.35 : 0;
    if (this.heroSheet && this.heroSprite) this.heroSprite.setFrame(HERO_ATTACK);
    this.tweens.add({ targets: this.heroC, x: W / 2 + dx, y: HERO_Y - 70, duration: 120, ease: 'Quad.easeOut', yoyo: true, hold: 60 });
    await this.wait(170);
    this.time.delayedCall(160, () => {
      if (this.heroSheet && this.heroSprite) this.heroSprite.setFrame(HERO_STAND);
      this.heroC.setPosition(W / 2, HERO_Y);
    });
  }

  private heroHurt() {
    if (!this.heroSprite) return;
    this.heroSprite.setTint(COLOR.pink);
    this.time.delayedCall(180, () => this.heroSprite?.clearTint());
  }

  /** 요괴가 맞음: -hit 그림으로 잠깐 바꾸고(없으면 분홍으로 물들임) 흔들린다 */
  private foeHurt(v: FoeView) {
    if (!(v.body instanceof Phaser.GameObjects.Image) || !v.art) {
      this.tweens.add({ targets: v.body, alpha: 0.4, duration: 60, yoyo: true, repeat: 1 });
      return;
    }
    const img = v.body;
    const hit = `${v.art}-hit`;
    v.back?.remove(false);
    if (this.textures.exists(hit)) {
      img.setTexture(hit);
      fit(img, v.size);
    } else img.setTint(COLOR.pink);
    v.back = this.time.delayedCall(260, () => {
      if (!img.active) return;
      img.clearTint();
      img.setTexture(v.art!);
      fit(img, v.size);
    });
  }

  /** 보스 공격 동작: 예고(치켜듦) → 내려치기 → 원래 그림 */
  private async bossStrike(v: FoeView, key: string) {
    const img = v.body as Phaser.GameObjects.Image;
    v.back?.remove(false);
    img.clearTint();
    img.setTexture(key, 0);
    fit(img, v.size * 1.1);
    await this.wait(240);
    if (!img.active) return;
    img.setTexture(key, 1);
    fit(img, v.size * 1.1);
    this.tweens.add({ targets: v.c, y: v.y + 30, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
    await this.wait(260);
    v.back = this.time.delayedCall(120, () => {
      if (!img.active) return;
      img.setTexture(v.art!);
      fit(img, v.size);
    });
  }

  /** 효과 그림 하나 (fx-*) — 커지며 사라진다. 없으면 코드 그림 (터지는 동그라미) */
  private spawnFx(key: string, x: number, y: number, size: number) {
    if (this.textures.exists(key)) {
      const img = this.add.image(x, y, key).setDepth(42);
      fit(img, size * 0.7);
      const s = img.scale;
      if (key === 'fx-slash' || key === 'fx-claw') img.setAngle(Phaser.Math.Between(-30, 30));
      this.tweens.add({ targets: img, scale: s * 1.45, alpha: 0, duration: 360, ease: 'Quad.easeOut', onComplete: () => img.destroy() });
      return;
    }
    const g = this.add.graphics().setDepth(42).setPosition(x, y);
    g.lineStyle(5, COLOR.white, 1);
    g.strokeCircle(0, 0, size * 0.25);
    this.tweens.add({ targets: g, scale: 2, alpha: 0, duration: 300, onComplete: () => g.destroy() });
  }

  private coinPop(k: number) {
    const x = W / 2 + (k - 2.5) * 34;
    if (this.textures.exists('fx-coin')) {
      const img = this.add.image(x, HERO_Y - 40, 'fx-coin').setDepth(47).setDisplaySize(30, 30);
      this.tweens.add({ targets: img, y: HERO_Y - 160 - (k % 2) * 30, alpha: 0, delay: k * 60, duration: 700, ease: 'Quad.easeOut', onComplete: () => img.destroy() });
    }
  }

  private shake(o: Phaser.GameObjects.Container, y: number, side = false) {
    this.tweens.add({ targets: o, x: side ? o.x + 8 : o.x, y: side ? y : y + 6, duration: 50, yoyo: true, repeat: 2, onComplete: () => o.setY(y) });
  }

  private float(x: number, y: number, s: string, color: number) {
    const t = txt(this, x, y, s, 22, color, 5).setDepth(45);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 800, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  private speech(x: number, y: number, s: string) {
    const c = this.add.container(Math.max(70, Math.min(W - 70, x)), Math.max(96, y)).setDepth(44);
    const t = txt(this, 0, 0, s, 15, COLOR.ink);
    const g = this.add.graphics();
    g.fillStyle(COLOR.white, 1);
    g.lineStyle(3, COLOR.outline, 1);
    g.fillRoundedRect(-t.width / 2 - 10, -16, t.width + 20, 32, 12);
    g.strokeRoundedRect(-t.width / 2 - 10, -16, t.width + 20, 32, 12);
    c.add([g, t]);
    this.tweens.add({ targets: c, alpha: 0, delay: 700, duration: 250, onComplete: () => c.destroy() });
  }

  private banner(s: string, color: number) {
    const c = this.add.container(W / 2, 380).setDepth(46);
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.lineStyle(4, COLOR.outline, 1);
    g.fillRoundedRect(-110, -26, 220, 52, 26);
    g.strokeRoundedRect(-110, -26, 220, 52, 26);
    c.add([g, txt(this, 0, 0, s, 24, COLOR.white, 4)]);
    c.setScale(0.6);
    this.tweens.add({ targets: c, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, delay: 650, duration: 200, onComplete: () => c.destroy() });
  }

  /** 승리·쓰러짐: 방사형 노란 빛 + 흰 글자 외곽선 (DESIGN 8장, 1.2초) */
  private async burst(title: string, sub: string) {
    const c = this.add.container(W / 2, 380).setDepth(48);
    const g = this.add.graphics();
    g.fillStyle(COLOR.outline, 0.45);
    g.fillRect(-W / 2, -H, W, H * 2);
    g.fillStyle(COLOR.primary, 0.85);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      g.fillTriangle(0, 0, Math.cos(a) * 420, Math.sin(a) * 420, Math.cos(a + 0.18) * 420, Math.sin(a + 0.18) * 420);
    }
    c.add(g);
    c.add(txt(this, 0, -8, title, 40, COLOR.white, 6));
    if (sub) c.add(txt(this, 0, 40, sub, 18, COLOR.white, 4));
    c.setScale(0.4);
    this.tweens.add({ targets: c, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: g, angle: 20, duration: 1200 });
    await this.wait(1000);
    this.tweens.add({ targets: c, alpha: 0, duration: 200, onComplete: () => c.destroy() });
    await this.wait(200);
  }

  /** 전설 카드: 영웅 컷인 (cut-<영웅> · 없으면 영웅 그림) */
  private async legendCutin(cardId: string) {
    const run = this.run();
    const h = heroDef(run.hero);
    const key = this.textures.exists(`cut-${h.id}`) ? `cut-${h.id}` : this.heroSheet ? `hero-${h.id}` : 'hero-full';
    this.hooks.sfx('turn');
    await this.cutin(key, key.startsWith('hero-') && this.heroSheet ? HERO_STAND : undefined, h.name, cardDef(cardId).name, '전설 카드!', COLOR.primary);
  }

  /**
   * 컷인 (시아핑거 fx.cutin 과 같은 모양): 기울어진 색 띠가 왼쪽에서 들어와 머물렀다 오른쪽으로 빠진다.
   * 왼쪽에 그림(보스 · 보스 공격 동작 · 영웅 컷인), 오른쪽에 이름·큰 글자·설명. DESIGN.md '컷인'(방사형 노란 빛, 흰 글자 + 외곽선).
   */
  private async cutin(key: string | null, frame: number | undefined, name: string, title: string, sub: string, color: number) {
    const IN = 160;
    const HOLD = 760;
    const OUT = 160;
    const box = this.add.container(-W, 360).setDepth(49);
    const g = this.add.graphics();
    g.fillStyle(COLOR.outline, 1);
    g.fillRect(-40, -92, W + 80, 184);
    g.fillStyle(color, 1);
    g.fillRect(-40, -84, W + 80, 168);
    g.fillStyle(COLOR.white, 0.5);
    g.fillRect(-40, -66, W + 80, 6);
    g.fillStyle(COLOR.outline, 0.25);
    g.fillRect(-40, 60, W + 80, 6);
    box.add(g);
    const rays = this.add.graphics().setPosition(110, 0);
    rays.fillStyle(COLOR.primary, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      rays.fillTriangle(0, 0, Math.cos(a) * 130, Math.sin(a) * 130, Math.cos(a + 0.22) * 130, Math.sin(a + 0.22) * 130);
    }
    box.add(rays);
    if (key && this.textures.exists(key)) {
      const img = this.add.image(110, 0, key, frame);
      fit(img, 190);
      box.add(img);
      this.tweens.add({ targets: img, scale: img.scale * 1.08, duration: IN + HOLD, ease: 'Sine.easeOut' });
    }
    const tx = 210;
    box.add(this.add.text(tx, sub ? -48 : -34, name, { fontFamily: FONT, fontSize: '20px', color: css(COLOR.primary), stroke: INK, strokeThickness: 5 }).setOrigin(0, 0.5));
    box.add(
      this.add
        .text(tx, sub ? -6 : 10, title, { fontFamily: FONT, fontSize: title.length > 5 ? '28px' : '38px', color: css(COLOR.white), stroke: INK, strokeThickness: 7, wordWrap: { width: W - tx - 14, useAdvancedWrap: true } })
        .setOrigin(0, 0.5),
    );
    if (sub) box.add(this.add.text(tx, 38, sub, { fontFamily: FONT, fontSize: '15px', color: css(COLOR.white), stroke: INK, strokeThickness: 4, wordWrap: { width: W - tx - 14, useAdvancedWrap: true } }).setOrigin(0, 0.5));
    box.setAngle(-4);
    this.tweens.add({ targets: rays, angle: 60, duration: IN + HOLD + OUT });
    this.tweens.add({ targets: box, x: 0, duration: IN, ease: 'Back.easeOut' });
    this.tweens.add({ targets: box, x: W, delay: IN + HOLD, duration: OUT, ease: 'Cubic.easeIn', onComplete: () => box.destroy() });
    await this.wait(IN + HOLD + OUT);
  }
}

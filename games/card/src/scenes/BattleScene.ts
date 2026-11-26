/**
 * 전투 화면 (세로 430×860). 배치는 PRD [화면]: 위 = 요괴·의도·체력·상태, 가운데 = 영웅, 아래 = 부채꼴 손패·기력 구슬·뽑을/버린 더미·턴 끝 버튼.
 * 화면은 규칙을 직접 바꾸지 않는다 — 입력(Input)을 hooks.send 로 넘기고, 돌아온 연출 사건(SimEvent)을 차례로 보여 준 뒤 상태대로 다시 그린다.
 * 카드는 끌어다 놓거나(대상 카드는 요괴 위에) 탭해서 고른 뒤 한 번 더 탭(대상 카드는 요괴를 탭)해서 쓴다.
 */
import Phaser from 'phaser';
import {
  aliveFoes,
  cardDef,
  cardName,
  cardText,
  enemyDef,
  foeDamage,
  moveDef,
  playCost,
  potionDef,
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
import { COLOR, FONT } from '../theme';
import { KIND_COLOR, RARITY_RING, STATUS_COLOR, STATUS_SHORT, drawFoe, drawHero, drawIntent, drawKindGlyph, txt } from './art';

export const W = 430;
export const H = 860;
const CARD_W = 92;
const CARD_H = 128;
const HAND_Y = 772;
const HERO_Y = 470;
const FOE_Y = 250;
const ROW_Y = 612;

export interface BattleHooks {
  run(): RunState;
  send(i: Input): ApplyResult | null;
  /** 전투가 끝나고 연출까지 끝남 */
  done(): void;
  heroUrl: string | null;
  sfx(name: string): void;
}

interface FoeView {
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  intent: Phaser.GameObjects.Container;
  st: Phaser.GameObjects.Container;
  r: number;
  x: number;
  y: number;
}

interface Disp {
  hp: number;
  block: number;
}

export class BattleScene extends Phaser.Scene {
  private hooks!: BattleHooks;
  private foeViews = new Map<number, FoeView>();
  private handViews: { card: BCard; c: Phaser.GameObjects.Container; x: number; y: number; rot: number }[] = [];
  private heroC!: Phaser.GameObjects.Container;
  private heroHp!: Phaser.GameObjects.Graphics;
  private heroHpText!: Phaser.GameObjects.Text;
  private heroSt!: Phaser.GameObjects.Container;
  private ui!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private tip!: Phaser.GameObjects.Container;
  private busy = false;
  private selected: number | null = null;
  private potionSel: number | null = null;
  private drag: { uid: number; sx: number; sy: number; moved: boolean } | null = null;
  private disp = { hero: { hp: 0, block: 0 } as Disp, foes: new Map<number, Disp>() };

  constructor() {
    super('battle');
  }

  init(data: { hooks: BattleHooks }) {
    this.hooks = data.hooks;
  }

  preload() {
    if (this.hooks.heroUrl) this.load.image('hero', this.hooks.heroUrl);
    this.load.on('loaderror', () => null);
  }

  create() {
    this.drawBackdrop();
    this.ui = this.add.container(0, 0).setDepth(5);
    this.hud = this.add.container(0, 0).setDepth(6);
    this.tip = this.add.container(0, 0).setDepth(50);
    this.makeHero();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onUp(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!over.length) this.onEmptyTap(p);
    });
    this.syncDisp();
    this.render();
    const b = this.battle();
    if (b && b.turn === 1) this.banner('전투 시작!', COLOR.primary);
  }

  private run() {
    return this.hooks.run();
  }
  private battle(): Battle {
    return this.run().battle!;
  }

  // ---------- 배경 ----------
  private drawBackdrop() {
    const g = this.add.graphics();
    // 하늘 → 땅 (DESIGN: 하늘 그라데이션)
    g.fillGradientStyle(COLOR.skyTop, COLOR.skyTop, COLOR.skyMid, COLOR.skyMid, 1);
    g.fillRect(0, 0, W, 330);
    g.fillGradientStyle(COLOR.skyMid, COLOR.skyMid, COLOR.skyBottom, COLOR.skyBottom, 1);
    g.fillRect(0, 330, W, 250);
    // 대나무 (코드 그림)
    for (let i = 0; i < 9; i++) {
      const x = 10 + i * 52 + (i % 2) * 14;
      g.fillStyle(COLOR.win, 0.35 + (i % 3) * 0.1);
      g.fillRect(x, 70, 12, 420);
      g.fillStyle(COLOR.outline, 0.15);
      for (let k = 0; k < 6; k++) g.fillRect(x, 110 + k * 64, 12, 4);
    }
    // 땅
    g.fillStyle(COLOR.win, 1);
    g.fillRect(0, 520, W, 60);
    g.lineStyle(3, COLOR.outline, 1);
    g.lineBetween(0, 520, W, 520);
    // 아래 손패 판
    g.fillStyle(COLOR.panel, 1);
    g.fillRoundedRect(-10, 578, W + 20, 300, 26);
    g.lineStyle(4, COLOR.outline, 1);
    g.strokeRoundedRect(-10, 578, W + 20, 300, 26);
  }

  // ---------- 영웅 ----------
  private makeHero() {
    this.heroC = this.add.container(W / 2, HERO_Y).setDepth(3);
    if (this.textures.exists('hero')) {
      const img = this.add.image(0, 10, 'hero');
      const s = 150 / Math.max(img.width, img.height);
      img.setScale(s).setOrigin(0.5, 0.62);
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

  private statusRow(c: Phaser.GameObjects.Container, x: number, y: number, st: Partial<Record<StatusId, number>>, str: number, dodge = 0) {
    const items: [StatusId | 'str', number][] = (Object.entries(st) as [StatusId, number][]).filter(([, n]) => n > 0);
    if (str) items.push(['str', str]);
    const all = [...items.map(([id, n]) => ({ label: STATUS_SHORT[id], n, color: STATUS_COLOR[id] }))];
    if (dodge) all.push({ label: '숨', n: dodge, color: COLOR.skyDeep });
    const gap = 30;
    let sx = x - ((all.length - 1) * gap) / 2;
    for (const it of all) {
      const g = this.add.graphics();
      g.fillStyle(it.color, 1);
      g.lineStyle(2, COLOR.outline, 1);
      g.fillCircle(sx, y, 12);
      g.strokeCircle(sx, y, 12);
      c.add(g);
      c.add(txt(this, sx, y, it.label, 12, COLOR.white, 3));
      c.add(txt(this, sx + 11, y + 9, `${it.n}`, 11, COLOR.white, 3));
      sx += gap;
    }
  }

  // ---------- 요괴 ----------
  private layoutFoes(foes: Foe[]) {
    const n = foes.length;
    const big = foes.filter((f) => !f.minion);
    const out = new Map<number, { x: number; y: number; r: number }>();
    if (n === 0) return out;
    const radius = (f: Foe) => (f.boss || f.elite ? (n > 2 ? 50 : 60) : f.minion ? 28 : n >= 3 ? 36 : 42);
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
      out.set(f.uid, { x: x + w / 2, y: FOE_Y + (f.minion ? 18 : 0) + (i % 2 && n > 3 ? 14 : 0), r });
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
    const body = this.add.graphics();
    drawFoe(body, f.id, r, !!(f.boss || f.elite));
    c.add(body);
    const name = txt(this, 0, r + 12, enemyDef(f.id).name + (f.elite ? ' (정예)' : ''), 13, COLOR.white, 3);
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
    return { c, body, hpBar, hpText, name, intent, st, r, x, y };
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
    this.statusRow(v.st, 0, v.r + 56, f.st, f.str, f.dodge);
    v.intent.removeAll(true);
    if (f.intent && !f.dead) {
      const m = moveDef(enemyDef(f.id), f.phase, f.intent);
      const g = this.add.graphics();
      drawIntent(g, m.intent, 30);
      v.intent.add(g);
      if (m.intent === 'atk') {
        const dmg = m.ops.filter((o) => o.op === 'dmg');
        const s = dmg.map((o) => (o.op === 'dmg' ? `${foeDamage(this.battle(), f, o.n)}${o.times && o.times > 1 ? `×${o.times}` : ''}` : '')).join('+');
        v.intent.add(txt(this, 22, 4, s, 18, COLOR.white, 4).setOrigin(0, 0.5));
      } else if (m.intent === 'unknown') {
        v.intent.add(txt(this, 0, 0, '?', 18, COLOR.white, 3));
      }
      if (m.ops.some((o) => o.op === 'status' || o.op === 'curse' || o.op === 'discardNext') && m.intent === 'atk') {
        const g2 = this.add.graphics();
        g2.setPosition(-22, 0);
        drawIntent(g2, 'debuff', 18);
        v.intent.add(g2);
      }
    }
  }

  // ---------- 손패 ----------
  private cardView(card: BCard | { uid: number; id: string; up?: boolean }, x: number, y: number, playable: boolean, cost: number) {
    const d = cardDef(card.id);
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const w = CARD_W;
    const h = CARD_H;
    g.fillStyle(COLOR.outline, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + 4, w, h, 12);
    g.fillStyle(KIND_COLOR[d.kind], 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    g.fillStyle(COLOR.panel, 1);
    g.fillRoundedRect(-w / 2 + 6, -h / 2 + 26, w - 12, h - 32, 8);
    g.lineStyle(3, COLOR.outline, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
    // 등급 테두리
    g.lineStyle(2, RARITY_RING[d.rarity] ?? COLOR.white, 1);
    g.strokeRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 10);
    c.add(g);
    const glyph = this.add.graphics();
    glyph.setPosition(0, -h / 2 + 50);
    glyph.fillStyle(KIND_COLOR[d.kind], 0.25);
    glyph.fillCircle(0, 0, 20);
    drawKindGlyph(glyph, d.kind, 30);
    c.add(glyph);
    c.add(txt(this, 4, -h / 2 + 13, cardName(card.id, card.up), cardName(card.id, card.up).length > 5 ? 12 : 14, COLOR.white, 3));
    const desc = this.add.text(0, 18, cardText(card.id, card.up), { fontFamily: FONT, fontSize: '11px', color: '#2a1a10', align: 'center', wordWrap: { width: w - 16, useAdvancedWrap: true } }).setOrigin(0.5, 0);
    c.add(desc);
    // 기력
    const cg = this.add.graphics();
    cg.fillStyle(cost < cardDef(card.id).cost ? COLOR.win : COLOR.primary, 1);
    cg.lineStyle(3, COLOR.outline, 1);
    cg.fillCircle(-w / 2 + 6, -h / 2 + 6, 13);
    cg.strokeCircle(-w / 2 + 6, -h / 2 + 6, 13);
    c.add(cg);
    c.add(txt(this, -w / 2 + 6, -h / 2 + 6, `${cost}`, 16, COLOR.ink));
    if (!playable) c.setAlpha(0.6);
    return c;
  }

  private layoutHand() {
    for (const v of this.handViews) v.c.destroy();
    this.handViews = [];
    const run = this.run();
    const b = this.battle();
    const n = b.hand.length;
    const span = Math.min(76, n > 1 ? 330 / (n - 1) : 0);
    b.hand.forEach((card, i) => {
      const off = i - (n - 1) / 2;
      const x = W / 2 + off * span;
      const y = HAND_Y + Math.abs(off) * Math.abs(off) * 2.2;
      const rot = off * 0.05;
      const cost = playCost(run, b, card);
      const playable = !b.over && cost <= b.energy;
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
    for (const [uid, v] of this.foeViews) {
      const need = (this.selected !== null && this.selectedNeedsTarget()) || (this.potionSel !== null && this.potionNeedsTarget());
      v.body.setAlpha(1);
      v.c.setScale(need ? 1.05 : 1);
      void uid;
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
    // 기력 구슬
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
    this.ui.add(txt(this, 50, ROW_Y, `${b.energy}`, 26, COLOR.white, 4));
    this.ui.add(txt(this, 50, ROW_Y + 40, '기력', 12, COLOR.inkSoft));
    // 더미
    this.pile(118, b.draw.length, '뽑을 더미', () => this.showPile('뽑을 더미 (순서는 비밀)', [...b.draw].sort((x, y) => x.id.localeCompare(y.id))));
    this.pile(268, b.discard.length, '버린 더미', () => this.showPile('버린 더미', b.discard));
    // 턴 끝
    const bx = 362;
    const bt = this.add.container(bx, ROW_Y);
    const bg = this.add.graphics();
    const on = !b.over && !this.busy;
    bg.fillStyle(COLOR.outline, 1);
    bg.fillRoundedRect(-56, -22 + 4, 112, 46, 16);
    bg.fillStyle(on ? COLOR.primary : COLOR.track, 1);
    bg.fillRoundedRect(-56, -22, 112, 46, 16);
    bg.lineStyle(3, COLOR.outline, 1);
    bg.strokeRoundedRect(-56, -22, 112, 46, 16);
    bt.add(bg);
    bt.add(txt(this, 0, 1, '턴 끝', 20, COLOR.ink));
    const z = this.add.zone(0, 0, 112, 50).setInteractive({ useHandCursor: true });
    z.on('pointerdown', () => this.endTurn());
    bt.add(z);
    this.ui.add(bt);
    // 위 줄: 물약 · 부적 · 엽전
    this.hud.removeAll(true);
    const top = this.add.graphics();
    top.fillStyle(COLOR.outline, 0.25);
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
      if (id) {
        pg.fillStyle(id === 'heal' ? COLOR.lose : id === 'block' ? COLOR.teamA : id === 'energy' ? COLOR.primary : id === 'fire' ? COLOR.accent : COLOR.win, 1);
        pg.fillCircle(x, 33, 9);
        pg.fillStyle(COLOR.outline, 1);
        pg.fillRect(x - 3, 17, 6, 7);
      }
      this.hud.add(pg);
      if (id) {
        const pz = this.add.zone(x, 30, 38, 40).setInteractive({ useHandCursor: true });
        pz.on('pointerdown', () => this.onPotion(i));
        this.hud.add(pz);
      }
    }
    // 부적
    const rel = run.relics;
    rel.slice(0, 7).forEach((id, i) => {
      const x = 170 + i * 26;
      const rg = this.add.graphics();
      rg.fillStyle(COLOR.primary, 1);
      rg.lineStyle(2, COLOR.outline, 1);
      rg.fillCircle(x, 30, 11);
      rg.strokeCircle(x, 30, 11);
      this.hud.add(rg);
      this.hud.add(txt(this, x, 30, relicDef(id).name.slice(0, 1), 11, COLOR.ink));
      const rz = this.add.zone(x, 30, 24, 30).setInteractive();
      rz.on('pointerdown', () => this.showTip(`${relicDef(id).name}: ${relicDef(id).text}`));
      this.hud.add(rz);
    });
    if (rel.length > 7) this.hud.add(txt(this, 170 + 7 * 26, 30, `+${rel.length - 7}`, 12, COLOR.white, 3));
    this.hud.add(txt(this, W - 46, 30, `엽전 ${run.gold}`, 15, COLOR.primary, 3));
    this.hud.add(txt(this, W / 2, 72, `${b.turn}턴`, 14, COLOR.white, 3));
  }

  private pile(x: number, n: number, label: string, onTap: () => void) {
    const g = this.add.graphics();
    for (let k = 2; k >= 0; k--) {
      g.fillStyle(k ? COLOR.lineSoft : COLOR.white, 1);
      g.lineStyle(2, COLOR.outline, 1);
      g.fillRoundedRect(x - 18 + k * 3, ROW_Y - 24 - k * 3, 36, 48, 6);
      g.strokeRoundedRect(x - 18 + k * 3, ROW_Y - 24 - k * 3, 36, 48, 6);
    }
    this.ui.add(g);
    this.ui.add(txt(this, x, ROW_Y, `${n}`, 18, COLOR.ink));
    this.ui.add(txt(this, x, ROW_Y + 40, label, 12, COLOR.inkSoft));
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
      const y = 150 + Math.floor(i / per) * 140;
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
  }

  // ---------- 입력 ----------
  private onCardDown(uid: number, p: Phaser.Input.Pointer) {
    if (this.busy) return;
    this.potionSel = null;
    this.drag = { uid, sx: p.x, sy: p.y, moved: false };
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (!this.drag || !p.isDown) return;
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
    this.drag = null;
    if (!d || this.busy) return;
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
    const st = (Object.entries(f.st) as [StatusId, number][]).map(([k, n]) => `${STATUS_NAME[k]}${n}: ${STATUS_HELP[k]}`);
    if (f.str) st.push(`힘${f.str}: ${STATUS_HELP.str}`);
    this.showTip([`${d.name} — 다음 행동: ${m ? (m.intent === 'unknown' ? '알 수 없음' : m.name) : '-'}`, ...st].join('\n'));
  }

  private onPotion(i: number) {
    if (this.busy) return;
    this.selected = null;
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
    if (this.busy || this.battle().over) return;
    this.selected = null;
    this.potionSel = null;
    this.send({ t: 'end' });
  }

  private send(i: Input) {
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
    this.drawUi();
    let drew = false;
    for (const e of ev) {
      switch (e.e) {
        case 'play': {
          this.hooks.sfx('deal');
          const v = this.handViews.find((h) => h.card.uid === e.uid);
          if (v) {
            const fv = e.target ? this.foeViews.get(e.target) : null;
            this.tweens.add({ targets: v.c, x: fv ? fv.x : W / 2, y: fv ? fv.y + 40 : HERO_Y - 60, scale: 0.5, alpha: 0, duration: 220, ease: 'Quad.easeIn' });
          }
          if (cardDef(e.id).kind === 'atk') this.tweens.add({ targets: this.heroC, y: HERO_Y - 26, duration: 110, yoyo: true });
          await this.wait(200);
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
              this.shake(this.heroC, HERO_Y);
              this.float(W / 2, HERO_Y - 70, `-${e.n}`, COLOR.lose);
              this.cameras.main.shake(120, 0.006);
            } else if (e.blocked) this.float(W / 2, HERO_Y - 70, '막음', COLOR.teamA);
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
              if (e.n > 0) {
                this.hooks.sfx('chip');
                this.shake(v.c, v.y, true);
                this.flash(v.body);
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
            this.float(W / 2 - 60, HERO_Y + 40, `방어 +${e.n}`, COLOR.teamA);
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
          if (e.to === 'hero') this.float(W / 2 + 60, HERO_Y + 20, `${name} ${e.n}`, STATUS_COLOR[e.id]);
          else {
            const v = this.foeViews.get(e.to);
            if (v) this.float(v.x + 20, v.y, `${name} ${e.n}`, STATUS_COLOR[e.id]);
          }
          await this.wait(100);
          break;
        }
        case 'heal':
          this.disp.hero.hp += e.n;
          this.clearBarLabels(this.heroHp);
          this.drawHeroBar();
          this.float(W / 2, HERO_Y - 70, `+${e.n}`, COLOR.win);
          await this.wait(160);
          break;
        case 'foeMove': {
          const v = this.foeViews.get(e.uid);
          const d = this.disp.foes.get(e.uid);
          if (d) d.block = 0;
          if (v) {
            this.speech(v.x, v.y - v.r - 50, e.name);
            this.tweens.add({ targets: v.c, y: v.y + 34, duration: 140, yoyo: true, ease: 'Quad.easeOut' });
          }
          await this.wait(380);
          break;
        }
        case 'die': {
          const v = this.foeViews.get(e.uid);
          if (v) {
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
          await this.cutin(f ? enemyDef(f.id).name : '', e.text);
          break;
        }
        case 'turn':
          if (e.who === 'foes') {
            await this.wait(200);
            this.banner('요괴 차례', COLOR.pink);
            await this.wait(500);
          } else if (e.turn > 1) {
            this.disp.hero.block = this.run().relics.includes('iceJar') ? Math.min(3, this.disp.hero.block) : 0;
            drew = true;
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
          await this.cutin('다시 일어섰다!', relicDef(e.who).name);
          break;
        case 'win':
          this.hooks.sfx('win');
          await this.cutin('승리!', '');
          break;
        case 'lose':
          this.hooks.sfx('lose');
          await this.cutin('쓰러졌다…', '');
          break;
        default:
          break;
      }
    }
    void drew;
    this.busy = false;
    if (this.battle().over) {
      this.hooks.done();
      return;
    }
    this.render();
  }

  private shake(o: Phaser.GameObjects.Container, y: number, side = false) {
    this.tweens.add({ targets: o, x: side ? o.x + 8 : o.x, y: side ? y : y + 6, duration: 50, yoyo: true, repeat: 2, onComplete: () => o.setY(y) });
  }

  private flash(g: Phaser.GameObjects.Graphics) {
    this.tweens.add({ targets: g, alpha: 0.4, duration: 60, yoyo: true, repeat: 1 });
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

  /** 컷인: 방사형 노란 빛 + 흰 글자 외곽선 (DESIGN 8장, 1.2초) */
  private async cutin(title: string, sub: string) {
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
}

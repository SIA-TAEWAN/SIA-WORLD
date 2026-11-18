/** 시아맞고 화면: 상대(위) · 바닥(가운데) · 나(아래). 손패를 눌러 내고, 고르기·고/스톱은 아래 버튼 */
import { bootGame, esc, sfx, type GameUI, type TableCtx, type TrackOpts } from '../lib/shell.ts';
import { worldRoot } from '../lib/world.ts';
import { cardBack, clamp, label, tc, theme, viewSize } from '../lib/cards.ts';
import { CARDS, cardById, type MatgoPrivate, type MatgoPublic, type MatgoSummary } from '../../supabase/functions/_shared/matgo.ts';
import type PhaserNS from 'phaser';

type Ctx = TableCtx<MatgoPublic, MatgoPrivate>;

const DAN_NAME: Record<string, string> = { hong: '홍단', cheong: '청단', cho: '초단' };
/** 원래 화투 그림(식물·배경): SpriteCook으로 그린 12달 식물 (shared/images/hwatu/plant-MM.png) */
const plantKey = (m: number) => `plant-${String(m).padStart(2, '0')}`;
const plantUrl = (m: number) => new URL(`shared/images/hwatu/${plantKey(m)}.png`, worldRoot()).href;
/** 전통 화투 그림 (SpriteCook, shared/images/hwatu/cards/<카드 id>.png, 뒷면 back.png) */
const cardKey = (id: string) => `hw-${id}`;
const cardUrl = (id: string) => new URL(`shared/images/hwatu/cards/${id}.png`, worldRoot()).href;
const ANIMAL_KEY = ['', 'rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

/**
 * 화투 한 장 (id가 null이면 뒷면). 가운데 기준. DESIGN.md 7장:
 * 크림 바탕, 모서리 8px(가로 60px 기준), 외곽선 2px · 광: --accent 테두리 + '광' 도장 · 띠: 홍·청·초단 색 띠 · 열끗: 캐릭터 크게 · 피: 발자국
 */
function hwatu(scene: PhaserNS.Scene, x: number, y: number, id: string | null, w: number, opts: { lift?: boolean; glow?: boolean; onClick?: () => void } = {}) {
  const T = theme();
  const C = T.COLOR;
  const h = Math.round(w * 1.55);
  const r = Math.max(4, (T.SHAPE.radiusHwatu * w) / 60);
  const line = Math.max(T.SHAPE.lineThin, w * 0.03);
  const depth = Math.max(2, w * 0.045);
  const c = scene.add.container(x, y - (opts.lift ? w * 0.14 : 0));
  const g = scene.add.graphics();
  // 고를 수 있는 패: 노란 테두리로 강조
  if (opts.glow) {
    // 얇게 (옆 패와 겹치지 않게: 패 사이 간격의 절반보다 작게)
    const pad = clamp(w * 0.03, 1.5, 3);
    g.fillStyle(C.primary, 1).fillRoundedRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2 + depth, r + pad);
    g.lineStyle(1, C.outline, 1).strokeRoundedRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2 + depth, r + pad);
  }
  g.fillStyle(C.outline, 1).fillRoundedRect(-w / 2, -h / 2 + depth, w, h, r);
  c.add(g);
  const art = cardKey(id ?? 'back');
  if (scene.textures.exists(art)) {
    // 전통 화투 그림 (그림 자체에 테두리·둥근 모서리가 있다)
    c.add(scene.add.image(0, 0, art).setDisplaySize(w, h));
    if (id && cardById(id).kind === 'gwang') {
      // 광: 오른쪽 위 작은 '광' 도장 (처음 하는 사람도 알아보게)
      const sr = Math.max(6, w * 0.13);
      const sx = w / 2 - sr - w * 0.06;
      const sy = -h / 2 + sr + w * 0.06;
      const g3 = scene.add.graphics();
      g3.fillStyle(C.white, 1).fillCircle(sx, sy, sr);
      g3.lineStyle(Math.max(1.5, w * 0.025), C.cardRed, 1).strokeCircle(sx, sy, sr);
      c.add(g3);
      c.add(scene.add.text(sx, sy, '광', { fontFamily: T.FONT, fontSize: `${Math.round(sr * 1.2)}px`, color: tc('cardRed') }).setOrigin(0.5));
    }
    if (opts.onClick) {
      c.setSize(w, h).setInteractive({ useHandCursor: true });
      c.on('pointerdown', opts.onClick);
    }
    return c;
  }
  if (!id) {
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-hwatu')).setDisplaySize(w, h));
    return c;
  }
  const card = cardById(id);
  g.fillStyle(C.panel, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.lineStyle(line, C.outline, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  // 광: 금색 안쪽 테두리
  if (card.kind === 'gwang') g.lineStyle(Math.max(2.5, w * 0.05), C.accent, 1).strokeRoundedRect(-w / 2 + line * 1.8, -h / 2 + line * 1.8, w - line * 3.6, h - line * 3.6, r * 0.6);
  // 원래 화투 식물: 피는 식물이 주인공(진하게), 나머지는 캐릭터 뒤에 연하게
  if (scene.textures.exists(plantKey(card.month))) {
    const pl = scene.add.image(0, h * 0.04, plantKey(card.month));
    pl.setScale(Math.min((w * 0.86) / pl.width, (h * 0.8) / pl.height));
    pl.setAlpha(card.kind === 'pi' ? 0.95 : 0.4);
    c.add(pl);
  }
  const g2 = scene.add.graphics();
  c.add(g2);
  // 띠: 단 색 리본 (외곽선)
  if (card.kind === 'tti') {
    const col = card.dan ? T.HWATU[card.dan] : T.HWATU.plain;
    g2.fillStyle(col, 1).fillRect(-w * 0.13, -h * 0.3, w * 0.26, h * 0.6);
    g2.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRect(-w * 0.13, -h * 0.3, w * 0.26, h * 0.6);
    if (card.dan) {
      c.add(
        scene.add
          .text(0, 0, DAN_NAME[card.dan].split('').join('\n'), { fontFamily: T.FONT, fontSize: `${Math.round(w * 0.17)}px`, color: tc('white'), align: 'center', lineSpacing: -w * 0.04 })
          .setOrigin(0.5),
      );
    }
  }
  // 캐릭터: 광·열끗은 크게, 띠는 작게 위쪽, 피는 없음
  const big = card.kind === 'yeol' || card.kind === 'gwang';
  const key = big ? `full-${ANIMAL_KEY[card.month]}` : `av-${ANIMAL_KEY[card.month]}`;
  if (card.kind !== 'pi' && scene.textures.exists(key)) {
    const img = scene.add.image(card.kind === 'tti' ? w * 0.26 : 0, card.kind === 'tti' ? -h * 0.3 : h * 0.08, key);
    if (big) img.setScale(Math.min((w * 0.8) / img.width, (h * 0.62) / img.height));
    else img.setScale((w * 0.36) / Math.max(img.width, img.height));
    c.add(img);
  }
  // 달: 왼쪽 위 키 배지 (바탕 --outline, 흰 숫자)
  const bw = Math.max(13, w * 0.28);
  const bh = Math.max(12, w * 0.24);
  const bx = -w / 2 + line + 2;
  const by = -h / 2 + line + 2;
  g2.fillStyle(C.outline, 1).fillRoundedRect(bx, by, bw, bh, Math.max(3, (T.SHAPE.radiusKey * w) / 60));
  c.add(scene.add.text(bx + bw / 2, by + bh / 2, `${card.month}`, { fontFamily: T.FONT, fontSize: `${Math.round(bh * 0.8)}px`, color: tc('white') }).setOrigin(0.5));
  // 광 도장: 오른쪽 위 둥근 도장 '광' (비광은 '비')
  if (card.kind === 'gwang') {
    const sr = Math.max(7, w * 0.15);
    const sx = w / 2 - line - sr - 2;
    const sy = -h / 2 + line + sr + 2;
    g2.fillStyle(C.cardRed, 1).fillCircle(sx, sy, sr);
    g2.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeCircle(sx, sy, sr);
    c.add(scene.add.text(sx, sy, card.bigwang ? '비' : '광', { fontFamily: T.FONT, fontSize: `${Math.round(sr * 1.15)}px`, color: tc('white') }).setOrigin(0.5));
  }
  // 아래: 피 발자국 / 고도리·국진 태그
  if (card.kind === 'pi') {
    c.add(scene.add.text(0, h / 2 - line - 2, card.ssangpi ? '🐾🐾' : '🐾', { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.24)}px` }).setOrigin(0.5, 1));
  } else if (card.godori || card.gukjin) {
    const t = scene.add
      .text(0, h / 2 - line - 2, card.godori ? '고도리' : '국진', {
        fontFamily: T.FONT,
        fontSize: `${Math.round(w * 0.18)}px`,
        color: tc('white'),
        backgroundColor: tc('pink'),
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 1);
    c.add(t);
  }
  if (opts.onClick) {
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerdown', opts.onClick);
  }
  return c;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Gfx = PhaserNS.GameObjects.Graphics;

/** 바느질 선: 둥근 사각형 둘레를 따라 짧은 선을 띄엄띄엄 (담요 가장자리 · 빈 자리 표시). 선 모양은 부르는 쪽에서 정한다 */
function stitch(g: Gfx, x: number, y: number, w: number, h: number, r: number, dash: number, gap: number) {
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < dash) return;
    const n = Math.max(1, Math.round(len / (dash + gap)));
    const unit = len / n;
    const l = (unit * dash) / (dash + gap);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (let i = 0; i < n; i++) {
      const a = i * unit + (unit - l) / 2;
      g.lineBetween(x1 + ux * a, y1 + uy * a, x1 + ux * (a + l), y1 + uy * (a + l));
    }
  };
  seg(x + r, y, x + w - r, y);
  seg(x + w, y + r, x + w, y + h - r);
  seg(x + w - r, y + h, x + r, y + h);
  seg(x, y + h - r, x, y + r);
  const arc = (cx: number, cy: number, a0: number) => {
    g.beginPath();
    g.arc(cx, cy, r, a0 + 0.3, a0 + Math.PI / 2 - 0.3);
    g.strokePath();
  };
  arc(x + w - r, y + r, -Math.PI / 2);
  arc(x + w - r, y + h - r, 0);
  arc(x + r, y + h - r, Math.PI / 2);
  arc(x + r, y + r, Math.PI);
}

/**
 * 담요: 초록 바탕에 연한 체크 무늬, 굵은 외곽선 + 아래 두께, 가장자리에는 크림색 바느질 선.
 * (평평한 단색 판 대신 포근한 놀이 담요 느낌. 색은 theme의 TABLE.matgo · MATGO)
 */
function drawMat(scene: PhaserNS.Scene, W: number, H: number) {
  const T = theme();
  const C = T.COLOR;
  const g = scene.add.graphics();
  const m = Math.max(4, Math.min(W, H) * 0.008);
  const d = T.SHAPE.depthPanel;
  const r = clamp(Math.min(W, H) * 0.06, 16, T.SHAPE.radiusPanelBig);
  const w = W - m * 2;
  const h = H - m * 2 - d;
  g.fillStyle(C.outline, 1).fillRoundedRect(m, m + d, w, h, r);
  g.fillStyle(T.TABLE.matgo, 1).fillRoundedRect(m, m, w, h, r);
  // 체크 무늬 (바느질 선 안쪽에만: 둥근 모서리 밖으로 나가지 않게)
  const inset = 10 + r * 0.3;
  const s = clamp(Math.min(W, H) * 0.075, 26, 46);
  const x1 = m + w - inset;
  const y1 = m + h - inset;
  g.fillStyle(T.MATGO.matLight, 1);
  for (let j = 0, y = m + inset; y < y1 - 1; j++, y += s) {
    for (let i = 0, x = m + inset; x < x1 - 1; i++, x += s) {
      if ((i + j) % 2 === 0) g.fillRect(x, y, Math.min(s, x1 - x), Math.min(s, y1 - y));
    }
  }
  g.lineStyle(T.SHAPE.lineBig, C.outline, 1).strokeRoundedRect(m, m, w, h, r);
  g.lineStyle(T.SHAPE.lineThin, C.panel, 0.95);
  stitch(g, m + 7, m + 7, w - 14, h - 14, Math.max(4, r - 7), 7, 6);
  return g;
}

/** 글자가 칸을 넘으면 뒤를 줄이고 '…' */
function fitText(tx: PhaserNS.GameObjects.Text, maxW: number) {
  let s = tx.text;
  while (tx.width > maxW && s.length > 1) {
    s = s.slice(0, -1);
    tx.setText(`${s}…`);
  }
  return tx;
}

type TagColor = 'pink' | 'teamA' | 'win' | 'accent' | 'track' | 'white';
interface PanelTag {
  text: string;
  color: TagColor;
  /** 통통 튀는 표시 (내 차례) */
  bounce?: boolean;
}
interface PanelOpts {
  name: string;
  avatar: string;
  /** 점수 (대기 중이면 null: 점수 방울을 그리지 않는다) */
  score: number | null;
  tags: PanelTag[];
  /** 점수 내역 (자리가 남을 때만) */
  sub?: string;
  turn: boolean;
  /** 오른쪽에 비워 둘 너비 (상대 손패 뒷면이 놓이는 자리) */
  reserve?: number;
}

/**
 * 자리 판: 큰 원형 아바타 + 이름 + 꼬리표(차례·고·흔들기) + 큰 점수 방울.
 * 차례인 사람은 판이 노랗게 바뀌고 바깥 흰 테두리가 깜빡이며 '내 차례!' 꼬리표가 통통 튄다.
 */
function playerPanel(scene: PhaserNS.Scene, R: Rect, o: PanelOpts) {
  const T = theme();
  const C = T.COLOR;
  const { x, y, w, h } = R;
  const depth = T.SHAPE.depthButton;
  const r = Math.min(h / 2, T.SHAPE.radiusPanel);
  if (o.turn) {
    const ring = scene.add.graphics();
    ring.lineStyle(T.SHAPE.lineBig, C.white, 1).strokeRoundedRect(x - 4, y - 4, w + 8, h + 8 + depth, r + 4);
    scene.tweens.add({ targets: ring, alpha: { from: 1, to: 0.2 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  const g = scene.add.graphics();
  g.fillStyle(C.outline, 1).fillRoundedRect(x, y + depth, w, h, r);
  g.fillStyle(o.turn ? C.primary : C.panel, 1).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(T.SHAPE.line, C.outline, 1).strokeRoundedRect(x, y, w, h, r);
  // 아바타: 판보다 살짝 크게 튀어나온 원
  const ra = h / 2 + 3;
  const ax = x + ra - 3;
  const ay = y + h / 2;
  g.fillStyle(C.outline, 1).fillCircle(ax, ay + 2, ra);
  g.fillStyle(C.white, 1).fillCircle(ax, ay, ra);
  g.lineStyle(T.SHAPE.line, C.outline, 1).strokeCircle(ax, ay, ra);
  const face = scene.textures.exists(`avc-${o.avatar}`) ? `avc-${o.avatar}` : `av-${o.avatar}`;
  if (scene.textures.exists(face)) {
    const img = scene.add.image(ax, ay, face);
    img.setScale((ra * 2 - 5) / Math.max(img.width, img.height));
  }
  // 점수 방울 (오른쪽)
  let right = x + w - (o.reserve ?? 0) - 7;
  if (o.score !== null) {
    const sh = Math.min(h - 10, 46, w * 0.2);
    const num = scene.add.text(0, 0, `${o.score}`, { fontFamily: T.FONT, fontSize: `${Math.round(sh * 0.66)}px`, color: tc('ink') }).setOrigin(0, 0.5);
    const unit = scene.add.text(0, 0, '점', { fontFamily: T.FONT, fontSize: `${Math.round(sh * 0.38)}px`, color: tc('inkSoft') }).setOrigin(0, 0.5);
    const sw = Math.max(sh * 1.35, num.width + unit.width + sh * 0.5);
    const sx = right - sw;
    const sy = y + (h - sh) / 2;
    g.fillStyle(C.outline, 1).fillRoundedRect(sx, sy + 2, sw, sh, sh / 2);
    g.fillStyle(o.turn ? C.white : C.primary, 1).fillRoundedRect(sx, sy, sw, sh, sh / 2);
    g.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRoundedRect(sx, sy, sw, sh, sh / 2);
    const tw = num.width + 2 + unit.width;
    num.setPosition(sx + (sw - tw) / 2, sy + sh / 2);
    unit.setPosition(num.x + num.width + 2, sy + sh / 2 + sh * 0.1);
    right = sx - 6;
  }
  // 가운데: 이름 · 꼬리표 · 점수 내역
  const left = ax + ra + 7;
  const room = right - left;
  const tall = h >= 56;
  const fsName = clamp(h * (tall ? 0.25 : 0.36), 13, 20);
  const fsTag = clamp(h * (tall ? 0.19 : 0.28), 11, 15);
  const subTall = tall && !!o.sub;
  const rows = 1 + (o.tags.length ? 1 : 0) + (subTall ? 1 : 0);
  const gapY = Math.min(fsName + 7, (h - 8) / rows);
  let ly = ay - ((rows - 1) * gapY) / 2;
  const name = fitText(scene.add.text(left, ly, o.name, { fontFamily: T.FONT, fontSize: `${Math.round(fsName)}px`, color: tc('ink') }).setOrigin(0, 0.5), room);
  const subStyle = { fontFamily: T.FONT, fontSize: `${Math.round(fsTag)}px`, color: tc(o.turn ? 'ink' : 'inkSoft') };
  if (o.sub && !tall && room - name.width > 70) fitText(scene.add.text(left + name.width + 8, ly + 1, o.sub, subStyle).setOrigin(0, 0.5), room - name.width - 8);
  if (o.tags.length) {
    ly += gapY;
    let tx = left;
    for (const tag of o.tags) {
      const dark = tag.color === 'track' || tag.color === 'white';
      const t = scene.add.text(0, 0, tag.text, { fontFamily: T.FONT, fontSize: `${Math.round(fsTag)}px`, color: tc(dark ? 'ink' : 'white') }).setOrigin(0.5);
      const pw = t.width + 12;
      const ph = fsTag + 6;
      if (tx + pw > right + 1) {
        t.destroy();
        break;
      }
      const pg = scene.add.graphics();
      pg.fillStyle(C[tag.color], 1).fillRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      pg.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      const c = scene.add.container(tx + pw / 2, ly, [pg, t]);
      if (tag.bounce) scene.tweens.add({ targets: c, y: ly - 3, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      tx += pw + 4;
    }
  }
  if (subTall) {
    ly += gapY;
    fitText(scene.add.text(left, ly, o.sub!, subStyle).setOrigin(0, 0.5), room);
  }
}

/** 크림색 말풍선 알약 (테이블 가운데 안내) */
function bubble(scene: PhaserNS.Scene, x: number, y: number, s: string, fs: number) {
  const T = theme();
  const C = T.COLOR;
  const t = scene.add.text(0, 0, s, { fontFamily: T.FONT, fontSize: `${Math.round(fs)}px`, color: tc('ink') }).setOrigin(0.5);
  const w = t.width + fs * 1.6;
  const h = fs * 2;
  const g = scene.add.graphics();
  g.fillStyle(C.outline, 1).fillRoundedRect(-w / 2, -h / 2 + 4, w, h, h / 2);
  g.fillStyle(C.panel, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  g.lineStyle(T.SHAPE.line, C.outline, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
  return scene.add.container(x, y, [g, t]).setDepth(6);
}

/** 더미: 도톰하게 쌓인 뒷면 + 남은 장수 배지. 아래에는 바느질한 놓는 자리 */
function deck(scene: PhaserNS.Scene, x: number, y: number, w: number, count: number | null) {
  const T = theme();
  const C = T.COLOR;
  const h = w * 1.55;
  const g = scene.add.graphics();
  const pad = Math.max(4, w * 0.1);
  g.fillStyle(T.MATGO.matDark, 1).fillRoundedRect(x - w / 2 - pad, y - h / 2 - pad, w + pad * 2, h + pad * 2, pad * 2);
  g.lineStyle(T.SHAPE.lineThin, C.panel, 0.9);
  stitch(g, x - w / 2 - pad, y - h / 2 - pad, w + pad * 2, h + pad * 2, pad * 2, 6, 5);
  const layers = count === null ? 5 : clamp(Math.ceil(count / 4), count > 0 ? 1 : 0, 5);
  const off = Math.max(1.4, w * 0.035);
  for (let i = 0; i < layers; i++) hwatu(scene, x, y + ((layers - 1) / 2 - i) * off, null, w);
  if (count === null) return;
  // 남은 장수: 오른쪽 아래 모서리의 노란 배지
  const fs = clamp(w * 0.3, 12, 20);
  const t = scene.add.text(0, 0, `${count}`, { fontFamily: T.FONT, fontSize: `${Math.round(fs)}px`, color: tc('ink') }).setOrigin(0.5);
  const bw = Math.max(fs * 1.7, t.width + fs * 0.9);
  const bh = fs * 1.5;
  const bg = scene.add.graphics();
  bg.fillStyle(C.outline, 1).fillRoundedRect(-bw / 2, -bh / 2 + 2, bw, bh, bh / 2);
  bg.fillStyle(C.primary, 1).fillRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
  bg.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
  scene.add.container(x + w / 2 - bw * 0.25, y + h / 2 - bh * 0.1, [bg, t]).setDepth(4);
}

/** 먹은 패 칸: 종류, 이름, 점수가 나기 시작하는 장수, 너비 비율 */
const TRAYS = [
  ['gwang', '광', 3, 0.17],
  ['yeol', '열끗', 5, 0.23],
  ['tti', '띠', 5, 0.23],
  ['pi', '피', 10, 0.37],
] as const;

/**
 * 먹은 패: 광 · 열끗 · 띠 · 피 칸에 겹쳐서. 칸 위 꼬리표에 장수(점수가 나는 장수까지 '3/10'), 점수가 나면 노랗게.
 * 칸 너비는 고정 (패가 늘어도 다른 칸이 움직이지 않게), 넘치면 겹치는 간격만 줄인다.
 */
function captured(t: Ctx, scene: PhaserNS.Scene, R: Rect, p: MatgoPublic['players'][number] | null, w: number, optsFor: (id: string) => TrackOpts) {
  const T = theme();
  const C = T.COLOR;
  const gap = clamp(w * 0.16, 4, 8);
  const usable = R.w - gap * 3;
  const fs = clamp(w * 0.4, 11, 16);
  const g = scene.add.graphics();
  let x = R.x;
  for (const [kind, name, goal, share] of TRAYS) {
    const tw = usable * share;
    const ids = p?.captured[kind] ?? [];
    const count = kind === 'pi' ? (p?.piCount ?? 0) : ids.length;
    g.fillStyle(T.MATGO.matDark, 1).fillRoundedRect(x, R.y, tw, R.h, 9);
    g.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRoundedRect(x, R.y, tw, R.h, 9);
    const inner = tw - 10;
    const step = ids.length > 1 ? Math.min(w * 0.6, (inner - w) / (ids.length - 1)) : 0;
    ids.forEach((id, i) => t.track(hwatu(scene, x + 5 + w / 2 + i * step, R.y + R.h / 2 - 1, id, w), id, optsFor(id)));
    // 꼬리표: 칸 위쪽 테두리에 걸친 알약
    const scoring = count >= goal;
    const tx = scene.add.text(0, 0, scoring ? `${name} ${count}` : `${name} ${count}/${goal}`, { fontFamily: T.FONT, fontSize: `${Math.round(fs)}px`, color: tc('ink') }).setOrigin(0, 0.5);
    const th = fs + 6;
    const twd = tx.width + 12;
    const ty = R.y - th / 2 + 3;
    g.fillStyle(scoring ? C.primary : C.panel, 1).fillRoundedRect(x + 5, ty - th / 2, twd, th, th / 2);
    g.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeRoundedRect(x + 5, ty - th / 2, twd, th, th / 2);
    tx.setPosition(x + 11, ty);
    x += tw + gap;
  }
}

/** 고르기 버튼에 넣는 작은 화투 (HTML 그림) */
function miniCard(id: string) {
  return `<span class="hw img"><img src="${cardUrl(id)}" alt="${esc(cardById(id).name)}"/></span>`;
}
/** (예전) 코드로 그린 작은 화투 — 그림을 못 불러올 때 대비 */
export function miniCardDrawn(id: string) {
  const card = cardById(id);
  const animal = ANIMAL_KEY[card.month];
  const big = card.kind === 'yeol' || card.kind === 'gwang';
  const char = card.kind === 'pi' ? '' : `<img class="ch ${big ? 'big' : 'small'}" src="${new URL(`shared/images/zodiac/${big ? 'full' : 'face'}/${animal}.png`, worldRoot()).href}" alt=""/>`;
  const tti = card.kind === 'tti' ? `<i class="tti ${card.dan ?? 'plain'}">${card.dan ? DAN_NAME[card.dan] : ''}</i>` : '';
  const tag = card.kind === 'gwang' ? `<b class="stamp">${card.bigwang ? '비' : '광'}</b>` : '';
  const foot = card.kind === 'pi' ? `<em>${card.ssangpi ? '🐾🐾' : '🐾'}</em>` : card.godori ? '<em class="tag">고도리</em>' : card.gukjin ? '<em class="tag">국진</em>' : '';
  return `<span class="hw ${card.kind}"><img class="pl ${card.kind === 'pi' ? 'strong' : ''}" src="${plantUrl(card.month)}" alt=""/>${tti}${char}<u>${card.month}</u>${tag}${foot}</span>`;
}

/**
 * 화면 배치.
 * 세로(휴대폰)는 위에서부터: 상대 자리 판(손패 뒷면 포함) · 상대 먹은 패 (오른쪽에 더미) → 바닥 → 내 먹은 패 → 내 자리 판 → 손패 두 줄.
 * 가로(PC)는 왼쪽 기둥에 상대 자리 판 · 상대 손패 · 더미 · 내 자리 판, 오른쪽에 상대 먹은 패 → 바닥 → 내 먹은 패 → 손패 한 줄.
 * 남는 높이로 카드 크기를 정한다.
 */
function layout(W: number, H: number, portrait: boolean, floorCount: number) {
  if (!portrait) {
    const pad = 14;
    // 낮은 화면(가로로 든 휴대폰)에서도 겹치지 않게 높이에 맞춰 줄인다
    const cw = clamp(Math.min(W / 11.5, (H - 104) / 6.15), 22, 96);
    const k = clamp(cw / 75, 0.8, 1.2);
    const ch = cw * 1.55;
    const fw = cw * 0.86;
    const capW = cw * 0.5;
    const trayH = capW * 1.55 + 10;
    const tab = clamp(capW * 0.4, 11, 16) + 4;
    const colW = clamp(W * 0.24, 170, 270);
    const x0 = pad + colW + 12;
    const panelH = Math.round(Math.min(72 * k, H * 0.22));
    const oppPanel: Rect = { x: pad, y: pad, w: colW, h: panelH };
    const myPanel: Rect = { x: pad, y: H - pad - 8 - panelH, w: colW, h: panelH };
    const handY = H - pad - 7 - ch / 2;
    const trayW = Math.min(W - pad - x0, capW * 21);
    const myTray: Rect = { x: x0, y: handY - ch / 2 - cw * 0.14 - 8 - trayH, w: trayW, h: trayH };
    const oppTray: Rect = { x: x0, y: pad + tab - 4, w: trayW, h: trayH };
    const floorTop = oppTray.y + trayH + 7;
    const floor: Rect = { x: x0, y: floorTop, w: W - pad - x0, h: myTray.y - tab - 5 - floorTop };
    const rowGap = Math.min(fw * 1.68, Math.max(fw * 0.9, floor.h - fw * 1.55 - 12));
    const y0 = floor.y + (floor.h - (rowGap + fw * 1.55)) / 2 + fw * 0.775;
    const left = x0 + 8;
    const right = x0 + (W - pad - x0) * 0.84;
    // 상대 손패(뒷면): 상대 자리 판 바로 아래
    const bw = cw * 0.36;
    const backStep = Math.min(bw * 0.55, (colW - bw - 12) / 9);
    const oppHand = { x: pad + colW / 2, y: oppPanel.y + panelH + 10 + bw * 0.78 };
    // 더미: 왼쪽 기둥 가운데 (상대 손패와 내 자리 판 사이)
    const pw = Math.min(fw, (myPanel.y - (oppHand.y + bw * 0.78) - 34) / 1.75);
    const pile = { x: pad + colW / 2, y: clamp(floor.y + floor.h / 2, oppHand.y + bw * 0.78 + 12 + pw * 0.9, myPanel.y - 22 - pw * 0.9) };
    const hx0 = x0 + cw / 2 + 4;
    return {
      cw,
      fw,
      capW,
      k,
      bw,
      pw,
      backStep,
      oppPanel,
      myPanel,
      oppReserve: 0,
      oppHand,
      pile,
      oppTray,
      myTray,
      floor,
      slots: 12,
      turnCards: { x: x0 + (W - pad - x0) * 0.935, y: floor.y + floor.h / 2 },
      floorPos: (i: number, n: number) => {
        // 칸 수 고정 (12달 → 두 줄 6칸): 패가 들고 나도 다른 패 자리가 바뀌지 않게
        const cols = Math.max(6, Math.ceil(n / 2));
        return { x: left + ((i % cols) + 0.5) * ((right - left) / cols) - fw * 0.3, y: y0 + Math.floor(i / cols) * rowGap };
      },
      handPos: (i: number, n: number) => {
        const step = Math.min(cw * 1.08, (W - pad - 8 - cw / 2 - hx0) / Math.max(1, n - 1));
        return { x: hx0 + i * step, y: handY };
      },
    };
  }
  // 휴대폰: 손패 5장이 한 줄을 꽉 채우게 (높이가 모자라면 그만큼 줄인다)
  const pad = 12;
  // 바닥 패(두 줄 6칸)가 너비만큼 커질 높이를 먼저 남기고, 나머지 높이로 손패 크기를 정한다
  const fwW = (W - pad * 2 - 2) / 6 / 1.42;
  const cw = clamp(Math.min((W - 28) / 5.32, (H - 124 - fwW * 3.24) / 5.88), 30, 110);
  const k = clamp(cw / 75, 0.8, 1.2);
  const ch = cw * 1.55;
  const capW = cw * 0.42;
  const trayH = capW * 1.55 + 10;
  const tab = clamp(capW * 0.4, 11, 16) + 4;
  const panelH = Math.round(50 * k);
  // 손패 두 줄 (아래)
  const handBottomY = H - 16 - ch / 2;
  const handTopY = handBottomY - ch - 9;
  const myPanel: Rect = { x: pad, y: handTopY - ch / 2 - cw * 0.14 - 9 - panelH, w: W - pad * 2, h: panelH };
  const myTray: Rect = { x: pad, y: myPanel.y - 8 - trayH, w: W - pad * 2, h: trayH };
  // 맨 위: 상대 자리 판 + 상대 먹은 패, 그 오른쪽에 더미 (두 줄 높이)
  const pw = cw * 0.62;
  const deckCol = pw + 18;
  const oppPanel: Rect = { x: pad, y: 11, w: W - pad * 2 - deckCol, h: panelH };
  const oppTray: Rect = { x: pad, y: oppPanel.y + panelH + 4 + tab, w: oppPanel.w, h: trayH };
  const pile = { x: W - pad - pw / 2 - 5, y: (oppPanel.y + oppTray.y + trayH) / 2 - 6 };
  // 상대 손패(뒷면): 상대 자리 판 안 오른쪽에 촘촘히
  const bw = cw * 0.3;
  const backStep = bw * 0.36;
  const backsW = backStep * 9 + bw;
  const oppHand = { x: oppPanel.x + oppPanel.w - 9 - backsW / 2, y: oppPanel.y + panelH / 2 - 1 };
  const floorTop = oppTray.y + trayH + 6;
  const floor: Rect = { x: pad - 4, y: floorTop, w: W - pad * 2 + 8, h: myTray.y - tab - 3 - floorTop };
  // 바닥 카드 크기: 두 줄 / 세 줄 / 네 줄 중 큰 쪽
  const fit = (rows: number) => {
    const cols = Math.max(4, Math.ceil(Math.max(12, floorCount) / rows));
    const byW = (floor.w - 10) / cols / 1.42;
    const byH = (floor.h - 10) / (1.62 * rows);
    // 바닥 패도 손패와 거의 같은 크기로
    return { rows, cols, fw: Math.min(byW, byH, cw) };
  };
  const F = [fit(2), fit(3), fit(4)].reduce((x, y) => (y.fw > x.fw ? y : x));
  const fw = Math.max(26, F.fw);
  const rowGap = Math.min(fw * 1.62 + (floor.h - 10 - fw * 1.62 * F.rows) / F.rows, fw * 1.8);
  const used = rowGap * (F.rows - 1) + fw * 1.55;
  const y0 = floor.y + (floor.h - used) / 2 + fw * 0.775;
  return {
    cw,
    fw,
    capW,
    k,
    bw,
    pw,
    backStep,
    oppPanel,
    myPanel,
    oppReserve: backsW + 10,
    oppHand,
    pile,
    oppTray,
    myTray,
    floor,
    slots: F.rows * F.cols,
    turnCards: null as { x: number; y: number } | null,
    floorPos: (i: number, _n?: number) => {
      // 겹친 패가 오른쪽으로 나가도 칸 안에 들어오게 조금 왼쪽에
      const colW = (floor.w - 10) / F.cols;
      return { x: floor.x + 5 + ((i % F.cols) + 0.5) * colW - fw * 0.2, y: y0 + Math.floor(i / F.cols) * rowGap };
    },
    handPos: (i: number, n: number) => {
      const perRow = 5;
      const inRow = Math.min(perRow, n - Math.floor(i / perRow) * perRow);
      // 빛나는 테두리끼리 닿지 않게 남는 너비만큼 벌린다
      const step = Math.min(cw * 1.16, (W - 30 - cw) / (perRow - 1));
      // 다섯 장 이하면 한 줄: 두 줄 자리의 가운데에
      const y = n <= perRow ? (handTopY + handBottomY) / 2 : Math.floor(i / perRow) === 0 ? handTopY : handBottomY;
      return { x: W / 2 + ((i % perRow) - (inRow - 1) / 2) * step, y };
    },
  };
}

/** 찰싹! 패가 바닥에 내려앉는 순간: 하얀 충격 링 + 별 조각 + 살짝 흔들림 (같은 달 패 위면 더 크게 + '찰싹!') */
function slap(scene: PhaserNS.Scene, x: number, y: number, w: number, onStack: boolean, dpr: number) {
  if (!scene.sys?.isActive()) return;
  sfx('slap', { volume: onStack ? 1 : 0.7, rate: onStack ? 1 : 1.15 });
  const T = theme();
  const ring = scene.add.circle(x, y, w * 0.45).setStrokeStyle(Math.max(3, w * 0.07), T.COLOR.white, 1).setDepth(30);
  scene.tweens.add({ targets: ring, scale: onStack ? 2.1 : 1.6, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  const n = onStack ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const dot = scene.add.star(x, y, 4, w * 0.04, w * 0.11, i % 2 ? T.COLOR.primary : T.COLOR.white).setDepth(31);
    scene.tweens.add({ targets: dot, x: x + Math.cos(a) * w * 0.9, y: y + Math.sin(a) * w * 0.9, alpha: 0, angle: 180, duration: 380, ease: 'Cubic.easeOut', onComplete: () => dot.destroy() });
  }
  if (onStack) {
    const word = scene.add
      .text(x, y - w * 0.9, '찰싹!', { fontFamily: T.FONT, fontSize: `${Math.round(clamp(w * 0.34, 14, 26))}px`, color: tc('white'), stroke: tc('outline'), strokeThickness: 4 })
      .setOrigin(0.5)
      .setResolution(dpr)
      .setDepth(32);
    scene.tweens.add({ targets: word, y: y - w * 1.3, alpha: { from: 1, to: 0 }, scale: { from: 0.6, to: 1.15 }, duration: 520, ease: 'Back.easeOut', onComplete: () => word.destroy() });
  }
  scene.cameras.main.shake(onStack ? 110 : 70, onStack ? 0.006 : 0.003);
}

/**
 * 패 흐름 재생 계획 (서버는 내 차례와 AI 차례를 한 번에 보낼 수 있다 → 사건 기록으로 차례대로 보여 준다)
 * 한 차례: 낸 패가 바닥으로(0초) → 더미 패가 뒤집히며 바닥으로(0.76초) → 먹을 게 있으면 짝지어 가져가기(1.65초).
 * 다음 차례는 2.5초 뒤.
 */
interface CardPlan {
  /** 출발 시각 (지금부터 ms) */
  startAt: number;
  /** 어디서: 낸 사람 손 / 더미 */
  src: 'hand' | 'pile';
  seat: number | null;
  flip: boolean;
  /** 가져가는 시각 (먹은 패만) */
  captureAt: number | null;
  /** 낸 패·뒤집은 패가 먹힐 때 먼저 내려앉을 바닥 자리 (그릴 때 정한다) */
  via: { x: number; y: number } | null;
  /** 그 차례에 함께 움직인 카드들 (같은 달 짝 찾기용) */
  turn: number;
  /** 원래 바닥에 있다가 먹힌 패 */
  floor: boolean;
}
const TURN_MS = 2150;
const AT_PLAY = 0;
const AT_FLIP = 650;
const AT_TAKE = 1400;
const plan = new Map<string, CardPlan>();
let planRound = '';
let planSeen = 0;

/** 새 사건들로 계획 세우기 (같은 상태를 다시 그릴 때는 그대로) */
function updatePlan(p: MatgoPublic, round: number, roomId: string) {
  // 방이 바뀌거나 새 판이면 처음부터 (모듈 상태는 방을 옮겨도 남는다)
  const key = `${roomId}:${round}`;
  if (key !== planRound) {
    planRound = key;
    planSeen = 0;
    plan.clear();
  }
  const evs = (p.events ?? []).filter((e) => e.id > planSeen);
  if (!evs.length) return;
  // 이전 계획은 이미 지나간 것이므로 비운다 (새로 들어온 사건만 재생)
  // 단, 패 고르기로 한 차례가 두 번에 나뉘어 오면 (첫 사건이 낸 패가 아님) 앞서 낸·뒤집은 패는 이미 내려앉은 채로 이어 간다
  const continuing = evs[0].t === 'flip' || evs[0].t === 'capture' || evs[0].t === 'steal';
  const lastTurn = Math.max(-1, ...[...plan.values()].map((x) => x.turn));
  const kept = continuing ? [...plan].filter(([, x]) => x.turn === lastTurn && !x.floor && x.captureAt === null) : [];
  plan.clear();
  // 이미 앞면으로 내려앉은 패: 다시 뒤집지 않는다
  for (const [id, x] of kept) plan.set(id, { ...x, startAt: 0, turn: 0, flip: false });
  planSeen = Math.max(planSeen, ...evs.map((e) => e.id));
  let turn = kept.length ? 0 : continuing ? 0 : -1;
  let hasFlip = kept.length ? kept.some(([, x]) => x.flip) : !continuing;
  const base = () => Math.max(0, turn) * TURN_MS;
  for (const e of evs) {
    const seat = typeof e.seat === 'number' ? e.seat : null;
    if (e.t === 'play' || e.t === 'bomb' || (e.t === 'flip' && hasFlip)) {
      turn += 1;
      hasFlip = false;
    }
    if (e.t === 'play' || e.t === 'bomb') {
      for (const id of (e.cards as string[]) ?? []) plan.set(id, { startAt: base() + AT_PLAY, src: 'hand', seat, flip: false, captureAt: null, via: null, turn, floor: false });
    } else if (e.t === 'flip' && typeof e.card === 'string') {
      hasFlip = true;
      plan.set(e.card, { startAt: base() + AT_FLIP, src: 'pile', seat, flip: true, captureAt: null, via: null, turn: Math.max(0, turn), floor: false });
    } else if (e.t === 'capture') {
      for (const id of (e.cards as string[]) ?? []) {
        const cur = plan.get(id);
        if (cur) cur.captureAt = base() + AT_TAKE;
        else plan.set(id, { startAt: base() + AT_TAKE, src: 'hand', seat, flip: false, captureAt: base() + AT_TAKE, via: null, turn: Math.max(0, turn), floor: true });
      }
    } else if (e.t === 'steal' && typeof e.card === 'string') {
      plan.set(e.card, { startAt: base() + AT_TAKE + 300, src: 'hand', seat, flip: false, captureAt: base() + AT_TAKE + 300, via: null, turn: Math.max(0, turn), floor: false });
    }
  }
}

/** 낸 패·뒤집은 패가 먹힐 때 내려앉을 바닥 자리: 같은 달 바닥 패가 있던 자리 위, 없으면 같은 차례에 먼저 내려앉은 같은 달 패 위, 그것도 없으면 빈 칸 */
function landingSpot(t: Ctx, id: string, fw: number, fallback: { x: number; y: number }) {
  const me = plan.get(id)!;
  const m = cardById(id).month;
  let spot: { x: number; y: number } | null = null;
  for (const [other, pl] of plan) {
    if (other === id || pl.turn !== me.turn || cardById(other).month !== m) continue;
    // 원래 바닥에 있던 패 (손·더미에서 온 패가 아닌 것)
    if (pl.floor) {
      const lp = t.lastPos(other);
      if (lp) {
        spot = lp;
        break;
      }
    }
  }
  if (!spot) {
    for (const [other, pl] of plan) {
      if (other === id || pl.turn !== me.turn || cardById(other).month !== m || !pl.via || pl.startAt >= me.startAt) continue;
      spot = pl.via;
    }
  }
  const base = spot ?? fallback;
  return { x: base.x + fw * 0.4, y: base.y + fw * 0.06 };
}

/** 바닥 자리: 달마다 한 번 정한 칸을 그 달 패가 다 없어질 때까지 유지 (패가 들고 나도 다른 패는 그대로) */
const slotOf = new Map<string, number>();
let slotKey = '';
function floorSlots(floor: MatgoPublic['floor'], key: string): { slots: number[]; free: number } {
  if (key !== slotKey) {
    slotKey = key;
    slotOf.clear();
  }
  const keys = floor.map((f, i) => (f.cards.length ? `m${cardById(f.cards[0]).month}` : `e${i}`));
  for (const k of [...slotOf.keys()]) if (!keys.includes(k)) slotOf.delete(k);
  const used = new Set(slotOf.values());
  const lowestFree = () => {
    let n = 0;
    while (used.has(n)) n++;
    return n;
  };
  const slots = keys.map((k) => {
    let n = slotOf.get(k);
    if (n === undefined) {
      n = lowestFree();
      slotOf.set(k, n);
      used.add(n);
    }
    return n;
  });
  return { slots, free: lowestFree() };
}

let shake = false;
/** 방금 누른 내 패 (서버 답이 오기 전에 누른 것이 바로 보이게) */
let picked: string | null = null;

/** 패 내기: 누르자마자 그 패를 올리고 소리를 낸 뒤 서버에 보낸다 (답을 기다리느라 반응이 늦어 보이지 않게) */
function playCard(t: Ctx, id: string) {
  if (t.busy || picked) return;
  picked = id;
  sfx('tick');
  const withShake = shake && !!t.priv?.shakeable.includes(cardById(id).month);
  t.redraw();
  void t.act({ type: 'play', card: id, shake: withShake }).then((ok) => {
    // 서버가 받지 않았으면 다시 고를 수 있게
    if (!ok && picked === id) {
      picked = null;
      t.redraw();
    }
    // 받았는데도 새 상태가 오지 않으면 (통신 문제) 4초 뒤에는 풀어 준다
    if (ok) setTimeout(() => picked === id && ((picked = null), t.redraw()), 4000);
  });
}
/** 5광 컷인을 이미 보여 준 판:자리 */
const fiveGwang = new Set<string>();

const ui: GameUI<MatgoPublic, MatgoPrivate> = {
  game: 'matgo',
  title: '시아맞고',
  icon: '🎴',
  back: '',
  backLabel: 'SIA WORLD',
  felt: () => theme().COLOR.skyMid,
  // 조작부는 말풍선 한 줄 + 버튼 한 줄이면 충분하다 (기본 210px이면 휴대폰에서 빈 띠가 크게 남는다)
  controlsMin: (w) => (w < 700 ? 104 : 112),

  preload(scene) {
    for (let m = 1; m <= 12; m++) scene.load.image(plantKey(m), plantUrl(m));
    for (const c of CARDS) scene.load.image(cardKey(c.id), cardUrl(c.id));
    scene.load.image(cardKey('back'), cardUrl('back'));
  },

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const T = theme();
    const C = T.COLOR;
    const p = t.pub;
    drawMat(scene, W, H);
    // 세로 화면(휴대폰): 손패는 다섯 장씩 두 줄
    const portrait = H > W * 1.15 || W < 520;
    const L = layout(W, H, portrait, p?.floor.length ?? 8);
    const { cw, fw, capW } = L;

    // 바닥: 살짝 어두운 자리 + 패 놓는 칸마다 바느질 테두리
    const fg = scene.add.graphics();
    fg.fillStyle(T.MATGO.matDark, 0.45).fillRoundedRect(L.floor.x, L.floor.y, L.floor.w, L.floor.h, 16);
    const fh = fw * 1.55;
    for (let i = 0; i < L.slots; i++) {
      const { x, y } = L.floorPos(i, 12);
      fg.fillStyle(T.MATGO.matDark, 0.6).fillRoundedRect(x - fw / 2, y - fh / 2, fw, fh, fw * 0.14);
      fg.lineStyle(T.SHAPE.lineThin, C.panel, 0.75);
      stitch(fg, x - fw / 2 + 1, y - fh / 2 + 1, fw - 2, fh - 2, fw * 0.14, 5, 4);
    }

    if (!p) {
      // 대기 중: 자리 판(레디 표시) · 빈 먹은 패 칸 · 더미 · 내 손패 자리(뒷면)
      const mine = t.seats.find((s) => s.seat_no === t.mySeat) ?? t.seats[0];
      const other = t.seats.find((s) => s !== mine);
      const waitTag = (s: (typeof t.seats)[number]): PanelTag[] => [!s.user_id || s.left_game ? { text: 'AI', color: 'track' } : s.ready ? { text: '레디!', color: 'win' } : { text: '준비 중', color: 'track' }];
      if (other) playerPanel(scene, L.oppPanel, { name: other.nickname, avatar: other.avatar, score: null, tags: waitTag(other), turn: false });
      if (mine) playerPanel(scene, L.myPanel, { name: mine.nickname, avatar: mine.avatar, score: null, tags: waitTag(mine), turn: false });
      captured(t, scene, L.oppTray, null, capW, () => ({}));
      captured(t, scene, L.myTray, null, capW, () => ({}));
      deck(scene, L.pile.x, L.pile.y, L.pw, null);
      for (let i = 0; i < 10; i++) {
        const { x, y } = L.handPos(i, 10);
        hwatu(scene, x, y, null, cw);
      }
      bubble(scene, L.floor.x + L.floor.w / 2, L.floor.y + L.floor.h / 2, '모두 레디하면 시작해요', clamp(Math.min(W, H) * 0.04, 15, 22));
      return;
    }

    const me = t.mySeat ?? p.seats[0];
    const opp = p.seats.find((s) => s !== me) ?? p.seats[1];
    const P = p.players;
    const op = P[opp];
    const mp = P[me];
    const allCaptured = (pl: (typeof P)[number]) => [...pl.captured.gwang, ...pl.captured.yeol, ...pl.captured.tti, ...pl.captured.pi];
    // 판 시작(아직 아무도 안 냄): 더미에서 한 장씩 착착 나눠 준다 (내 패 → 상대 패 번갈아, 그다음 바닥)
    const dealing = !p.turnCards && allCaptured(op).length + allCaptured(mp).length === 0 && !(p.events ?? []).some((e) => e.t === 'play' || e.t === 'flip');
    updatePlan(p, t.room.round_no, t.room.id);
    const DEAL_GAP = 130;

    // 자리 판: 아바타 · 이름 · 꼬리표(차례 · 고 · 흔들기 · 폭탄 피) · 점수 방울
    const tagsOf = (pl: (typeof P)[number], seat: number): PanelTag[] => [
      ...(p.turn === seat ? [{ text: seat === t.mySeat ? '내 차례!' : '생각 중…', color: 'pink', bounce: true } as PanelTag] : []),
      // 위쪽 자리 줄을 숨긴 대신 여기서 알려 준다: 나간 사람 자리(AI 대신) · 다음 판에 들어올 사람 · 레디/대기
      ...seatTags(seat),
      ...(pl.go ? [{ text: `${pl.go}고`, color: 'teamA' } as PanelTag] : []),
      ...(pl.shakes ? [{ text: `흔들기 ${pl.shakes}`, color: 'accent' } as PanelTag] : []),
      ...(pl.bombFill ? [{ text: `폭탄 피 ${pl.bombFill}`, color: 'track' } as PanelTag] : []),
    ];
    function seatTags(seat: number): PanelTag[] {
      const row = t.seats.find((s) => s.seat_no === seat);
      if (!row) return [];
      const out: PanelTag[] = [];
      if (row.user_id && row.left_game) out.push({ text: 'AI 대신', color: 'track' } as PanelTag);
      if (row.pending_user_id) out.push({ text: `다음 판: ${row.pending_nickname ?? '새 친구'}`, color: 'teamA' } as PanelTag);
      if (t.room.status === 'waiting' && row.user_id && !row.left_game) out.push(row.ready ? ({ text: '레디!', color: 'win' } as PanelTag) : ({ text: '대기', color: 'track' } as PanelTag));
      return out;
    }
    const subOf = (pl: (typeof P)[number]) => pl.breakdown.map((l) => `${l.label} ${l.points}점`).join(' · ');
    playerPanel(scene, L.oppPanel, { name: t.seatName(opp), avatar: t.seatAvatar(opp), score: op.score, tags: tagsOf(op, opp), sub: portrait ? undefined : subOf(op), turn: p.turn === opp, reserve: L.oppReserve });
    playerPanel(scene, L.myPanel, { name: t.seatName(me), avatar: t.seatAvatar(me), score: mp.score, tags: tagsOf(mp, me), sub: subOf(mp), turn: p.turn === me });

    // 상대 손패(뒷면)
    for (let i = 0; i < op.handCount; i++) {
      const back = hwatu(scene, L.oppHand.x + (i - (op.handCount - 1) / 2) * L.backStep, L.oppHand.y, null, L.bw);
      t.track(back, `opp:${i}`, { from: L.pile, delay: dealing ? (i * 2 + 1) * DEAL_GAP : 0 });
    }
    const pile = L.pile;
    const myHand = { x: W * 0.6, y: L.handPos(0, 10).y };
    const srcOf = (id: string, pl: CardPlan) => (pl.src === 'pile' ? pile : pl.seat === me ? (t.lastPos(id) ?? myHand) : L.oppHand);
    const srcSize = (pl: CardPlan) => (pl.src === 'pile' ? L.pw : pl.seat === me ? cw : L.bw);
    // 낸 패·뒤집은 패가 먹힐 때 먼저 내려앉을 바닥 자리 (시간 순서대로 한 번만 정한다)
    const FS = floorSlots(p.floor, `${t.room.id}:${t.room.round_no}`);
    const newSlot = L.floorPos(FS.free, 12);
    [...plan.entries()]
      .filter(([, pl]) => pl.captureAt !== null && !pl.floor && pl.src !== 'hand' || (pl.captureAt !== null && !pl.floor && pl.startAt !== pl.captureAt))
      .filter(([, pl]) => !pl.via && pl.startAt !== pl.captureAt)
      .sort((a, b) => a[1].startAt - b[1].startAt)
      .forEach(([id, pl]) => (pl.via = landingSpot(t, id, fw, newSlot)));
    /** 먹은 패 자리로 가는 카드의 움직임 */
    const capOpts = (id: string): TrackOpts => {
      const pl = plan.get(id);
      if (!pl || dealing) return { order: 2 };
      if (pl.via && pl.captureAt !== null) {
        // 손·더미 → 바닥(찰싹) → 잠깐 → 먹은 패 자리
        const via = pl.via;
        return {
          from: srcOf(id, pl),
          delay: pl.startAt,
          flip: pl.flip,
          sound: pl.flip ? 'flip' : 'deal',
          fromScale: srcSize(pl) / capW,
          via,
          viaScale: fw / capW,
          viaLeave: pl.captureAt,
          onLand: () => slap(scene, via.x, via.y, fw, true, t.dpr),
        };
      }
      // 바닥에 있던 패 (또는 뺏어 온 피): 가져가기 차례에 지금 자리에서 출발
      // 바닥 패는 가져가기 전까지 바닥 크기 그대로 있다가, 날아가면서 먹은 패 크기로 줄어든다
      return { delay: pl.captureAt ?? AT_TAKE, sound: 'chip', fromScale: pl.floor ? fw / capW : undefined };
    };
    captured(t, scene, L.oppTray, op, capW, capOpts);

    // 바닥 (달별로 모아서)
    const floor = p.floor;
    const pick = p.choice?.kind === 'choose' && t.myTurn && !t.busy;
    let floorSeq = 0;
    floor.forEach((f, i) => {
      const { x, y } = L.floorPos(FS.slots[i], 12);
      f.cards.forEach((id, j) => {
        const glow = p.choice?.kind === 'choose' && p.choice.options.includes(id);
        const cx = x + j * fw * 0.4;
        const cy = y + j * fw * 0.06;
        const card = hwatu(scene, cx, cy, id, fw, {
          glow,
          onClick: glow && pick ? () => void t.act({ type: 'choose', card: id }) : undefined,
        });
        // 처음 보는 패: 판 시작이면 더미에서 차례로, 아니면 사건 기록대로 (낸 패는 손에서, 뒤집은 패는 더미에서 뒤집으며)
        const pl = dealing ? undefined : plan.get(id);
        if (dealing) t.track(card, id, { from: pile, delay: (20 + floorSeq++) * DEAL_GAP, fromScale: L.pw / fw, sound: 'deal' });
        else if (pl)
          t.track(card, id, {
            from: srcOf(id, pl),
            delay: pl.startAt,
            flip: pl.flip,
            sound: pl.flip ? 'flip' : 'deal',
            // 손패(또는 뒷면·더미) 크기에서 바닥 크기로
            fromScale: srcSize(pl) / fw,
            // 바닥에 내려앉을 때 찰싹 (같은 달 패가 있으면 그 위에)
            onLand: () => slap(scene, cx, cy, fw, j > 0, t.dpr),
          });
        else t.track(card, id, { from: pile, fromScale: L.pw / fw });
      });
      if (f.ppeok || f.stacked) label(scene, x, y - fw * 0.95, f.ppeok ? '뻑' : '쌓임', clamp(fw * 0.26, 12, 20), tc('pink')).setDepth(12);
    });
    // 더미 (도톰한 뒷면 + 남은 장수 배지), 나가리 배수는 더미 아래
    deck(scene, pile.x, pile.y, L.pw, p.pileCount);
    if (p.nagariMul > 1) label(scene, pile.x, pile.y + L.pw * 0.775 + clamp(L.pw * 0.3, 12, 20) * 1.5, `나가리 ×${p.nagariMul}`, clamp(L.pw * 0.24, 11, 18), tc('primary'));
    // 이번 차례에 낸 패·뒤집은 패 (가로 화면만)
    if (p.turnCards && L.turnCards) {
      const tcards = [...p.turnCards.played, ...(p.turnCards.flipped ? [p.turnCards.flipped] : [])];
      const tx = L.turnCards.x;
      tcards.forEach((id, i) => hwatu(scene, tx - i * fw * 0.45, L.turnCards!.y, id, fw * 0.85));
      label(scene, tx, L.turnCards.y + fw * 1.0, '이번 차례', clamp(fw * 0.22, 12, 18));
    }

    // 나: 먹은 패 · 손패
    captured(t, scene, L.myTray, mp, capW, capOpts);
    // 공개 상태가 내 비공개 손패보다 먼저 도착하면 방금 낸 패가 두 곳에 보인다 → 이미 바닥·먹은 패에 있는 패는 손패에서 뺀다
    const shown = new Set<string>([...p.floor.flatMap((f) => f.cards), ...Object.values(P).flatMap(allCaptured)]);
    const hand = (t.priv?.hand ?? []).filter((id) => !shown.has(id));
    const canPlay = t.myTurn && p.choice?.kind === 'play';
    // 방금 누른 패: 서버 답을 기다리는 동안에도 바로 위로 올라와 보인다 (손패에서 빠지면 지운다)
    if (picked && !hand.includes(picked)) picked = null;
    // 바닥에 같은 달이 있어 먹을 수 있는 패는 노란 테두리로 (고를 수 있는 패와 같은 표시)
    const floorMonths = new Set(p.floor.filter((f) => f.cards.length).map((f) => cardById(f.cards[0]).month));
    hand.forEach((id, i) => {
      const { x, y } = L.handPos(i, hand.length);
      t.track(
        hwatu(scene, x, id === picked ? y - cw * 0.5 : y, id, cw, {
          lift: canPlay || id === picked,
          glow: id === picked || floorMonths.has(cardById(id).month),
          onClick: canPlay && !t.busy && !picked ? () => playCard(t, id) : undefined,
        }),
        id,
        { from: pile, delay: dealing ? i * 2 * DEAL_GAP : 0, sound: dealing ? 'deal' : undefined },
      );
    });
  },

  controls(t: Ctx, el: HTMLElement) {
    const p = t.pub;
    if (!p || t.mySeat === null) return;
    const c = p.choice;
    /** 말풍선 알약: 얼굴 + 한마디 (+ 작은 설명) */
    const say = (seat: number, text: string, small = '', mine = false) =>
      `<div class="mg-say ${mine ? 'mine' : ''}"><img src="${t.avatarUrl(t.seatAvatar(seat))}" alt=""/><span>${text}${small ? `<small>${small}</small>` : ''}</span></div>`;
    if (!t.myTurn || !c) {
      // 내 차례여도 앞선 연출(패가 움직이는 중)이 끝나기 전에는 버튼 대신 안내
      el.innerHTML = p.turn === null ? '' : `<div class="mg-ctl">${p.turn === t.mySeat && c ? say(t.mySeat, '패가 움직이는 중…') : say(p.turn, `${esc(t.seatName(p.turn))} 차례…`)}</div>`;
      return;
    }
    const dis = t.busy ? 'disabled' : '';
    if (c.kind === 'play') {
      const pv = t.priv;
      const shakeable = pv?.shakeable ?? [];
      const bombs = pv?.bombable ?? [];
      const extra = `${shakeable.length ? `<label class="btn"><input type="checkbox" id="shake" ${shake ? 'checked' : ''}/> 흔들기 (${shakeable.map((m) => `${m}월`).join(', ')})</label>` : ''}
        ${bombs.map((m) => `<button class="btn primary" data-bomb="${m}" ${dis}>💣 ${m}월 폭탄</button>`).join('')}
        ${c.canFlip ? `<button class="btn" id="flip" ${dis}>더미 뒤집기 (폭탄 피)</button>` : ''}`;
      el.innerHTML = `<div class="mg-ctl">${say(t.mySeat, '낼 패를 누르세요', '20초가 지나면 자동으로 내요', true)}${extra.trim() ? `<div class="mg-btns">${extra}</div>` : ''}</div>`;
      el.querySelector<HTMLInputElement>('#shake')?.addEventListener('change', (e) => (shake = (e.target as HTMLInputElement).checked));
      el.querySelectorAll<HTMLButtonElement>('[data-bomb]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'bomb', month: Number(b.dataset.bomb) })));
      el.querySelector('#flip')?.addEventListener('click', () => void t.act({ type: 'flip' }));
      return;
    }
    shake = false;
    if (c.kind === 'choose') {
      el.innerHTML = `<div class="mg-ctl side ${c.options.length > 2 ? 'many' : ''}">${say(t.mySeat, `${c.stage === 'flip' ? '뒤집은 패로' : '낸 패로'} 가져올 패를 고르세요`, '빛나는 패를 눌러도 돼요', true)}<div class="mg-btns">${c.options
        .map((id) => `<button class="hw-pick" data-c="${id}" ${dis} title="${esc(cardById(id).name)}">${miniCard(id)}</button>`)
        .join('')}</div></div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'choose', card: b.dataset.c })));
      return;
    }
    if (c.kind === 'gukjin') {
      el.innerHTML = `<div class="mg-ctl">${say(t.mySeat, '국진(9월 열끗)을 어떻게 쓸까요?', '', true)}<div class="mg-btns">
        <button class="btn big" data-g="yeol" ${dis}>열끗으로</button><button class="btn big primary" data-g="ssangpi" ${dis}>쌍피로</button></div></div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'gukjin', as: b.dataset.g })));
      return;
    }
    if (c.kind === 'goStop') {
      el.innerHTML = `<div class="mg-ctl">${say(t.mySeat, `${c.score}점! 고 할까요, 스톱 할까요?${c.go ? ` (지금 ${c.go}고)` : ''}`, '', true)}<div class="mg-btns">
        <button class="btn big primary mg-go" id="go" ${dis}>고! ▶</button><button class="btn big mg-stop" id="stop" ${dis}>스톱 ✋</button></div></div>`;
      el.querySelector('#go')!.addEventListener('click', () => void t.act({ type: 'go' }));
      el.querySelector('#stop')!.addEventListener('click', () => void t.act({ type: 'stop' }));
    }
  },

  resultHtml(t: Ctx) {
    const r = (t.pub as unknown as { result?: MatgoSummary })?.result;
    if (!r) return '<p>판이 끝났어요</p>';
    const full = (seat: number) => new URL(`shared/images/zodiac/full/${t.seatAvatar(seat)}.png`, worldRoot()).href;
    if (r.result === 'nagari') {
      return `<div class="mg-res draw"><div class="mg-res-head"><div><b>나가리!</b><span>아무도 점수를 못 냈어요</span></div></div>
        <p class="mg-res-money">다음 판 ×${r.nextNagari}</p></div>`;
    }
    const meWin = r.winner === t.resultSeat;
    const meLose = r.loser === t.resultSeat;
    const name = (seat: number) => t.pub?.players[seat]?.name ?? t.seatName(seat);
    const lines = r.breakdown.map((l) => `<li><span>${esc(l.label)}</span><b>${l.points}점</b></li>`).join('');
    // 배수: '3고 ×2'는 최종 점수에 이미 들어 있다 (점수 내역에 한 줄로) → 계산식에는 나머지 배수만
    const isGoMul = (m: string) => /^\d+고 ×/.test(m);
    const muls = r.multipliers.filter((m) => !isGoMul(m)).map((m) => (m.includes('×') ? m : `${m} ×2`));
    return `<div class="mg-res ${meWin ? 'win' : meLose ? 'lose' : 'draw'}">
      <div class="mg-res-head"><img src="${full(r.winner!)}" alt=""/><div><b>${meWin ? '이겼어요!' : meLose ? '졌어요…' : '판 끝!'}</b><span>${esc(name(r.winner!))} 승리${r.chongtong ? ' (총통)' : ''}</span></div></div>
      <p class="mg-res-money ${meWin ? 'plus' : meLose ? 'minus' : ''}">${meWin ? '+' : meLose ? '-' : ''}${t.fmt(r.paid)}냥</p>
      <ul class="mg-res-lines">${lines}
        ${r.goMultiplier > 1 ? `<li><span>${r.goCount}고</span><b>×${r.goMultiplier}</b></li>` : ''}
        <li class="sum"><span>점수</span><b>${r.score}점</b></li></ul>
      <div class="mg-res-calc"><i>${r.score}점</i><em>×</em><i>점당 ${t.fmt(r.baseUnit)}냥</i>${muls.map((m) => `<em>×</em><i class="mul">${esc(m)}</i>`).join('')}<em>=</em><b>${t.fmt(r.amount)}냥</b></div>
      ${r.paid < r.amount ? `<p class="mg-res-note">가진 만큼만 ${t.fmt(r.paid)}냥</p>` : ''}
    </div>`;
  },

  cutin(ev, t: Ctx) {
    const mine = ev.seat === t.mySeat;
    switch (ev.t) {
      case 'go':
        return `${ev.count ?? ''}고!`;
      case 'stop':
        return '스톱!';
      case 'pibak':
        return '피박!';
      case 'gwangbak':
        return '광박!';
      case 'meongbak':
        return '멍박!';
      case 'gobak':
        return '고박!';
      case 'chongtong':
        return '총통!';
      case 'bomb':
        return '폭탄!';
      case 'shake':
        return '흔들기!';
      case 'ppeok':
        return mine ? '뻑!' : null;
      case 'nagari':
        return '나가리';
      default: {
        // 5광: 광이 5장이 된 그 순간만 (자리마다 한 번)
        if (ev.t !== 'capture' || typeof ev.seat !== 'number' || !t.pub) return null;
        const n = t.pub.players[ev.seat]?.captured.gwang.length ?? 0;
        const key = `${(t.pub as unknown as { round?: number }).round ?? 0}:${ev.seat}`;
        if (n === 5 && !fiveGwang.has(key)) {
          fiveGwang.add(key);
          return '5광!';
        }
        return null;
      }
    }
  },
};

void bootGame(ui);

/** 시아맞고 화면: 상대(위) · 바닥(가운데) · 나(아래). 손패를 눌러 내고, 고르기·고/스톱은 아래 버튼 */
import { bootGame, esc, sfx, type GameUI, type TableCtx, type TrackOpts } from '../lib/shell.ts';
import { worldRoot } from '../lib/world.ts';
import { cardBack, clamp, drawTable, label, nameTag, tc, theme, viewSize } from '../lib/cards.ts';
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

/** 먹은 패 (광·열끗·띠·피) 겹쳐서. maxX까지 들어오게 간격을 줄인다 */
function captured(t: Ctx, scene: PhaserNS.Scene, x: number, y: number, p: MatgoPublic['players'][number], w: number, maxX: number, optsFor: (id: string) => TrackOpts) {
  const groups = (
    [
      ['광', p.captured.gwang],
      ['열끗', p.captured.yeol],
      ['띠', p.captured.tti],
      ['피', p.captured.pi],
    ] as [string, string[]][]
  ).filter((g) => g[1].length > 0);
  const avail = maxX - x;
  const fixed = groups.length * w * 1.35;
  const extra = groups.reduce((a, [, ids]) => a + ids.length - 1, 0);
  // 겹친 패가 더 보이게: 기본 간격을 넓히고, 화면이 모자랄 때만 줄인다
  const step = Math.min(w * 0.58, extra ? Math.max(3, (avail - fixed) / extra) : w * 0.58);
  let cx = x;
  for (const [name, ids] of groups) {
    ids.forEach((id, i) => t.track(hwatu(scene, cx + i * step, y, id, w), id, optsFor(id)));
    const gw = w + (ids.length - 1) * step;
    label(scene, cx - w / 2 + gw / 2, y + w * 1.0, `${name} ${name === '피' ? p.piCount : ids.length}`, clamp(w * 0.32, 12, 18), tc('primary'));
    cx += gw + w * 0.35;
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
 * 화면 배치. 세로(휴대폰)는 위에서부터: 상대 손패(뒷면)·더미 → 상대 먹은 패 → 바닥 → 내 먹은 패 → 손패 두 줄.
 * 남는 높이로 바닥 카드 크기를 정하고, 바닥은 두 줄(넓게)과 세 줄 중 카드가 더 크게 나오는 쪽을 쓴다.
 */
function layout(W: number, H: number, portrait: boolean, floorCount: number) {
  if (!portrait) {
    const cw = clamp(Math.min(W / 11.5, H / 7), 30, 96);
    const fw = cw * 0.86;
    const capW = cw * 0.56;
    const k = clamp(cw / 75, 0.8, 1.2);
    const bw = cw * 0.42;
    const y0 = H * 0.355;
    const rowGap = fw * 1.68;
    const left = W * 0.17;
    const right = W * 0.83;
    const hx0 = Math.max(W * 0.27, 190 * k);
    return {
      cw,
      fw,
      capW,
      k,
      bw,
      oppHand: { x: W * 0.45, y: bw * 0.78 + 18 },
      pile: { x: W * 0.075, y: y0 + rowGap * 0.5 },
      pw: fw,
      backStep: bw * 0.55,
      oppScore: { x: 8, y: 6 },
      capX: 24 + capW / 2,
      oppCapY: H * 0.19,
      oppCapMaxX: W - 16,
      myCapY: H * 0.685,
      floorTop: y0 - fw * 0.78,
      floorH: rowGap + fw * 1.55,
      floorPos: (i: number, n: number) => {
        // 칸 수 고정 (12달 → 두 줄 6칸): 패가 들고 나도 다른 패 자리가 바뀌지 않게
        const cols = Math.max(6, Math.ceil(n / 2));
        return { x: left + ((i % cols) + 0.5) * ((right - left) / cols) - fw * 0.3, y: y0 + Math.floor(i / cols) * rowGap };
      },
      handPos: (i: number, n: number) => {
        const step = Math.min(cw * 1.06, (W - hx0 - cw * 0.6) / Math.max(1, n - 1));
        return { x: hx0 + i * step, y: H - cw * 0.86 };
      },
    };
  }
  // 휴대폰: 카드를 최대한 크게 (손패 5장이 한 줄을 꽉 채우고, 높이는 7.3장 분량)
  const cw = clamp(Math.min((W - 34) / 5.4, (H - 100) / 7.3), 30, 110);
  const k = clamp(cw / 75, 0.8, 1.2);
  const ch = cw * 1.55;
  const capW = cw * 0.42;
  const bw = cw * 0.3;
  // 손패 두 줄 (아래)
  const handBottomY = H - ch / 2 - 22;
  const handTopY = handBottomY - ch - 9;
  // 내 먹은 패 (손패 위): 카드 + 아래 글자
  const myCapY = handTopY - ch / 2 - capW * 1.0 - 14;
  // 맨 위 한 줄: 왼쪽 상대 먹은 패 · 오른쪽 상대 손패(뒷면, 촘촘히) · 더미
  const pw = cw * 0.5;
  const pile = { x: W - pw / 2 - 22, y: pw * 0.78 + 16 };
  const backStep = bw * 0.4;
  const backsHalf = (backStep * 9 + bw) / 2;
  const oppHand = { x: W - pw - 34 - backsHalf, y: bw * 0.78 + 16 };
  const oppCapY = 16 + capW * 0.78;
  const floorTop = Math.max(oppCapY + capW + 14, pile.y + pw * 0.78 + 24, oppHand.y + bw * 0.78 + 30);
  const floorH = myCapY - capW * 0.78 - 6 - floorTop;
  // 바닥 카드 크기: 두 줄 / 세 줄 중 큰 쪽
  const fit = (rows: number) => {
    const cols = Math.max(4, Math.ceil(Math.max(12, floorCount) / rows));
    const byW = (W - 40) / cols / 1.42;
    const byH = floorH / (1.62 * (rows - 1) + 1.62);
    // 바닥 패도 손패와 거의 같은 크기로
    return { rows, cols, fw: Math.min(byW, byH, cw) };
  };
  const F = [fit(2), fit(3), fit(4)].reduce((x, y) => (y.fw > x.fw ? y : x));
  const fw = Math.max(26, F.fw);
  const rowGap = fw * 1.62;
  const used = rowGap * (F.rows - 1) + fw * 1.55;
  const y0 = floorTop + (floorH - used) / 2 + fw * 0.78;
  return {
    cw,
    fw,
    capW,
    k,
    bw,
    oppHand,
    pile,
    pw,
    backStep,
    oppScore: { x: oppHand.x - backsHalf, y: oppHand.y + bw * 0.78 + 4 },
    capX: 16 + capW / 2,
    oppCapY,
    oppCapMaxX: oppHand.x - backsHalf - 10,
    myCapY,
    floorTop,
    floorH,
    floorPos: (i: number, _n?: number) => {
      // 테이블 테두리(양쪽 약 18px) 안쪽에, 겹친 패가 오른쪽으로 나가도 들어오게
      const colW = (W - 40) / F.cols;
      return { x: 20 + ((i % F.cols) + 0.5) * colW - fw * 0.2, y: y0 + Math.floor(i / F.cols) * rowGap };
    },
    handPos: (i: number, n: number) => {
      const perRow = 5;
      const inRow = Math.min(perRow, n - Math.floor(i / perRow) * perRow);
      const step = Math.min(cw * 1.04, (W - 32) / perRow);
      return { x: W / 2 + ((i % perRow) - (inRow - 1) / 2) * step, y: Math.floor(i / perRow) === 0 && n > perRow ? handTopY : handBottomY };
    },
  };
}

/** 점수 알약 (세로 화면: 이름 대신). right면 x가 오른쪽 끝 */
function scoreChip(scene: PhaserNS.Scene, x: number, y: number, text: string, turn: boolean, k: number, right = false) {
  const T = theme();
  const fs = Math.round(13 * k);
  const tx = scene.add.text(8, 0, text, { fontFamily: T.FONT, fontSize: `${fs}px`, color: tc('ink') }).setOrigin(0, 0.5);
  const w = tx.width + 16;
  const h = fs + 10;
  const g = scene.add.graphics();
  g.fillStyle(turn ? T.COLOR.primary : T.COLOR.panel, 1).fillRoundedRect(0, -h / 2, w, h, h / 2);
  g.lineStyle(T.SHAPE.lineThin, T.COLOR.outline, 1).strokeRoundedRect(0, -h / 2, w, h, h / 2);
  return scene.add.container(right ? x - w : x, y + h / 2, [g, tx]).setDepth(5);
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
const TURN_MS = 2500;
const AT_PLAY = 0;
const AT_FLIP = 760;
const AT_TAKE = 1650;
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
/** 5광 컷인을 이미 보여 준 판:자리 */
const fiveGwang = new Set<string>();

const ui: GameUI<MatgoPublic, MatgoPrivate> = {
  game: 'matgo',
  title: '시아맞고',
  icon: '🎴',
  back: '',
  backLabel: 'SIA WORLD',
  felt: () => theme().COLOR.skyMid,

  preload(scene) {
    for (let m = 1; m <= 12; m++) scene.load.image(plantKey(m), plantUrl(m));
    for (const c of CARDS) scene.load.image(cardKey(c.id), cardUrl(c.id));
    scene.load.image(cardKey('back'), cardUrl('back'));
  },

  draw(t: Ctx) {
    const { scene } = t;
    const { W, H } = viewSize(scene);
    const p = t.pub;
    drawTable(scene, 'matgo');
    // 세로 화면(휴대폰): 이름은 위쪽 자리 줄에 있으니 테이블 이름패는 빼고 점수만, 손패는 다섯 장씩 두 줄
    const portrait = H > W * 1.15 || W < 520;
    const L = layout(W, H, portrait, p?.floor.length ?? 8);
    const { cw, fw, capW, k } = L;

    if (!p) {
      // 대기 중: 기본 화투를 깔아 둔다 (더미 + 양쪽 손패 뒷면)
      for (let i = 0; i < 6; i++) hwatu(scene, L.pile.x + i * 1.5, L.pile.y - i * 1.5, null, L.pw);
      for (let i = 0; i < 8; i++) {
        const { x, y } = L.floorPos(i, 8);
        hwatu(scene, x, y, null, fw).setAlpha(0.55);
      }
      for (let i = 0; i < 10; i++) hwatu(scene, L.oppHand.x + (i - 4.5) * L.backStep, L.oppHand.y, null, L.bw);
      for (let i = 0; i < 10; i++) {
        const { x, y } = L.handPos(i, 10);
        hwatu(scene, x, y, null, cw);
      }
      label(scene, W / 2, L.floorTop + L.floorH / 2, '모두 레디하면 시작해요', clamp(Math.min(W, H) * 0.05, 18, 30));
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

    // 상대: 점수(세로) 또는 이름패(가로) · 손패(뒷면) · 먹은 패
    const oppSub = `${op.score}점${op.go ? ` · ${op.go}고` : ''}${op.shakes ? ` · 흔들${op.shakes}` : ''}`;
    if (portrait) scoreChip(scene, L.oppScore.x, L.oppScore.y, oppSub, p.turn === opp, k);
    else nameTag(scene, 26 * k, 26 * k, t.seatName(opp), t.seatAvatar(opp), { turn: p.turn === opp, size: k, sub: oppSub });
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
      return { delay: pl.captureAt ?? AT_TAKE, sound: 'chip' };
    };
    captured(t, scene, L.capX, L.oppCapY, op, capW, L.oppCapMaxX, capOpts);

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
      if (f.ppeok || f.stacked) label(scene, x, y - fw * 0.95, f.ppeok ? '뻑' : '쌓임', clamp(fw * 0.26, 12, 20), tc('pink'));
    });
    // 더미
    for (let i = 0; i < 3; i++) hwatu(scene, pile.x + i * 2, pile.y - i * 2, null, L.pw);
    label(scene, pile.x, pile.y + L.pw * 0.95, `더미 ${p.pileCount}`, clamp(L.pw * 0.24, 12, 18));
    // 이번 차례에 낸 패·뒤집은 패 (가로 화면만)
    if (p.turnCards && !portrait) {
      const tcards = [...p.turnCards.played, ...(p.turnCards.flipped ? [p.turnCards.flipped] : [])];
      const tx = W * 0.925;
      tcards.forEach((id, i) => hwatu(scene, tx - i * fw * 0.45, pile.y, id, fw * 0.85));
      label(scene, tx, pile.y + fw * 1.0, '이번 차례', clamp(fw * 0.22, 12, 18));
    }
    if (p.nagariMul > 1) label(scene, W / 2, L.floorTop - 4, `나가리 ×${p.nagariMul}`, clamp(fw * 0.3, 14, 22), tc('primary'));

    // 나: 먹은 패 · 점수/이름패 · 손패
    captured(t, scene, L.capX, L.myCapY, mp, capW, W - 16, capOpts);
    const mySub = `${mp.score}점${mp.go ? ` · ${mp.go}고` : ''}${mp.bombFill ? ` · 폭탄피 ${mp.bombFill}` : ''}`;
    if (portrait) scoreChip(scene, W - 8, L.myCapY - capW * 0.78 - 30 * k, mySub, p.turn === me, k, true);
    else
      nameTag(scene, 26 * k, H - 28 * k, t.seatName(me), t.seatAvatar(me), {
        turn: p.turn === me,
        me: t.mySeat === me,
        size: k,
        sub: mySub,
      });
    // 공개 상태가 내 비공개 손패보다 먼저 도착하면 방금 낸 패가 두 곳에 보인다 → 이미 바닥·먹은 패에 있는 패는 손패에서 뺀다
    const shown = new Set<string>([...p.floor.flatMap((f) => f.cards), ...Object.values(P).flatMap(allCaptured)]);
    const hand = (t.priv?.hand ?? []).filter((id) => !shown.has(id));
    const canPlay = t.myTurn && p.choice?.kind === 'play';
    // 바닥에 같은 달이 있어 먹을 수 있는 패는 노란 테두리로 (고를 수 있는 패와 같은 표시)
    const floorMonths = new Set(p.floor.filter((f) => f.cards.length).map((f) => cardById(f.cards[0]).month));
    hand.forEach((id, i) => {
      const { x, y } = L.handPos(i, hand.length);
      t.track(
        hwatu(scene, x, y, id, cw, {
          lift: canPlay,
          glow: floorMonths.has(cardById(id).month),
          onClick: canPlay && !t.busy ? () => void t.act({ type: 'play', card: id, shake: shake && !!t.priv?.shakeable.includes(cardById(id).month) }) : undefined,
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
    if (!t.myTurn || !c) {
      // 내 차례여도 앞선 연출(패가 움직이는 중)이 끝나기 전에는 버튼 대신 안내
      el.innerHTML = `<p class="msg">${p.turn === null ? '' : p.turn === t.mySeat && c ? '패가 움직이는 중…' : `${esc(t.seatName(p.turn))} 차례…`}</p>`;
      return;
    }
    const dis = t.busy ? 'disabled' : '';
    if (c.kind === 'play') {
      const pv = t.priv;
      const shakeable = pv?.shakeable ?? [];
      const bombs = pv?.bombable ?? [];
      el.innerHTML = `<div class="row">
        ${shakeable.length ? `<label class="btn"><input type="checkbox" id="shake" ${shake ? 'checked' : ''}/> 흔들기 (${shakeable.map((m) => `${m}월`).join(', ')})</label>` : ''}
        ${bombs.map((m) => `<button class="btn primary" data-bomb="${m}" ${dis}>💣 ${m}월 폭탄</button>`).join('')}
        ${c.canFlip ? `<button class="btn" id="flip" ${dis}>더미 뒤집기 (폭탄 피)</button>` : ''}
      </div><p class="msg">낼 패를 누르세요 · 20초가 지나면 자동으로 내요</p>`;
      el.querySelector<HTMLInputElement>('#shake')?.addEventListener('change', (e) => (shake = (e.target as HTMLInputElement).checked));
      el.querySelectorAll<HTMLButtonElement>('[data-bomb]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'bomb', month: Number(b.dataset.bomb) })));
      el.querySelector('#flip')?.addEventListener('click', () => void t.act({ type: 'flip' }));
      return;
    }
    shake = false;
    if (c.kind === 'choose') {
      el.innerHTML = `<p class="msg">${c.stage === 'flip' ? '뒤집은 패로' : '낸 패로'} 가져올 패를 고르세요 (테이블에서 빛나는 패를 눌러도 돼요)</p><div class="row">${c.options
        .map((id) => `<button class="hw-pick" data-c="${id}" ${dis} title="${esc(cardById(id).name)}">${miniCard(id)}</button>`)
        .join('')}</div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'choose', card: b.dataset.c })));
      return;
    }
    if (c.kind === 'gukjin') {
      el.innerHTML = `<p class="msg">국진(9월 열끗)을 어떻게 쓸까요?</p><div class="row">
        <button class="btn big" data-g="yeol" ${dis}>열끗으로</button><button class="btn big primary" data-g="ssangpi" ${dis}>쌍피로</button></div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => b.addEventListener('click', () => void t.act({ type: 'gukjin', as: b.dataset.g })));
      return;
    }
    if (c.kind === 'goStop') {
      el.innerHTML = `<p class="msg">${c.score}점! 고 할까요, 스톱 할까요? (지금 ${c.go}고)</p><div class="row">
        <button class="btn big primary" id="go" ${dis}>고!</button><button class="btn big alt" id="stop" ${dis}>스톱</button></div>`;
      el.querySelector('#go')!.addEventListener('click', () => void t.act({ type: 'go' }));
      el.querySelector('#stop')!.addEventListener('click', () => void t.act({ type: 'stop' }));
    }
  },

  resultHtml(t: Ctx) {
    const r = (t.pub as unknown as { result?: MatgoSummary })?.result;
    if (!r) return '<p>판이 끝났어요</p>';
    if (r.result === 'nagari') return `<h3>🎴 나가리!</h3><p class="big">다음 판 ×${r.nextNagari}</p>`;
    const meWin = r.winner === t.resultSeat;
    const name = (seat: number) => t.pub?.players[seat]?.name ?? t.seatName(seat);
    const lines = r.breakdown.map((l) => `<tr><td>${esc(l.label)}</td><td>${l.points}점</td></tr>`).join('');
    const meLose = r.loser === t.resultSeat;
    return `<h3>🎴 ${esc(name(r.winner!))} 승리${r.chongtong ? ' (총통)' : ''}</h3>
      <p class="big ${meWin ? 'plus' : meLose ? 'minus' : ''}">${meWin ? '+' : meLose ? '-' : ''}${t.fmt(r.paid)}냥</p>
      <table>${lines}
        ${r.goCount ? `<tr><td>${r.goCount}고</td><td>+${r.goBonus}${r.goMultiplier > 1 ? ` ×${r.goMultiplier}` : ''}</td></tr>` : ''}
        <tr><td>최종 점수</td><td>${r.score}점</td></tr>
        ${r.multipliers.length ? `<tr><td>배수</td><td>${r.multipliers.map(esc).join(' · ')} (×${r.multiplier})</td></tr>` : ''}
        <tr><td>점당</td><td>${t.fmt(r.baseUnit)}냥</td></tr>
        <tr><td>계산</td><td>${t.fmt(r.amount)}냥${r.paid < r.amount ? ` → 가진 만큼 ${t.fmt(r.paid)}냥` : ''}</td></tr>
      </table>`;
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

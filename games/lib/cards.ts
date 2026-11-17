/**
 * Phaser용 테이블·카드·칩·이름패 그리기.
 * 디자인: '십이지신 놀이판' — 맞고는 군용담요, 카지노는 나전칠기 테이블. 색은 칠흑·자개·단청.
 */
import type PhaserNS from 'phaser';

type Scene = PhaserNS.Scene;
type Container = PhaserNS.GameObjects.Container;

/** 색 (단청 · 칠기 · 자개) */
export const C = {
  lacquer: 0x2a1712,
  lacquerHi: 0x4a2a20,
  pearl: 0xf3efe6,
  pearlBlue: 0xcfe8ef,
  pearlPink: 0xead2e6,
  vermilion: 0xd9452f,
  verdigris: 0x2f8f83,
  gold: 0xf2c14e,
  cream: 0xfff6e5,
  ink: 0x1d1a18,
  red: 0xc8372d,
};
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export const FONT = 'Jua, sans-serif';

const ZODIAC_ORDER = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

// ---------- 테이블 ----------

/**
 * 테이블 바닥.
 *  blanket: 맞고 군용담요 (올리브 모포 + 짠 결)
 *  lacquer: 카지노 나전칠기 테이블 (칠흑 테두리 + 자개 상감 + 가운데 펠트)
 */
export function drawTable(scene: Scene, kind: 'blanket' | 'lacquer', felt = 0x1f6b5a) {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const g = scene.add.graphics();
  if (kind === 'blanket') {
    g.fillStyle(0x56603a, 1).fillRect(0, 0, W, H);
    // 짠 결: 가는 가로·세로 실
    for (let y = 0; y < H; y += 4) g.lineStyle(1, y % 8 ? 0x4b5532 : 0x626d43, 0.55).lineBetween(0, y, W, y);
    for (let x = 0; x < W; x += 6) g.lineStyle(1, 0x3f482a, 0.18).lineBetween(x, 0, x, H);
    // 가장자리를 살짝 어둡게 (모포가 접혀 그늘진 느낌)
    for (let i = 0; i < 6; i++) g.lineStyle(14, 0x000000, 0.05).strokeRect(i * 7, i * 7, W - i * 14, H - i * 14);
    return g;
  }
  const rim = Math.max(14, Math.min(W, H) * 0.035);
  g.fillStyle(C.lacquer, 1).fillRect(0, 0, W, H);
  // 칠기 윤기
  g.fillStyle(C.lacquerHi, 0.35).fillRect(0, 0, W, rim * 0.5);
  // 펠트
  g.fillStyle(felt, 1).fillRoundedRect(rim, rim, W - rim * 2, H - rim * 2, rim * 1.6);
  // 펠트 안쪽 그늘
  g.lineStyle(rim * 0.6, 0x000000, 0.18).strokeRoundedRect(rim + rim * 0.3, rim + rim * 0.3, W - rim * 2.6, H - rim * 2.6, rim * 1.3);
  // 자개 상감: 무지갯빛 세 겹 선
  const inset = rim * 0.45;
  [C.pearl, C.pearlBlue, C.pearlPink].forEach((col, i) => {
    g.lineStyle(1.5, col, 0.85 - i * 0.2).strokeRoundedRect(inset + i * 1.5, inset + i * 1.5, W - (inset + i * 1.5) * 2, H - (inset + i * 1.5) * 2, rim * 1.8);
  });
  // 모서리 자개 꽃점
  for (const [x, y] of [[rim * 1.6, rim * 1.6], [W - rim * 1.6, rim * 1.6], [rim * 1.6, H - rim * 1.6], [W - rim * 1.6, H - rim * 1.6]]) {
    g.fillStyle(C.pearl, 0.9).fillCircle(x, y, 3);
    g.fillStyle(C.pearlBlue, 0.7).fillCircle(x - 6, y, 1.6).fillCircle(x + 6, y, 1.6).fillCircle(x, y - 6, 1.6).fillCircle(x, y + 6, 1.6);
  }
  return g;
}

// ---------- 카드 뒷면 ----------

/**
 * 카드 뒷면: 칠흑 바탕에 자개 원, 십이지신 12마리가 둘러선 문양. 한 번만 그려 텍스처로 둔다.
 * back-casino: 트럼프(칠흑) / back-hwatu: 화투(주홍)
 */
export function cardBack(scene: Scene, key: 'back-casino' | 'back-hwatu') {
  if (scene.textures.exists(key)) return key;
  const W = 140;
  const H = key === 'back-hwatu' ? 217 : 199;
  const bg = key === 'back-hwatu' ? C.red : C.lacquer;
  const rt = scene.textures.addDynamicTexture(key, W, H)!;
  const g = scene.make.graphics({}, false);
  g.fillStyle(bg, 1).fillRoundedRect(0, 0, W, H, 14);
  g.lineStyle(3, C.pearl, 0.9).strokeRoundedRect(7, 7, W - 14, H - 14, 9);
  g.lineStyle(1.5, C.pearlBlue, 0.8).strokeRoundedRect(11, 11, W - 22, H - 22, 7);
  g.fillStyle(0x000000, 0.18).fillCircle(W / 2, H / 2, W * 0.42);
  g.lineStyle(2, C.gold, 0.9).strokeCircle(W / 2, H / 2, W * 0.36);
  g.fillStyle(C.gold, 1).fillCircle(W / 2, H / 2, 7);
  g.lineStyle(1.5, C.pearl, 0.8).strokeCircle(W / 2, H / 2, 12);
  rt.draw(g);
  ZODIAC_ORDER.forEach((z, i) => {
    if (!scene.textures.exists(`av-${z}`)) return;
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const img = scene.make.image({ key: `av-${z}`, add: false });
    img.setScale(30 / Math.max(img.width, img.height));
    rt.draw(img, W / 2 + Math.cos(a) * W * 0.36, H / 2 + Math.sin(a) * W * 0.36);
    img.destroy();
  });
  g.destroy();
  return key;
}

// ---------- 트럼프 ----------

const SUIT: Record<string, { sym: string; red: boolean; band: number }> = {
  S: { sym: '♠', red: false, band: C.verdigris },
  D: { sym: '◆', red: true, band: C.gold },
  H: { sym: '♥', red: true, band: C.vermilion },
  C: { sym: '♣', red: false, band: 0x3b5ba5 },
};

/** J·Q·K의 십이지신 (♠ 쥐소호랑이 / ◆ 토끼용뱀 / ♥ 말양원숭이 / ♣ 닭개돼지) */
export const FACE_ANIMAL: Record<string, Record<string, string>> = {
  S: { J: 'rat', Q: 'ox', K: 'tiger' },
  D: { J: 'rabbit', Q: 'dragon', K: 'snake' },
  H: { J: 'horse', Q: 'sheep', K: 'monkey' },
  C: { J: 'rooster', Q: 'dog', K: 'pig' },
};

/** 'AS', '10H', 'TD' → { rank: 'A'|'10'…, suit } */
export function parseCard(code: string) {
  const suit = code.slice(-1);
  let rank = code.slice(0, -1);
  if (rank === 'T') rank = '10';
  return { rank, suit };
}

export const cardLabel = (code: string) => {
  const { rank, suit } = parseCard(code);
  return `${rank}${SUIT[suit]?.sym ?? suit}`;
};

/** 트럼프 한 장 (code가 null이면 뒷면). 가운데 기준 */
export function playingCard(scene: Scene, x: number, y: number, code: string | null, w = 56, opts: { dim?: boolean; lift?: boolean } = {}) {
  const h = Math.round(w * 1.42);
  const r = Math.max(4, w * 0.09);
  const c = scene.add.container(x, y - (opts.lift ? w * 0.16 : 0));
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.3).fillRoundedRect(-w / 2 + 2, -h / 2 + 4, w, h, r);
  c.add(g);
  if (!code) {
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-casino')).setDisplaySize(w, h));
    if (opts.dim) c.setAlpha(0.4);
    return c;
  }
  const { rank, suit } = parseCard(code);
  const s = SUIT[suit] ?? { sym: suit, red: false, band: C.verdigris };
  const color = s.red ? hex(C.red) : hex(C.ink);
  g.fillStyle(0xfffaf0, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.lineStyle(Math.max(1, w * 0.02), 0xcbbfa8, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  const fs = Math.round(w * 0.27);
  const corner = `${rank}\n${s.sym}`;
  const style = { fontFamily: FONT, fontSize: `${fs}px`, color, lineSpacing: -fs * 0.25, align: 'center' };
  c.add(scene.add.text(-w / 2 + w * 0.07, -h / 2 + w * 0.04, corner, style));
  c.add(scene.add.text(w / 2 - w * 0.07, h / 2 - w * 0.04, corner, style).setOrigin(0, 0).setAngle(180));
  const animal = FACE_ANIMAL[suit]?.[rank];
  if (animal && scene.textures.exists(`av-${animal}`)) {
    // 그림 카드: 무늬 색 단청 띠 + 십이지신
    g.fillStyle(s.band, 0.22).fillRoundedRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6, w * 0.06);
    g.lineStyle(Math.max(1.5, w * 0.03), s.band, 0.9).strokeRoundedRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6, w * 0.06);
    const img = scene.add.image(0, h * 0.02, `av-${animal}`);
    img.setScale((w * 0.56) / Math.max(img.width, img.height));
    c.add(img);
  } else {
    c.add(scene.add.text(0, h * 0.04, s.sym, { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.6)}px`, color }).setOrigin(0.5));
  }
  if (opts.dim) c.setAlpha(0.4);
  return c;
}

// ---------- 칩 · 이름패 · 글자 ----------

/** 칩 더미: 10,000 이상 용 · 1,000 이상 호랑이 · 그 아래 쥐 */
export function chipStack(scene: Scene, x: number, y: number, amount: number, label?: string, size = 16) {
  const c = scene.add.container(x, y);
  const [color, animal] = amount >= 10000 ? [C.lacquer, 'dragon'] : amount >= 1000 ? [C.vermilion, 'tiger'] : [C.verdigris, 'rat'];
  const g = scene.add.graphics();
  const n = amount >= 10000 ? 4 : amount >= 1000 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    g.fillStyle(color, 1).fillCircle(0, -i * size * 0.28, size);
    g.lineStyle(size * 0.18, C.pearl, 0.95).strokeCircle(0, -i * size * 0.28, size * 0.8);
  }
  c.add(g);
  const top = -(n - 1) * size * 0.28;
  if (scene.textures.exists(`av-${animal}`)) {
    const img = scene.add.image(0, top, `av-${animal}`);
    img.setScale((size * 1.15) / Math.max(img.width, img.height));
    c.add(img);
  }
  c.add(
    scene.add
      .text(0, size + 2, label ?? amount.toLocaleString('ko-KR'), { fontFamily: FONT, fontSize: `${Math.round(size * 0.95)}px`, color: hex(C.cream), stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5, 0),
  );
  return c;
}

/** 이름패: 자개 바탕 + 아바타 + 이름 (+ 작은 설명). turn이면 금빛 테두리 */
export function nameTag(scene: Scene, x: number, y: number, name: string, avatar: string, opts: { turn?: boolean; me?: boolean; sub?: string; size?: number } = {}) {
  const k = opts.size ?? 1;
  const c = scene.add.container(x, y);
  const text = scene.add.text(22 * k, opts.sub ? -8 * k : 0, name, { fontFamily: FONT, fontSize: `${Math.round(16 * k)}px`, color: hex(C.ink) }).setOrigin(0, 0.5);
  const sub = opts.sub ? scene.add.text(22 * k, 10 * k, opts.sub, { fontFamily: FONT, fontSize: `${Math.round(12 * k)}px`, color: '#6b5a4a' }).setOrigin(0, 0.5) : null;
  const wdt = Math.max(text.width, sub?.width ?? 0) + 34 * k;
  const ht = (opts.sub ? 40 : 30) * k;
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-20 * k + 1, -ht / 2 + 3, wdt + 6 * k, ht, ht / 2);
  g.fillStyle(C.pearl, 0.96).fillRoundedRect(-20 * k, -ht / 2, wdt + 6 * k, ht, ht / 2);
  g.lineStyle(1.5, C.pearlBlue, 1).strokeRoundedRect(-18 * k, -ht / 2 + 2, wdt + 2 * k, ht - 4, ht / 2 - 2);
  if (opts.turn) g.lineStyle(3.5 * k, C.gold, 1).strokeRoundedRect(-22 * k, -ht / 2 - 2, wdt + 10 * k, ht + 4, ht / 2 + 2);
  else if (opts.me) g.lineStyle(2, C.vermilion, 0.9).strokeRoundedRect(-21 * k, -ht / 2 - 1, wdt + 8 * k, ht + 2, ht / 2 + 1);
  // 아바타 자리
  g.fillStyle(opts.turn ? C.gold : 0xe6dccb, 1).fillCircle(0, 0, 17 * k);
  c.add(g);
  if (scene.textures.exists(`av-${avatar}`)) {
    const img = scene.add.image(0, 0, `av-${avatar}`);
    img.setScale((30 * k) / Math.max(img.width, img.height));
    c.add(img);
  }
  c.add(text);
  if (sub) c.add(sub);
  return c;
}

/** 테이블 위 글자 (테두리 있는 크림색) */
export const label = (scene: Scene, x: number, y: number, text: string, size = 16, color = hex(C.cream)) =>
  scene.add.text(x, y, text, { fontFamily: FONT, fontSize: `${Math.round(size)}px`, color, stroke: '#1d1210', strokeThickness: Math.max(3, size * 0.22), align: 'center' }).setOrigin(0.5);

/** 숫자 범위 제한 */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type { Container };

/**
 * Phaser용 테이블·카드·칩·이름패 그리기. DESIGN.md를 따른다.
 * 색·모양 값은 shared/theme.js에서만 가져온다 (여기서 색 코드를 직접 쓰지 않는다).
 * 스티커/장난감 질감: 굵은 갈색 외곽선 + 크림 판 + 노란 강조, 흐린 그림자 대신 아래쪽 두께.
 */
import type PhaserNS from 'phaser';
import type { ThemeModule } from './world.ts';

type Scene = PhaserNS.Scene;
type Container = PhaserNS.GameObjects.Container;

let T: ThemeModule;
/** 시작할 때 shared/theme.js를 넣어 준다 (bootGame) */
export function setTheme(t: ThemeModule) {
  T = t;
}
export const theme = () => T;
const css = (n: number) => T.css(n);
/** 테마 색 이름 → '#rrggbb' (Phaser 글자색 등) */
export const tc = (k: keyof ThemeModule['COLOR']) => T.css(T.COLOR[k]);

const ZODIAC_ORDER = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

/** 모양 값을 카드 크기에 맞춰 늘이고 줄인다 (기준 가로 w0에서 v px) */
const scaled = (v: number, w: number, w0: number) => Math.max(v * 0.6, (v * w) / w0);

// ---------- 테이블 ----------

/**
 * 테이블: 게임별 보조색의 둥근 판 + 굵은 외곽선 + 가장자리 크림 테두리 (평평한 단색, 펠트 질감 없음)
 */
export function drawTable(scene: Scene, game: 'matgo' | 'poker' | 'holdem' | 'blackjack') {
  const { W, H } = viewSize(scene);
  const g = scene.add.graphics();
  const C = T.COLOR;
  const m = Math.max(6, Math.min(W, H) * 0.012);
  const rim = Math.max(10, Math.min(W, H) * 0.025);
  const r = T.SHAPE.radiusPanelBig;
  // 크림 테두리 판 (외곽선 + 아래 두께)
  g.fillStyle(C.outline, 1).fillRoundedRect(m, m + T.SHAPE.depthPanel, W - m * 2, H - m * 2 - T.SHAPE.depthPanel, r);
  g.fillStyle(C.panel, 1).fillRoundedRect(m, m, W - m * 2, H - m * 2 - T.SHAPE.depthPanel, r);
  g.lineStyle(T.SHAPE.lineBig, C.outline, 1).strokeRoundedRect(m, m, W - m * 2, H - m * 2 - T.SHAPE.depthPanel, r);
  // 게임 색 판
  const x = m + rim;
  const y = m + rim;
  const w = W - (m + rim) * 2;
  const h = H - (m + rim) * 2 - T.SHAPE.depthPanel;
  g.fillStyle(T.TABLE[game], 1).fillRoundedRect(x, y, w, h, r - 6);
  g.lineStyle(T.SHAPE.line, C.outline, 1).strokeRoundedRect(x, y, w, h, r - 6);
  return g;
}

// ---------- 카드 뒷면 ----------

/**
 * 카드 뒷면: --primary(노랑) 바탕에 12띠가 원형으로 둘러선 문양. 한 번만 그려 텍스처로 둔다.
 * back-casino: 트럼프 / back-hwatu: 화투 (같은 무늬, 화투 비율)
 */
export function cardBack(scene: Scene, key: 'back-casino' | 'back-hwatu') {
  if (scene.textures.exists(key)) return key;
  const C = T.COLOR;
  const W = 140;
  const H = key === 'back-hwatu' ? 217 : 199;
  const rt = scene.textures.addDynamicTexture(key, W, H)!;
  const g = scene.make.graphics({}, false);
  const r = key === 'back-hwatu' ? 18 : 16;
  g.fillStyle(C.outline, 1).fillRoundedRect(0, 0, W, H, r);
  g.fillStyle(C.primary, 1).fillRoundedRect(4, 4, W - 8, H - 8, r - 3);
  g.lineStyle(3, C.white, 0.9).strokeRoundedRect(11, 11, W - 22, H - 22, r - 6);
  g.fillStyle(C.panel, 1).fillCircle(W / 2, H / 2, W * 0.43);
  g.lineStyle(3, C.outline, 1).strokeCircle(W / 2, H / 2, W * 0.43);
  g.fillStyle(C.primaryDeep, 1).fillCircle(W / 2, H / 2, 10);
  g.lineStyle(2.5, C.outline, 1).strokeCircle(W / 2, H / 2, 10);
  rt.draw(g);
  ZODIAC_ORDER.forEach((z, i) => {
    if (!scene.textures.exists(`av-${z}`)) return;
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const img = scene.make.image({ key: `av-${z}`, add: false });
    img.setScale(30 / Math.max(img.width, img.height));
    rt.draw(img, W / 2 + Math.cos(a) * W * 0.32, H / 2 + Math.sin(a) * W * 0.32);
    img.destroy();
  });
  g.destroy();
  return key;
}

// ---------- 트럼프 ----------

/** J·Q·K의 십이지신 (♠ 찍찍이·우직이·어흥이 / ◆ 깡총이·여의룡·스르르 / ♥ 따각이·몽실이·재롱이 / ♣ 꼬꼬댁·멍뭉이·꿀꿀이) */
export const FACE_ANIMAL: Record<string, Record<string, string>> = {
  S: { J: 'rat', Q: 'ox', K: 'tiger' },
  D: { J: 'rabbit', Q: 'dragon', K: 'snake' },
  H: { J: 'horse', Q: 'sheep', K: 'monkey' },
  C: { J: 'rooster', Q: 'dog', K: 'pig' },
};
const SUIT_SYM: Record<string, string> = { S: '♠', D: '◆', H: '♥', C: '♣' };

/** 'AS', '10H', 'TD' → { rank: 'A'|'10'…, suit } */
export function parseCard(code: string) {
  const suit = code.slice(-1);
  let rank = code.slice(0, -1);
  if (rank === 'T') rank = '10';
  return { rank, suit };
}

export const cardLabel = (code: string) => {
  const { rank, suit } = parseCard(code);
  return `${rank}${SUIT_SYM[suit] ?? suit}`;
};

/**
 * 트럼프 한 장 (code가 null이면 뒷면). 가운데 기준.
 * 앞면: 흰 바탕, 모서리 10px(가로 90px 기준), 외곽선 2px. ♠♣ 갈색, ♥◆ 빨강. 아래 두께로 입체감.
 */
export function playingCard(scene: Scene, x: number, y: number, code: string | null, w = 56, opts: { dim?: boolean; lift?: boolean } = {}) {
  const C = T.COLOR;
  const h = Math.round(w * 1.42);
  const r = scaled(T.SHAPE.radiusCard, w, 90);
  const line = Math.max(T.SHAPE.lineThin, w * 0.025);
  const depth = Math.max(2, w * 0.04);
  const c = scene.add.container(x, y - (opts.lift ? w * 0.16 : 0));
  const g = scene.add.graphics();
  g.fillStyle(C.outline, 1).fillRoundedRect(-w / 2, -h / 2 + depth, w, h, r);
  c.add(g);
  if (!code) {
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-casino')).setDisplaySize(w, h));
    if (opts.dim) c.setAlpha(0.45);
    return c;
  }
  const { rank, suit } = parseCard(code);
  const red = suit === 'H' || suit === 'D';
  const color = css(red ? C.cardRed : C.outline);
  g.fillStyle(C.white, 1).fillRoundedRect(-w / 2, -h / 2, w, h, r);
  g.lineStyle(line, C.outline, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  const fs = Math.round(w * 0.27);
  const corner = `${rank}\n${SUIT_SYM[suit] ?? suit}`;
  const style = { fontFamily: T.FONT, fontSize: `${fs}px`, color, lineSpacing: -fs * 0.25, align: 'center' };
  c.add(scene.add.text(-w / 2 + w * 0.08, -h / 2 + w * 0.05, corner, style));
  c.add(scene.add.text(w / 2 - w * 0.08, h / 2 - w * 0.05, corner, style).setOrigin(0, 0).setAngle(180));
  const animal = FACE_ANIMAL[suit]?.[rank];
  if (animal && scene.textures.exists(`full-${animal}`)) {
    // 그림 카드: 크림 액자 + 십이지신 캐릭터
    g.fillStyle(C.panelStrong, 1).fillRoundedRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6, w * 0.08);
    g.lineStyle(line, C.outline, 1).strokeRoundedRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6, w * 0.08);
    const img = scene.add.image(0, h * 0.02, `full-${animal}`);
    img.setScale(Math.min((w * 0.54) / img.width, (h * 0.56) / img.height));
    c.add(img);
  } else {
    c.add(scene.add.text(0, h * 0.04, SUIT_SYM[suit] ?? suit, { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.6)}px`, color }).setOrigin(0.5));
  }
  if (opts.dim) c.setAlpha(0.45);
  return c;
}

// ---------- 칩 · 이름패 · 글자 ----------

/** 칩: 둥근 칩, 외곽선 2px, 가장자리 점무늬. 100 찍찍이 · 500 깡총이 · 1,000 어흥이 · 10,000 여의룡 */
export function chipStack(scene: Scene, x: number, y: number, amount: number, label?: string, size = 16) {
  const C = T.COLOR;
  const chip = T.CHIPS.find((c) => amount >= c.min) ?? T.CHIPS[T.CHIPS.length - 1];
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const n = amount >= 10000 ? 4 : amount >= 1000 ? 3 : 2;
  const step = size * 0.3;
  for (let i = 0; i < n; i++) {
    const cy = -i * step;
    g.fillStyle(chip.color, 1).fillCircle(0, cy, size);
    g.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeCircle(0, cy, size);
    // 가장자리 점무늬
    g.fillStyle(C.white, 1);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.fillCircle(Math.cos(a) * size * 0.78, cy + Math.sin(a) * size * 0.78, Math.max(1.5, size * 0.11));
    }
  }
  const top = -(n - 1) * step;
  g.fillStyle(C.white, 1).fillCircle(0, top, size * 0.58);
  g.lineStyle(T.SHAPE.lineThin, C.outline, 1).strokeCircle(0, top, size * 0.58);
  c.add(g);
  if (scene.textures.exists(`av-${chip.animal}`)) {
    const img = scene.add.image(0, top, `av-${chip.animal}`);
    img.setScale((size * 1.0) / Math.max(img.width, img.height));
    c.add(img);
  }
  c.add(text(scene, 0, size + 4, label ?? amount.toLocaleString('ko-KR'), Math.round(size * 0.95), css(C.white)).setOrigin(0.5, 0));
  return c;
}

/**
 * 자리 이름패: 원형 아바타(흰 바탕 + 외곽선) + 닉네임 알약 (+ 작은 설명).
 * 차례: 알약이 --primary(노랑), 나: 외곽선 굵게
 */
export function nameTag(scene: Scene, x: number, y: number, name: string, avatar: string, opts: { turn?: boolean; me?: boolean; sub?: string; size?: number } = {}) {
  const C = T.COLOR;
  const k = opts.size ?? 1;
  const c = scene.add.container(x, y);
  const nm = scene.add.text(26 * k, opts.sub ? -8 * k : 0, name, { fontFamily: T.FONT, fontSize: `${Math.round(16 * k)}px`, color: css(C.ink) }).setOrigin(0, 0.5);
  const sub = opts.sub ? scene.add.text(26 * k, 10 * k, opts.sub, { fontFamily: T.FONT, fontSize: `${Math.round(12 * k)}px`, color: css(C.inkSoft) }).setOrigin(0, 0.5) : null;
  const wdt = Math.max(nm.width, sub?.width ?? 0) + 40 * k;
  const ht = (opts.sub ? 40 : 30) * k;
  const line = opts.me ? T.SHAPE.line : T.SHAPE.lineThin;
  const g = scene.add.graphics();
  // 알약 (아래 두께 + 외곽선)
  g.fillStyle(C.outline, 1).fillRoundedRect(-4 * k, -ht / 2 + 3, wdt, ht, ht / 2);
  g.fillStyle(opts.turn ? C.primary : C.panel, 1).fillRoundedRect(-4 * k, -ht / 2, wdt, ht, ht / 2);
  g.lineStyle(line, C.outline, 1).strokeRoundedRect(-4 * k, -ht / 2, wdt, ht, ht / 2);
  // 원형 아바타 프레임
  g.fillStyle(C.white, 1).fillCircle(0, 0, 19 * k);
  g.lineStyle(line, C.outline, 1).strokeCircle(0, 0, 19 * k);
  c.add(g);
  // 얼굴은 원 모양으로 잘라 둔 그림(avc-)을 원 안쪽 크기에 딱 맞게 (원을 넘거나 잘리지 않게)
  const face = scene.textures.exists(`avc-${avatar}`) ? `avc-${avatar}` : `av-${avatar}`;
  if (scene.textures.exists(face)) {
    const img = scene.add.image(0, 0, face);
    img.setScale((36 * k) / Math.max(img.width, img.height));
    c.add(img);
  }
  c.add(nm);
  if (sub) c.add(sub);
  return c;
}

/** 테이블 위 글자: 흰 글자 + 진한 갈색 외곽선 */
export function text(scene: Scene, x: number, y: number, s: string, size = 16, color?: string) {
  return scene.add
    .text(x, y, s, {
      fontFamily: T.FONT,
      fontSize: `${Math.round(size)}px`,
      color: color ?? css(T.COLOR.white),
      stroke: css(T.COLOR.outline),
      strokeThickness: Math.max(3, size * 0.2),
      align: 'center',
    })
    .setOrigin(0.5);
}
export const label = text;

/** 숫자 범위 제한 */
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type { Container };

/** 테이블의 CSS 픽셀 크기 (캔버스는 기기 해상도만큼 크고 카메라 확대로 맞춘다) */
export function viewSize(scene: PhaserNS.Scene) {
  const z = scene.cameras.main?.zoom || 1;
  return { W: scene.scale.width / z, H: scene.scale.height / z };
}

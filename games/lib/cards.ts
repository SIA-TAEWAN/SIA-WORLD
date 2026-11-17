/**
 * Phaser용 카드·칩 그리기 (임시 그래픽: 색 박스 + 글자. 5단계에서 그림으로 바꾼다)
 */
import type PhaserNS from 'phaser';

type Scene = PhaserNS.Scene;

const SUIT: Record<string, { sym: string; red: boolean }> = {
  S: { sym: '♠', red: false },
  D: { sym: '◆', red: true },
  H: { sym: '♥', red: true },
  C: { sym: '♣', red: false },
};

/** J·Q·K의 십이지신 (♠ 쥐소호랑이 / ◆ 토끼용뱀 / ♥ 말양원숭이 / ♣ 닭개돼지) */
export const FACE_ANIMAL: Record<string, Record<string, string>> = {
  S: { J: 'rat', Q: 'ox', K: 'tiger' },
  D: { J: 'rabbit', Q: 'dragon', K: 'snake' },
  H: { J: 'horse', Q: 'sheep', K: 'monkey' },
  C: { J: 'rooster', Q: 'dog', K: 'pig' },
};

const ZODIAC_ORDER = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];

/**
 * 카드 뒷면 그림: 십이지신 12마리가 원형으로 둘러선 문양. 한 번만 그려서 텍스처로 저장한다.
 * key: 'back-purple'(트럼프) / 'back-red'(화투)
 */
export function cardBack(scene: Scene, key: 'back-purple' | 'back-red') {
  if (scene.textures.exists(key)) return key;
  const W = 120;
  const H = key === 'back-red' ? 186 : 170;
  const [bg, line] = key === 'back-red' ? [0xb3262e, 0xf5d36b] : [0x6a2a85, 0xf5d36b];
  // DynamicTexture는 텍스처 관리자에 남는다 (테이블을 다시 그려도 지워지지 않음)
  const rt = scene.textures.addDynamicTexture(key, W, H)!;
  const g = scene.make.graphics({}, false);
  g.fillStyle(bg, 1).fillRoundedRect(0, 0, W, H, 12);
  g.lineStyle(4, line, 1).strokeRoundedRect(6, 6, W - 12, H - 12, 8);
  g.lineStyle(2, line, 0.8).strokeCircle(W / 2, H / 2, W * 0.36);
  g.fillStyle(line, 1).fillCircle(W / 2, H / 2, 6);
  rt.draw(g);
  ZODIAC_ORDER.forEach((z, i) => {
    if (!scene.textures.exists(`av-${z}`)) return;
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const img = scene.make.image({ key: `av-${z}`, add: false });
    img.setScale(26 / Math.max(img.width, img.height));
    rt.draw(img, W / 2 + Math.cos(a) * W * 0.36, H / 2 + Math.sin(a) * W * 0.36);
    img.destroy();
  });
  g.destroy();
  return key;
}

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
  const c = scene.add.container(x, y - (opts.lift ? 10 : 0));
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, 6);
  if (!code) {
    c.add(g);
    c.add(scene.add.image(0, 0, cardBack(scene, 'back-purple')).setDisplaySize(w, h));
    if (opts.dim) c.setAlpha(0.45);
    return c;
  }
  const { rank, suit } = parseCard(code);
  const s = SUIT[suit] ?? { sym: suit, red: false };
  const color = s.red ? '#d0312d' : '#1b1b1b';
  g.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 6);
  g.lineStyle(1.5, 0x333333, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  c.add(g);
  const fs = Math.round(w * 0.3);
  c.add(scene.add.text(-w / 2 + 4, -h / 2 + 2, `${rank}\n${s.sym}`, { fontFamily: 'Jua, sans-serif', fontSize: `${fs}px`, color, lineSpacing: -4 }));
  const animal = FACE_ANIMAL[suit]?.[rank];
  if (animal && scene.textures.exists(`av-${animal}`)) {
    const img = scene.add.image(0, h * 0.1, `av-${animal}`);
    img.setScale((w * 0.62) / Math.max(img.width, img.height));
    c.add(img);
  } else {
    c.add(scene.add.text(0, h * 0.08, s.sym, { fontFamily: 'sans-serif', fontSize: `${Math.round(w * 0.55)}px`, color }).setOrigin(0.5));
  }
  if (opts.dim) c.setAlpha(0.45);
  return c;
}

/** 칩 더미 (금액 표시). 칩 그림: 10,000 이상 용 · 1,000 이상 호랑이 · 그 아래 쥐 */
export function chipStack(scene: Scene, x: number, y: number, amount: number, label?: string) {
  const c = scene.add.container(x, y);
  const [color, animal] = amount >= 10000 ? [0x1b1b1b, 'dragon'] : amount >= 1000 ? [0xd0312d, 'tiger'] : [0x2d6fd0, 'rat'];
  const g = scene.add.graphics();
  for (let i = 0; i < 3; i++) {
    g.fillStyle(color, 1).fillCircle(0, -i * 4, 15);
    g.lineStyle(2, 0xffffff, 0.9).strokeCircle(0, -i * 4, 15);
  }
  g.lineStyle(2, 0xffffff, 0.7).strokeCircle(0, -8, 10);
  c.add(g);
  if (scene.textures.exists(`av-${animal}`)) {
    const img = scene.add.image(0, -9, `av-${animal}`);
    img.setScale(18 / Math.max(img.width, img.height));
    c.add(img);
  }
  c.add(
    scene.add
      .text(0, 14, label ?? amount.toLocaleString('ko-KR'), { fontFamily: 'Jua, sans-serif', fontSize: '14px', color: '#fff', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5, 0),
  );
  return c;
}

/** 이름표 (아바타 + 이름) */
export function nameTag(scene: Scene, x: number, y: number, name: string, avatar: string, opts: { turn?: boolean; me?: boolean; sub?: string } = {}) {
  const c = scene.add.container(x, y);
  const text = scene.add.text(18, 0, name, { fontFamily: 'Jua, sans-serif', fontSize: '15px', color: '#fff' }).setOrigin(0, 0.5);
  const sub = opts.sub ? scene.add.text(18, 16, opts.sub, { fontFamily: 'Jua, sans-serif', fontSize: '12px', color: '#ffe9a8' }).setOrigin(0, 0.5) : null;
  const wdt = Math.max(text.width, sub?.width ?? 0) + 34;
  const g = scene.add.graphics();
  g.fillStyle(opts.turn ? 0xff8a3d : 0x000000, opts.turn ? 0.95 : 0.45).fillRoundedRect(-18, -16, wdt, sub ? 42 : 32, 14);
  if (opts.me) g.lineStyle(2, 0xf5b81c, 1).strokeRoundedRect(-18, -16, wdt, sub ? 42 : 32, 14);
  c.add(g);
  if (scene.textures.exists(`av-${avatar}`)) {
    const img = scene.add.image(0, 0, `av-${avatar}`);
    img.setScale(34 / Math.max(img.width, img.height));
    c.add(img);
  }
  c.add(text);
  if (sub) c.add(sub);
  return c;
}

export const label = (scene: Scene, x: number, y: number, text: string, size = 16, color = '#ffffff') =>
  scene.add.text(x, y, text, { fontFamily: 'Jua, sans-serif', fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5);

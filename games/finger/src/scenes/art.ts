import Phaser from 'phaser';
import { COLOR } from '../theme';

/**
 * 그림을 못 읽었을 때 쓰는 코드 그림 (돌격대 src/scenes/art.ts 와 같은 규칙: 그림이 있으면 그림, 없으면 코드 그림).
 * 요괴·보스·바닥·효과 그림은 public/art (ASSETS.md) 에서 읽는다. 같은 이름의 텍스처를 코드로 만들어 두면
 * 판은 그림이 있든 없든 같은 키로 그린다.
 */

/** 요괴 대신: 둥근 몸 + 뿔 + 눈 (색은 이름으로 정한다) */
function foeFallback(scene: Phaser.Scene, key: string, size: number) {
  const g = scene.make.graphics({}, false);
  const r = size / 2 - 6;
  const palette = [COLOR.pink, COLOR.teamA, COLOR.win, COLOR.accent, COLOR.lose];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 997;
  const body = palette[h % palette.length];
  g.fillStyle(COLOR.outline, 1).fillTriangle(size / 2 - r * 0.6, size / 2 - r * 0.55, size / 2 - r * 0.3, 2, size / 2 - r * 0.05, size / 2 - r * 0.7);
  g.fillTriangle(size / 2 + r * 0.6, size / 2 - r * 0.55, size / 2 + r * 0.3, 2, size / 2 + r * 0.05, size / 2 - r * 0.7);
  g.fillStyle(body, 1).fillCircle(size / 2, size / 2 + 4, r - 4);
  g.lineStyle(6, COLOR.outline, 1).strokeCircle(size / 2, size / 2 + 4, r - 4);
  g.fillStyle(COLOR.white, 1).fillCircle(size / 2 - r * 0.32, size / 2, r * 0.2).fillCircle(size / 2 + r * 0.32, size / 2, r * 0.2);
  g.fillStyle(COLOR.outline, 1).fillCircle(size / 2 - r * 0.28, size / 2 + 2, r * 0.1).fillCircle(size / 2 + r * 0.28, size / 2 + 2, r * 0.1);
  g.generateTexture(key, size, size);
  g.destroy();
}

/** 바닥 대신: 옅은 체크 무늬 */
function tileFallback(scene: Phaser.Scene, key: string) {
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLOR.track, 1).fillRect(0, 0, 128, 128);
  g.fillStyle(COLOR.lineSoft, 1).fillRect(0, 0, 64, 64).fillRect(64, 64, 64, 64);
  g.generateTexture(key, 128, 128);
  g.destroy();
}

/** 터짐 대신: 노란 별 */
function popFallback(scene: Phaser.Scene, key: string) {
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLOR.primary, 1).fillCircle(32, 32, 22);
  g.lineStyle(5, COLOR.outline, 1).strokeCircle(32, 32, 22);
  g.generateTexture(key, 64, 64);
  g.destroy();
}

/** 표창 대신 */
function shurikenFallback(scene: Phaser.Scene, key: string) {
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLOR.lineSoft, 1).fillTriangle(16, 0, 20, 16, 12, 16).fillTriangle(16, 32, 20, 16, 12, 16).fillTriangle(0, 16, 16, 12, 16, 20).fillTriangle(32, 16, 16, 12, 16, 20);
  g.lineStyle(2, COLOR.outline, 1).strokeCircle(16, 16, 4);
  g.generateTexture(key, 32, 32);
  g.destroy();
}

/** 엽전 대신 */
function coinFallback(scene: Phaser.Scene, key: string) {
  const g = scene.make.graphics({}, false);
  g.fillStyle(COLOR.primary, 1).fillCircle(24, 24, 20);
  g.lineStyle(4, COLOR.outline, 1).strokeCircle(24, 24, 20);
  g.fillStyle(COLOR.outline, 1).fillRect(18, 18, 12, 12);
  g.generateTexture(key, 48, 48);
  g.destroy();
}

/** 못 읽은 그림 키를 코드 그림으로 채운다 (load 가 끝난 뒤 create 에서 부른다) */
export function ensureArt(scene: Phaser.Scene, keys: string[]) {
  for (const k of keys) {
    if (scene.textures.exists(k)) continue;
    if (k.startsWith('tile-')) tileFallback(scene, k);
    else if (k === 'fx-pop') popFallback(scene, k);
    else if (k === 'fx-coin') coinFallback(scene, k);
    else if (k === 'p-shuriken') shurikenFallback(scene, k);
    else foeFallback(scene, k, k.startsWith('b-') ? 256 : 128);
  }
}

/**
 * 대원 구슬: 얼굴 그림을 동그랗게 잘라 넣고 굵은 테두리 (반사형 파랑 · 관통형 주황).
 * 얼굴 그림을 못 읽었으면 흰 구슬에 이름 첫 글자.
 */
export function makeBall(scene: Phaser.Scene, key: string, faceKey: string, ring: number, label: string) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const S = 128;
  const tex = scene.textures.createCanvas(key, S, S);
  if (!tex) return;
  const ctx = tex.getContext();
  const c = S / 2;
  const ringW = 12;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fillStyle = hex(COLOR.panel);
  ctx.fill();
  const src = scene.textures.exists(faceKey) ? (scene.textures.get(faceKey).getSourceImage() as HTMLImageElement) : null;
  if (src && src.width) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - ringW, 0, Math.PI * 2);
    ctx.clip();
    const k = (S - ringW * 2 + 8) / Math.max(src.width, src.height);
    const w = src.width * k;
    const h = src.height * k;
    ctx.drawImage(src, c - w / 2, c - h / 2 + 4, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = hex(COLOR.ink);
    ctx.font = "56px Jua, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, c, c + 4);
  }
  ctx.beginPath();
  ctx.arc(c, c, c - ringW / 2 - 2, 0, Math.PI * 2);
  ctx.lineWidth = ringW;
  ctx.strokeStyle = hex(ring);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = hex(COLOR.outline);
  ctx.stroke();
  tex.refresh();
}

const SLICE_FRAMES = ['tl', 't', 'tr', 'l', 'm', 'r', 'bl', 'b', 'br'] as const;

/**
 * 9칸 그림 (art/build.py 의 slice9 · artlist.ts 의 ART_SLICE) 을 x,y,w,h (화면 px) 에 이어 붙인다.
 * 모서리는 그대로, 변·가운데는 늘이지 않고 E 칸을 되풀이한다 (칸 수를 반올림해 조금만 늘이거나 줄인다 — 거울 그림이라 이음매가 없다).
 * 작은 장애물은 모서리를 w/2·h/2 까지 줄인다. hollow 면 가운데를 비운다 (방 테두리).
 * 방이 바뀔 때만 부른다 (컨테이너 하나 — 지울 때 destroy).
 */
export function tiled9(
  scene: Phaser.Scene,
  key: string,
  [b, E]: readonly [number, number],
  gap: number,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  hollow: boolean,
): Phaser.GameObjects.Container {
  const tex = scene.textures.get(key);
  if (!tex.has('tl')) {
    const p = [0, b + gap, b + gap + E + gap];
    const s = [b, E, b];
    SLICE_FRAMES.forEach((f, i) => tex.add(f, 0, p[i % 3], p[Math.floor(i / 3)], s[i % 3], s[Math.floor(i / 3)]));
  }
  const box = scene.add.container(x, y);
  const c = Math.min(b * scale, w / 2, h / 2);
  const e = E * scale * (c / (b * scale));
  const put = (f: string, px: number, py: number, pw: number, ph: number) => {
    if (pw <= 0 || ph <= 0) return;
    // 반 px 겹쳐 그려 소수 좌표에서 생기는 실선 틈을 막는다
    box.add(scene.add.image(px, py, key, f).setOrigin(0).setDisplaySize(pw + 0.5, ph + 0.5));
  };
  const span = (len: number) => {
    const n = Math.max(1, Math.round(len / e));
    return { n, d: len / n };
  };
  const ix = w - 2 * c;
  const iy = h - 2 * c;
  const sx = span(ix);
  const sy = span(iy);
  put('tl', 0, 0, c, c);
  put('tr', w - c, 0, c, c);
  put('bl', 0, h - c, c, c);
  put('br', w - c, h - c, c, c);
  if (ix > 0.5)
    for (let i = 0; i < sx.n; i++) {
      put('t', c + i * sx.d, 0, sx.d, c);
      put('b', c + i * sx.d, h - c, sx.d, c);
    }
  if (iy > 0.5)
    for (let j = 0; j < sy.n; j++) {
      put('l', 0, c + j * sy.d, c, sy.d);
      put('r', w - c, c + j * sy.d, c, sy.d);
    }
  if (!hollow && ix > 0.5 && iy > 0.5) for (let j = 0; j < sy.n; j++) for (let i = 0; i < sx.n; i++) put('m', c + i * sx.d, c + j * sy.d, sx.d, sy.d);
  return box;
}

// 코드로 그리는 그림 (Canvas 2D → Phaser 텍스처).
// 탄·피격 효과·아이템 반짝임은 지시서대로 계속 코드 그림이고, 적·기체는 M2 에서 받은 그림으로 바뀐다 (못 읽으면 이 그림).
// 색은 shared/theme.js 의 값만 쓴다 (DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색).
import Phaser from 'phaser';
import { COLOR, css } from '../theme';
import type { Ship } from '../data/ships';
import { HULL_ASPECT, type HullKind } from '../data/bosses';

const INK = css(COLOR.outline);
const WHITE = css(COLOR.white);
const PINK = css(COLOR.pink);
const GOLD = css(COLOR.primary);
const GOLD_LIGHT = css(COLOR.primaryLight);
const GOLD_DEEP = css(COLOR.primaryDeep);
const CREAM = css(COLOR.panel);

type Draw = (x: CanvasRenderingContext2D, w: number, h: number) => void;

/** 모든 코드 그림을 한 장(아틀라스 'art')에 모은다: 같은 텍스처끼리 한 번에 그려져 휴대폰에서 가볍다 */
const queue: { key: string; w: number; h: number; draw: Draw }[] = [];
function tex(_scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw) {
  queue.push({ key, w, h, draw });
}
function pack(scene: Phaser.Scene) {
  const W = 2048, PAD = 2;
  let cx = 0, cy = 0, rowH = 0;
  const at = queue.map(q => {
    if (cx + q.w + PAD > W) { cx = 0; cy += rowH + PAD; rowH = 0; }
    const p = { ...q, x: cx, y: cy };
    cx += q.w + PAD; rowH = Math.max(rowH, q.h);
    return p;
  });
  const c = document.createElement('canvas');
  c.width = W; c.height = cy + rowH;
  const x = c.getContext('2d')!;
  x.lineJoin = 'round'; x.lineCap = 'round';
  for (const p of at) {
    x.save(); x.translate(p.x, p.y);
    x.beginPath(); x.rect(0, 0, p.w, p.h); x.clip();
    x.beginPath(); p.draw(x, p.w, p.h); x.restore();
  }
  if (scene.textures.exists('art')) {
    // 옛 아틀라스 캔버스를 비운다 (아이폰은 캔버스 메모리 총량이 작아 GC 를 기다리면 탭이 다시 켜질 수 있다)
    const old = scene.textures.get('art').getSourceImage() as HTMLCanvasElement;
    scene.textures.remove('art');
    if (old && 'width' in old) { old.width = 0; old.height = 0; }
  }
  const t = scene.textures.addCanvas('art', c)!;
  for (const p of at) t.add(p.key, 0, p.x, p.y, p.w, p.h);
  queue.length = 0;
}

function circle(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, line = 0) {
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fillStyle = fill; x.fill();
  if (line) { x.lineWidth = line; x.strokeStyle = INK; x.stroke(); }
}

function eyes(x: CanvasRenderingContext2D, cx: number, cy: number, gap: number, r: number) {
  for (const s of [-1, 1]) {
    circle(x, cx + s * gap, cy, r, WHITE, 3);
    circle(x, cx + s * gap + 1, cy + 1, r * 0.5, INK);
  }
}

/** 기체 (임시): 위를 보는 비행기 + 조종석에 조종사 얼굴. 날개 끝 노란 등 */
function drawShip(x: CanvasRenderingContext2D, ship: Ship, face: CanvasImageSource | null) {
  const [body, wing] = ship.color.map(css);
  x.save(); x.scale(1.28, 1.28);
  x.lineWidth = 4; x.strokeStyle = INK; x.lineJoin = 'round';
  // 날개
  x.beginPath(); x.moveTo(8, 58); x.quadraticCurveTo(4, 50, 14, 46); x.lineTo(86, 46); x.quadraticCurveTo(96, 50, 92, 58); x.lineTo(84, 70); x.lineTo(16, 70); x.closePath();
  x.fillStyle = wing; x.fill(); x.stroke();
  // 꼬리 날개
  x.beginPath(); x.roundRect(28, 84, 44, 12, 6); x.fillStyle = wing; x.fill(); x.stroke();
  // 몸통
  x.beginPath(); x.moveTo(50, 4); x.bezierCurveTo(66, 4, 68, 30, 68, 52); x.lineTo(66, 92); x.quadraticCurveTo(50, 100, 34, 92); x.lineTo(32, 52); x.bezierCurveTo(32, 30, 34, 4, 50, 4); x.closePath();
  x.fillStyle = body; x.fill(); x.stroke();
  circle(x, 10, 56, 5, GOLD, 3); circle(x, 90, 56, 5, GOLD, 3);
  // 조종석
  circle(x, 50, 40, 17, WHITE, 4);
  if (face) {
    x.save(); x.beginPath(); x.arc(50, 40, 15, 0, Math.PI * 2); x.clip();
    x.drawImage(face, 33, 23, 34, 34); x.restore();
  }
  x.restore();
}

/** 불러온 그림 (public/art/<name>.png → 텍스처 'img:<name>'). 못 불러왔으면 null → 코드 그림 */
function loaded(scene: Phaser.Scene, name: string): HTMLImageElement | null {
  const k = 'img:' + name;
  if (!scene.textures.exists(k)) return null;
  const src = scene.textures.get(k).getSourceImage() as HTMLImageElement;
  return src && src.width > 1 ? src : null;
}
/** 그림을 칸 안에 비율 그대로 가운데 맞춰 그린다 */
function fit(x: CanvasRenderingContext2D, im: HTMLImageElement, w: number, h: number) {
  const k = Math.min(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k;
  x.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
/** 그림이 있으면 그림, 없으면 코드 그림으로 같은 이름의 칸을 만든다 */
function either(scene: Phaser.Scene, key: string, name: string, w: number, h: number, code: Draw) {
  const im = loaded(scene, name);
  tex(scene, key, w, h, im ? x => fit(x, im, w, h) : code);
}
/** 보스·중간 보스 그림 높이 (그림 비율, 없으면 0.8) */
export function artHeight(scene: Phaser.Scene, name: string, w: number) {
  const im = loaded(scene, name);
  return Math.round(im ? (w * im.height) / im.width : w * 0.8);
}

/** 이 판에 필요한 그림 이름 (public/art/<name>.png). 없는 그림은 조용히 코드 그림 */
export function artFiles(ship: string, ground: string, bosses: BossArt[]) {
  const files = new Set([
    'ship-' + ship, 'enemy-small', 'enemy-medium', 'enemy-carrier', 'ground-' + ground, 'ground-gunboat',
    'item-p', 'item-b', 'item-coin', 'item-option',
  ]);
  for (const b of bosses) files.add(b.hull ? 'rider-' + b.rider : b.name);
  return [...files];
}

export interface BossArt { key: string; name: string; width: number; hull?: HullKind; rider?: string }

export function makeArt(scene: Phaser.Scene, ship: Ship, bosses: BossArt[] = [], ground = 'harbor') {
  const faceKey = 'face-' + ship.id;
  const face = scene.textures.exists(faceKey) ? (scene.textures.get(faceKey).getSourceImage() as CanvasImageSource) : null;
  either(scene, 'ship', 'ship-' + ship.id, 128, 128, x => drawShip(x, ship, face));
  makeStageArt(scene, bosses, ground);
  // 엔진 불꽃 (따로 그려서 깜빡인다)
  tex(scene, 'flame', 28, 40, x => {
    x.lineWidth = 3; x.strokeStyle = INK;
    x.beginPath(); x.moveTo(3, 2); x.quadraticCurveTo(14, 70, 25, 2); x.closePath(); x.fillStyle = GOLD; x.fill(); x.stroke();
    x.beginPath(); x.moveTo(9, 2); x.quadraticCurveTo(14, 30, 19, 2); x.closePath(); x.fillStyle = WHITE; x.fill();
  });
  // 보조기 (3단계부터)
  either(scene, 'opt', 'item-option', 48, 48, x => {
    circle(x, 24, 24, 17, GOLD, 4);
    circle(x, 24, 24, 7, WHITE, 3);
    x.fillStyle = INK; x.fillRect(21, 2, 6, 9);
  });
  // 피격 판정 점 (드래그 중에 보임)
  tex(scene, 'dot', 26, 26, x => {
    circle(x, 13, 13, 11, PINK);
    circle(x, 13, 13, 8, WHITE);
    circle(x, 13, 13, 5, PINK);
  });
  // 내 탄
  tex(scene, 'ps', 16, 38, x => {
    x.beginPath(); x.roundRect(2, 2, 12, 34, 6);
    const g = x.createLinearGradient(0, 0, 0, 38); g.addColorStop(0, WHITE); g.addColorStop(0.45, GOLD); g.addColorStop(1, GOLD_DEEP);
    x.fillStyle = g; x.fill(); x.lineWidth = 2.5; x.strokeStyle = INK; x.stroke();
  });
  // 적 탄: 흰 속 + 분홍 테 + 갈색 외곽선 (밝은 바닥 위에서도 잘 보이게)
  const bullet = (r: number) => (x: CanvasRenderingContext2D, w: number) => {
    circle(x, w / 2, w / 2, r, PINK, 2.5);
    circle(x, w / 2, w / 2, r * 0.48, WHITE);
  };
  tex(scene, 'eb', 22, 22, bullet(9));
  tex(scene, 'ebBig', 30, 30, bullet(13));
  // 아이템 P · B
  either(scene, 'itemP', 'item-p', 52, 52, x => {
    const g = x.createLinearGradient(0, 4, 0, 48); g.addColorStop(0, GOLD_LIGHT); g.addColorStop(1, GOLD_DEEP);
    circle(x, 26, 26, 21, '#000'); x.fillStyle = g; x.fill(); x.lineWidth = 4; x.strokeStyle = INK; x.stroke();
    letter(x, 'P', INK);
  });
  either(scene, 'itemB', 'item-b', 52, 52, x => { circle(x, 26, 26, 21, PINK, 4); letter(x, 'B', WHITE); });
  // 반짝임 (아이템 뒤에서 돈다)
  tex(scene, 'twinkle', 72, 72, x => {
    x.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 4; i++) {
      x.save(); x.translate(36, 36); x.rotate((i * Math.PI) / 2);
      x.beginPath(); x.moveTo(-4, 0); x.lineTo(0, -34); x.lineTo(4, 0); x.closePath(); x.fill(); x.restore();
    }
  });
  // 적 (임시 도형): 소형 = 빨간 꼬마 요괴, 중형 = 파란 도깨비, 운반기 = 노란 풍선
  either(scene, 'small', 'enemy-small', 72, 72, x => {
    x.lineWidth = 4; x.strokeStyle = INK; x.fillStyle = css(COLOR.lose);
    x.beginPath(); x.moveTo(22, 20); x.lineTo(16, 4); x.lineTo(32, 14); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(50, 20); x.lineTo(56, 4); x.lineTo(40, 14); x.closePath(); x.fill(); x.stroke();
    circle(x, 36, 40, 27, css(COLOR.lose), 4);
    eyes(x, 36, 44, 10, 7);
  });
  either(scene, 'medium', 'enemy-medium', 132, 132, x => {
    x.lineWidth = 5; x.strokeStyle = INK; x.fillStyle = GOLD;
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(66 + s * 26, 30); x.lineTo(66 + s * 40, 4); x.lineTo(66 + s * 46, 36); x.closePath(); x.fill(); x.stroke(); }
    circle(x, 66, 72, 52, css(COLOR.teamA), 5);
    eyes(x, 66, 64, 20, 12);
    x.beginPath(); x.arc(66, 92, 18, 0.1, Math.PI - 0.1); x.closePath(); x.fillStyle = INK; x.fill();
    x.fillStyle = WHITE; x.fillRect(54, 92, 8, 8); x.fillRect(70, 92, 8, 8);
    // 포문
    circle(x, 22, 104, 12, CREAM, 4); circle(x, 110, 104, 12, CREAM, 4);
    circle(x, 22, 104, 5, INK); circle(x, 110, 104, 5, INK);
  });
  either(scene, 'carrier', 'enemy-carrier', 100, 100, x => {
    x.lineWidth = 4; x.strokeStyle = INK;
    x.beginPath(); x.moveTo(36, 62); x.lineTo(40, 76); x.moveTo(64, 62); x.lineTo(60, 76); x.stroke();
    circle(x, 50, 38, 32, GOLD, 4);
    x.beginPath(); x.roundRect(30, 72, 40, 22, 8); x.fillStyle = CREAM; x.fill(); x.stroke();
    eyes(x, 50, 36, 11, 7);
    x.fillStyle = INK; x.font = 'bold 15px sans-serif'; x.textAlign = 'center'; x.fillText('?', 50, 89);
  });
  // 폭발: 노란 별 + 흰 테
  tex(scene, 'boom', 120, 120, x => {
    x.beginPath();
    for (let i = 0; i < 20; i++) {
      const a = (i * Math.PI) / 10, r = i % 2 ? 34 : 56;
      x.lineTo(60 + Math.cos(a) * r, 60 + Math.sin(a) * r);
    }
    x.closePath(); x.fillStyle = GOLD; x.fill(); x.lineWidth = 5; x.strokeStyle = INK; x.stroke();
    circle(x, 60, 60, 20, WHITE);
  });
  tex(scene, 'ring', 160, 160, x => { x.beginPath(); x.arc(80, 80, 72, 0, Math.PI * 2); x.lineWidth = 10; x.strokeStyle = WHITE; x.stroke(); x.lineWidth = 3; x.strokeStyle = INK; x.beginPath(); x.arc(80, 80, 77, 0, Math.PI * 2); x.stroke(); });
  tex(scene, 'spark', 20, 20, x => circle(x, 10, 10, 7, WHITE, 2.5));
  pack(scene);
}

/** M2: 금화 · 지상 목표 · 레이저 · 차지 칸 · 부서진 부위 · 보스 */
function makeStageArt(scene: Phaser.Scene, bosses: BossArt[], groundName: string) {
  // 금화 (엽전: 가운데 네모 구멍)
  either(scene, 'itemC', 'item-coin', 44, 44, x => {
    circle(x, 22, 22, 18, GOLD, 3.5);
    circle(x, 22, 22, 13, GOLD_LIGHT);
    x.fillStyle = GOLD_DEEP; x.fillRect(16, 16, 12, 12);
    x.lineWidth = 2.5; x.strokeStyle = INK; x.strokeRect(16, 16, 12, 12);
  });
  // 지상 목표 (해안 포대) · 해상 목표 (포함)
  const turret = (x: CanvasRenderingContext2D, w: number) => {
    const c = w / 2;
    x.beginPath(); x.roundRect(8, 8, w - 16, w - 16, 18); x.fillStyle = css(COLOR.lineSoft); x.fill(); x.lineWidth = 4; x.strokeStyle = INK; x.stroke();
    circle(x, c, c, w * 0.26, css(COLOR.inkSoft), 4);
    x.beginPath(); x.roundRect(c - 7, c, 14, w * 0.42, 6); x.fillStyle = INK; x.fill();
    circle(x, c, c, w * 0.1, GOLD, 3);
  };
  either(scene, 'ground', 'ground-' + groundName, 100, 100, turret);
  either(scene, 'groundSea', 'ground-gunboat', 100, 100, turret);
  // 관통 레이저 (세로로 늘려 쓴다): 흰 속 + 노란 테
  tex(scene, 'laser', 48, 64, x => {
    const g = x.createLinearGradient(0, 0, 48, 0);
    g.addColorStop(0, 'rgba(255,211,77,0)'); g.addColorStop(0.18, GOLD); g.addColorStop(0.38, WHITE);
    g.addColorStop(0.62, WHITE); g.addColorStop(0.82, GOLD); g.addColorStop(1, 'rgba(255,211,77,0)');
    x.fillStyle = g; x.fillRect(0, 0, 48, 64);
  });
  // 차지 칸 (빈 칸 · 찬 칸)
  for (const [k, fill] of [['cell0', css(COLOR.track)], ['cell1', GOLD]] as const) {
    tex(scene, k, 22, 14, x => { x.beginPath(); x.roundRect(2, 2, 18, 10, 4); x.fillStyle = fill; x.fill(); x.lineWidth = 2.5; x.strokeStyle = INK; x.stroke(); });
  }
  // 부서진 부위: 갈색 그을음 + 금
  tex(scene, 'partBroken', 72, 72, x => {
    circle(x, 36, 36, 26, css(COLOR.inkSoft), 4);
    x.strokeStyle = INK; x.lineWidth = 3;
    x.beginPath(); x.moveTo(24, 22); x.lineTo(36, 36); x.lineTo(30, 50); x.moveTo(36, 36); x.lineTo(50, 30); x.stroke();
  });
  // 내 탄 종류 (큰 탄 · 유도 깃털 · 파동 · 발톱)
  tex(scene, 'psBig', 36, 36, x => { circle(x, 18, 18, 14, GOLD, 3); circle(x, 18, 18, 7, WHITE); });
  tex(scene, 'psHoming', 20, 30, x => { x.beginPath(); x.ellipse(10, 15, 7, 13, 0, 0, Math.PI * 2); x.fillStyle = PINK; x.fill(); x.lineWidth = 2.5; x.strokeStyle = INK; x.stroke(); x.fillStyle = WHITE; x.fillRect(9, 6, 2, 18); });
  tex(scene, 'psWave', 28, 28, x => { circle(x, 14, 14, 11, css(COLOR.win), 2.5); circle(x, 14, 14, 5, WHITE); });
  tex(scene, 'psClaw', 22, 34, x => {
    x.beginPath(); x.moveTo(11, 2); x.quadraticCurveTo(20, 18, 11, 32); x.quadraticCurveTo(4, 18, 11, 2); x.closePath();
    x.fillStyle = WHITE; x.fill(); x.lineWidth = 2.5; x.strokeStyle = INK; x.stroke();
  });
  // 차지·폭탄 효과: 돌진 기운 · 방어막 · 독구름 · 번개 (예고 / 내리침)
  tex(scene, 'aura', 128, 128, x => { circle(x, 64, 64, 58, 'rgba(255,255,255,0.35)'); x.lineWidth = 6; x.strokeStyle = GOLD; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.stroke(); });
  tex(scene, 'shieldRing', 128, 128, x => {
    circle(x, 64, 64, 58, 'rgba(159,214,255,0.3)');
    x.lineWidth = 5; x.strokeStyle = WHITE; x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2.5; x.strokeStyle = INK; x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.stroke();
  });
  tex(scene, 'zone', 128, 128, x => {
    for (const [cx, cy, r] of [[64, 64, 46], [40, 54, 30], [88, 56, 30], [58, 86, 28], [84, 84, 24]]) circle(x, cx, cy, r, 'rgba(76,184,106,0.42)');
  });
  tex(scene, 'boltWarn', 32, 64, x => { x.fillStyle = 'rgba(255,77,109,0.22)'; x.fillRect(0, 0, 32, 64); x.fillStyle = PINK; x.fillRect(0, 0, 3, 64); x.fillRect(29, 0, 3, 64); });
  tex(scene, 'boltHit', 32, 64, x => {
    const g = x.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, 'rgba(255,224,102,0)'); g.addColorStop(0.3, GOLD_LIGHT); g.addColorStop(0.5, WHITE); g.addColorStop(0.7, GOLD_LIGHT); g.addColorStop(1, 'rgba(255,224,102,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 64);
  });
  // 보스 (받은 그림 한 장, 또는 코드 몸체 + 기존 요괴)
  for (const b of bosses) {
    if (b.hull) {
      const rider = loaded(scene, 'rider-' + b.rider);
      const hull = b.hull;
      tex(scene, b.key, b.width, Math.round(b.width * HULL_ASPECT), (x, w, hh) => drawHull(x, w, hh, hull, rider));
      continue;
    }
    const h = artHeight(scene, b.name, b.width);
    either(scene, b.key, b.name, b.width, h, (x, w, hh) => {
      // 코드 보스 (그림을 못 읽었을 때): 빨간 게
      x.lineWidth = 6; x.strokeStyle = INK;
      for (const s of [-1, 1]) { circle(x, w / 2 + s * w * 0.35, hh * 0.7, w * 0.11, css(COLOR.lose), 6); }
      x.beginPath(); x.ellipse(w / 2, hh * 0.45, w * 0.3, hh * 0.33, 0, 0, Math.PI * 2); x.fillStyle = css(COLOR.lose); x.fill(); x.stroke();
      eyes(x, w / 2, hh * 0.35, w * 0.08, w * 0.04);
    });
  }
}

/** 코드 몸체 5종 + 위에 탄 요괴. 양쪽 포문은 (w/2 ± 0.37w, 0.74h) — bosses.ts 의 hullParts 와 같은 자리 */
function drawHull(x: CanvasRenderingContext2D, w: number, hh: number, kind: HullKind, rider: HTMLImageElement | null) {
  x.lineWidth = 6; x.strokeStyle = INK; x.lineJoin = 'round';
  const cy = hh * 0.62;
  const puffs = [[0.2, 0.66, 0.2], [0.8, 0.66, 0.2], [0.38, 0.56, 0.24], [0.62, 0.56, 0.24], [0.5, 0.74, 0.24]];
  switch (kind) {
    case 'airship':
      x.beginPath(); x.ellipse(w / 2, cy, w * 0.47, hh * 0.3, 0, 0, Math.PI * 2); x.fillStyle = CREAM; x.fill(); x.stroke();
      x.fillStyle = PINK; x.fillRect(w * 0.08, cy - 7, w * 0.84, 14);
      break;
    case 'kite':
      x.beginPath(); x.moveTo(w / 2, hh * 0.28); x.lineTo(w * 0.96, cy); x.lineTo(w / 2, hh * 0.98); x.lineTo(w * 0.04, cy); x.closePath();
      x.fillStyle = GOLD; x.fill(); x.stroke();
      x.lineWidth = 3; x.beginPath(); x.moveTo(w / 2, hh * 0.28); x.lineTo(w / 2, hh * 0.98); x.moveTo(w * 0.04, cy); x.lineTo(w * 0.96, cy); x.stroke();
      break;
    case 'cloud':
      for (const [fx, fy, fr] of puffs) { x.beginPath(); x.arc(w * fx, hh * fy, w * fr * 0.82, 0, Math.PI * 2); x.fillStyle = WHITE; x.fill(); x.stroke(); }
      for (const [fx, fy, fr] of puffs) circle(x, w * fx, hh * fy, w * fr * 0.82 - 4, WHITE);
      break;
    case 'flower':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        x.beginPath(); x.ellipse(w / 2 + Math.cos(a) * w * 0.24, cy + Math.sin(a) * hh * 0.2, w * 0.16, hh * 0.14, a, 0, Math.PI * 2);
        x.fillStyle = css(COLOR.panelStrong); x.fill(); x.stroke();
      }
      circle(x, w / 2, cy, w * 0.14, PINK, 5);
      break;
    case 'fort':
      x.beginPath(); x.roundRect(w * 0.04, hh * 0.4, w * 0.92, hh * 0.52, 26); x.fillStyle = css(COLOR.lineSoft); x.fill(); x.stroke();
      x.lineWidth = 3;
      for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(w * 0.04 + i * w * 0.23, hh * 0.42); x.lineTo(w * 0.04 + i * w * 0.23, hh * 0.9); x.stroke(); }
      break;
  }
  for (const s of [-1, 1]) { circle(x, w / 2 + s * w * 0.37, hh * 0.74, 22, css(COLOR.lineSoft), 4); circle(x, w / 2 + s * w * 0.37, hh * 0.74, 9, INK); }
  const rs = hh * 0.72;
  if (rider) { const k = Math.min(rs / rider.width, rs / rider.height); x.drawImage(rider, w / 2 - (rider.width * k) / 2, 0, rider.width * k, rider.height * k); }
  else circle(x, w / 2, hh * 0.3, hh * 0.25, css(COLOR.lose), 5);
}

/** 하늘 위 (5스테이지): 하늘색 + 구름 무늬 */
export function makeSky(scene: Phaser.Scene) {
  if (scene.textures.exists('skyTile')) return;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = css(COLOR.skyMid); x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [cx, cy, r] of [[50, 60, 26], [78, 52, 30], [104, 64, 22], [180, 170, 24], [206, 160, 32], [232, 176, 20], [30, 210, 18], [52, 206, 24]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  scene.textures.addCanvas('skyTile', c);
}

/** 바다 무늬 (TileSprite 용 작은 텍스처 하나) */
export function makeSea(scene: Phaser.Scene) {
  if (scene.textures.exists('sea')) return;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = css(COLOR.skyTop); x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 4; x.lineCap = 'round';
  for (const [px, py] of [[16, 20], [76, 52], [30, 92], [96, 112]]) {
    x.beginPath(); x.arc(px, py, 12, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
  }
  scene.textures.addCanvas('sea', c);
}

function letter(x: CanvasRenderingContext2D, ch: string, color: string) {
  x.font = '28px Jua, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 5; x.strokeStyle = color === WHITE ? INK : WHITE;
  x.strokeText(ch, 26, 28); x.fillStyle = color; x.fillText(ch, 26, 28);
}

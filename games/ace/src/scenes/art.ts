// 코드로 그리는 그림 (Canvas 2D → Phaser 텍스처).
// 탄·피격 효과·아이템 반짝임은 지시서대로 계속 코드 그림이고, 적·기체는 M2 에서 받은 그림으로 바뀐다 (못 읽으면 이 그림).
// 색은 shared/theme.js 의 값만 쓴다 (DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색).
import Phaser from 'phaser';
import { COLOR, css } from '../theme';
import type { Ship } from '../data/ships';

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
  const W = 1024, PAD = 2;
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
  if (scene.textures.exists('art')) scene.textures.remove('art');
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

export function makeArt(scene: Phaser.Scene, ship: Ship) {
  const faceKey = 'face-' + ship.id;
  const face = scene.textures.exists(faceKey) ? (scene.textures.get(faceKey).getSourceImage() as CanvasImageSource) : null;
  tex(scene, 'ship', 128, 128, x => drawShip(x, ship, face));
  // 엔진 불꽃 (따로 그려서 깜빡인다)
  tex(scene, 'flame', 28, 40, x => {
    x.lineWidth = 3; x.strokeStyle = INK;
    x.beginPath(); x.moveTo(3, 2); x.quadraticCurveTo(14, 70, 25, 2); x.closePath(); x.fillStyle = GOLD; x.fill(); x.stroke();
    x.beginPath(); x.moveTo(9, 2); x.quadraticCurveTo(14, 30, 19, 2); x.closePath(); x.fillStyle = WHITE; x.fill();
  });
  // 보조기 (3단계부터)
  tex(scene, 'opt', 48, 48, x => {
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
  tex(scene, 'itemP', 52, 52, x => {
    const g = x.createLinearGradient(0, 4, 0, 48); g.addColorStop(0, GOLD_LIGHT); g.addColorStop(1, GOLD_DEEP);
    circle(x, 26, 26, 21, '#000'); x.fillStyle = g; x.fill(); x.lineWidth = 4; x.strokeStyle = INK; x.stroke();
    letter(x, 'P', INK);
  });
  tex(scene, 'itemB', 52, 52, x => { circle(x, 26, 26, 21, PINK, 4); letter(x, 'B', WHITE); });
  // 반짝임 (아이템 뒤에서 돈다)
  tex(scene, 'twinkle', 72, 72, x => {
    x.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 4; i++) {
      x.save(); x.translate(36, 36); x.rotate((i * Math.PI) / 2);
      x.beginPath(); x.moveTo(-4, 0); x.lineTo(0, -34); x.lineTo(4, 0); x.closePath(); x.fill(); x.restore();
    }
  });
  // 적 (임시 도형): 소형 = 빨간 꼬마 요괴, 중형 = 파란 도깨비, 운반기 = 노란 풍선
  tex(scene, 'small', 72, 72, x => {
    x.lineWidth = 4; x.strokeStyle = INK; x.fillStyle = css(COLOR.lose);
    x.beginPath(); x.moveTo(22, 20); x.lineTo(16, 4); x.lineTo(32, 14); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(50, 20); x.lineTo(56, 4); x.lineTo(40, 14); x.closePath(); x.fill(); x.stroke();
    circle(x, 36, 40, 27, css(COLOR.lose), 4);
    eyes(x, 36, 44, 10, 7);
  });
  tex(scene, 'medium', 132, 132, x => {
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
  tex(scene, 'carrier', 100, 100, x => {
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

function letter(x: CanvasRenderingContext2D, ch: string, color: string) {
  x.font = '28px Jua, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 5; x.strokeStyle = color === WHITE ? INK : WHITE;
  x.strokeText(ch, 26, 28); x.fillStyle = color; x.fillText(ch, 26, 28);
}

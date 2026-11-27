// 로비 카드 그림 만들기 (shared/images/card-block.png, 640×400).
// npm run dev 뒤 http://localhost:5302/games/block/scripts/card.html 을 열고 캔버스를 PNG 로 저장한다 (Playwright 로 찍음).
// 시아팡팡 카드처럼: 정령 마당 숲 배경 + 크림 판 안의 밤하늘 보드 + 정령 블록, 위에 끌어 오는 조각 하나.
import * as SPR from '../../pang/src/game/spirits.js';
import * as PangScene from '../../pang/src/ui/scene.js';
import { COLOR, css, PANG } from '../../../shared/theme.js';
import { rr, tile } from '../src/ui/tiles.ts';

const W = 640, H = 400;
const cv = document.getElementById('card') as HTMLCanvasElement;
cv.width = W; cv.height = H;
const x = cv.getContext('2d')!;

// 숲 배경: 정령 마당(scene.js)을 그대로 640×400 으로 한 장
const bg = document.createElement('canvas');
bg.style.width = W + 'px'; bg.style.height = H + 'px';
const scene = PangScene.create(bg, SPR);
scene.setup(0, []);
scene.resize(W, H);
scene.st.on = true;
scene.draw();
x.drawImage(bg, 0, 0, W, H);

// 판 (조금 기울임)
const N = 6, S = 46, B = N * S, pad = 12;
x.save();
x.translate(W / 2 - 10, H / 2 + 14);
x.rotate(-0.05);
x.fillStyle = 'rgba(0,0,0,0.25)'; rr(x, -B / 2 - pad + 4, -B / 2 - pad + 10, B + pad * 2, B + pad * 2, 26); x.fill();
x.fillStyle = css(COLOR.panel); x.strokeStyle = css(COLOR.outline); x.lineWidth = 5;
rr(x, -B / 2 - pad, -B / 2 - pad, B + pad * 2, B + pad * 2, 26); x.fill(); x.stroke();
x.fillStyle = css(PANG.board); rr(x, -B / 2, -B / 2, B, B, 14); x.fill();
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  x.fillStyle = css((r + c) % 2 ? PANG.cell : PANG.cellAlt);
  rr(x, -B / 2 + c * S + 1.5, -B / 2 + r * S + 1.5, S - 3, S - 3, 8); x.fill();
}
// 블록: 아래쪽이 차 있고, 한 줄은 지워지며 반짝인다
const FILL: [number, number, number][] = [
  [2, 0, 4], [2, 1, 4], [2, 4, 7],
  [3, 0, 1], [3, 1, 1], [3, 2, 0], [3, 3, 0], [3, 4, 7], [3, 5, 7],
  [4, 0, 8], [4, 1, 3], [4, 2, 3], [4, 3, 3], [4, 4, 2], [4, 5, 2],
  [5, 0, 8], [5, 1, 8], [5, 2, 5], [5, 3, 6], [5, 5, 2],
];
for (const [r, c, sp] of FILL) x.drawImage(tile(sp, S, 2), -B / 2 + c * S, -B / 2 + r * S, S, S);
// 지워지는 4번 줄 반짝임
x.save(); x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(255,250,220,0.35)';
rr(x, -B / 2 + 1, -B / 2 + 4 * S + 1, B - 2, S - 2, 10); x.fill(); x.restore();
// 놓일 자리 그림자 (5번 줄 빈칸)
x.globalAlpha = 0.5; x.drawImage(tile(3, S, 2), -B / 2 + 4 * S, -B / 2 + 5 * S, S, S); x.globalAlpha = 1;
x.restore();

// 끌어 오는 조각 (ㄱ자) + 반짝이
const P = 40;
x.save();
x.translate(470, 70); x.rotate(0.12);
x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 12; x.shadowOffsetY = 6;
for (const [r, c] of [[0, 0], [1, 0], [1, 1]]) x.drawImage(tile(6, P, 2), c * P, r * P, P, P);
x.restore();
// 정령 둘 (양옆)
for (const [k, X, Y, s] of [['fire', 90, 300, 1.5], ['heart', 560, 300, 1.4], ['light', 110, 110, 1.1]] as const) {
  x.save(); x.translate(X, Y); x.scale(s, s); SPR.draw(x, k, 0.6, null, [2, 0]); x.restore();
}
document.title = 'ready';

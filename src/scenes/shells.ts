import type Phaser from 'phaser';

type G = Phaser.GameObjects.Graphics;

/** 포탄 그림별 꼬리 색 */
export const TRAIL: Record<string, number> = {
  shell: 0xffffff,
  cheese: 0xfff1a0,
  horn: 0xf2e6c9,
  drill: 0xc9a27a,
  claw: 0xffc078,
  carrot: 0xffb066,
  hop: 0xffd0e0,
  fire: 0xff8a3a,
  pearl: 0xa8f0ff,
  fang: 0xd9ff9a,
  mist: 0xc7a6ff,
  shoe: 0xe0e4ee,
  wool: 0xffffff,
  banana: 0xfff27a,
  egg: 0xfff6e0,
  feather: 0xffffff,
  bone: 0xf4ecd8,
  acorn: 0xd9b38c,
  mud: 0xb08a5a,
  moon: 0xfff3a0,
  sun: 0xffd23a,
  coconut: 0xc8a070,
  rat: 0xd8d8e0,
};

const OUT = 0x3a2a1e;

/** SpriteCook으로 만든 포탄 그림 (public/shells/*.png) */
export const SHELL_LOOKS = ['shell', 'cheese', 'horn', 'drill', 'claw', 'carrot', 'hop', 'fire', 'pearl', 'fang', 'mist', 'shoe', 'wool', 'banana', 'egg', 'feather', 'bone', 'acorn', 'mud', 'moon', 'sun', 'coconut'];
/** 진행 방향 대신 빙글빙글 도는 포탄 */
export const SPIN_LOOKS = new Set(['cheese', 'claw', 'hop', 'pearl', 'mist', 'shoe', 'wool', 'banana', 'egg', 'bone', 'mud', 'moon', 'sun', 'coconut']);

/**
 * 포탄을 날아가는 방향(dx,dy 단위벡터)으로 그린다.
 * 로컬 좌표 u = 앞, v = 옆.
 */
export function drawShell(g: G, look: string, x: number, y: number, dx: number, dy: number, t: number, big = false) {
  const k = big ? 1.45 : 1;
  const P = (u: number, v: number): [number, number] => [x + (u * dx - v * dy) * k, y + (u * dy + v * dx) * k];
  const poly = (pts: [number, number][], fill: number, line = true) => {
    g.fillStyle(fill);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath().fillPath();
    if (line) {
      g.lineStyle(1.4, OUT);
      g.strokePath();
    }
  };
  const circ = (u: number, v: number, r: number, fill: number, line = true) => {
    const [cx, cy] = P(u, v);
    g.fillStyle(fill).fillCircle(cx, cy, r * k);
    if (line) g.lineStyle(1.4, OUT).strokeCircle(cx, cy, r * k);
  };
  // 그림자
  g.fillStyle(0x000000, 0.2).fillCircle(x + 1.5, y + 2, 5.5 * k);
  // 빙글빙글 도는 탄은 진행 방향 대신 시간으로 회전
  const spin = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { dx: c, dy: s };
  };

  switch (look) {
    case 'cheese': {
      const r = spin(t * 8);
      const Q = (u: number, v: number): [number, number] => [x + (u * r.dx - v * r.dy) * k, y + (u * r.dy + v * r.dx) * k];
      g.fillStyle(0xffd23a);
      g.beginPath();
      const a = Q(-6, -5);
      const b = Q(7, 0);
      const c = Q(-6, 5);
      g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(c[0], c[1]).closePath().fillPath();
      g.lineStyle(1.4, OUT).strokePath();
      const h1 = Q(-2, -1.5);
      const h2 = Q(-3.5, 2.5);
      g.fillStyle(0xe0a800).fillCircle(h1[0], h1[1], 1.3 * k).fillCircle(h2[0], h2[1], 1 * k);
      break;
    }
    case 'horn':
      poly([P(9, 0), P(-5, -4.5), P(-6, 0), P(-5, 4.5)], 0xf2e6c9);
      circ(-6, 0, 3, 0x8a5a3c);
      break;
    case 'drill':
    case 'fang': {
      const col = look === 'fang' ? 0xffffff : 0x9aa0b0;
      poly([P(10, 0), P(-3, -5), P(-3, 5)], col);
      circ(-5, 0, 4, look === 'fang' ? 0x7bc04a : 0x5a6070);
      // 돌아가는 홈
      const s = Math.sin(t * 30) * 3;
      const [ax, ay] = P(3, s * 0.6);
      const [bx, by] = P(-1, -s);
      g.lineStyle(1, OUT, 0.6).lineBetween(ax, ay, bx, by);
      break;
    }
    case 'claw':
      circ(0, 0, 5.8, 0xff9a2e);
      for (const v of [-2.6, 0, 2.6]) {
        const [ax, ay] = P(-3, v);
        const [bx, by] = P(3, v * 1.2);
        g.lineStyle(1.5, OUT).lineBetween(ax, ay, bx, by);
      }
      break;
    case 'carrot':
      poly([P(10, 0), P(-5, -4), P(-5, 4)], 0xff8a2a);
      poly([P(-5, 0), P(-11, -4), P(-9, 0), P(-11, 4)], 0x4fbf4a);
      break;
    case 'hop':
      circ(0, 0, 5.8, 0xffffff);
      circ(1.5, -1.5, 2, 0xff8fb1, false);
      break;
    case 'fire': {
      const f = 1 + Math.sin(t * 40) * 0.15;
      poly([P(-12 * f, 0), P(-2, -5), P(-2, 5)], 0xffd23a, false);
      circ(0, 0, 6, 0xff5a2a);
      circ(1.5, 0, 3, 0xffe066, false);
      break;
    }
    case 'pearl':
      circ(0, 0, 6, 0x6fd8ff);
      circ(-1.8, -1.8, 2.2, 0xffffff, false);
      g.lineStyle(1.5, 0xffd23a, 0.9).strokeCircle(x, y, 8.5 * k);
      break;
    case 'mist':
      for (const [u, v, r] of [[0, 0, 5.5], [-4, 3, 3.5], [-4, -3, 3.5], [3, 2, 3]] as const) circ(u, v, r, 0xa77bff, false);
      circ(1, -1, 2, 0xe6d6ff, false);
      break;
    case 'shoe': {
      const r = spin(t * 10);
      const [cx, cy] = [x, y];
      g.lineStyle(3.2 * k, OUT).beginPath().arc(cx, cy, 5 * k, Math.atan2(r.dy, r.dx) + 0.5, Math.atan2(r.dy, r.dx) + Math.PI * 2 - 0.5).strokePath();
      g.lineStyle(2 * k, 0xd0d6e2).beginPath().arc(cx, cy, 5 * k, Math.atan2(r.dy, r.dx) + 0.5, Math.atan2(r.dy, r.dx) + Math.PI * 2 - 0.5).strokePath();
      break;
    }
    case 'wool':
      for (const [u, v] of [[0, 0], [-3, -3], [-3, 3], [3, -2.5], [3, 2.5]] as const) circ(u, v, 3.8, 0xfffbf0, false);
      g.lineStyle(1.2, OUT).strokeCircle(x, y, 7 * k);
      break;
    case 'banana': {
      const r = spin(t * 9);
      const Q = (u: number, v: number): [number, number] => [x + (u * r.dx - v * r.dy) * k, y + (u * r.dy + v * r.dx) * k];
      g.fillStyle(0xffe14d).lineStyle(1.4, OUT);
      g.beginPath();
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (0.15 + 0.7 * (i / 8));
        pts.push(Q(Math.cos(a) * 8, Math.sin(a) * 7 - 2));
      }
      for (let i = 8; i >= 0; i--) {
        const a = Math.PI * (0.15 + 0.7 * (i / 8));
        pts.push(Q(Math.cos(a) * 7, Math.sin(a) * 2.5 - 1.5));
      }
      g.moveTo(pts[0][0], pts[0][1]);
      pts.forEach((p) => g.lineTo(p[0], p[1]));
      g.closePath().fillPath().strokePath();
      break;
    }
    case 'egg':
      g.fillStyle(0xfff8ec).lineStyle(1.4, OUT);
      g.fillEllipse(x, y, 10 * k, 12.5 * k).strokeEllipse(x, y, 10 * k, 12.5 * k);
      g.fillStyle(0xffffff, 0.8).fillCircle(x - 1.8 * k, y - 2.5 * k, 1.6 * k);
      break;
    case 'feather':
      poly([P(9, 0), P(0, -4), P(-9, -1), P(-9, 1), P(0, 4)], 0xffffff);
      {
        const [ax, ay] = P(9, 0);
        const [bx, by] = P(-11, 0);
        g.lineStyle(1, 0xff5a5a).lineBetween(ax, ay, bx, by);
      }
      break;
    case 'bone': {
      const r = spin(t * 9);
      const Q = (u: number, v: number): [number, number] => [x + (u * r.dx - v * r.dy) * k, y + (u * r.dy + v * r.dx) * k];
      const [ax, ay] = Q(-5, 0);
      const [bx, by] = Q(5, 0);
      g.lineStyle(5 * k, OUT).lineBetween(ax, ay, bx, by);
      g.lineStyle(3 * k, 0xf8f0dc).lineBetween(ax, ay, bx, by);
      for (const [u, v] of [[-6, -2], [-6, 2], [6, -2], [6, 2]] as const) {
        const [cx, cy] = Q(u, v);
        g.fillStyle(0xf8f0dc).fillCircle(cx, cy, 2.4 * k);
        g.lineStyle(1.1, OUT).strokeCircle(cx, cy, 2.4 * k);
      }
      break;
    }
    case 'acorn':
      circ(1, 0, 5.4, 0xc0803e);
      poly([P(-1, -6), P(-6, -5), P(-6, 5), P(-1, 6)], 0x7a4a2a);
      {
        const [ax, ay] = P(-6, 0);
        const [bx, by] = P(-9, 0);
        g.lineStyle(1.8, OUT).lineBetween(ax, ay, bx, by);
      }
      break;
    case 'rat': {
      // 동그랗게 몸을 만 쥐 (구르면 빙글빙글)
      const a = t * 12;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      g.lineStyle(1.4, 0xff9db5).beginPath();
      g.arc(x - ax * 5 * k, y - ay * 5 * k, 3 * k, a, a + 2.5);
      g.strokePath();
      circ(0, 0, 6, 0x9a9aa8);
      g.fillStyle(0xc4c4d0).fillCircle(x + ax * 1.5 * k, y + ay * 1.5 * k, 3.6 * k);
      // 귀
      g.fillStyle(0xff9db5).lineStyle(1, OUT).fillCircle(x + Math.cos(a + 1.2) * 5.5 * k, y + Math.sin(a + 1.2) * 5.5 * k, 2.2 * k);
      g.strokeCircle(x + Math.cos(a + 1.2) * 5.5 * k, y + Math.sin(a + 1.2) * 5.5 * k, 2.2 * k);
      // 눈·코
      g.fillStyle(0x1e1e2a).fillCircle(x + Math.cos(a + 0.4) * 3 * k, y + Math.sin(a + 0.4) * 3 * k, 0.9 * k);
      g.fillStyle(0xff6b8a).fillCircle(x + ax * 5.6 * k, y + ay * 5.6 * k, 1.1 * k);
      break;
    }
    case 'coconut': {
      circ(0, 0, 6, 0x7a4a26);
      // 굴러가는 게 보이도록 시간에 따라 도는 섬유 줄무늬
      for (let i = 0; i < 3; i++) {
        const a = t * 12 + (i * Math.PI * 2) / 3;
        g.lineStyle(1.1, 0x4a2a12).lineBetween(x + Math.cos(a) * 1.5 * k, y + Math.sin(a) * 1.5 * k, x + Math.cos(a) * 5 * k, y + Math.sin(a) * 5 * k);
      }
      const a = t * 12;
      g.fillStyle(0x2a1a0a).fillCircle(x + Math.cos(a + 2) * 2.5 * k, y + Math.sin(a + 2) * 2.5 * k, 1 * k);
      break;
    }
    case 'mud':
      circ(0, 0, 6, 0x8a6a42);
      circ(-3, -2, 2.2, 0x6a4e30, false);
      circ(2, 2, 1.6, 0xa8875a, false);
      break;
    case 'moon':
      circ(0, 0, 6.5, 0xfff3a0);
      circ(2, -1.5, 1.5, 0xe0d070, false);
      circ(-2, 2, 1.1, 0xe0d070, false);
      break;
    case 'sun':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 4;
        g.lineStyle(2 * k, 0xffb02e).lineBetween(x + Math.cos(a) * 6 * k, y + Math.sin(a) * 6 * k, x + Math.cos(a) * 10 * k, y + Math.sin(a) * 10 * k);
      }
      circ(0, 0, 6, 0xffd23a);
      break;
    default:
      circ(-4, 0, 4.2, 0x2b2b3a, false);
      circ(0, 0, 5.5, 0x2b2b3a);
      circ(2.5, 0, 2.6, 0xffc240, false);
      g.fillStyle(0xffffff, 0.7).fillCircle(x - 1.8, y - 1.8, 1.6);
  }
}

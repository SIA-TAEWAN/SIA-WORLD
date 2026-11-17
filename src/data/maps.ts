import { Terrain, MAP_W, MAP_H } from '../physics/terrain';
import { Rng } from '../game/rng';
import type { TankId } from '../game/data';

export type MapId = 'valley' | 'sky' | 'sphinx' | 'ledge' | 'target';

export interface MapTheme {
  skyTop: string;
  skyBottom: string;
  grass: string;
  grassDark: string;
  dirtTop: string;
  dirtBottom: string;
  speck: string;
  far: string;
  cloud: string;
}

export interface MapDef {
  id: MapId;
  name: string;
  desc: string;
  theme: MapTheme;
  /** 팀별 스폰 x 범위 */
  spawnA: [number, number];
  spawnB: [number, number];
  build(rng: Rng): Terrain;
  /** 이 맵에서는 모두 이 탱크로 고정 */
  lockTank?: TankId;
  /** 이 맵에서는 이 무기(0~2)만 쓸 수 있다 */
  lockWeapon?: 0 | 1 | 2;
  /** 백발백중: 과녁 맞히기 (개인전·땅 안 파임·서로 피해 없음·아이템 없음·5턴) */
  practice?: boolean;
}

/** 백발백중 계단: 층마다 [시작 x, 끝 x, 땅 높이]. 층 너비는 탱크 6대쯤 */
export const STEP_W = 200;
export function targetSteps(): [number, number, number][] {
  return Array.from({ length: 8 }, (_, i) => [i * STEP_W, (i + 1) * STEP_W, 640 - i * 42]);
}

function fillColumns(t: Terrain, topAt: (x: number) => number, bottomAt?: (x: number) => number) {
  for (let x = 0; x < t.w; x++) {
    const top = Math.max(0, Math.round(topAt(x)));
    const bottom = bottomAt ? Math.min(t.h, Math.round(bottomAt(x))) : t.h;
    for (let y = top; y < bottom; y++) t.data[y * t.w + x] = 1;
  }
}

function noise(rng: Rng, terms = 4) {
  const parts = Array.from({ length: terms }, (_, i) => ({
    a: rng.range(4, 16) / (i + 1),
    f: rng.range(0.004, 0.012) * (i + 1),
    p: rng.range(0, Math.PI * 2),
  }));
  return (x: number) => parts.reduce((s, q) => s + q.a * Math.sin(x * q.f + q.p), 0);
}

const valley: MapDef = {
  id: 'valley',
  name: '뒷동산',
  desc: '양쪽 언덕과 가운데 계곡. 높은 쪽이 유리하고 계곡에 빠지면 탈출이 어렵다.',
  theme: {
    skyTop: '#5fb8ff', skyBottom: '#d8f1ff',
    grass: '#6ed34a', grassDark: '#3fa33a',
    dirtTop: '#b9824a', dirtBottom: '#6e4527', speck: '#8f5f35',
    far: '#9bd0a6', cloud: '#ffffff',
  },
  spawnA: [110, 470],
  spawnB: [1130, 1490],
  build(rng) {
    const t = new Terrain(MAP_W, MAP_H);
    const n = noise(rng);
    const depth = rng.range(280, 320);
    fillColumns(t, (x) => {
      const u = x / MAP_W - 0.5;
      const v = Math.exp(-((u / 0.17) ** 2));
      return 330 + depth * v + n(x) * (1 - v * 0.6);
    });
    return t;
  },
};

const sky: MapDef = {
  id: 'sky',
  name: '둥둥섬',
  desc: '하늘에 뜬 섬들. 아래는 낭떠러지라 땅을 깎아 떨어뜨리는 전략이 강하다.',
  theme: {
    skyTop: '#7ec8ff', skyBottom: '#fff3d6',
    grass: '#7be05c', grassDark: '#47b04a',
    dirtTop: '#c49a6c', dirtBottom: '#7b5a3c', speck: '#a07b52',
    far: '#ffffff', cloud: '#ffffff',
  },
  spawnA: [90, 400],
  spawnB: [1200, 1510],
  build(rng) {
    const t = new Terrain(MAP_W, MAP_H);
    const n = noise(rng, 3);
    const islands = [
      { cx: 245, top: 430, w: 205, depth: 150 },
      { cx: 630, top: 300 + rng.range(-20, 20), w: 115, depth: 110 },
      { cx: 800, top: 610, w: 120, depth: 90 },
      { cx: 975, top: 300 + rng.range(-20, 20), w: 115, depth: 110 },
      { cx: 1355, top: 430, w: 205, depth: 150 },
    ];
    for (const is of islands) {
      for (let x = Math.floor(is.cx - is.w); x <= Math.ceil(is.cx + is.w); x++) {
        if (x < 0 || x >= t.w) continue;
        const k = (x - is.cx) / is.w;
        if (Math.abs(k) > 1) continue;
        const edge = Math.sqrt(1 - k * k);
        const top = is.top + (1 - Math.pow(edge, 0.35)) * 40 + n(x) * 0.6;
        const bottom = is.top + 12 + is.depth * Math.pow(edge, 1.4);
        for (let y = Math.max(0, Math.round(top)); y < Math.min(t.h, bottom); y++) t.data[y * t.w + x] = 1;
      }
    }
    return t;
  },
};

const sphinx: MapDef = {
  id: 'sphinx',
  name: '모래밭',
  desc: '사막 한가운데 높은 피라미드와 석상. 고각 사격이 중요하다.',
  theme: {
    skyTop: '#ff9d6c', skyBottom: '#ffe3a3',
    grass: '#f3d27a', grassDark: '#dcb35a',
    dirtTop: '#e2b866', dirtBottom: '#a8743a', speck: '#c79a52',
    far: '#f0b77a', cloud: '#fff1dc',
  },
  spawnA: [90, 470],
  spawnB: [1130, 1510],
  build(rng) {
    const t = new Terrain(MAP_W, MAP_H);
    const n = noise(rng, 3);
    const apex = rng.range(215, 250);
    fillColumns(t, (x) => {
      const dune = 590 + n(x) * 1.2;
      const dx = Math.abs(x - 800);
      const pyramid = dx < 270 ? apex + (dx / 270) * (600 - apex) : Infinity;
      // 석상(받침대 + 머리)
      const sx = Math.min(Math.abs(x - 545), Math.abs(x - 1055));
      const statue = sx < 26 ? 470 : sx < 34 ? 520 : Infinity;
      return Math.min(dune, pyramid, statue);
    });
    return t;
  },
};

// 아슬아슬: 얇은 절벽 선반 위에서 멍뭉이끼리 땅파기탄만 쏜다. 정통으로 맞으면 발밑이 뚫려 떨어진다
const ledge: MapDef = {
  id: 'ledge',
  name: '아슬아슬',
  desc: '울퉁불퉁한 V자 절벽 위의 멍뭉이 대결! 땅파기탄으로 발밑을 파서 떨어뜨려라.',
  theme: {
    skyTop: '#6b6fd6', skyBottom: '#ffc3a0',
    grass: '#8fd86a', grassDark: '#55a84a',
    dirtTop: '#9a7a62', dirtBottom: '#5a4636', speck: '#7d6250',
    far: '#ffffff', cloud: '#ffe9f0',
  },
  spawnA: [90, 560],
  spawnB: [1040, 1510],
  lockTank: 'dog',
  lockWeapon: 1,
  build(rng) {
    const t = new Terrain(MAP_W, MAP_H);
    const n = noise(rng, 3);
    // 선반: 두께 122px. top(x)로 기울기·울퉁불퉁함을 준다
    const shelf = (x0: number, x1: number, top: (x: number) => number, thick: number) => {
      for (let x = x0; x <= x1; x++) {
        const edge = Math.min(x - x0, x1 - x) / 30;
        const th = thick * Math.min(1, 0.45 + edge) + n(x) * 0.15;
        const y0 = Math.round(top(x));
        for (let y = Math.max(0, y0); y < y0 + th; y++) t.data[y * t.w + x] = 1;
      }
    };
    // 울퉁불퉁: 크고 작은 굴곡을 무작위로 섞는다
    const b1 = noise(rng, 4);
    const bumps = Array.from({ length: 8 }, () => ({ x: rng.range(60, 1540), w: rng.range(18, 45), h: rng.range(-16, 22) }));
    const bumpy = (x: number) => b1(x) * 0.9 + bumps.reduce((s, q) => s - q.h * Math.exp(-(((x - q.x) / q.w) ** 2)), 0);
    // 전체가 V자 (약 22.5도): 바깥쪽이 높고 가운데로 갈수록 내려간다
    const hi = 320 + Math.round(rng.range(-10, 10));
    const lo = hi + 236; // 경사 약 22.5도
    shelf(40, 610, (x) => hi + ((x - 40) / 570) * (lo - hi) + bumpy(x), 122);
    shelf(990, 1560, (x) => hi + ((1560 - x) / 570) * (lo - hi) + bumpy(x), 122);
    // 작은 섬: 가운데 위쪽 하나, V자 아래쪽 양옆에 하나씩
    shelf(710, 890, (x) => hi - 20 + b1(x) * 0.3, 39);
    shelf(380, 500, (x) => lo + 115 + b1(x) * 0.3, 39);
    shelf(1100, 1220, (x) => lo + 115 + b1(x) * 0.3, 39);
    return t;
  },
};

// 백발백중: 왼쪽에서 오른쪽으로 완만하게 올라가는 계단. 꼬꼬댁 깃털탄으로 과녁을 맞힌다
const target: MapDef = {
  id: 'target',
  name: '백발백중',
  desc: '계단 위 과녁 20개를 꼬꼬댁 깃털탄으로! 5턴 동안 과녁 하나에 200점.',
  theme: {
    skyTop: '#7fd3ff', skyBottom: '#fff2c8',
    grass: '#9be36a', grassDark: '#5fb34a',
    dirtTop: '#c9a06a', dirtBottom: '#7a5634', speck: '#a07a4a',
    far: '#b8e6c0', cloud: '#ffffff',
  },
  spawnA: [20, 180],
  spawnB: [20, 180],
  lockTank: 'rooster',
  lockWeapon: 1,
  practice: true,
  build() {
    const t = new Terrain(MAP_W, MAP_H);
    const steps = targetSteps();
    fillColumns(t, (x) => steps[Math.min(steps.length - 1, Math.floor(x / STEP_W))][2]);
    return t;
  },
};

/** 지형 전체를 위로 올린다: 땅 윗면 평균과 바닥 사이 거리의 9%만큼 */
function raised(def: MapDef, down = 0): MapDef {
  return {
    ...def,
    build(rng) {
      const t = def.build(rng);
      let sum = 0;
      let n = 0;
      for (let x = 0; x < t.w; x++)
        for (let y = 0; y < t.h; y++)
          if (t.data[y * t.w + x]) {
            sum += y;
            n++;
            break;
          }
      const shift = n ? Math.round(0.09 * (t.h - sum / n)) : 0;
      if (shift > 0) {
        t.data.copyWithin(0, shift * t.w);
        // 아래 빈 줄은 맨 아랫줄을 이어 붙인다 (땅이면 땅, 낭떠러지면 빈칸)
        const last = (t.h - shift - 1) * t.w;
        for (let y = t.h - shift; y < t.h; y++) t.data.copyWithin(y * t.w, last, last + t.w);
      }
      // 맵별로 더 내린다 (px). 위는 빈 하늘로 채운다
      if (down > 0) {
        t.data.copyWithin(down * t.w, 0, (t.h - down) * t.w);
        t.data.fill(0, 0, down * t.w);
      }
      return t;
    },
  };
}

export const MAPS: Record<MapId, MapDef> = { valley: raised(valley, 150), sky: raised(sky, 150), sphinx: raised(sphinx), ledge, target }; // 아슬아슬은 위치를 직접 맞춰 두어 올리지 않는다 (올리면 천장에 잘림)
export const MAP_IDS: MapId[] = ['valley', 'sky', 'sphinx', 'ledge', 'target'];
/** '랜덤' 맵에서 나올 수 있는 맵 (특수 규칙 맵은 빠진다) */
export const RANDOM_MAP_IDS: MapId[] = ['valley', 'sky', 'sphinx'];

import { Terrain, MAP_W, MAP_H } from '../physics/terrain';
import { Rng } from '../game/rng';

export type MapId = 'valley' | 'sky' | 'sphinx';

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
  name: '밸리',
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
  name: '스카이',
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
  name: '스핑크스',
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

export const MAPS: Record<MapId, MapDef> = { valley, sky, sphinx };
export const MAP_IDS: MapId[] = ['valley', 'sky', 'sphinx'];

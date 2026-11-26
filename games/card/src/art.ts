/**
 * 그림 목록 (ASSETS.md). 시아열두길 art.ts 와 같은 방식: public/art/<이름>.png 로 넣고 여기 ART_FILES 에 이름을 적으면
 * 화면이 그 그림을 쓰고, 목록에 없거나 못 읽으면 코드 그림(또는 글자)으로 그린다. 파일이 없는 이름은 적지 않는다 (404 요청).
 * tests/art.test.ts 가 이 목록과 public/art 폴더가 같은지, 데이터의 그림 이름이 다 있는지 본다.
 */

export const HERO_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'cat'] as const;
export const BOSS_ARTS = ['gumiho', 'jangsanbeom', 'centipede', 'bigDokkaebi', 'bulgasal', 'gangcheori', 'guardCaptain', 'dueoksini', 'imugi', 'reaper', 'yagwanggwi', 'yeomra'] as const;
/** 일반 요괴 그림 (4지역) · 정예 모습(-elite)이 있는 것 · 맞은 모습(-hit)이 있는 것 */
export const ENEMY_ARTS = ['bamboo', 'fox', 'acorn', 'lynx', 'club', 'imp', 'wisp', 'firecart', 'guard', 'spirit', 'water', 'catfish', 'skeleton', 'ferryman', 'bomber'] as const;
const ELITE_ARTS = ['bamboo', 'fox', 'lynx', 'club', 'wisp', 'guard', 'spirit', 'water', 'skeleton'] as const;
const HIT_ARTS = ['bamboo', 'fox', 'club', 'imp', 'wisp', 'guard', 'spirit', 'water', 'skeleton'] as const;

const ICONS = [
  'acc-coin', 'acc-crit', 'acc-mp', 'acc-potion', 'acc-speed', 'armor', 'bow', 'coin', 'fan', 'hp', 'key', 'mp', 'roll',
  'sk-bolt', 'sk-dash', 'sk-fork', 'sk-rain', 'sk-spin', 'sk-throw', 'sk-tornado', 'sk-triple', 'spear', 'star', 'stone', 'sword',
] as const;
export const FX_ARTS = [
  'arrowfall', 'bolt', 'boom', 'claw', 'coin', 'fang', 'flame', 'gust', 'heal', 'poison', 'pool', 'pop', 'rain', 'shield', 'shock', 'slash', 'spin', 'thrust', 'wind',
] as const;
const P_ARTS = ['arrow', 'burr', 'fire', 'foxorb', 'orb', 'pollen', 'spear'] as const;
export const REGION_IDS = ['bamboo', 'field', 'palace', 'underworld'] as const;

export const ART_FILES: ReadonlySet<string> = new Set<string>([
  ...HERO_IDS.flatMap((h) => [`hero-${h}`, `cut-${h}`, `ic-u-${h}`]),
  ...BOSS_ARTS.flatMap((b) => [`b-${b}`, `b-${b}-atk`, `b-${b}-hit`]),
  'b-final',
  'b-final-atk',
  ...ENEMY_ARTS.map((e) => `e-${e}`),
  ...ELITE_ARTS.map((e) => `e-${e}-elite`),
  ...HIT_ARTS.map((e) => `e-${e}-hit`),
  ...ICONS.map((n) => `ic-${n}`),
  ...(['sword', 'spear', 'bow', 'fan'] as const).flatMap((k) => Array.from({ length: 12 }, (_, i) => `ic-w-${k}-${i}`)),
  ...FX_ARTS.map((n) => `fx-${n}`),
  ...P_ARTS.map((n) => `p-${n}`),
  ...(['fire', 'mud', 'poison', 'water'] as const).map((n) => `st-${n}`),
  ...REGION_IDS.flatMap((r) => [`tile-${r}`, `bg-${r}`]),
  ...[1, 2, 3, 4].flatMap((i) => [`story-${i}`, `ending-${i}`, `finale-${i}`]),
  'shop',
  'forge',
  'chest',
  'exit',
  'back',
  // 시아카드배틀 새 그림 (NOTES: ASSETS.md '새 그림 5장')
  'card-frame',
  'intent',
  'energy',
  'map-nodes',
]);

export const hasArt = (name: string | null | undefined): name is string => !!name && ART_FILES.has(name);

declare const __CARD_BUILD__: string;
/** 배포마다 바뀌는 그림 판본 (서비스 워커가 옛 그림을 내주지 않게) */
const VER = typeof __CARD_BUILD__ === 'string' ? __CARD_BUILD__ : 'dev';
const BASE = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL : './';
export const artUrl = (name: string) => `${BASE}art/${name}.png?v=${VER}`;

/** 영웅 시트 hero-<id>: 가로 5칸(서기 · 걷기 A · 걷기 B · 공격 · 구르기) × 세로 3줄(앞 · 옆 · 뒤), 칸 192 — 전투는 앞줄 서기(0)·공격(3) */
export const HERO_FRAME = 192;
export const HERO_STAND = 0;
export const HERO_ATTACK = 3;
/** 보스 공격 동작 b-<보스>-atk: 가로 2칸 (예고 · 내려치기), 칸 448 */
export const BOSS_ATK_FRAME = 448;
/** 의도 시트: 가로 5칸, 칸 128 */
export const INTENT_FRAME: Record<string, number> = { atk: 0, def: 1, buff: 2, debuff: 3, unknown: 4 };
/** 지도 칸 시트: 가로 6칸, 칸 128 */
export const MAP_NODE_FRAME: Record<string, number> = { battle: 0, elite: 1, shop: 2, rest: 3, treasure: 4, event: 5 };
/** 상태이상 그림: 열두길 느린 바닥 오토타일셋(4x4 · 칸 120)의 꽉 찬 칸(6번)을 동그랗게 잘라 쓴다 */
export const STATUS_ART: Record<string, string> = { fire: 'st-fire', poison: 'st-poison', wet: 'st-water', mud: 'st-mud' };
export const ST_CELL = 120;
export const ST_FULL = 6;

/** 카드 틀 (512×712) 의 자리 — 그림 칸은 투명하게 뚫려 있다 */
export const FRAME = {
  w: 512,
  h: 712,
  pic: { x: 57, y: 57, w: 397, h: 319 },
  cost: { x: 70, y: 65, r: 42 },
  name: { x: 256, y: 425, w: 355 },
  desc: { x: 42, y: 496, w: 430, h: 174 },
} as const;

/**
 * 화면 틀 그림을 읽었는지 — CSS 배경(지도 칸 시트)·곱하기 색(카드 틀)은 못 읽었는지 알 수 없어서 미리 읽어 본다.
 * frame: 카드 틀 (못 읽으면 HTML·캔버스 모두 코드 카드) · nodes: 지도 칸 시트 (못 읽으면 글자 그림)
 */
export const artState = { frame: false, nodes: false };

function tryLoad(name: string, timeout: number): Promise<boolean> {
  return new Promise((res) => {
    if (typeof Image === 'undefined' || !hasArt(name)) return res(false);
    const img = new Image();
    const t = setTimeout(() => res(false), timeout);
    img.onload = () => {
      clearTimeout(t);
      res(true);
    };
    img.onerror = () => {
      clearTimeout(t);
      res(false);
    };
    img.src = artUrl(name);
  });
}

/** 처음 화면 전에 틀 그림을 읽어 둔다 (오래 걸리면 코드 그림으로 시작) */
export async function preloadUi(timeout = 2000): Promise<void> {
  const [frame, nodes] = await Promise.all([tryLoad('card-frame', timeout), tryLoad('map-nodes', timeout)]);
  artState.frame = frame;
  artState.nodes = nodes;
}

/** 카드를 썼을 때 보이는 효과 그림 (카드 그림이 fx-* 면 그것, 아니면 효과로 고름) */
export function fxForCard(art: string, ops: { op: string; to?: string; times?: number; id?: string }[]): string {
  if (art.startsWith('fx-')) return art;
  const first = ops[0];
  if (!first) return 'fx-pop';
  if (first.op === 'dmg') return first.to === 'all' ? 'fx-spin' : (first.times ?? 1) > 1 ? 'fx-claw' : 'fx-slash';
  if (first.op === 'block' || first.op === 'clearBlock' || first.op === 'cleanse') return 'fx-shield';
  if (first.op === 'heal') return 'fx-heal';
  if (first.op === 'status') return first.id === 'fire' ? 'fx-flame' : first.id === 'poison' ? 'fx-poison' : first.id === 'wet' ? 'fx-rain' : 'fx-shock';
  return 'fx-pop';
}

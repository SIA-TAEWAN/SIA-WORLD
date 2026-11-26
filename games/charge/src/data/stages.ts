import { BOSS_IDS, firePower, type BossKind, type CrateReward, type EnemyKind, type ObstacleKind } from './balance';
import { CALIB } from './calib';
import { REGIONS, REGION_NAMES } from './growth';

/**
 * 스테이지 데이터 (PRD.md 8장). 스테이지 하나 = 길 위에 늘어놓은 물건 목록 + 끝의 보스.
 * z 는 출발점에서 앞으로 간 거리(px). 달리는 속도가 초당 300이라 z 3000 ≈ 10초.
 * 1지역은 손으로 만들고, 2~12지역은 generated() 가 지역·번호로 늘 같은 스테이지를 만든다 (무작위 씨앗 고정).
 * 끝없는 모드도 같은 buildSegment 로 구간을 하나씩 이어 붙인다.
 */

export type Op = '+' | '-' | 'x' | '/';

/** 문 하나: 연산과 숫자. + 와 - 는 총을 맞히면 숫자가 오른다 (- 는 0을 지나 + 가 된다) */
export interface GateSpec {
  op: Op;
  v: number;
}

/** 요괴 무리가 차지하는 폭 */
export type Span = 'full' | 'left' | 'right' | 'center';

export type Item =
  /** 문 한 줄 (2~3개가 길을 나눠 차지한다. 그중 하나만 통과한다) */
  | { t: 'gates'; z: number; gates: GateSpec[] }
  /** 길 한쪽에 길게 이어진 작은 문 줄 (그쪽으로 달리면 지날 때마다 계속 더해진다) */
  | { t: 'rail'; z0: number; z1: number; side: 'left' | 'right'; gap: number; gate: GateSpec }
  /** 요괴 무리 */
  | { t: 'horde'; z: number; kind: EnemyKind; count: number; span: Span }
  /** 장애물: 통나무(좌우로 굴러다님) · 회전 칼날 · 구덩이. x = 가운데 위치 */
  | { t: 'obstacle'; z: number; kind: ObstacleKind; x: number }
  /** 쏘아서 부수는 상자 */
  | { t: 'crate'; z: number; x: number; reward: CrateReward };

export interface BossTraits {
  /** 한 번에 두 군데를 친다 (하나는 무리 쪽, 하나는 반대쪽) */
  double?: boolean;
  /** 공격 every 번마다 요괴 무리를 앞에 불러낸다 */
  summon?: { kind: EnemyKind; count: number; every: number };
  /** 싸움이 길어질수록 단단해진다 (60초에 받는 피해 40%까지) */
  harden?: boolean;
  /** 정면 사격 피해 배율 (무리 가운데가 길 가운데 100 안이면) */
  shield?: number;
  /** 맞으면 이 시간 동안 쏘지 못한다 */
  freeze?: number;
  /** 친 자리가 이 시간 동안 불길로 남아 초마다 그 자리 대원의 15%를 태운다 */
  burn?: number;
}

export interface BossSpec {
  kind: BossKind;
  hp: number;
  /** 공격 간격(초) */
  every: number;
  /** 공격 예고 시간(초): 이만큼 전에 떨어질 자리가 빨갛게 보인다 */
  warn: number;
  /** 공격 폭 */
  width: number;
  /** 공격 자리에 있던 대원 중 잃는 비율 */
  frac: number;
  /** 보스별 버릇 (PRD 7장) */
  traits?: BossTraits;
}

export interface StageDef {
  id: string;
  region: number;
  no: number;
  name: string;
  startTroops: number;
  items: Item[];
  /** 보스가 서 있는 거리 (이 앞 BOSS_STOP 에서 멈춰 싸운다) */
  bossZ: number;
  boss: BossSpec;
  /** 별 2개·3개 기준: 보스를 쓰러뜨릴 때 남은 대원 수 */
  stars: [number, number];
  /** 만든 스테이지: 잘 고른 사람이 보스 앞에 왔을 때의 예상 대원 수 */
  expect?: number;
  /** 오늘의 길: 그날의 코스 씨앗 (끝없는 길 구간을 이 씨앗으로 만든다) */
  seed?: number;
}

const chief = (hp: number): BossSpec => ({ kind: 'chief', hp, every: 3.2, warn: 1.2, width: 220, frac: 0.4 });

/** 1지역: 쥐의 들판. 1~4번째는 작은 대장 요괴, 5번째는 지역 보스 */
const REGION1: StageDef[] = [
  {
    id: '1-1', region: 1, no: 1, name: '첫 돌격', startTroops: 5,
    items: [
      { t: 'gates', z: 900, gates: [{ op: '+', v: 5 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 2600, kind: 'imp', count: 12, span: 'full' },
      { t: 'gates', z: 4000, gates: [{ op: '-', v: 4 }, { op: '+', v: 10 }] },
      { t: 'rail', z0: 5200, z1: 7600, side: 'left', gap: 300, gate: { op: '+', v: 1 } },
      { t: 'gates', z: 8400, gates: [{ op: 'x', v: 2 }, { op: '+', v: 15 }] },
      { t: 'horde', z: 10200, kind: 'imp', count: 30, span: 'full' },
      { t: 'gates', z: 11800, gates: [{ op: '+', v: 20 }, { op: '-', v: 10 }] },
      { t: 'horde', z: 13400, kind: 'imp', count: 25, span: 'left' },
    ],
    bossZ: 15600, boss: chief(1500), stars: [55, 115],
  },
  {
    id: '1-2', region: 1, no: 2, name: '갈림길', startTroops: 5,
    items: [
      { t: 'gates', z: 900, gates: [{ op: 'x', v: 3 }, { op: '+', v: 6 }] },
      { t: 'gates', z: 2300, gates: [{ op: '-', v: 6 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 3800, kind: 'imp', count: 20, span: 'full' },
      { t: 'rail', z0: 5000, z1: 7400, side: 'right', gap: 300, gate: { op: '+', v: 2 } },
      { t: 'horde', z: 8400, kind: 'wisp', count: 18, span: 'full' },
      { t: 'gates', z: 9800, gates: [{ op: '/', v: 2 }, { op: '+', v: 25 }, { op: 'x', v: 2 }] },
      { t: 'obstacle', z: 10800, kind: 'log', x: 0 },
      { t: 'horde', z: 11800, kind: 'imp', count: 45, span: 'full' },
      { t: 'gates', z: 13200, gates: [{ op: '+', v: 30 }, { op: '-', v: 15 }] },
    ],
    bossZ: 15600, boss: chief(2400), stars: [85, 170],
  },
  {
    id: '1-3', region: 1, no: 3, name: '방망이 소리', startTroops: 6,
    items: [
      { t: 'gates', z: 900, gates: [{ op: '+', v: 8 }, { op: 'x', v: 2 }] },
      { t: 'horde', z: 2400, kind: 'club', count: 4, span: 'full' },
      { t: 'gates', z: 3800, gates: [{ op: 'x', v: 2 }, { op: '-', v: 5 }, { op: '+', v: 12 }] },
      { t: 'horde', z: 5400, kind: 'imp', count: 30, span: 'right' },
      { t: 'rail', z0: 6200, z1: 8600, side: 'left', gap: 300, gate: { op: '+', v: 2 } },
      { t: 'obstacle', z: 9000, kind: 'blade', x: -140 },
      { t: 'horde', z: 9600, kind: 'club', count: 8, span: 'full' },
      { t: 'gates', z: 11000, gates: [{ op: '/', v: 2 }, { op: 'x', v: 3 }] },
      { t: 'crate', z: 12000, x: 0, reward: { kind: 'troops', v: 20 } },
      { t: 'horde', z: 12800, kind: 'imp', count: 60, span: 'full' },
    ],
    bossZ: 15600, boss: chief(3600), stars: [85, 170],
  },
  {
    id: '1-4', region: 1, no: 4, name: '도깨비불 떼', startTroops: 6,
    items: [
      { t: 'gates', z: 900, gates: [{ op: 'x', v: 2 }, { op: '+', v: 7 }] },
      { t: 'horde', z: 2300, kind: 'wisp', count: 20, span: 'full' },
      { t: 'gates', z: 3700, gates: [{ op: '-', v: 8 }, { op: '+', v: 15 }] },
      { t: 'rail', z0: 4600, z1: 7000, side: 'right', gap: 300, gate: { op: '+', v: 3 } },
      { t: 'horde', z: 7800, kind: 'wisp', count: 40, span: 'full' },
      { t: 'gates', z: 9200, gates: [{ op: 'x', v: 2 }, { op: '/', v: 3 }, { op: '+', v: 30 }] },
      { t: 'obstacle', z: 10000, kind: 'pit', x: 140 },
      { t: 'horde', z: 10800, kind: 'club', count: 10, span: 'center' },
      { t: 'horde', z: 12200, kind: 'imp', count: 80, span: 'full' },
      { t: 'gates', z: 13600, gates: [{ op: '+', v: 40 }, { op: 'x', v: 2 }] },
    ],
    bossZ: 15800, boss: chief(5000), stars: [115, 230],
  },
  {
    id: '1-5', region: 1, no: 5, name: '큰 도깨비', startTroops: 8,
    items: [
      { t: 'gates', z: 900, gates: [{ op: 'x', v: 2 }, { op: '+', v: 10 }] },
      { t: 'horde', z: 2300, kind: 'imp', count: 25, span: 'full' },
      { t: 'gates', z: 3700, gates: [{ op: '+', v: 20 }, { op: '-', v: 10 }, { op: 'x', v: 2 }] },
      { t: 'rail', z0: 4600, z1: 7000, side: 'left', gap: 300, gate: { op: '+', v: 3 } },
      { t: 'horde', z: 7800, kind: 'club', count: 10, span: 'full' },
      { t: 'gates', z: 9200, gates: [{ op: 'x', v: 3 }, { op: '/', v: 2 }] },
      { t: 'crate', z: 10000, x: 140, reward: { kind: 'power', sec: 6 } },
      { t: 'horde', z: 10800, kind: 'wisp', count: 60, span: 'full' },
      { t: 'gates', z: 12200, gates: [{ op: '-', v: 20 }, { op: '+', v: 50 }] },
      { t: 'obstacle', z: 13000, kind: 'log', x: 0 },
      { t: 'horde', z: 13600, kind: 'imp', count: 120, span: 'full' },
    ],
    bossZ: 16400, boss: { kind: 'bigDokkaebi', hp: 9000, every: 2.8, warn: 1.1, width: 240, frac: 0.45 }, stars: [125, 250],
  },
];

/** 씨앗이 같으면 늘 같은 수열 (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 지역마다 나오는 요괴 (PRD 8장: 지역마다 새 요괴가 하나씩) */
export const REGION_ENEMIES: EnemyKind[][] = [
  ['imp', 'wisp', 'club'],
  ['imp', 'wisp', 'club'],
  ['imp', 'club', 'water'],
  ['imp', 'wisp', 'fox', 'water'],
  ['imp', 'bamboo', 'fox', 'club'],
  ['wisp', 'water', 'fox', 'bamboo', 'club'],
  ['imp', 'guard', 'fox', 'club'],
  ['guard', 'wisp', 'water', 'bamboo'],
  ['fox', 'guard', 'wisp', 'club'],
  ['skeleton', 'imp', 'fox', 'guard'],
  ['spirit', 'skeleton', 'wisp', 'water'],
  ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'],
];

/** 요괴 한 마리가 꼬마 도깨비 몇 마리 몫인가 (무리 크기를 맞출 때) */
const WEIGHT: Record<EnemyKind, number> = { imp: 1, wisp: 0.9, club: 4, water: 1.3, fox: 1.4, bamboo: 1.8, guard: 3, skeleton: 1.6, spirit: 1.2 };

/** 지역 보스 12종의 버릇 (PRD 7장). 지역 보스 = BOSS_IDS[지역-1] */
const BOSS_TRAITS: Record<string, Omit<BossSpec, 'kind' | 'hp'>> = {
  bigDokkaebi: { every: 2.8, warn: 1.1, width: 240, frac: 0.45 },
  dueoksini: { every: 3, warn: 1.1, width: 220, frac: 0.4, traits: { summon: { kind: 'imp', count: 25, every: 2 } } },
  bulgasal: { every: 2.8, warn: 1.1, width: 240, frac: 0.4, traits: { harden: true } },
  jangsanbeom: { every: 2.2, warn: 0.8, width: 200, frac: 0.4 },
  centipede: { every: 3, warn: 1.1, width: 340, frac: 0.4 },
  gumiho: { every: 3, warn: 1.1, width: 200, frac: 0.4, traits: { double: true } },
  guardCaptain: { every: 3, warn: 1.1, width: 220, frac: 0.4, traits: { shield: 0.5, summon: { kind: 'guard', count: 6, every: 3 } } },
  yagwanggwi: { every: 2.8, warn: 1, width: 220, frac: 0.35, traits: { freeze: 1.5 } },
  imugi: { every: 3.2, warn: 1.2, width: 300, frac: 0.4, traits: { double: true } },
  reaper: { every: 3, warn: 1, width: 220, frac: 0.35, traits: { double: true } },
  gangcheori: { every: 3, warn: 1.1, width: 220, frac: 0.35, traits: { burn: 2.5 } },
  yeomra: { every: 3, warn: 1.1, width: 230, frac: 0.35, traits: { double: true, summon: { kind: 'skeleton', count: 12, every: 3 } } },
};

/** 난이도 d (0 = 1-1, 59 = 12-5) → 0~1 */
export const tierOf = (d: number) => Math.max(0, Math.min(1, d / 59));

/**
 * 그 지역까지 강화를 보통만큼 했을 때의 화력·보스 피해 배율 (보스 체력을 정할 때. 강화가 덜 되면 보스전이 길어진다).
 * f = 0(처음) ~ 1(거의 다 강화). growth.ts 의 modsOf 와 같은 식
 */
export const expectedDmg = (f: number) => (1 + 0.05 * 20 * f) * (1 + 0.03 * 10 * f) * (1 + 0.05 * 10 * f);

/**
 * 길 한 구간을 만든다: z0 부터 len 만큼, 문 · 요괴 · 긴 문 줄 · 장애물 · 상자를 번갈아.
 * 잘 고른 사람의 대원 수(T)를 따라가며 요괴 무리 크기와 문 숫자를 정한다 (그래서 어느 지역이든 손맛이 비슷하다).
 * 스테이지와 끝없는 모드가 같이 쓴다. → 물건 목록과 보스 앞에서의 예상 대원 수
 */
/**
 * noCoins: 끝없는 길·오늘의 길 구간. 서버(charge_finish)가 이 판들의 상자 엽전을 쳐주지 않으므로
 * 엽전 상자를 힘 상자로 바꾼다 (rng 호출 순서는 그대로라 다른 배치는 바뀌지 않는다)
 */
export function buildSegment(r: () => number, f: number, pool: EnemyKind[], z0: number, len: number, t0: number, noCoins = false): { items: Item[]; troops: number } {
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const cap = (n: number) => Math.max(1, Math.min(3000, Math.round(n)));
  const items: Item[] = [];
  let T = t0;
  let z = z0 + 900;
  let beat = 0;
  const end = z0 + len - 1400;
  while (z < end) {
    const kind = beat % 2 === 0 ? 'gates' : beat > 2 && r() < 0.3 ? 'special' : 'horde';
    if (kind === 'gates') {
      // 좋은 문 하나는 꼭 있게. 나쁜 문은 뒤로 갈수록 자주
      const good: GateSpec = r() < 0.4 && T < 1500 ? { op: 'x', v: r() < 0.75 ? 2 : 3 } : { op: '+', v: cap(T * (0.5 + r() * 0.5) + 4) };
      const bad: GateSpec = r() < 0.35 + f * 0.35 ? (r() < 0.5 ? { op: '/', v: 2 } : { op: '-', v: cap(T * (0.3 + r() * 0.3)) }) : { op: '+', v: cap(T * 0.2 + 2) };
      const gates: GateSpec[] = [good, bad];
      if (r() < 0.35) gates.push(r() < 0.5 ? { op: '-', v: cap(T * 0.5) } : { op: '+', v: cap(T * 0.35 + 3) });
      for (let i = gates.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [gates[i], gates[j]] = [gates[j], gates[i]];
      }
      items.push({ t: 'gates', z, gates });
      // 잘 고른 사람은 가는 동안 + 문을 쏘아 숫자도 올린다
      const shot = 0.5 * Math.pow(T, 0.7);
      T = Math.max(...gates.map((g) => (g.op === '+' ? T + g.v + shot : g.op === 'x' ? T * g.v : g.op === '-' ? T - g.v + shot : T / g.v)));
      z += 1300 + Math.floor(r() * 300);
    } else if (kind === 'horde') {
      const k = pick(pool);
      const span: Span = r() < 0.72 ? 'full' : pick(['left', 'right', 'center'] as const);
      // 꼬마 도깨비로 치면 예상 대원의 40~95% (뒤 지역일수록 크게)
      const eq = T * (0.65 + 0.6 * f) * (0.85 + r() * 0.3);
      items.push({ t: 'horde', z, kind: k, count: Math.max(3, Math.round(eq / WEIGHT[k])), span });
      if (span === 'full') T = Math.max(4, T - eq * 0.2);
      z += 1400 + Math.floor(r() * 300);
    } else {
      const s = r();
      if (s < 0.4 && z + 2100 < end) {
        const side = r() < 0.5 ? 'left' : 'right';
        const v = Math.max(1, Math.round(T * 0.04));
        items.push({ t: 'rail', z0: z, z1: z + 2100, side, gap: 300, gate: { op: '+', v } });
        T += v * 8;
        z += 2900;
      } else if (s < 0.75) {
        const ok = pick(['log', 'blade', 'pit'] as const);
        items.push({ t: 'obstacle', z, kind: ok, x: ok === 'log' ? 0 : pick([-140, 0, 140]) });
        T *= 0.92;
        z += 900;
      } else {
        const picked = pick<CrateReward>([{ kind: 'troops', v: cap(T * 0.25 + 5) }, { kind: 'coins', v: 5 }, { kind: 'power', sec: 6 }]);
        const reward: CrateReward = noCoins && picked.kind === 'coins' ? { kind: 'power', sec: 6 } : picked;
        items.push({ t: 'crate', z, x: pick([-140, 140]), reward });
        if (reward.kind === 'troops') T += reward.v;
        z += 900;
      }
    }
    T = Math.min(3000, T);
    beat++;
  }
  return { items, troops: T };
}

/** 보스 체력: 예상 대원의 화력 × 싸움 시간 × 그 지역까지의 보통 강화 배율 */
const bossHp = (troops: number, sec: number, f: number) => Math.round(firePower(troops) * sec * expectedDmg(f));

/** 지역 2~12의 스테이지 (지역·번호로 늘 같은 것이 나온다) */
function generated(region: number, no: number): StageDef {
  const f = (region - 1) / 11;
  const r = rng(region * 1000 + no * 17);
  const boss = no === 5;
  const len = boss ? 16400 : 15600;
  const start = 6 + region;
  const seg = buildSegment(r, f, REGION_ENEMIES[region - 1], 0, len, start);
  const id = BOSS_IDS[region - 1];
  // 보스 앞 대원 수: 보정 값(npm run calib)이 있으면 그것, 없으면 만들 때의 예상
  const T = CALIB[`${region}-${no}`] || seg.troops;
  const bossSpec: BossSpec = boss ? { kind: id, hp: bossHp(T, 22, f), ...BOSS_TRAITS[id] } : chief(bossHp(T, 8 + 2 * no, f));
  const short = REGION_NAMES[region - 1].replace(/의 .*/, '').replace(/ .*/, '');
  return {
    id: `${region}-${no}`,
    region,
    no,
    name: boss ? `${short} 지역 보스` : `${REGION_NAMES[region - 1]} ${no}`,
    startTroops: start,
    items: seg.items,
    bossZ: len,
    boss: bossSpec,
    stars: [Math.max(10, Math.round(T * 0.35)), Math.max(20, Math.round(T * 0.7))],
    expect: Math.round(T),
  };
}

export const STAGES: StageDef[] = [...REGION1];
for (let region = 2; region <= REGIONS; region++) for (let no = 1; no <= 5; no++) STAGES.push(generated(region, no));

export const stageOf = (id: string): StageDef | undefined => STAGES.find((s) => s.id === id);
export const stagesOf = (region: number): StageDef[] => STAGES.filter((s) => s.region === region);
/** 다음 스테이지 (없으면 null) */
export function nextStage(id: string): StageDef | null {
  const i = STAGES.findIndex((s) => s.id === id);
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1] : null;
}
/** 스테이지에 든 상자 엽전 합 (서버가 상자 엽전 상한으로 쓴다) */
export const crateCoinsOf = (items: Item[]) => items.reduce((a, it) => a + (it.t === 'crate' && it.reward.kind === 'coins' ? it.reward.v : 0), 0);

// ---------- 끝없는 모드 ----------

export const ENDLESS_ID = 'endless';
/** 끝없는 모드 한 구간 길이 (구간 끝마다 보스) */
export const ENDLESS_SEG = 9000;

/** 끝없는 모드 k번째 구간 (0부터): 물건 + 끝의 보스. 구간마다 조금씩 어려워진다 */
export function endlessSegment(k: number, seed?: number): { items: Item[]; bossZ: number; boss: BossSpec } {
  const f = Math.min(1, k / 10);
  // 씨앗이 없으면 늘 같은 끝없는 길, 있으면(오늘의 길) 그 씨앗의 코스
  const daily = seed !== undefined;
  const r = rng(daily ? (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0 : 777 + k * 31);
  const z0 = k * ENDLESS_SEG;
  // 앞 구간에서 얼마나 남았는지 모르므로, 구간마다 예상 대원이 늘어난다고 본다
  const seg = buildSegment(r, f, REGION_ENEMIES[Math.min(11, k)], z0, ENDLESS_SEG, 20 * Math.pow(1.35, k), true);
  const big = k % 3 === 2;
  const id = BOSS_IDS[(Math.floor(k / 3) + (daily ? dailyBossShift(seed) : 0)) % BOSS_IDS.length];
  const boss: BossSpec = big ? { kind: id, hp: bossHp(seg.troops, 14, f), ...BOSS_TRAITS[id] } : chief(bossHp(seg.troops, 7, f));
  return { items: seg.items, bossZ: z0 + ENDLESS_SEG, boss };
}

// ---------- 오늘의 도전: 오늘의 길 ----------

export const DAILY_ID = 'daily';
/** 오늘의 길에서 지역 보스가 나오는 순서의 시작 (씨앗마다 다르다) */
export const dailyBossShift = (seed: number) => (seed >>> 0) % BOSS_IDS.length;
/** 끝없는 길처럼 구간을 이어 붙이는 판인가 (끝없는 길 · 오늘의 길) */
export const isEndlessId = (id: string) => id === ENDLESS_ID || id === DAILY_ID;

/** 오늘의 길 판의 시작 모양: 끝없는 길과 같은 규칙, 코스만 그날의 씨앗으로 */
export function dailyStage(seed: number): StageDef {
  const seg = endlessSegment(0, seed);
  return { id: DAILY_ID, region: 0, no: 0, name: '오늘의 길', startTroops: 8, items: seg.items, bossZ: seg.bossZ, boss: seg.boss, stars: [0, 0], seed };
}

/** 끝없는 모드 판의 시작 모양 (첫 구간) */
export function endlessStage(): StageDef {
  const seg = endlessSegment(0);
  return { id: ENDLESS_ID, region: 0, no: 0, name: '끝없는 길', startTroops: 8, items: seg.items, bossZ: seg.bossZ, boss: seg.boss, stars: [0, 0] };
}

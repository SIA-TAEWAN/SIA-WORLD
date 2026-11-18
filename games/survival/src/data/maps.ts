/**
 * 맵 4종 (PRD 6장)과 맵별 시간대 등장 표.
 * 맵마다 요괴 구성·전용 요괴·보스 3종·지형이 다르다. 뒤 맵일수록 요괴가 강하고(체력·속도·수) 엽전을 더 준다.
 */

/** 등장 표 한 줄: from~to 초 동안 초당 rate0 → rate1 번 (곧은 선으로 늘거나 줄어든다). 줄지어 오는 요괴는 한 번에 한 줄 */
export interface SpawnRow {
  enemy: string;
  from: number;
  to: number;
  rate0: number;
  rate1: number;
}

/** 떼로 몰려오는 이벤트: at 초에 count 마리가 한꺼번에 (ring: 사방을 둘러쌈, side: 한쪽에서 몰려옴) */
export interface SwarmEvent {
  at: number;
  enemy: string;
  count: number;
  shape: 'ring' | 'side';
}

/**
 * 지형: 장애물이 놓이는 방식 (src/game/terrain.ts).
 *   none 없음 · scatter 흩어진 포기(대나무) · walls 줄지은 담(궁궐) · pools 웅덩이(삼도천 물길)
 * cell: 칸 크기, chance: 칸에 장애물이 있을 확률, r: 장애물 하나의 반지름
 */
export interface TerrainDef {
  kind: 'none' | 'scatter' | 'walls' | 'pools';
  cell: number;
  chance: number;
  r: number;
}

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  /** 난이도 글자 */
  level: string;
  /** 엽전 배율 */
  coinMul: number;
  /** 요괴 강함: 체력·속도·수·닿았을 때 피해의 배율, boss 는 보스 체력 배율 */
  power: { hp: number; speed: number; count: number; dmg: number; boss: number };
  /** 시간이 갈수록 강해짐: 1분마다 체력·피해가 이만큼(비율) 는다 */
  growth: { hpPerMin: number; dmgPerMin: number };
  terrain: TerrainDef;
  spawns: SpawnRow[];
  swarms: SwarmEvent[];
  /** 보스: at 초에 등장 (마지막이 최종 보스) */
  bosses: { at: number; id: string }[];
  /** 해금 조건 */
  unlock: string;
  /** 등장 표까지 만들어졌나 */
  ready: boolean;
}

const END = 99999;

export const MAPS: MapDef[] = [
  {
    id: 'field', name: '들판', desc: '넓은 풀밭, 장애물이 적다', level: '쉬움', coinMul: 1, ready: true, unlock: '처음부터',
    power: { hp: 1, speed: 1, count: 1.5, dmg: 0.5, boss: 1 },
    growth: { hpPerMin: 0.26, dmgPerMin: 0.12 },
    terrain: { kind: 'none', cell: 200, chance: 0, r: 0 },
    spawns: [
      // 0~3분: 약한 요괴 위주, 수가 점점 늘어남
      { enemy: 'imp', from: 0, to: 180, rate0: 1.5, rate1: 5.0 },
      { enemy: 'wisp', from: 120, to: 180, rate0: 0.5, rate1: 1.2 },
      // 3~7분: 빠른 요괴·단단한 요괴 추가
      { enemy: 'imp', from: 180, to: 420, rate0: 4.6, rate1: 5.0 },
      { enemy: 'wisp', from: 180, to: 420, rate0: 1.5, rate1: 3.0 },
      { enemy: 'club', from: 240, to: 420, rate0: 0.25, rate1: 0.7 },
      { enemy: 'water', from: 300, to: 420, rate0: 0.2, rate1: 0.5 },
      // 7~10분: 가장 강한 요괴, 원거리 요괴 (10분 뒤에는 최종 보스와 함께 계속)
      { enemy: 'imp', from: 420, to: END, rate0: 4.0, rate1: 4.0 },
      { enemy: 'wisp', from: 420, to: 600, rate0: 2.4, rate1: 2.8 },
      { enemy: 'club', from: 420, to: 600, rate0: 0.7, rate1: 0.9 },
      { enemy: 'water', from: 420, to: 600, rate0: 0.5, rate1: 0.7 },
      { enemy: 'fox', from: 420, to: 600, rate0: 0.1, rate1: 0.25 },
      { enemy: 'wisp', from: 600, to: END, rate0: 2.0, rate1: 2.0 },
      { enemy: 'club', from: 600, to: END, rate0: 0.6, rate1: 0.6 },
      { enemy: 'fox', from: 600, to: END, rate0: 0.2, rate1: 0.2 },
    ],
    swarms: [
      { at: 205, enemy: 'imp', count: 44, shape: 'ring' },
      { at: 285, enemy: 'wisp', count: 24, shape: 'side' },
      { at: 345, enemy: 'imp', count: 40, shape: 'ring' },
      { at: 465, enemy: 'wisp', count: 36, shape: 'side' },
      { at: 525, enemy: 'imp', count: 36, shape: 'ring' },
      { at: 570, enemy: 'club', count: 8, shape: 'ring' },
    ],
    bosses: [
      { at: 180, id: 'bigDokkaebi' },
      { at: 420, id: 'dueoksini' },
      { at: 600, id: 'bulgasal' },
    ],
  },
  {
    // 도깨비불·물귀신·여우불 + 죽순 요괴. 빠른 요괴와 원거리 요괴가 일찍 나온다. 대나무가 길을 막는다
    id: 'bamboo', name: '대나무 숲', desc: '대나무가 길을 막는다', level: '보통', coinMul: 1.5, ready: true, unlock: '들판을 끝까지 버티기',
    power: { hp: 1.3, speed: 1.04, count: 1.05, dmg: 0.6, boss: 1.3 },
    growth: { hpPerMin: 0.26, dmgPerMin: 0.04 },
    terrain: { kind: 'scatter', cell: 190, chance: 0.5, r: 22 },
    spawns: [
      { enemy: 'imp', from: 0, to: 180, rate0: 1.0, rate1: 2.4 },
      { enemy: 'wisp', from: 0, to: 180, rate0: 0.4, rate1: 2.0 },
      { enemy: 'fox', from: 90, to: 180, rate0: 0.06, rate1: 0.15 },
      { enemy: 'wisp', from: 180, to: 420, rate0: 2.0, rate1: 3.0 },
      { enemy: 'imp', from: 180, to: 420, rate0: 2.4, rate1: 2.4 },
      { enemy: 'water', from: 180, to: 420, rate0: 0.15, rate1: 0.4 },
      { enemy: 'bamboo', from: 180, to: 420, rate0: 0.15, rate1: 0.3 },
      { enemy: 'fox', from: 180, to: 420, rate0: 0.15, rate1: 0.3 },
      { enemy: 'wisp', from: 420, to: END, rate0: 3.0, rate1: 3.0 },
      { enemy: 'imp', from: 420, to: END, rate0: 2.4, rate1: 2.4 },
      { enemy: 'water', from: 420, to: 600, rate0: 0.4, rate1: 0.6 },
      { enemy: 'bamboo', from: 420, to: END, rate0: 0.3, rate1: 0.3 },
      { enemy: 'fox', from: 420, to: 600, rate0: 0.3, rate1: 0.45 },
      { enemy: 'club', from: 420, to: 600, rate0: 0.2, rate1: 0.4 },
      { enemy: 'fox', from: 600, to: END, rate0: 0.25, rate1: 0.25 },
    ],
    swarms: [
      { at: 150, enemy: 'wisp', count: 18, shape: 'side' },
      { at: 240, enemy: 'bamboo', count: 8, shape: 'ring' },
      { at: 330, enemy: 'wisp', count: 28, shape: 'ring' },
      { at: 480, enemy: 'water', count: 16, shape: 'side' },
      { at: 540, enemy: 'wisp', count: 36, shape: 'ring' },
    ],
    bosses: [
      { at: 180, id: 'jangsanbeom' },
      { at: 420, id: 'centipede' },
      { at: 600, id: 'gumiho' },
    ],
  },
  {
    // 전 종류 + 수문장 요괴. 떼로 몰려오는 이벤트가 잦다. 담 사이로 길이 좁다
    id: 'palace', name: '달빛 궁궐', desc: '밤 분위기, 길이 좁다', level: '어려움', coinMul: 2, ready: true, unlock: '대나무 숲을 끝까지 버티기',
    power: { hp: 1.6, speed: 1.06, count: 1.15, dmg: 0.72, boss: 1.6 },
    growth: { hpPerMin: 0.26, dmgPerMin: 0.04 },
    terrain: { kind: 'walls', cell: 300, chance: 0.55, r: 30 },
    spawns: [
      { enemy: 'imp', from: 0, to: 180, rate0: 1.2, rate1: 3.0 },
      { enemy: 'wisp', from: 60, to: 180, rate0: 0.3, rate1: 1.0 },
      { enemy: 'club', from: 120, to: 180, rate0: 0.08, rate1: 0.2 },
      { enemy: 'imp', from: 180, to: 420, rate0: 3.0, rate1: 3.2 },
      { enemy: 'wisp', from: 180, to: 420, rate0: 1.0, rate1: 1.6 },
      { enemy: 'club', from: 180, to: 420, rate0: 0.2, rate1: 0.3 },
      { enemy: 'water', from: 240, to: 420, rate0: 0.1, rate1: 0.25 },
      { enemy: 'guard', from: 180, to: 420, rate0: 0.03, rate1: 0.05 },
      { enemy: 'fox', from: 300, to: 420, rate0: 0.1, rate1: 0.2 },
      { enemy: 'imp', from: 420, to: END, rate0: 3.2, rate1: 3.2 },
      { enemy: 'wisp', from: 420, to: END, rate0: 1.6, rate1: 1.6 },
      { enemy: 'club', from: 420, to: 600, rate0: 0.3, rate1: 0.45 },
      { enemy: 'water', from: 420, to: 600, rate0: 0.25, rate1: 0.35 },
      { enemy: 'guard', from: 420, to: END, rate0: 0.05, rate1: 0.05 },
      { enemy: 'fox', from: 420, to: END, rate0: 0.2, rate1: 0.2 },
    ],
    swarms: [
      { at: 90, enemy: 'imp', count: 16, shape: 'ring' },
      { at: 150, enemy: 'wisp', count: 14, shape: 'side' },
      { at: 225, enemy: 'imp', count: 24, shape: 'ring' },
      { at: 280, enemy: 'guard', count: 6, shape: 'side' },
      { at: 330, enemy: 'wisp', count: 24, shape: 'ring' },
      { at: 380, enemy: 'club', count: 6, shape: 'side' },
      { at: 460, enemy: 'imp', count: 32, shape: 'ring' },
      { at: 500, enemy: 'guard', count: 6, shape: 'side' },
      { at: 540, enemy: 'water', count: 16, shape: 'ring' },
      { at: 575, enemy: 'wisp', count: 30, shape: 'side' },
    ],
    bosses: [
      { at: 180, id: 'guardCaptain' },
      { at: 420, id: 'yagwanggwi' },
      { at: 600, id: 'imugi' },
    ],
  },
  {
    // 해골 병사·원혼·도깨비불·물귀신·여우불. 처음부터 수가 많고 원거리 요괴가 일찍 나온다. 군데군데 삼도천 물길
    id: 'underworld', name: '황천길', desc: '저승으로 가는 어두운 길, 안개와 푸른 불빛', level: '매우 어려움', coinMul: 2.5, ready: true, unlock: '달빛 궁궐을 끝까지 버티기',
    power: { hp: 2, speed: 1.08, count: 1.18, dmg: 0.84, boss: 1.8 },
    growth: { hpPerMin: 0.26, dmgPerMin: 0.04 },
    terrain: { kind: 'pools', cell: 360, chance: 0.45, r: 52 },
    spawns: [
      { enemy: 'skeleton', from: 0, to: 180, rate0: 0.6, rate1: 1.6 },
      { enemy: 'wisp', from: 30, to: 180, rate0: 0.2, rate1: 0.7 },
      { enemy: 'fox', from: 60, to: 180, rate0: 0.05, rate1: 0.15 },
      { enemy: 'skeleton', from: 180, to: 420, rate0: 1.6, rate1: 2.0 },
      { enemy: 'spirit', from: 180, to: 420, rate0: 0.3, rate1: 1.0 },
      { enemy: 'wisp', from: 180, to: 420, rate0: 0.7, rate1: 1.0 },
      { enemy: 'water', from: 180, to: 420, rate0: 0.1, rate1: 0.3 },
      { enemy: 'fox', from: 180, to: 420, rate0: 0.15, rate1: 0.3 },
      { enemy: 'skeleton', from: 420, to: END, rate0: 2.0, rate1: 2.0 },
      { enemy: 'spirit', from: 420, to: END, rate0: 1.0, rate1: 1.0 },
      { enemy: 'wisp', from: 420, to: 600, rate0: 1.0, rate1: 1.2 },
      { enemy: 'water', from: 420, to: 600, rate0: 0.3, rate1: 0.4 },
      { enemy: 'fox', from: 420, to: END, rate0: 0.3, rate1: 0.3 },
    ],
    swarms: [
      { at: 120, enemy: 'skeleton', count: 16, shape: 'ring' },
      { at: 240, enemy: 'spirit', count: 18, shape: 'side' },
      { at: 330, enemy: 'skeleton', count: 24, shape: 'ring' },
      { at: 470, enemy: 'spirit', count: 26, shape: 'ring' },
      { at: 550, enemy: 'skeleton', count: 30, shape: 'ring' },
    ],
    bosses: [
      { at: 180, id: 'reaper' },
      { at: 420, id: 'gangcheori' },
      { at: 600, id: 'yeomra' },
    ],
  },
];

export const MAP_INDEX: Record<string, number> = Object.fromEntries(MAPS.map((m, i) => [m.id, i]));

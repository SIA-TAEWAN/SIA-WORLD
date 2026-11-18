/**
 * 맵 4종 (PRD 6장)과 맵별 시간대 등장 표.
 * 이번 단계에서는 들판만 완성했고, 나머지 세 맵은 틀(이름·배율·보스 이름)만 있다 (6단계).
 */

/** 등장 표 한 줄: from~to 초 동안 초당 rate0 → rate1 마리 (곧은 선으로 늘거나 줄어든다) */
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

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  /** 난이도 글자 */
  level: string;
  /** 엽전 배율 */
  coinMul: number;
  /** 요괴 강함: 체력·속도·수 배율 */
  power: { hp: number; speed: number; count: number };
  /** 시간이 갈수록 강해짐: 1분마다 체력·피해가 이만큼(비율) 는다 */
  growth: { hpPerMin: number; dmgPerMin: number };
  spawns: SpawnRow[];
  swarms: SwarmEvent[];
  /** 보스: at 초에 등장 (마지막이 최종 보스) */
  bosses: { at: number; id: string }[];
  /** 해금 조건 (저장·해금은 4단계) */
  unlock: string;
  /** 등장 표까지 만들어졌나 */
  ready: boolean;
}

const END = 99999;

export const MAPS: MapDef[] = [
  {
    id: 'field', name: '들판', desc: '넓은 풀밭, 장애물이 적다', level: '쉬움', coinMul: 1, ready: true, unlock: '처음부터',
    power: { hp: 1, speed: 1, count: 1 },
    growth: { hpPerMin: 0.26, dmgPerMin: 0.09 },
    spawns: [
      // 0~3분: 약한 요괴 위주, 수가 점점 늘어남
      { enemy: 'imp', from: 0, to: 180, rate0: 1.5, rate1: 5.0 },
      { enemy: 'wisp', from: 120, to: 180, rate0: 0.5, rate1: 1.2 },
      // 3~7분: 빠른 요괴·단단한 요괴 추가
      { enemy: 'imp', from: 180, to: 420, rate0: 5.0, rate1: 6.0 },
      { enemy: 'wisp', from: 180, to: 420, rate0: 1.5, rate1: 3.0 },
      { enemy: 'club', from: 240, to: 420, rate0: 0.3, rate1: 1.0 },
      { enemy: 'water', from: 300, to: 420, rate0: 0.3, rate1: 0.8 },
      // 7~10분: 가장 강한 요괴, 원거리 요괴 (10분 뒤에는 최종 보스와 함께 계속)
      { enemy: 'imp', from: 420, to: END, rate0: 5.0, rate1: 5.0 },
      { enemy: 'wisp', from: 420, to: 600, rate0: 3.0, rate1: 3.6 },
      { enemy: 'club', from: 420, to: 600, rate0: 1.0, rate1: 1.3 },
      { enemy: 'water', from: 420, to: 600, rate0: 0.8, rate1: 1.0 },
      { enemy: 'fox', from: 420, to: 600, rate0: 0.15, rate1: 0.4 },
      { enemy: 'wisp', from: 600, to: END, rate0: 2.0, rate1: 2.0 },
      { enemy: 'club', from: 600, to: END, rate0: 0.6, rate1: 0.6 },
      { enemy: 'fox', from: 600, to: END, rate0: 0.2, rate1: 0.2 },
    ],
    swarms: [
      { at: 210, enemy: 'imp', count: 30, shape: 'ring' },
      { at: 285, enemy: 'wisp', count: 24, shape: 'side' },
      { at: 345, enemy: 'imp', count: 40, shape: 'ring' },
      { at: 465, enemy: 'wisp', count: 36, shape: 'side' },
      { at: 525, enemy: 'imp', count: 50, shape: 'ring' },
      { at: 570, enemy: 'club', count: 12, shape: 'ring' },
    ],
    bosses: [
      { at: 180, id: 'bigDokkaebi' },
      { at: 420, id: 'dueoksini' },
      { at: 600, id: 'bulgasal' },
    ],
  },
  {
    id: 'bamboo', name: '대나무 숲', desc: '대나무가 길을 막는다', level: '보통', coinMul: 1.5, ready: false, unlock: '들판을 끝까지 버티기',
    power: { hp: 1.3, speed: 1.1, count: 1.2 },
    growth: { hpPerMin: 0.24, dmgPerMin: 0.08 },
    spawns: [],
    swarms: [],
    bosses: [
      { at: 180, id: 'jangsanbeom' },
      { at: 420, id: 'centipede' },
      { at: 600, id: 'gumiho' },
    ],
  },
  {
    id: 'palace', name: '달빛 궁궐', desc: '밤 분위기, 길이 좁다', level: '어려움', coinMul: 2, ready: false, unlock: '대나무 숲을 끝까지 버티기',
    power: { hp: 1.6, speed: 1.15, count: 1.4 },
    growth: { hpPerMin: 0.26, dmgPerMin: 0.09 },
    spawns: [],
    swarms: [],
    bosses: [
      { at: 180, id: 'guardCaptain' },
      { at: 420, id: 'yagwanggwi' },
      { at: 600, id: 'imugi' },
    ],
  },
  {
    id: 'underworld', name: '황천길', desc: '저승으로 가는 어두운 길, 안개와 푸른 불빛', level: '매우 어려움', coinMul: 2.5, ready: false, unlock: '달빛 궁궐을 끝까지 버티기',
    power: { hp: 2, speed: 1.2, count: 1.6 },
    growth: { hpPerMin: 0.28, dmgPerMin: 0.1 },
    spawns: [],
    swarms: [],
    bosses: [
      { at: 180, id: 'reaper' },
      { at: 420, id: 'gangcheori' },
      { at: 600, id: 'yeomra' },
    ],
  },
];

export const MAP_INDEX: Record<string, number> = Object.fromEntries(MAPS.map((m, i) => [m.id, i]));

/**
 * 지형 표 (PRD '전체 구조'): 12지형 × 8맵, 8번째 맵이 지형 보스. 보통/어려움 모드가 같은 96맵을 쓴다.
 * 맵 id 는 '지형-맵' ('1-3'). 모드는 id 에 넣지 않고 따로 들고 다닌다.
 */
import type { BossId } from './bosses';
import type { EnemyKind } from './enemies';
import type { HeroId } from './heroes';

export const REGIONS = 12;
export const MAPS_PER_REGION = 8;
/** 지금 열려 있는 지형 수 (나머지는 지도에 '준비 중') */
export const REGIONS_READY = 1;
/** 어려움 모드 · 최종보스가 준비됐는지 */
export const HARD_READY = false;

export type Mode = 'normal' | 'hard';
export const MODES: readonly Mode[] = ['normal', 'hard'];
export const MODE_NAME: Record<Mode, string> = { normal: '보통', hard: '어려움' };

export type MapId = `${number}-${number}`;
export const mapId = (region: number, no: number): MapId => `${region}-${no}`;
/** '3-7' → { region: 3, no: 7 } (모양이 틀리면 null) */
export function parseMapId(id: string): { region: number; no: number } | null {
  const m = /^(\d{1,2})-(\d)$/.exec(id);
  if (!m) return null;
  const region = Number(m[1]);
  const no = Number(m[2]);
  return region >= 1 && region <= REGIONS && no >= 1 && no <= MAPS_PER_REGION ? { region, no } : null;
}
/** 맵 순서 (0~95) */
export const mapIndex = (region: number, no: number) => (region - 1) * MAPS_PER_REGION + (no - 1);
export const ALL_MAP_IDS: MapId[] = Array.from({ length: REGIONS * MAPS_PER_REGION }, (_, i) => mapId(Math.floor(i / MAPS_PER_REGION) + 1, (i % MAPS_PER_REGION) + 1));

/** 바닥 그림 (시아디펜스 바닥 4종을 3지형씩. 지형 전용 타일셋이 생기면 art.ts 가 바꿔 쓴다) */
export type Ground = 'field' | 'bamboo' | 'palace' | 'underworld';
/** 지형 환경 효과 (6단계에서 구현. 지금은 물 = 느려짐만 있다) */
export type EnvId = 'none' | 'mud' | 'wind' | 'dark' | 'water' | 'poison' | 'arrow' | 'sleep' | 'slip' | 'glare' | 'cold' | 'fire';

export interface RegionDef {
  region: number;
  name: string;
  /** 이 지형이 고향인 대원 (공격·방어 +10%) */
  home: HeroId;
  ground: Ground;
  env: EnvId;
  envText: string;
  /** 환경 효과를 막는 대원 (지형 화면의 '추천 대원'에 고향 대원과 함께 보인다) */
  counter: HeroId;
  boss: BossId;
  /** 나오는 요괴 (4~6종) */
  enemies: EnemyKind[];
}

const R = (region: number, name: string, home: HeroId, ground: Ground, env: EnvId, envText: string, counter: HeroId, boss: BossId, enemies: EnemyKind[]): RegionDef => ({
  region, name, home, ground, env, envText, counter, boss, enemies,
});

/** 십이지 지도 (다른 게임과 같은 이름·보스 순서) */
export const REGION_TABLE: RegionDef[] = [
  R(1, '쥐의 들판', 'rat', 'field', 'none', '환경 효과 없음 · 물웅덩이에서는 느려져요', 'ox', 'bigDokkaebi', ['imp', 'wisp', 'water', 'fox', 'club']),
  R(2, '소의 논밭', 'ox', 'field', 'mud', '진흙: 구르기 거리가 짧아져요', 'horse', 'dueoksini', ['imp', 'water', 'club', 'bamboo', 'fox']),
  R(3, '호랑이 고개', 'tiger', 'field', 'wind', '골바람: 주기적으로 한쪽으로 밀려요', 'ox', 'bulgasal', ['wisp', 'club', 'fox', 'bamboo', 'guard']),
  R(4, '토끼의 달동산', 'rabbit', 'bamboo', 'dark', '달그림자: 멀리 있는 요괴가 안 보여요', 'rooster', 'jangsanbeom', ['wisp', 'fox', 'bamboo', 'spirit', 'imp']),
  R(5, '용의 연못', 'dragon', 'bamboo', 'water', '물길: 물이 많고 물에서 더 느려져요', 'snake', 'centipede', ['water', 'bamboo', 'fox', 'guard', 'wisp']),
  R(6, '뱀의 늪', 'snake', 'bamboo', 'poison', '독안개: 늪에 서 있으면 독 피해', 'pig', 'gumiho', ['water', 'spirit', 'fox', 'bamboo', 'club']),
  R(7, '말의 성문', 'horse', 'palace', 'arrow', '성벽 화살: 정해진 자리에 화살이 떨어져요', 'monkey', 'guardCaptain', ['guard', 'club', 'fox', 'skeleton', 'imp']),
  R(8, '양의 뜰', 'sheep', 'palace', 'sleep', '졸음 꽃가루: 가만히 있으면 느려져요', 'tiger', 'yagwanggwi', ['guard', 'spirit', 'wisp', 'skeleton', 'fox']),
  R(9, '원숭이의 누각', 'monkey', 'palace', 'slip', '미끄러운 마루: 멈출 때 미끄러져요', 'rabbit', 'imugi', ['guard', 'skeleton', 'wisp', 'fox', 'club']),
  R(10, '닭의 새벽길', 'rooster', 'underworld', 'glare', '새벽빛: 주기적으로 화면이 눈부셔요', 'sheep', 'reaper', ['skeleton', 'spirit', 'wisp', 'guard', 'fox']),
  R(11, '개의 삼도천', 'dog', 'underworld', 'cold', '찬 강바람: 마력이 느리게 차요', 'dragon', 'gangcheori', ['skeleton', 'spirit', 'water', 'guard', 'club']),
  R(12, '돼지의 염라전', 'pig', 'underworld', 'fire', '불길: 불바닥에 서 있으면 화상', 'dog', 'yeomra', ['skeleton', 'spirit', 'guard', 'club', 'fox', 'wisp']),
];
export const regionOf = (region: number): RegionDef => REGION_TABLE[Math.max(1, Math.min(REGIONS, region)) - 1];

/**
 * 맵 권장 레벨 (PRD '성장'): 보통 Lv1 → 65, 어려움 Lv66 → 99 로 96맵에 고르게.
 * 요괴 능력치·경험치·시아코인 조건(권장 레벨 +15)이 모두 이 값을 쓴다.
 */
export function mapLevel(region: number, no: number, mode: Mode): number {
  const f = mapIndex(region, no) / (REGIONS * MAPS_PER_REGION - 1);
  return mode === 'hard' ? Math.round(66 + f * 33) : Math.round(1 + f * 64);
}

/** 맵 요괴 배율 (권장 레벨 → 체력·공격·경험치·엽전). 어려움은 수도 늘어난다 */
export function mapScale(region: number, no: number, mode: Mode) {
  const lv = mapLevel(region, no, mode);
  return {
    level: lv,
    hp: 1 + 0.22 * (lv - 1),
    atk: 1 + 0.2 * (lv - 1),
    def: 0.8 * (lv - 1),
    reward: 1 + 0.15 * (lv - 1),
    /** 무리마다 요괴 수 배율 */
    count: mode === 'hard' ? 1.3 : 1,
  };
}

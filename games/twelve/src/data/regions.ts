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
export const REGIONS_READY = 12;
/** 어려움 모드가 준비됐는지 */
export const HARD_READY = true;

export type Mode = 'normal' | 'hard';
export const MODES: readonly Mode[] = ['normal', 'hard'];
export const MODE_NAME: Record<Mode, string> = { normal: '보통', hard: '어려움' };

/**
 * 최종보스맵 (PRD '전체 구조' 3): 그 모드의 열쇠 12개를 모으면 지도 가운데에서 열린다. 잡으면 그 모드 클리어.
 * 서버 표(_twelve_maps)에는 12지형의 9번째 줄로 들어간다 — 12-8 을 깨야 열리고, 드랍·확정 보정은 12지형 것을 쓴다.
 */
export const FINAL_MAP = 'final';
export const FINAL_NO = MAPS_PER_REGION + 1;

export type MapId = `${number}-${number}` | typeof FINAL_MAP;
export const mapId = (region: number, no: number): MapId => `${region}-${no}`;
/** '3-7' → { region: 3, no: 7 } · 'final' → { region: 12, no: 9 } (모양이 틀리면 null) */
export function parseMapId(id: string): { region: number; no: number } | null {
  if (id === FINAL_MAP) return { region: REGIONS, no: FINAL_NO };
  const m = /^(\d{1,2})-(\d)$/.exec(id);
  if (!m) return null;
  const region = Number(m[1]);
  const no = Number(m[2]);
  return region >= 1 && region <= REGIONS && no >= 1 && no <= MAPS_PER_REGION ? { region, no } : null;
}
/** 맵 순서 (0~95) */
export const mapIndex = (region: number, no: number) => (region - 1) * MAPS_PER_REGION + (no - 1);
/** 지형 맵 96개의 id (최종보스맵은 들어 있지 않다) */
export const ALL_MAP_IDS: MapId[] = Array.from({ length: REGIONS * MAPS_PER_REGION }, (_, i) => mapId(Math.floor(i / MAPS_PER_REGION) + 1, (i % MAPS_PER_REGION) + 1));

/** 바닥 그림 (시아디펜스 바닥 4종을 3지형씩. 지형 전용 타일셋이 생기면 art.ts 가 바꿔 쓴다) */
export type Ground = 'field' | 'bamboo' | 'palace' | 'underworld';
/** 지형 환경 효과 (숫자는 balance.ts 의 ENV) */
export type EnvId = 'none' | 'mud' | 'wind' | 'dark' | 'water' | 'poison' | 'arrow' | 'sleep' | 'slip' | 'glare' | 'cold' | 'fire';

/** 환경 효과의 짧은 이름 · 그림 글자 (화면용) */
export const ENV_NAME: Record<EnvId, string> = {
  none: '', mud: '진흙', wind: '골바람', dark: '달그림자', water: '물길', poison: '독안개', arrow: '성벽 화살', sleep: '졸음 꽃가루', slip: '미끄러운 마루', glare: '새벽빛', cold: '찬 강바람', fire: '불길',
};
export const ENV_ICON: Record<EnvId, string> = { none: '', mud: '🟤', wind: '🌬️', dark: '🌙', water: '🌊', poison: '☠️', arrow: '🏹', sleep: '🌼', slip: '🧊', glare: '🌅', cold: '❄️', fire: '🔥' };

export interface RegionDef {
  region: number;
  name: string;
  /** 이 지형이 고향인 대원 (공격·방어 +10%) */
  home: HeroId;
  ground: Ground;
  env: EnvId;
  envText: string;
  /** 환경 효과를 막는 대원 (지형 화면의 '추천 대원'에 고향 대원과 함께 보인다). 그 지형에 올 때 이미 함께하는 대원이어야 한다 */
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
  R(2, '소의 논밭', 'ox', 'field', 'mud', '진흙: 진흙탕에서는 더 느려지고 구르기가 짧아져요', 'rabbit', 'dueoksini', ['imp', 'mud', 'fox', 'club', 'bamboo']),
  R(3, '호랑이 고개', 'tiger', 'field', 'wind', '골바람: 가끔 바람이 불어 한쪽으로 밀려요', 'ox', 'bulgasal', ['guard', 'wisp', 'lynx', 'spirit', 'bamboo']),
  R(4, '토끼의 달동산', 'rabbit', 'bamboo', 'dark', '달그림자: 멀리 있는 요괴가 안 보이고 조준이 안 돼요', 'rat', 'jangsanbeom', ['skeleton', 'shade', 'wisp', 'fox', 'bamboo']),
  R(5, '용의 연못', 'dragon', 'bamboo', 'water', '물길: 물에 들어가면 물살에 아래로 떠밀려요', 'snake', 'centipede', ['water', 'catfish', 'guard', 'wisp', 'bamboo']),
  R(6, '뱀의 늪', 'snake', 'bamboo', 'poison', '독안개: 늪에 서 있으면 독 피해를 입어요', 'horse', 'gumiho', ['mud', 'toad', 'spirit', 'fox', 'club']),
  R(7, '말의 성문', 'horse', 'palace', 'arrow', '성벽 화살: 가끔 성벽에서 화살이 쏟아져요', 'monkey', 'guardCaptain', ['guard', 'bomber', 'skeleton', 'fox', 'club']),
  R(8, '양의 뜰', 'sheep', 'palace', 'sleep', '졸음 꽃가루: 가만히 서 있으면 졸려서 느려져요', 'tiger', 'yagwanggwi', ['guard', 'sleeper', 'wisp', 'skeleton', 'fox']),
  R(9, '원숭이의 누각', 'monkey', 'palace', 'slip', '미끄러운 마루: 멈출 때 미끄러져요', 'rabbit', 'imugi', ['guard', 'acorn', 'skeleton', 'fox', 'club']),
  R(10, '닭의 새벽길', 'rooster', 'underworld', 'glare', '새벽빛: 가끔 눈이 부셔 먼 요괴가 안 보여요', 'sheep', 'reaper', ['skeleton', 'yaksha', 'spirit', 'guard', 'fox']),
  R(11, '개의 삼도천', 'dog', 'underworld', 'cold', '찬 강바람: 마력이 느리게 차요', 'dragon', 'gangcheori', ['skeleton', 'ferryman', 'water', 'guard', 'club']),
  R(12, '돼지의 염라전', 'pig', 'underworld', 'fire', '불길: 불바닥을 밟으면 화상을 입어요', 'dog', 'yeomra', ['skeleton', 'firecart', 'spirit', 'guard', 'club', 'fox']),
];
export const regionOf = (region: number): RegionDef => REGION_TABLE[Math.max(1, Math.min(REGIONS, region)) - 1];

/**
 * 맵 권장 레벨 (PRD '성장'): 보통 Lv1 → 65, 어려움 Lv66 → 99 로 96맵에 고르게.
 * 요괴 능력치·경험치·시아코인 조건(권장 레벨 +15)이 모두 이 값을 쓴다.
 */
export function mapLevel(region: number, no: number, mode: Mode): number {
  // 최종보스맵(12지형의 9번째)은 마지막 맵과 같은 레벨이다 (보통 65 · 어려움 99)
  const f = Math.min(1, mapIndex(region, no) / (REGIONS * MAPS_PER_REGION - 1));
  return mode === 'hard' ? Math.round(66 + f * 33) : Math.round(1 + f * 64);
}

/**
 * 5지형부터 요괴가 더 단단해진다: 권장 레벨 from 을 넘는 레벨마다 체력 배율 +step (span 레벨까지만 쌓인다).
 * 4지형까지의 식 그대로면 5~7지형 맵 한 판이 4.5분쯤으로 짧았다 (PRD: 5~6분 — npm run pace).
 */
export const HP_RAMP = { from: 22, span: 12, step: 0.2 };
/** 8지형부터 한 번 더: 권장 레벨 from 을 넘는 레벨마다 +step (span 레벨까지만). 9~12지형은 지형마다 1시간 20분쯤 (PRD 성장 표) */
export const HP_RAMP2 = { from: 38, span: 6, step: 0.6 };
/**
 * 9지형부터 경험치를 조금 더: 권장 레벨 from 을 넘는 레벨마다 경험치 +step (엽전은 그대로).
 * 없으면 12지형에 권장 레벨보다 3 낮게 들어가 자동 조종이 12-4 에서 막혔다 (npm run pace -- 12)
 */
export const EXP_LATE = { from: 44, step: 0.004 };
const ramp = (r: { from: number; span: number; step: number }, lv: number) => r.step * Math.max(0, Math.min(r.span, lv - r.from));

/** 권장 레벨 → 요괴 배율 (체력·공격·방어·경험치·엽전). count = 무리마다 요괴 수 배율. 끝없는 탑(data/tower.ts)도 이 식을 쓴다 */
export const levelScale = (lv: number, count = 1) => ({
  level: lv,
  hp: 1 + 0.22 * (lv - 1) + ramp(HP_RAMP, lv) + ramp(HP_RAMP2, lv),
  atk: 1 + 0.2 * (lv - 1),
  def: 0.8 * (lv - 1),
  reward: 1 + 0.15 * (lv - 1),
  /** 경험치 배율 (엽전은 reward 그대로) */
  exp: (1 + 0.15 * (lv - 1)) * (1 + EXP_LATE.step * Math.max(0, lv - EXP_LATE.from)),
  /** 무리마다 요괴 수 배율 */
  count,
});
export type Scale = ReturnType<typeof levelScale>;

/**
 * 어려움 모드 (PRD '전체 구조': 요괴가 더 세고 많다): 권장 레벨(Lv66~99)의 배율에 더 곱한다.
 * count = 무리마다 요괴 수 · hp(+ 권장 레벨이 Lv66 에서 하나 오를 때마다 hpStep) · atk = 체력 · 공격 · par = 별 시간(맵이 길어지는 만큼)
 * final = 최종보스맵의 체력 · 공격 배율
 * 경험치는 권장 레벨의 식 그대로다 (요괴가 많아진 만큼 더 받는다) — 대신 Lv66 부터 필요한 경험치가 가파르다 (growth.ts 의 EXP_HARD)
 * 숫자는 npm run pace 로 맞췄다 (어려움 1~6지형 약 22시간 Lv82 · 7~12지형 + 최종보스 약 30시간 Lv99)
 */
export const HARD = { count: 1.3, hp: 1.15, hpStep: 0.006, atk: 1.35, par: 1.3, final: { hp: 1.2, atk: 1.1 } };

/** 맵 요괴 배율 (권장 레벨 → 체력·공격·경험치·엽전). 어려움은 수도 늘어난다 */
export function mapScale(region: number, no: number, mode: Mode): Scale {
  const lv = mapLevel(region, no, mode);
  if (mode !== 'hard') return levelScale(lv);
  const sc = levelScale(lv, HARD.count);
  // 최종보스맵: Lv99 · 여의 장비가 끝이라 더 클 수 없다 — 지형 맵보다 덜 올린다 (어둑시니는 어려움 전용 공격이 하나 더 있다)
  const k = no > MAPS_PER_REGION ? HARD.final : { hp: HARD.hp + HARD.hpStep * (lv - 66), atk: HARD.atk };
  return { ...sc, hp: sc.hp * k.hp, atk: sc.atk * k.atk };
}

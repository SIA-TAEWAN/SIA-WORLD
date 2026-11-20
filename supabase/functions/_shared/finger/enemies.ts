/**
 * 시아핑거 요괴·보스 (PRD "스테이지 구성"). 디펜스·돌격대와 같은 요괴를 턴제로 옮긴다.
 * 서버가 판을 다시 돌리므로 능력치는 여기에 둔다. 그림 이름은 games/finger/public/art 의 파일 이름.
 * 방패·부활·숨기·분열·아군 회복 같은 행동은 5단계에서 더한다 (지금은 능력치만).
 */

export const ENEMY_IDS = ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'] as const;
export type EnemyKind = (typeof ENEMY_IDS)[number];

export const BOSS_IDS = ['bigDokkaebi', 'dueoksini', 'bulgasal', 'jangsanbeom', 'centipede', 'gumiho', 'guardCaptain', 'yagwanggwi', 'imugi', 'reaper', 'gangcheori', 'yeomra'] as const;
export type BossId = (typeof BOSS_IDS)[number];

/** 공격: near = 가장 가까운 대원 하나 · area = 미리 보인 원 안의 대원 모두 · all = 모든 대원 조금씩 */
export type AttackKind = 'near' | 'area' | 'all';

export interface FoeDef {
  name: string;
  /** 그림 (public/art/<이름>.png) */
  art: string;
  /** 반지름 (방 좌표 px) */
  r: number;
  hp: number;
  /** 공격 한 번 피해 */
  atk: number;
  /** 공격 간격 (턴). 머리 위 숫자가 이만큼에서 시작해 0이 되면 공격 */
  cd: number;
  /** 공격 순서 (돌아가며) */
  pattern: AttackKind[];
  /** area 공격 반지름 */
  area?: number;
  /** 약점 방향 (각도 0.1° 단위, 요괴 가운데에서 본 방향. 2700 = 위 = 등 뒤). 그 쪽 45° 안에서 맞으면 피해 3배 */
  weak?: number;
}

/** 일반 요괴 9종 */
export const ENEMIES: Record<EnemyKind, FoeDef> = {
  imp: { name: '꼬마 도깨비', art: 'e-imp', r: 34, hp: 90, atk: 14, cd: 3, pattern: ['near'] },
  wisp: { name: '도깨비불', art: 'e-wisp', r: 30, hp: 60, atk: 10, cd: 2, pattern: ['near'] },
  club: { name: '방망이 도깨비', art: 'e-club', r: 42, hp: 170, atk: 22, cd: 4, pattern: ['near'] },
  water: { name: '물귀신', art: 'e-water', r: 36, hp: 110, atk: 16, cd: 3, pattern: ['near'] },
  fox: { name: '여우불', art: 'e-fox', r: 34, hp: 100, atk: 12, cd: 3, pattern: ['area'], area: 130 },
  bamboo: { name: '죽순 요괴', art: 'e-bamboo', r: 36, hp: 130, atk: 18, cd: 3, pattern: ['near'] },
  guard: { name: '수문장 요괴', art: 'e-guard', r: 40, hp: 180, atk: 18, cd: 3, pattern: ['near'] },
  skeleton: { name: '해골 병사', art: 'e-skeleton', r: 36, hp: 110, atk: 16, cd: 3, pattern: ['near'] },
  spirit: { name: '원혼', art: 'e-spirit', r: 34, hp: 100, atk: 14, cd: 3, pattern: ['near'] },
};

/** 지역 보스 12종 (= BOSS_IDS[지역-1]). 체력·공격은 1지역 기준 값이고, 스테이지가 배율을 곱한다 */
export const BOSSES: Record<BossId, FoeDef> = {
  bigDokkaebi: { name: '큰 도깨비', art: 'b-bigDokkaebi', r: 92, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area', 'near', 'all'], area: 190, weak: 2700 },
  dueoksini: { name: '두억시니', art: 'b-dueoksini', r: 92, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  bulgasal: { name: '불가살', art: 'b-bulgasal', r: 95, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  jangsanbeom: { name: '장산범', art: 'b-jangsanbeom', r: 92, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  centipede: { name: '왕지네', art: 'b-centipede', r: 95, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  gumiho: { name: '구미호', art: 'b-gumiho', r: 95, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  guardCaptain: { name: '수문장 대장', art: 'b-guardCaptain', r: 95, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  yagwanggwi: { name: '야광귀', art: 'b-yagwanggwi', r: 90, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  imugi: { name: '이무기', art: 'b-imugi', r: 98, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  reaper: { name: '저승사자', art: 'b-reaper', r: 92, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  gangcheori: { name: '강철이', art: 'b-gangcheori', r: 95, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
  yeomra: { name: '염라대왕', art: 'b-yeomra', r: 100, hp: 1500, atk: 22, cd: 2, pattern: ['near', 'area'], area: 190, weak: 2700 },
};

/** 작은 대장 요괴 (1~4번째 스테이지 마지막 웨이브): 그 지역 요괴 하나를 크게 (돌격대 chiefArt 와 같은 고르기) */
export function chiefKind(region: number): EnemyKind {
  return region <= 3 ? 'club' : region <= 6 ? 'water' : region <= 9 ? 'guard' : 'skeleton';
}

export function chiefDef(region: number): FoeDef {
  const k = ENEMIES[chiefKind(region)];
  return { ...k, name: `${k.name} 대장`, r: 62, hp: k.hp * 3, atk: Math.round(k.atk * 1.3), cd: 3, pattern: ['near', 'area'], area: 150 };
}

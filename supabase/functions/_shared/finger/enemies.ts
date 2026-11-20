/**
 * 시아핑거 요괴·보스 (PRD "스테이지 구성"). 디펜스·돌격대와 같은 요괴를 턴제로 옮긴다.
 * 서버가 판을 다시 돌리므로 능력치와 행동(traits)은 여기에 둔다. 그림 이름은 games/finger/public/art 의 파일 이름.
 *
 * 요괴 행동 (5단계, 돌격대 요괴 9종을 턴제로):
 *  · 꼬마 도깨비: 기본 · 도깨비불: 공격이 잦다 · 방망이 도깨비: 단단하고 세게 친다 (1지역 요괴는 행동 없음)
 *  · 물귀신: 물웅덩이에 숨는다 (숨은 턴엔 안 맞는다) · 맞은 대원은 다음 발사가 느려진다
 *  · 여우불: 미리 보인 범위에 불을 쏜다 · 맞은 대원은 독(매 턴 피해)
 *  · 죽순 요괴: 쓰러지면 작은 죽순 둘로 갈라진다
 *  · 수문장 요괴: 앞(아래쪽)에 방패 — 앞에서 맞으면 피해가 크게 줄어든다. 옆·뒤를 노리자
 *  · 해골 병사: 쓰러져도 다음 요괴 차례에 한 번 되살아난다
 *  · 원혼: 다른 요괴 체력을 채운다 · 맞은 대원은 다음 발사 힘이 약해진다
 */

export const ENEMY_IDS = ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'] as const;
export type EnemyKind = (typeof ENEMY_IDS)[number];

export const BOSS_IDS = ['bigDokkaebi', 'dueoksini', 'bulgasal', 'jangsanbeom', 'centipede', 'gumiho', 'guardCaptain', 'yagwanggwi', 'imugi', 'reaper', 'gangcheori', 'yeomra'] as const;
export type BossId = (typeof BOSS_IDS)[number];

/**
 * 요괴 차례에 하는 일 (pattern 을 돌아가며):
 *  near = 가장 가까운 대원 하나 · double = 가까운 대원 둘을 연달아 · area = 미리 보인 원 안의 대원 모두 (1.6배)
 *  all = 모든 대원 조금씩 (0.6배) · heal = 다른 요괴 체력 채우기 · summon = 졸개 부르기
 */
export type AttackKind = 'near' | 'double' | 'area' | 'all' | 'heal' | 'summon';

/** 공격에 맞은 대원에게 남는 나쁜 효과 (닭 '주변 효과 지우기'가 지운다) */
export type Debuff = 'poison' | 'slow' | 'weak' | 'freeze';

/** 요괴·보스 행동 (없으면 행동 없음) */
export interface FoeTraits {
  /** 방패: dir 방향(0.1°) 60° 안에서 맞으면 몸통 박치기 피해 × mul */
  shield?: { dir: number; mul: number };
  /** 쓰러지면 다음 요괴 차례에 최대 체력 × revive 로 한 번 되살아난다 */
  revive?: number;
  /** 물웅덩이: hide 턴 보였다가 1턴 숨는다 (숨은 동안 박치기·콤보에 안 맞는다) */
  hide?: number;
  /** 쓰러지면 작은 요괴 split 마리로 갈라진다 */
  split?: number;
  /** heal 행동: 다른 요괴 최대 체력 × heal 만큼 채운다 */
  heal?: number;
  /** 공격에 맞은 대원에게 남는 효과 */
  inflict?: Debuff;
  /** summon 행동: 부르는 요괴와 마리 수 */
  summon?: { kind: EnemyKind; n: number };
  /** 요괴 차례마다 받는 피해가 harden 씩 줄어든다 (최대 50%). 약점을 맞히면 풀린다 */
  harden?: number;
  /** area 공격을 두 군데 (가장 가까운 대원 · 가장 먼 대원) */
  twin?: boolean;
  /** area 공격 자리에 불길이 burn 턴 남는다 (그 안 대원이 요괴 차례마다 공격력 × 0.4) */
  burn?: number;
}

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
  traits?: FoeTraits;
  /** 스테이지 목록·도감에 쓰는 한 줄 설명 */
  desc?: string;
  /** 보스 특성 이름 (화면 표시) */
  trait?: string;
}

/** 일반 요괴 9종 */
export const ENEMIES: Record<EnemyKind, FoeDef> = {
  imp: { name: '꼬마 도깨비', art: 'e-imp', r: 34, hp: 150, atk: 14, cd: 3, pattern: ['near'], desc: '기본 요괴' },
  wisp: { name: '도깨비불', art: 'e-wisp', r: 30, hp: 100, atk: 10, cd: 2, pattern: ['near'], desc: '자주 공격한다' },
  club: { name: '방망이 도깨비', art: 'e-club', r: 42, hp: 280, atk: 22, cd: 4, pattern: ['near'], desc: '단단하고 세게 친다' },
  water: { name: '물귀신', art: 'e-water', r: 36, hp: 110, atk: 16, cd: 3, pattern: ['near'], traits: { hide: 1, inflict: 'slow' }, desc: '물웅덩이에 숨는다 · 맞으면 느려짐' },
  fox: { name: '여우불', art: 'e-fox', r: 34, hp: 100, atk: 12, cd: 3, pattern: ['area'], area: 130, traits: { inflict: 'poison' }, desc: '불을 쏜다 · 맞으면 독' },
  bamboo: { name: '죽순 요괴', art: 'e-bamboo', r: 36, hp: 130, atk: 18, cd: 3, pattern: ['near'], traits: { split: 2 }, desc: '쓰러지면 둘로 갈라진다' },
  guard: { name: '수문장 요괴', art: 'e-guard', r: 40, hp: 180, atk: 18, cd: 3, pattern: ['near'], traits: { shield: { dir: 900, mul: 0.3 } }, desc: '앞에 방패 · 옆과 뒤를 노리자' },
  skeleton: { name: '해골 병사', art: 'e-skeleton', r: 36, hp: 110, atk: 16, cd: 3, pattern: ['near'], traits: { revive: 0.5 }, desc: '한 번 되살아난다' },
  spirit: { name: '원혼', art: 'e-spirit', r: 34, hp: 100, atk: 14, cd: 3, pattern: ['near', 'heal'], traits: { heal: 0.15, inflict: 'weak' }, desc: '다른 요괴를 회복 · 맞으면 약해짐' },
};

const B = { r: 92, hp: 2600, atk: 22, cd: 2, area: 190, weak: 2700 };

/** 지역 보스 12종 (= BOSS_IDS[지역-1]). 체력·공격은 1지역 기준 값이고, 스테이지가 배율을 곱한다 (돌격대 보스 버릇을 턴제로) */
export const BOSSES: Record<BossId, FoeDef> = {
  bigDokkaebi: { ...B, name: '큰 도깨비', art: 'b-bigDokkaebi', pattern: ['near', 'area', 'near', 'all'], trait: '땅 내려치기 (모두 공격)' },
  dueoksini: { ...B, name: '두억시니', art: 'b-dueoksini', pattern: ['near', 'summon', 'area'], traits: { summon: { kind: 'imp', n: 2 } }, trait: '꼬마 도깨비 부르기' },
  bulgasal: { ...B, name: '불가살', art: 'b-bulgasal', r: 95, pattern: ['near', 'area'], traits: { harden: 0.1 }, trait: '점점 단단해짐 (약점을 맞히면 풀림)' },
  jangsanbeom: { ...B, name: '장산범', art: 'b-jangsanbeom', pattern: ['double', 'near', 'area'], traits: { inflict: 'slow' }, trait: '연속 공격 · 홀리는 소리(느려짐)' },
  centipede: { ...B, name: '왕지네', art: 'b-centipede', r: 95, area: 240, weak: 3150, pattern: ['near', 'area', 'near'], traits: { inflict: 'poison' }, trait: '독 · 넓은 범위' },
  gumiho: { ...B, name: '구미호', art: 'b-gumiho', r: 95, weak: 2250, pattern: ['near', 'area'], traits: { twin: true, inflict: 'weak' }, trait: '두 군데 공격 · 홀림(약해짐)' },
  guardCaptain: { ...B, name: '수문장 대장', art: 'b-guardCaptain', r: 95, pattern: ['near', 'summon', 'area'], traits: { shield: { dir: 900, mul: 0.4 }, summon: { kind: 'guard', n: 1 } }, trait: '앞 방패 · 수문장 부르기' },
  yagwanggwi: { ...B, name: '야광귀', art: 'b-yagwanggwi', r: 90, pattern: ['near', 'area', 'all'], traits: { inflict: 'freeze' }, trait: '얼리기 (맞은 대원 한 차례 쉼)' },
  imugi: { ...B, name: '이무기', art: 'b-imugi', r: 98, area: 230, pattern: ['near', 'area'], traits: { hide: 2 }, trait: '물속에 숨기 · 넓은 범위' },
  reaper: { ...B, name: '저승사자', art: 'b-reaper', pattern: ['double', 'area'], traits: { revive: 0.4, inflict: 'weak' }, trait: '한 번 되살아남 · 연속 공격' },
  gangcheori: { ...B, name: '강철이', art: 'b-gangcheori', r: 95, pattern: ['near', 'area'], traits: { burn: 2, harden: 0.06 }, trait: '불길 남기기 · 단단해짐' },
  yeomra: { ...B, name: '염라대왕', art: 'b-yeomra', r: 100, pattern: ['near', 'summon', 'area', 'all'], traits: { summon: { kind: 'skeleton', n: 2 }, twin: true, burn: 2 }, trait: '해골 부르기 · 두 군데 불길' },
};

/** 작은 대장 요괴 (1~4번째 스테이지 마지막 웨이브): 그 지역 요괴 하나를 크게 (돌격대 chiefArt 와 같은 고르기). 행동도 그대로 */
export function chiefKind(region: number): EnemyKind {
  return region <= 3 ? 'club' : region <= 6 ? 'water' : region <= 9 ? 'guard' : 'skeleton';
}

export function chiefDef(region: number): FoeDef {
  const k = ENEMIES[chiefKind(region)];
  return { ...k, name: `${k.name} 대장`, r: 62, hp: k.hp * 3, atk: Math.round(k.atk * 1.3), cd: 3, pattern: ['near', 'area'], area: 150 };
}

/** 나쁜 효과 이름 (화면) */
export const DEBUFF_NAMES: Record<Debuff, string> = { poison: '독', slow: '느려짐', weak: '약해짐', freeze: '얼음' };

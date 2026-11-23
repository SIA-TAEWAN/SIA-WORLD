/**
 * 요괴 (시아서바이벌·시아디펜스와 같은 9종 그림). 능력치는 Lv1 맵 기준이고 맵 배율(regions.ts mapScale)을 곱한다.
 * 행동(ai):
 *  - melee  : 다가와서 바로 앞을 친다
 *  - dasher : 거리를 두고 있다가 직선으로 돌진한다 (직선 예고)
 *  - slam   : 느리게 다가와 대원이 서 있는 자리를 크게 내려찍는다 (원 예고)
 *  - ranged : 거리를 벌리고 불을 쏜다
 */
export const ENEMY_IDS = ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'] as const;
export type EnemyKind = (typeof ENEMY_IDS)[number];
export type EnemyAi = 'melee' | 'dasher' | 'slam' | 'ranged';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  desc: string;
  /** 그림 이름 (public/art/<이름>.png) */
  art: string;
  /** 화면에 그리는 높이 */
  size: number;
  /** 몸 반지름 */
  r: number;
  hp: number;
  atk: number;
  speed: number;
  ai: EnemyAi;
  /** 공격을 시작하는 거리 */
  reach: number;
  /** 공격 예고 시간 (이 동안 구르기로 피한다) */
  windup: number;
  /** 공격 뒤 쉬는 시간 */
  cd: number;
  /** 공격 범위 크기: melee·slam = 원 반지름, dasher = 돌진 길이, ranged = 불 속도 */
  area: number;
  /** 잡으면 주는 경험치 · 엽전 (Lv1 맵 기준) */
  exp: number;
  coin: number;
}

const E = (
  kind: EnemyKind, name: string, desc: string, size: number, r: number, hp: number, atk: number, speed: number,
  ai: EnemyAi, reach: number, windup: number, cd: number, area: number, exp: number, coin: number,
): EnemyDef => ({ kind, name, desc, art: `e-${kind}`, size, r, hp, atk, speed, ai, reach, windup, cd, area, exp, coin });

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  imp: E('imp', '꼬마 도깨비', '가장 흔한 요괴. 다가와서 방망이로 친다', 54, 20, 42, 9, 120, 'melee', 62, 0.4, 1.2, 62, 4, 2),
  wisp: E('wisp', '도깨비불', '거리를 두고 있다가 직선으로 돌진한다', 46, 17, 28, 11, 150, 'dasher', 300, 0.55, 2.2, 360, 5, 2),
  water: E('water', '물귀신', '빠르게 달라붙는다. 체력은 낮다', 52, 19, 34, 8, 175, 'melee', 58, 0.32, 0.9, 58, 5, 3),
  fox: E('fox', '여우불', '멀리서 불을 쏜다. 먼저 쓰러뜨리자', 52, 19, 30, 10, 105, 'ranged', 420, 0.35, 2.0, 340, 6, 3),
  club: E('club', '방망이 도깨비', '느리지만 크게 내려찍는다. 빨간 원을 피하자', 72, 27, 130, 18, 78, 'slam', 150, 0.85, 2.4, 105, 10, 5),
  bamboo: E('bamboo', '죽순 요괴', '단단하다. 가까이 오면 주변을 찌른다', 56, 21, 90, 12, 70, 'slam', 110, 0.7, 2.0, 95, 8, 4),
  guard: E('guard', '수문장 요괴', '튼튼한 방패병. 묵직하게 친다', 66, 24, 150, 14, 95, 'melee', 70, 0.5, 1.4, 74, 11, 5),
  skeleton: E('skeleton', '해골 병사', '빠르게 몰려와 친다', 58, 20, 70, 12, 140, 'melee', 62, 0.36, 1.0, 62, 8, 4),
  spirit: E('spirit', '원혼', '떠다니며 멀리서 한기를 쏜다', 56, 19, 55, 13, 120, 'ranged', 460, 0.4, 1.8, 380, 9, 4),
};

/** 정예: 그 지형 요괴 하나를 크고 세게. 주기적으로 주변을 크게 휩쓴다 (원 예고) */
export const ELITE = { hp: 5, atk: 1.4, size: 1.35, reward: 6, ringEvery: 5, ringR: 170, ringWarn: 0.9, ringMul: 1.5 };

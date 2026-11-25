/**
 * 요괴 (시아서바이벌·시아디펜스와 같은 9종 + 지형 전용 11종). 능력치는 Lv1 맵 기준이고 맵 배율(regions.ts mapScale)을 곱한다.
 * 행동(ai):
 *  - melee  : 다가와서 바로 앞을 친다
 *  - dasher : 거리를 두고 있다가 직선으로 돌진한다 (직선 예고)
 *  - slam   : 느리게 다가와 대원이 서 있는 자리를 크게 내려찍는다 (원 예고)
 *  - ranged : 거리를 벌리고 불을 쏜다
 *  - leap   : 거리를 두고 돌다가 대원이 서 있는 자리로 뛰어든다 (원 예고, 3지형부터)
 *  - lurk   : 숨어서 다가와 바로 옆에서 나타나 친다. 숨은 동안에는 조준 보정이 안 된다 (4지형부터)
 *  - pull   : 멀리서 직선을 예고하고, 맞으면 제 앞으로 끌어당긴다 (5지형부터)
 *  - spit   : 대원이 선 자리에 독을 뱉어 한동안 남는 독 웅덩이를 만든다 (6지형부터)
 *  - bomb   : 달려와서 제 둘레를 예고한 뒤 터진다. 터지기 전에 쓰러뜨리면 안 터진다 (7지형부터)
 *  - hex    : 멀리서 꽃가루 숨을 쏜다. 맞으면 한동안 느려진다 (8지형부터)
 *  - bounce : 벽에 튕기는 밤송이를 던진다 (9지형부터)
 *  - rage   : 다가와서 친다. 체력이 절반 아래로 내려가면 날뛴다 — 빨라지고 세진다 (10지형부터)
 *  - call   : 거리를 두고 작은 망자를 불러낸다. 쓰러뜨리면 불러낸 것도 사라진다 (11지형부터)
 *  - blaze  : 직선으로 돌진하고 지나간 자리에 불길을 남긴다 (12지형부터)
 * 지형이 올라갈 때마다 새 행동이 하나씩 더해진다 (PRD '성장'): 2지형 = 분열(split), 3지형 = 덮치기(leap),
 * 4지형 = 숨기(lurk), 5지형 = 끌어당기기(pull), 6지형 = 독 웅덩이(spit), 7지형 = 자폭(bomb),
 * 8지형 = 느려지게 하기(hex), 9지형 = 튕기는 탄(bounce), 10지형 = 날뛰기(rage), 11지형 = 불러내기(call), 12지형 = 불길 남기기(blaze).
 * 스무 종 모두 전용 그림이 있다 (public/art/e-<kind>.png — 앞의 9종은 시아디펜스 그림, 뒤의 11종은 열두길에서 만든 그림. ASSETS.md).
 */
export const ENEMY_IDS = ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit', 'mud', 'lynx', 'shade', 'catfish', 'toad', 'bomber', 'sleeper', 'acorn', 'yaksha', 'ferryman', 'firecart'] as const;
export type EnemyKind = (typeof ENEMY_IDS)[number];
export type EnemyAi = 'melee' | 'dasher' | 'slam' | 'ranged' | 'leap' | 'lurk' | 'pull' | 'spit' | 'bomb' | 'hex' | 'bounce' | 'rage' | 'call' | 'blaze';

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
  /** 공격 범위 크기: melee·slam·leap·lurk·spit·bomb·rage = 원 반지름, dasher·pull·blaze = 직선 길이, ranged·hex·bounce = 불 속도 */
  area: number;
  /** 분열: 쓰러지면 작은 것 n 마리로 갈라진다 (체력·크기 비율). 작은 것은 처치 수·보상에 넣지 않는다 */
  split?: { n: number; hp: number; size: number };
  /** 끌어당기기: 맞으면 끌려가는 거리 */
  pull?: number;
  /** 독 웅덩이: 남는 시간 · 0.5초마다의 피해(공격력 배율) */
  pool?: { dur: number; mul: number };
  /** 느려지게 하기: 쏜 것에 맞으면 dur 초 동안 이동 × mul */
  slow?: { mul: number; dur: number };
  /** 튕기는 탄: 벽에 튕기는 횟수 */
  bounce?: number;
  /** 날뛰기: 체력이 at 비율 아래면 이동 × speed · 공격 대기 × cd · 공격 × atk */
  rage?: { at: number; speed: number; cd: number; atk: number };
  /** 불러내기: 한 번에 n 마리, 한꺼번에 max 마리까지, 모두 times 번 (kind 의 작은 것 — 체력·공격·크기 비율). 처치 수·보상에 넣지 않는다 */
  call?: { kind: EnemyKind; n: number; max: number; times: number; hp: number; atk: number; size: number };
  /** 불길 남기기: 지나간 줄에 dur 초 동안 남는 불 (반지름 r, 0.5초마다 공격력 × mul) */
  trail?: { dur: number; mul: number; r: number };
  /** 잡으면 주는 경험치 · 엽전 (Lv1 맵 기준) */
  exp: number;
  coin: number;
}

const E = (
  kind: EnemyKind, name: string, desc: string, size: number, r: number, hp: number, atk: number, speed: number,
  ai: EnemyAi, reach: number, windup: number, cd: number, area: number, exp: number, coin: number, over: Partial<EnemyDef> = {},
): EnemyDef => ({ kind, name, desc, art: `e-${kind}`, size, r, hp, atk, speed, ai, reach, windup, cd, area, exp, coin, ...over });

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  imp: E('imp', '꼬마 도깨비', '가장 흔한 요괴. 다가와서 방망이로 친다', 54, 20, 84, 9, 120, 'melee', 62, 0.4, 1.2, 62, 4, 2),
  wisp: E('wisp', '도깨비불', '거리를 두고 있다가 직선으로 돌진한다', 46, 17, 54, 11, 150, 'dasher', 300, 0.55, 2.2, 360, 5, 2),
  water: E('water', '물귀신', '빠르게 달라붙는다. 체력은 낮다', 52, 19, 65, 8, 175, 'melee', 58, 0.32, 0.9, 58, 5, 3),
  fox: E('fox', '여우불', '멀리서 불을 쏜다. 먼저 쓰러뜨리자', 52, 19, 60, 10, 105, 'ranged', 420, 0.35, 2.0, 340, 6, 3),
  club: E('club', '방망이 도깨비', '느리지만 크게 내려찍는다. 빨간 원을 피하자', 72, 27, 260, 18, 78, 'slam', 150, 0.85, 2.4, 105, 10, 5),
  bamboo: E('bamboo', '죽순 요괴', '단단하다. 가까이 오면 주변을 찌른다', 56, 21, 176, 12, 70, 'slam', 110, 0.7, 2.0, 95, 8, 4),
  guard: E('guard', '수문장 요괴', '튼튼한 방패병. 묵직하게 친다', 66, 24, 200, 14, 95, 'melee', 70, 0.5, 1.4, 74, 10, 5),
  skeleton: E('skeleton', '해골 병사', '빠르게 몰려와 친다', 58, 20, 156, 12, 140, 'melee', 62, 0.36, 1.0, 62, 8, 4),
  // 2지형부터: 분열
  mud: E('mud', '진흙 요괴', '쓰러지면 작은 진흙 둘로 갈라진다', 58, 21, 90, 9, 100, 'melee', 62, 0.45, 1.3, 64, 7, 3, { split: { n: 2, hp: 0.4, size: 0.7 } }),
  // 3지형부터: 덮치기
  lynx: E('lynx', '살쾡이 요괴', '빙빙 돌다가 내가 선 자리로 뛰어든다. 빨간 원에서 벗어나자', 54, 19, 78, 12, 165, 'leap', 270, 0.6, 2.6, 88, 8, 4),
  // 4지형부터: 숨기
  shade: E('shade', '그슨대', '달그림자에 숨어서 다가온다. 나타나는 순간을 노리자', 58, 20, 120, 14, 150, 'lurk', 92, 0.5, 2.4, 80, 9, 4),
  // 5지형부터: 끌어당기기
  catfish: E('catfish', '메기 요괴', '수염을 뻗어 끌어당긴다. 빨간 줄에서 비키자', 68, 25, 215, 12, 85, 'pull', 340, 0.75, 3.2, 390, 11, 5, { pull: 230 }),
  // 6지형부터: 독 웅덩이
  toad: E('toad', '독두꺼비', '독을 뱉어 웅덩이를 남긴다. 웅덩이에 서 있지 말자', 54, 20, 125, 11, 95, 'spit', 380, 0.8, 3.4, 88, 10, 5, { pool: { dur: 3.5, mul: 0.45 } }),
  // 7지형부터: 자폭
  bomber: E('bomber', '화약 도깨비', '달려와서 터진다. 터지기 전에 쓰러뜨리거나 멀리 피하자', 52, 19, 80, 24, 172, 'bomb', 84, 0.8, 3, 135, 9, 4),
  // 8지형부터: 느려지게 하기
  sleeper: E('sleeper', '가위 귀신', '졸음 꽃가루를 쏜다. 맞으면 한동안 느려진다', 56, 19, 110, 11, 115, 'hex', 430, 0.5, 2.6, 300, 12, 5, { slow: { mul: 0.5, dur: 2.5 } }),
  // 9지형부터: 튕기는 탄
  acorn: E('acorn', '잔나비 요괴', '밤송이를 던진다. 벽에 맞고 튕겨 돌아오니 끝까지 보자', 52, 19, 100, 12, 125, 'bounce', 400, 0.45, 2.2, 330, 12, 5, { bounce: 2 }),
  // 10지형부터: 날뛰기
  yaksha: E('yaksha', '야차', '체력이 절반 아래로 내려가면 날뛴다. 한 번에 몰아서 쓰러뜨리자', 70, 26, 230, 15, 100, 'rage', 70, 0.5, 1.4, 76, 14, 6, { rage: { at: 0.5, speed: 1.5, cd: 0.55, atk: 1.3 } }),
  // 11지형부터: 불러내기
  ferryman: E('ferryman', '뱃사공 망령', '작은 망자를 자꾸 불러낸다. 먼저 쓰러뜨리면 망자도 사라진다', 62, 21, 150, 10, 90, 'call', 420, 0.9, 8, 300, 15, 6, { call: { kind: 'skeleton', n: 2, max: 2, times: 3, hp: 0.35, atk: 0.6, size: 0.75 } }),
  // 12지형부터: 불길 남기기
  firecart: E('firecart', '화차', '불수레가 돌진하며 불길을 남긴다. 불길 위에 서 있지 말자', 50, 18, 95, 13, 150, 'blaze', 320, 0.6, 2.6, 380, 12, 5, { trail: { dur: 3, mul: 0.4, r: 46 } }),
  spirit: E('spirit', '원혼', '떠다니며 멀리서 한기를 쏜다', 56, 19, 106, 13, 120, 'ranged', 460, 0.4, 1.8, 380, 9, 4),
};

/** 정예: 그 지형 요괴 하나를 크고 세게. 주기적으로 주변을 크게 휩쓴다 (원 예고) */
export const ELITE = { hp: 5, atk: 1.4, size: 1.35, reward: 6, ringEvery: 5, ringR: 170, ringWarn: 0.9, ringMul: 1.5 };

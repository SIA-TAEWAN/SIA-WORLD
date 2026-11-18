/**
 * 일반 요괴 9종 (PRD 6장). 수치는 들판(×1.0) 기준이고, 맵의 '요괴 강함' 배율과 시간에 따른 성장은 data/maps.ts 에 있다.
 * move: 움직임 종류 (src/game/enemies.ts 의 MOVES 열쇠. 등록되지 않은 이름은 곧장 쫓아온다)
 */
export interface EnemyDef {
  id: string;
  name: string;
  desc: string;
  move: string;
  hp: number;
  /** 이동 속도 (px/초) */
  speed: number;
  /** 닿았을 때 피해 */
  dmg: number;
  /** 판정 원 반지름 */
  r: number;
  /** 떨구는 경험치 */
  xp: number;
  /** 나타나는 자리: edge 화면 밖 둘레(기본) · near 내 근처 바닥(숨어 있는 요괴) · row 한 줄로 늘어서서 */
  spawn?: 'edge' | 'near' | 'row';
  /** 출렁이며 다가오는 요괴: 옆으로 흔들리는 폭(px/초)과 빠르기(라디안/초) */
  wave?: { amp: number; freq: number };
  /** 원거리 요괴: keep 거리를 두고 every초마다 쏜다 */
  shoot?: { every: number; speed: number; dmg: number; range: number; keep: number; size: number };
  /** 맵 전용 요괴의 추가 값 (움직임 함수가 읽는다) */
  extra?: Record<string, number>;
  /** 움직임까지 만들어졌나 */
  ready: boolean;
}

export const ENEMIES: EnemyDef[] = [
  // ───── 공통 요괴 5종 ─────
  { id: 'imp', name: '꼬마 도깨비', desc: '느리고 약하다. 무리 지어 온다', move: 'chase', hp: 9, speed: 62, dmg: 10, r: 15, xp: 1, ready: true },
  { id: 'wisp', name: '도깨비불', desc: '빠르고 약하다', move: 'chase', hp: 6, speed: 122, dmg: 8, r: 12, xp: 1, ready: true },
  { id: 'club', name: '방망이 도깨비', desc: '느리고 단단하다', move: 'chase', hp: 70, speed: 46, dmg: 16, r: 24, xp: 6, ready: true },
  { id: 'water', name: '물귀신', desc: '출렁이며 다가온다', move: 'wave', hp: 30, speed: 82, dmg: 12, r: 17, xp: 3, wave: { amp: 90, freq: 4 }, ready: true },
  {
    id: 'fox', name: '여우불', desc: '멀리서 불을 쏜다', move: 'ranged', hp: 24, speed: 74, dmg: 8, r: 15, xp: 4,
    shoot: { every: 2.8, speed: 200, dmg: 10, range: 420, keep: 300, size: 9 }, ready: true,
  },
  // ───── 맵 전용 요괴 4종 ─────
  // 죽순 요괴(대나무 숲): 땅속에 숨어 있다가(맞지 않는다) 가까이 가면 튀어나와 빠르게 쫓아온다. wakeR: 깨어나는 거리, wakeSec: 튀어나오는 데 걸리는 시간
  { id: 'bamboo', name: '죽순 요괴', desc: '땅속에 숨었다가 가까이 가면 튀어나온다', move: 'ambush', spawn: 'near', hp: 36, speed: 150, dmg: 14, r: 16, xp: 4, extra: { wakeR: 150, wakeSec: 0.4 }, ready: true },
  // 수문장 요괴(달빛 궁궐): 갑옷을 입어 단단하고, 한 줄(row 마리)로 늘어서서 밀고 들어온다. turn: 방향을 트는 빠르기(라디안/초)
  { id: 'guard', name: '수문장 요괴', desc: '갑옷을 입어 단단하고 줄지어 밀고 들어온다', move: 'line', spawn: 'row', hp: 60, speed: 58, dmg: 16, r: 22, xp: 8, extra: { row: 6, turn: 0.7 }, ready: true },
  // 해골 병사(황천길): 쓰러뜨려도 reviveSec 뒤에 체력 reviveHp(비율)로 한 번 되살아난다
  { id: 'skeleton', name: '해골 병사', desc: '쓰러뜨려도 잠시 뒤 한 번 되살아난다', move: 'revive', hp: 11, speed: 70, dmg: 11, r: 15, xp: 2, extra: { reviveSec: 2.5, reviveHp: 0.6 }, ready: true },
  // 원혼(황천길): 장애물(물길)을 통과해 곧장 다가온다
  { id: 'spirit', name: '원혼', desc: '장애물을 통과해 곧장 다가온다. 빠르고 약하다', move: 'ghost', hp: 9, speed: 138, dmg: 10, r: 13, xp: 2, ready: true },
];

export const ENEMY_INDEX: Record<string, number> = Object.fromEntries(ENEMIES.map((e, i) => [e.id, i]));

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
  /** 출렁이며 다가오는 요괴: 옆으로 흔들리는 폭(px/초)과 빠르기(라디안/초) */
  wave?: { amp: number; freq: number };
  /** 원거리 요괴: keep 거리를 두고 every초마다 쏜다 */
  shoot?: { every: number; speed: number; dmg: number; range: number; keep: number; size: number };
  /** 맵 전용 요괴의 추가 값 (6단계에서 동작을 만든다) */
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
  // ───── 맵 전용 요괴 4종 (자리만. 6단계에서 move 동작을 만든다) ─────
  { id: 'bamboo', name: '죽순 요괴', desc: '땅속에 숨었다가 가까이 가면 튀어나온다', move: 'ambush', hp: 40, speed: 150, dmg: 14, r: 16, xp: 4, extra: { wakeR: 150 }, ready: false },
  { id: 'guard', name: '수문장 요괴', desc: '갑옷을 입어 단단하고 줄지어 밀고 들어온다', move: 'line', hp: 120, speed: 56, dmg: 16, r: 22, xp: 8, extra: { row: 6 }, ready: false },
  { id: 'skeleton', name: '해골 병사', desc: '쓰러뜨려도 잠시 뒤 한 번 되살아난다', move: 'revive', hp: 26, speed: 70, dmg: 12, r: 16, xp: 2, extra: { reviveSec: 2.5 }, ready: false },
  { id: 'spirit', name: '원혼', desc: '장애물을 통과해 곧장 다가온다. 빠르고 약하다', move: 'ghost', hp: 10, speed: 140, dmg: 10, r: 13, xp: 2, ready: false },
];

export const ENEMY_INDEX: Record<string, number> = Object.fromEntries(ENEMIES.map((e, i) => [e.id, i]));

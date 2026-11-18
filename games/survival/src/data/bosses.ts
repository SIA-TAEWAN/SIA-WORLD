/**
 * 보스 12종 (PRD 6장). 공통 뼈대(체력 바·등장 경고·패턴 전환·보물상자)는 src/game/bosses.ts 에 있고,
 * 보스마다 다른 것은 아래의 수치와 패턴 목록뿐이다. 패턴은 적힌 순서대로 되풀이한다.
 * 패턴 종류(kind)의 동작은 src/game/bosses.ts 의 PATTERNS 에 등록한다.
 */
export interface BossPattern {
  kind: string;
  /** 이 패턴이 이어지는 시간 (초) */
  dur?: number;
  /** 공격 전에 미리 보여 주는 시간 (초) */
  windup?: number;
  speed?: number;
  /** 공격 범위 반지름 */
  r?: number;
  dmg?: number;
  /** 횟수·마릿수 */
  count?: number;
  /** 여러 번 할 때 사이 간격 (초) */
  gap?: number;
  /** 소환할 요괴 (data/enemies.ts 의 id) */
  enemy?: string;
  /** 내 주변 어디까지 흩어 놓나 */
  spread?: number;
}

export interface BossDef {
  id: string;
  name: string;
  /** 어느 맵의 보스인가 (data/maps.ts 의 id) */
  map: string;
  desc: string;
  hp: number;
  speed: number;
  /** 몸에 닿았을 때 피해 */
  dmg: number;
  r: number;
  xp: number;
  /** 시간이 갈수록 단단해짐: 등장 뒤 초당 perSec 만큼 받는 피해가 줄어 min 배까지 */
  harden?: { perSec: number; min: number };
  patterns: BossPattern[];
  /** 패턴까지 만들어졌나 */
  ready: boolean;
}

export const BOSSES: BossDef[] = [
  // ───── 1. 들판 ─────
  {
    id: 'bigDokkaebi', name: '큰 도깨비', map: 'field', desc: '돌진하고 주변에 충격파를 낸다', hp: 2200, speed: 78, dmg: 16, r: 52, xp: 60, ready: true,
    patterns: [
      { kind: 'chase', dur: 3 },
      { kind: 'charge', windup: 0.8, speed: 560, dur: 0.65 },
      { kind: 'chase', dur: 2 },
      { kind: 'shockwave', windup: 1.1, r: 210, dmg: 20 },
    ],
  },
  {
    id: 'dueoksini', name: '두억시니', map: 'field', desc: '방망이를 내려찍고 꼬마 도깨비를 부른다', hp: 5000, speed: 70, dmg: 20, r: 56, xp: 150, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'slam', windup: 0.9, r: 125, dmg: 24, count: 3, gap: 0.55 },
      { kind: 'chase', dur: 2 },
      { kind: 'summon', windup: 0.8, enemy: 'imp', count: 10, spread: 260 },
    ],
  },
  {
    id: 'bulgasal', name: '불가살', map: 'field', desc: '큰 범위를 공격하고, 시간이 갈수록 단단해진다', hp: 9000, speed: 84, dmg: 24, r: 64, xp: 300, ready: true,
    harden: { perSec: 0.004, min: 0.6 },
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'barrage', windup: 1.1, r: 140, dmg: 26, count: 5, spread: 330 },
      { kind: 'chase', dur: 2 },
      { kind: 'nova', windup: 1.6, r: 400, dmg: 32 },
      { kind: 'charge', windup: 0.7, speed: 600, dur: 0.6 },
    ],
  },
  // ───── 2. 대나무 숲 (6단계) ─────
  { id: 'jangsanbeom', name: '장산범', map: 'bamboo', desc: '대나무 사이로 숨었다가 빠르게 기습한다', hp: 5000, speed: 110, dmg: 20, r: 48, xp: 100, patterns: [], ready: false },
  { id: 'centipede', name: '왕지네', map: 'bamboo', desc: '긴 몸으로 길을 막고 독을 뿌린다', hp: 16000, speed: 70, dmg: 24, r: 54, xp: 220, patterns: [], ready: false },
  { id: 'gumiho', name: '구미호', map: 'bamboo', desc: '분신을 만들고 여우구슬을 쏟아낸다', hp: 34000, speed: 96, dmg: 28, r: 56, xp: 400, patterns: [], ready: false },
  // ───── 3. 달빛 궁궐 (6단계) ─────
  { id: 'guardCaptain', name: '수문장 대장', map: 'palace', desc: '방패를 들고 돌진하며 수문장 요괴를 지휘한다', hp: 9000, speed: 80, dmg: 24, r: 54, xp: 140, patterns: [], ready: false },
  { id: 'yagwanggwi', name: '야광귀', map: 'palace', desc: '순간이동한다. 맞으면 잠시 느려진다', hp: 26000, speed: 90, dmg: 28, r: 50, xp: 300, patterns: [], ready: false },
  { id: 'imugi', name: '이무기', map: 'palace', desc: '화면을 가로질러 돌진하고 물기둥을 세운다', hp: 54000, speed: 90, dmg: 32, r: 66, xp: 500, patterns: [], ready: false },
  // ───── 4. 황천길 (6단계) ─────
  { id: 'reaper', name: '저승사자', map: 'underworld', desc: '명부로 표식을 찍고 그 자리가 잠시 뒤 폭발한다', hp: 14000, speed: 84, dmg: 28, r: 50, xp: 180, patterns: [], ready: false },
  { id: 'gangcheori', name: '강철이', map: 'underworld', desc: '불을 뿜어 바닥에 불길 지대를 남긴다', hp: 40000, speed: 80, dmg: 32, r: 62, xp: 380, patterns: [], ready: false },
  { id: 'yeomra', name: '염라대왕', map: 'underworld', desc: '넓은 판결 장판을 깔고 저승사자·해골 병사를 부른다', hp: 80000, speed: 76, dmg: 36, r: 70, xp: 600, patterns: [], ready: false },
];

export const BOSS_INDEX: Record<string, number> = Object.fromEntries(BOSSES.map((b, i) => [b.id, i]));

/**
 * 보스 12종 (PRD 6장). 공통 뼈대(체력 바·등장 경고·패턴 전환·보물상자)는 src/game/bosses.ts 에 있고,
 * 보스마다 다른 것은 아래의 수치와 패턴 목록뿐이다. 패턴은 적힌 순서대로 되풀이한다.
 * 패턴 종류(kind)의 동작은 src/game/bosses.ts 의 PATTERNS 에 등록한다.
 * 체력에는 맵의 '요괴 강함' 배율(data/maps.ts 의 power.hp)이 곱해진다.
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
  /** 내 주변 어디까지 흩어 놓나 · 줄지어 놓는 공격의 전체 길이 */
  spread?: number;
  /** 탄막: 몇 번 쏘나 */
  waves?: number;
  /** 터진 뒤 바닥에 남는 시간 (초) 과 그동안 0.5초마다 주는 피해 (불길·독) */
  linger?: number;
  tick?: number;
  /** 맞으면 이동 속도가 줄어드는 시간 (초) */
  slow?: number;
  /** 범위 공격의 모습: warn(기본) · poison 독 · fire 불길 · water 물기둥 */
  zone?: string;
  /** 이 패턴 동안 받는 피해 배율 (방패) */
  shield?: number;
  /** 분신·부하의 체력 (보스 최대 체력의 비율) 과 모습 (다른 보스의 id. 없으면 자기 모습) */
  hp?: number;
  look?: string;
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
    id: 'bigDokkaebi', name: '큰 도깨비', map: 'field', desc: '돌진하고 주변에 충격파를 낸다', hp: 3200, speed: 86, dmg: 30, r: 52, xp: 60, ready: true,
    patterns: [
      { kind: 'chase', dur: 3 },
      { kind: 'charge', windup: 0.8, speed: 560, dur: 0.65 },
      { kind: 'chase', dur: 2 },
      { kind: 'shockwave', windup: 1.0, r: 225, dmg: 34 },
    ],
  },
  {
    id: 'dueoksini', name: '두억시니', map: 'field', desc: '방망이를 내려찍고 꼬마 도깨비를 부른다', hp: 2800, speed: 70, dmg: 18, r: 56, xp: 150, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'slam', windup: 1.0, r: 125, dmg: 18, count: 3, gap: 0.6 },
      { kind: 'chase', dur: 2 },
      { kind: 'summon', windup: 0.8, enemy: 'imp', count: 8, spread: 260 },
    ],
  },
  {
    id: 'bulgasal', name: '불가살', map: 'field', desc: '큰 범위를 공격하고, 시간이 갈수록 단단해진다', hp: 4200, speed: 80, dmg: 18, r: 64, xp: 300, ready: true,
    harden: { perSec: 0.004, min: 0.6 },
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'barrage', windup: 1.2, r: 140, dmg: 18, count: 5, spread: 330 },
      { kind: 'chase', dur: 2 },
      { kind: 'nova', windup: 1.9, r: 380, dmg: 22 },
      { kind: 'charge', windup: 0.9, speed: 560, dur: 0.6 },
    ],
  },
  // ───── 2. 대나무 숲 ─────
  {
    // 장산범: 대나무 사이로 숨었다가(보이지 않고 맞지 않는다) 내 옆에 나타나 빠르게 덮친다
    id: 'jangsanbeom', name: '장산범', map: 'bamboo', desc: '대나무 사이로 숨었다가 빠르게 기습한다', hp: 1800, speed: 94, dmg: 16, r: 48, xp: 80, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'hide', dur: 1.6, r: 250 },
      { kind: 'charge', windup: 0.65, speed: 560, dur: 0.5 },
      { kind: 'chase', dur: 1.5 },
      { kind: 'hide', dur: 1.2, r: 230 },
      { kind: 'charge', windup: 0.6, speed: 600, dur: 0.5 },
    ],
  },
  {
    // 왕지네: 긴 몸(독 지대의 줄)으로 내가 가는 길을 막고, 내 둘레에 독을 뿌린다
    id: 'centipede', name: '왕지네', map: 'bamboo', desc: '긴 몸으로 길을 막고 독을 뿌린다', hp: 2600, speed: 74, dmg: 18, r: 54, xp: 170, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'wallLine', windup: 0.9, r: 62, dmg: 20, count: 7, spread: 620, linger: 4, tick: 8, zone: 'poison' },
      { kind: 'chase', dur: 2 },
      { kind: 'barrage', windup: 1.0, r: 100, dmg: 18, count: 5, spread: 300, linger: 3.5, tick: 8, zone: 'poison' },
    ],
  },
  {
    // 구미호: 분신을 만들고 여우구슬을 사방으로 쏟아낸다
    id: 'gumiho', name: '구미호', map: 'bamboo', desc: '분신을 만들고 여우구슬을 쏟아낸다', hp: 3600, speed: 90, dmg: 18, r: 56, xp: 320, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'bullets', windup: 0.8, count: 10, waves: 3, gap: 0.6, speed: 190, dmg: 14 },
      { kind: 'clones', windup: 0.8, count: 3, hp: 0.03, spread: 240 },
      { kind: 'chase', dur: 2 },
      { kind: 'bullets', windup: 0.8, count: 14, waves: 2, gap: 0.7, speed: 210, dmg: 14 },
      { kind: 'charge', windup: 0.6, speed: 600, dur: 0.55 },
    ],
  },
  // ───── 3. 달빛 궁궐 ─────
  {
    // 수문장 대장: 방패를 든 채(받는 피해가 줄어든다) 돌진하고, 수문장 요괴를 불러 지휘한다
    id: 'guardCaptain', name: '수문장 대장', map: 'palace', desc: '방패 돌진을 하고 수문장 요괴를 지휘한다', hp: 1500, speed: 76, dmg: 14, r: 54, xp: 100, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'charge', windup: 1.0, speed: 480, dur: 0.7, shield: 0.3 },
      { kind: 'summon', windup: 0.8, enemy: 'guard', count: 3, spread: 320 },
      { kind: 'chase', dur: 2.5 },
      { kind: 'charge', windup: 0.9, speed: 500, dur: 0.7, shield: 0.3 },
    ],
  },
  {
    // 야광귀: 내 옆으로 순간이동해 덮친다. 맞으면 잠시 이동 속도가 줄어든다
    id: 'yagwanggwi', name: '야광귀', map: 'palace', desc: '순간이동한다. 맞으면 잠시 느려진다', hp: 2600, speed: 88, dmg: 18, r: 50, xp: 200, ready: true,
    patterns: [
      { kind: 'chase', dur: 2 },
      { kind: 'blink', windup: 0.75, r: 130, dmg: 24, count: 3, gap: 1.0, slow: 2.5 },
      { kind: 'chase', dur: 2 },
      { kind: 'barrage', windup: 1.0, r: 110, dmg: 20, count: 4, spread: 280, slow: 2 },
    ],
  },
  {
    // 이무기: 화면 밖에서 화면을 가로질러 돌진하고(지나갈 길이 미리 보인다), 여기저기 물기둥을 세운다
    id: 'imugi', name: '이무기', map: 'palace', desc: '화면을 가로지르는 돌진, 물기둥', hp: 2200, speed: 82, dmg: 16, r: 66, xp: 380, ready: true,
    patterns: [
      { kind: 'chase', dur: 2 },
      { kind: 'sweep', windup: 1.4, speed: 1150, dur: 0.95, r: 80, dmg: 20, count: 8, spread: 1040 },
      { kind: 'barrage', windup: 1.2, r: 100, dmg: 18, count: 6, spread: 380, zone: 'water' },
      { kind: 'chase', dur: 1.5 },
      { kind: 'sweep', windup: 1.3, speed: 1250, dur: 0.9, r: 80, dmg: 20, count: 8, spread: 1040 },
    ],
  },
  // ───── 4. 황천길 ─────
  {
    // 저승사자: 명부로 내 자리에 표식을 찍는다. 표식은 잠시 뒤 폭발한다
    id: 'reaper', name: '저승사자', map: 'underworld', desc: '명부로 표식을 찍고 그 자리가 잠시 뒤 폭발한다', hp: 1500, speed: 82, dmg: 16, r: 50, xp: 120, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'slam', windup: 1.3, r: 105, dmg: 26, count: 5, gap: 0.45 },
      { kind: 'chase', dur: 2 },
      { kind: 'slam', windup: 1.1, r: 120, dmg: 26, count: 4, gap: 0.6 },
    ],
  },
  {
    // 강철이: 내 쪽으로 불을 뿜는다. 불이 지나간 바닥에는 불길 지대가 한동안 남는다
    id: 'gangcheori', name: '강철이', map: 'underworld', desc: '불을 뿜어 바닥에 불길 지대를 남긴다', hp: 2600, speed: 80, dmg: 18, r: 62, xp: 240, ready: true,
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'breath', windup: 0.8, r: 70, dmg: 24, count: 7, spread: 560, linger: 5, tick: 9, zone: 'fire' },
      { kind: 'chase', dur: 2 },
      { kind: 'breath', windup: 0.7, r: 70, dmg: 24, count: 7, spread: 560, linger: 5, tick: 9, zone: 'fire' },
      { kind: 'charge', windup: 0.7, speed: 580, dur: 0.6 },
    ],
  },
  {
    // 염라대왕: 넓은 판결 장판을 여러 개 깔고, 저승사자(작은 모습)와 해골 병사를 부른다
    id: 'yeomra', name: '염라대왕', map: 'underworld', desc: '넓은 판결 장판, 저승사자·해골 병사 소환', hp: 2000, speed: 72, dmg: 16, r: 70, xp: 450, ready: true,
    harden: { perSec: 0.002, min: 0.75 },
    patterns: [
      { kind: 'chase', dur: 2.5 },
      { kind: 'barrage', windup: 1.5, r: 190, dmg: 20, count: 4, spread: 420 },
      { kind: 'summon', windup: 0.8, enemy: 'skeleton', count: 8, spread: 280 },
      { kind: 'chase', dur: 2 },
      { kind: 'nova', windup: 2.0, r: 400, dmg: 22 },
      { kind: 'clones', windup: 0.8, count: 2, hp: 0.04, spread: 260, look: 'reaper' },
    ],
  },
];

export const BOSS_INDEX: Record<string, number> = Object.fromEntries(BOSSES.map((b, i) => [b.id, i]));

/**
 * 보스 (PRD 5장). 공통 뼈대(체력 바·등장 경고·생명 5 감소)는 계산(src/game/sim.ts)이 맡고,
 * 보스마다 다른 것은 특수 행동 하나뿐이다: act = src/game/bosses.ts 의 BOSS_ACTS 열쇠, p = 그 행동의 수치.
 * 새 보스 = 여기에 한 줄 + BOSS_ACTS 에 작은 함수 하나 (+ 그림 public/art/b-<id>.png).
 */
export interface BossDef {
  id: string;
  name: string;
  desc: string;
  hp: number;
  speed: number;
  bounty: number;
  r: number;
  size: number;
  /** 출구에 닿으면 줄어드는 생명 */
  leak: number;
  /** 정면 방패 (일반 요괴의 shield 와 같다) */
  shield?: number;
  /** 특수 행동 (BOSS_ACTS 의 열쇠) 과 수치 */
  act: string;
  p: Record<string, number>;
}

export const BOSSES: BossDef[] = [
  {
    id: 'bigDokkaebi', name: '큰 도깨비', desc: '체력이 많고 가끔 빠르게 돌진해요', hp: 2200, speed: 26, bounty: 100, r: 34, size: 128, leak: 5,
    // 돌진: every 초마다 warn 초 동안 멈춰 벼른 뒤 dur 초 동안 mul 배 빠르게 달린다
    act: 'dash', p: { every: 8, warn: 0.9, dur: 1.6, mul: 3.2 },
  },
  {
    id: 'dueoksini', name: '두억시니', desc: '꼬마 도깨비를 계속 불러내요', hp: 1700, speed: 27, bounty: 110, r: 34, size: 128, leak: 5,
    // 소환: every 초마다 kind 번 요괴(0 = 꼬마 도깨비)를 count 마리 부른다 (체력은 hp 배)
    act: 'summon', p: { every: 6, count: 2, kind: 0, hp: 1.4 },
  },
  {
    id: 'bulgasal', name: '불가살', desc: '시간이 갈수록 단단해져요. 빨리 잡아야 해요', hp: 700, speed: 28, bounty: 120, r: 36, size: 136, leak: 5,
    // 단단해짐: 나온 뒤 초마다 받는 피해가 rate 만큼 줄어든다 (max 까지)
    act: 'harden', p: { rate: 0.006, max: 0.6 },
  },
  {
    id: 'jangsanbeom', name: '장산범', desc: '잠깐씩 사라졌다가 앞쪽에서 다시 나타나요', hp: 1700, speed: 30, bounty: 130, r: 34, size: 128, leak: 5,
    // 사라짐: every 초마다 gone 초 동안 사라졌다가 jump 만큼 앞에서 나타난다
    act: 'blink', p: { every: 8, gone: 1.4, jump: 170 },
  },
  {
    id: 'centipede', name: '왕지네', desc: '몸이 길어요. 마디를 모두 쓰러뜨려야 머리가 다쳐요', hp: 700, speed: 30, bounty: 140, r: 32, size: 120, leak: 5,
    // 마디: segs 개가 gap 간격으로 뒤따른다 (마디 체력 segHp). 마디가 남아 있는 동안 머리는 다치지 않는다
    act: 'segments', p: { segs: 5, gap: 50, segHp: 160 },
  },
  {
    id: 'gumiho', name: '구미호', desc: '분신을 만들어 여러 길로 나뉘어 와요', hp: 2000, speed: 32, bounty: 150, r: 34, size: 136, leak: 5,
    // 분신: 체력이 3/4 · 2/4 · 1/4 이 될 때마다 길마다 분신 하나 (체력은 보스 최대 체력의 hp 배, 지나가면 생명 leak)
    act: 'clones', p: { hp: 0.13, leak: 2 },
  },
];

export const BOSS_INDEX: Record<string, number> = Object.fromEntries(BOSSES.map((b, i) => [b.id, i]));

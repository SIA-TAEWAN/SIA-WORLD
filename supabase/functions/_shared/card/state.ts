/**
 * 판(run) 상태와 입력 기록 형식. 상태는 전부 JSON 으로 저장할 수 있고, 같은 씨앗 + 같은 입력 목록이면 같은 상태가 된다.
 * 서버(5단계 card-finish)는 씨앗·영웅·입력 목록을 받아 같은 코드로 다시 돌린다.
 */
import type { NodeType, PowerId, StatusId } from './types.ts';

export type Statuses = Partial<Record<StatusId, number>>;

export interface DeckCard {
  uid: number;
  id: string;
  up?: boolean;
}

/** 전투 중 카드 (덱 카드 + 이 전투만의 표시) */
export interface BCard extends DeckCard {
  /** 이 전투에서 생긴 카드 (내림카드 등) — 전투가 끝나면 사라짐 */
  tmp?: boolean;
  /** 이번 턴 기력 0 */
  free?: boolean;
  /** 이번 턴 기력 -n (할퀴기) */
  cut?: number;
}

export interface Foe {
  uid: number;
  id: string;
  hp: number;
  maxHp: number;
  block: number;
  st: Statuses;
  /** 힘: 공격 피해에 더함 */
  str: number;
  phase: 1 | 2 | 3;
  /** 다음 행동 (move id) */
  intent: string | null;
  /** cycle 위치 */
  cyc: number;
  last: string | null;
  /** 남은 피하기 횟수 */
  dodge: number;
  minion: boolean;
  dead: boolean;
  /** 정예로 나온 보스 (체력 60%) */
  elite?: boolean;
  boss?: boolean;
  /** 냄새 추적으로 미리 정해 둔 그다음 행동 (move id) */
  next?: string | null;
  /** 시간 멈춤: 다음 행동 건너뜀 */
  stun?: boolean;
  /** 어둠 속 (야광귀): 받는 피해 -75% */
  dark?: boolean;
  /** 큰 공격 예고 중 — 취소까지 남은 피해 (이무기) */
  charge?: number | null;
  /** 한 번 부활했음 (불가살) */
  revived?: boolean;
}

export interface Battle {
  kind: 'battle' | 'elite' | 'boss';
  /** 보상 2배 (갈림길의 여우) */
  double?: boolean;
  turn: number;
  energy: number;
  hand: BCard[];
  draw: BCard[];
  discard: BCard[];
  exhaust: BCard[];
  block: number;
  st: Statuses;
  /** 이번 턴 맞으면 반격 */
  thorns: number;
  /** 다음 턴 시작에 얻는 방어 */
  nextBlock: number;
  /** 다음 턴 뽑은 뒤 무작위로 버릴 장수 */
  discardNext: number;
  /** 구미호 구슬: 첫 공격을 분신이 대신 맞음 */
  foxShield: boolean;
  powers: Partial<Record<PowerId, number>>;
  foes: Foe[];
  /** 난수 줄기 3개 — 섞기·요괴 의도·카드 무작위 대상. 서로 따로라 한쪽을 더 써도 다른 쪽 순서는 그대로 */
  rng: { draw: number; ai: number; fx: number };
  nextFoe: number;
  /** 이번 턴 기록 (drawn = 이번 턴 뽑은 장수) */
  t: { played: number; attacks: number; drawn?: number };
  /** 다음 턴 시작에 더 받는 기력 (깡충) */
  nextEnergy?: number;
  /** 이번 턴 첫 공격카드 기력 0 (살금살금 — 다음 턴에 켜짐) */
  freeAtk?: boolean;
  nextFreeAtk?: boolean;
  /** 직전에 쓴 카드 (흉내) */
  lastCard?: { id: string; up?: boolean; target?: number } | null;
  /** 손패에서 카드를 골라야 함 (쥐구멍·분신술) — 고를 때까지 다른 입력은 받지 않는다 */
  pending?: { kind: 'discard' | 'clone'; n: number } | null;
  /** 이 전투 기록·한 번만 쓰는 부적 (gold = 이기면 받는 엽전, phoenix = 불사조 깃 썼음) */
  b: { attacks: number; whet: boolean; beoseon: boolean; sorghum: boolean; gold?: number; phoenix?: boolean };
  /** 이번 턴 다음 카드 기력 -n (그림자 걸음) */
  cutNext?: number;
  /** 다음 공격카드 피해 ×2 남은 횟수 (겨누기) */
  aim?: number;
  /** 다음 턴 더 뽑을 장수 (구르기) */
  nextDraw?: number;
  /** 상태이상 막기 남은 횟수 (거울 부채, 내 턴 시작에 사라짐) */
  ward?: number;
  /** 첫 턴에 더 받는 기력 (도깨비 방망이 · 탁발승) */
  e1: number;
  over: null | 'win' | 'lose';
}

export interface MapNode {
  col: number;
  type: NodeType;
  /** 다음 줄에서 이어진 칸 (col) */
  next: number[];
  /** 화면 가로 위치 0~1 */
  x: number;
}

export interface ActMap {
  region: string;
  boss: string;
  elites: string[];
  /** 0~11 = 칸 줄, 12 = 보스 한 칸 */
  rows: MapNode[][];
}

export type Phase = 'map' | 'battle' | 'reward' | 'shop' | 'rest' | 'treasure' | 'event' | 'dead' | 'won';

export type RewardItem =
  | { k: 'gold'; n: number; taken?: boolean }
  | { k: 'card'; options: DeckCard[]; taken?: boolean }
  | { k: 'relic'; id: string; taken?: boolean }
  | { k: 'potion'; id: string; taken?: boolean }
  | { k: 'bossRelic'; options: string[]; taken?: boolean };

export interface Reward {
  items: RewardItem[];
  boss?: boolean;
}

export interface ShopItem {
  id: string;
  up?: boolean;
  price: number;
  sold?: boolean;
}
export interface Shop {
  cards: ShopItem[];
  relics: ShopItem[];
  potions: ShopItem[];
  removed: boolean;
}

export interface EventState {
  id: string;
  /** 고른 선택지 (-1 = 아직) */
  chosen: number;
  text?: string;
  /** 카드를 골라야 하는 일 */
  need?: { kind: 'upgrade' | 'remove' | 'copy'; left: number };
  /** 사건이 전투를 열었음 */
  fought?: boolean;
  /** 사건으로 얻은 부적·카드 (화면 표시용) */
  gotRelic?: string;
  gotCard?: string;
}

export interface RunState {
  v: 1;
  /** 규칙 판본 (run.ts RULES_VERSION) — 다르면 저장한 판을 버린다 */
  rules?: number;
  seed: number;
  mode: 'normal';
  hero: string;
  /** 연습·개발용 전투 하나짜리 판 */
  practice?: boolean;
  hp: number;
  maxHp: number;
  gold: number;
  deck: DeckCard[];
  relics: string[];
  potions: string[];
  act: number;
  /** 지금 칸 (row -1 = 막 시작, 아직 아무 칸도 안 들어감) */
  row: number;
  col: number;
  /** 이번 막에서 지나온 칸 (줄마다 col) */
  path: number[];
  map: ActMap;
  phase: Phase;
  battle: Battle | null;
  reward: Reward | null;
  shop: Shop | null;
  event: EventState | null;
  treasure: { relic: string | null; opened: boolean } | null;
  rest: { done: boolean } | null;
  nextUid: number;
  /** 상점 카드 없애기 쓴 횟수 */
  removes: number;
  seenEvents: string[];
  flags: { nextEnergy: number; ironUsed: boolean; catUsed: boolean };
  stats: { floors: number; elites: number; bosses: number; battles: number };
  /** 이번 막에서 싸운 일반 전투 수 (앞쪽은 쉬운 조합) */
  actBattles?: number;
  /** 판이 끝난 모양: normal = 3막 클리어 · true = 어둑시니까지 (진짜 엔딩) */
  ending?: 'normal' | 'true';
  /** 받아들인 입력 전부 (순서대로) */
  log: Input[];
  /** 막마다 시작한 log 위치 */
  actStart: number[];
}

/**
 * 입력 (기록 가능한 행동). 화면은 이것만 만들어 apply() 에 넘기고, 받아들여진 입력은 run.log 에 쌓인다.
 * - go: 지도에서 다음 칸 (col; 보스 줄은 0)
 * - play: 손패 카드 사용 (uid = 카드 번호, target = 적 uid)
 * - potion: 물약 사용 (slot 0~2, target = 적 uid) · dropPotion: 버리기
 * - end: 턴 끝 (keep = 달빛 구슬로 남길 카드 uid)
 * - pick: 전투 중 손패에서 카드 고르기 (쥐구멍 버리기 · 분신술 복사)
 * - take: 보상 항목 받기 (i = 항목, pick = 카드·보스 부적 중 몇 번째)
 * - buy: 상점 (kind, i) · remove: 상점 카드 없애기 (uid)
 * - heal / upgrade: 쉼터 (uids = 강화할 카드들)
 * - open: 보물 상자 · choose: 이야기 선택지 · pickCard: 이야기에서 카드 고르기
 * - leave: 이 칸을 마치고 지도로
 */
export type Input =
  | { t: 'go'; col: number }
  | { t: 'play'; uid: number; target?: number }
  | { t: 'potion'; slot: number; target?: number }
  | { t: 'dropPotion'; slot: number }
  | { t: 'end'; keep?: number }
  | { t: 'pick'; uid: number }
  | { t: 'take'; i: number; pick?: number }
  | { t: 'buy'; kind: 'card' | 'relic' | 'potion'; i: number }
  | { t: 'remove'; uid: number }
  | { t: 'heal' }
  | { t: 'upgrade'; uids: number[] }
  | { t: 'open' }
  | { t: 'choose'; i: number }
  | { t: 'pickCard'; uid: number }
  | { t: 'leave' };

/** 연출용 사건 (화면이 순서대로 보여 준다). 상태에는 남지 않는다 */
export type SimEvent =
  | { e: 'turn'; who: 'hero' | 'foes'; turn: number }
  | { e: 'draw'; uid: number }
  | { e: 'shuffle' }
  | { e: 'play'; uid: number; id: string; target?: number }
  | { e: 'hit'; to: 'hero' | number; n: number; blocked: number; from?: 'hero' | number | 'status' }
  | { e: 'dodge'; to: number }
  | { e: 'hide'; uid: number }
  | { e: 'block'; to: 'hero' | number; n: number }
  | { e: 'status'; to: 'hero' | number; id: StatusId | 'str'; n: number }
  | { e: 'heal'; n: number }
  | { e: 'energy'; n: number }
  | { e: 'foeMove'; uid: number; move: string; name: string }
  | { e: 'summon'; uid: number }
  | { e: 'phase'; uid: number; text: string; n?: number }
  | { e: 'foeRevive'; uid: number; hp: number }
  | { e: 'cancel'; uid: number }
  /** 시간 멈춤 (uid 0 = 모든 적에게 걸림 · 그 밖 = 그 요괴가 행동을 건너뜀) */
  | { e: 'stunned'; uid: number }
  | { e: 'dark'; uid: number; on: boolean }
  /** 여우구슬: 이 카드 이번 턴 기력 0 */
  | { e: 'free'; uid: number }
  /** 거울 부채로 상태이상을 막음 */
  | { e: 'ward' }
  /** 다음 턴 기력 -n (신발 훔치기) */
  | { e: 'drain'; n: number }
  | { e: 'die'; uid: number }
  | { e: 'discard'; uid: number }
  | { e: 'exhaust'; uid: number }
  | { e: 'curse'; id: string; n: number }
  | { e: 'relic'; id: string }
  | { e: 'revive'; who: string }
  | { e: 'clone'; uid: number; n: number }
  | { e: 'peek'; uid: number }
  | { e: 'mimic'; id: string }
  | { e: 'echo'; id: string }
  | { e: 'win' }
  | { e: 'lose' };

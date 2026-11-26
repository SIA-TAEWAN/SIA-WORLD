/**
 * 시아카드배틀 규칙 코드의 타입. 상태는 전부 JSON 으로 저장·전송할 수 있는 평범한 객체다.
 * 카드·요괴·부적 효과는 '작은 연산(Op) 목록'으로 적는다 — 새 카드는 대개 데이터만 더하면 된다.
 */

export type StatusId = 'fire' | 'poison' | 'wet' | 'mud' | 'weak';
export type CardKind = 'atk' | 'def' | 'skill' | 'power' | 'curse';
/** basic 기본 · common 일반 · uncommon 고급 · legend 전설 · hero 영웅 전용(시작 덱) · hero2 영웅 전용 고급(보상에서만) · curse 내림카드 */
export type Rarity = 'basic' | 'common' | 'uncommon' | 'legend' | 'hero' | 'hero2' | 'curse';
/** 대상: target 고른 적 · all 모든 적 · random 무작위 적(타마다 다시) · others 고른 적을 뺀 모두 · self 나 */
export type Tgt = 'target' | 'all' | 'random' | 'others' | 'self';
/**
 * 부적술(전투 내내) 효과. blockUp 방어 얻을 때마다 +n (우직함) · echoAtk 매 턴 첫 공격카드 한 번 더 (천리마) ·
 * firstDraw 매 턴 첫 카드 쓰면 n장 뽑기 (홰치기)
 */
export type PowerId =
  | 'atkUp'
  | 'regen'
  | 'weakBonus'
  | 'guard'
  | 'energyUp'
  | 'drawUp'
  | 'blockUp'
  | 'echoAtk'
  | 'firstDraw'
  /** 독사의 길: 내가 거는 독 +n */
  | 'poisonUp'
  /** 무한 부채: 카드 뽑을 때마다 방어 n */
  | 'drawBlock'
  /** 불사조 깃: 이 전투에서 쓰러지면 체력 n% 로 한 번 일어남 */
  | 'phoenix';

/**
 * 피해에 더하는 '무엇 1당' (k 를 곱해 내림): drawn 이번 턴 뽑은 카드 · played 이번 턴 앞서 쓴 카드 ·
 * block 내 방어 · energy 남은 기력 · maxHp 최대 체력 · battleAtk 이 전투에서 쓴 공격카드
 */
export type PerId = 'drawn' | 'played' | 'block' | 'energy' | 'maxHp' | 'battleAtk';

/** 카드·물약 효과 연산 */
export type Op =
  /**
   * per/k: 피해 = n + floor(k × per 값) · ifSt/ifN: 그 상태인 적이면 +ifN · ifK: 그 상태인 적이면 ×ifK ·
   * steal: 준 피해의 이만큼(비율) 회복 (흡혈 베기)
   */
  | { op: 'dmg'; n: number; times?: number; to?: Tgt; pierce?: boolean; per?: PerId; k?: number; ifSt?: StatusId; ifN?: number; ifK?: number; steal?: number }
  | { op: 'block'; n: number }
  | { op: 'draw'; n: number }
  | { op: 'energy'; n: number }
  /** plus: 이미 그 상태인 적에게는 +plus (불길 번지기) */
  | { op: 'status'; id: StatusId; n: number; to?: Tgt; plus?: number }
  | { op: 'heal'; n: number }
  | { op: 'nextBlock'; n: number }
  | { op: 'thorns'; n: number }
  | { op: 'power'; id: PowerId; n: number }
  /** 내 방어를 모두 없앰 (털깎기) */
  | { op: 'clearBlock' }
  /** 내 상태이상 모두 제거 (허물벗기) */
  | { op: 'cleanse' }
  /** 대상의 상태를 k배로 (똬리: 독 2배) */
  | { op: 'mulSt'; id: StatusId; k: number }
  /** 최대 체력 +n (판 전체, 먹성) */
  | { op: 'maxHp'; n: number }
  /** 다음 턴 기력 +n (깡충) */
  | { op: 'nextEnergy'; n: number }
  /** 이번 턴 손패의 그 종류 카드 기력 -n (할퀴기) */
  | { op: 'discount'; kind: CardKind; n: number }
  /** 다음 턴 첫 공격카드 기력 0 (살금살금) */
  | { op: 'nextFreeAtk' }
  /** 대상의 다음 행동 2개 보기 (냄새 추적) */
  | { op: 'peek' }
  /** 직전에 쓴 카드의 효과를 한 번 더 (흉내) */
  | { op: 'mimic' }
  /** 손패에서 카드 고르기: discard 버리기 (쥐구멍) · clone 그 카드 복사본 n장 (분신술) */
  | { op: 'pick'; kind: 'discard' | 'clone'; n: number }
  /** 이기면 엽전 +n (엽전 던지기) */
  | { op: 'winGold'; n: number }
  /** 이번 턴 다음에 쓰는 카드 기력 -n (그림자 걸음) */
  | { op: 'nextCut'; n: number }
  /** 다음 공격카드 피해 ×2 (겨누기) */
  | { op: 'aim' }
  /** 손패 무작위 n장 이번 턴 기력 0 (여우구슬) */
  | { op: 'freeRandom'; n: number }
  /** 다음 턴 n장 더 뽑기 (구르기) */
  | { op: 'nextDraw'; n: number }
  /** 이번에 받는 상태이상 n번 막기 (거울 부채 — 다음 내 턴 시작까지) */
  | { op: 'ward'; n: number }
  /** 대상의 그 상태만큼 다른 적 모두에게 (독 퍼뜨리기) */
  | { op: 'spread'; id: StatusId }
  /** 모든 적 다음 행동 건너뜀 (시간 멈춤) */
  | { op: 'stun' };

export interface CardUp {
  cost?: number;
  ops?: Op[];
  exhaust?: boolean;
}

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  rarity: Rarity;
  cost: number;
  /** enemy = 적 하나를 골라야 함 */
  target: 'enemy' | 'none';
  ops: Op[];
  /** 쓰면 이 전투 동안 빠짐 */
  exhaust?: boolean;
  /** 턴 끝에 손에 있으면 (저승 사슬) */
  endTurnHurt?: number;
  /** 강화(+1) 값 — 한 장에 한 번 */
  up?: CardUp;
  /** 그림 이름 (public/art/<art>.png) */
  art: string;
  /** 영웅 전용 카드면 그 영웅 */
  hero?: string;
  /** 설명을 연산에서 못 만드는 카드의 설명 (강화 전/후) */
  text?: string;
  textUp?: string;
}

/** 요괴 행동 연산 (대상은 늘 영웅) */
export type EOp =
  | { op: 'dmg'; n: number; times?: number }
  | { op: 'block'; n: number }
  | { op: 'str'; n: number }
  | { op: 'status'; id: StatusId; n: number }
  /** 내 덱에 내림카드 (pile: draw 뽑을 더미에 섞음 · discard 버린 더미) */
  | { op: 'curse'; id: string; n: number; pile: 'draw' | 'discard' }
  | { op: 'summon'; id: string; n: number; max: number }
  /** 다음 내 턴 뽑은 뒤 손패 무작위 n장 버림 */
  | { op: 'discardNext'; n: number }
  /** 다음 공격 n번 피함 */
  | { op: 'dodge'; n: number }
  /** 내 방어 절반 없앰 (강철이 메마름) */
  | { op: 'halveBlock' }
  /** 다음 내 턴 기력 -n (야광귀 신발 훔치기) */
  | { op: 'drain'; n: number }
  /** 이 전투에서 내가 쓴 공격카드 수 × k 피해 (염라대왕 업보) */
  | { op: 'karma'; k: number }
  /** 큰 공격 예고: 지금부터 n 피해를 받으면 취소 (이무기 승천 예고). 이미 예고 중이면 이어 감 */
  | { op: 'charge'; n: number }
  /** 어둠 속: 다음 행동까지 받는 피해 -75%, 화상을 걸면 풀림 (야광귀) */
  | { op: 'dark' };

export type Intent = 'atk' | 'def' | 'buff' | 'debuff' | 'unknown';

export interface MoveDef {
  id: string;
  name: string;
  intent: Intent;
  ops: EOp[];
}

export type AiDef =
  | { type: 'cycle'; order: string[] }
  | { type: 'random'; weights: [string, number][]; noRepeat?: boolean };

export interface PhaseDef {
  moves: MoveDef[];
  ai: AiDef;
  /** 이 단계에서 매 턴 행동 전에 하는 일 */
  turnOps?: EOp[];
  /**
   * cloneShield: 분신이 있으면 받는 피해 -50% (구미호) · revive: 쓰러지면 한 번 체력 30% 로 부활, 화상이면 못 함 (불가살) ·
   * scorch: 내 화상 피해 2배, 젖음을 걸면 내 화상 감소 (강철이) · execute: 내 체력 30% 이하면 주는 피해 2배 (저승사자)
   */
  passive?: 'cloneShield' | 'revive' | 'scorch' | 'execute';
  /** 단계가 바뀔 때 보이는 말 */
  shout?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: [number, number];
  art: string;
  boss?: boolean;
  /** 분신·병졸처럼 불려 나온 요괴 (주인이 다 쓰러지면 같이 사라짐) */
  minion?: boolean;
  phase1: PhaseDef;
  /** 체력 50% 이하에서 바뀌는 2단계 (보스) */
  phase2?: PhaseDef;
  /** 단계가 바뀌는 체력 비율 (기본 [0.5]) — 어둑시니는 [0.66, 0.33] */
  phaseAt?: number[];
  /** 3단계 (어둑시니) */
  phase3?: PhaseDef;
  /** 단계마다 그림 크기 (어둑시니 230→262→296) */
  grow?: number[];
  /** rage: 내가 공격카드를 쓸 때마다 힘 +1 (어둑시니) */
  rage?: number;
}

export interface HeroDef {
  id: string;
  name: string;
  animal: string;
  hp: number;
  passive: string;
  /** 전용1(시작 덱) · 전용2(고급, 그 영웅 보상에서만) */
  cards: [string, string];
  /** 이번 단계에서 고를 수 있는 영웅 */
  ready: boolean;
  /** 고양이는 해금 */
  locked?: boolean;
}

export type RelicRarity = 'common' | 'uncommon' | 'boss';
export interface RelicDef {
  id: string;
  name: string;
  rarity: RelicRarity;
  text: string;
  art: string;
}

export interface PotionDef {
  id: string;
  name: string;
  text: string;
  target: 'enemy' | 'none';
  ops: Op[];
  art: string;
}

/** 이야기 사건 연산 */
export type EvOp =
  | { t: 'hp'; n: number }
  | { t: 'maxHp'; n: number }
  /** 최대 체력 % 만큼 최대 체력을 줄임 */
  | { t: 'maxHpPct'; n: number }
  | { t: 'gold'; n: number }
  | { t: 'upgrade'; n: number }
  | { t: 'remove'; n: number }
  | { t: 'copy'; n: number }
  | { t: 'relic' }
  | { t: 'curse'; id: string; n: number }
  | { t: 'card'; rarity: 'uncommon' | 'legend' }
  /** 정예 전투 — foes 가 있으면 막마다 그 요괴 (갈림길의 여우), 없으면 그 지역 정예 */
  | { t: 'elite'; double: boolean; foes?: string[] }
  | { t: 'chance'; p: number; win: EvOp[]; lose: EvOp[]; winText: string; loseText: string }
  | { t: 'nextEnergy'; n: number };

export interface EventChoice {
  label: string;
  /** 엽전이 이만큼 있어야 고를 수 있음 */
  needGold?: number;
  ops: EvOp[];
  /** 고른 뒤 보이는 말 */
  after?: string;
}

export interface EventDef {
  id: string;
  name: string;
  /** 나오는 막 (빈 목록 = 전체) */
  acts: number[];
  text: string;
  art: string;
  choices: EventChoice[];
}

export type NodeType = 'battle' | 'elite' | 'shop' | 'rest' | 'treasure' | 'event' | 'boss';

export interface RegionDef {
  id: string;
  name: string;
  tile: string;
  bg: string;
  bosses: string[];
  enemies: string[];
  /** 앞쪽 줄(쉬운) / 뒤쪽 줄 전투 조합 */
  easy: string[][];
  normal: string[][];
  ready: boolean;
  /** 숨은 지역 (4막 어둑시니) — 지도 대신 보스 한 칸 */
  hidden?: boolean;
}

export interface ActDef {
  act: number;
  regions: string[];
  /** 숨은 막 (조건을 채워야 열림) */
  hidden?: boolean;
}

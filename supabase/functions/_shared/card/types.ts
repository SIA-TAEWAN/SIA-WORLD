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
export type PowerId = 'atkUp' | 'regen' | 'weakBonus' | 'guard' | 'energyUp' | 'drawUp';

/** 카드·물약 효과 연산 */
export type Op =
  | { op: 'dmg'; n: number; times?: number; to?: Tgt; pierce?: boolean }
  | { op: 'block'; n: number }
  | { op: 'draw'; n: number }
  | { op: 'energy'; n: number }
  | { op: 'status'; id: StatusId; n: number; to?: Tgt }
  | { op: 'heal'; n: number }
  | { op: 'nextBlock'; n: number }
  | { op: 'thorns'; n: number }
  | { op: 'power'; id: PowerId; n: number };

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
  | { op: 'dodge'; n: number };

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
  /** cloneShield: 분신이 있으면 받는 피해 -50% */
  passive?: 'cloneShield';
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
  | { t: 'elite'; double: boolean }
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
}

export interface ActDef {
  act: number;
  regions: string[];
}

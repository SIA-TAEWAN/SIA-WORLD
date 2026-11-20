import type { EnemyKind } from './enemies.ts';
import type { HeroType } from './heroes.ts';

/**
 * 시아핑거 스테이지 (PRD "스테이지 구성"). 판 모양(방·기둥)과 웨이브 구성만 둔다.
 * 엽전 보상처럼 SQL 이 계산하는 값은 games/finger/src/data 에 둔다 (4단계).
 * 좌표는 방 안 좌표 (왼쪽 위 0,0 · 오른쪽 아래 ROOM_W,ROOM_H).
 */

/** 방 크기 (화면 720×1280 안에 40px 띄워 그린다) */
export const ROOM_W = 640;
export const ROOM_H = 960;

/** 요괴 하나: 일반 요괴 · 작은 대장(chief) · 지역 보스(boss) */
export interface FoeSpec {
  k: EnemyKind | 'chief' | 'boss';
  x: number;
  y: number;
  /** 쓰러지면 떨어뜨리는 것 */
  drop?: 'heal' | 'coin';
}

export interface StageDef {
  id: string;
  region: number;
  /** 지역 안 번호 1~5 (5 = 지역 보스) */
  no: number;
  name: string;
  /** 웨이브 (보통 3개). 웨이브 요괴를 다 쓰러뜨리면 다음 웨이브 */
  waves: FoeSpec[][];
  /** 별 하나: 이 턴 안에 클리어 */
  par: number;
  /** 돌기둥 (x, y, 너비, 높이) — 튕김을 만드는 고정 벽 */
  blocks?: [number, number, number, number][];
  /** 스테이지 목록의 '추천 타입' */
  tip: HeroType;
  /** 요괴 체력 배율 (1 = 기본) */
  hpMul?: number;
  /** 요괴 공격 배율 (1 = 기본) */
  atkMul?: number;
}

const top = 150;

/** 1지역: 쥐의 들판 (손으로 만든 5스테이지) */
const REGION1: StageDef[] = [
  {
    id: '1-1', region: 1, no: 1, name: '들판 입구', par: 12, tip: 'reflect',
    waves: [
      [{ k: 'imp', x: 220, y: top + 120 }, { k: 'imp', x: 420, y: top + 120 }],
    ],
  },
];

export const STAGES: StageDef[] = [...REGION1];

export const stageOf = (id: string): StageDef | undefined => STAGES.find((s) => s.id === id);
export const stagesOf = (region: number) => STAGES.filter((s) => s.region === region);

import type { EnemyKind } from './enemies.ts';
import type { HeroType } from './heroes.ts';
import type { Pillar, Portal, Zone } from './sim.ts';
import { GENERATED } from './stages-gen.ts';

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
  /** 둥근 돌기둥 [x, y, 반지름] */
  pillars?: Pillar[];
  /** 가시밭 · 빨래판 */
  zones?: Zone[];
  /** 순간이동 구멍 한 쌍 [ax, ay, bx, by] */
  portals?: Portal[];
  /** 스테이지 목록의 '추천 타입' */
  tip: HeroType;
  /** 요괴 체력 배율 (1 = 기본) */
  hpMul?: number;
  /** 요괴 공격 배율 (1 = 기본) */
  atkMul?: number;
}

/** 1지역: 쥐의 들판 (손으로 만든 5스테이지). 1~4번째는 마지막 웨이브에 작은 대장, 5번째는 지역 보스(큰 도깨비) */
const REGION1: StageDef[] = [
  {
    id: '1-1', region: 1, no: 1, name: '들판 입구', par: 19, tip: 'reflect',
    waves: [
      [{ k: 'imp', x: 200, y: 250 }, { k: 'imp', x: 440, y: 250 }],
      [{ k: 'imp', x: 160, y: 200 }, { k: 'imp', x: 320, y: 330 }, { k: 'imp', x: 480, y: 200, drop: 'heal' }],
      [{ k: 'wisp', x: 150, y: 330 }, { k: 'wisp', x: 490, y: 330 }, { k: 'chief', x: 320, y: 220 }],
    ],
  },
  {
    id: '1-2', region: 1, no: 2, name: '도깨비불 길', par: 19, tip: 'pierce',
    waves: [
      [{ k: 'wisp', x: 160, y: 220 }, { k: 'wisp', x: 320, y: 220 }, { k: 'wisp', x: 480, y: 220 }],
      [{ k: 'imp', x: 200, y: 180 }, { k: 'wisp', x: 320, y: 380, drop: 'heal' }, { k: 'imp', x: 440, y: 180 }],
      [{ k: 'imp', x: 130, y: 420 }, { k: 'imp', x: 510, y: 420 }, { k: 'chief', x: 320, y: 220 }],
    ],
  },
  {
    id: '1-3', region: 1, no: 3, name: '돌기둥 마당', par: 18, tip: 'reflect',
    blocks: [[110, 540, 90, 40], [440, 540, 90, 40]],
    waves: [
      [{ k: 'imp', x: 200, y: 220 }, { k: 'club', x: 440, y: 260 }],
      [{ k: 'wisp', x: 140, y: 180 }, { k: 'club', x: 320, y: 230 }, { k: 'wisp', x: 500, y: 180, drop: 'heal' }],
      [{ k: 'imp', x: 160, y: 400 }, { k: 'imp', x: 480, y: 400 }, { k: 'chief', x: 320, y: 210 }],
    ],
  },
  {
    id: '1-4', region: 1, no: 4, name: '방망이 고개', par: 20, tip: 'pierce',
    blocks: [[280, 600, 80, 40]],
    waves: [
      [{ k: 'club', x: 200, y: 250 }, { k: 'club', x: 440, y: 250 }],
      [{ k: 'imp', x: 120, y: 200 }, { k: 'club', x: 320, y: 300, drop: 'heal' }, { k: 'imp', x: 520, y: 200 }],
      [{ k: 'club', x: 150, y: 400 }, { k: 'club', x: 490, y: 400 }, { k: 'chief', x: 320, y: 210 }],
    ],
  },
  {
    id: '1-5', region: 1, no: 5, name: '큰 도깨비', par: 22, tip: 'reflect',
    waves: [
      [{ k: 'imp', x: 200, y: 240 }, { k: 'imp', x: 440, y: 240 }, { k: 'wisp', x: 320, y: 420 }],
      [{ k: 'club', x: 320, y: 250 }, { k: 'wisp', x: 150, y: 420, drop: 'heal' }, { k: 'wisp', x: 490, y: 420 }],
      [{ k: 'boss', x: 320, y: 250 }, { k: 'imp', x: 140, y: 520, drop: 'heal' }, { k: 'imp', x: 500, y: 520 }],
    ],
  },
];

/** 60스테이지: 1지역은 손으로, 2~12지역은 games/finger/scripts/gen-stages.ts 가 만든 stages-gen.ts */
export const STAGES: StageDef[] = [...REGION1, ...GENERATED];

export const stageOf = (id: string): StageDef | undefined => STAGES.find((s) => s.id === id);
export const stagesOf = (region: number) => STAGES.filter((s) => s.region === region);

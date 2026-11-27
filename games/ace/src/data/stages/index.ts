// 아케이드 스테이지 12개 + 보스 러시 · 끝없는 모드 등장표
import type { StageDef, WaveScript } from '../waves';
import { RUSH } from '../bosses';
import S1 from './stage1.json';
import S2 from './stage2.json';
import S3 from './stage3.json';
import S4 from './stage4.json';
import S5 from './stage5.json';
import S6 from './stage6.json';
import S7 from './stage7.json';
import S8 from './stage8.json';
import S9 from './stage9.json';
import S10 from './stage10.json';
import S11 from './stage11.json';
import S12 from './stage12.json';

export const STAGES = [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12] as unknown as StageDef[];

/** 보스 러시: 스테이지 보스 12마리를 차례로 (바닥은 요괴 하늘성) */
export const RUSH_STAGE: StageDef = { id: 0, name: '보스 러시', animal: 'pig', floor: 'floor-r12', ground: 'castle', length: 0, waves: [], rush: RUSH, bulletSpeed: 1 };
/** 끝없는 모드 (바닥은 구름 위) */
export const ENDLESS_STAGE: StageDef = { id: 0, name: '끝없는 모드', animal: 'dragon', floor: 'floor-r01', ground: 'castle', sky: true, length: 0, waves: [], endless: true, bulletSpeed: 0.9 };
export type { WaveScript };

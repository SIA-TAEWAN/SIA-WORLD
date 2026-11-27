// 적 등장표. at = 시작 뒤 초, x = 화면 너비 비율(0~1), path = 이동 경로, fire = 탄막 패턴 이름.
// count 마리를 dx 만큼 옆으로, gap 만큼 위로 벌려 한 편대로 낸다 (편대를 다 잡으면 P).
// M1 은 프로토타입 한 판(약 70초)을 반복하며 탄이 조금씩 빨라진다. M2 부터 스테이지별 JSON 으로 옮긴다.
import type { PatternName } from '../game/patterns';
import type { EnemyKind, ItemKind, PathName } from '../game/sim';

export interface Wave {
  at: number;
  /** bolt = 번개 예고 구역 (적이 아님, x 위치에 w 반폭) */
  kind: EnemyKind | 'bolt';
  path: PathName;
  x: number;
  count?: number;
  dx?: number;
  gap?: number;
  drop?: ItemKind;
  fire?: PatternName;
  fireEvery?: number;
  /** rise(물·안개에서 솟기): 나타나는 높이 (화면 높이 비율) */
  y?: number;
  /** 체력 배율 */
  hp?: number;
  /** bolt 반폭 */
  w?: number;
}
export interface WaveScript {
  /** 등장표 길이 (초). 다 지나면 남은 적이 사라진 뒤 보스 */
  length: number;
  waves: Wave[];
  /** 중간 보스: at 초에 나오고, 처리할 때까지 등장표가 멈춘다 */
  midboss?: { at: number; id: string };
  boss?: string;
  /** 끝나면 처음부터 다시 (M1 시험 비행·끝없는 모드) */
  loop?: boolean;
  /** 이 스테이지의 탄 속도 배율 (튜토리얼은 느리게) */
  bulletSpeed?: number;
}
export interface StageDef extends WaveScript {
  id: number;
  name: string;
  animal: string;
  floor: string;
  /** 바다: 왼쪽·오른쪽 띠, 또는 화면 전체 */
  sea?: 'left' | 'right' | 'full';
  /** 구름 위 (바닥 대신 하늘 + 구름) */
  sky?: boolean;
  /** 독안개 (위쪽을 가리는 안개) */
  fog?: boolean;
  /** 지상 목표 그림 (public/art/ground-<이름>.png) */
  ground?: string;
}

export const PROTO: WaveScript = {
  length: 72,
  loop: true,
  waves: [
    { at: 1.5, kind: 'small', path: 'dive', x: 0.3, count: 5, gap: 14 },
    { at: 4, kind: 'small', path: 'dive', x: 0.7, count: 5, gap: 14 },
    { at: 7, kind: 'small', path: 'swoopL', x: 0.62, count: 6, gap: 12 },
    { at: 9.5, kind: 'small', path: 'swoopR', x: 0.38, count: 6, gap: 12 },
    { at: 12, kind: 'carrier', path: 'cross', x: 0, drop: 'B' },
    { at: 14, kind: 'small', path: 'dive', x: 0.15, count: 5, dx: 110, fire: 'aim1', fireEvery: 200 },
    { at: 18, kind: 'medium', path: 'hover', x: 0.5, fire: 'aim3', fireEvery: 70 },
    { at: 22, kind: 'small', path: 'swoopL', x: 0.8, count: 6, gap: 12, fire: 'aim1', fireEvery: 160 },
    { at: 24, kind: 'small', path: 'swoopR', x: 0.2, count: 6, gap: 12, fire: 'aim1', fireEvery: 160 },
    { at: 30, kind: 'medium', path: 'hover', x: 0.27, fire: 'ring16', fireEvery: 90 },
    { at: 31, kind: 'medium', path: 'hover', x: 0.73, fire: 'aim3', fireEvery: 80 },
    { at: 35, kind: 'carrier', path: 'cross', x: 1, drop: 'P' },
    { at: 38, kind: 'small', path: 'dive', x: 0.12, count: 6, dx: 96, fire: 'aim1', fireEvery: 140 },
    { at: 42, kind: 'small', path: 'swoopL', x: 0.5, count: 8, gap: 10, fire: 'aim1', fireEvery: 140 },
    { at: 46, kind: 'medium', path: 'hover', x: 0.5, fire: 'medMix', fireEvery: 40 },
    { at: 50, kind: 'small', path: 'dive', x: 0.2, count: 4, gap: 10, fire: 'aim1', fireEvery: 120 },
    { at: 50, kind: 'small', path: 'dive', x: 0.8, count: 4, gap: 10, fire: 'aim1', fireEvery: 120 },
    { at: 56, kind: 'medium', path: 'hover', x: 0.3, fire: 'spiral4', fireEvery: 8 },
    { at: 60, kind: 'carrier', path: 'cross', x: 0, drop: 'B' },
    { at: 62, kind: 'small', path: 'swoopR', x: 0.3, count: 8, gap: 10, fire: 'aim1', fireEvery: 120 },
    { at: 64, kind: 'small', path: 'swoopL', x: 0.7, count: 8, gap: 10, fire: 'aim1', fireEvery: 120 },
  ],
};

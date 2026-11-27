/**
 * 방 화면의 공용 자리 (room.ts 가 만들고 behavior · play · treats 가 쓴다).
 * 고양이는 여러 마리(최대 4)를 그릴 수 있게 CatView 하나씩 둔다 — 지금 돌보기 물건(밥그릇 · 물그릇 · 화장실)은 첫 고양이 것.
 */
import type { CareOut, NyangApi } from '../net/api';
import type { Cat, Levels, NyangState } from '../game/rules';
import type { CatActor, Spot2 } from './cat';

export interface Prop {
  el: HTMLElement;
  at: Spot2;
  /** 방 너비에 대한 그림 너비 비율 · 그림 세로/가로 */
  w: number;
  ratio: number;
}
export type PropName = 'food' | 'water' | 'litter' | 'cushion' | 'table' | 'box' | 'present';
export type TimeOfDay = 'morning' | 'day' | 'dusk' | 'night';

/** 고양이 한 마리의 화면 쪽 상태 */
export interface CatView {
  slot: number;
  actor: CatActor;
  nextMeow: number;
  /** 연출(놀이 · 츄르 · 빗질 · 마중)이 고양이를 쥐고 있으면 머리(think)를 쉰다 */
  scene: string | null;
  /** 지금 하는 행동 (도감 id, 사진은 5단계) */
  behavior: string | null;
}

export interface RoomCtx {
  api: NyangApi;
  room: HTMLElement;
  state(): NyangState;
  cat(slot: number): Cat;
  levels(slot: number): Levels;
  level(slot: number): number;
  apply(r: { state: NyangState }): void;
  rewards(r: CareOut): void;
  /** 서버 시각 (초) */
  now(): number;
  W(): number;
  H(): number;
  toScreen(p: Spot2): { x: number; y: number };
  /** 화면(client) 좌표 → 바닥 자리 (바닥 밖이면 가장 가까운 바닥) */
  toFloor(clientX: number, clientY: number): Spot2;
  props: Record<PropName, Prop>;
  views: CatView[];
  timeOfDay(): TimeOfDay;
  /** 처음 본 행동이면 도감에 남긴다 */
  saw(view: CatView, behavior: string): void;
  busy(): boolean;
  setBusy(b: boolean): void;
  /** 아래 도구 띠를 연출용 내용으로 바꾼다 (null 이면 원래대로) */
  tray(html: string | null): HTMLElement;
  walkTo(view: CatView, to: Spot2, then?: import('./cat').Act, fast?: boolean): void;
  layoutProps(): void;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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
export type PropName = 'litter' | 'present';
/** 방에 놓인 가구 하나 (꾸미기 배치에서 만든다) */
export interface FurnView {
  id: string;
  f: import('../data/balance').Furniture;
  el: HTMLElement;
  /** 바닥 가구: 바닥 위 발 자리(가운데 아래) · 벽 가구: 쓰지 않음 */
  at: Spot2;
}
export type TimeOfDay = 'morning' | 'day' | 'dusk' | 'night';

/** 고양이 한 마리의 화면 쪽 상태 */
export interface CatView {
  slot: number;
  actor: CatActor;
  nextMeow: number;
  /** 연출(놀이 · 츄르 · 빗질 · 마중)이 고양이를 쥐고 있으면 머리(think)를 쉰다 */
  scene: string | null;
  /** 지금 하는 행동 (도감 id — 사진에 남는다) */
  behavior: string | null;
  /** 같이 어울리는 고양이 (그루밍 · 같이 자기 · 잡기 놀이) */
  mate: number | null;
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
  /** 5단계: 고양이마다 밥그릇 · 물그릇 (밥 자리에 나란히) · 놓인 가구 */
  bowl(slot: number): { food: Prop; water: Prop };
  furn(id: string): FurnView | undefined;
  furnUse(use: import('../data/balance').Furniture['use']): FurnView[];
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
  /** 4단계: 상점 열기 (탭) · 캣그라스 · 캣닢 주기 · 지금 보이는 곳 */
  openShop(tab?: ShopTabId): void;
  giveTreat(kind: 'catgrass' | 'catnip'): void;
  view(): 'room' | 'veranda';
  /** 5단계: 사진 찍기 (그 고양이가 지금 하는 행동 · 자세) */
  photo(view: CatView): void;
}
export type ShopTabId = import('../data/balance').ShopTab | 'bag';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

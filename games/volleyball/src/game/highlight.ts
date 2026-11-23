/**
 * 경기 하이라이트 집계 (순수 모듈): 가장 길었던 랠리 · 가장 높았던 가속 단계 · 자리별 터치(공을 친) 수.
 * 계산(sim)은 건드리지 않고, step() 뒤의 상태(rallyTicks · stage)와 그 틱에 생긴 일(SimEvent)만 읽어 모은다.
 *
 * 온라인: 방장 기기가 모은 값이 기준이다. 방장이 스냅샷·'경기 끝' 알림에 함께 실어 보내고(packHighlight),
 * 상대 기기는 그 값을 그대로 쓴다 — 상대 기기의 계산은 미리 보여 주는 것이라 틱 단위로는 방장과 다를 수 있어서.
 */
import { RALLY_MAX_STAGE, TICK_RATE } from './constants';
import type { Side, SimEvent, SimState } from './sim';

export interface Highlight {
  /** 가장 길었던 랠리 (틱. 서브부터 공이 바닥에 닿을 때까지) */
  longest: number;
  /** 가장 높았던 랠리 가속 단계 0~5 */
  maxStage: number;
  /** 공을 친 횟수 [왼쪽, 오른쪽] */
  touches: [number, number];
}

export const newHighlight = (): Highlight => ({ longest: 0, maxStage: 0, touches: [0, 0] });
export const copyHighlight = (h: Readonly<Highlight>): Highlight => ({ longest: h.longest, maxStage: h.maxStage, touches: [h.touches[0], h.touches[1]] });

/**
 * step() 한 번 뒤에 부른다. s: 그 뒤의 상태, events: 알림 목록, from: 이번 틱의 알림이 시작되는 자리.
 * (득점한 틱에도 rallyTicks 는 그 랠리의 길이로 남아 있고, 다음 서브 때 0이 된다)
 */
export function tally(h: Highlight, s: Readonly<Pick<SimState, 'rallyTicks' | 'stage'>>, events?: readonly { t: string; side?: Side }[], from = 0): Highlight {
  if (s.rallyTicks > h.longest) h.longest = s.rallyTicks;
  if (s.stage > h.maxStage) h.maxStage = s.stage;
  if (events)
    for (let i = from; i < events.length; i++) {
      const e = events[i] as SimEvent;
      if (e.t === 'hit') h.touches[e.side]++;
    }
  return h;
}

/** 통신용: [최장 랠리 틱, 최고 단계, 왼쪽 터치, 오른쪽 터치] */
export type HighlightPack = [number, number, number, number];
export const packHighlight = (h: Readonly<Highlight>): HighlightPack => [h.longest, h.maxStage, h.touches[0], h.touches[1]];

/** 받은 값을 검사해 되돌린다. 모양·범위가 이상하면 null (버린다) */
export function unpackHighlight(v: unknown): Highlight | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v as unknown[];
  const count = (x: unknown, max: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;
  // 한 경기는 35분을 넘지 않는다 (net/start.ts MATCH_MAX_MS)
  const maxTicks = TICK_RATE * 60 * 40;
  if (!count(n[0], maxTicks) || !count(n[1], RALLY_MAX_STAGE) || !count(n[2], maxTicks) || !count(n[3], maxTicks)) return null;
  return { longest: n[0], maxStage: n[1], touches: [n[2], n[3]] };
}

/** 결과 화면에 쓸 글 */
export interface HighlightView {
  /** 최장 랠리 (예: '12.3초') */
  rally: string;
  /** 최고 가속 (예: '+20%', 한 번도 빨라지지 않았으면 '없음') */
  speed: string;
  /** 내 터치 수 (예: '14번') */
  touches: string;
}

export function highlightView(h: Readonly<Highlight>, mySide: Side): HighlightView {
  return {
    rally: `${(h.longest / TICK_RATE).toFixed(1)}초`,
    speed: h.maxStage > 0 ? `+${h.maxStage * 10}%` : '없음',
    touches: `${h.touches[mySide]}번`,
  };
}

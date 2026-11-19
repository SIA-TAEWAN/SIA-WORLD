import { TICK } from '../data/balance';
import type { BossDef } from '../data/bosses';
import { EV, emit, type Enemy, type State } from './state';

/**
 * 보스의 특수 행동 표 (data/bosses.ts 의 act). 보스가 살아 있는 동안 걸음마다 한 번 불린다.
 * 보스의 이동·체력·경고·출구 처리는 일반 요괴와 같은 계산(sim.ts)이 하고, 여기서는 그 보스만의 행동만 한다:
 * 속도 배율(e.mul)을 바꾸거나, 졸개를 부르거나(core.ts 의 spawnEnemy), 캐릭터를 방해한다. e.a · e.b · e.c 를 자유롭게 쓴다.
 * 행동의 단계가 바뀌면 EV.bossAct 를 내서 화면이 연출한다.
 */
export type BossAct = (s: State, e: Enemy, def: BossDef) => void;

/** 큰 도깨비의 돌진 단계 (e.b) */
export const DASH = { walk: 0, windup: 1, dash: 2 } as const;

export const BOSS_ACTS: Record<string, BossAct> = {
  /** 돌진: every 초마다 warn 초 동안 멈춰 벼른 뒤 dur 초 동안 mul 배 빠르게 달린다. e.a = 단계에 남은 시간, e.b = 단계 */
  dash(s, e, def) {
    const p = def.p;
    if (e.t <= TICK) {
      e.a = p.every;
      e.b = DASH.walk;
    }
    // 멈춰 있는 동안(소의 방울)에는 돌진 시계도 멈춘다
    if (e.stun > 0) return;
    e.a -= TICK;
    if (e.a > 0) return;
    if (e.b === DASH.walk) {
      e.b = DASH.windup;
      e.a = p.warn;
      e.mul = 0;
    } else if (e.b === DASH.windup) {
      e.b = DASH.dash;
      e.a = p.dur;
      e.mul = p.mul;
    } else {
      e.b = DASH.walk;
      e.a = p.every;
      e.mul = 1;
    }
    emit(s, EV.bossAct, e.boss, e.b, e.x, e.y);
  },
};

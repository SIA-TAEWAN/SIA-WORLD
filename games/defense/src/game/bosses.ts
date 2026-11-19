import { TICK } from '../data/balance';
import type { BossDef } from '../data/bosses';
import { placeOnRoute, spawnEnemy } from './core';
import { EV, FX, addFx, emit, type Enemy, type State } from './state';

/**
 * 보스의 특수 행동 표 (data/bosses.ts 의 act). 보스가 살아 있는 동안 걸음마다 한 번 불린다.
 * 보스의 이동·체력·경고·출구 처리는 일반 요괴와 같은 계산(sim.ts)이 하고, 여기서는 그 보스만의 행동만 한다:
 * 속도 배율(e.mul)·받는 피해(e.armor)·사라짐(e.gone)을 바꾸거나, 졸개를 부르거나(spawnEnemy), 캐릭터를 방해한다(tower.off · mark).
 * e.a · e.b · e.c 를 자유롭게 쓴다. 행동의 단계가 바뀌면 EV.bossAct 를 내서 화면이 연출한다.
 */
export type BossAct = (s: State, e: Enemy, def: BossDef) => void;

/** 큰 도깨비의 돌진 단계 (e.b) */
export const DASH = { walk: 0, windup: 1, dash: 2 } as const;
/** EV.bossAct 의 b: 화면이 무슨 일인지 아는 번호 (돌진은 DASH 값 그대로) */
export const ACT = { summon: 10, vanish: 11, appear: 12, clone: 13, segment: 14, freeze: 15, geyser: 16, mark: 17, fire: 18, raise: 19 } as const;

/** 이 보스가 처음 불렸나 (나온 첫 걸음) */
const first = (e: Enemy) => e.t <= TICK;

/** 졸개·분신·마디를 보스 곁에 내보낸다 (보스와 같은 길의 d 지점) */
function minion(s: State, _e: Enemy, kind: number, route: number, d: number, hpMul: number): Enemy | null {
  const m = spawnEnemy(s, kind, -1, route, hpMul, d);
  if (m) addFx(s, FX.puff, m.x, m.y, 30, 0.3);
  return m;
}

export const BOSS_ACTS: Record<string, BossAct> = {
  /** 돌진: every 초마다 warn 초 동안 멈춰 벼른 뒤 dur 초 동안 mul 배 빠르게 달린다. e.a = 단계에 남은 시간, e.b = 단계 */
  dash(s, e, def) {
    const p = def.p;
    if (first(e)) {
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

  /** 소환: every 초마다 졸개를 count 마리 부른다 (보스 바로 뒤에서 나온다) */
  summon(s, e, def) {
    const p = def.p;
    if (first(e)) e.a = p.every * 0.5;
    e.a -= TICK;
    if (e.a > 0) return;
    e.a = p.every;
    for (let k = 0; k < p.count; k++) minion(s, e, p.kind, e.route, Math.max(0, e.d - 24 - k * 26), s.stage.hp * p.hp);
    emit(s, EV.bossAct, e.boss, ACT.summon, e.x, e.y);
  },

  /** 단단해짐: 나온 뒤 시간이 갈수록 받는 피해가 줄어든다 */
  harden(_s, e, def) {
    e.armor = Math.min(def.p.max, def.p.rate * e.t);
  },

  /** 사라짐: every 초마다 gone 초 동안 사라졌다가 jump 만큼 앞에서 다시 나타난다. e.b = 0 걷는 중 / 1 사라진 중 */
  blink(s, e, def) {
    const p = def.p;
    if (first(e)) e.a = p.every;
    e.a -= TICK;
    if (e.b === 1) e.gone = Math.max(TICK, e.a);
    if (e.a > 0) return;
    if (e.b === 0) {
      e.b = 1;
      e.a = p.gone;
      e.gone = p.gone;
      e.mul = 0;
      e.stun = 0;
      addFx(s, FX.puff, e.x, e.y, 60, 0.4);
      emit(s, EV.bossAct, e.boss, ACT.vanish, e.x, e.y);
    } else {
      e.b = 0;
      e.a = p.every;
      e.gone = 0;
      e.mul = 1;
      e.d = Math.min(s.routes[e.route].len - 1, e.d + p.jump);
      placeOnRoute(s, e);
      addFx(s, FX.puff, e.x, e.y, 60, 0.4);
      emit(s, EV.bossAct, e.boss, ACT.appear, e.x, e.y);
    }
  },

  /** 마디: 머리 뒤로 마디가 줄지어 따라온다. 마디가 남아 있는 동안 머리는 다치지 않는다. 마디의 e.c = 머리의 uid */
  segments(s, e, def) {
    const p = def.p;
    if (first(e)) {
      const k = e.maxHp / def.hp;
      for (let i = 1; i <= p.segs; i++) {
        const m = spawnEnemy(s, 0, -1, e.route, 1, e.d - i * p.gap);
        if (!m) break;
        m.look = e.boss;
        m.c = e.uid;
        m.hp = m.maxHp = Math.round(p.segHp * k);
        m.speed = e.speed;
        m.r = 22;
        m.bounty = 12 * s.gain;
      }
      emit(s, EV.bossAct, e.boss, ACT.segment, e.x, e.y);
    }
    let left = 0;
    for (let i = 0; i < s.enemyHi; i++) if (s.enemies[i].alive && s.enemies[i].look === e.boss && s.enemies[i].c === e.uid) left++;
    e.armor = left > 0 ? 1 : 0;
    e.a = left;
  },

  /** 분신: 체력이 3/4 · 2/4 · 1/4 아래로 내려갈 때마다 길마다 분신 하나 (길이 하나뿐이면 그 길에). e.a = 만든 횟수 */
  clones(s, e, def) {
    const p = def.p;
    if (e.a >= 3 || e.hp / e.maxHp > 1 - 0.25 * (e.a + 1)) return;
    e.a++;
    const frac = e.d / s.routes[e.route].len;
    const others = s.ground.filter((r) => r !== e.route);
    for (const r of others.length ? others : [e.route]) {
      const m = minion(s, e, 0, r, Math.max(0, frac * s.routes[r].len - (others.length ? 0 : 40)), 1);
      if (!m) break;
      m.look = e.boss;
      m.hp = m.maxHp = Math.round(e.maxHp * p.hp);
      m.speed = e.speed * 1.15;
      m.r = 24;
      m.leak = p.leak;
      m.bounty = 15 * s.gain;
    }
    emit(s, EV.bossAct, e.boss, ACT.clone, e.x, e.y);
  },
};

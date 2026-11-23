import { TILE } from '../src/data/balance';
import type { EnemyKind } from '../src/data/enemies';
import { defaultLoadout, type Loadout } from '../src/data/growth';
import type { HeroId } from '../src/data/heroes';
import type { GroupDef, MapDef } from '../src/data/maps';
import type { Mode } from '../src/data/regions';
import type { WeaponKind } from '../src/data/weapons';
import { STEP, createRun, noInput, step, type Enemy, type Input, type RunOpts, type RunState } from '../src/game/sim';

/** 시험용 빈 방: 16×14칸, 시작은 아래 가운데(8, 11), 출구는 위(8, 1), 상자는 왼쪽 위 구석(1, 1) */
export function arena(over: Partial<MapDef> = {}): MapDef {
  const rows = ['################', ...Array.from({ length: 12 }, () => '#..............#'), '################'];
  return { id: '1-1', region: 1, no: 1, name: '시험', rows, start: [8, 11], exit: [8, 1], chest: [1, 1], groups: [], par: 60, ...over };
}

/** 칸 → 맵 좌표 */
export const at = (c: number) => (c + 0.5) * TILE;

export const group = (x: number, y: number, kind: EnemyKind = 'imp', n = 1, elite?: EnemyKind): GroupDef => ({ at: [x, y], list: n ? [[kind, n]] : [], ...(elite ? { elite } : {}) });

export const lo = (hero: HeroId = 'ox', weapon: WeaponKind = 'sword', level = 1): Loadout => defaultLoadout(hero, level, weapon, 0);

export function run(map: MapDef, o: { hero?: HeroId; weapon?: WeaponKind; level?: number; mode?: Mode } & RunOpts = {}): RunState {
  return createRun(map, o.mode ?? 'normal', lo(o.hero, o.weapon, o.level), o);
}

/** sec 초 동안 같은 입력으로 진행 (눌렀다 떼는 버튼은 첫 간격에만) */
export function play(s: RunState, sec: number, inp: Partial<Input> = {}) {
  const base = { ...noInput(), ...inp };
  const n = Math.round(sec / STEP);
  for (let i = 0; i < n; i++) {
    step(s, i === 0 ? base : { ...base, skill: [false, false], unique: false, roll: false, potion: [false, false] });
  }
}

/** 요괴를 대원 앞(위쪽) dist 거리로 옮기고 깨운다 */
export function place(s: RunState, e: Enemy, dx: number, dy: number, awake = true) {
  e.x = s.p.x + dx;
  e.y = s.p.y + dy;
  e.awake = awake;
  return e;
}

export const alive = (s: RunState) => s.enemies.filter((e) => !e.dead);

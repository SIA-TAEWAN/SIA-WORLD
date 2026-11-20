import { HEROES, MAX_TURNS, type FoeInit, type HeroId, type HeroInit, type RunConfig, type Seg } from '../src/sim';

/** 테스트용 대원 (레벨 1 능력치) */
export function hero(id: HeroId, over: Partial<HeroInit> = {}): HeroInit {
  const d = HEROES[id];
  return { id, type: d.type, hp: d.hp, atk: d.atk, combo: d.combo, comboTier: 1, special: d.special, chargeMax: d.charge, charge0: 0, healMul: 1, ...over };
}

/** 테스트용 요괴 */
export function foe(x: number, y: number, over: Partial<FoeInit> = {}): FoeInit {
  return { kind: 'imp', name: '꼬마 도깨비', art: 'e-imp', rank: 0, x, y, r: 34, hp: 90, atk: 14, cd: 3, pattern: ['near'], area: 0, weak: null, drop: null, ...over };
}

export function box(w = 640, h = 960): Seg[] {
  return [
    [0, 0, w, 0],
    [w, 0, w, h],
    [w, h, 0, h],
    [0, h, 0, 0],
  ];
}

/** 빈 방 설정 */
export function cfgOf(party: HeroInit[], waves: FoeInit[][], over: Partial<RunConfig> = {}): RunConfig {
  return { v: 1, stage: 'test', mode: 'normal', w: 640, h: 960, walls: box(), party, waves, par: 10, maxTurns: MAX_TURNS, ...over };
}

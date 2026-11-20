import { choose, type PilotOptions } from '../src/game/autopilot';
import { HEROES, MAX_TURNS, STEP, beginShot, endTurn, stepShot, type FoeInit, type HeroId, type HeroInit, type RunConfig, type RunState, type Seg } from '../src/sim';

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

/**
 * 브라우저(GameScene)와 같은 방식으로 한 판을 둔다: 자동 플레이어가 고른 조작으로 beginShot →
 * 화면 프레임마다 쌓인 시간만큼 stepShot 을 한 스텝씩 (fast 인 턴은 2배속) → 멈추면 endTurn.
 * 끝나면(또는 maxTurns 턴을 두면) 판 상태를 돌려준다. s.log 가 서버로 보내는 조작 목록이다.
 */
export function playLikeBrowser(
  s: RunState,
  opts: { pilot?: PilotOptions; fast?: (turn: number) => boolean; maxTurns?: number; frameMs?: number } = {},
): RunState {
  const frame = (opts.frameMs ?? 1000 / 60) / 1000;
  while (s.phase === 'aim' && s.turn < (opts.maxTurns ?? Infinity)) {
    beginShot(s, choose(s, opts.pilot));
    const mul = opts.fast?.(s.turn) ? 2 : 1;
    let acc = 0;
    const flying = () => s.phase === 'shot';
    while (flying()) {
      acc = Math.min(acc + frame * mul, 0.25 * mul);
      while (acc >= STEP && flying()) {
        acc -= STEP;
        stepShot(s);
      }
    }
    endTurn(s);
  }
  return s;
}

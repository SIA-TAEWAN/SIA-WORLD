import { BOSS_IDS, BOSSES, ENEMIES, chiefDef, type FoeDef } from './enemies.ts';
import { HEROES, heroStats, isHeroId, type HeroId, type Upgrades } from './heroes.ts';
import { MAX_TURNS, type FoeInit, type HeroInit, type RunConfig, type Seg } from './sim.ts';
import { ROOM_H, ROOM_W, stageOf, type FoeSpec, type StageDef } from './stages.ts';

/**
 * 판 설정 만들기. 화면과 서버(finger-finish)가 같은 입력(스테이지 · 파티 · 레벨 · 강화)으로 같은 RunConfig 를 만든다.
 * 서버는 DB 에 남은 레벨·강화를 넣는다 (4단계).
 */

export interface BuildInput {
  stage: string;
  mode?: 'normal';
  /** 쏘는 순서대로 대원 id 1~4명 (중복 없음) */
  party: string[];
  /** 대원별 레벨 (없으면 1) */
  levels?: Partial<Record<HeroId, number>>;
  upgrades?: Upgrades;
}

export class ConfigError extends Error {}

/** 파티 확인: 1~4명, 중복 없음, 있는 대원 */
export function checkParty(party: unknown): HeroId[] {
  if (!Array.isArray(party) || party.length < 1 || party.length > 4) throw new ConfigError('party');
  const ids: HeroId[] = [];
  for (const id of party) {
    if (!isHeroId(id) || ids.includes(id)) throw new ConfigError('party');
    ids.push(id);
  }
  return ids;
}

/** 방 테두리 4개 + 돌기둥(네모) 선분 */
function wallsOf(st: StageDef): Seg[] {
  const w = ROOM_W;
  const h = ROOM_H;
  const out: Seg[] = [
    [0, 0, w, 0],
    [w, 0, w, h],
    [w, h, 0, h],
    [0, h, 0, 0],
  ];
  for (const [x, y, bw, bh] of st.blocks ?? []) {
    out.push([x, y, x + bw, y], [x + bw, y, x + bw, y + bh], [x + bw, y + bh, x, y + bh], [x, y + bh, x, y]);
  }
  return out;
}

function foeOf(st: StageDef, f: FoeSpec): FoeInit {
  let def: FoeDef;
  let kind: string;
  let rank: 0 | 1 | 2 = 0;
  if (f.k === 'boss') {
    kind = BOSS_IDS[(st.region - 1) % BOSS_IDS.length];
    def = BOSSES[kind as (typeof BOSS_IDS)[number]];
    rank = 2;
  } else if (f.k === 'chief') {
    def = chiefDef(st.region);
    kind = 'chief';
    rank = 1;
  } else {
    def = ENEMIES[f.k];
    kind = f.k;
  }
  const hpMul = st.hpMul ?? 1;
  const atkMul = st.atkMul ?? 1;
  return {
    kind,
    name: def.name,
    art: def.art,
    rank,
    x: f.x,
    y: f.y,
    r: def.r,
    hp: Math.round(def.hp * hpMul),
    atk: Math.round(def.atk * atkMul),
    cd: def.cd,
    pattern: [...def.pattern],
    area: def.area ?? 0,
    weak: def.weak ?? null,
    drop: f.drop ?? (rank > 0 ? 'coin' : null),
  };
}

export function buildConfig(input: BuildInput): RunConfig {
  const st = stageOf(input.stage);
  if (!st) throw new ConfigError('stage');
  const ids = checkParty(input.party);
  const party: HeroInit[] = ids.map((id) => {
    const d = HEROES[id];
    const st8 = heroStats(id, input.levels?.[id], input.upgrades ?? {});
    return {
      id,
      type: d.type,
      hp: st8.hp,
      atk: st8.atk,
      combo: d.combo,
      comboTier: st8.comboTier,
      special: d.special,
      chargeMax: d.charge,
      charge0: st8.charge0,
      healMul: st8.healMul,
    };
  });
  return {
    v: 1,
    stage: st.id,
    mode: 'normal',
    w: ROOM_W,
    h: ROOM_H,
    walls: wallsOf(st),
    party,
    waves: st.waves.map((w) => w.map((f) => foeOf(st, f))),
    par: st.par,
    maxTurns: MAX_TURNS,
  };
}

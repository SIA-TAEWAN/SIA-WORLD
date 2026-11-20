import { BOSS_IDS, BOSSES, ENEMIES, chiefDef, type FoeDef, type FoeTraits } from './enemies.ts';
import { HEROES, heroStats, isHeroId, type HeroId, type Upgrades } from './heroes.ts';
import { MAX_TURNS, TOWER_TURNS, type FoeInit, type HeroInit, type Pillar, type Portal, type Room, type RunConfig, type Seg } from './sim.ts';
import { ROOM_H, ROOM_W, stageOf, type FoeSpec, type StageDef } from './stages.ts';
import { TOWER_FLOORS, towerFloor } from './tower.ts';

/**
 * 판 설정 만들기. 화면과 서버(finger-finish)가 같은 입력(스테이지 · 파티 · 레벨 · 강화)으로 같은 RunConfig 를 만든다.
 * 서버는 DB 에 남은 레벨·강화를 넣는다 (4단계).
 */

export interface BuildInput {
  /** 스테이지 id (끝없는 탑은 'tower') */
  stage: string;
  mode?: 'normal' | 'tower';
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

/** 요괴 정의 → 판 설정 (스테이지 배율 반영) */
function initOf(st: StageDef, def: FoeDef, kind: string, rank: 0 | 1 | 2, x: number, y: number, drop: FoeInit['drop']): FoeInit {
  const hpMul = st.hpMul ?? 1;
  const atkMul = st.atkMul ?? 1;
  const out: FoeInit = {
    kind,
    name: def.name,
    art: def.art,
    rank,
    x,
    y,
    r: def.r,
    hp: Math.round(def.hp * hpMul),
    atk: Math.round(def.atk * atkMul),
    cd: def.cd,
    pattern: [...def.pattern],
    area: def.area ?? 0,
    weak: def.weak ?? null,
    drop,
  };
  if (def.traits) out.traits = JSON.parse(JSON.stringify(def.traits)) as FoeTraits;
  const sm = def.traits?.summon;
  if (sm) out.summon = initOf(st, ENEMIES[sm.kind], sm.kind, 0, 0, 0, null);
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
  return initOf(st, def, kind, rank, f.x, f.y, f.drop ?? (rank > 0 ? 'coin' : null));
}

export function buildConfig(input: BuildInput): RunConfig {
  if (input.mode === 'tower') return buildTowerConfig(input);
  const st = stageOf(input.stage);
  if (!st) throw new ConfigError('stage');
  return buildConfigFrom(st, input);
}

/** 파티 → 판에 들어가는 대원 (레벨·강화 반영) */
function partyOf(input: Omit<BuildInput, 'stage'>): HeroInit[] {
  return checkParty(input.party).map((id) => {
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
}

/** 스테이지의 방 모양 */
function roomOfStage(st: StageDef): Room {
  return {
    walls: wallsOf(st),
    pillars: (st.pillars ?? []).map((p) => [...p] as Pillar),
    zones: (st.zones ?? []).map((z) => ({ ...z })),
    portals: (st.portals ?? []).map((p) => [...p] as Portal),
    region: st.region,
  };
}

/** 스테이지 데이터로 바로 (밸런스 보정 스크립트가 만든 스테이지를 시험할 때) */
export function buildConfigFrom(st: StageDef, input: Omit<BuildInput, 'stage'>): RunConfig {
  const party = partyOf(input);
  const room = roomOfStage(st);
  return {
    v: 1,
    stage: st.id,
    mode: 'normal',
    w: ROOM_W,
    h: ROOM_H,
    walls: room.walls,
    pillars: room.pillars,
    zones: room.zones,
    portals: room.portals,
    party,
    waves: st.waves.map((w) => w.map((f) => foeOf(st, f))),
    par: st.par,
    maxTurns: MAX_TURNS,
  };
}

/**
 * 끝없는 탑 (tower.ts): 층 1~TOWER_FLOORS 를 웨이브로 미리 만든다. 층마다 가져온 스테이지의 방을 쓴다 (rooms · waveRoom).
 * 별 기준 턴은 없고(0), 최대 턴은 TOWER_TURNS.
 */
export function buildTowerConfig(input: Omit<BuildInput, 'stage'>): RunConfig {
  const party = partyOf(input);
  const rooms: Room[] = [];
  const roomIx = new Map<string, number>();
  const waveRoom: number[] = [];
  const waves: FoeInit[][] = [];
  for (let n = 1; n <= TOWER_FLOORS; n++) {
    const tf = towerFloor(n);
    const src = stageOf(tf.stage)!;
    let ix = roomIx.get(src.id);
    if (ix === undefined) {
      ix = rooms.length;
      rooms.push(roomOfStage(src));
      roomIx.set(src.id, ix);
    }
    waveRoom.push(ix);
    const st: StageDef = { ...src, hpMul: tf.hpMul, atkMul: tf.atkMul };
    waves.push(src.waves[tf.wave].map((f) => foeOf(st, f)));
  }
  const r0 = rooms[waveRoom[0]];
  return {
    v: 1,
    stage: 'tower',
    mode: 'tower',
    w: ROOM_W,
    h: ROOM_H,
    walls: r0.walls,
    pillars: r0.pillars,
    zones: r0.zones,
    portals: r0.portals,
    party,
    waves,
    par: 0,
    maxTurns: TOWER_TURNS,
    rooms,
    waveRoom,
  };
}

import { BOSSES, BOSS_IDS, ENEMIES, PORTAL_R, ROOM_W, chiefDef, type EnemyKind, type FoeDef, type FoeSpec, type HeroType, type Pillar, type Portal, type StageDef, type Zone } from '../sim';
import { atkMulOf } from './balance';

/**
 * 2~12지역 55스테이지 만들기 (디펜스 scripts/gen-stages.ts 방식): 지역·번호로 늘 같은 판 모양이 나온다 (씨앗 고정).
 * scripts/gen-stages.ts 가 이 결과에 보정 값(src/data/calib.ts: 요괴 체력 배율 · 별 기준 턴)을 붙여
 * supabase/functions/_shared/finger/stages-gen.ts 에 '데이터'로 적는다. 서버(finger-finish)는 그 파일만 읽는다.
 *  · 웨이브 3개: 1·2번째는 지역 요괴, 3번째는 작은 대장(1~4번째) 또는 지역 보스(5번째) + 졸개
 *  · 장애물: 지역이 올라갈수록 늘어난다 — 돌기둥(2지역~) · 가시밭(3지역~) · 빨래판(4지역~) · 순간이동 구멍(5지역~)
 *  · 요괴: 돌격대와 같은 지역 요괴 묶음 (지역마다 새 요괴)
 */

/** 지역마다 나오는 요괴 (돌격대 REGION_ENEMIES 와 같다. 마지막이 그 지역의 새 요괴) */
export const REGION_ENEMIES: EnemyKind[][] = [
  ['imp', 'wisp', 'club'],
  ['imp', 'wisp', 'club'],
  ['imp', 'club', 'water'],
  ['imp', 'wisp', 'fox', 'water'],
  ['imp', 'bamboo', 'fox', 'club'],
  ['wisp', 'water', 'fox', 'bamboo', 'club'],
  ['imp', 'guard', 'fox', 'club'],
  ['guard', 'wisp', 'water', 'bamboo'],
  ['fox', 'guard', 'wisp', 'club'],
  ['skeleton', 'imp', 'fox', 'guard'],
  ['spirit', 'skeleton', 'wisp', 'water'],
  ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'],
];

/** 스테이지 이름 (2~12지역 × 5) */
const NAMES: Record<number, string[]> = {
  2: ['논두렁 길', '허수아비 밭', '물레방아', '돌담 고랑', '두억시니'],
  3: ['고갯마루', '산짐승 길', '바위 비탈', '안개 숲', '불가살'],
  4: ['달빛 언덕', '방아 찧는 터', '옥토끼 샘', '구름 다리', '장산범'],
  5: ['연꽃 못', '물안개 둑', '용궁 입구', '여의주 바위', '왕지네'],
  6: ['갈대 늪', '가시덤불', '진흙 웅덩이', '뱀굴 앞', '구미호'],
  7: ['성문 앞길', '말발굽 마당', '망루 아래', '빗장 문', '수문장 대장'],
  8: ['양떼 뜰', '빨래터', '솜구름 마당', '울타리 길', '야광귀'],
  9: ['누각 계단', '나무 사다리', '구름 처마', '현판 아래', '이무기'],
  10: ['새벽 들길', '닭장 고개', '횃대 다리', '해돋이 언덕', '저승사자'],
  11: ['삼도천 나루', '저승 갈대밭', '건넛 둑', '뱃사공 길', '강철이'],
  12: ['염라전 문', '업경대', '저승 곳간', '심판 마당', '염라대왕'],
};

/** 씨앗 고정 난수 (만들 때만 쓴다 — 판 안에는 무작위가 없다) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ob = { t: 'block'; v: [number, number, number, number] } | { t: 'pillar'; v: Pillar } | { t: 'zone'; v: Zone } | { t: 'portal'; v: Portal };

/** 지역 장애물 수와 종류 (지역이 올라갈수록 늘어남) */
function obstacleKinds(region: number, no: number, r: () => number): Ob['t'][] {
  const kinds: ('block' | 'pillar' | 'thorn' | 'board')[] = ['block', 'pillar'];
  if (region >= 3) kinds.push('thorn');
  if (region >= 4) kinds.push('board');
  // 지역 특징: 뱀의 늪·삼도천 = 가시밭, 말의 성문 = 네모 돌기둥, 원숭이의 누각 = 둥근 기둥, 양의 뜰 = 빨래판
  const fav: Record<number, (typeof kinds)[number]> = { 6: 'thorn', 7: 'block', 8: 'board', 9: 'pillar', 11: 'thorn' };
  const n = Math.min(6, 1 + Math.floor((region - 1) / 2) + (no % 2));
  const out: Ob['t'][] = [];
  for (let i = 0; i < n; i++) {
    const k = fav[region] && r() < 0.4 ? fav[region] : kinds[Math.floor(r() * kinds.length)];
    out.push(k === 'thorn' || k === 'board' ? 'zone' : k);
  }
  return out;
}

const DEFS = (k: EnemyKind) => ENEMIES[k];

interface Placed {
  x: number;
  y: number;
  r: number;
}

/** 원이 장애물과 겹치나 (여유 pad) */
function hitsObstacle(x: number, y: number, rad: number, obs: Ob[], pad: number): boolean {
  for (const o of obs) {
    if (o.t === 'pillar') {
      const rr = rad + o.v[2] + pad;
      if ((x - o.v[0]) ** 2 + (y - o.v[1]) ** 2 < rr * rr) return true;
    } else if (o.t === 'portal') {
      for (const [px, py] of [
        [o.v[0], o.v[1]],
        [o.v[2], o.v[3]],
      ]) {
        const rr = rad + PORTAL_R + pad;
        if ((x - px) ** 2 + (y - py) ** 2 < rr * rr) return true;
      }
    } else {
      const [bx, by, bw, bh] = o.t === 'block' ? o.v : [o.v.x, o.v.y, o.v.w, o.v.h];
      const cx = Math.max(bx, Math.min(bx + bw, x));
      const cy = Math.max(by, Math.min(by + bh, y));
      if ((x - cx) ** 2 + (y - cy) ** 2 < (rad + pad) ** 2) return true;
    }
  }
  return false;
}

/** 장애물 놓기 (요괴와 대원 출발 줄 사이 띠: y 330~780) */
function placeObstacles(region: number, no: number, r: () => number): Ob[] {
  const obs: Ob[] = [];
  // 순간이동 구멍: 5지역부터 짝수 번호·보스 스테이지 (용의 연못·삼도천은 늘). 아래 한쪽 → 위 반대쪽 (보스 등 뒤를 노리는 길)
  if (region >= 5 && (no % 2 === 0 || no === 5 || region === 5 || region === 11)) {
    const left = r() < 0.5;
    const ax = left ? 90 + Math.round(r() * 40) : ROOM_W - 90 - Math.round(r() * 40);
    const ay = 690 + Math.round(r() * 60);
    const bx = ROOM_W - ax;
    const by = 80 + Math.round(r() * 30);
    obs.push({ t: 'portal', v: [ax, ay, bx, by] });
  }
  const kinds = obstacleKinds(region, no, r);
  let zoneN = 0;
  for (const k of kinds) {
    for (let tries = 0; tries < 60; tries++) {
      let o: Ob;
      if (k === 'pillar') {
        const pr = 26 + Math.round(r() * 16);
        o = { t: 'pillar', v: [80 + Math.round(r() * 480), 360 + Math.round(r() * 380), pr] };
      } else if (k === 'block') {
        const horiz = r() < 0.7;
        const bw = horiz ? 70 + Math.round(r() * 60) : 34 + Math.round(r() * 10);
        const bh = horiz ? 34 + Math.round(r() * 10) : 70 + Math.round(r() * 50);
        o = { t: 'block', v: [60 + Math.round(r() * (520 - bw)), 360 + Math.round(r() * (380 - bh)), bw, bh] };
      } else {
        const thorn = region < 4 ? true : region >= 3 && (zoneN % 2 === 0 ? r() < 0.6 : r() < 0.4);
        const zw = thorn ? 130 + Math.round(r() * 80) : 100 + Math.round(r() * 60);
        const zh = thorn ? 60 + Math.round(r() * 40) : 50 + Math.round(r() * 30);
        o = { t: 'zone', v: { k: thorn && region >= 3 ? 'thorn' : 'board', x: 40 + Math.round(r() * (560 - zw)), y: 340 + Math.round(r() * (440 - zh)), w: zw, h: zh } };
      }
      // 서로 겹치지 않게, 대원 출발 줄(y 880 ± 30)과 떨어지게
      const c = o.t === 'pillar' ? { x: o.v[0], y: o.v[1], rad: o.v[2] } : o.t === 'block' ? { x: o.v[0] + o.v[2] / 2, y: o.v[1] + o.v[3] / 2, rad: Math.max(o.v[2], o.v[3]) / 2 } : o.t === 'zone' ? { x: o.v.x + o.v.w / 2, y: o.v.y + o.v.h / 2, rad: Math.max(o.v.w, o.v.h) / 2 } : null;
      if (!c) continue;
      if (hitsObstacle(c.x, c.y, c.rad, obs, o.t === 'zone' ? 10 : 50)) continue;
      obs.push(o);
      if (o.t === 'zone') zoneN++;
      break;
    }
  }
  return obs;
}

/** 요괴 자리 고르기: 위쪽(y 110~560), 서로 · 장애물과 떨어지게 */
function placeFoes(defs: { def: FoeDef; spec: Omit<FoeSpec, 'x' | 'y'> }[], obs: Ob[], r: () => number, fixed: Placed[] = []): FoeSpec[] {
  const placed: Placed[] = [...fixed];
  const out: FoeSpec[] = [];
  for (const { def, spec } of defs) {
    let best: { x: number; y: number } | null = null;
    for (let tries = 0; tries < 200 && !best; tries++) {
      const x = def.r + 40 + Math.round(r() * (ROOM_W - 2 * def.r - 80));
      const y = 110 + def.r * 0.5 + Math.round(r() * (450 - def.r));
      if (placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (p.r + def.r + 36) ** 2)) continue;
      if (hitsObstacle(x, y, def.r, obs, 24)) continue;
      best = { x, y };
    }
    if (!best) continue;
    placed.push({ ...best, r: def.r });
    out.push({ ...spec, ...best });
  }
  return out;
}

/** 지역 요괴 하나 고르기 (새 요괴가 조금 더 자주, 한 웨이브에 같은 요괴는 둘까지) */
function pickKind(pool: EnemyKind[], r: () => number, wave: EnemyKind[]): EnemyKind {
  for (let i = 0; i < 8; i++) {
    const k = r() < 0.25 ? pool[pool.length - 1] : pool[Math.floor(r() * pool.length)];
    if (wave.filter((w) => w === k).length < 2) return k;
  }
  return pool.find((k) => wave.filter((w) => w === k).length < 2) ?? pool[0];
}

/** 웨이브 하나의 요괴 n 마리 (첫 마리가 heal 이면 회복 구슬) */
function waveKinds(pool: EnemyKind[], r: () => number, n: number, heal: boolean): { def: FoeDef; spec: Omit<FoeSpec, 'x' | 'y'> }[] {
  const kinds: EnemyKind[] = [];
  for (let i = 0; i < n; i++) kinds.push(pickKind(pool, r, kinds));
  return kinds.map((k, i) => ({ def: DEFS(k), spec: { k, ...(heal && i === 0 ? { drop: 'heal' as const } : {}) } }));
}

/** 판 모양만 (체력 배율 · 별 기준 턴은 보정 값) */
export interface Layout {
  id: string;
  region: number;
  no: number;
  name: string;
  waves: FoeSpec[][];
  blocks: [number, number, number, number][];
  pillars: Pillar[];
  zones: Zone[];
  portals: Portal[];
  tip: HeroType;
}

export function layoutOf(region: number, no: number): Layout {
  const r = rng(region * 7919 + no * 131);
  const pool = REGION_ENEMIES[region - 1];
  const obs = placeObstacles(region, no, r);
  const size = (w: number) => Math.min(5, 2 + Math.floor((region + no) / 6) + w + (r() < 0.3 ? 1 : 0));
  const waves: FoeSpec[][] = [];
  for (let w = 0; w < 2; w++) {
    waves.push(placeFoes(waveKinds(pool, r, size(w), w === 1), obs, r));
  }
  // 마지막 웨이브: 작은 대장 · 지역 보스는 위 가운데, 졸개는 그 아래 양옆
  const boss = no === 5;
  const big = boss ? BOSSES[BOSS_IDS[region - 1]] : chiefDef(region);
  const bx = 320 + Math.round((r() - 0.5) * 80);
  const by = boss ? 250 : 220;
  const head: FoeSpec = { k: boss ? 'boss' : 'chief', x: bx, y: by };
  const escorts = Math.min(3, 1 + Math.floor(region / 5) + (boss ? 0 : 1));
  waves.push([head, ...placeFoes(waveKinds(pool, r, escorts, true), obs, r, [{ x: bx, y: by, r: big.r + 20 }])]);

  const pillars = obs.filter((o): o is Extract<Ob, { t: 'pillar' }> => o.t === 'pillar').map((o) => o.v);
  const blocks = obs.filter((o): o is Extract<Ob, { t: 'block' }> => o.t === 'block').map((o) => o.v);
  const zones = obs.filter((o): o is Extract<Ob, { t: 'zone' }> => o.t === 'zone').map((o) => o.v);
  const portals = obs.filter((o): o is Extract<Ob, { t: 'portal' }> => o.t === 'portal').map((o) => o.v);
  return { id: `${region}-${no}`, region, no, name: NAMES[region][no - 1], waves, blocks, pillars, zones, portals, tip: tipOf(waves, blocks.length + pillars.length, boss) };
}

/**
 * 추천 타입: 방패·숨기·되살아남이 많거나 보스 약점(등 뒤)을 노려야 하면 반사형(벽·기둥으로 돌아 들어가기),
 * 요괴가 많이 몰려 있으면 관통형(한 번에 여럿 뚫기)
 */
function tipOf(waves: FoeSpec[][], walls: number, boss: boolean): HeroType {
  let reflect = (boss ? 1.5 : 0) + walls * 0.8;
  let pierce = 0;
  for (const w of waves) {
    pierce += Math.max(0, w.length - 3) * 0.8;
    for (const f of w) {
      const t = f.k === 'boss' || f.k === 'chief' ? undefined : ENEMIES[f.k].traits;
      if (t?.shield) reflect += 1;
      if (t?.hide) reflect += 0.5;
      if (t?.split || t?.revive) pierce += 0.8;
      if (f.k === 'club') pierce += 0.4;
    }
  }
  return reflect >= pierce ? 'reflect' : 'pierce';
}

/** 보정 값 */
export interface Calib {
  /** 요괴 체력 배율 */
  hp: number;
  /** 별 기준 턴 */
  par: number;
  /** 요괴 공격 배율 (없으면 지역 식 atkMulOf) */
  atk?: number;
}

/** 보정 값이 없을 때 처음 짐작 (지역마다 체력 배율이 커진다) */
export const guessCalib = (region: number): Calib => ({ hp: Math.round((1 + 0.22 * (region - 1)) * 100) / 100, par: 20 });

/** 판 모양 + 보정 값 → 스테이지 데이터 */
export function stageFrom(l: Layout, c: Calib): StageDef {
  const st: StageDef = { id: l.id, region: l.region, no: l.no, name: l.name, par: c.par, tip: l.tip, hpMul: c.hp, atkMul: c.atk ?? atkMulOf(l.region), waves: l.waves };
  if (l.blocks.length) st.blocks = l.blocks;
  if (l.pillars.length) st.pillars = l.pillars;
  if (l.zones.length) st.zones = l.zones;
  if (l.portals.length) st.portals = l.portals;
  return st;
}

export const GEN_REGIONS = Array.from({ length: 11 }, (_, i) => i + 2);

/** 2~12지역 모든 판 모양 */
export const allLayouts = (): Layout[] => GEN_REGIONS.flatMap((region) => [1, 2, 3, 4, 5].map((no) => layoutOf(region, no)));

/** 생성 파일 내용 (scripts/gen-stages.ts 가 쓰고, tests/stagegen.test.ts 가 최신인지 확인한다) */
export function generatedSource(calib: Record<string, Calib>): string {
  const rows = allLayouts().map((l) => `  ${JSON.stringify(stageFrom(l, calib[l.id] ?? guessCalib(l.region)))},`);
  return [
    '// games/finger/scripts/gen-stages.ts 로 만든 파일 (손으로 고치지 않는다: npm run gen · 밸런스 보정은 npm run calib)',
    "import type { StageDef } from './stages.ts';",
    '',
    '/** 2~12지역 55스테이지 (판 모양: games/finger/src/data/stagegen.ts · 보정 값: games/finger/src/data/calib.ts) */',
    'export const GENERATED: StageDef[] = [',
    ...rows,
    '];',
    '',
  ].join('\n');
}

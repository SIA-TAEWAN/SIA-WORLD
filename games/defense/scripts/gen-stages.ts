/**
 * 스테이지 데이터를 만드는 도구 (2~12지역). 결과는 src/data/stages/rNN.ts 에 '데이터'로 적힌다 — 게임은 그 파일만 읽는다.
 *   node node_modules/vite-node/vite-node.mjs scripts/gen-stages.ts 2 6     → 2~6지역을 다시 만든다
 * 하는 일:
 *   1) 길: 아래 LAYOUTS 에 손으로 적은 모양 (지역의 길 특징 — PRD 6장)
 *   2) 배치 칸: 길 옆 칸 가운데 길이 사거리에 많이 들어오는 순서로 고르되 서로 붙지 않게
 *   3) 웨이브: 지역의 요괴 묶음(POOL)과 웨이브 예산으로 무리를 짠다 (뒤 웨이브일수록 많고, 새 요괴가 자주)
 *   4) 체력 배율: '보통 실력' 정책이 그 지역 번호와 같은 캐릭터 레벨(CAL_LV)로 TARGET 만큼 클리어하도록 맞춘다 (PRD 7장: N지역 = N레벨).
 *      보스 스테이지는 보스 처치율(BOSS_KILL)도 맞춘다. 그다음 두 가지 여유를 둔다 (그 지역 레벨의 클리어율이 FLOOR_CLEAR 를 넘지 않는 만큼만):
 *      · 별 2개: 그 레벨에서 별 2개 이상이 STAR2 보다 드물면 체력을 낮춘다 (다음 지역의 필요 별을 다시 하기 몇 판으로 모으게)
 *      · 별 3개: 12레벨 + 공통 강화 최대에서 별 3개가 PERFECT 보다 드물면 체력을 낮춘다 (모든 별 3개는 그 이후의 목표)
 *      7지역부터는 웨이브 체력 배율을 완만하게(LATE_CURVE) 적는다
 * 만든 뒤에는 파일을 손으로 고쳐도 된다 (다시 만들면 덮어쓴다). 048_defense.sql 의 스테이지 표도 함께 맞춘다 (tests/sql.test.ts).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_H, BOARD_W, COLS, ROAD_W, ROWS, SLOT_SIZE, type CharId } from '../src/data/balance';
import { ROSTER, towerOf } from '../src/data/characters';
import { ENEMY_INDEX } from '../src/data/enemies';
import { presetUpgrades } from '../src/data/growth';
import { REGIONS } from '../src/data/regions';
import type { Cell, GroupDef, RouteDef, StageDef, WaveDef } from '../src/data/stages';
import { buildRoute, cellX, cellY, coverage, distToRoad } from '../src/game/path';
import { SKILLS, pickSquad, simulate, skillPolicy } from '../src/game/policy';
import { makeRng } from '../src/game/rng';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = (id: string, pts: Cell[]): RouteDef => ({ id, pts });
const flipH = (rs: RouteDef[]): RouteDef[] => rs.map((r) => ({ ...r, pts: r.pts.map(([c, y]) => [COLS - 1 - c, y] as Cell) }));
const flipV = (rs: RouteDef[]): RouteDef[] => rs.map((r) => ({ ...r, pts: r.pts.map(([c, y]) => [c, ROWS - 1 - y] as Cell) }));

// ───────────────────────── 1) 길 ─────────────────────────
const LONG: RouteDef[][] = [
  [R('main', [[-1, 0], [7, 0], [7, 2], [1, 2], [1, 4], [7, 4], [7, 6], [1, 6], [1, 8], [9, 8]])],
  [R('main', [[0, -1], [0, 9], [2, 9], [2, 1], [4, 1], [4, 9], [6, 9], [6, 1], [8, 1], [8, 11]])],
  [R('main', [[9, 1], [1, 1], [1, 3], [7, 3], [7, 5], [1, 5], [1, 7], [7, 7], [7, 9], [-1, 9]])],
  [R('main', [[8, -1], [8, 9], [6, 9], [6, 1], [4, 1], [4, 9], [2, 9], [2, 1], [0, 1], [0, 11]])],
  [R('main', [[4, -1], [4, 1], [1, 1], [1, 3], [7, 3], [7, 5], [1, 5], [1, 7], [7, 7], [7, 9], [4, 9], [4, 11]])],
];
const TWO: RouteDef[][] = [
  [R('a', [[-1, 1], [4, 1], [4, 6], [7, 6], [7, 11]]), R('b', [[-1, 8], [2, 8], [2, 6], [4, 6], [7, 6], [7, 11]])],
  [R('a', [[2, -1], [2, 4], [6, 4], [6, 8], [9, 8]]), R('b', [[9, 1], [6, 1], [6, 4], [6, 8], [9, 8]])],
  [R('a', [[-1, 2], [3, 2], [3, 6], [6, 6], [6, 11]]), R('b', [[9, 3], [6, 3], [6, 6], [6, 11]])],
  [R('a', [[1, -1], [1, 5], [4, 5], [4, 9], [9, 9]]), R('b', [[7, -1], [7, 5], [4, 5], [4, 9], [9, 9]])],
  [R('a', [[-1, 1], [3, 1], [3, 5], [5, 5], [5, 9], [9, 9]]), R('b', [[9, 1], [7, 1], [7, 5], [5, 5], [5, 9], [9, 9]])],
];
const THREE: RouteDef[][] = [
  [R('a', [[1, -1], [1, 5], [4, 5], [4, 11]]), R('b', [[7, -1], [7, 5], [4, 5], [4, 11]]), R('c', [[4, -1], [4, 5], [4, 11]])],
  [R('a', [[-1, 1], [5, 1], [5, 6], [9, 6]]), R('b', [[-1, 6], [5, 6], [9, 6]]), R('c', [[2, 11], [2, 9], [5, 9], [5, 6], [9, 6]])],
  [R('a', [[-1, 2], [3, 2], [3, 7], [6, 7], [6, 11]]), R('b', [[9, 2], [6, 2], [6, 7], [6, 11]]), R('c', [[-1, 9], [3, 9], [3, 7], [6, 7], [6, 11]])],
  [R('a', [[9, 1], [3, 1], [3, 6], [-1, 6]]), R('b', [[9, 6], [3, 6], [-1, 6]]), R('c', [[6, 11], [6, 9], [3, 9], [3, 6], [-1, 6]])],
  [R('a', [[0, -1], [0, 4], [4, 4], [4, 8], [9, 8]]), R('b', [[4, -1], [4, 4], [4, 8], [9, 8]]), R('c', [[8, -1], [8, 4], [4, 4], [4, 8], [9, 8]])],
];
const LAYOUTS: Record<number, RouteDef[][]> = {
  // 2 소의 논밭: 길이 길고 굽이가 많음
  2: LONG,
  // 3 호랑이 고개: 길이 짧고 배치 칸이 많음
  3: [
    [R('main', [[-1, 3], [4, 3], [4, 7], [9, 7]])],
    [R('main', [[4, -1], [4, 4], [7, 4], [7, 11]])],
    [R('main', [[-1, 8], [3, 8], [3, 3], [9, 3]])],
    [R('main', [[2, -1], [2, 5], [6, 5], [6, 11]])],
    [R('main', [[-1, 2], [5, 2], [5, 8], [9, 8]])],
  ],
  // 4 토끼의 달동산: 길이 둘로 갈라졌다 합쳐짐
  4: [
    [R('a', [[4, -1], [4, 2], [1, 2], [1, 7], [4, 7], [4, 11]]), R('b', [[4, -1], [4, 2], [7, 2], [7, 7], [4, 7], [4, 11]])],
    [R('a', [[-1, 5], [2, 5], [2, 2], [6, 2], [6, 5], [9, 5]]), R('b', [[-1, 5], [2, 5], [2, 8], [6, 8], [6, 5], [9, 5]])],
    [R('a', [[4, -1], [4, 1], [1, 1], [1, 5], [4, 5], [4, 8], [7, 8], [7, 11]]), R('b', [[4, -1], [4, 1], [7, 1], [7, 5], [4, 5], [4, 8], [7, 8], [7, 11]])],
    [R('a', [[-1, 1], [2, 1], [2, 4], [6, 4], [6, 9], [9, 9]]), R('b', [[-1, 1], [2, 1], [2, 9], [6, 9], [9, 9]])],
    [R('a', [[4, -1], [4, 2], [1, 2], [1, 6], [4, 6], [4, 9], [9, 9]]), R('b', [[4, -1], [4, 2], [7, 2], [7, 6], [4, 6], [4, 9], [9, 9]])],
  ],
  // 5 용의 연못: 연못을 빙 도는 길
  5: [
    [R('main', [[-1, 1], [7, 1], [7, 9], [1, 9], [1, 3], [-1, 3]])],
    [R('main', [[9, 1], [1, 1], [1, 9], [7, 9], [7, 3], [9, 3]])],
    [R('main', [[1, -1], [1, 9], [7, 9], [7, 1], [3, 1], [3, -1]])],
    [R('main', [[7, 11], [7, 1], [1, 1], [1, 9], [5, 9], [5, 11]])],
    [R('main', [[-1, 1], [7, 1], [7, 9], [1, 9], [1, 5], [-1, 5]])],
  ],
  // 6 뱀의 늪: 구불구불한 길, 배치 칸이 띄엄띄엄 (보스 구미호의 분신이 나뉘어 오도록 5번째는 길이 둘)
  6: [
    [R('main', [[-1, 1], [3, 1], [3, 4], [6, 4], [6, 1], [8, 1], [8, 7], [4, 7], [4, 9], [-1, 9]])],
    [R('main', [[1, -1], [1, 3], [4, 3], [4, 1], [7, 1], [7, 5], [2, 5], [2, 8], [6, 8], [6, 11]])],
    [R('main', [[9, 1], [6, 1], [6, 4], [2, 4], [2, 1], [0, 1], [0, 7], [4, 7], [4, 9], [9, 9]])],
    [R('main', [[-1, 9], [2, 9], [2, 6], [5, 6], [5, 9], [8, 9], [8, 3], [4, 3], [4, 1], [-1, 1]])],
    [R('a', [[1, -1], [1, 4], [4, 4], [4, 8], [1, 8], [1, 11]]), R('b', [[7, -1], [7, 4], [4, 4], [4, 8], [7, 8], [7, 11]])],
  ],
  // 7 말의 성문: 입구 2곳
  7: TWO,
  // 8 양의 뜰: 입구 2곳, 배치 칸이 적음
  8: TWO.map(flipH),
  // 9 원숭이의 누각: 길이 여러 번 교차
  9: [
    [R('main', [[-1, 4], [6, 4], [6, 8], [3, 8], [3, 1], [9, 1]])],
    [R('main', [[4, -1], [4, 7], [1, 7], [1, 3], [7, 3], [7, 11]])],
    [R('main', [[-1, 6], [6, 6], [6, 2], [2, 2], [2, 9], [9, 9]])],
    [R('main', [[9, 5], [2, 5], [2, 1], [5, 1], [5, 8], [-1, 8]])],
    [R('main', [[-1, 3], [6, 3], [6, 7], [3, 7], [3, 1], [8, 1], [8, 11]])],
  ],
  // 10 닭의 새벽길: 입구 3곳
  10: THREE,
  // 11 개의 삼도천: 물길로 나뉜 긴 길
  11: LONG.map(flipV),
  // 12 돼지의 염라전: 입구 3곳, 가장 어려움
  12: THREE.map(flipV),
};

/** 배치 칸 수 (지역의 특징: 3지역은 많고 6·8지역은 적다) */
const SLOTS: Record<number, number> = { 2: 13, 3: 16, 4: 13, 5: 13, 6: 9, 7: 13, 8: 9, 9: 13, 10: 14, 11: 13, 12: 14 };
/** 스테이지 이름 */
const NAMES: Record<number, string[]> = {
  2: ['논두렁길', '물꼬 굽이', '모내기 들', '허수아비 길', '두억시니 논'],
  3: ['고갯마루', '바위 틈', '솔밭 지름길', '호랑이 굴 앞', '불가살 고개'],
  4: ['달맞이 갈림길', '계수나무 길', '방아 언덕', '달그림자 숲', '장산범 동산'],
  5: ['연못 둘레길', '연잎 다리', '물안개 둑', '용오름 못', '왕지네 연못'],
  6: ['늪 어귀', '갈대 미로', '진흙 굽이', '안개 늪', '구미호 늪'],
  7: ['성문 밖', '해자 다리', '망루 아래', '쌍문 거리', '수문장 대장의 문'],
  8: ['앞뜰', '돌담 사이', '연못 뜰', '뒤뜰 샛길', '야광귀의 뜰'],
  9: ['누각 계단', '회랑 네거리', '달빛 난간', '겹처마 길', '이무기 누각'],
  10: ['새벽 갈래길', '안개 삼거리', '첫닭 고개', '여명 나루', '저승사자 길목'],
  11: ['삼도천 나루', '징검다리', '물안개 강둑', '망각의 여울', '강철이 강'],
  12: ['염라전 앞뜰', '업경대 길', '세 갈래 저승문', '심판의 뜰', '염라대왕전'],
};
/** 지역 보스 */
const BOSS: Record<number, string> = { 2: 'dueoksini', 3: 'bulgasal', 4: 'jangsanbeom', 5: 'centipede', 6: 'gumiho', 7: 'guardCaptain', 8: 'yagwanggwi', 9: 'imugi', 10: 'reaper', 11: 'gangcheori', 12: 'yeomra' };

// ───────────────────────── 3) 웨이브 ─────────────────────────
/** 지역의 요괴 묶음 (뒤에 적은 것일수록 그 지역에서 새로 나오는 요괴: 더 자주 고른다) */
const POOL: Record<number, string[]> = {
  2: ['imp', 'wisp', 'club'],
  3: ['imp', 'wisp', 'club', 'water'],
  4: ['imp', 'wisp', 'club', 'water', 'fox'],
  5: ['imp', 'wisp', 'water', 'fox', 'bamboo'],
  6: ['imp', 'wisp', 'club', 'water', 'fox', 'bamboo'],
  7: ['imp', 'club', 'water', 'fox', 'guard'],
  8: ['wisp', 'club', 'fox', 'bamboo', 'guard'],
  9: ['imp', 'wisp', 'bamboo', 'guard', 'fox', 'fox'],
  10: ['imp', 'club', 'water', 'guard', 'skeleton'],
  11: ['wisp', 'fox', 'guard', 'skeleton', 'spirit'],
  12: ['club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit'],
};
/** 요괴 한 마리의 무게 (꼬마 도깨비 = 1). 웨이브 예산을 마릿수로 바꿀 때 쓴다 */
const WEIGHT: Record<string, number> = { imp: 1, wisp: 0.6, club: 3.6, water: 2, fox: 1, bamboo: 1.5, guard: 3, skeleton: 2, spirit: 1.5 };

/**
 * 뒤 지역(LATE_FROM~)은 웨이브 체력 배율을 완만하게 (data/balance.ts 의 WAVE_HP 는 마지막 웨이브가 ×1.9 로 크게 뛴다).
 * 마지막 웨이브에 몰려 새는 일이 줄어, 클리어율이 같아도 생명이 덜 줄고(별 2개) 강해지면 하나도 새지 않게(별 3개) 된다
 */
const LATE_FROM = Number(process.env.LATE_FROM ?? 7);
const LATE_CURVE: number[] | null = process.env.LATE_CURVE === 'off' ? null : (process.env.LATE_CURVE ?? '1,1.1,1.2,1.32,1.45,1.62').split(',').map(Number);

function makeWaves(region: number, no: number, routes: number, boss: boolean): WaveDef[] {
  const rng = makeRng(region * 100 + no);
  const pool = POOL[region];
  const waves: WaveDef[] = [];
  for (let w = 0; w < 6; w++) {
    let budget = 9.5 * (1 + 0.24 * w) * (1 + 0.05 * (no - 1));
    // 보스가 나오는 웨이브(2분)는 졸개를 조금 줄인다
    if (boss && w === 4) budget *= 0.7;
    // 첫 웨이브는 한 종류, 그 뒤는 둘, 마지막 두 웨이브는 셋까지
    const kinds = w === 0 ? 1 : w >= 4 && pool.length >= 4 ? 3 : 2;
    const picked: string[] = [];
    while (picked.length < kinds) {
      // 뒤쪽(새 요괴)을 더 자주: 난수를 한쪽으로 기울인다. 첫 웨이브는 묶음의 첫 요괴(쉬운 것)
      const i = w === 0 ? 0 : Math.min(pool.length - 1, Math.floor(Math.sqrt(rng()) * pool.length));
      if (!picked.includes(pool[i])) picked.push(pool[i]);
    }
    const share = kinds === 1 ? [1] : kinds === 2 ? [0.58, 0.42] : [0.45, 0.32, 0.23];
    const groups: GroupDef[] = picked.map((enemy, k) => {
      const count = Math.max(2, Math.round((budget * share[k]) / WEIGHT[enemy]));
      const at = k === 0 ? (w === 0 ? 2 : 0) : Math.round((28 * k) / kinds - 2);
      // 그 웨이브의 30초 안에 끝나도록 간격을 맞춘다
      const gap = Math.max(0.5, Math.min(2.4, Math.floor(((27.5 - at) / count) * 10) / 10));
      const g: GroupDef = { enemy, count, at, gap };
      // 입구가 여럿이면 땅 위 요괴는 길을 번갈아 온다
      if (routes > 1 && enemy !== 'fox') g.route = 'alt';
      return g;
    });
    waves.push(LATE_CURVE && region >= LATE_FROM ? { groups, hp: LATE_CURVE[w] } : { groups });
  }
  return waves;
}

// ───────────────────────── 2) 배치 칸 ─────────────────────────
function pickSlots(routes: RouteDef[], n: number): Cell[] {
  const built = routes.filter((r) => !r.air).map(buildRoute);
  const cand: { c: number; r: number; v: number }[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const d = distToRoad(built, cellX(c), cellY(r));
      if (d < ROAD_W / 2 + SLOT_SIZE / 2 || d > 170) continue;
      cand.push({ c, r, v: coverage(built, cellX(c), cellY(r), 180, BOARD_W, BOARD_H) });
    }
  }
  const out: Cell[] = [];
  while (out.length < n && cand.length) {
    cand.sort((a, b) => b.v - a.v || a.r - b.r || a.c - b.c);
    const best = cand.shift()!;
    out.push([best.c, best.r]);
    // 고른 칸의 이웃은 점수를 깎아 칸이 한곳에 몰리지 않게 한다
    for (const o of cand) {
      const d = Math.max(Math.abs(o.c - best.c), Math.abs(o.r - best.r));
      if (d <= 1) o.v *= 0.55;
      else if (d === 2) o.v *= 0.85;
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

// ───────────────────────── 4) 체력 배율 맞추기 ─────────────────────────
const RUNS = 24;
/**
 * 맞추는 기준 레벨: N지역은 N레벨 (PRD 7장). 다만 11·12지역은 한 레벨 낮게 맞춘다 —
 * 12레벨이 끝이라 N레벨에 딱 맞추면 '12레벨 + 공통 강화 최대'로도 하나도 새지 않게(별 3개) 막을 여유가 없다.
 * (그래서 11·12지역은 N레벨에서 80~90% 클리어된다)
 */
const CAL_LV = (region: number) => (region >= 11 ? region - 1 : region);
/** 그 지역 번호와 같은 캐릭터 레벨의 '보통 실력'이 이만큼 클리어하게 한다 (보스 스테이지는 조금 낮게) */
const TARGET = [0.8, 0.77, 0.74, 0.71, 0.66];

/** 보스 스테이지: 그 지역 레벨의 보통 실력이 보스를 이만큼 잡게 한다 (보스 체력 배율을 맞춘다) */
const BOSS_KILL = 0.45;

function rates(stage: StageDef, region: number): { clear: number; kill: number } {
  const unlocked = ROSTER.filter((c) => c.unlockRegion >= 0 && c.unlockRegion < region && towerOf(c.id)).map((c) => c.id) as CharId[];
  const squad = pickSquad(stage, unlocked);
  const levels = Object.fromEntries(squad.map((c) => [c, CAL_LV(region)]));
  let clears = 0;
  let kills = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = simulate({ seed: 1 + i * 7919, stage: stage.id, squad, levels, upgrades: presetUpgrades(Math.min(4, Math.floor((region - 1) / 2))) }, skillPolicy(31 + i * 104729, SKILLS.normal), 900, stage);
    clears += r.summary.cleared ? 1 : 0;
    kills += r.summary.bossDown ? 1 : 0;
  }
  return { clear: clears / RUNS, kill: kills / RUNS };
}
const clearRate = (stage: StageDef, region: number) => rates(stage, region).clear;

/** 보스 체력 배율: 처치율이 BOSS_KILL 이 되는 값 (체력이 높을수록 처치율이 낮다) */
function calibrateBoss(stage: StageDef, region: number): number {
  let lo = 0.25;
  let hi = 3;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    stage.boss!.hp = mid;
    if (rates(stage, region).kill >= BOSS_KILL) lo = mid;
    else hi = mid;
  }
  return Math.round(lo * 100) / 100;
}

/** 12레벨 + 공통 강화 최대의 보통 실력이 하나도 새지 않게 막는(별 3개) 비율 — 모든 별 3개는 그때의 목표 */
const PERFECT = 0.3;
function perfectRate(stage: StageDef, region: number): number {
  const unlocked = ROSTER.filter((c) => c.unlockRegion >= 0 && c.unlockRegion < region && towerOf(c.id)).map((c) => c.id) as CharId[];
  const squad = pickSquad(stage, unlocked);
  const levels = Object.fromEntries(squad.map((c) => [c, 12]));
  let n = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = simulate({ seed: 3 + i * 7919, stage: stage.id, squad, levels, upgrades: presetUpgrades(5) }, skillPolicy(57 + i * 104729, SKILLS.normal), 900, stage);
    n += r.summary.stars === 3 ? 1 : 0;
  }
  return n / RUNS;
}
/**
 * 별 3개 여유: 12레벨 + 강화 최대로도 별 3개가 PERFECT 보다 드물면 체력을 낮춘다.
 * 다만 그 지역 레벨의 클리어율이 FLOOR_CLEAR 를 넘을 만큼 낮추지는 않는다 (너무 쉬워지지 않게)
 */
const FLOOR_CLEAR = 0.9;
/**
 * 별 2개 여유: 그 지역 레벨에서 클리어한 판의 절반쯤은 생명이 10 넘게 남아야(별 2개) 다음 지역의 필요 별을
 * 다시 하기 몇 판으로 모을 수 있다. 모자라면 체력을 낮추되, 그 지역 레벨의 클리어율이 FLOOR_CLEAR 를 넘을 만큼은 낮추지 않는다
 */
const STAR2 = 0.45;
function star2Rate(stage: StageDef, region: number): number {
  const unlocked = ROSTER.filter((c) => c.unlockRegion >= 0 && c.unlockRegion < region && towerOf(c.id)).map((c) => c.id) as CharId[];
  const squad = pickSquad(stage, unlocked);
  const levels = Object.fromEntries(squad.map((c) => [c, CAL_LV(region)]));
  let n = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = simulate({ seed: 1 + i * 7919, stage: stage.id, squad, levels, upgrades: presetUpgrades(Math.min(4, Math.floor((region - 1) / 2))) }, skillPolicy(31 + i * 104729, SKILLS.normal), 900, stage);
    n += r.summary.stars >= 2 ? 1 : 0;
  }
  return n / RUNS;
}
function roomForStar2(stage: StageDef, region: number, hp: number): number {
  stage.hp = hp;
  if (star2Rate(stage, region) >= STAR2) return hp;
  const floor = calibrate(stage, region, FLOOR_CLEAR);
  let lo = floor;
  let hi = hp;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    stage.hp = mid;
    if (star2Rate(stage, region) >= STAR2) lo = mid;
    else hi = mid;
  }
  stage.hp = hp;
  return Math.round(Math.max(floor, Math.min(hp, lo)) * 100) / 100;
}

function roomForPerfect(stage: StageDef, region: number, hp: number): number {
  stage.hp = hp;
  if (perfectRate(stage, region) >= PERFECT) return hp;
  const floor = calibrate(stage, region, FLOOR_CLEAR);
  let lo = floor;
  let hi = hp;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    stage.hp = mid;
    if (perfectRate(stage, region) >= PERFECT) lo = mid;
    else hi = mid;
  }
  stage.hp = hp;
  return Math.round(Math.max(floor, lo) * 100) / 100;
}

function calibrate(stage: StageDef, region: number, target: number): number {
  let lo = 0.5;
  let hi = 4;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    stage.hp = mid;
    // 체력이 높을수록 클리어율이 낮다: 목표보다 잘 깨면 더 올린다
    if (clearRate(stage, region) >= target) lo = mid;
    else hi = mid;
  }
  return Math.round(lo * 100) / 100;
}

// ───────────────────────── 만들기 ─────────────────────────
const from = Number(process.argv[2]) || 2;
const to = Number(process.argv[3]) || from;
const cell = (c: Cell) => `[${c[0]}, ${c[1]}]`;
for (let region = from; region <= to; region++) {
  const out: string[] = [];
  for (let no = 1; no <= 5; no++) {
    const routes = LAYOUTS[region][no - 1].map((r) => ({ ...r, pts: r.pts.map((p) => [...p] as Cell) }));
    const boss = no === 5;
    const waves = makeWaves(region, no, routes.length, boss);
    for (const w of waves) for (const g of w.groups) if (ENEMY_INDEX[g.enemy] === undefined) throw new Error(`요괴 데이터가 아직 없다: ${g.enemy}`);
    // 공중 요괴가 나오면 공중 직선 경로를 더한다: 출구에서 가장 먼 판 밖 모서리 → 출구
    if (waves.some((w) => w.groups.some((g) => g.enemy === 'fox'))) {
      const end = routes[0].pts[routes[0].pts.length - 1];
      routes.push({ id: 'air', air: true, pts: [[end[0] > 4 ? -1 : 9, end[1] > 5 ? -1 : 11], [end[0], end[1]]] });
    }
    const base = 30 + 10 * region + 5 * (no - 1) + (boss ? 15 : 0);
    const stage: StageDef = {
      id: `${region}-${no}`, region, no, name: NAMES[region][no - 1],
      energy: Math.min(330, 232 + 8 * region + (boss ? 20 : 0)), hp: 1,
      routes, slots: pickSlots(routes, SLOTS[region]), waves,
      // 보스 체력은 지역마다 조금씩만 오른다 (졸개의 체력 배율과 따로: 보스는 잡을 수 있어야 한다)
      ...(boss ? { boss: { id: BOSS[region], hp: Math.round((1 + 0.04 * (region - 1)) * 100) / 100 } } : {}),
      coins: base, firstCoins: base + (boss ? 50 : 20),
    };
    let hp = calibrate(stage, region, TARGET[no - 1]);
    stage.hp = hp;
    if (stage.boss) {
      // 보스 체력을 맞춘 뒤 졸개 체력을 한 번 더 맞춘다 (보스가 지나가면 생명 5가 줄어 클리어율이 달라진다)
      stage.boss.hp = calibrateBoss(stage, region);
      hp = calibrate(stage, region, TARGET[no - 1]);
      stage.hp = hp;
    }
    hp = roomForStar2(stage, region, hp);
    hp = roomForPerfect(stage, region, hp);
    stage.hp = hp;
    const got = rates(stage, region);
    console.log(`${stage.id} ${stage.name}: 체력 ×${hp}${stage.boss ? ` 보스 ×${stage.boss.hp} 처치 ${(got.kill * 100).toFixed(0)}%` : ''} → 클리어율 ${(got.clear * 100).toFixed(0)}% (레벨 ${CAL_LV(region)}) · 별 2개 이상 ${(star2Rate(stage, region) * 100).toFixed(0)}% · 12레벨+강화 최대 별 3개 ${(perfectRate(stage, region) * 100).toFixed(0)}%`);
    out.push(
      `  {\n    id: '${stage.id}', region: ${region}, no: ${no}, name: '${stage.name}', energy: ${stage.energy}, hp: ${hp},\n` +
        `    routes: [\n${routes.map((r) => `      { id: '${r.id}', ${r.air ? 'air: true, ' : ''}pts: [${r.pts.map(cell).join(', ')}] },`).join('\n')}\n    ],\n` +
        `    slots: [${stage.slots.map(cell).join(', ')}],\n` +
        `    waves: [\n${waves.map((w) => `      { ${w.hp !== undefined ? `hp: ${w.hp}, ` : ''}groups: [${w.groups.map((g) => `{ enemy: '${g.enemy}', count: ${g.count}, at: ${g.at}, gap: ${g.gap}${g.route !== undefined ? `, route: '${g.route}'` : ''} }`).join(', ')}] },`).join('\n')}\n    ],\n` +
        (stage.boss ? `    boss: { id: '${stage.boss.id}', hp: ${stage.boss.hp} },\n` : '') +
        `    coins: ${stage.coins}, firstCoins: ${stage.firstCoins},\n  },`,
    );
  }
  const nn = String(region).padStart(2, '0');
  const def = REGIONS[region - 1];
  const file = join(HERE, '..', 'src', 'data', 'stages', `r${nn}.ts`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `import type { StageDef } from '../stages';\n\n/**\n * ${region}지역: ${def.name} (${def.feature} · 보스 ${def.boss}).\n` +
      ` * scripts/gen-stages.ts 가 만든 데이터다 (길은 그 파일의 LAYOUTS, 체력 배율은 캐릭터 ${region}레벨의 보통 실력에 맞춘 값). 손으로 고쳐도 된다.\n */\n` +
      `export const REGION_${nn}: StageDef[] = [\n${out.join('\n')}\n];\n`,
  );
}

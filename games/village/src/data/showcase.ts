import { CONST, GRID_MAX, LAND_SIZES } from './balance';
import { BUILDING, type BuildingType } from './buildings';
import { GOALS } from './goals';
import { MONUMENTS } from './monuments';
import { AFF_NEED, RESIDENT, RESIDENT_IDS } from './residents';
import { newVillage, refresh, type Building, type VillageState } from '../game/rules';

/**
 * 다 자란 마을의 본보기 (관리자 마을 · 테스트 모드의 ?town=showcase).
 * 가장 넓은 땅(20×20)에 모든 건물을 최고 레벨 · 최대 개수로, 장식물 · 주민 선물 · 기념물을 하나도 빠짐없이 놓은 모습이다.
 *
 * 지켜야 할 것 (tests/showcase.test.ts 가 본다):
 *   - 건물 id 는 'show-000' … 처럼 놓인 순서대로 (마을 회관이 show-000). 주민의 일터(building)는 이 id 를 가리킨다
 *   - 모두 다 지어진 상태(done)이고 보관함에 든 것이 없다. 겹치지 않고 땅 안에 있다
 *   - 종류마다 그 마을 레벨에서 가질 수 있는 개수(maxCount)를 꽉 채운다
 *   - 주민 13명(십이지 + 고양이)이 모두 이사 와 있고, 친밀도는 5단계 · 선물은 받은 것으로 · 일터가 있는 주민은 일터에 배치
 *
 * 서버로 보낼 때 (관리자 [전시 마을로 꾸미기] → village_admin_set_state, supabase/migrations/062_village_admin.sql):
 *   - 이 함수가 돌려준 VillageState 를 그대로 jsonb 로 보낸다. 서버가 보는 것은
 *       profile.name(마을 이름 규칙에 맞을 때만) · landStage · goal · resources,
 *       buildings[].id · type · level · x · y · state('stored' 만 보관함, 그 밖은 모두 다 지은 것),
 *       residents[].id · affinity · building · gifted, monuments
 *     레벨은 늘 30, 경험치 0. 시각 · finishAt · jobN · banked · sia · requests · daily 는 무시하고 서버가 정한다
 *   - 건물 id 는 아무 글자여도 되지만 서로 달라야 한다 (서버가 새 uuid 로 바꾸고, 주민의 building 을 그 id 로 이어 준다)
 *   - 마을 회관(hall)은 땅 위에 꼭 하나. 땅 밖이거나 겹치는 건물이 하나라도 있으면 통째로 거절('bad state')
 *   - 건물은 500개까지. 장식물 · 길 · 선물 · 기념물의 level 은 서버가 1 로 둔다
 *   - 주민의 building 은 그 주민의 일터 종류(residents.ts 의 work)인 건물이어야 이어진다 (아니면 쉰다)
 *
 * 마을의 짜임 (위가 북쪽, 마을 어귀는 아래 가운데):
 *   한가운데  마을 회관. 어귀에서 올라오는 큰길(두 칸 너비)이 회관 앞에서 동서로 난 마을 길과 만난다
 *   북쪽      큰길 끝의 십이지 사당 (돌탑 · 십이지 탑 · 누각). 사당으로 가는 길 양쪽은 기념물과 꽃밭이 번갈아 서는 기념 길
 *   북서      숲 가장자리의 벌목장        북동  돌담을 두른 채석장
 *   서쪽      주민 집 열두 채 (골목 양쪽 · 우물 · 장독대 · 개집 · 횃대)
 *   동쪽      쉼터: 정자 · 연못 · 꽃밭 · 평상, 그 아래 놀이 마당 (그네 · 배구 네트 · 깃발)
 *   남서      들녘: 논 여덟 마지기 · 허수아비 · 볏가리 · 솟대, 그 아래 방앗간
 *   남동      장터와 창고, 잔치 마당
 *   어귀      장승 · 솟대 · 망루 · 성문 · 등불. 큰길 양쪽에 돌격대(서) · 핑거(동) 기념물 세 개씩
 *
 * 한 줄이 땅의 한 줄(y), 두 글자가 한 칸(x). '..' 빈 칸 · '==' 길 · '##' 2×2 건물의 나머지 칸.
 */
const MAP = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
  'tr .. tr .. .. .. .. .. tr .. .. tr .. .. .. .. .. .. .. ..', // 0
  '.. LB LB LB .. LB LB md tw SH ## tw mc QR QR .. QR QR QR ..', // 1
  'tr .. .. .. .. .. .. .. .. ## ## .. .. .. .. .. .. .. .. sw', // 2
  'g2 LB LB .. .. LB .. .. m6 == == m7 sw sw sw .. .. QR QR sw', // 3
  'sw sw sw .. == sw sw sw fl == == fl .. .. .. == sw sw sw ..', // 4
  'HS HS HS .. == HS HS .. m8 == == m9 .. tr fl == fl g7 fl tr', // 5
  'g9 .. .. .. == .. .. wl fl == == fl gc pn pn == PV ## .. fl', // 6
  'HS HS .. ga == HS HS HS m0 == == m1 .. fl .. == ## ## .. ..', // 7
  '.. .. .. ln == .. .. .. == == == == .. .. bn == .. ln bn tr', // 8
  '.. HS HS .. == JR JR JR == HL ## == g4 m2 m3 == g8 .. m4 m5', // 9
  'tr .. wl fl == g5 .. tr == ## ## == .. fl .. == .. fl .. ..', // 10
  '.. == == == == == == == == == == == == == == == == == == ..', // 11
  '.. sd .. .. .. sd .. .. ln == == ln .. .. .. == .. .. .. ..', // 12
  'sc PD PD PD PD sc hy hy .. == == .. g6 MK gb == ST ST ST ..', // 13
  'sc PD PD PD PD sc hy g1 ln == == ln .. .. .. == .. g0 .. sw', // 14
  '.. .. .. == == == == == == == == == == == == == ST ST ST sw', // 15
  'hy hy .. .. .. .. mg mh mi == == mj mk ml .. .. .. .. .. ..', // 16
  'hy .. .. ML ML ML ML g3 ma == == mb ln FE ## ln bn me .. tr', // 17
  'tr .. .. .. .. .. .. .. sd == == sd bn ## ## .. mf .. .. ..', // 18
  '.. .. .. .. .. .. .. jg jg == == jg jg .. .. .. .. .. .. ..', // 19
];

const CODES: Record<string, BuildingType> = {
  HL: 'hall', PD: 'paddy', HS: 'house', LB: 'lumber', ST: 'storage', MK: 'market', QR: 'quarry', ML: 'mill', JR: 'jar',
  PV: 'pavilion', FE: 'feast', SH: 'shrine',
  tr: 'tree', hy: 'haystack', fl: 'flower', sc: 'scarecrow', sw: 'stonewall', bn: 'bench', ln: 'lantern', wl: 'well', jg: 'jangseung', sd: 'sotdae', pn: 'pond', tw: 'stonetower',
  '==': 'road',
  // 주민 선물: g0 … gb = 십이지 순서 (쥐 … 돼지), gc = 고양이
  ...Object.fromEntries(RESIDENT_IDS.map((id, i) => [`g${i.toString(16)}`, `gift_${id}`])),
  // 기념물: m0 … m9 · ma … ml = monuments.ts 의 순서 (36진수 한 글자)
  ...Object.fromEntries(MONUMENTS.map((m, i) => [`m${i.toString(36)}`, m.id])),
};

/** 지도에 적힌 것들: 종류와 왼쪽 위 칸 (마을 회관이 맨 앞, 나머지는 위에서 아래 · 왼쪽에서 오른쪽) */
export function showcasePlan(): { type: BuildingType; x: number; y: number }[] {
  const out: { type: BuildingType; x: number; y: number }[] = [];
  MAP.forEach((row, y) => row.split(' ').forEach((code, x) => {
    const type = CODES[code];
    if (type) out.push({ type, x, y });
  }));
  return out.sort((a, b) => Number(b.type === 'hall') - Number(a.type === 'hall'));
}

export function makeShowcase(now: number): VillageState {
  const s = newVillage(now, 'show-000');
  const top = CONST.building_max_level;
  Object.assign(s.profile, { name: '시아마을', level: CONST.max_level, exp: 0, landStage: LAND_SIZES.length - 1, goal: GOALS.length, goalProgress: 0 });
  Object.assign(s.profile.resources, { rice: 9999, wood: 9999, stone: 9999, cake: 999, coin: 99999, special: 99 });
  s.sia = 10000;
  s.buildings = showcasePlan().map(({ type, x, y }, i): Building => {
    const kind = BUILDING[type].kind;
    return { id: `show-${String(i).padStart(3, '0')}`, type, level: kind === 'main' || kind === 'special' ? top : 1, x, y, state: 'done', finishAt: null, startAt: null, collectedAt: now, jobN: 0, banked: 0, accFrom: 0 };
  });
  // 주민: 모두 이사 와서 가장 친하고, 일터가 있는 주민은 그 건물에서 일한다
  s.residents = RESIDENT_IDS.map((id) => {
    const work = RESIDENT[id].work;
    return { id, affinity: AFF_NEED[AFF_NEED.length - 1], building: work === '' ? null : s.buildings.find((b) => b.type === work)!.id, gifted: true };
  });
  s.monuments = MONUMENTS.map((m) => m.id);
  refresh(s, now);
  return s;
}

/** 지도의 크기가 땅과 맞는지 (테스트용) */
export const SHOWCASE_SIZE = { rows: MAP.length, cols: MAP[0].split(' ').length, grid: GRID_MAX };

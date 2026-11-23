/**
 * 최종보스맵 '봉인의 문' (PRD '전체 구조' 3): 열쇠 12개를 모으면 지도 가운데에서 열린다.
 * 손으로 만든 맵이다 (npm run gen 이 만들지 않는다): 들머리 → 열두 길의 요괴가 다시 몰려오는 마루 셋 → 봉인의 문 앞 큰 마당(어둑시니).
 * 서버 표에는 12지형의 9번째 줄('final')로 들어간다 — 권장 레벨은 마지막 맵과 같다 (보통 65 · 어려움 99).
 */
import type { GroupDef, MapDef } from '../maps';
import { FINAL_MAP, FINAL_NO, REGIONS } from '../regions';

/** 왼쪽 벽 l 칸 · 오른쪽 벽 r 칸인 줄 (가로 16칸) */
const row = (l: number, r = l) => '#'.repeat(l) + '.'.repeat(16 - l - r) + '#'.repeat(r);
const rep = (n: number, s: string) => Array<string>(n).fill(s);
/** 기둥 (한 칸짜리 벽) */
const pillars = (line: string, xs: number[]) => [...line].map((c, x) => (xs.includes(x) ? '#' : c)).join('');

const ROWS: string[] = [
  row(16, 0),
  // 0~: 봉인의 문 (출구)
  ...rep(3, row(5)),
  ...rep(3, row(6)),
  // 7~24: 큰 마당 — 봉인 기둥 넷
  ...rep(3, row(1)),
  pillars(row(1), [3, 12]),
  ...rep(10, row(1)),
  pillars(row(1), [3, 12]),
  ...rep(3, row(1)),
  ...rep(5, row(6)),
  // 30~39: 셋째 마루 (10~12지형의 요괴)
  ...rep(10, row(1)),
  ...rep(4, row(6)),
  // 44~53: 둘째 마루 (5~9지형의 요괴)
  ...rep(10, row(1)),
  ...rep(4, row(6)),
  // 58~67: 첫째 마루 (1~4지형의 요괴)
  ...rep(10, row(1)),
  ...rep(4, row(6)),
  // 72~76: 들머리
  ...rep(5, row(4)),
  row(16, 0),
];

const GROUPS: GroupDef[] = [
  { at: [4, 64], list: [['imp', 4], ['wisp', 3]] },
  { at: [11, 64], list: [['fox', 3], ['club', 3]] },
  { at: [7, 60], list: [['lynx', 3], ['shade', 3], ['mud', 2]] },
  { at: [4, 50], list: [['guard', 3], ['catfish', 3]] },
  { at: [11, 50], list: [['toad', 3], ['bomber', 3]], elite: 'yaksha' },
  { at: [7, 46], list: [['sleeper', 3], ['acorn', 3], ['skeleton', 3]] },
  { at: [4, 36], list: [['skeleton', 4], ['ferryman', 2]] },
  { at: [11, 36], list: [['firecart', 3], ['spirit', 3]] },
  { at: [7, 32], list: [['yaksha', 4], ['guard', 3]], elite: 'yaksha' },
];

export const FINAL: MapDef = {
  id: FINAL_MAP,
  region: REGIONS,
  no: FINAL_NO,
  final: true,
  name: '봉인의 문',
  par: 720,
  start: [7, 74],
  exit: [7, 2],
  chest: [1, 44],
  groups: GROUPS,
  boss: [7, 13],
  rows: ROWS,
};

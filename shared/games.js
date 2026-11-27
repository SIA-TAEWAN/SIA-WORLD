// SIA WORLD 게임 목록.
// path, image는 SIA WORLD 최상위 기준 상대 경로.
// open: 기본 오픈 여부. 실제 값은 관리자가 로비에서 바꾼다 (DB app_settings 의 'game_open:<id>', 없으면 이 값).
//   닫힌 게임은 로비에 보이지 않고 주소로 들어와도 막힌다. 관리자는 닫혀 있어도 들어갈 수 있다.
import { supabase } from './supabase.js';

export const GAMES = [
  { id: 'tank', name: '시아탱크', desc: '십이지신과 함께하는 포격 대전',
    path: 'games/tank/', image: 'shared/images/card-tank.png', open: true },
  { id: 'matgo', name: '시아맞고', desc: '십이지신 화투로 즐기는 맞고',
    path: 'games/matgo/', image: 'shared/images/card-matgo.png', open: true },
  { id: 'casino', name: '시아카지노', desc: '세븐포커 · 텍사스 홀덤 · 블랙잭 · 십이지신 룰렛',
    path: 'games/casino/', image: 'shared/images/card-casino.png', open: true },
  { id: 'race', name: '시아레이스', desc: '십이지신 146m 달리기 · 1위 고스트와 대결',
    path: 'games/running/', image: 'shared/images/card-race.png', open: true },
  { id: 'volleyball', name: '시아배구', desc: '십이지신 1:1 배구 · AI 대전',
    path: 'games/volleyball/', image: 'shared/images/card-volleyball.png', open: false },
  { id: 'survival', name: '시아서바이벌', desc: '몰려오는 요괴를 4분 버텨라 · 1인용',
    path: 'games/survival/', image: 'shared/images/card-survival.png', open: false },
  { id: 'defense', name: '시아디펜스', desc: '길목을 지켜 요괴를 막아라 · 십이지 타워 디펜스 · 1인용',
    path: 'games/defense/', image: 'shared/images/card-defense.png', open: false },
  { id: 'village', name: '시아마을', desc: '시간이 지나면 쌓이는 자원으로 마을 키우기 · 십이지 주민 · 1인용',
    path: 'games/village/', image: 'shared/images/card-village.png', open: false },
  { id: 'charge', name: '시아돌격대', desc: '숫자 문으로 대원을 불려 요괴를 뚫어라 · 1인용',
    path: 'games/charge/', image: 'shared/images/card-charge.png', open: false },
  { id: 'finger', name: '시아핑거', desc: '당겼다 놓아 튕겨서 요괴를 부숴라 · 십이지 대원 턴제 RPG · 1인용',
    path: 'games/finger/', image: 'shared/images/card-finger.png', open: false },
  { id: 'twelve', name: '시아열두길', desc: '열두 지형의 요괴를 베고 열쇠를 모아라 · 십이지 액션 RPG · 1인용',
    path: 'games/twelve/', image: 'shared/images/card-twelve.png', open: false },
  { id: 'tower', name: '시아의탑', desc: '소원을 들어주는 구슬을 찾아 100층 탑을 올라라 · 도트 액션 RPG · 1인용',
    path: 'games/tower/', image: 'shared/images/card-tower.png', open: false },
  { id: 'card', name: '시아카드배틀', desc: '십이지 영웅으로 카드 덱을 키우며 요괴를 물리쳐라 · 덱빌딩 로그라이크 · 1인용',
    path: 'games/card/', image: 'shared/images/card-card.png', open: false },
  { id: 'pang', name: '시아팡팡', desc: '아홉 정령을 셋씩 맞춰 터뜨려라 · 3매치 퍼즐 100스테이지 · 1인용',
    path: 'games/pang/', image: 'shared/images/card-pang.png', open: false },
  { id: 'ace', name: '시아에이스', desc: '십이지 비행단으로 요괴 비행단을 막아라 · 세로 슈팅 12스테이지 · 1인용',
    path: 'games/ace/', image: 'shared/images/card-ace.png', open: false },
  { id: 'block', name: '시아블록', desc: '정령 블록을 놓아 줄을 지워라 · 8×8 블록 퍼즐 · 1인용',
    path: 'games/block/', image: 'shared/images/card-block.png', open: false },
];

const KEY = 'game_open:';

/**
 * 게임별 오픈 여부 { tank: true, ... }. DB에 값이 없는 게임은 목록의 기본값.
 * 서버에서 못 읽으면 예외 (부르는 쪽에서 정한다).
 */
export async function loadGameOpen() {
  const { data, error } = await supabase.from('app_settings').select('key,value').like('key', `${KEY}%`);
  if (error) throw error;
  const saved = new Map((data ?? []).map((r) => [String(r.key).slice(KEY.length), r.value]));
  return Object.fromEntries(GAMES.map((g) => [g.id, typeof saved.get(g.id) === 'boolean' ? saved.get(g.id) : g.open]));
}

/** 관리자: 게임 오픈 여부 바꾸기 (관리자가 아니면 서버가 거절한다) */
export async function setGameOpen(id, open) {
  const { error } = await supabase.rpc('set_app_setting', { p_key: KEY + id, p_value: !!open });
  if (error) throw error;
}

/** SIA WORLD 최상위 기준 상대 경로(예: 'games/casino/poker/')가 속한 게임. 게임 페이지가 아니면 null */
export function gameForPath(rel) {
  return GAMES.find((g) => rel.startsWith(g.path)) ?? null;
}

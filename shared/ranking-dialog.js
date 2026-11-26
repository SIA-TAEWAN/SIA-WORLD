// SIA WORLD 랭킹 창 (로비와 시아탱크가 같이 쓴다).
//   탭: 💣 시아탱크(승패) · 🎯 백발백중 · 🪙 카지노 · 💰 맞고 · 🏁 시아레이스(오늘의 도전 · 주간 · 최고 기록) · 🏐 시아배구(승수) · 👹 시아서바이벌(맵별 생존 시간)
//   탭은 관리자가 로비에서 연 게임만 보인다 (shared/games.js 의 game_open). 닫힌 게임 안에서 연 창은 그 게임 탭만 예외
//   등급: 해 상위 10% · 달 30% · 별 60% · 그 외 구름 (shared/rank.js)
//   시아레이스 탭은 [오늘의 도전(처음) · 주간 · 최고 기록]. 최고 기록은 순위 기준, 한 명씩: 1위 해 · 2위 달 · 3위 별 · 4위부터 구름 (RACE_TIERS, raceTierOfPlace).
//   오늘의 도전 · 주간(096_race_weekly.sql: 한국 시간 월~일, 이번 주 최고 기록 순 + 지난주 🥇🥈🥉)은 다른 게임과 같은 비율
//   시아배구는 승수 순위 기준 (시아탱크와 같은 비율). 1승도 없으면 구름
//   시아서바이벌은 맵마다 따로: 생존 시간 → 클리어 → 처치 수 → 먼저 달성한 순. 등급은 그 맵 안의 순위 기준
//   시아서바이벌 무한 모드는 4분 모드와 따로 (모드 전환 줄): 생존 시간 → 처치 수 → 먼저 달성한 순
//   시아마을은 번영도 순 → 먼저 달성한 순. 줄마다 [구경]으로 그 마을에 가 볼 수 있다
//   시아열두길은 레벨 랭킹(레벨 → 경험치 → 먼저 달성한 순)과 끝없는 탑 랭킹(최고 층 → 걸린 시간 → 먼저 달성한 순)이 따로다
//   오늘의 도전(레이스 · 서바이벌 · 돌격대 · 핑거 · 디펜스): 모드 고르기 줄의 "오늘의 도전" → 그날 순위 상위 50명 + 내 순위 (shared/daily.js, 082_daily.sql). ◀ ▶ 로 30일 전까지
// 색은 DESIGN.md / shared/theme.css 값을 그대로 적는다 (시아탱크는 --panel 같은 변수 이름을 다른 뜻으로 써서 변수를 빌려 쓸 수 없다).
import { getRanking, formatAmount, RANKINGS } from './wallet.js';
import { withTiers, tierSvg, tierOfPlace } from './rank.js';
import { supabase } from './supabase.js';
import { GAMES, loadGameOpen } from './games.js';
import { ALL_CHARACTER_IDS } from './characters.js';
import { loadDailyRanking, localDailyDay } from './daily.js';

const STYLE_ID = 'sia-ranking-style';
/** 탭 → 게임 id (shared/games.js). 관리자가 로비에서 연 게임의 탭만 보인다 */
const TAB_GAME = { target: 'tank', volley: 'volleyball' };
const gameOfTab = (tab) => TAB_GAME[tab] ?? tab;
/** 탭 순서 (시아탱크가 먼저) */
const TAB_ORDER = ['tank', 'target', 'casino', 'matgo', 'race', 'volley', 'survival', 'defense', 'village', 'charge', 'finger', 'twelve', 'tower', 'card'];

/**
 * 시아레이스 등급 기준: 역대 최고 기록 순위(race_ranking 의 place). 등급마다 한 명뿐이다.
 * games/running/src/game/ranking.ts 의 tierOfPlace 와 같이 고친다.
 */
export const RACE_TIERS = { gold: 1, silver: 2, bronze: 3 };
export const RACE_TOP = 100;
const RACE_INFO = { label: '🏁 레이스', note: '146m 최고 기록 순 (같은 기록은 먼저 세운 사람이 위)' };
const VOLLEY_INFO = { label: '🏐 배구', note: '경기 승수 순 · AI 대전 포함 (같으면 승률, 그다음 먼저 달성한 사람이 위)' };
export const VOLLEY_TOP = 100;
const SURVIVAL_INFO = { label: '👹 서바이벌', note: '맵별 생존 시간 순 (같으면 클리어한 기록, 그다음 처치 수, 먼저 달성한 사람이 위)' };
export const SURVIVAL_TOP = 100;
/** 시아서바이벌 모드: 4분 모드 · 헬 모드 · 무한 모드의 랭킹은 따로다 (창에는 4분 / 헬 / 무한 순으로 보인다) */
export const SURVIVAL_MODES = [
  { id: 'normal', name: '4분 모드' },
  { id: 'hell', name: '🔥 헬 모드' },
  { id: 'endless', name: '무한 모드' },
];
const SURVIVAL_ENDLESS_NOTE = '무한 모드 · 맵별 생존 시간 순 (같으면 처치 수, 그다음 먼저 달성한 사람이 위)';
const SURVIVAL_HELL_NOTE = '🔥 헬 모드 · 맵별 생존 시간 순 (같으면 클리어한 기록, 그다음 처치 수, 먼저 달성한 사람이 위)';
/** 시아서바이벌 맵 (games/survival/src/data/maps.ts 와 같은 순서·이름) */
export const SURVIVAL_MAPS = [
  { id: 'field', name: '들판' },
  { id: 'bamboo', name: '대나무 숲' },
  { id: 'palace', name: '달빛 궁궐' },
  { id: 'underworld', name: '황천길' },
];
/** 시아디펜스: 스테이지 랭킹과 끝없는 모드 랭킹은 따로다 (PRD 10장) */
const DEFENSE_INFO = { label: '🏯 디펜스', note: '모은 별 순 (같으면 클리어한 스테이지 수, 그다음 먼저 달성한 사람이 위)' };
const DEFENSE_ENDLESS_NOTE = '끝없는 모드 · 도달 웨이브 순 (같으면 먼저 달성한 사람이 위)';
export const DEFENSE_TOP = 100;
export const DEFENSE_MODES = [
  { id: 'stage', name: '스테이지' },
  { id: 'endless', name: '끝없는 모드' },
];
/** 시아돌격대: 스테이지 랭킹(모은 별)과 끝없는 길 랭킹(달린 거리)은 따로다 (games/charge/PRD.md 11장). 고르기 줄은 디펜스와 같이 쓴다 */
const CHARGE_INFO = { label: '⚔️ 돌격대', note: '모은 별 순 (같으면 클리어한 스테이지 수, 그다음 먼저 달성한 사람이 위)' };
const CHARGE_ENDLESS_NOTE = '끝없는 길 · 달린 거리 순 (같으면 먼저 달성한 사람이 위)';
export const CHARGE_MODES = [
  { id: 'stage', name: '스테이지' },
  { id: 'endless', name: '끝없는 길' },
];
/** 시아핑거: 스테이지 랭킹(모은 별)과 끝없는 탑 랭킹(올라간 층)은 따로다 (games/finger/PRD.md "랭킹 2종"). 고르기 줄은 디펜스·돌격대와 같이 쓴다 */
const FINGER_INFO = { label: '👆 핑거', note: '모은 별 순 (같으면 클리어한 스테이지 수, 그다음 먼저 달성한 사람이 위)' };
const FINGER_TOWER_NOTE = '끝없는 탑 · 올라간 층 순 (같으면 쓴 턴이 적은 사람, 그다음 먼저 달성한 사람이 위)';
export const FINGER_MODES = [
  { id: 'stage', name: '스테이지' },
  { id: 'tower', name: '끝없는 탑' },
];
/**
 * 시아열두길: 레벨 랭킹과 끝없는 탑 랭킹은 따로다 (games/twelve/PRD.md '랭킹과 시아코인'). 고르기 줄은 디펜스·돌격대·핑거와 같이 쓴다.
 * 레벨: 한 맵이라도 깬 사람. 끝없는 탑: 한 번이라도 들어가 본 사람 (1층을 못 깼으면 0층)
 */
const TWELVE_INFO = { label: '🗝️ 열두길', note: '레벨 순 (같으면 경험치, 그다음 먼저 달성한 사람이 위)' };
const TWELVE_TOWER_NOTE = '끝없는 탑 · 최고 층 순 (같으면 그 층까지 걸린 시간이 짧은 사람, 그다음 먼저 달성한 사람이 위)';
export const TWELVE_MODES = [
  { id: 'level', name: '레벨' },
  { id: 'tower', name: '끝없는 탑' },
];
/** 시아열두길 지형 이름 (games/twelve/src/data/regions.ts 의 REGION_TABLE 과 같은 순서) */
export const TWELVE_REGIONS = ['쥐의 들판', '소의 논밭', '호랑이 고개', '토끼의 달동산', '용의 연못', '뱀의 늪', '말의 성문', '양의 뜰', '원숭이의 누각', '닭의 새벽길', '개의 삼도천', '돼지의 염라전'];
/** 시아의탑: 오른 최고 층 → 레벨 → 먼저 달성한 순 (104_tower.sql 의 tower_ranking). 1층이라도 깬 사람만 */
const TOWER_INFO = { label: '🗼 시아의탑', note: '오른 최고 층 순 (같으면 레벨이 높은 사람, 그다음 먼저 달성한 사람이 위)' };
/**
 * 시아카드배틀: 오늘의 도전 점수(daily_ranking 'card') · 끝없는 모드 최고 칸(111_card.sql 의 card_endless_ranking) 두 가지.
 * 고르기 줄은 디펜스·돌격대·핑거와 같이 쓰고, 첫 단추를 '끝없는 모드'로 바꿔 쓴다 (두 번째 단추는 숨김). 처음 열리는 것은 오늘의 도전
 */
const CARD_INFO = { label: '🃏 카드배틀', note: '끝없는 모드 · 올라간 최고 칸 순 (같으면 먼저 달성한 사람이 위)' };
export const CARD_MODES = [{ id: 'endless', name: '끝없는 모드' }];
const VILLAGE_INFO = { label: '🏡 마을', note: '번영도 순 (건물 레벨 · 장식물 · 기념물 · 주민 친밀도 · 받은 칭찬. 같으면 먼저 달성한 마을이 위)' };
export const VILLAGE_TOP = 100;
/**
 * 오늘의 도전 (shared/daily.js · 082_daily.sql): 탭 → daily_ranking 의 게임 이름과 순서 설명.
 * 모드 고르기 줄에 '오늘의 도전' 단추가 하나 더 붙는다 (SURVIVAL_MODES 같은 내보낸 목록에는 넣지 않는다 — 게임들이 그대로 쓴다)
 */
const DAILY_MODE = 'daily';
const DAILY_NAME = '오늘의 도전';
const DAILY_TOP = 50;
const DAILY_BACK_DAYS = 30;
const DAILY_TABS = {
  race: { game: 'running', note: '오늘의 트랙 · 빠른 기록 순' },
  survival: { game: 'survival', note: '모두 같은 맵 · 캐릭터 · 생존 시간 순 (같으면 클리어, 처치 수)' },
  charge: { game: 'charge', note: '오늘의 길 · 달린 거리 순' },
  finger: { game: 'finger', note: '오늘의 스테이지 · 깬 판의 턴 수가 적은 순' },
  defense: { game: 'defense', note: '오늘의 고개 · 클리어한 판이 위, 그다음 남은 생명, 처치 수 순' },
  card: { game: 'card', note: '모두 같은 영웅 · 지도 · 점수 = 올라간 칸×10 + 정예×30 + 보스×100 + 남은 체력 (하루 첫 판만)' },
};
/** 레이스 탭의 고르기 줄 첫 단추 (레이스는 원래 모드가 없다) */
const RACE_BEST_NAME = '최고 기록';
/** 레이스 탭의 주간 랭킹 (096_race_weekly.sql: race_weekly_ranking 뷰 · race_weekly_last_top) — 레이스 탭에만 보이는 단추 */
const WEEKLY_MODE = 'weekly';
const WEEKLY_NAME = '주간';
const RACE_WEEKLY_NOTE = '이번 주(월~일) 오늘의 도전 최고 기록 순 (같으면 먼저 세운 사람이 위)';
/** 레이스 탭 고르기 줄의 보이는 순서: 오늘의 도전 · 주간 · 최고 기록 (단추는 DOM 순서 그대로 두고 CSS order 로) */
const RACE_MODE_ORDER = { [DAILY_MODE]: 0, [WEEKLY_MODE]: 1, best: 2 };
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** '2026-11-23' → '11월 23일' */
const dayLabel = (day) => (isDay(day) ? `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일` : '');
/** 'YYYY-MM-DD' 에서 n일 옮긴 날짜 */
const shiftDay = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const num = (v) => Math.max(0, Math.floor(Number(v) || 0));
const tabInfo = (g) => (g === 'race' ? RACE_INFO : g === 'volley' ? VOLLEY_INFO : g === 'survival' ? SURVIVAL_INFO : g === 'defense' ? DEFENSE_INFO : g === 'village' ? VILLAGE_INFO : g === 'charge' ? CHARGE_INFO : g === 'finger' ? FINGER_INFO : g === 'twelve' ? TWELVE_INFO : g === 'tower' ? TOWER_INFO : g === 'card' ? CARD_INFO : RANKINGS[g]);

/** 역대 최고 기록 순위 → 등급 (1위 해 · 2위 달 · 3위 별 · 4위부터와 순위 없음은 구름) */
export function raceTierOfPlace(place) {
  const p = Number(place);
  if (p === RACE_TIERS.gold) return 'gold';
  if (p === RACE_TIERS.silver) return 'silver';
  if (p === RACE_TIERS.bronze) return 'bronze';
  return 'white';
}
/** 'YYYY-MM-DD' 가 속한 주의 월요일 (한국 날짜를 넣는다. 서버 _race_week 와 같은 계산: 월요일 시작) */
export function raceWeekStart(day) {
  if (!isDay(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7; // 월 0 … 일 6
  return new Date(Date.UTC(y, m - 1, d - dow)).toISOString().slice(0, 10);
}
/** 이번 주 남은 날 (오늘 포함): 월요일 7 … 일요일 1 */
export function raceWeekDaysLeft(day) {
  const start = raceWeekStart(day);
  if (!start) return null;
  return 7 - Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}
/** '이번 주 3일 남음' (일요일은 '이번 주 오늘 마감') */
export function raceWeekLeftText(day) {
  const n = raceWeekDaysLeft(day);
  if (n === null) return '';
  return n <= 1 ? '이번 주 오늘 마감' : `이번 주 ${n}일 남음`;
}
/** 기록 표시: 0.01초 단위 (버림) */
export const raceTime = (ms) => {
  const cs = Math.floor(Math.max(0, Number(ms)) / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}초`;
};

/**
 * 시아레이스 랭킹 (race_ranking 뷰: 최고 기록 빠른 순, 동률은 먼저 세운 기록 우선).
 * → { rows: 상위 100명 [{ key, nickname, ms, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getRaceRanking(meId = null) {
  const cols = 'user_id,nickname,best_ms,place,total';
  const { data, error } = await supabase.from('race_ranking').select(cols).order('place', { ascending: true }).limit(RACE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({ key: r.user_id, nickname: r.nickname, ms: Number(r.best_ms), place: Number(r.place) });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= RACE_TOP) {
    const res = await supabase.from('race_ranking').select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아레이스 주간 랭킹 (race_weekly_ranking 뷰: 이번 주 최고 기록 빠른 순, 동률은 먼저 세운 기록 우선).
 * → { rows: 상위 100명 [{ key, nickname, ms, character, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getRaceWeeklyRanking(meId = null) {
  const cols = 'user_id,nickname,best_ms,character,place,total';
  const { data, error } = await supabase.from('race_weekly_ranking').select(cols).order('place', { ascending: true }).limit(RACE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({ key: r.user_id, nickname: r.nickname, ms: Number(r.best_ms), character: r.character, place: Number(r.place) });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= RACE_TOP) {
    const res = await supabase.from('race_weekly_ranking').select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/** 지난주 1~3등 (race_weekly_last_top) → { today, top: [{ place, nickname, ms, character }] }. 못 읽으면 null */
export async function getRaceWeeklyLastTop() {
  try {
    const { data, error } = await supabase.rpc('race_weekly_last_top');
    if (error || !data || typeof data !== 'object') return null;
    const top = (Array.isArray(data.top) ? data.top : [])
      .map((t) => ({ place: Number(t.place), nickname: t.nickname, ms: Number(t.best_ms), character: t.character }))
      .filter((t) => t.place >= 1 && t.place <= 3);
    return { today: isDay(data.today) ? data.today : null, top };
  } catch {
    return null;
  }
}
/** 승률 표시: 승 ÷ (승 + 패), 소수점 없이 */
export const volleyRate = (wins, losses) => (wins + losses > 0 ? `${Math.round((wins / (wins + losses)) * 100)}%` : '-');
// 십이지 12 + 고양이
const ZODIAC = ALL_CHARACTER_IDS;
/** 캐릭터 얼굴 그림 (shared/images/zodiac/face) */
const faceUrl = (id) => new URL(`images/zodiac/face/${ZODIAC.includes(id) ? id : 'tiger'}.png`, import.meta.url).href;

/**
 * 시아배구 랭킹 (volleyball_ranking 뷰: 승수 → 승률 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, wins, losses, character, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getVolleyRanking(meId = null) {
  const cols = 'user_id,nickname,wins,losses,last_character,place,total';
  const { data, error } = await supabase.from('volleyball_ranking').select(cols).order('place', { ascending: true }).limit(VOLLEY_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({ key: r.user_id, nickname: r.nickname, wins: Number(r.wins), losses: Number(r.losses), character: r.last_character, place: Number(r.place) });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= VOLLEY_TOP) {
    const res = await supabase.from('volleyball_ranking').select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/** 생존 시간 표시: 초 → 0:00 */
export const survivalTime = (sec) => {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
/** 달성 날짜 표시: 2026.11.18 */
const dateText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 시아서바이벌 랭킹 (survival_ranking 뷰: 맵별로 생존 시간 → 클리어 → 처치 수 → 먼저 달성한 순).
 * mode 가 'endless' 면 무한 모드 랭킹 (survival_endless_ranking 뷰: 생존 시간 → 처치 수 → 먼저 달성한 순. 칸은 같다),
 * 'hell' 이면 헬 모드 랭킹 (survival_hell_ranking 뷰: 4분 모드와 같은 순서. 칸은 같다)
 * → { rows: 상위 100명 [{ key, nickname, time, kills, cleared, character, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getSurvivalRanking(mapId, meId = null, mode = 'normal') {
  const cols = 'user_id,nickname,best_time,best_kills,cleared,character,achieved_at,place,total';
  const view = () =>
    mode === 'endless' ? supabase.from('survival_endless_ranking') : mode === 'hell' ? supabase.from('survival_hell_ranking') : supabase.from('survival_ranking');
  const { data, error } = await view().select(cols).eq('map_id', mapId).order('place', { ascending: true }).limit(SURVIVAL_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({
    key: r.user_id, nickname: r.nickname, time: Number(r.best_time), kills: Number(r.best_kills), cleared: r.cleared === true,
    character: r.character, at: r.achieved_at, place: Number(r.place),
  });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= SURVIVAL_TOP) {
    const res = await view().select(cols).eq('map_id', mapId).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아디펜스 랭킹. mode 'stage': defense_stage_ranking 뷰 (모은 별 → 클리어 수 → 먼저 달성한 순),
 * 'endless': defense_endless_ranking 뷰 (도달 웨이브 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, stars, cleared, best, wave, characters, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getDefenseRanking(mode = 'stage', meId = null) {
  const endless = mode === 'endless';
  const cols = endless ? 'user_id,nickname,best_wave,characters,achieved_at,place,total' : 'user_id,nickname,total_stars,cleared_stages,best_stage,achieved_at,place,total';
  const view = () => supabase.from(endless ? 'defense_endless_ranking' : 'defense_stage_ranking');
  const { data, error } = await view().select(cols).order('place', { ascending: true }).limit(DEFENSE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({
    key: r.user_id, nickname: r.nickname, stars: Number(r.total_stars ?? 0), cleared: Number(r.cleared_stages ?? 0), best: r.best_stage ?? '',
    wave: Number(r.best_wave ?? 0), characters: Array.isArray(r.characters) ? r.characters : [], at: r.achieved_at, place: Number(r.place),
  });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= DEFENSE_TOP) {
    const res = await view().select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아돌격대 랭킹. mode 'stage': charge_stage_ranking 뷰 (모은 별 → 클리어 수 → 먼저 달성한 순),
 * 'endless': charge_endless_ranking 뷰 (달린 거리 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, stars, cleared, best, meters, leader, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getChargeRanking(mode = 'stage', meId = null) {
  const endless = mode === 'endless';
  const cols = endless ? 'user_id,nickname,best_meters,leader,achieved_at,place,total' : 'user_id,nickname,total_stars,cleared_stages,best_stage,achieved_at,place,total';
  const view = () => supabase.from(endless ? 'charge_endless_ranking' : 'charge_stage_ranking');
  const { data, error } = await view().select(cols).order('place', { ascending: true }).limit(DEFENSE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({
    key: r.user_id, nickname: r.nickname, stars: Number(r.total_stars ?? 0), cleared: Number(r.cleared_stages ?? 0), best: r.best_stage ?? '',
    meters: Number(r.best_meters ?? 0), leader: r.leader ?? '', at: r.achieved_at, place: Number(r.place),
  });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= DEFENSE_TOP) {
    const res = await view().select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아핑거 랭킹. mode 'stage': finger_stage_ranking 뷰 (모은 별 → 클리어 수 → 먼저 달성한 순),
 * 'tower': finger_tower_ranking 뷰 (올라간 층 → 쓴 턴 적은 순 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, stars, cleared, best, floor, turns, party, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getFingerRanking(mode = 'stage', meId = null) {
  const tower = mode === 'tower';
  const cols = tower ? 'user_id,nickname,best_floor,turns,party,achieved_at,place,total' : 'user_id,nickname,total_stars,cleared_stages,best_stage,achieved_at,place,total';
  const view = () => supabase.from(tower ? 'finger_tower_ranking' : 'finger_stage_ranking');
  const { data, error } = await view().select(cols).order('place', { ascending: true }).limit(DEFENSE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({
    key: r.user_id, nickname: r.nickname, stars: Number(r.total_stars ?? 0), cleared: Number(r.cleared_stages ?? 0), best: r.best_stage ?? '',
    floor: Number(r.best_floor ?? 0), turns: Number(r.turns ?? 0), party: Array.isArray(r.party) ? r.party : [], at: r.achieved_at, place: Number(r.place),
  });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= DEFENSE_TOP) {
    const res = await view().select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아열두길 랭킹. mode 'level': twelve_level_ranking 뷰 (레벨 → 경험치 → 먼저 달성한 순. Lv99 는 먼저 도달한 사람이 위),
 * 'tower': twelve_tower_ranking 뷰 (최고 층 → 그 층까지 걸린 시간 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, level, exp, mode, hero, region, hardDone, floor, time, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getTwelveRanking(mode = 'level', meId = null) {
  const tower = mode === 'tower';
  const cols = tower ? 'user_id,nickname,best_floor,best_time,level,hero,achieved_at,place,total' : 'user_id,nickname,level,exp,mode,hero,region,hard_done,achieved_at,place,total';
  const view = () => supabase.from(tower ? 'twelve_tower_ranking' : 'twelve_level_ranking');
  const { data, error } = await view().select(cols).order('place', { ascending: true }).limit(DEFENSE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({
    key: r.user_id, nickname: r.nickname, level: Number(r.level ?? 1), exp: Number(r.exp ?? 0), mode: r.mode === 'hard' ? 'hard' : 'normal', hero: r.hero ?? 'rat',
    region: Number(r.region ?? 1), hardDone: !!r.hard_done, floor: Number(r.best_floor ?? 0), time: Number(r.best_time ?? 0), at: r.achieved_at, place: Number(r.place),
  });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= DEFENSE_TOP) {
    const res = await view().select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아의탑 랭킹 (tower_ranking 뷰: 최고 층 → 레벨 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, floor, level, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getTowerRanking(meId = null) {
  const cols = 'user_id,nickname,best_floor,level,achieved_at,place,total';
  const view = () => supabase.from('tower_ranking');
  const { data, error } = await view().select(cols).order('place', { ascending: true }).limit(DEFENSE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({ key: r.user_id, nickname: r.nickname, floor: Number(r.best_floor ?? 0), level: Number(r.level ?? 1), at: r.achieved_at, place: Number(r.place) });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= DEFENSE_TOP) {
    const res = await view().select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/**
 * 시아카드배틀 끝없는 모드 랭킹 (card_endless_ranking 뷰: 최고 칸 → 먼저 달성한 순).
 * → { rows: 상위 100명 [{ key, nickname, floors, acts, hero, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getCardEndlessRanking(meId = null) {
  const cols = 'user_id,nickname,best_floors,acts,hero,achieved_at,place,total';
  const view = () => supabase.from('card_endless_ranking');
  const { data, error } = await view().select(cols).order('place', { ascending: true }).limit(DEFENSE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({ key: r.user_id, nickname: r.nickname, floors: Number(r.best_floors ?? 0), acts: Number(r.acts ?? 0), hero: r.hero ?? 'tiger', at: r.achieved_at, place: Number(r.place) });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= DEFENSE_TOP) {
    const res = await view().select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
/** 걸린 시간 표시 (초 → 3:05 · 1:02:03) */
export const twelveTime = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};
/** 시아마을 주소 (구경: ?visit=<사용자 id>) */
const villageUrl = (userId) => `${new URL('../games/village/', import.meta.url).href}?visit=${encodeURIComponent(userId)}`;

/**
 * 시아마을 랭킹 (village_ranking 뷰: 번영도 높은 순 → 먼저 달성한 순).
 * → { rows: 상위 100곳 [{ key, nickname, name, level, prosperity, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getVillageRanking(meId = null) {
  const cols = 'user_id,nickname,village_name,level,prosperity,place,total';
  const { data, error } = await supabase.from('village_ranking').select(cols).order('place', { ascending: true }).limit(VILLAGE_TOP);
  if (error) throw new Error('랭킹을 불러오지 못했어요');
  const map = (r) => ({ key: r.user_id, nickname: r.nickname, name: r.village_name || `${r.nickname}네 마을`, level: Number(r.level), prosperity: Number(r.prosperity), place: Number(r.place) });
  const rows = (data ?? []).map(map);
  let mine = meId ? (rows.find((r) => r.key === meId) ?? null) : null;
  let total = Number(data?.[0]?.total ?? 0);
  if (meId && !mine && rows.length >= VILLAGE_TOP) {
    const res = await supabase.from('village_ranking').select(cols).eq('user_id', meId).maybeSingle();
    if (res.data) {
      mine = map(res.data);
      total = Number(res.data.total);
    }
  }
  return { rows, mine, total };
}
const CSS = `
.sia-rank-dim { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr); box-sizing: border-box;
  background: rgba(42, 26, 16, 0.55); font-family: 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif; }
/* 높이는 vh 대신 덮개(화면에 꼭 맞는 fixed 판)의 칸 높이로: 안드로이드 설치 앱은 vh 를 실제보다 크게 잡아 창이 잘렸다 */
.sia-rank { box-sizing: border-box; width: min(460px, 100%); max-height: 100%; display: flex; flex-direction: column;
  background: #fff8e8; color: #2a1a10; border: 4px solid #2a1a10; border-radius: 28px;
  box-shadow: 0 8px 0 #2a1a10; padding: 16px; }
.sia-rank * { box-sizing: border-box; }
.sia-rank .rh { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.sia-rank .rh h3 { margin: 0; font-size: 22px; font-weight: normal; }
.sia-rank .rh button { font: inherit; font-size: 15px; cursor: pointer; color: #2a1a10; background: #fff;
  border: 3px solid #2a1a10; border-radius: 12px; padding: 4px 12px; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.sia-rank .tabs button { flex: 1 0 auto; min-width: 72px; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  border: 2px solid #2a1a10; background: #fff; border-radius: 12px; padding: 7px 4px; }
.sia-rank .tabs button[hidden] { display: none; }
.sia-rank .tabs button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .subs { display: none; gap: 5px; margin-bottom: 6px; }
.sia-rank .subs.on { display: flex; }
.sia-rank .subs button { flex: 1; white-space: nowrap; font: inherit; font-size: 13px; color: #2a1a10; cursor: pointer;
  border: 2px solid #e2d3b5; background: #fff; border-radius: 999px; padding: 4px 2px; }
.sia-rank .subs button.sel { border-color: #2a1a10; background: #fff4c2; }
.sia-rank .modes { display: none; gap: 6px; margin-bottom: 6px; }
.sia-rank .modes.on { display: flex; flex-wrap: wrap; }
.sia-rank .modes button { flex: 1 0 auto; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  border: 2px solid #2a1a10; background: #fff; border-radius: 12px; padding: 5px 4px; }
.sia-rank .modes button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .modes button[data-sm="hell"].sel { background: #ff4d6d; color: #ffffff; }
.sia-rank td.am i.hell { background: #ff4d6d; }
.sia-rank .dmodes { display: none; gap: 6px; margin-bottom: 6px; }
.sia-rank .dmodes.on { display: flex; flex-wrap: wrap; }
.sia-rank .dmodes button { flex: 1 0 auto; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  background: #fff; border: 2px solid #2a1a10; border-radius: 12px; padding: 4px 6px; }
.sia-rank .dmodes button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .dmodes button[hidden] { display: none; }
.sia-rank .dday { display: none; align-items: center; gap: 6px; margin-bottom: 2px; }
.sia-rank .dday.on { display: flex; }
.sia-rank .dday span { flex: 1; min-width: 0; text-align: center; font-size: 14px; color: #2a1a10; }
.sia-rank .dday button { flex: 0 0 auto; min-width: 40px; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  background: #fff; border: 2px solid #2a1a10; border-radius: 12px; padding: 4px 10px; }
.sia-rank .dday button:disabled { cursor: default; color: #e2d3b5; border-color: #e2d3b5; }
.sia-rank td.sq { line-height: 0; white-space: nowrap; }
.sia-rank td.sq img { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #2a1a10; background: #fff; object-fit: cover; margin-right: -5px; }
.sia-rank td.am i { font-style: normal; display: inline-block; background: #4cb86a; color: #fff; border-radius: 999px; padding: 0 6px; font-size: 11px; margin-right: 4px; vertical-align: 1px; }
.sia-rank .wk { display: none; text-align: center; font-size: 14px; color: #2a1a10; margin: 0 0 2px; line-height: 1.5; }
.sia-rank .wk.on { display: block; }
.sia-rank .wk .left { display: inline-block; background: #fff4c2; border: 2px solid #2a1a10; border-radius: 999px; padding: 0 10px; }
.sia-rank .wk .last { display: block; font-size: 13px; color: #8a6a4a; word-break: keep-all; }
.sia-rank .wk .last b { font-weight: normal; color: #2a1a10; }
.sia-rank .wk .last i { font-style: normal; white-space: nowrap; }
.sia-rank .me-line { text-align: center; font-size: 15px; margin: 6px 0; }
.sia-rank .me-line b { font-weight: normal; color: #f0a500; }
.sia-rank .list { flex: 1; min-height: 0; overflow-y: auto; border-top: 2px dashed #e2d3b5; }
.sia-rank table { width: 100%; border-collapse: collapse; }
.sia-rank td { padding: 6px; border-bottom: 2px dashed #e2d3b5; font-size: 16px; vertical-align: middle; }
.sia-rank td.pl { width: 36px; text-align: center; }
.sia-rank td.tr { width: 34px; line-height: 0; }
.sia-rank td.ch { width: 36px; line-height: 0; }
.sia-rank td.ch img { width: 30px; height: 30px; border-radius: 50%; border: 2px solid #2a1a10; background: #fff; object-fit: cover; }
.sia-rank td.am small { display: block; font-size: 12px; color: #8a6a4a; }
.sia-rank td.nm { width: 100%; word-break: break-all; }
.sia-rank td.am { white-space: nowrap; text-align: right; color: #f0a500; }
.sia-rank tr.me { background: #fff4c2; color: #2a1a10; }
.sia-rank tr.me td.nm { color: #1f6fd1; }
.sia-rank .note { font-size: 12px; color: #8a6a4a; text-align: center; margin: 8px 0 0; }
.sia-rank td.go a { display: inline-block; font-size: 13px; color: #2a1a10; text-decoration: none; white-space: nowrap; background: #fff;
  border: 2px solid #2a1a10; border-radius: 12px; padding: 3px 9px; box-shadow: 0 2px 0 #2a1a10; }
/* 휴대폰 가로처럼 낮은 화면: 탭은 한 줄 가로 스크롤, 설명 줄은 숨기고 여백을 줄여 순위 칸을 남긴다.
   그래도 모자라면 순위 칸은 160px 를 지키고 창 전체가 스크롤된다 */
@media (max-height: 500px) {
  .sia-rank-dim { padding: 8px; }
  .sia-rank { height: 100%; overflow-y: auto; padding: 10px 12px; border-radius: 22px; }
  .sia-rank .rh { margin-bottom: 6px; }
  .sia-rank .rh h3 { font-size: 19px; }
  .sia-rank .tabs { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; margin-bottom: 6px; scrollbar-width: thin; }
  .sia-rank .tabs button { flex: 0 0 auto; padding: 5px 8px; }
  .sia-rank .modes.on { flex-wrap: nowrap; }
  .sia-rank .modes button { flex: 1 1 auto; }
  .sia-rank .modes button, .sia-rank .dmodes button, .sia-rank .dday button { padding: 3px 4px; }
  .sia-rank .me-line { margin: 4px 0; }
  .sia-rank .list { flex: 1 0 auto; min-height: 160px; height: 0; }
  .sia-rank .note { display: none; }
}
`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * 랭킹 창 열기.
 * meId: 내 사용자 ID (내 줄 강조), first: 처음 보여 줄 탭 ('tank' | 'target' | 'casino' | 'matgo' | 'race' | 'volley' | 'survival' | 'defense' | 'village' | 'charge' | 'finger' | 'twelve' | 'tower')
 */
export function openRanking({ meId = null, first = 'tank' } = {}) {
  // 이미 열린 창이 있으면 하나 더 띄우지 않는다 (버튼을 빠르게 두 번 눌렀을 때). 돌려주는 닫기는 그 창을 닫는다
  const opened = document.querySelector('.sia-rank-dim');
  if (opened) return () => opened.querySelector('[data-close]')?.click();
  // 닫힌 게임 안에서 연 창(관리자가 미리 해 보는 중)은 그 게임 탭만 보이게 둔다. 로비에서는 열린 게임만
  const here = GAMES.find((g) => location.pathname.includes('/' + g.path));
  const inside = here && gameOfTab(first) === here.id ? first : null;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.append(st);
  }
  const dim = document.createElement('div');
  dim.className = 'sia-rank-dim';
  dim.innerHTML = `<div class="sia-rank" role="dialog" aria-modal="true" aria-label="랭킹">
    <div class="rh"><h3>🏆 랭킹</h3><button type="button" data-close>닫기</button></div>
    <div class="tabs">${TAB_ORDER.filter((g) => tabInfo(g) && (defaultOpen(g) || g === inside))
      .map((g) => `<button type="button" data-g="${g}">${tabInfo(g).label}</button>`)
      .join('')}</div>
    <div class="modes">${SURVIVAL_MODES.map((m) => `<button type="button" data-sm="${m.id}">${m.name}</button>`).join('')}<button type="button" data-sm="${DAILY_MODE}">${DAILY_NAME}</button></div>
    <div class="subs">${SURVIVAL_MAPS.map((m) => `<button type="button" data-m="${m.id}">${m.name}</button>`).join('')}</div>
    <div class="dmodes">${DEFENSE_MODES.map((m) => `<button type="button" data-dm="${m.id}">${m.name}</button>`).join('')}<button type="button" data-dm="${DAILY_MODE}">${DAILY_NAME}</button><button type="button" data-dm="${WEEKLY_MODE}" hidden>${WEEKLY_NAME}</button></div>
    <div class="dday"><button type="button" data-dd="-1" aria-label="하루 전" disabled>◀</button><span></span><button type="button" data-dd="1" aria-label="하루 뒤" disabled>▶</button></div>
    <p class="wk"></p>
    <p class="me-line"></p>
    <div class="list"><table></table></div>
    <p class="note"></p>
  </div>`;
  document.body.append(dim);
  const $ = (s) => dim.querySelector(s);
  const close = () => {
    dim.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  dim.addEventListener('click', (e) => {
    if (e.target === dim || e.target.closest('[data-close]')) close();
    const tab = e.target.closest('[data-g]');
    if (tab) void show(tab.dataset.g);
    const sub = e.target.closest('[data-m]');
    if (sub) void showSurvival(sub.dataset.m);
    const sm = e.target.closest('[data-sm]');
    if (sm) void showSurvival(survivalMap, sm.dataset.sm);
    const dm = e.target.closest('[data-dm]');
    if (dm && shown === 'race') void showRace(dm.dataset.dm === DAILY_MODE || dm.dataset.dm === WEEKLY_MODE ? dm.dataset.dm : 'best');
    else if (dm) void (shown === 'charge' ? showCharge(dm.dataset.dm) : shown === 'finger' ? showFinger(dm.dataset.dm) : shown === 'twelve' ? showTwelve(dm.dataset.dm) : shown === 'card' ? showCard(dm.dataset.dm) : showDefense(dm.dataset.dm));
    const dd = e.target.closest('[data-dd]');
    if (dd && !dd.disabled) moveDaily(Number(dd.dataset.dd));
  });

  let shown = '';
  async function show(game) {
    shown = game;
    dim.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.g === game));
    // 낮은 화면에서 탭 줄이 가로 스크롤일 때 고른 탭이 보이게
    const tabs = $('.tabs');
    const selTab = tabs.querySelector('.sel');
    if (selTab && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = selTab.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - selTab.offsetWidth) / 2;
    // 모드·맵 고르기 줄은 시아서바이벌 탭에서만 보인다
    $('.subs').classList.toggle('on', game === 'survival');
    $('.modes').classList.toggle('on', game === 'survival');
    // 스테이지 / 끝없는 모드 고르기 줄은 시아디펜스·돌격대·핑거·열두길 탭에서만 보인다 (버튼 글자는 탭마다 바꾼다)
    $('.dmodes').classList.toggle('on', game === 'defense' || game === 'charge' || game === 'finger' || game === 'twelve' || game === 'race' || game === 'card');
    // 레이스는 [오늘의 도전 · 주간 · 최고 기록] 셋 (보이는 순서는 CSS order), 주간 단추는 레이스에만. 열두길은 오늘의 도전이 없다
    dim.querySelectorAll('.dmodes button').forEach((b, i) => {
      const dm = b.dataset.dm;
      // 카드배틀은 [끝없는 모드 · 오늘의 도전] 둘 (두 번째 디펜스 단추는 숨김)
      b.toggleAttribute('hidden', dm === DAILY_MODE ? !DAILY_TABS[game] : dm === WEEKLY_MODE ? game !== 'race' : (game === 'race' || game === 'card') && i > 0);
      b.style.order = game === 'race' ? String(RACE_MODE_ORDER[dm === DAILY_MODE || dm === WEEKLY_MODE ? dm : 'best']) : '';
    });
    // 주간 줄(남은 날 · 지난주 1~3등)은 레이스 주간에서만 (showRace 가 켠다)
    $('.wk').classList.remove('on');
    // 날짜 줄은 오늘의 도전을 볼 때만 (showDaily 가 켠다). 탭을 옮기면 오늘로 돌아간다
    $('.dday').classList.remove('on');
    dailyDay = null;
    if (game === 'survival') return showSurvival(survivalMap);
    if (game === 'defense') return showDefense(defenseMode);
    if (game === 'charge') return showCharge(chargeMode);
    if (game === 'finger') return showFinger(fingerMode);
    if (game === 'twelve') return showTwelve(twelveMode);
    if (game === 'race') return showRace();
    if (game === 'volley') return showVolley();
    if (game === 'village') return showVillage();
    if (game === 'tower') return showTower();
    if (game === 'card') return showCard(cardMode);
    const info = RANKINGS[game];
    $('.note').textContent = `${info.note} · 해 상위 10% · 달 30% · 별 60% · 그 외 구름 (${info.cloud ?? `${formatAmount(info.base)}${info.unit} 이하는 구름`})`;
    const amountText = (r) => r.text ?? `${formatAmount(r.amount)}${info.unit}`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const rows = withTiers(await getRanking(game), info.base);
      if (shown !== game) return;
      const mine = meId ? rows.find((r) => r.key === meId) : null;
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${rows.length}명 · ${tierSvg(mine.tier, 20)} · ${amountText(mine)}`
        : '아직 순위가 없어요';
      $('table').innerHTML =
        rows
          .slice(0, 100)
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(r.tier, 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="am">${esc(amountText(r))}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === game) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /** 시아레이스: 최고 기록 빠른 순 상위 100명 + 내 순위, 등급은 순위 기준 (1·2·3위 해·달·별, 나머지 구름) */
  // 처음 열리는 모드는 오늘의 도전 (2026-11-23: 오늘의 도전이 시아레이스의 메인)
  let raceMode = DAILY_MODE;
  async function showRace(mode = raceMode) {
    raceMode = mode === DAILY_MODE || mode === WEEKLY_MODE ? mode : 'best';
    dim.querySelectorAll('.dmodes button').forEach((b, i) => {
      const dm = b.dataset.dm;
      b.classList.toggle('sel', dm === DAILY_MODE || dm === WEEKLY_MODE ? raceMode === dm : i === 0 && raceMode === 'best');
      if (i === 0) b.textContent = RACE_BEST_NAME;
    });
    $('.dday').classList.toggle('on', raceMode === DAILY_MODE);
    $('.wk').classList.toggle('on', raceMode === WEEKLY_MODE);
    if (raceMode === DAILY_MODE) return showDaily('race');
    if (raceMode === WEEKLY_MODE) return showRaceWeekly();
    $('.note').textContent = `${RACE_INFO.note} · 상위 ${RACE_TOP}명 · ${RACE_TIERS.gold}위 해 · ${RACE_TIERS.silver}위 달 · ${RACE_TIERS.bronze}위 별 · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getRaceRanking(meId);
      if (shown !== 'race' || raceMode !== 'best') return;
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(raceTierOfPlace(mine.place), 20)} · ${raceTime(mine.ms)}`
        : '아직 완주 기록이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(raceTierOfPlace(r.place), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="am">${raceTime(r.ms)}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'race' && raceMode === 'best') $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아레이스 주간: 이번 주 최고 기록 순 상위 100명 + 내 순위. 등급은 순위 비율 (오늘의 도전 탭과 같은 기준: 해 10% · 달 30% · 별 60%).
   * 위 줄에 '이번 주 3일 남음'(한국 날짜) 과 지난주 🥇🥈🥉. 줄마다 순위 · 등급 · 캐릭터 얼굴 · 닉네임 · 기록
   */
  let weeklySeq = 0;
  async function showRaceWeekly() {
    const seq = ++weeklySeq;
    const current = () => seq === weeklySeq && shown === 'race' && raceMode === WEEKLY_MODE;
    $('.note').textContent = `${RACE_WEEKLY_NOTE} · 상위 ${RACE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    const paintWeek = (today, last) => {
      const lastHtml =
        last && last.top.length
          ? `<span class="last">지난주 ${last.top.map((t) => `<i>${medals[t.place - 1]} <b>${esc(t.nickname)}</b> ${raceTime(t.ms)}</i>`).join(' · ')}</span>`
          : '';
      $('.wk').innerHTML = `<span class="left">📅 ${esc(raceWeekLeftText(today))}</span>${lastHtml}`;
    };
    paintWeek(dailyToday ?? localDailyDay(), null);
    const lastP = getRaceWeeklyLastTop();
    try {
      const { rows, mine, total } = await getRaceWeeklyRanking(meId);
      if (!current()) return;
      const tier = (place) => tierOfPlace(place, total);
      $('.me-line').innerHTML = mine
        ? `이번 주 내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine.place), 20)} · ${raceTime(mine.ms)}`
        : '아직 이번 주 기록이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r.place), 26)}</td>` +
              `<td class="ch"><img src="${faceUrl(r.character)}" alt="" /></td><td class="nm">${esc(r.nickname)}</td><td class="am">${raceTime(r.ms)}</td></tr>`,
          )
          .join('') || '<tr><td>이번 주에는 아직 아무도 완주하지 않았어요</td></tr>';
    } catch {
      if (current()) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
    const last = await lastP;
    if (!current()) return;
    // 서버가 알려 준 한국 날짜로 남은 날을 다시 센다 (기기 시계가 틀려도)
    paintWeek(last?.today ?? dailyToday ?? localDailyDay(), last);
  }
  /** 시아배구: 승수 순 상위 100명 + 내 순위. 줄마다 순위 · 등급 · 최근 캐릭터 얼굴 · 닉네임 · 승 패 · 승률 */
  async function showVolley() {
    $('.note').textContent = `${VOLLEY_INFO.note} · 상위 ${VOLLEY_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름 (1승도 없으면 구름)`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getVolleyRanking(meId);
      if (shown !== 'volley') return;
      const tier = (r) => tierOfPlace(r.place, total, r.wins > 0);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${mine.wins}승 ${mine.losses}패 (승률 ${volleyRate(mine.wins, mine.losses)})`
        : '아직 전적이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="ch"><img src="${faceUrl(r.character)}" alt="" /></td><td class="nm">${esc(r.nickname)}</td>` +
              `<td class="am">${r.wins}승 ${r.losses}패<small>승률 ${volleyRate(r.wins, r.losses)}</small></td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'volley') $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아서바이벌: 모드(4분 모드 / 무한 모드)와 맵을 골라 본다. 생존 시간 순 상위 100명 + 내 순위.
   * 줄마다 순위 · 등급 · 캐릭터 얼굴 · 닉네임 · 생존 시간(클리어) · 처치 수 · 달성 날짜
   */
  let survivalMap = SURVIVAL_MAPS[0].id;
  let survivalMode = SURVIVAL_MODES[0].id;
  async function showSurvival(mapId, mode = survivalMode) {
    if (!SURVIVAL_MAPS.some((m) => m.id === mapId)) mapId = SURVIVAL_MAPS[0].id;
    // 오늘의 도전은 그날 맵 하나뿐이라 맵 고르기 줄을 숨긴다
    $('.subs').classList.toggle('on', mode !== DAILY_MODE);
    $('.dday').classList.toggle('on', mode === DAILY_MODE);
    if (mode === DAILY_MODE) {
      survivalMap = mapId;
      survivalMode = mode;
      dim.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('sel', b.dataset.sm === mode));
      return showDaily('survival');
    }
    if (!SURVIVAL_MODES.some((m) => m.id === mode)) mode = SURVIVAL_MODES[0].id;
    survivalMap = mapId;
    survivalMode = mode;
    dim.querySelectorAll('.subs button').forEach((b) => b.classList.toggle('sel', b.dataset.m === mapId));
    dim.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('sel', b.dataset.sm === mode));
    $('.note').textContent = `${mode === 'endless' ? SURVIVAL_ENDLESS_NOTE : mode === 'hell' ? SURVIVAL_HELL_NOTE : SURVIVAL_INFO.note} · 상위 ${SURVIVAL_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    // 헬 모드 랭킹의 클리어 표시는 헬 색(분홍)으로
    const timeText = (r) => `${r.cleared ? (mode === 'hell' ? '<i class="hell">🔥 클리어</i>' : '<i>클리어</i>') : ''}${survivalTime(r.time)}`;
    try {
      const { rows, mine, total } = await getSurvivalRanking(mapId, meId, mode);
      if (shown !== 'survival' || survivalMap !== mapId || survivalMode !== mode) return;
      const tier = (r) => tierOfPlace(r.place, total);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${survivalTime(mine.time)}${mine.cleared ? ' 클리어' : ''} · 처치 ${mine.kills.toLocaleString()}`
        : mode === 'endless'
          ? '아직 이 맵의 무한 모드 기록이 없어요'
          : mode === 'hell'
            ? '아직 이 맵의 헬 모드 기록이 없어요'
            : '아직 이 맵의 기록이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="ch"><img src="${faceUrl(r.character)}" alt="" /></td><td class="nm">${esc(r.nickname)}</td>` +
              `<td class="am">${timeText(r)}<small>처치 ${r.kills.toLocaleString()} · ${esc(dateText(r.at))}</small></td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'survival' && survivalMap === mapId && survivalMode === mode) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아디펜스: 스테이지 랭킹(별 · 클리어한 스테이지) / 끝없는 모드 랭킹(도달 웨이브 · 데려간 캐릭터 5종 · 달성 날짜). 상위 100명 + 내 순위
   */
  let defenseMode = DEFENSE_MODES[0].id;
  async function showDefense(mode = defenseMode) {
    $('.dday').classList.toggle('on', mode === DAILY_MODE);
    if (mode === DAILY_MODE) {
      defenseMode = mode;
      dim.querySelectorAll('.dmodes button').forEach((b, i) => {
        b.classList.toggle('sel', b.dataset.dm === DAILY_MODE);
        if (DEFENSE_MODES[i]) b.textContent = DEFENSE_MODES[i].name;
      });
      return showDaily('defense');
    }
    if (!DEFENSE_MODES.some((m) => m.id === mode)) mode = DEFENSE_MODES[0].id;
    defenseMode = mode;
    const endless = mode === 'endless';
    dim.querySelectorAll('.dmodes button').forEach((b) => {
      b.classList.toggle('sel', b.dataset.dm === mode);
      b.textContent = DEFENSE_MODES.find((m) => m.id === b.dataset.dm)?.name ?? b.textContent;
    });
    $('.note').textContent = `${endless ? DEFENSE_ENDLESS_NOTE : DEFENSE_INFO.note} · 상위 ${DEFENSE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getDefenseRanking(mode, meId);
      if (shown !== 'defense' || defenseMode !== mode) return;
      const tier = (r) => tierOfPlace(r.place, total);
      const amount = (r) => (endless ? `웨이브 ${r.wave}<small>${esc(dateText(r.at))}</small>` : `⭐ ${r.stars}<small>클리어 ${esc(r.best)} (${r.cleared}곳)</small>`);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${endless ? `웨이브 ${mine.wave}` : `⭐ ${mine.stars} · 클리어 ${esc(mine.best)}`}`
        : endless
          ? '아직 끝없는 모드 기록이 없어요'
          : '아직 클리어한 스테이지가 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td>` +
              (endless ? `<td class="sq">${r.characters.slice(0, 5).map((c) => `<img src="${faceUrl(c)}" alt="" />`).join('')}</td>` : '') +
              `<td class="am">${amount(r)}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'defense' && defenseMode === mode) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아돌격대: 스테이지 랭킹(별 · 클리어한 스테이지) / 끝없는 길 랭킹(달린 거리 · 대장 · 달성 날짜). 상위 100명 + 내 순위
   */
  let chargeMode = CHARGE_MODES[0].id;
  async function showCharge(mode = chargeMode) {
    $('.dday').classList.toggle('on', mode === DAILY_MODE);
    if (mode === DAILY_MODE) {
      chargeMode = mode;
      dim.querySelectorAll('.dmodes button').forEach((b, i) => {
        b.classList.toggle('sel', b.dataset.dm === DAILY_MODE);
        if (CHARGE_MODES[i]) b.textContent = CHARGE_MODES[i].name;
      });
      return showDaily('charge');
    }
    if (!CHARGE_MODES.some((m) => m.id === mode)) mode = CHARGE_MODES[0].id;
    chargeMode = mode;
    const endless = mode === 'endless';
    dim.querySelectorAll('.dmodes button').forEach((b) => {
      b.classList.toggle('sel', b.dataset.dm === mode);
      b.textContent = CHARGE_MODES.find((m) => m.id === b.dataset.dm)?.name ?? b.textContent;
    });
    $('.note').textContent = `${endless ? CHARGE_ENDLESS_NOTE : CHARGE_INFO.note} · 상위 ${DEFENSE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getChargeRanking(mode, meId);
      if (shown !== 'charge' || chargeMode !== mode) return;
      const tier = (r) => tierOfPlace(r.place, total);
      const m = (n) => `${Number(n).toLocaleString()}m`;
      const amount = (r) => (endless ? `${m(r.meters)}<small>${esc(dateText(r.at))}</small>` : `⭐ ${r.stars}<small>클리어 ${esc(r.best)} (${r.cleared}곳)</small>`);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${endless ? m(mine.meters) : `⭐ ${mine.stars} · 클리어 ${esc(mine.best)}`}`
        : endless
          ? '아직 끝없는 길 기록이 없어요'
          : '아직 클리어한 스테이지가 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td>` +
              (endless && r.leader ? `<td class="sq"><img src="${faceUrl(r.leader)}" alt="" /></td>` : endless ? '<td class="sq"></td>' : '') +
              `<td class="am">${amount(r)}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'charge' && chargeMode === mode) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아핑거: 스테이지 랭킹(별 · 클리어한 스테이지) / 끝없는 탑 랭킹(층 · 쓴 턴 · 데려간 대원 4명 얼굴 · 달성 날짜). 상위 100명 + 내 순위
   */
  let fingerMode = FINGER_MODES[0].id;
  async function showFinger(mode = fingerMode) {
    $('.dday').classList.toggle('on', mode === DAILY_MODE);
    if (mode === DAILY_MODE) {
      fingerMode = mode;
      dim.querySelectorAll('.dmodes button').forEach((b, i) => {
        b.classList.toggle('sel', b.dataset.dm === DAILY_MODE);
        if (FINGER_MODES[i]) b.textContent = FINGER_MODES[i].name;
      });
      return showDaily('finger');
    }
    // 고르기 줄 버튼의 data-dm 은 디펜스 모드 id (stage / endless) → 같은 자리의 핑거 모드로
    const at = DEFENSE_MODES.findIndex((d) => d.id === mode);
    if (at >= 0 && FINGER_MODES[at]) mode = FINGER_MODES[at].id;
    if (!FINGER_MODES.some((m) => m.id === mode)) mode = FINGER_MODES[0].id;
    fingerMode = mode;
    const tower = mode === 'tower';
    dim.querySelectorAll('.dmodes button').forEach((b) => {
      // 고르기 줄 버튼은 디펜스 모드 id(stage / endless)로 만들어져 있다 → 두 번째 버튼이 끝없는 탑
      const m = FINGER_MODES[DEFENSE_MODES.findIndex((d) => d.id === b.dataset.dm)];
      b.classList.toggle('sel', m?.id === mode);
      if (m) b.textContent = m.name;
    });
    $('.note').textContent = `${tower ? FINGER_TOWER_NOTE : FINGER_INFO.note} · 상위 ${DEFENSE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getFingerRanking(mode, meId);
      if (shown !== 'finger' || fingerMode !== mode) return;
      const tier = (r) => tierOfPlace(r.place, total);
      const amount = (r) => (tower ? `${r.floor}층<small>${r.turns}턴 · ${esc(dateText(r.at))}</small>` : `⭐ ${r.stars}<small>클리어 ${esc(r.best)} (${r.cleared}곳)</small>`);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${tower ? `${mine.floor}층 · ${mine.turns}턴` : `⭐ ${mine.stars} · 클리어 ${esc(mine.best)}`}`
        : tower
          ? '아직 끝없는 탑 기록이 없어요'
          : '아직 클리어한 스테이지가 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td>` +
              (tower ? `<td class="sq">${r.party.slice(0, 4).map((c) => `<img src="${faceUrl(c)}" alt="" />`).join('')}</td>` : '') +
              `<td class="am">${amount(r)}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'finger' && fingerMode === mode) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아열두길: 레벨 랭킹(대표 대원 얼굴 · 레벨 · 모드 · 지금 지형 · 어려움 최종보스 처치 👑) /
   * 끝없는 탑 랭킹(그때 대원 얼굴 · 층 · 걸린 시간 · 그때 레벨 · 달성 날짜). 상위 100명 + 내 순위
   */
  let twelveMode = TWELVE_MODES[0].id;
  async function showTwelve(mode = twelveMode) {
    // 고르기 줄 버튼의 data-dm 은 디펜스 모드 id (stage / endless) → 같은 자리의 열두길 모드로
    const at = DEFENSE_MODES.findIndex((d) => d.id === mode);
    if (at >= 0 && TWELVE_MODES[at]) mode = TWELVE_MODES[at].id;
    if (!TWELVE_MODES.some((m) => m.id === mode)) mode = TWELVE_MODES[0].id;
    twelveMode = mode;
    const tower = mode === 'tower';
    dim.querySelectorAll('.dmodes button').forEach((b) => {
      const m = TWELVE_MODES[DEFENSE_MODES.findIndex((d) => d.id === b.dataset.dm)];
      b.classList.toggle('sel', m?.id === mode);
      if (m) b.textContent = m.name;
    });
    $('.note').textContent = `${tower ? TWELVE_TOWER_NOTE : TWELVE_INFO.note} · 상위 ${DEFENSE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getTwelveRanking(mode, meId);
      if (shown !== 'twelve' || twelveMode !== mode) return;
      const tier = (r) => tierOfPlace(r.place, total);
      const where = (r) => `${r.mode === 'hard' ? '어려움' : '보통'} · ${r.region}지형 ${TWELVE_REGIONS[r.region - 1] ?? ''}`;
      const amount = (r) =>
        tower
          ? `${r.floor}층<small>${twelveTime(r.time)} · Lv ${r.level} · ${esc(dateText(r.at))}</small>`
          : `Lv ${r.level}${r.hardDone ? ' 👑' : ''}<small>${esc(where(r))}</small>`;
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${tower ? `${mine.floor}층 · ${twelveTime(mine.time)}` : `Lv ${mine.level} · ${mine.mode === 'hard' ? '어려움' : '보통'} ${mine.region}지형`}`
        : tower
          ? '아직 끝없는 탑 기록이 없어요'
          : '아직 깬 맵이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="sq"><img src="${faceUrl(r.hero)}" alt="" /></td>` +
              `<td class="am">${amount(r)}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'twelve' && twelveMode === mode) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /** 시아의탑: 최고 층 · 그때 레벨 · 달성 날짜. 상위 100명 + 내 순위 */
  async function showTower() {
    $('.note').textContent = `${TOWER_INFO.note} · 상위 ${DEFENSE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getTowerRanking(meId);
      if (shown !== 'tower') return;
      const tier = (r) => tierOfPlace(r.place, total);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${mine.floor}층 · Lv ${mine.level}`
        : '아직 깬 층이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="am">${r.floor}층<small>Lv ${r.level} · ${esc(dateText(r.at))}</small></td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'tower') $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 시아카드배틀: 오늘의 도전(처음) / 끝없는 모드 최고 칸(그때 영웅 얼굴 · 칸 · 깬 막 · 달성 날짜). 상위 100명 + 내 순위
   */
  let cardMode = DAILY_MODE;
  async function showCard(mode = cardMode) {
    // 고르기 줄 첫 단추(data-dm = 디펜스의 stage)가 끝없는 모드
    mode = mode === DAILY_MODE ? DAILY_MODE : 'endless';
    cardMode = mode;
    $('.dday').classList.toggle('on', mode === DAILY_MODE);
    dim.querySelectorAll('.dmodes button').forEach((b, i) => {
      b.classList.toggle('sel', b.dataset.dm === DAILY_MODE ? mode === DAILY_MODE : i === 0 && mode === 'endless');
      if (i === 0) b.textContent = CARD_MODES[0].name;
    });
    if (mode === DAILY_MODE) return showDaily('card');
    $('.note').textContent = `${CARD_INFO.note} · 상위 ${DEFENSE_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getCardEndlessRanking(meId);
      if (shown !== 'card' || cardMode !== 'endless') return;
      const tier = (r) => tierOfPlace(r.place, total);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${mine.floors}칸 · ${mine.acts}막 돌파`
        : '아직 끝없는 모드 기록이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="ch"><img src="${faceUrl(r.hero)}" alt="" /></td><td class="nm">${esc(r.nickname)}</td>` +
              `<td class="am">${r.floors}칸<small>${r.acts}막 돌파 · ${esc(dateText(r.at))}</small></td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'card' && cardMode === 'endless') $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  /**
   * 오늘의 도전: 그날 순위 상위 50명 + 내 순위 (daily_ranking). 표 모양은 그 탭의 다른 랭킹과 같다.
   * 점수는 게임마다 detail 로 읽는다 — 레이스 { ms } · 서바이벌 { time, kills, cleared, level, map, character } ·
   * 돌격대 { meters, kills, bosses, leader } · 핑거 { turns, fallen, stage } · 디펜스 { cleared, lives, kills, time, stage }
   */
  let dailyDay = null; // 보고 있는 날짜 (null = 오늘)
  let dailyToday = null; // 서버가 알려 준 오늘
  let dailySeq = 0;
  const modeOfTab = (tab) => (tab === 'race' ? raceMode : tab === 'survival' ? survivalMode : tab === 'defense' ? defenseMode : tab === 'charge' ? chargeMode : tab === 'finger' ? fingerMode : tab === 'card' ? cardMode : '');
  const DAILY_VIEW = {
    race: (d, score) => {
      const ms = Number(d.ms) > 0 ? Number(d.ms) : Math.abs(Number(score) || 0);
      return { main: raceTime(ms), line: raceTime(ms) };
    },
    survival: (d) => ({
      face: `<td class="ch"><img src="${faceUrl(d.character)}" alt="" /></td>`,
      main: `${d.cleared === true ? '<i>클리어</i>' : ''}${survivalTime(d.time)}`,
      sub: `처치 ${num(d.kills).toLocaleString()} · Lv ${num(d.level)}`,
      line: `${survivalTime(d.time)}${d.cleared === true ? ' 클리어' : ''} · 처치 ${num(d.kills).toLocaleString()}`,
    }),
    charge: (d, score) => {
      const m = `${(num(d.meters) || num(score)).toLocaleString()}m`;
      return {
        squad: `<td class="sq">${d.leader ? `<img src="${faceUrl(d.leader)}" alt="" />` : ''}</td>`,
        main: m,
        sub: `처치 ${num(d.kills).toLocaleString()} · 보스 ${num(d.bosses)}`,
        line: `${m} · 처치 ${num(d.kills).toLocaleString()}`,
      };
    },
    finger: (d, score) => {
      const turns = num(d.turns) || Math.abs(Number(score) || 0);
      const fallen = num(d.fallen);
      return { main: `${turns}턴`, sub: fallen > 0 ? `쓰러짐 ${fallen}` : '모두 무사', line: `${turns}턴${fallen > 0 ? ` · 쓰러짐 ${fallen}` : ''}` };
    },
    card: (d, score) => ({
      face: `<td class="ch"><img src="${faceUrl(d.hero)}" alt="" /></td>`,
      main: `${num(score).toLocaleString()}점`,
      sub: `${num(d.floors)}칸 · 정예 ${num(d.elites)} · 보스 ${num(d.bosses)}${d.ending === 'true' ? ' · 진짜 엔딩' : d.ending === 'normal' ? ' · 클리어' : ''}`,
      line: `${num(score).toLocaleString()}점 · ${num(d.floors)}칸`,
    }),
    defense: (d) => {
      const cleared = d.cleared === true;
      return {
        main: cleared ? `<i>클리어</i>생명 ${num(d.lives)}` : `처치 ${num(d.kills).toLocaleString()}`,
        sub: cleared ? `처치 ${num(d.kills).toLocaleString()} · ${survivalTime(d.time)}` : `${survivalTime(d.time)} 버팀`,
        line: cleared ? `클리어 · 생명 ${num(d.lives)} · 처치 ${num(d.kills).toLocaleString()}` : `처치 ${num(d.kills).toLocaleString()} · ${survivalTime(d.time)} 버팀`,
      };
    },
  };
  /** 그날 모두가 같이 한 곳 (맵 · 스테이지). 순위에 있는 아무 기록에서 읽는다 */
  const dailyWhere = (tab, d) => {
    if (tab === 'survival') return SURVIVAL_MAPS.find((m) => m.id === d.map)?.name ?? '';
    if (tab === 'finger' || tab === 'defense') return typeof d.stage === 'string' && d.stage ? `스테이지 ${d.stage}` : '';
    return '';
  };
  /** 날짜 줄: "11월 23일 오늘의 도전 · N명" 과 ◀ ▶ (30일 전 ~ 오늘) */
  function paintDailyDay(day, total = null, where = '') {
    const today = dailyToday ?? localDailyDay();
    const isToday = day === today;
    $('.dday span').textContent = `${dayLabel(day)}${isToday ? ' 오늘의 도전' : '의 도전'}${where ? ` · ${where}` : ''}${total === null ? '' : ` · ${total}명`}`;
    $('.dday [data-dd="-1"]').disabled = day <= shiftDay(today, -DAILY_BACK_DAYS);
    $('.dday [data-dd="1"]').disabled = day >= today;
  }
  function moveDaily(step) {
    if (!DAILY_TABS[shown] || modeOfTab(shown) !== DAILY_MODE) return;
    const today = dailyToday ?? localDailyDay();
    const next = shiftDay(dailyDay ?? today, step);
    if (next > today || next < shiftDay(today, -DAILY_BACK_DAYS)) return;
    dailyDay = next === today ? null : next;
    void showDaily(shown);
  }
  async function showDaily(tab) {
    const info = DAILY_TABS[tab];
    const view = DAILY_VIEW[tab];
    const seq = ++dailySeq;
    const asked = dailyDay;
    const current = () => seq === dailySeq && shown === tab && modeOfTab(tab) === DAILY_MODE;
    $('.dday').classList.add('on');
    $('.note').textContent = `${info.note} · 상위 ${DAILY_TOP}명 · 그날 가장 좋은 기록 하나`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    paintDailyDay(asked ?? dailyToday ?? localDailyDay());
    const res = await loadDailyRanking(info.game, asked);
    if (!current()) return;
    if (!res || !Array.isArray(res.top)) {
      $('.me-line').textContent = '랭킹을 불러오지 못했어요';
      return;
    }
    if (isDay(res.today)) dailyToday = res.today;
    const day = isDay(res.day) ? res.day : (asked ?? dailyToday ?? localDailyDay());
    const total = num(res.total);
    const obj = (v) => (v && typeof v === 'object' ? v : {});
    const where = dailyWhere(tab, obj(res.top[0]?.detail ?? res.mine?.detail));
    paintDailyDay(day, total, where);
    const tier = (place) => tierOfPlace(place, total);
    const mine = res.mine && typeof res.mine === 'object' ? res.mine : null;
    $('.me-line').innerHTML = mine
      ? `내 순위 <b>${num(mine.place)}위</b> / ${total}명 · ${tierSvg(tier(num(mine.place)), 20)} · ${esc(view(obj(mine.detail), mine.score).line)}`
      : day === (dailyToday ?? day)
        ? '아직 오늘 기록이 없어요'
        : '이날 기록이 없어요';
    $('table').innerHTML =
      res.top
        .map((r) => {
          const v = view(obj(r.detail), r.score);
          const place = num(r.place);
          return (
            `<tr class="${r.me === true ? 'me' : ''}"><td class="pl">${place}</td><td class="tr">${tierSvg(tier(place), 26)}</td>` +
            `${v.face ?? ''}<td class="nm">${esc(r.nickname)}</td>${v.squad ?? ''}` +
            `<td class="am">${v.main}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</td></tr>`
          );
        })
        .join('') || `<tr><td>${day === (dailyToday ?? day) ? '아직 아무도 도전하지 않았어요' : '이날은 아무도 도전하지 않았어요'}</td></tr>`;
  }
  /** 시아마을: 번영도 순 상위 100곳 + 내 순위. 줄마다 순위 · 등급 · 닉네임(마을 이름 · 마을 레벨) · 번영도 · [구경] */
  async function showVillage() {
    $('.note').textContent = `${VILLAGE_INFO.note} · 상위 ${VILLAGE_TOP}곳 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getVillageRanking(meId);
      if (shown !== 'village') return;
      const tier = (r) => tierOfPlace(r.place, total);
      $('.me-line').innerHTML = mine ? `내 순위 <b>${mine.place}위</b> / ${total}곳 · ${tierSvg(tier(mine), 20)} · 번영도 ${mine.prosperity.toLocaleString()}` : '아직 마을이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(tier(r), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="am">번영도 ${r.prosperity.toLocaleString()}<small>${esc(r.name)} · 레벨 ${r.level}</small></td>` +
              `<td class="go">${r.key === meId ? '' : `<a href="${esc(villageUrl(r.key))}">구경</a>`}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'village') $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  // 열린 게임만 탭으로 남긴다 (inside 는 예외)
  const visible = (open) => TAB_ORDER.filter((g) => tabInfo(g) && (open[gameOfTab(g)] || g === inside));
  const start = (open) => {
    const tabs = visible(open);
    dim.querySelectorAll('.tabs button').forEach((b) => b.toggleAttribute('hidden', !tabs.includes(b.dataset.g)));
    for (const g of tabs) {
      if (dim.querySelector(`.tabs [data-g="${g}"]`)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.g = g;
      b.textContent = tabInfo(g).label;
      const after = [...dim.querySelectorAll('.tabs button')].find((x) => TAB_ORDER.indexOf(x.dataset.g) > TAB_ORDER.indexOf(g));
      $('.tabs').insertBefore(b, after ?? null);
    }
    const pick = tabs.includes(first) ? first : tabs[0];
    if (!pick) {
      $('.me-line').textContent = '열린 게임이 없어요';
      return;
    }
    if (!tabs.includes(shown)) void show(pick);
  };
  // 서버의 오픈 여부를 받기 전에는 목록의 기본값으로 먼저 보여 준다
  const fallback = Object.fromEntries(GAMES.map((g) => [g.id, g.open]));
  start(fallback);
  loadGameOpen()
    .then((open) => {
      if (dim.isConnected) start(open);
    })
    .catch(() => null);
  return close;
}

/** shared/games.js 의 기본 오픈 여부 (서버 값을 받기 전) */
function defaultOpen(tab) {
  return !!GAMES.find((g) => g.id === gameOfTab(tab))?.open;
}

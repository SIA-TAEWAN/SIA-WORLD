// SIA WORLD 랭킹 창 (로비와 시아탱크가 같이 쓴다).
//   탭: 💣 시아탱크(승패) · 🎯 백발백중 · 🪙 카지노 · 💰 맞고 · 🏁 시아레이스(최고 기록) · 🏐 시아배구(승수) · 👹 시아서바이벌(맵별 생존 시간)
//   등급: 해 상위 10% · 달 30% · 별 60% · 그 외 구름 (shared/rank.js)
//   시아레이스만 기록 기준: 해 30.75초 이내 · 달 33초 이내 · 별 37.5초 이내 · 그 외 구름 (RACE_TIERS)
//   시아배구는 승수 순위 기준 (시아탱크와 같은 비율). 1승도 없으면 구름
//   시아서바이벌은 맵마다 따로: 생존 시간 → 클리어 → 처치 수 → 먼저 달성한 순. 등급은 그 맵 안의 순위 기준
//   시아서바이벌 무한 모드는 4분 모드와 따로 (모드 전환 줄): 생존 시간 → 처치 수 → 먼저 달성한 순
//   시아마을은 번영도 순 → 먼저 달성한 순. 줄마다 [구경]으로 그 마을에 가 볼 수 있다
// 색은 DESIGN.md / shared/theme.css 값을 그대로 적는다 (시아탱크는 --panel 같은 변수 이름을 다른 뜻으로 써서 변수를 빌려 쓸 수 없다).
import { getRanking, formatAmount, RANKINGS } from './wallet.js';
import { withTiers, tierSvg, tierOfPlace } from './rank.js';
import { supabase } from './supabase.js';

const STYLE_ID = 'sia-ranking-style';
/** 탭 순서 (시아탱크가 먼저) */
const TAB_ORDER = ['tank', 'target', 'casino', 'matgo', 'race', 'volley', 'survival', 'defense', 'village'];

/**
 * 시아레이스 등급 기준 (ms 이내). 임시 값 — games/running/src/game/constants.ts 의 TIER_*_MS 와 같이 고친다.
 */
export const RACE_TIERS = { gold: 30750, silver: 33000, bronze: 37500 };
export const RACE_TOP = 100;
const RACE_INFO = { label: '🏁 레이스', note: '150m 최고 기록 순 (같은 기록은 먼저 세운 사람이 위)' };
const VOLLEY_INFO = { label: '🏐 배구', note: '사람끼리 겨룬 경기의 승수 순 (같으면 승률, 그다음 먼저 달성한 사람이 위)' };
export const VOLLEY_TOP = 100;
const SURVIVAL_INFO = { label: '👹 서바이벌', note: '맵별 생존 시간 순 (같으면 클리어한 기록, 그다음 처치 수, 먼저 달성한 사람이 위)' };
export const SURVIVAL_TOP = 100;
/** 시아서바이벌 모드: 4분 모드와 무한 모드의 랭킹은 따로다 */
export const SURVIVAL_MODES = [
  { id: 'normal', name: '4분 모드' },
  { id: 'endless', name: '무한 모드' },
];
const SURVIVAL_ENDLESS_NOTE = '무한 모드 · 맵별 생존 시간 순 (같으면 처치 수, 그다음 먼저 달성한 사람이 위)';
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
const VILLAGE_INFO = { label: '🏡 마을', note: '번영도 순 (건물 레벨 · 장식물 · 기념물 · 주민 친밀도 · 받은 칭찬. 같으면 먼저 달성한 마을이 위)' };
export const VILLAGE_TOP = 100;
const tabInfo = (g) => (g === 'race' ? RACE_INFO : g === 'volley' ? VOLLEY_INFO : g === 'survival' ? SURVIVAL_INFO : g === 'defense' ? DEFENSE_INFO : g === 'village' ? VILLAGE_INFO : RANKINGS[g]);

/** 기록(ms) → 등급 */
export function raceTier(ms) {
  if (ms <= RACE_TIERS.gold) return 'gold';
  if (ms <= RACE_TIERS.silver) return 'silver';
  if (ms <= RACE_TIERS.bronze) return 'bronze';
  return 'white';
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
/** 승률 표시: 승 ÷ (승 + 패), 소수점 없이 */
export const volleyRate = (wins, losses) => (wins + losses > 0 ? `${Math.round((wins / (wins + losses)) * 100)}%` : '-');
const ZODIAC = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'];
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
 * mode 가 'endless' 면 무한 모드 랭킹 (survival_endless_ranking 뷰: 생존 시간 → 처치 수 → 먼저 달성한 순. 칸은 같다)
 * → { rows: 상위 100명 [{ key, nickname, time, kills, cleared, character, at, place }], mine: 내 줄(100위 밖이어도) | null, total }
 */
export async function getSurvivalRanking(mapId, meId = null, mode = 'normal') {
  const cols = 'user_id,nickname,best_time,best_kills,cleared,character,achieved_at,place,total';
  const view = () => (mode === 'endless' ? supabase.from('survival_endless_ranking') : supabase.from('survival_ranking'));
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
  background: color-mix(in srgb, #2a1a10 55%, transparent); font-family: 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif; }
.sia-rank { box-sizing: border-box; width: min(460px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #fff8e8; color: #2a1a10; border: 4px solid #2a1a10; border-radius: 28px;
  box-shadow: 0 8px 0 #2a1a10; padding: 16px; }
.sia-rank * { box-sizing: border-box; }
.sia-rank .rh { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.sia-rank .rh h3 { margin: 0; font-size: 22px; font-weight: normal; }
.sia-rank .rh button { font: inherit; font-size: 15px; cursor: pointer; color: #2a1a10; background: #fff;
  border: 3px solid #2a1a10; border-radius: 12px; padding: 4px 12px; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.sia-rank .tabs button { flex: 1; min-width: 72px; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  border: 2px solid #2a1a10; background: #fff; border-radius: 12px; padding: 7px 4px; }
.sia-rank .tabs button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .subs { display: none; gap: 5px; margin-bottom: 6px; }
.sia-rank .subs.on { display: flex; }
.sia-rank .subs button { flex: 1; white-space: nowrap; font: inherit; font-size: 13px; color: #2a1a10; cursor: pointer;
  border: 2px solid #e2d3b5; background: #fff; border-radius: 999px; padding: 4px 2px; }
.sia-rank .subs button.sel { border-color: #2a1a10; background: #fff4c2; }
.sia-rank .modes { display: none; gap: 6px; margin-bottom: 6px; }
.sia-rank .modes.on { display: flex; }
.sia-rank .modes button { flex: 1; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  border: 2px solid #2a1a10; background: #fff; border-radius: 12px; padding: 5px 4px; }
.sia-rank .modes button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .dmodes { display: none; gap: 6px; margin-bottom: 6px; }
.sia-rank .dmodes.on { display: flex; }
.sia-rank .dmodes button { flex: 1; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  background: #fff; border: 2px solid #2a1a10; border-radius: 12px; padding: 4px 6px; }
.sia-rank .dmodes button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank td.sq { line-height: 0; white-space: nowrap; }
.sia-rank td.sq img { width: 22px; height: 22px; border-radius: 50%; border: 2px solid #2a1a10; background: #fff; object-fit: cover; margin-right: -5px; }
.sia-rank td.am i { font-style: normal; display: inline-block; background: #4cb86a; color: #fff; border-radius: 999px; padding: 0 6px; font-size: 11px; margin-right: 4px; vertical-align: 1px; }
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
`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * 랭킹 창 열기.
 * meId: 내 사용자 ID (내 줄 강조), first: 처음 보여 줄 탭 ('tank' | 'target' | 'casino' | 'matgo' | 'race' | 'volley' | 'survival' | 'defense' | 'village')
 */
export function openRanking({ meId = null, first = 'tank' } = {}) {
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
    <div class="tabs">${TAB_ORDER.filter((g) => tabInfo(g))
      .map((g) => `<button type="button" data-g="${g}">${tabInfo(g).label}</button>`)
      .join('')}</div>
    <div class="modes">${SURVIVAL_MODES.map((m) => `<button type="button" data-sm="${m.id}">${m.name}</button>`).join('')}</div>
    <div class="subs">${SURVIVAL_MAPS.map((m) => `<button type="button" data-m="${m.id}">${m.name}</button>`).join('')}</div>
    <div class="dmodes">${DEFENSE_MODES.map((m) => `<button type="button" data-dm="${m.id}">${m.name}</button>`).join('')}</div>
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
    if (dm) void showDefense(dm.dataset.dm);
  });

  let shown = '';
  async function show(game) {
    shown = game;
    dim.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.g === game));
    // 모드·맵 고르기 줄은 시아서바이벌 탭에서만 보인다
    $('.subs').classList.toggle('on', game === 'survival');
    $('.modes').classList.toggle('on', game === 'survival');
    // 스테이지 / 끝없는 모드 고르기 줄은 시아디펜스 탭에서만 보인다
    $('.dmodes').classList.toggle('on', game === 'defense');
    if (game === 'survival') return showSurvival(survivalMap);
    if (game === 'defense') return showDefense(defenseMode);
    if (game === 'race') return showRace();
    if (game === 'volley') return showVolley();
    if (game === 'village') return showVillage();
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
  /** 시아레이스: 최고 기록 빠른 순 상위 100명 + 내 순위, 등급은 기록 기준 */
  async function showRace() {
    const sec = (ms) => (ms / 1000).toString();
    $('.note').textContent = `${RACE_INFO.note} · 상위 ${RACE_TOP}명 · 해 ${sec(RACE_TIERS.gold)}초 · 달 ${sec(RACE_TIERS.silver)}초 · 별 ${sec(RACE_TIERS.bronze)}초 이내 · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const { rows, mine, total } = await getRaceRanking(meId);
      if (shown !== 'race') return;
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(raceTier(mine.ms), 20)} · ${raceTime(mine.ms)}`
        : '아직 완주 기록이 없어요';
      $('table').innerHTML =
        rows
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(raceTier(r.ms), 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="am">${raceTime(r.ms)}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === 'race') $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
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
    if (!SURVIVAL_MODES.some((m) => m.id === mode)) mode = SURVIVAL_MODES[0].id;
    survivalMap = mapId;
    survivalMode = mode;
    dim.querySelectorAll('.subs button').forEach((b) => b.classList.toggle('sel', b.dataset.m === mapId));
    dim.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('sel', b.dataset.sm === mode));
    $('.note').textContent = `${mode === 'endless' ? SURVIVAL_ENDLESS_NOTE : SURVIVAL_INFO.note} · 상위 ${SURVIVAL_TOP}명 · 해 상위 10% · 달 30% · 별 60% · 그 외 구름`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    const timeText = (r) => `${r.cleared ? '<i>클리어</i>' : ''}${survivalTime(r.time)}`;
    try {
      const { rows, mine, total } = await getSurvivalRanking(mapId, meId, mode);
      if (shown !== 'survival' || survivalMap !== mapId || survivalMode !== mode) return;
      const tier = (r) => tierOfPlace(r.place, total);
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${total}명 · ${tierSvg(tier(mine), 20)} · ${survivalTime(mine.time)}${mine.cleared ? ' 클리어' : ''} · 처치 ${mine.kills.toLocaleString()}`
        : mode === 'endless'
          ? '아직 이 맵의 무한 모드 기록이 없어요'
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
    if (!DEFENSE_MODES.some((m) => m.id === mode)) mode = DEFENSE_MODES[0].id;
    defenseMode = mode;
    const endless = mode === 'endless';
    dim.querySelectorAll('.dmodes button').forEach((b) => b.classList.toggle('sel', b.dataset.dm === mode));
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
  void show(tabInfo(first) ? first : 'tank');
  return close;
}

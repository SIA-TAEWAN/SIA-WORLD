// 오늘의 도전 공통 (레이스·서바이벌·돌격대·핑거·디펜스) — SQL 082_daily.sql
// 날짜는 서버(한국 시간)에서 받고, 그날의 조건은 날짜 문자열에서 모든 기기가 똑같이 만든다.
// 게임 코드는 런타임 import 로 쓴다: import(new URL('shared/daily.js', root()).href)
import { supabase } from './supabase.js';

export const DAILY_GAMES = ['running', 'survival', 'charge', 'finger', 'defense'];

/** 기기 시계로 만든 한국 날짜 'YYYY-MM-DD' (서버를 못 부를 때만) */
export function localDailyDay(now = Date.now()) {
  const d = new Date(now + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** 서버 기준 오늘 'YYYY-MM-DD'. 실패하면 기기 시계로. */
export async function dailyToday() {
  try {
    const { data, error } = await supabase.rpc('daily_today');
    if (error || typeof data !== 'string') throw error ?? new Error('bad');
    return data;
  } catch {
    return localDailyDay();
  }
}

/** 32비트 시드 (FNV-1a). 같은 게임·날짜·소금이면 어느 기기에서나 같은 값. */
export function dailySeed(game, day, salt = '') {
  const s = `${game}:${day}:${salt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 목록에서 그날 하나 고르기 (시드로) */
export function dailyPick(list, game, day, salt = 'pick') {
  if (!list.length) return undefined;
  return list[dailySeed(game, day, salt) % list.length];
}

/**
 * 그날 순위: { day, today, top: [{place, nickname, score, detail, me}], mine: {place, score, detail, plays} | null, total }
 * 실패하면 null.
 */
export async function loadDailyRanking(game, day = null) {
  try {
    const { data, error } = await supabase.rpc('daily_ranking', { p_game: game, p_day: day });
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

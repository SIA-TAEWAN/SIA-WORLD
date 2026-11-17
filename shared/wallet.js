// SIA WORLD 지갑: 카지노 칩 · 맞고 냥.
// 잔액은 서버 함수만 바꾼다. 여기서는 조회와 출석·충전 요청만 한다.
import { supabase } from './supabase.js';

export const START_AMOUNT = 10000;
export const REFILL_TO = 10000;
export const REFILLS_PER_DAY = 3;
export const BASE_UNITS = [100, 500, 1000];
export const CURRENCY_NAME = { chips: '칩', nyang: '냥' };

/** 방 최소 입장 금액 = 기본 단위 × 50 */
export const minEntry = (baseUnit) => baseUnit * 50;

export class WalletError extends Error {}

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (/need login/.test(error.message)) throw new WalletError('로그인이 필요해요');
    throw new WalletError('서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요');
  }
  return data;
}

/**
 * 지갑 확인(없으면 10,000 / 10,000으로 생성)
 * → { chips, nyang, chipsRefillsLeft, nyangRefillsLeft }
 */
export const ensureWallet = () => call('ensure_wallet');

/**
 * 출석 보너스 (한국 시간으로 오늘 처음이면 칩·냥 각 +10,000). 지갑이 없으면 만든다.
 * → { granted, chips, nyang, chipsRefillsLeft, nyangRefillsLeft }
 */
export const claimAttendance = () => call('claim_attendance');

/** 무료 충전 버튼을 켤지: 잔액이 최소 입장 금액보다 적고, 채우면 늘어나고, 오늘 횟수가 남았을 때 */
export function canRefill(wallet, currency, baseUnit) {
  const bal = wallet?.[currency] ?? 0;
  const left = wallet?.[`${currency}RefillsLeft`] ?? 0;
  return bal < minEntry(baseUnit) && bal < REFILL_TO && left > 0;
}

/**
 * 무료 충전 (하루 3번, 10,000으로 채움)
 * → { ok, reason?: 'enough' | 'limit', chips, nyang, ... }
 */
export const refill = (currency, baseUnit) => call('refill', { p_currency: currency, p_min_required: minEntry(baseUnit) });

/**
 * 랭킹: game = 'casino'(칩) | 'matgo'(냥)
 * → [{ key: userId, nickname, amount }] 많은 순
 */
export async function getRanking(game, limit = 500) {
  const view = game === 'matgo' ? 'matgo_ranking' : 'casino_ranking';
  const { data, error } = await supabase.from(view).select('user_id,nickname,amount').order('amount', { ascending: false }).limit(limit);
  if (error) throw new WalletError('랭킹을 불러오지 못했어요');
  return (data ?? []).map((r) => ({ key: r.user_id, nickname: r.nickname, amount: Number(r.amount) }));
}

export const formatAmount = (n) => Number(n ?? 0).toLocaleString('ko-KR');

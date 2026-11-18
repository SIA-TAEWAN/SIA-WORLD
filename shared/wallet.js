// SIA WORLD 지갑: 카지노 칩 · 맞고 냥.
// 잔액은 서버 함수만 바꾼다. 여기서는 조회와 출석·충전 요청만 한다.
import { supabase } from './supabase.js';

export const START_AMOUNT = 10000;
export const REFILL_TO = 10000;
/** 무료 충전 한 번에 더해 주는 금액 */
export const REFILL_AMOUNT = 10000;
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
 * → { chips, nyang, siaCoins, chipsRefillsLeft, nyangRefillsLeft }
 *   siaCoins: 시아코인 (게임 한 판을 정상적으로 끝낼 때마다 서버가 1개씩 준다. 033_sia_coin.sql)
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
 * 무료 충전 (하루 3번, 지금 금액에 10,000을 더함)
 * → { ok, reason?: 'enough' | 'limit', chips, nyang, ... }
 */
export const refill = (currency, baseUnit) => call('refill', { p_currency: currency, p_min_required: minEntry(baseUnit) });

/** 랭킹 종류: 단위와 등급 기준 (이 값 이하는 구름) */
export const RANKINGS = {
  casino: { label: '🪙 카지노', unit: '칩', base: START_AMOUNT, note: '보유 칩 순' },
  matgo: { label: '💰 맞고', unit: '냥', base: START_AMOUNT, note: '보유 냥 순' },
  tank: { label: '💣 시아탱크', unit: '승', base: 0, note: '온라인 대전 승수 순 (같으면 승률이 높은 사람이 위)', cloud: '1승도 없으면 구름' },
  target: { label: '🎯 백발백중', unit: '점', base: 0, note: '백발백중 최고 점수 순' },
};

/** 승률 (0~1). 한 판도 안 했으면 0 */
export const winRate = (wins, losses) => (wins + losses > 0 ? wins / (wins + losses) : 0);

/**
 * 시아탱크 대전 랭킹: 승수 많은 순 → 승률 높은 순 → 패가 적은 순.
 * amount는 줄 세우기용 값(승수 + 승률의 절반: 승수가 같으면 승률로 갈리고, 둘 다 같으면 같은 순위), text는 화면에 보일 글자.
 */
async function tankWinRanking(limit) {
  const { data, error } = await supabase
    .from('player_points')
    .select('user_id,legacy_id,wins,losses,profiles(nickname)')
    .order('wins', { ascending: false })
    .limit(limit);
  if (error) throw new WalletError('랭킹을 불러오지 못했어요');
  return (data ?? [])
    .map((r) => {
      const wins = Number(r.wins) || 0;
      const losses = Number(r.losses) || 0;
      return {
        key: r.user_id ?? `legacy:${r.legacy_id}`,
        nickname: r.profiles?.nickname ?? r.legacy_id ?? '?',
        wins,
        losses,
        amount: wins + winRate(wins, losses) / 2,
        text: `${wins}승 ${losses}패`,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.losses - b.losses);
}

/** 시아탱크 랭킹 (대전 승패 / 백발백중): 가입자는 닉네임, 아직 이어받지 않은 예전 기록은 예전 ID */
async function tankRanking(kind, limit) {
  if (kind !== 'target') return tankWinRanking(limit);
  const table = 'target_scores';
  const col = 'best';
  const { data, error } = await supabase
    .from(table)
    .select(`user_id,legacy_id,${col},profiles(nickname)`)
    .order(col, { ascending: false })
    .limit(limit);
  if (error) throw new WalletError('랭킹을 불러오지 못했어요');
  return (data ?? []).map((r) => ({
    key: r.user_id ?? `legacy:${r.legacy_id}`,
    nickname: r.profiles?.nickname ?? r.legacy_id ?? '?',
    amount: Number(r[col]),
  }));
}

/**
 * 랭킹: game = 'casino'(칩) | 'matgo'(냥) | 'tank'(시아탱크 대전 승패) | 'target'(백발백중 최고 점수)
 * → [{ key: userId, nickname, amount, text? }] 높은 순 (text가 있으면 금액 대신 그 글자를 보여 준다)
 */
export async function getRanking(game, limit = 500) {
  if (game === 'tank' || game === 'target') return tankRanking(game, limit);
  const view = game === 'matgo' ? 'matgo_ranking' : 'casino_ranking';
  const { data, error } = await supabase.from(view).select('user_id,nickname,amount').order('amount', { ascending: false }).limit(limit);
  if (error) throw new WalletError('랭킹을 불러오지 못했어요');
  return (data ?? []).map((r) => ({ key: r.user_id, nickname: r.nickname, amount: Number(r.amount) }));
}

export const formatAmount = (n) => Number(n ?? 0).toLocaleString('ko-KR');

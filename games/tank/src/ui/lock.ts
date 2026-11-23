import { TANKS, TANK_IDS, type TankId } from '../game/data';
import { UNLOCK_LABEL, isTankOpen } from '../game/unlock';
import { unlockButtonHtml } from './unlockBtn';

/** 잠긴 탱크 칸의 자물쇠 (오른쪽 위) */
export const lockBadge = '<i class="lock" aria-hidden="true">🔒</i>';

/** 잠긴 탱크 칸의 말풍선 글 */
export const lockTitle = (id: TankId) => `${TANKS[id].name} (${TANKS[id].animal}) · 잠김 · ${UNLOCK_LABEL}`;

/** 탱크 고르기 아래 '시아코인 100개로 열기' 버튼 (모두 열렸으면 빈 글) */
export function lockNote(): string {
  const html = unlockButtonHtml(TANK_IDS.filter((t) => !isTankOpen(t)).map((t) => TANKS[t].name));
  return html ? `<div class="lock-note">${html}</div>` : '';
}

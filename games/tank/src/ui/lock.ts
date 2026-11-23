import { TANKS, TANK_IDS, type TankId } from '../game/data';
import { LOCK_HINT, isTankOpen } from '../game/unlock';

/** 잠긴 탱크 칸의 자물쇠 (오른쪽 위) */
export const lockBadge = '<i class="lock" aria-hidden="true">🔒</i>';

/** 잠긴 탱크 칸의 말풍선 글 */
export const lockTitle = (id: TankId) => `${TANKS[id].name} (${TANKS[id].animal}) · 잠김 · ${LOCK_HINT}`;

/** 탱크 고르기 아래 한 줄 안내 (모두 열렸으면 빈 글) */
export function lockNote(): string {
  const locked = TANK_IDS.filter((t) => !isTankOpen(t));
  return locked.length ? `<p class="lock-note">🔒 ${locked.map((t) => TANKS[t].name).join('·')}는 ${LOCK_HINT}</p>` : '';
}

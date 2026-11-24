import { UNLOCK_CONFIRM, UNLOCK_CONFIRM_MS, UNLOCK_LABEL, condText, getProgress, progressDone, refreshProgress, unlockCat } from '../game/unlock';
import { buyCharacter, buyMessage } from '../net/world';

/**
 * 잠긴 고양이의 '시아코인 100개로 열기' 버튼.
 * 처음 누르면 4초 동안 확인 글로 바뀌고, 그 안에 한 번 더 누르면 산다. 사는 중에는 막아 두 번 사지 않게.
 * 화면이 자주 다시 그려지므로(방 상태가 바뀔 때마다) 확인·진행 상태는 여기 모듈에 둔다.
 */
let armedUntil = 0;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * 잠긴 캐릭터 이름들 → 버튼 HTML (모두 열렸으면 '').
 * 구매 조건(시아레이스 30번 완주)을 아직 못 넘었으면 버튼 대신 남은 조건과 지금 값 ("시아레이스를 30번 완주하면 열 수 있어요 · 지금 12번").
 */
export function unlockButtonHtml(lockedNames: readonly string[]): string {
  if (!lockedNames.length) return '';
  const p = getProgress();
  if (!progressDone(p)) return `<p class="unlock-cond">🔒 ${lockedNames.join('·')} · ${condText(p?.have)}</p>`;
  const armed = Date.now() < armedUntil;
  const text = busy ? '여는 중…' : armed ? UNLOCK_CONFIRM : `🔒 ${lockedNames.join('·')} · ${UNLOCK_LABEL}`;
  return `<button type="button" class="unlock-btn ${armed ? 'armed' : ''}" data-unlock="cat" ${busy ? 'disabled' : ''}>${text}</button>`;
}

export interface UnlockHooks {
  /** 버튼을 다시 그린다 */
  repaint(): void;
  toast(msg: string): void;
  /** 열렸다: 고양이를 골라 둔다 */
  opened(): void;
}

/** 버튼(또는 잠긴 칸)을 눌렀다 */
export async function pressUnlock(h: UnlockHooks): Promise<void> {
  if (busy) return;
  // 조건을 아직 못 넘었으면 (잠긴 칸을 누른 경우) 남은 조건만 알린다
  if (!progressDone()) {
    h.toast(condText(getProgress()?.have));
    return;
  }
  if (Date.now() >= armedUntil) {
    armedUntil = Date.now() + UNLOCK_CONFIRM_MS;
    clearTimeout(timer);
    timer = setTimeout(h.repaint, UNLOCK_CONFIRM_MS + 50);
    h.repaint();
    return;
  }
  clearTimeout(timer);
  armedUntil = 0;
  busy = true;
  h.repaint();
  try {
    const r = await unlockCat(buyCharacter);
    if (r.result.reason === 'condition') {
      // 조건 미달 (다른 기기와 어긋난 경우 등): 남은 조건 글로 바뀐다
      h.toast(condText(r.result.have));
      void refreshProgress();
    } else h.toast(r.local ? '열었어요! (테스트 모드라 시아코인은 쓰지 않아요)' : await buyMessage(r.result, 'cat'));
    if (r.opened) h.opened();
  } finally {
    busy = false;
    h.repaint();
  }
}

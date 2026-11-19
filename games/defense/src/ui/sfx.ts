/**
 * 시아디펜스 효과음: SIA WORLD 공용 효과음(shared/sound.js, ZzFX)을 쓴다. 켜기/끄기는 공용 설정('sia:sound').
 * 1~3단계에서는 공용 모듈에 이미 있는 소리 이름만 쓴다. 시아디펜스 전용 소리와 배경음은 8단계에서 더한다 (ASSETS.md).
 */
import { loadSound, type SoundModule } from '../net/world';

let shared: SoundModule | null = null;
void loadSound().then(
  (m) => (shared = m),
  () => undefined,
);

export function sfx(name: string, opts?: { delay?: number; volume?: number; rate?: number }) {
  shared?.play(name, opts);
}

/**
 * 캐릭터 공격음: 캐릭터가 여럿이면 초당 수십 번 울리므로 동시에 나는 수를 줄인다 (PRD 12장).
 * 어느 캐릭터든 합쳐서 0.11초에 한 번만, 작게 낸다 (공용 모듈의 이름별 최소 간격·동시 6개 제한도 그대로 적용된다).
 */
const ATTACK_GAP_MS = 110;
let lastAttackAt = -1e9;
export function attackSfx(name: string, rate = 1) {
  const now = performance.now();
  if (now - lastAttackAt < ATTACK_GAP_MS) return;
  lastAttackAt = now;
  shared?.play(name, { volume: 0.3, rate });
}

export const sound = {
  get on() {
    return shared ? !shared.isMuted() : true;
  },
  set(on: boolean) {
    shared?.setMuted(!on);
  },
};

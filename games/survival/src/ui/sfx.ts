/**
 * 시아서바이벌 효과음: SIA WORLD 공용 효과음(shared/sound.js, ZzFX)을 쓴다.
 * 효과음 켜기/끄기는 공용 설정('sia:sound'), 배경음은 따로('sia:bgm').
 */
import { loadSound, type SoundModule } from '../net/world';

let shared: SoundModule | null = null;
const ready: (() => void)[] = [];
void loadSound().then(
  (m) => {
    shared = m;
    ready.splice(0).forEach((f) => f());
  },
  () => undefined,
);

/** 공용 소리 모듈을 불러온 뒤에 실행 */
export function whenSound(fn: () => void) {
  if (shared) fn();
  else ready.push(fn);
}

export type SfxName =
  | 'click' | 'toggle' | 'coin' | 'chip' | 'win' | 'lose' | 'cutin' | 'tankHeal' | 'tankBoom' | 'newRecord' | 'boost'
  | 'survShot' | 'survSlash' | 'survPop' | 'survBell' | 'survHurt' | 'survLevel' | 'survBossWarn' | 'survBossDown' | 'survChest';

export function sfx(name: SfxName | string, opts?: { delay?: number; volume?: number; rate?: number }) {
  shared?.play(name, opts);
}

/**
 * 무기 효과음: 무기가 여러 개면 초당 수십 번 울리므로 동시에 나는 수를 줄인다.
 * 어느 무기든 합쳐서 0.11초에 한 번만, 작게 낸다 (공용 모듈의 이름별 최소 간격·동시 6개 제한도 그대로 적용된다).
 */
const WEAPON_GAP_MS = 110;
let lastWeaponAt = -1e9;
export function weaponSfx(name: SfxName, rate = 1) {
  const now = performance.now();
  if (now - lastWeaponAt < WEAPON_GAP_MS) return;
  lastWeaponAt = now;
  shared?.play(name, { volume: 0.35, rate });
}

export const sound = {
  get sfxOn() {
    return shared ? !shared.isMuted() : true;
  },
  setSfx(on: boolean) {
    shared?.setMuted(!on);
  },
  get bgmOn() {
    return shared ? shared.isBgmOn() : true;
  },
  setBgm(on: boolean) {
    shared?.setBgmOn(on);
  },
  /** 공용 배경음 파일 틀기 (shared/sound.js playBgm). 공용 모듈이 없으면 아무 일도 없다 */
  playBgm(game: string, scene: string) {
    shared?.playBgm(game, scene);
  },
  stopBgm() {
    shared?.stopBgm();
  },
};

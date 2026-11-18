/**
 * 시아레이스 효과음: SIA WORLD 공용 효과음(shared/sound.js, ZzFX)을 쓴다.
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
  | 'click' | 'toggle' | 'raceReady' | 'raceGo' | 'raceFoul' | 'step' | 'jump' | 'land' | 'slide' | 'mud' | 'hurdleHit' | 'slip' | 'logHit' | 'boost' | 'goal'
  | 'rankShow' | 'newRecord';

export function sfx(name: SfxName | string, opts?: { delay?: number; volume?: number; rate?: number }) {
  shared?.play(name, opts);
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
  onBgm(fn: (on: boolean) => void) {
    whenSound(() => shared!.onBgmChange(fn));
  },
  bgmFile(name: string): Promise<string | null> {
    return shared ? shared.bgmFileUrl(name) : Promise.resolve(null);
  },
};

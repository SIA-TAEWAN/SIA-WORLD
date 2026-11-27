/**
 * 시아디펜스 효과음: SIA WORLD 공용 효과음(shared/sound.js, ZzFX)을 쓴다. 켜기/끄기는 공용 설정('sia:sound').
 * 공용 모듈에 이미 있는 소리 이름만 쓴다 (공용 파일을 고치지 않는다). 배경음은 ui/music.ts (효과음과 따로 'sia:bgm').
 * 배경음과 효과음은 따로 켜고 끈다 (⚙️ 공용 설정 창 · 일시정지 창, 시아레이스와 같다).
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
  /** ⚙️ 공용 소리 설정 창 (배경음·효과음 따로) */
  openSettings() {
    shared?.openSoundSettings();
  },
  /** 공용 배경음 파일 틀기 (shared/sound.js playBgm, 배경음 끄기를 따른다). 공용 모듈이 없으면 아무 일도 없다 */
  playBgm(game: string, scene: string) {
    shared?.playBgm(game, scene);
  },
  stopBgm() {
    shared?.stopBgm();
  },
};

/**
 * 시아의탑 배경음: 공용 배경음 파일 재생(shared/sound.js 의 playBgm)에 맡긴다.
 * 파일은 shared/audio/bgm/tower/main.mp3 · boss.mp3 (없으면 공용 곡), 이기고 진 곡은 common/win · lose.mp3 (한 번만).
 * 켜기/끄기(공용 'sia:sound' · 'sia:bgm'), 첫 입력 기다리기, 가려진 탭 멈춤은 공용 모듈이 한다.
 * 공용 모듈을 못 불러오면(로컬·오프라인) 소리 없이 지나간다.
 */
import type { SoundModule } from '../net/world';

/** 보통 화면 · 보스층 · 이겼을 때 · 졌을 때 */
export type BgmScene = 'main' | 'boss' | 'win' | 'lose';

let snd: SoundModule | null = null;
let want: BgmScene | null = null;

function apply() {
  try {
    if (!snd) return;
    if (want) snd.playBgm('tower', want);
    else snd.stopBgm();
  } catch {
    /* 배경음은 없어도 된다 */
  }
}

export const music = {
  /** 공용 효과음 모듈을 붙인다 (붙기 전에 고른 곡도 이때 튼다) */
  attach(m: SoundModule) {
    snd = m;
    apply();
  },
  /** 이 장면의 곡을 튼다 (같은 곡이면 그대로). null = 멈춤 */
  play(scene: BgmScene | null) {
    want = scene;
    apply();
  },
};

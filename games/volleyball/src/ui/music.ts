import { sound, whenSound } from './sfx';

/**
 * 배경음: SIA WORLD 공용 배경음 파일(shared/audio/bgm/volleyball/main|boss.mp3, 승패는 common/win|lose.mp3)을 튼다.
 * 소리 크기·페이드·배경음 켜기/끄기('sia:bgm')·첫 터치 기다리기·가려진 탭은 공용 모듈(shared/sound.js)이 맡는다.
 * 공용 모듈을 못 불러오면(테스트 모드·오프라인) 조용히 아무것도 하지 않는다.
 */
export type BgmScene = 'main' | 'boss' | 'win' | 'lose';

let want: BgmScene | null = null;

function apply() {
  if (want) sound.playBgm(want);
  else sound.stopBgm();
}

export const music = {
  /** 이 장면의 곡을 틀어 둔다 (null = 끄기). 같은 곡이면 그대로 이어진다 */
  play(scene: BgmScene | null) {
    if (scene === want) return;
    want = scene;
    apply();
  },
};

// 공용 모듈을 불러오기 전에 고른 곡은 불러온 뒤에 튼다
whenSound(apply);

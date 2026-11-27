import { sound, whenSound } from './sfx';

/**
 * 배경음: SIA WORLD 공용 배경음 파일(shared/audio/bgm/survival/main.mp3 · boss.mp3, 승리·패배는 common/win · lose)을
 * 공용 모듈(shared/sound.js 의 playBgm)로 튼다. 배경음 켜기/끄기 · 첫 터치 기다리기 · 가려진 탭 멈춤은 공용 모듈이 맡는다.
 * 장면: 메뉴·맵 판 = main, 보스가 나와 있는 동안 = boss, 클리어 = win, 게임 오버 = lose (결과 화면까지 이어진다).
 * 공용 모듈을 못 불러오면(로컬 모드·오프라인) 조용히 아무것도 하지 않는다.
 */
export type BgmScene = 'main' | 'boss' | 'win' | 'lose';

let want: BgmScene | null = null;
let ready = false;

function apply() {
  if (!ready) return;
  if (want) sound.playBgm('survival', want);
  else sound.stopBgm();
}

export const music = {
  /** 이 장면의 곡을 틀어 둔다 (null = 끄기). 같은 곡이면 그대로 이어진다 */
  play(scene: BgmScene | null) {
    want = scene;
    apply();
  },
};

// 공용 모듈을 불러온 뒤 그때까지 고른 곡을 튼다
whenSound(() => {
  ready = true;
  apply();
});

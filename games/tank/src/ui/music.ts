import { loadSound, type SoundModule } from '../net/world';

/**
 * 배경음악: SIA WORLD 공용 배경음(shared/sound.js 의 playBgm, shared/audio/bgm/tank/main|boss.mp3)을 튼다.
 * 볼륨·페이드·첫 터치 기다리기·가려진 탭·소리 끄기는 공용 모듈이 맡는다. 공용 모듈을 못 불러오면(오프라인 등) 조용히.
 */

/** main: 메뉴·대기실·보통 판 / boss: 서든데스(물이 차오른 뒤) / win·lose: 판이 끝났을 때 한 번 */
export type Scene = 'main' | 'boss' | 'win' | 'lose';

let shared: SoundModule | null = null;
let want: Scene | null = null;
/** 판이 끝나고 튼 승리·패배 곡을 다음 화면(결과 화면) 하나 동안 지킨다 */
let holdResult = false;

function apply() {
  if (!shared) return;
  if (want) shared.playBgm('tank', want);
  else shared.stopBgm();
}

void loadSound().then(
  (m) => {
    shared = m;
    apply();
  },
  () => undefined,
);

export const music = {
  /** 이 곡을 틀어 둔다 (null 이면 끈다) */
  play(scene: Scene | null) {
    want = scene;
    holdResult = scene === 'win' || scene === 'lose';
    apply();
  },
  /** 메뉴 화면: 기본 곡. 판이 막 끝났으면 결과 화면 동안은 승리·패배 곡을 그대로 둔다 */
  menu() {
    if (holdResult) {
      holdResult = false;
      return;
    }
    music.play('main');
  },
};

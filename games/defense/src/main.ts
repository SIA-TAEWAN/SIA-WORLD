import './style.css';
import { STARTERS } from './data/characters';
import { LOCAL_MODE, devSetup, getApi } from './net/api';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { loadEngine, loadSquad, nav, screen, setProfile, state, toast } from './ui/app';
import { showMain, showPrepare, showRegions, showStages } from './ui/menus';
import { showResult } from './ui/result';

nav.main = showMain;
nav.regions = showRegions;
nav.stages = showStages;
nav.prepare = showPrepare;
const dev = devSetup();
/** 게임 엔진 묶음을 받는 중인가 (그동안 시작 버튼을 여러 번 눌러도 판은 한 번만 시작한다) */
let starting = false;
nav.game = (setup) => {
  if (starting) return;
  starting = true;
  void loadEngine()
    .then(
      // 개발용 시드(?seed=)는 메뉴에서 시작한 판에도 그대로 적용한다
      (m) => m.showGame({ ...setup, seed: setup.seed ?? dev?.seed ?? undefined }),
      () => toast('게임을 불러오지 못했어요. 다시 눌러 주세요', 3200),
    )
    .finally(() => (starting = false));
};
nav.result = showResult;

/** 테스트 모드(?local=1): 로그인 없이 임시 사용자 (?name= 으로 이름 지정) */
function localUser(): WorldUser {
  const name = new URLSearchParams(location.search).get('name')?.slice(0, 8) || '테스트';
  return { userId: 'local', loginId: 'local', nickname: name };
}

async function start() {
  screen('<div class="connecting"><div class="spinner"></div><p>불러오는 중…</p></div>', 'center');
  let user: WorldUser;
  try {
    if (LOCAL_MODE) user = localUser();
    else {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (게스트 플레이 없음)
      user = await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
    }
  } catch {
    const root = screen(
      `<div class="connecting">SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
        <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`,
      'center',
    );
    root.querySelector('#retry')!.addEventListener('click', () => location.reload());
    return;
  }
  state.user = { id: user.userId, name: user.nickname };
  state.squad = loadSquad();
  // 진행 상황(엽전·별). 못 읽으면 처음 상태로 플레이는 할 수 있다
  try {
    state.api = await getApi(user.userId);
    setProfile(await state.api.loadProfile());
  } catch {
    state.api = null;
    toast('저장된 진행 상황을 읽지 못했어요', 3200);
  }

  // 개발용 테스트 설정: ?local=1&stage=1-5 → 메뉴를 건너뛰고 그 스테이지로 바로 시작
  if (dev?.stage) nav.game({ stage: dev.stage, squad: dev.squad ?? [...STARTERS], seed: dev.seed ?? undefined });
  else nav.main();
}

void start();

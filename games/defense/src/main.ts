import './style.css';
import { SQUAD_SIZE } from './data/balance';
import { ROSTER, STARTERS, towerOf } from './data/characters';
import { LOCAL_MODE, devSetup, getApi } from './net/api';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { loadEngine, loadSquad, nav, screen, setProfile, state, toast } from './ui/app';
import { showMain, showPrepare, showRegions, showStages } from './ui/menus';
import { ENDLESS_ID } from './data/endless';
import { showCodex } from './ui/codex';
import { showResult } from './ui/result';
import { showChars } from './ui/roster';

nav.main = showMain;
nav.regions = showRegions;
nav.stages = showStages;
nav.prepare = showPrepare;
nav.chars = showChars;
nav.codex = showCodex;
const dev = devSetup();
/** 게임 엔진 묶음을 받는 중인가 (그동안 시작 버튼을 여러 번 눌러도 판은 한 번만 시작한다) */
let starting = false;
nav.game = (setup) => {
  if (starting) return;
  starting = true;
  // 지난번에 올리지 못한 결과가 있으면 지금 올린다 (판 시작은 기다리지 않는다)
  void state.api?.resend().catch(() => 0);
  void loadEngine()
    .then(
      // 개발용 설정(?seed= · ?lv= · ?upg=)은 메뉴에서 시작한 판에도 그대로 적용한다
      (m) => m.showGame({ ...setup, seed: setup.seed ?? dev?.seed ?? undefined, lv: setup.lv ?? dev?.lv ?? undefined, upg: setup.upg ?? dev?.upg ?? undefined }),
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
  try {
    state.api = await getApi(user.userId);
  } catch {
    state.api = null;
  }
  const api = state.api;
  // 보류했던 결과가 나중에(판 시작 직전·저장 성공 직후) 올라가면 새 프로필을 화면에 반영한다
  if (api) api.onProfile = setProfile;
  // 프로필(엽전·별·레벨·강화·해금). 못 읽으면 처음 상태로 플레이는 할 수 있다 (그 판은 기록되지 않는다)
  try {
    if (!api) throw new Error('no api');
    // 지난번에 올리지 못한 판 결과가 있으면 먼저 다시 보낸다
    const sent = await api.resend().catch(() => 0);
    setProfile(await api.loadProfile());
    if (sent > 0) toast(`지난번에 올리지 못한 결과 ${sent}판을 올렸어요`, 3200);
  } catch {
    toast('서버에 연결하지 못했어요. 지금은 기록되지 않아요', 3600);
  }
  state.squad = loadSquad();

  // 개발용 테스트 설정: ?local=1&stage=1-5 → 메뉴를 건너뛰고 그 스테이지로 바로 시작
  // (잠금·해금을 보지 않으므로 이렇게 시작한 판은 저장하지 않는다)
  if (dev?.stage) {
    const squad = dev.squad ?? ROSTER.map((c) => c.id).filter((id) => !!towerOf(id) && (dev.lv !== null || state.profile.unlocked.includes(id))).slice(0, SQUAD_SIZE);
    nav.game({ stage: dev.stage, squad: squad.length ? squad : [...STARTERS], seed: dev.seed ?? undefined, lv: dev.lv ?? undefined, upg: dev.upg ?? undefined, offline: true, endless: dev.stage === ENDLESS_ID });
  }
  else nav.main();
}

void start();

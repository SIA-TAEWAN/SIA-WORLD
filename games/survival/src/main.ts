import './style.css';
import { LOCAL_MODE, devSetup, getApi } from './net/api';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { LOBBY_MAX, LobbyFullError, SurvivalLobby } from './net/lobby';
import { loadChar, loadEngine, nav, screen, setProfile, state, toast } from './ui/app';
import { showCodex } from './ui/codex';
import { showCharSelect, showMain, showMapSelect } from './ui/menus';
import { showResult } from './ui/result';
import { showUpgrade } from './ui/upgrade';

nav.main = showMain;
nav.select = showCharSelect;
nav.maps = showMapSelect;
nav.upgrade = showUpgrade;
nav.codex = showCodex;
// 개발용 테스트 설정(?upg=10&t=210)은 메뉴에서 시작한 판에도 그대로 적용한다
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
      (m) => m.showGame({ ...setup, upg: setup.upg ?? dev?.upg ?? undefined, startAt: setup.startAt ?? (dev?.t || undefined) }),
      () => toast('게임을 불러오지 못했어요. 다시 눌러 주세요', 3200),
    )
    .finally(() => (starting = false));
};
nav.result = showResult;

/** 테스트 모드(?local=1): 로그인 없이 임시 사용자 (?name= 으로 이름 지정) */
function localUser(): WorldUser {
  let id = '';
  try {
    id = sessionStorage.getItem('siasurvival:cid') ?? '';
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('siasurvival:cid', id);
    }
  } catch {
    id = crypto.randomUUID();
  }
  const name = new URLSearchParams(location.search).get('name')?.slice(0, 8) || `P${parseInt(id.slice(0, 4), 16) % 1000}`;
  return { userId: id, loginId: 'local', nickname: name };
}

async function start() {
  screen('<div class="connecting"><div class="spinner"></div><p>불러오는 중…</p></div>', 'center', null);
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
      null,
    );
    root.querySelector('#retry')!.addEventListener('click', () => location.reload());
    return;
  }
  state.user = { id: user.userId, name: user.nickname };
  state.char = loadChar();
  try {
    state.api = await getApi(user.userId);
  } catch {
    state.api = null;
  }
  const api = state.api;
  // 보류했던 결과가 나중에(판 시작 직전·저장 성공 직후) 올라가면 새 프로필을 화면에 반영한다
  if (api) api.onProfile = setProfile;
  if (api) {
    // 접속 인원 채널: 정원(최대 30명)을 확인한다. 게임을 하는 동안에도 채널에 남아 있는다
    // 테스트 모드에서는 ?lobbymax=2 처럼 정원을 줄여 볼 수 있다
    const testMax = LOCAL_MODE ? Number(new URLSearchParams(location.search).get('lobbymax')) : 0;
    state.lobby = new SurvivalLobby(api, state.user, testMax >= 1 ? Math.floor(testMax) : LOBBY_MAX);
    try {
      await state.lobby.enter();
    } catch (e) {
      if (!(e instanceof LobbyFullError)) throw e;
      const max = state.lobby.max;
      state.lobby = null;
      const root = screen(
        `<div class="connecting">지금은 사람이 가득 찼어요 (최대 ${max}명).<br/>잠시 후 다시 들어와 주세요<br/><br/>
          <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`,
        'center',
        null,
      );
      root.querySelector('#retry')!.addEventListener('click', () => location.reload());
      return;
    }
  }
  // 프로필(엽전·강화·해금·도감). 못 읽으면 처음 상태로 플레이는 할 수 있다 (그 판은 기록되지 않는다)
  try {
    if (!api) throw new Error('no api');
    // 지난번에 올리지 못한 판 결과가 있으면 먼저 다시 보낸다
    const sent = await api.resend().catch(() => 0);
    setProfile(await api.loadProfile());
    if (sent > 0) toast(`지난번에 올리지 못한 결과 ${sent}판을 올렸어요`, 3200);
  } catch {
    toast('서버에 연결하지 못했어요. 지금은 기록되지 않아요', 3600);
  }

  // 개발용 테스트 설정: ?local=1&map=field&char=tiger&upg=10&t=210 → 메뉴를 건너뛰고 그 상태로 바로 시작
  if (dev?.char) state.char = dev.char;
  if (dev?.auto) nav.game({ char: dev.char!, map: dev.map!, upg: dev.upg ?? undefined, startAt: dev.t, seed: dev.seed ?? undefined });
  else nav.main();
}

void start();

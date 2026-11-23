import './style.css';
import { nav, prefetchEngine, screen, state } from './ui/app';
import { showEntry, showSetup } from './ui/offline';
import { showLobby } from './ui/online';
import { LOCAL_MODE, clientId, setPlayer } from './net';
import { loadAuth, loadCharacterProgress, loadOwnedCharacters, worldHome, type WorldUser } from './net/world';
import { initUnlock, openTankOr } from './game/unlock';

nav.entry = showEntry;
nav.setup = showSetup;
nav.lobby = showLobby;

/** 테스트 모드(?local=1): 로그인 없이 탭마다 다른 플레이어 */
function localUser(): WorldUser {
  const id = clientId();
  return { userId: id, loginId: 'local', nickname: `P${parseInt(id.slice(0, 4), 16) % 1000}` };
}

async function start() {
  screen('<div class="connecting"><div class="spinner"></div><p>불러오는 중…</p></div>', 'center');
  let user: WorldUser;
  try {
    if (LOCAL_MODE) user = localUser();
    else {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소(쿼리 포함)로 돌아온다
      user = await auth.requireLogin();
      // 다른 탭·로비에서 로그아웃하면 여기서도 로그인 화면으로
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
  setPlayer(user.userId, user.nickname);
  state.name = user.nickname;
  state.isAdmin = !!user.isAdmin;
  // 연 추가 캐릭터(고양이)를 불러온다: 저장된 탱크가 잠긴 고양이면 기본 탱크로
  await initUnlock(loadOwnedCharacters, LOCAL_MODE, new URLSearchParams(location.search).get('cat'), loadCharacterProgress);
  state.tank = openTankOr(state.tank);
  nav.lobby();
}

void start();
prefetchEngine();

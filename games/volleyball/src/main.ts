import './style.css';
import { LOCAL_MODE } from './net/api';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { loadChar, loadEngine, nav, screen, state } from './ui/app';
import { showCharSelect, showLobby } from './ui/menus';
import { showResult } from './ui/result';

nav.lobby = showLobby;
nav.select = showCharSelect;
nav.match = (setup) => void loadEngine().then((m) => m.showMatch(setup));
nav.result = showResult;

/** 테스트 모드(?local=1): 로그인 없이 탭마다 다른 플레이어 (?name= 으로 이름 지정) */
function localUser(): WorldUser {
  let id = '';
  try {
    id = sessionStorage.getItem('siavolley:cid') ?? '';
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('siavolley:cid', id);
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
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (AI 대전도 로그인 필수)
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
  // 3단계: 여기서 대기실 채널에 들어가고, 주소에 방 코드(?room=)가 있으면 그 방으로 바로 간다
  nav.lobby();
}

void start();

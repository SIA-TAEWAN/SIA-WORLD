import './style.css';
import { LOCAL_MODE, getApi } from './net/api';
import { cleanRoomCode, validRoomCode } from './net/room';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { loadChar, loadEngine, nav, screen, state } from './ui/app';
import { enterRoom, showLobby, showWaiting } from './ui/menus';
import { showResult } from './ui/result';

nav.lobby = showLobby;
nav.room = (code) => void enterRoom(code);
nav.waiting = showWaiting;
nav.race = (start) => void loadEngine().then((m) => m.showRace(start));
nav.result = showResult;

/** 테스트 모드(?local=1): 로그인 없이 탭마다 다른 플레이어 (?name= 으로 이름 지정) */
function localUser(): WorldUser {
  let id = '';
  try {
    id = sessionStorage.getItem('siarace:cid') ?? '';
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('siarace:cid', id);
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
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소(방 코드 포함)로 돌아온다
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
  state.api = await getApi(user.userId);
  // 주소에 방 코드가 있으면 바로 그 방으로 (친구 초대 링크)
  const code = cleanRoomCode(new URLSearchParams(location.search).get('room'));
  if (validRoomCode(code)) nav.room(code);
  else nav.lobby();
}

void start();

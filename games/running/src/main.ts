import './style.css';
import { LOCAL_MODE, getApi } from './net/api';
import { dropRoomParam } from './net/solo';
import { LOBBY_MAX, enterLobby, loadAuth, loadCharacterProgress, loadOwnedCharacters, worldHome, type WorldUser } from './net/world';
import { initUnlock } from './game/unlock';
import { loadChar, loadEngine, nav, screen, state, toast } from './ui/app';
import { showLobby, showPick, startRun } from './ui/menus';
import { showResult } from './ui/result';

nav.lobby = showLobby;
nav.pick = showPick;
nav.run = () => void startRun();
nav.race = (start) => void loadEngine().then((m) => m.showRace(start));
nav.result = showResult;

/** 테스트 모드(?local=1): 로그인 없이 탭마다 다른 임시 플레이어 (?name= 으로 이름 지정) */
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
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다
      user = await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
      // 접속 인원 (SIA WORLD 로비에 인원·이름이 보인다). 정원(30명)이 차면 들어가지 않는다. 연결을 못 하면 막지 않는다
      const lobby = await enterLobby(user);
      if (lobby?.full) {
        void lobby.leave();
        const root = screen(
          `<div class="connecting">지금은 사람이 가득 찼어요 (최대 ${LOBBY_MAX}명).<br/>잠시 후 다시 들어와 주세요.<br/><br/>
            <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`,
          'center',
          null,
        );
        root.querySelector('#retry')!.addEventListener('click', () => location.reload());
        return;
      }
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
  // 연 추가 캐릭터(고양이)를 먼저 불러온다: 저장된 캐릭터가 잠겨 있으면 기본 캐릭터로
  await initUnlock(loadOwnedCharacters, LOCAL_MODE, new URLSearchParams(location.search).get('cat'), loadCharacterProgress);
  state.char = loadChar();
  state.api = await getApi(user.userId);
  // 예전 초대 링크(?room=코드): 방 경기는 없어졌다. 주소에서 ?room 을 빼고 첫 화면으로
  const clean = dropRoomParam(location.href);
  if (clean) {
    history.replaceState(null, '', clean);
    toast('이제 오늘의 도전으로 달려요', 3000);
  }
  nav.lobby();
}

void start();

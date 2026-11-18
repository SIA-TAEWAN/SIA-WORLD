import './style.css';
import { LOCAL_MODE, devSetup, getApi } from './net/api';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { loadChar, loadEngine, nav, screen, state } from './ui/app';
import { showCharSelect, showMain, showMapSelect } from './ui/menus';
import { showResult } from './ui/result';

nav.main = showMain;
nav.select = showCharSelect;
nav.maps = showMapSelect;
// 개발용 테스트 설정(?upg=10&t=420)은 메뉴에서 시작한 판에도 그대로 적용한다
const dev = devSetup();
nav.game = (setup) =>
  void loadEngine().then((m) => m.showGame({ ...setup, upg: setup.upg ?? (dev ? dev.upg : undefined), startAt: setup.startAt ?? (dev?.t || undefined) }));
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
  state.api = await getApi(user.userId);
  state.profile = await state.api.loadProfile();

  // 개발용 테스트 설정: ?local=1&map=field&char=tiger&upg=10&t=420 → 메뉴를 건너뛰고 그 상태로 바로 시작
  if (dev?.char) state.char = dev.char;
  if (dev?.auto) nav.game({ char: dev.char!, map: dev.map!, upg: dev.upg, startAt: dev.t, seed: dev.seed ?? undefined });
  else nav.main();
}

void start();

import './style.css';
import { LOCAL_MODE, getApi } from './net/api';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { screen } from './ui/app';
import { showVillage } from './ui/village';

/** 테스트 모드(?local=1): 로그인 없이 임시 사용자 (?name= 으로 이름 지정) */
function localUser(): WorldUser {
  const name = new URLSearchParams(location.search).get('name')?.slice(0, 8) || '시아';
  return { userId: 'local', loginId: 'local', nickname: name };
}

function failed(msg: string) {
  const root = screen(
    `<div class="connecting">${msg}<br/><br/>
      <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`,
    'center',
  );
  root.querySelector('#retry')!.addEventListener('click', () => location.reload());
}

async function start() {
  screen('<div class="connecting"><div class="spinner"></div><p>마을로 가는 중…</p></div>', 'center');
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
    return failed('SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.');
  }
  // 마을은 서버에 있다: 못 읽으면 시작할 수 없다
  try {
    const api = await getApi({ id: user.userId, name: user.nickname });
    showVillage(api, { id: user.userId, name: user.nickname }, await api.load());
  } catch {
    failed('마을을 불러오지 못했어요.<br/>잠시 후 다시 시도해 주세요.');
  }
}

void start();

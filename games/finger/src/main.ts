import './style.css';
import { stageOf } from './sim';
import { getApi } from './net/api';
import { LOCAL_MODE } from './net/local';
import { enterLobby, loadAuth, worldHome, type WorldUser } from './net/world';
import { boot, showMain, startGame } from './ui/app';

const params = new URLSearchParams(location.search);

function message(html: string) {
  const app = document.getElementById('app')!;
  app.innerHTML = `<div class="screen"><div class="connecting">${html}</div></div>`;
  return app;
}

async function start() {
  message('<div class="spinner"></div><p>불러오는 중…</p>');
  let user: WorldUser | null = null;
  try {
    if (!LOCAL_MODE) {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (게스트 플레이 없음)
      user = await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
      const lobby = await enterLobby(user);
      if (lobby?.full) {
        void lobby.leave();
        message(`지금은 시아핑거에 사람이 너무 많아요.<br/>잠시 뒤 다시 와 주세요.<br/><br/><a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
        return;
      }
    }
    await boot(await getApi(user?.userId ?? 'local'), user);
  } catch {
    const app = message(`SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
      <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
    app.querySelector('#retry')!.addEventListener('click', () => location.reload());
    return;
  }
  // 개발용: ?local=1&stage=1-3 → 메뉴를 건너뛰고 마지막 파티로 바로 시작
  const st = LOCAL_MODE ? stageOf(params.get('stage') ?? '') : undefined;
  if (st) void startGame(st.id);
  else showMain();
}

void start();

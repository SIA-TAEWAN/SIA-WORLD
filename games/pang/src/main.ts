import './style.css';
import { getApi } from './net/api';
import { LOCAL_MODE } from './net/local';
import { enterLobby, loadAuth, openWorldRanking, worldHome, type WorldUser } from './net/world';
import { startApp } from './ui/app.js';

const boot = document.getElementById('boot')!;
function message(html: string) {
  boot.classList.remove('hidden');
  document.getElementById('main')!.classList.add('hidden');
  boot.innerHTML = html;
}

async function start() {
  let user: WorldUser | null = null;
  try {
    if (!LOCAL_MODE) {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (게스트 플레이 없음)
      user = await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
      // 접속 인원 (로비에 보인다). 정원이 차면 들어가지 않는다
      const lobby = await enterLobby(user);
      if (lobby?.full) {
        void lobby.leave();
        message(`지금은 시아팡팡에 사람이 너무 많아요.<br/>잠시 뒤 다시 와 주세요.<br/><br/><a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
        return;
      }
    }
    const api = await getApi(LOCAL_MODE);
    const state = await api.state();
    boot.classList.add('hidden');
    document.getElementById('main')!.classList.remove('hidden');
    const meId = user?.userId ?? null;
    startApp({ api, state, local: LOCAL_MODE, worldHome, openRanking: () => (meId ? openWorldRanking(meId) : Promise.resolve(false)) });
  } catch {
    message(`SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
      <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
    boot.querySelector('#retry')!.addEventListener('click', () => location.reload());
  }
}

void start();

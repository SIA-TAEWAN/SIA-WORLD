import './style.css';
import { LOCAL_MODE, getApi } from './net/api';
import { loadAuth, loadSound, worldHome } from './net/world';
import { showAdopt } from './ui/adopt';
import { setSound } from './ui/common';
import { showRoom } from './ui/room';
import { showGallery } from './ui/gallery';

const app = document.getElementById('app')!;

function failed(msg: string) {
  app.innerHTML = `<div class="connecting">${msg}<br/><br/>
    <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`;
  app.querySelector('#retry')!.addEventListener('click', () => location.reload());
}

async function start() {
  app.innerHTML = '<div class="connecting">고양이에게 가는 중…</div>';
  // 개발용: ?local=1&gallery=1 → 털 색 × 자세 그림 확인
  if (LOCAL_MODE && new URLSearchParams(location.search).get('gallery') === '1') return showGallery(app);
  try {
    if (!LOCAL_MODE) {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (게스트 플레이 없음)
      await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
    }
  } catch {
    return failed('SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.');
  }
  void loadSound().then(setSound, () => setSound(null));
  try {
    const api = await getApi();
    const { state, away } = await api.state(true);
    if (!state.cats.length) {
      showAdopt(app, api, (st) => showRoom(app, { api, state: st, away: 0, worldHome: worldHome(), fresh: true }));
    } else showRoom(app, { api, state, away, worldHome: worldHome() });
  } catch (e) {
    console.error(e);
    failed('고양이 집을 불러오지 못했어요.<br/>잠시 후 다시 시도해 주세요.');
  }
}

void start();

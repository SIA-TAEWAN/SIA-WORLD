import './style.css';
import { preloadUi } from './art';
import { LOCAL_MODE } from './net/local';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { boot, showFirst } from './ui/app';

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
    }
    // 글꼴이 준비된 뒤에 캔버스 글자를 그린다
    try {
      await Promise.race([document.fonts.load('20px Jua'), new Promise((r) => setTimeout(r, 2500))]);
    } catch {
      /* 글꼴 없이도 된다 */
    }
    // 카드 틀·지도 칸 그림 (못 읽으면 코드 그림)
    await preloadUi();
    boot(user);
  } catch {
    const app = message(`SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
      <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a>`);
    app.querySelector('#retry')!.addEventListener('click', () => location.reload());
    return;
  }
  showFirst();
}

void start();

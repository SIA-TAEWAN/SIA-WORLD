import './style.css';
import { stageOf } from './data/stages';
import { loadAuth, worldHome } from './net/world';
import { showMain, startGame } from './ui/app';

import { LOCAL_MODE } from './net/local';

const params = new URLSearchParams(location.search);

async function start() {
  const app = document.getElementById('app')!;
  app.innerHTML = '<div class="screen"><div class="connecting"><div class="spinner"></div><p>불러오는 중…</p></div></div>';
  if (!LOCAL_MODE) {
    try {
      const auth = await loadAuth();
      // 로그인 안 했으면 SIA WORLD 로그인 화면으로 갔다가 이 주소로 돌아온다 (게스트 플레이 없음)
      await auth.requireLogin();
      auth.onSignedOut(() => location.replace(auth.loginUrl()));
    } catch {
      app.innerHTML = `<div class="screen"><div class="connecting">SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
        <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div></div>`;
      app.querySelector('#retry')!.addEventListener('click', () => location.reload());
      return;
    }
  }
  // 개발용: ?local=1&stage=1-3 → 메뉴를 건너뛰고 바로 시작
  const st = LOCAL_MODE ? stageOf(params.get('stage') ?? '') : undefined;
  if (st) startGame(st);
  else showMain();
}

void start();

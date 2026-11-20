/**
 * SIA WORLD 앱(PWA) 공용 모듈 — 로비와 모든 게임 페이지가 실행 중에 불러온다 (빌드에 넣지 않는다).
 *  - 사이트 최상위의 sw.js 를 최상위 범위로 등록하고, 새 판본을 자주 확인한다
 *  - 새 판본이 준비되면 아래쪽에 '새 버전이 있어요 · 새로고침' 띠를 띄운다 (눌러야만 새로고침. 게임 중에 저절로 바뀌지 않는다)
 *  - 로비용: 앱 설치 버튼(안드로이드·PC 크롬) / 홈 화면에 추가 안내(아이폰·아이패드 사파리) 상태
 *
 * 게임 페이지: <script type="module" src="../../shared/pwa.js" vite-ignore></script>  (vite-ignore: Vite 가 묶지 않게)
 * 로컬 개발 서버(localhost)에서는 등록하지 않는다 (개발 중 파일이 캐시에 남지 않게). 확인하려면 주소에 ?pwa=1
 */

/** 사이트 최상위 (이 파일은 shared/ 에 있다) */
const ROOT = new URL('../', import.meta.url);

// ---------- 서비스 워커 등록 · 새 판본 확인 ----------

const UPDATE_EVERY_MS = 30 * 60 * 1000;
const UPDATE_GAP_MS = 60 * 1000;

function swAllowed() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!local) return true;
  try {
    if (new URLSearchParams(location.search).get('pwa') === '1') sessionStorage.setItem('sia-pwa-dev', '1');
    return sessionStorage.getItem('sia-pwa-dev') === '1';
  } catch {
    return false;
  }
}

/** 이 페이지를 처음 열 때 이미 서비스 워커가 맡고 있었는지 (처음 설치 때의 controllerchange 는 무시) */
const hadController = !!navigator.serviceWorker?.controller;
/** 사용자가 띠를 눌러 새 판본으로 넘어가는 중 */
let wantReload = false;
let reloading = false;
let reg = null;
let lastCheck = 0;

function reloadOnce() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

function checkUpdate() {
  if (!reg) return;
  lastCheck = Date.now();
  reg.update().catch(() => {});
}

/** 설치가 끝나 기다리는 워커를 지켜본다 */
function watchInstalling(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    // 이미 다른 워커가 이 페이지를 맡고 있을 때만 '업데이트' (처음 설치는 그냥 켜진다)
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
  });
}

async function register() {
  if (!swAllowed()) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wantReload) return reloadOnce();
    // 다른 탭에서 새 판본으로 넘어갔다 → 이 탭은 예전 화면 그대로. 띠만 띄우고 누르면 새로고침
    if (hadController) showUpdateBanner();
  });
  try {
    reg = await navigator.serviceWorker.register(new URL('sw.js', ROOT).href, {
      scope: ROOT.href,
      updateViaCache: 'none',
    });
  } catch {
    return;
  }
  lastCheck = Date.now();
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
  watchInstalling(reg.installing);
  reg.addEventListener('updatefound', () => watchInstalling(reg.installing));
  setInterval(checkUpdate, UPDATE_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > UPDATE_GAP_MS) checkUpdate();
  });
  window.addEventListener('online', checkUpdate);
}

/** 띠를 눌렀다: 기다리는 워커가 있으면 넘어가게 하고 새 워커가 맡으면 한 번 새로고침 */
function applyUpdate() {
  const waiting = reg?.waiting;
  if (!waiting) return reloadOnce();
  wantReload = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // controllerchange 가 오지 않아도 (다른 탭이 먼저 넘겼다 등) 잠시 뒤 새로고침
  setTimeout(reloadOnce, 3000);
}

// ---------- '새 버전이 있어요' 띠 (DESIGN.md: 크림 판 + 갈색 외곽선 + 아래 두께) ----------

let banner = null;

function showUpdateBanner() {
  if (banner || reloading) return;
  const host = document.createElement('div');
  host.id = 'sia-pwa-update';
  // 게임 화면의 스타일과 섞이지 않게 그림자 DOM 안에 그린다
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .bar {
        position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
        z-index: 2147483000; display: flex; align-items: stretch; max-width: calc(100vw - 32px);
        font-family: var(--font, 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif);
        background: var(--panel, #fff8e8); color: var(--ink, #2a1a10);
        border: 3px solid var(--outline, #2a1a10); border-radius: 16px; box-shadow: 0 4px 0 var(--outline, #2a1a10);
        overflow: hidden; animation: up .25s ease-out;
      }
      @keyframes up { from { transform: translate(-50%, 16px); opacity: 0; } to { transform: translateX(-50%); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
      button { font: inherit; color: inherit; background: none; border: 0; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      .go { padding: 10px 14px 10px 16px; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .go b { font-weight: normal; color: var(--sky-deep, #1f6fd1); text-decoration: underline; }
      .x { padding: 0 14px; font-size: 16px; color: var(--ink-soft, #8a6a4a); border-left: 2px solid var(--line-soft, #e2d3b5); }
      .go:active, .x:active { background: var(--panel-strong, #fff4c2); }
      button:focus-visible { outline: 3px solid var(--sky-deep, #1f6fd1); outline-offset: -3px; }
    </style>
    <div class="bar" role="status">
      <button class="go" type="button">새 버전이 있어요 · <b>새로고침</b></button>
      <button class="x" type="button" aria-label="닫기">✕</button>
    </div>`;
  root.querySelector('.go').addEventListener('click', applyUpdate);
  root.querySelector('.x').addEventListener('click', () => {
    host.remove();
    banner = null;
  });
  banner = host;
  (document.body ?? document.documentElement).append(host);
}

// ---------- 앱 설치 (로비에서 쓴다) ----------

const IOS_HINT_KEY = 'sia-world-ios-install-hint-closed';
const installListeners = new Set();
/** 크롬이 준 설치 창 (beforeinstallprompt) */
let deferredPrompt = null;
let installed = false;

/** 홈 화면에 설치된 앱으로 열려 있는지 */
export function isStandalone() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {
    /* 오래된 브라우저 */
  }
  return navigator.standalone === true;
}

const UA = navigator.userAgent;
/** 아이폰·아이패드 (아이패드OS 는 맥처럼 보이지만 터치가 된다) */
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** 아이폰·아이패드의 진짜 사파리 (크롬·파이어폭스·카카오톡 등 앱 안 브라우저는 뺀다) */
const isIOSSafari =
  isIOS &&
  /Safari\//.test(UA) &&
  !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|KAKAOTALK|NAVER|DaumApps|Whale|Line\/|Instagram|FBAN|FBAV|FB_IAB|GSA\//i.test(UA);

function iosHintClosed() {
  try {
    return localStorage.getItem(IOS_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** 지금 보여 줄 설치 안내: canInstall(설치 버튼) · iosHint(홈 화면에 추가 안내) */
export function installState() {
  const standalone = isStandalone();
  return {
    standalone,
    canInstall: !standalone && !installed && !!deferredPrompt,
    iosHint: !standalone && isIOSSafari && !iosHintClosed(),
  };
}

function emitInstall() {
  const s = installState();
  for (const cb of installListeners) {
    try {
      cb(s);
    } catch {
      /* 화면 쪽 오류가 다른 구독을 막지 않게 */
    }
  }
}

/** 설치 안내 상태가 바뀔 때마다 부른다 (처음에도 한 번). 그만 들으려면 돌려준 함수를 부른다 */
export function onInstallChange(cb) {
  installListeners.add(cb);
  cb(installState());
  return () => installListeners.delete(cb);
}

/** 설치 창을 띄운다. 설치했으면 true */
export async function promptInstall() {
  const e = deferredPrompt;
  if (!e) return false;
  deferredPrompt = null;
  emitInstall();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice?.outcome === 'accepted';
  } catch {
    return false;
  }
}

/** 아이폰 '홈 화면에 추가하는 법' 안내를 닫고 다시 보이지 않게 */
export function dismissIosHint() {
  try {
    localStorage.setItem(IOS_HINT_KEY, '1');
  } catch {
    /* 저장 못 하면 이번에만 닫힌다 */
  }
  emitInstall();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // 크롬 기본 띠 대신 로비의 '앱으로 설치' 버튼으로
  deferredPrompt = e;
  emitInstall();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  deferredPrompt = null;
  emitInstall();
});
try {
  window.matchMedia('(display-mode: standalone)').addEventListener('change', emitInstall);
} catch {
  /* 오래된 브라우저 */
}

void register();

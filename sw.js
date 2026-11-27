/*
 * SIA WORLD 서비스 워커 (사이트 최상위 = 앱 범위 전체: 로비 + 모든 게임).
 *
 * 판본: VERSION 은 배포할 때 deploy.yml 이 커밋 해시로 바꿔 넣는다 → 배포마다 이 파일 내용이 달라져
 * 브라우저가 새 워커를 받는다. 캐시 이름에 판본이 들어가 있어 새 워커가 켜지면 예전 캐시는 지운다.
 * 로컬에서는 바뀌지 않은 값 그대로 동작한다.
 *
 * 받는 규칙
 *  - 페이지(HTML 이동), shared/*.js, shared/*.css: 네트워크 먼저 → 실패하면 캐시 → 그것도 없으면 offline.html
 *  - Vite 가 해시를 붙인 파일(assets/이름-해시.js|css|png …), 글꼴(구글 글꼴 포함),
 *    판본을 박은 CDN 모듈(cdn.jsdelivr.net/npm/이름@1.2.3): 캐시 먼저 (주소가 같으면 내용도 같다)
 *  - 해시 없는 그림·소리(shared/images, sounds 등): 캐시로 바로 주고 뒤에서 새로 받아 캐시를 바꾼다
 *    (stale-while-revalidate: 파일을 바꿔 올리면 다음번 열 때부터 새 것)
 *  - 캐시에 넣기는 응답을 기다리게 하지 않고 event.waitUntil 로 (워커가 넣기 전에 꺼지지 않게)
 *  - 배경음 파일(shared/audio/…mp3): 크기가 커서 손대지 않는다 (바로 네트워크, 브라우저 HTTP 캐시만)
 *  - Supabase(REST·Realtime·Edge Function·로그인), GET 이 아닌 요청, 그 밖의 주소: 손대지 않는다 (바로 네트워크)
 *
 * 새 워커는 설치돼도 스스로 넘어가지 않는다 (게임 중에 갑자기 바뀌지 않게).
 * 페이지(shared/pwa.js)가 '새 버전이 있어요' 띠를 보여 주고, 사용자가 누르면 SKIP_WAITING 을 보낸다.
 */
const VERSION = '__SW_VERSION__';
const PAGES = `sia-pages-${VERSION}`; // HTML·공용 코드 (네트워크 먼저)
const STATIC = `sia-static-${VERSION}`; // 해시 파일·글꼴(캐시 먼저) · 그림·소리(캐시로 주고 뒤에서 갱신)
const OFFLINE_URL = new URL('offline.html', self.registration.scope).href;
/** 설치할 때 미리 받아 두는 것 (인터넷이 끊겨도 안내 화면은 뜨게) */
const PRECACHE = ['offline.html', 'shared/images/app/icon-192.png'].map((p) => new URL(p, self.registration.scope).href);

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
/** 판본을 박은 CDN 모듈 (shared/supabase.js 의 supabase-js@2.x.y 등): 주소가 같으면 내용도 같다 → 캐시 먼저 */
const PINNED_CDN_RE = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+/;
/** Vite 가 해시를 붙인 빌드 파일 (assets/이름-해시.js|css, 코드에서 불러온 그림도 assets/이름-해시.png) */
const HASHED_RE = /\/assets\/[^/]+-[\w-]{6,}\.\w+$/;
const FONT_RE = /\.(?:woff2?|ttf|otf)$/i;
const MEDIA_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp3|ogg|oga|wav|m4a|aac)$/i;
const SHARED_CODE_RE = /^shared\/[^/]+\.(?:js|css)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
  // skipWaiting 은 부르지 않는다: 처음 설치(지금 페이지를 맡은 워커가 없을 때)는 바로 켜지고,
  // 업데이트는 사용자가 띠를 눌러야 넘어간다.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC]);
      for (const key of await caches.keys()) if (key.startsWith('sia-') && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // 소리·영상의 부분 요청(Range)은 캐시에서 통째로 주면 재생이 깨질 수 있다 → 그대로 네트워크
  if (req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  if (FONT_HOSTS.has(url.hostname) || PINNED_CDN_RE.test(req.url)) {
    event.respondWith(cacheFirst(event, true));
    return;
  }
  // 같은 사이트, 앱 범위 안만 맡는다
  const scope = self.registration.scope;
  if (url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
  const rel = url.pathname.slice(new URL(scope).pathname.length);

  // 배경음(shared/audio/): 곡마다 몇 MB 라 캐시에 넣지 않는다 (브라우저가 조금씩 받아 재생한다)
  if (rel.startsWith('shared/audio/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, true));
    return;
  }
  if (SHARED_CODE_RE.test(rel)) {
    event.respondWith(networkFirst(event, false));
    return;
  }
  if (HASHED_RE.test(url.pathname) || FONT_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(event, false));
    return;
  }
  if (MEDIA_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
  // 나머지(JSON 등)는 손대지 않는다
});

/** 네트워크 먼저 (HTTP 캐시도 건너뛰고 서버에 확인) → 실패하면 캐시 → 페이지면 offline.html */
async function networkFirst(event, isPage) {
  const req = event.request;
  const cache = await caches.open(PAGES);
  // 페이지는 주소 뒤 ?redirect=… 같은 값과 상관없이 한 칸에 둔다
  const key = isPage ? withoutSearch(req.url) : req;
  try {
    // 이동 요청은 init 을 주면 mode 가 same-origin 으로 바뀌지만 redirect: manual 은 그대로라
    // /games/tank → /games/tank/ 같은 주소 고침은 브라우저가 그대로 따라간다
    const res = await fetch(new Request(req, { cache: 'no-cache' }));
    if (res.ok && res.type === 'basic') keep(event, cache, key, res);
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    if (isPage) {
      const off = await cache.match(OFFLINE_URL);
      if (off) return off;
    }
    throw err;
  }
}

function withoutSearch(href) {
  const u = new URL(href);
  u.search = '';
  u.hash = '';
  return u.href;
}

/** 캐시 먼저 → 없으면 받아서 넣는다. 다른 사이트(구글 글꼴)는 불투명 응답도 넣는다 */
async function cacheFirst(event, crossOrigin) {
  const req = event.request;
  const cache = await caches.open(STATIC);
  // 미리 넣어 둔 것(오프라인 화면의 아이콘은 PAGES 칸에 있다)까지 모든 칸에서 찾는다
  const hit = (await cache.match(req)) || (await caches.match(req));
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || (crossOrigin && res.type === 'opaque')) keep(event, cache, req, res);
  return res;
}

/**
 * 캐시에 있으면 바로 주고, 뒤에서 새로 받아 캐시를 바꿔 둔다 (다음번엔 새 것).
 * 캐시에 없으면 받은 것을 주면서 넣는다. 뒤에서 받다 실패해도 캐시 것은 그대로 쓴다
 * (no-cors 그림의 불투명 응답은 type 이 basic 이 아니라 넣지 않는다 — 같은 사이트 그림은 basic 이다)
 */
async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(STATIC);
  const hit = (await cache.match(req)) || (await caches.match(req));
  // 뒤에서 다시 받을 때는 HTTP 캐시(GitHub Pages max-age=600)를 건너뛰고 서버에 확인한다.
  // new Request(req, init) 는 mode(그림은 no-cors)·credentials 를 그대로 물려받는다 (networkFirst 와 같은 방식)
  const fresh = fetch(hit ? new Request(req, { cache: 'no-cache' }) : req).then((res) => {
    if (res.ok && res.type === 'basic') keep(event, cache, req, res);
    return res;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

/** 응답 사본을 캐시에 넣는다: 응답은 기다리지 않고 바로 주고, 넣기는 waitUntil 로 마저 끝낸다 */
function keep(event, cache, key, res) {
  const put = cache.put(key, res.clone()).catch(() => {});
  try {
    event.waitUntil(put);
  } catch {
    /* 이벤트가 이미 끝났다: 넣기는 그대로 진행된다 */
  }
}

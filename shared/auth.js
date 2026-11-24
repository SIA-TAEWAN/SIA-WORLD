// SIA WORLD 공통 로그인.
// 사용자에게는 아이디만 보이고, Supabase Auth에는 `<아이디>@sia-world.local` 이메일로 넣는다.
import { supabase } from './supabase.js';
import { gameForPath, loadGameOpen } from './games.js';

/** SIA WORLD 최상위 주소 (이 파일이 shared/ 안에 있으므로 한 단계 위) */
export const ROOT = new URL('../', import.meta.url);
const EMAIL_DOMAIN = 'sia-world.local';

export const LOGIN_ID_RE = /^[a-z0-9]{4,16}$/;
export const NICKNAME_RE = /^[가-힣a-zA-Z0-9]{2,8}$/;
export const PASSWORD_MIN = 6;

/** 칸 하나에 대한 오류 (field: 'loginId' | 'password' | 'password2' | 'nickname' | 'legacy' | null) */
export class AuthError extends Error {
  constructor(message, field = null) {
    super(message);
    this.field = field;
  }
}

const toEmail = (loginId) => `${loginId}@${EMAIL_DOMAIN}`;

// ---------- 입력 확인 ----------

export function loginIdProblem(v) {
  if (!LOGIN_ID_RE.test(v)) return '아이디는 영문 소문자·숫자 4~16자예요';
  return null;
}
export function nicknameProblem(v) {
  if (!NICKNAME_RE.test(v)) return '닉네임은 한글·영문·숫자 2~8자예요';
  return null;
}
export function passwordProblem(v) {
  if (v.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이에요`;
  return null;
}

const NET_ERROR = '서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요';
/** 아이디는 남에게 보이지 않는 열이라(098) 서버 함수로만 확인한다 */
export async function isLoginIdTaken(loginId) {
  const { data, error } = await supabase.rpc('login_id_taken', { p_login: loginId });
  if (error) throw new AuthError(NET_ERROR);
  return data === true;
}
export async function isNicknameTaken(nickname) {
  const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('nickname', nickname);
  if (error) throw new AuthError(NET_ERROR);
  return (count ?? 0) > 0;
}

/**
 * 예전 시아탱크 랭킹 기록 확인.
 * password를 비우면 '이어받을 기록이 있는지'만 본다 → 'none' | 'wrong'
 * password를 넣으면 예전 비밀번호까지 확인 → 'none' | 'ok' | 'wrong'
 */
export async function checkLegacy(loginId, password = '') {
  const { data, error } = await supabase.rpc('check_legacy', { p_login: loginId, p_pw: password });
  if (error) return 'none'; // 확인을 못 하면 이어받기 없이 진행
  return data;
}

// ---------- 가입 / 로그인 / 로그아웃 ----------

/**
 * 회원가입. 성공하면 바로 로그인 상태가 된다.
 * legacyPassword가 있으면 예전 시아탱크 기록을 이어받는다.
 * @returns {Promise<{ user: {userId, loginId, nickname}, claimed: number }>}
 */
export async function signUp({ loginId, password, password2, nickname, legacyPassword = '' }) {
  loginId = loginId.trim();
  nickname = nickname.trim();
  const p =
    (loginIdProblem(loginId) && ['loginId', loginIdProblem(loginId)]) ||
    (passwordProblem(password) && ['password', passwordProblem(password)]) ||
    (password !== password2 && ['password2', '비밀번호가 서로 달라요']) ||
    (nicknameProblem(nickname) && ['nickname', nicknameProblem(nickname)]);
  if (p) throw new AuthError(p[1], p[0]);

  const [idTaken, nickTaken] = await Promise.all([isLoginIdTaken(loginId), isNicknameTaken(nickname)]);
  if (idTaken) throw new AuthError('이미 있는 아이디예요', 'loginId');
  if (nickTaken) throw new AuthError('이미 있는 닉네임이에요', 'nickname');

  // profiles는 DB 트리거가 가입과 함께 만든다 (닉네임은 metadata로 전달)
  const { data, error } = await supabase.auth.signUp({
    email: toEmail(loginId),
    password,
    options: { data: { nickname } },
  });
  if (error) {
    const m = error.message ?? '';
    if (/already registered|already exists/i.test(m)) throw new AuthError('이미 있는 아이디예요', 'loginId');
    if (/database error/i.test(m)) {
      // 확인과 가입 사이에 다른 사람이 같은 닉네임을 가져간 경우
      if (await isNicknameTaken(nickname).catch(() => false)) throw new AuthError('이미 있는 닉네임이에요', 'nickname');
      throw new AuthError('가입하지 못했어요. 아이디·닉네임을 다시 확인해 주세요');
    }
    if (/email/i.test(m) && /invalid|validate/i.test(m)) throw new AuthError('서버가 아이디 형식을 받지 않았어요. 관리자에게 알려 주세요');
    if (/rate limit/i.test(m)) throw new AuthError('잠시 후 다시 시도해 주세요 (요청이 너무 많아요)');
    throw new AuthError('가입하지 못했어요. 잠시 후 다시 시도해 주세요');
  }
  if (!data.session) {
    // 대시보드에서 'Confirm email'이 켜져 있으면 세션이 바로 오지 않는다
    throw new AuthError('가입은 됐지만 바로 로그인하지 못했어요. 관리자에게 알려 주세요 (Confirm email 설정)');
  }

  let claimed = 0;
  if (legacyPassword) {
    const { data: n } = await supabase.rpc('claim_legacy_records', { p_old_pw: legacyPassword });
    claimed = typeof n === 'number' ? n : 0;
  }
  profileCache = null;
  await claimSession(true);
  // 회원 정보를 못 읽으면(통신 실패·아직 없음) 가입은 된 것이므로 로그인을 되돌리고 로그인 화면으로 보낸다
  const { user } = await readUserAfterLogin();
  if (!user) {
    await undoLogin();
    const e = new AuthError('가입은 됐어요. 로그인해 주세요');
    e.toLogin = true;
    e.loginId = loginId;
    throw e;
  }
  return { user, claimed };
}

/** 방금 로그인한 뒤 회원 정보 읽기: 통신 실패면 잠깐 뒤 한 번 더. → { user (없으면 null), failed (마지막이 통신 실패) } */
async function readUserAfterLogin() {
  let user = null;
  let failed = false;
  for (let attempt = 0; attempt < 2 && !user && (attempt === 0 || failed); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800));
    failed = false;
    user = await getCurrentUser().catch(() => ((failed = true), null));
  }
  return { user, failed };
}

/** 로그인을 이 브라우저에서만 되돌린다 (로그인된 채 로그인 화면에 남지 않게) */
async function undoLogin() {
  stopWatch();
  dropToken();
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
}

/** 로그인. 실패 이유는 하나로만 알려 준다 */
export async function signIn(loginId, password) {
  loginId = loginId.trim().toLowerCase();
  if (!LOGIN_ID_RE.test(loginId) || !password) throw new AuthError('아이디 또는 비밀번호가 맞지 않아요');
  const { error } = await supabase.auth.signInWithPassword({ email: toEmail(loginId), password });
  if (error) {
    if (/rate limit/i.test(error.message ?? '')) throw new AuthError('잠시 후 다시 시도해 주세요 (요청이 너무 많아요)');
    if (/fetch|network/i.test(error.message ?? '')) throw new AuthError('서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요');
    throw new AuthError('아이디 또는 비밀번호가 맞지 않아요');
  }
  profileCache = null;
  // 이 브라우저를 '지금 접속한 곳'으로 올린다 → 다른 기기에 로그인돼 있던 같은 계정은 곧 로그아웃된다
  // (getCurrentUser보다 먼저: 거기서 시작하는 확인이 예전 표식을 다시 올리지 않게)
  await claimSession(true);
  // 회원 정보를 못 읽으면 한 번 더 읽고, 그래도 안 되면 로그인을 되돌린다 (로그인된 채 로그인 화면에 남지 않게)
  const { user, failed } = await readUserAfterLogin();
  if (!user) {
    await undoLogin();
    throw new AuthError(failed ? NET_ERROR : '회원 정보를 찾지 못했어요. 관리자에게 알려 주세요');
  }
  return user;
}

export async function signOut() {
  profileCache = null;
  stopWatch();
  dropToken();
  // 이 브라우저만 로그아웃한다 (다른 기기의 로그인은 건드리지 않는다)
  await supabase.auth.signOut({ scope: 'local' });
}

// ---------- 동시 접속 막기 (한 계정은 한 기기·브라우저에서만) ----------
// 로그인하면 이 브라우저가 표식(token)을 서버에 올린다. 다른 곳에서 같은 계정으로 로그인하면 서버의 표식이 바뀌고,
// 여기서는 그것을 보고(10초마다 · 화면으로 돌아올 때) 스스로 로그아웃한다. 같은 브라우저의 탭들은 표식을 같이 쓴다.

const TOKEN_KEY = 'sia-world-session-token';
const KICK_KEY = 'sia-world-kicked';
const CHECK_MS = 10_000;

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function dropToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장소를 못 써도 계속 */
  }
}
function newToken() {
  const t = crypto.randomUUID();
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* 저장소를 못 쓰면 이 탭에서만 */
  }
  return t;
}

let myToken = null;
/** 이 탭이 표식을 서버에 올리는 중이면 그 Promise (그동안은 서버가 아직 옛 표식이라 밀려난 것으로 보면 안 된다) */
let claiming = null;
/** 이 브라우저를 내 계정의 '지금 접속한 곳'으로 올린다. fresh: 새로 로그인했다 (표식을 새로 만든다) */
function claimSession(fresh) {
  const token = (!fresh && readToken()) || newToken();
  myToken = token;
  const run = (async () => {
    let failed = true;
    try {
      const { error } = await supabase.rpc('claim_session', { p_token: token });
      failed = !!error;
    } catch {
      /* 통신이 안 되면 아래에서 실패로 */
    }
    // 서버에 아직 함수가 없거나 통신이 안 되면 막지 않는다 (표식도 지워 다음에 다시 올린다)
    if (failed && myToken === token) {
      myToken = null;
      if (readToken() === token) dropToken();
    }
  })();
  claiming = run;
  void run.finally(() => {
    if (claiming === run) claiming = null;
  });
  return run;
}

/** 다른 곳에서 로그인해서 밀려났다는 표시를 한 번 꺼낸다 (로그인 화면이 안내에 쓴다) */
export function takeKickedNotice() {
  try {
    const v = sessionStorage.getItem(KICK_KEY);
    sessionStorage.removeItem(KICK_KEY);
    return !!v;
  } catch {
    return false;
  }
}

let watchTimer = null;
let watching = false;
let listening = false;
function stopWatch() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  watching = false;
}
// 로그아웃되면(다른 탭에서 한 것 포함) 지켜보기를 멈추고 표식도 잊는다.
// 로그인 화면에 남은 탭이 옛 표식으로 계속 확인하면, 다른 탭이 다시 로그인하는 사이(여기 저장소는 새 표식, 서버는 아직 옛 표식)
// 밀려난 것으로 보고 같이 쓰는 새 로그인까지 끊는다. 다시 로그인하면 getCurrentUser → ensureSession 이 다시 시작한다
supabase.auth.onAuthStateChange((event) => {
  if (event !== 'SIGNED_OUT') return;
  stopWatch();
  myToken = null;
  profileCache = null;
});
async function checkSession() {
  if (!watching) return;
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user?.id;
  if (!uid) return;
  // 이 브라우저의 표식은 서버를 읽기 전에 먼저 읽는다: 읽는 사이 다른 탭이 다시 로그인하면
  // (서버는 옛 표식, 여기는 새 표식으로 엇갈려) 나를 밀려난 것으로 보고 같이 쓰는 로그인까지 끊게 된다
  const before = readToken();
  const { data, error } = await supabase.from('user_sessions').select('token').eq('user_id', uid).maybeSingle();
  if (error || !watching) return; // 못 읽으면 다음에 다시
  const local = readToken();
  if (local !== before) return; // 그 사이 다른 탭이 표식을 바꿨다 → 이번은 건너뛴다 (다음 확인 때 다시)
  // 같은 브라우저의 다른 탭이 새로 로그인했으면 그 표식을 따라간다 (내 표식을 서버에 올리지 못한 상태면 비교하지 않는다)
  let adopted = false;
  if (local && myToken && local !== myToken) {
    myToken = local;
    adopted = true;
  }
  if (!data || !myToken) return void claimSession(false); // 아직 올린 적이 없다 (이 기능 전부터 로그인해 있던 경우 · 올리기에 실패했던 경우)
  if (data.token === myToken) return;
  // 이 탭이 표식을 올리는 중이면 끝나기를 기다렸다가 처음부터 다시 본다
  if (claiming) {
    await claiming.catch(() => {});
    return checkSession();
  }
  // 다른 탭이 방금 바꾼 표식을 지금 따라갔다 → 그 탭이 아직 서버에 올리는 중일 수 있으니 이번은 넘기고 다음 확인 때 본다
  // (다른 기기의 로그인이면 다음 확인에서도 여전히 달라 그때 로그아웃된다)
  if (adopted) return;
  // 다른 기기에서 로그인했다 → 이 브라우저만 로그아웃
  stopWatch();
  profileCache = null;
  dropToken();
  try {
    sessionStorage.setItem(KICK_KEY, '1');
  } catch {
    /* 안내만 못 띄운다 */
  }
  await supabase.auth.signOut({ scope: 'local' });
}
/** 내 접속이 아직 유효한지 지켜본다 (로그인한 페이지마다 한 번) */
function watchSession() {
  if (watching) return;
  watching = true;
  watchTimer = setInterval(() => void checkSession(), CHECK_MS);
  // 화면으로 돌아올 때의 확인은 한 번만 붙인다 (로그아웃 뒤 다시 로그인해 지켜보기를 다시 시작해도 늘어나지 않게.
  // 지켜보지 않는 동안에는 checkSession 이 바로 돌아간다)
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkSession());
  window.addEventListener('focus', () => void checkSession());
}

/** 로그인돼 있는 페이지에서: 표식이 없으면 올리고(예전부터 로그인해 있던 브라우저), 지켜보기 시작 */
async function ensureSession() {
  if (watching) return;
  const first = async () => {
    myToken = readToken();
    if (!myToken) await claimSession(false);
  };
  // 같은 브라우저의 탭들이 동시에 처음 올리면 서로 다른 표식이 생긴다 → 한 탭씩 차례로 (먼저 한 탭의 표식을 같이 쓴다)
  if (navigator.locks?.request) await navigator.locks.request('sia-world-session', first).catch(first);
  else await first();
  watchSession();
  void checkSession();
}

// ---------- 현재 사용자 ----------

let profileCache = null;

/** 로그인 상태면 { userId, loginId, nickname, isAdmin }, 아니면 null */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return null;
  if (profileCache?.userId === uid) return profileCache;
  // login_id · is_admin 은 남에게 보이지 않는 열이라(098) 내 것만 서버 함수로 읽는다
  const { data: p, error } = await supabase.rpc('my_profile');
  if (error) throw new AuthError(NET_ERROR);
  if (!p) return null;
  profileCache = { userId: uid, loginId: p.login_id, nickname: p.nickname, isAdmin: !!p.is_admin };
  // 동시 접속 확인을 시작한다 (다른 기기에서 로그인하면 여기는 로그아웃)
  void ensureSession();
  return profileCache;
}

/** 로그아웃되면(다른 탭 포함) cb를 부른다. 해제 함수를 돌려준다 */
export function onSignedOut(cb) {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      profileCache = null;
      cb();
    }
  });
  return () => data.subscription.unsubscribe();
}

// ---------- 로그인 요구 / 돌아갈 주소 ----------

/** 지금 페이지를 SIA WORLD 최상위 기준 상대 경로로 (쿼리 포함, # 제외) */
function currentRelative() {
  const u = new URL(location.href);
  u.hash = '';
  return u.href.startsWith(ROOT.href) ? u.href.slice(ROOT.href.length) : '';
}

/** 로그인 화면 주소 (돌아올 주소 포함) */
export function loginUrl(redirect = currentRelative()) {
  const u = new URL('index.html', ROOT);
  if (redirect) u.searchParams.set('redirect', redirect);
  return u.href;
}

/**
 * 로그인 상태면 { userId, loginId, nickname }을 돌려준다.
 * 아니면 로그인 화면으로 보내고, 돌아오지 않는 Promise를 돌려준다.
 * 게임 페이지에서 부르면 그 게임이 열려 있는지도 본다: 닫힌 게임은 관리자만 들어갈 수 있다.
 * (들어올 때 한 번만 확인한다 → 닫기 전에 들어와 있던 사람은 그대로 한다)
 */
export async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) {
    location.replace(loginUrl());
    return new Promise(() => {});
  }
  if (!user.isAdmin && (await isClosedHere())) {
    showClosed();
    return new Promise(() => {});
  }
  logVisit();
  return user;
}

/** 지금 페이지가 속한 게임 (게임 페이지가 아니면 null) */
function gameHere() {
  let rel = currentRelative();
  try {
    // 주소에 %76 같은 표기가 섞여 있어도 같은 게임으로 본다
    rel = decodeURIComponent(rel);
  } catch {
    /* 풀 수 없는 주소는 그대로 */
  }
  return gameForPath(rel);
}

let visitLogged = false;
/**
 * 이 게임에 들어왔다고 서버에 적는다 → 로비가 많이 들어간 게임부터 보여 준다.
 * 페이지마다 한 번, 기다리지 않는다. 실패해도 게임은 그대로 시작한다 (횟수는 서버가 10분에 한 번만 올린다)
 */
function logVisit() {
  if (visitLogged) return;
  try {
    const game = gameHere();
    if (!game) return;
    visitLogged = true;
    void supabase.rpc('log_game_visit', { p_game: game.id }).then(
      () => {},
      () => {},
    );
  } catch {
    /* 기록을 못 해도 계속 */
  }
}

/** 지금 페이지의 게임이 닫혀 있는가 (게임 페이지가 아니거나 확인하지 못하면 false) */
async function isClosedHere() {
  const game = gameHere();
  if (!game) return false;
  // 잠깐 통신이 끊긴 것일 수 있어 한 번 더 읽는다. 그래도 못 읽으면 들여보낸다
  // (목록의 기본값은 실제로 열린 게임도 '닫힘'인 경우가 있어, 그걸 따르면 보통 사용자에게 '준비 중'이 뜬다. 닫기는 가벼운 문일 뿐이다)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await loadGameOpen())[game.id] === false;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false;
}

/** 닫힌 게임 안내 (화면 전체) → 로비로 */
function showClosed() {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
    'padding:24px;text-align:center;background:linear-gradient(#4aa8ff,#9fd6ff 300px,#ffe9b8);color:#2a1a10;' +
    "font:20px 'Jua','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif";
  const msg = document.createElement('p');
  msg.textContent = '지금은 준비 중인 게임이에요';
  msg.style.cssText = 'margin:0;font-size:26px';
  const a = document.createElement('a');
  a.href = new URL('index.html', ROOT).href;
  a.textContent = '🌏 SIA WORLD로';
  a.style.cssText =
    'padding:12px 22px;border:3px solid #2a1a10;border-radius:16px;background:linear-gradient(#ffe066,#f0a500);color:#2a1a10;' +
    'text-decoration:none;box-shadow:0 4px 0 #2a1a10';
  box.append(msg, a);
  document.body.append(box);
}

/**
 * redirect 값이 SIA WORLD 안의 상대 경로일 때만 절대 주소로 바꿔 준다.
 * http:, //, /, \ 로 시작하거나 SIA WORLD 밖을 가리키면 null (→ 로비로).
 */
export function safeRedirect(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/') || v.includes('\\')) return null;
  let u;
  try {
    u = new URL(v, ROOT);
  } catch {
    return null;
  }
  if (u.origin !== ROOT.origin || !u.pathname.startsWith(ROOT.pathname)) return null;
  const rest = u.pathname.slice(ROOT.pathname.length);
  if (rest === '' || rest === 'index.html') return null; // 로비 자신
  return u.href;
}

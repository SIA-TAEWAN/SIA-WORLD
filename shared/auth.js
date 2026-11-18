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

async function exists(column, value) {
  const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq(column, value);
  if (error) throw new AuthError('서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요');
  return (count ?? 0) > 0;
}
export const isLoginIdTaken = (loginId) => exists('login_id', loginId);
export const isNicknameTaken = (nickname) => exists('nickname', nickname);

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
  const user = await getCurrentUser();
  return { user, claimed };
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
  const user = await getCurrentUser();
  if (!user) {
    await supabase.auth.signOut();
    throw new AuthError('회원 정보를 찾지 못했어요. 관리자에게 알려 주세요');
  }
  return user;
}

export async function signOut() {
  profileCache = null;
  await supabase.auth.signOut();
}

// ---------- 현재 사용자 ----------

let profileCache = null;

/** 로그인 상태면 { userId, loginId, nickname, isAdmin }, 아니면 null */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return null;
  if (profileCache?.userId === uid) return profileCache;
  const { data: p, error } = await supabase.from('profiles').select('login_id,nickname,is_admin').eq('id', uid).maybeSingle();
  if (error) throw new AuthError('서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요');
  if (!p) return null;
  profileCache = { userId: uid, loginId: p.login_id, nickname: p.nickname, isAdmin: !!p.is_admin };
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
  return user;
}

/** 지금 페이지의 게임이 닫혀 있는가 (게임 페이지가 아니거나 확인하지 못하면 false) */
async function isClosedHere() {
  let rel = currentRelative();
  try {
    // 주소에 %76 같은 표기가 섞여 있어도 같은 게임으로 본다
    rel = decodeURIComponent(rel);
  } catch {
    /* 풀 수 없는 주소는 그대로 */
  }
  const game = gameForPath(rel);
  if (!game) return false;
  try {
    return (await loadGameOpen())[game.id] === false;
  } catch {
    // 서버에서 못 읽으면 목록의 기본값 (기본이 닫힘인 게임은 닫힌 것으로)
    return game.open === false;
  }
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

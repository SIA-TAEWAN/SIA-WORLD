import './style.css';
import { SQUAD_SIZE } from './data/balance';
import { ROSTER, STARTERS, towerOf } from './data/characters';
import { ApiError, LOCAL_MODE, devSetup, getApi, lobbyNet, type StartInfo } from './net/api';
import { DefenseLobby, LOBBY_MAX, LobbyFullError } from './net/lobby';
import { loadAuth, worldHome, type WorldUser } from './net/world';
import { app, loadEngine, loadSquad, nav, screen, setProfile, state, toast, whyText, type GameSetup } from './ui/app';
import { stageOf } from './data/stages';
import { showMain, showPrepare, showRegions, showStages } from './ui/menus';
import { ENDLESS_ID } from './data/endless';
import { showCodex } from './ui/codex';
import { showResult } from './ui/result';
import { showChars } from './ui/roster';

nav.main = showMain;
// 지도 화면(지역 지도 · 스테이지 고르기)에 들어올 때마다 보류해 둔 결과를 다시 보낸다.
// 올라가서 프로필이 바뀌면 그 화면이 watchProfile 로 스스로 다시 그린다
nav.regions = () => {
  showRegions();
  resendPending();
};
nav.stages = (no) => {
  showStages(no);
  resendPending();
};
nav.prepare = showPrepare;
nav.chars = showChars;
nav.codex = showCodex;
const dev = devSetup();
/** 판을 여는 중인가 (보류분 재전송·판 시작 알림·게임 엔진 받기. 그동안 시작 버튼을 여러 번 눌러도 판은 한 번만 시작한다) */
let starting = false;
/** 판을 시작하기 전에 보류해 둔 결과를 올리는 데 기다리는 최대 시간 (넘으면 올리기는 뒤에서 계속하고 판을 시작한다) */
const RESEND_WAIT_MS = 8000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 보류분 재전송이 진행 중인가 (겹쳐 부르지 않게) */
let resending = false;
/**
 * 보류해 둔 판 결과를 다시 보낸다 (지도 화면에 들어올 때 · 인터넷이 다시 연결될 때).
 * 올라간 판이 있으면 프로필을 새로 읽는다: 떠 있는 화면(메인·지도·스테이지·캐릭터)은 watchProfile 로 다시 그린다 (판 안에서는 알림도 띄우지 않는다)
 */
function resendPending() {
  const api = state.api;
  if (!api || resending) return;
  resending = true;
  void (async () => {
    try {
      const sent = await api.resend().catch(() => 0);
      if (sent <= 0) return;
      setProfile(await api.loadProfile());
      if (!app.querySelector('.screen.game')) toast(`지난번에 올리지 못한 결과 ${sent}판을 올렸어요`, 3200);
    } catch {
      // 프로필을 못 읽었다: 다음 기회에 다시 읽는다 (resend 가 받은 프로필은 onProfile 로 이미 반영된다)
    } finally {
      resending = false;
    }
  })();
}
window.addEventListener('online', () => resendPending());

/**
 * 판 열기: ① 보류해 둔 결과를 먼저 올린다 (실패해도 시작은 한다 — 서버가 열린 판을 정리할 때 다시 보낼 판이 지워지지 않게)
 * ② 판 시작을 서버에 알리고 판 설정(시작 생명·강화·레벨)을 받는다 ③ 그 값으로 게임 화면을 연다.
 * 잠긴 스테이지·캐릭터면(서버가 거절) 스테이지 고르기로 돌아간다. 통신 문제면 기록되지 않는 판으로 연다
 */
async function openGame(setup: GameSetup) {
  const api = state.api;
  const online = !!api && !setup.offline;
  // 조금 오래 걸리면 기다리는 중이라고 알려 준다
  const slow = setTimeout(() => toast('출전 준비 중…', 4000), 600);
  try {
    if (online) await Promise.race([api!.resend().catch(() => 0), wait(RESEND_WAIT_MS)]);
    const [m, begun] = await Promise.all([
      loadEngine().catch(() => null),
      online ? api!.start(setup.stage, setup.squad, setup.endless ? 'endless' : 'normal').catch((e: unknown) => e) : Promise.resolve(null),
    ]);
    if (begun instanceof ApiError) {
      // 잠긴 스테이지·캐릭터: 스테이지 고르기로 돌아간다
      toast(whyText(begun));
      if (setup.endless) nav.regions();
      else nav.stages(stageOf(setup.stage)?.region ?? 1);
      return;
    }
    if (!m) {
      toast('게임을 불러오지 못했어요. 다시 눌러 주세요', 3200);
      return;
    }
    clearTimeout(slow);
    if (document.querySelector('.toast')?.textContent === '출전 준비 중…') document.querySelector('.toast')?.remove();
    // 개발용 설정(?seed= · ?lv= · ?upg=)은 메뉴에서 시작한 판에도 그대로 적용한다
    m.showGame(
      { ...setup, seed: setup.seed ?? dev?.seed ?? undefined, lv: setup.lv ?? dev?.lv ?? undefined, upg: setup.upg ?? dev?.upg ?? undefined },
      begun && typeof begun === 'object' && 'run' in begun ? (begun as StartInfo) : null,
    );
  } finally {
    clearTimeout(slow);
  }
}
nav.game = (setup) => {
  if (starting) return;
  starting = true;
  void openGame(setup).finally(() => (starting = false));
};
nav.result = showResult;

/** 접속 인원 채널 (정원 확인. 들어와 있는 동안 계속 붙잡아 둔다) */
let lobby: DefenseLobby | null = null;

/** 테스트 모드(?local=1): 로그인 없이 임시 사용자 (?name= 으로 이름 지정) */
function localUser(): WorldUser {
  const name = new URLSearchParams(location.search).get('name')?.slice(0, 8) || '테스트';
  return { userId: 'local', loginId: 'local', nickname: name };
}

async function start() {
  screen('<div class="connecting"><div class="spinner"></div><p>불러오는 중…</p></div>', 'center');
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
    const root = screen(
      `<div class="connecting">SIA WORLD에 연결하지 못했어요.<br/>인터넷 연결을 확인하고 다시 시도해 주세요.<br/><br/>
        <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`,
      'center',
    );
    root.querySelector('#retry')!.addEventListener('click', () => location.reload());
    return;
  }
  state.user = { id: user.userId, name: user.nickname };
  try {
    state.api = await getApi(user.userId);
  } catch {
    state.api = null;
  }
  const api = state.api;
  // 보류했던 결과가 나중에(판 시작 직전·저장 성공 직후) 올라가면 새 프로필을 화면에 반영한다
  if (api) api.onProfile = setProfile;
  // 접속 인원 채널(defense-lobby): 정원(최대 30명)을 확인한다. 게임을 하는 동안에도 채널에 남아 있는다 (시아서바이벌과 같은 방식)
  // 채널 연결이 안 되면 인원 확인 없이 들어간다. 테스트 모드에서는 ?lobbymax=2 처럼 정원을 줄여 볼 수 있다
  if (api) {
    const testMax = LOCAL_MODE ? Number(new URLSearchParams(location.search).get('lobbymax')) : 0;
    try {
      lobby = new DefenseLobby(await lobbyNet(), state.user, testMax >= 1 ? Math.floor(testMax) : LOBBY_MAX);
      await lobby.enter();
    } catch (e) {
      if (e instanceof LobbyFullError) {
        const root = screen(
          `<div class="connecting">지금은 사람이 가득 찼어요 (최대 ${lobby!.max}명).<br/>잠시 후 다시 들어와 주세요<br/><br/>
            <button class="btn primary" id="retry">다시 시도</button> <a class="btn" href="${worldHome()}">🌏 SIA WORLD로</a></div>`,
          'center',
        );
        root.querySelector('#retry')!.addEventListener('click', () => location.reload());
        return;
      }
      lobby = null;
    }
  }
  // 프로필(엽전·별·레벨·강화·해금). 못 읽으면 처음 상태로 플레이는 할 수 있다 (그 판은 기록되지 않는다)
  try {
    if (!api) throw new Error('no api');
    // 지난번에 올리지 못한 판 결과가 있으면 먼저 다시 보낸다
    const sent = await api.resend().catch(() => 0);
    setProfile(await api.loadProfile());
    if (sent > 0) toast(`지난번에 올리지 못한 결과 ${sent}판을 올렸어요`, 3200);
  } catch {
    toast('서버에 연결하지 못했어요. 지금은 기록되지 않아요', 3600);
  }
  state.squad = loadSquad();

  // 개발용 테스트 설정: ?local=1&stage=1-5 → 메뉴를 건너뛰고 그 스테이지로 바로 시작
  // (잠금·해금을 보지 않으므로 이렇게 시작한 판은 저장하지 않는다)
  if (dev?.stage) {
    const squad = dev.squad ?? ROSTER.map((c) => c.id).filter((id) => !!towerOf(id) && (dev.lv !== null || state.profile.unlocked.includes(id))).slice(0, SQUAD_SIZE);
    nav.game({ stage: dev.stage, squad: squad.length ? squad : [...STARTERS], seed: dev.seed ?? undefined, lv: dev.lv ?? undefined, upg: dev.upg ?? undefined, offline: true, endless: dev.stage === ENDLESS_ID });
  }
  else nav.main();
}

void start();

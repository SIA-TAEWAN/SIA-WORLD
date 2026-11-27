import './style.css';
import { SQUAD_SIZE } from './data/balance';
import { EXTRAS, ROSTER, STARTERS, towerOf } from './data/characters';
import { cleanProfile, setOwnedExtras } from './game/progress';
import type { CharId } from './data/balance';
import { ApiError, LOCAL_MODE, devSetup, getApi, lobbyNet, type StartInfo } from './net/api';
import { DefenseLobby, LOBBY_MAX, LobbyFullError } from './net/lobby';
import { buyCharacter, loadAuth, loadCharacterProgress, loadOwnedCharacters, worldHome, type WorldUser } from './net/world';
import { app, catCondition, extraShop, loadEngine, loadSquad, nav, screen, setProfile, state, toast, whyText, type GameSetup } from './ui/app';
import { stageOf } from './data/stages';
import { showMain, showPrepare, showRegions, showStages } from './ui/menus';
import { ENDLESS_ID } from './data/endless';
import { showCodex } from './ui/codex';
import { showResult } from './ui/result';
import { DAY_CHANGED_TEXT, NO_DAY_TEXT, showDaily, todayChallenge } from './ui/daily';
import { showChars } from './ui/roster';

nav.main = () => {
  showMain();
  if (profileStale) resendPending();
};
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
nav.daily = showDaily;
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
/** 이미 "올렸어요" 를 알린 재전송 (api.resend 는 진행 중인 것을 함께 쓰므로 두 곳이 같은 결과를 받는다) */
const announced = new WeakSet<Promise<number>>();
/**
 * 보류분을 다시 보내고, 올라간 판 수를 돌려준다. 같은 재전송을 기다린 다른 곳(처음 화면 · 지도 화면 · 다시 연결됨)이
 * 이미 받아 갔으면 0 — 안내가 두 번 뜨지 않게 (프로필 다시 읽기도 먼저 받은 쪽이 한다)
 */
async function resendOnce(api: NonNullable<typeof state.api>): Promise<number> {
  const job = api.resend();
  const sent = await job.catch(() => 0);
  if (sent <= 0 || announced.has(job)) return 0;
  announced.add(job);
  return sent;
}
/**
 * 보류해 둔 판 결과를 다시 보낸다 (지도 화면에 들어올 때 · 인터넷이 다시 연결될 때).
 * 올라간 판이 있으면 프로필을 새로 읽는다: 떠 있는 화면(메인·지도·스테이지·캐릭터)은 watchProfile 로 다시 그린다 (판 안에서는 알림도 띄우지 않는다)
 */
/** 접속할 때 프로필을 못 읽었다 (빈 프로필로 보인다) → 다시 연결되거나 화면이 다시 보일 때 읽는다 */
let profileStale = false;
function resendPending() {
  const api = state.api;
  if (!api || resending) return;
  resending = true;
  void (async () => {
    try {
      const sent = await resendOnce(api);
      if (sent <= 0 && !profileStale) return;
      setProfile(await api.loadProfile());
      profileStale = false;
      if (sent > 0 && !app.querySelector('.screen.game')) toast(`지난번에 올리지 못한 결과 ${sent}판을 올렸어요`, 3200);
    } catch {
      // 프로필을 못 읽었다: 다음 기회에 다시 읽는다 (resend 가 받은 프로필은 onProfile 로 이미 반영된다)
    } finally {
      resending = false;
    }
  })();
}
window.addEventListener('online', () => resendPending());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && profileStale) resendPending();
});

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
    // 오늘의 고개: 시작할 때 날짜를 다시 받는다. 못 받으면 시작하지 않고, 화면의 날짜와 다르면 새 날짜로 다시 그린다 (그 판은 시작하지 않는다)
    if (setup.daily && online) {
      const { ch } = await todayChallenge();
      if (!ch) {
        toast(NO_DAY_TEXT, 3200);
        return;
      }
      if (ch.day !== setup.daily.day) {
        toast(DAY_CHANGED_TEXT, 3200);
        nav.daily();
        return;
      }
    }
    if (online) await Promise.race([api!.resend().catch(() => 0), wait(RESEND_WAIT_MS)]);
    const [m, begun] = await Promise.all([
      loadEngine().catch(() => null),
      online ? api!.start(setup.stage, setup.squad, setup.endless ? 'endless' : 'normal', setup.daily?.day).catch((e: unknown) => e) : Promise.resolve(null),
    ]);
    if (begun instanceof ApiError) {
      // 잠긴 스테이지·캐릭터: 스테이지 고르기로 돌아간다
      toast(whyText(begun), setup.daily ? 3200 : undefined);
      // 오늘의 고개: 날짜가 바뀌었으면 새 날짜로 다시 그린다
      if (setup.daily) nav.daily();
      else if (setup.endless) nav.regions();
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
  return openGame(setup).finally(() => {
    starting = false;
  });
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
  // 시아디펜스에서 시아코인으로 연 추가 캐릭터(고양이, 게임마다 따로): 프로필을 읽기 전에 (cleanProfile 이 이 목록으로 p.unlocked 를 만든다).
  // 테스트 모드는 로그인이 없으니 열린 것으로 (&cat=0 이면 잠긴 모습, 열기 버튼은 서버 없이 바로 열린다)
  let owned: string[] = [];
  /** 연 목록을 바꾸고 화면에 반영한다 (열린 캐릭터가 달라졌을 때만 다시 그린다) */
  const applyOwned = (list: string[]) => {
    owned = list;
    setOwnedExtras(list);
    const p = cleanProfile(state.profile);
    if (p.unlocked.join() !== state.profile.unlocked.join()) setProfile(p);
  };
  if (LOCAL_MODE) {
    // &cat=0 잠김 + 조건 통과(열기 버튼) · &cat=cond 잠김 + 조건 미달 (3-5 를 아직 못 깸)
    const cat = new URLSearchParams(location.search).get('cat');
    owned = cat === '0' || cat === 'cond' ? [] : [...EXTRAS];
    setOwnedExtras(owned);
    extraShop.progress = { have: cat === 'cond' ? 0 : 1, need: 1 };
    extraShop.buy = async (id: CharId) => {
      if (!catCondition(state.profile).done) {
        toast('아직 열 수 없어요 (조건 0 / 1)');
        return false;
      }
      applyOwned([...new Set([...owned, id])]);
      toast('열었어요! (테스트 모드: 시아코인을 쓰지 않아요)');
      return true;
    };
  } else {
    // 처음에 못 읽으면 잠긴 것으로 시작한다 (서버도 판 시작 때 다시 본다)
    owned = (await loadOwnedCharacters()) ?? [];
    setOwnedExtras(owned);
    // 구매 조건 진행 (잠겨 있을 때만 묻는다. 못 읽으면 기기의 프로필로 본다). 값이 바뀌면 떠 있는 화면(출전 준비의 조건 글·열기 버튼)을 다시 그린다
    const loadProgress = async () => {
      if (!EXTRAS.some((id) => !owned.includes(id))) return;
      const p = await loadCharacterProgress();
      if (!p) return;
      const before = extraShop.progress;
      extraShop.progress = { have: p.have, need: p.need };
      if (before?.have !== p.have || before?.need !== p.need) setProfile(state.profile);
    };
    await loadProgress();
    extraShop.buy = async (id: CharId) => {
      const { r, msg } = await buyCharacter(id);
      toast(msg, 2800);
      if (r?.reason === 'condition') {
        // 서버가 본 진행으로 글을 고친다
        extraShop.progress = { have: Number(r.have) || 0, need: Number(r.need) || 1 };
        setProfile(state.profile);
      }
      if (!r?.ok && r?.reason !== 'owned') return false;
      // 연 목록을 다시 묻는다 (못 읽으면 방금 연 것을 더해 둔다)
      applyOwned((await loadOwnedCharacters(true)) ?? [...new Set([...owned, id])]);
      return true;
    };
    // 다른 기기에서 열었으면 화면이 다시 보일 때 반영한다. 못 읽었으면(null) 가진 목록을 그대로 둔다
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void loadOwnedCharacters(true).then((list) => {
        if (list) applyOwned(list);
      });
      void loadProgress();
    });
  }
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
    // 느린 망에서 오래 걸리면 RESEND_WAIT_MS 만 기다리고 화면을 연다 (올리기는 뒤에서 계속하고, 끝나면 resendPending 처럼 알린다)
    const job = resendOnce(api);
    const sent = await Promise.race([job, wait(RESEND_WAIT_MS).then(() => -1)]);
    setProfile(await api.loadProfile());
    if (sent > 0) toast(`지난번에 올리지 못한 결과 ${sent}판을 올렸어요`, 3200);
    else if (sent < 0) {
      void job.then(async (n) => {
        if (n <= 0) return;
        try {
          setProfile(await api.loadProfile());
        } catch {
          // 프로필을 못 읽었다: 다음 기회에 다시 읽는다
        }
        if (!app.querySelector('.screen.game')) toast(`지난번에 올리지 못한 결과 ${n}판을 올렸어요`, 3200);
      });
    }
  } catch {
    profileStale = !!api;
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

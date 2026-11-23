import { TANKS, TANK_IDS, RANDOM_TANK_IDS, randomTank, tankOr, type TankChoice } from '../game/data';
import { MAPS, MAP_IDS, RANDOM_MAP_IDS, type MapId } from '../data/maps';
import type { PlayerSetup } from '../game/types';
import type { WindMode } from '../game/match';
import { SUDDEN_TURN } from '../game/sudden';
import { Rng, randomSeed } from '../game/rng';
import type { MatchSummary } from '../scenes/GameScene';
import { TEAM_COLORS, TEAM_NAMES } from './teams';
import { getBackend, lobbyCode, lobbyLink, clientId } from '../net';
import { allReady, friendly, hostOf, type Backend, type Room, type RoomPlayer } from '../net/backend';
import { LobbyFullError, LobbySession } from '../net/lobby';
import { worldHome, openWorldRanking } from '../net/world';
import { showManualModal } from './manual';
import { RoomSession, SUDDEN_VERSION } from '../net/room';
import { OnlineGame } from '../net/online';
import { $, closeGame, launchGame, nav, screen, setScreenCleanup, state, toast } from './app';
import { escapeHtml } from './hud';
import { renderShop } from './shop';
import { rankedName, ranking, setRanking, setTargetRanking, showRankingModal } from './rank';
import { tankSvg } from './tankSvg';
import { sfx } from './sfx';
import { isTankOpen, onUnlockChange, refreshProgress } from '../game/unlock';
import { pressUnlock, type UnlockHooks } from './unlockBtn';
import { lockBadge, lockNote, lockTitle } from './lock';
import { recordTarget, showResult } from './offline';

let backend: Backend | null = null;
let lobby: LobbySession | null = null;
let roomSess: RoomSession | null = null;
let online: OnlineGame | null = null;
/** 게임방별로 이미 시작한 판 번호 (같은 판을 두 번 열지 않도록) */
const started = new Map<string, number>();

const me = () => ({ id: clientId(), name: state.name });
/** 이 화면이 마지막으로 다시 보인 때 (다른 앱으로 갔다 온 직후 방에서 빠졌으면 '연결이 끊겨서'로 안내) */
let shownAt = 0;
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (!document.hidden) shownAt = Date.now();
});
/** 대기방에서 접속이 안 보여도 이만큼은 기다린다 (아이폰에서 링크 복사 뒤 카카오톡으로 갔다 오는 동안) */
const ABSENT_GRACE_MS = 12_000;
/** 방에 막 들어온 사람은 접속 신호가 늦게 올 수 있어 이만큼은 빼지 않는다 */
const JOIN_GRACE_MS = 10_000;
/** 마지막 판의 승리 팀 (게임방으로 돌아갈 때 정산이 아직이면 같이 보낸다) */
let lastWinner: number | null = null;
/** 마지막 판의 결과 정리가 끝날 때 (게임방으로 돌아갈 때 먼저 기다린다) */
let settling: Promise<void> | null = null;
/** 기준 기기가 아니면 결과 정리를 이만큼 기다렸다가, 방이 아직 진행 중일 때만 대신 한다 */
const SETTLE_WAIT_MS = 5000;
const KICKED_TEXT = '자리를 오래 비워 AI가 이어서 조종하고 있어요';
export const WIND_LABEL: Record<WindMode, string> = { slow: '느리게 ±2', normal: '보통 ±5', fast: '빠르게 ±8' };
const myPlayer = (room?: Room): RoomPlayer => {
  const p = room?.players.find((x) => x.id === clientId());
  return { id: clientId(), name: state.name, tank: state.tank, team: p?.team ?? 0, items: [...state.shop[0]], ready: p?.ready ?? false };
};

/** 대기실 채팅과 게임방 채팅이 같은 모양으로 그려진다 */
interface ChatSource {
  chat: { name: string; text: string; system?: boolean }[];
  sendChat(text: string): void;
}

function chatHtml(sess: ChatSource) {
  return sess.chat
    .slice(-40)
    .map((c) => (c.system ? `<p class="sys">${escapeHtml(c.text)}</p>` : `<p><b>${escapeHtml(c.name)}</b> ${escapeHtml(c.text)}</p>`))
    .join('');
}

function bindChat(root: HTMLElement, sess: ChatSource) {
  const form = $<HTMLFormElement>(root, '.chat-form');
  const input = $<HTMLInputElement>(root, '.chat-form input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sess.sendChat(input.value);
    input.value = '';
  });
}

function renderChatLog(root: HTMLElement, sess: ChatSource) {
  const log = $(root, '.chat-log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.innerHTML = chatHtml(sess);
  if (atBottom) log.scrollTop = log.scrollHeight;
}

/** 랭킹을 서버에서 다시 받아 구름 등급을 갱신한다 */
/** 내 대전 전적: 온라인 + AI 보통·어려움 (대기실 위쪽 표시) */
function myRecord(): string {
  const mine = ranking().find((r) => r.key === clientId());
  return mine ? `${mine.wins}승 ${mine.losses}패` : '0승 0패';
}

async function refreshRanking() {
  if (!backend) return;
  try {
    setRanking(await backend.getRanking());
    setTargetRanking(await backend.getTargetRanking());
  } catch {
    /* 랭킹을 못 받아도 게임은 계속 */
  }
}

// ---------- 대기실 ----------

export async function showLobby() {
  if (!lobby) {
    screen(`<div class="connecting"><div class="spinner"></div><p>대기실에 들어가는 중…</p></div>`, 'center');
    backend = await getBackend();
    if (!backend) {
      toast('서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요');
      return nav.entry();
    }
    const sess = new LobbySession(backend, lobbyCode(), me());
    try {
      await sess.enter();
    } catch (e) {
      if (e instanceof LobbyFullError) toast(`대기실이 가득 찼습니다 (최대 ${sess.max}명)`);
      else toast('서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요');
      return nav.entry();
    }
    lobby = sess;
    // 포인트는 누구나 게임마다 1,000 (이기고 져도 바뀌지 않는다. 랭킹은 승패 순)
    state.points = 1000;
    await refreshRanking();
    const mine = sess.rooms.find((r) => r.players.some((p) => p.id === clientId()) && !(r.gone ?? []).includes(clientId()));
    if (mine) {
      // 게임 중에 끊겼다가 바로 돌아왔으면 그 게임으로 돌아간다 (최근 신호가 있는 진행 중인 방만)
      const age = Date.now() - new Date(mine.updated_at ?? 0).getTime();
      if (mine.status === 'playing' && age < 75_000) return enterRoom(mine.id);
      // 끝난 게임·오래된 방에 남아 있던 내 자리는 정리한다
      await (mine.status === 'playing' ? backend.quitGame(mine.id, clientId()) : backend.leaveRoom(mine.id, clientId())).catch(() => undefined);
      await sess.refetch();
    }
  }
  renderLobby(lobby);
}

/** 대기실에서 나가 다른 화면(AI 1:1 등)으로 */
async function leaveLobby(next: () => void) {
  await roomSess?.leave();
  roomSess = null;
  await lobby?.leave();
  lobby = null;
  next();
}

function renderLobby(sess: LobbySession) {
  const root = screen(
    `<header class="bar">
      <a class="btn ghost" id="exit" href="${worldHome()}">🌏 SIA WORLD로</a>
      <h2>대기실 <small id="count"></small></h2>
      <button class="btn small-btn" id="rank">🏆 랭킹</button>
      <span class="my-points" title="대전 전적 · AI 보통·어려움 포함 (랭킹은 승패 순)">🏅 ${myRecord()}</span>
      <button class="btn small-btn" id="copy">🔗 링크 복사</button>
    </header>
    <div class="lobby-tools">
      <button class="btn small-btn" id="ai">🤖 AI와 1:1</button>
      <button class="btn small-btn" id="manual">📖 게임 설명</button>
      ${state.isAdmin ? '<button class="btn small-btn" id="cap" title="관리자: 대기실 최대 동시 접속 인원">👥 정원 설정</button>' : ''}
      <span class="who-me">${rankedName(state.name, 16, clientId())}님</span>
    </div>
    <div class="lobby-grid">
      <section class="card rooms-card">
        <div class="card-head"><h3>게임방</h3><button class="btn primary small-btn" id="create">＋ 방 만들기</button></div>
        <div class="room-list" id="rooms"></div>
      </section>
      <section class="card people-card">
        <h3>접속자</h3>
        <ul class="people" id="people"></ul>
        <div class="chat">
          <div class="chat-log"></div>
          <form class="chat-form"><input maxlength="120" placeholder="채팅 입력" autocomplete="off"/><button class="btn small-btn">보내기</button></form>
        </div>
      </section>
    </div>`,
    'lobby',
    () => unsub(),
  );

  const draw = () => {
    $(root, '#count').textContent = `${sess.members.length}/${sess.max}명 · ${sess.code === 'main' ? '기본' : escapeHtml(sess.code)}`;
    const rooms = sess.visibleRooms();
    $(root, '#rooms').innerHTML = rooms.length
      ? rooms
          .map((r) => {
            const inIt = r.players.some((p) => p.id === clientId());
            const full = r.players.length >= 4;
            const playing = r.status === 'playing';
            const label = inIt ? '돌아가기' : playing ? '게임 중' : full ? '가득 참' : '입장';
            const can = inIt || (!playing && !full);
            return `<div class="room-row ${playing ? 'playing' : ''}">
              <div class="rn">${escapeHtml(r.name)}<small>${r.map === 'random' ? '랜덤 맵' : MAPS[r.map].name} · ${r.players.map((p) => rankedName(p.name, 14, p.id)).join(', ')}</small></div>
              <span class="cnt">${r.players.length}/4</span>
              <span class="st">${playing ? '게임 중' : '대기'}</span>
              <button class="btn small-btn ${can ? 'primary' : ''}" data-id="${r.id}" ${can ? '' : 'disabled'}>${label}</button>
            </div>`;
          })
          .join('')
      : `<div class="empty lobby-empty"><img src="${import.meta.env.BASE_URL}lobby.jpg" alt="" /><p>아직 게임방이 없어요. 방을 만들어 친구를 불러보세요!</p></div>`;
    root.querySelectorAll<HTMLElement>('.room-row button[data-id]').forEach((b) => b.addEventListener('click', () => enterRoom(b.dataset.id!)));
    $(root, '#people').innerHTML = sess.members
      .map((m) => {
        const r = m.meta.room ? sess.room(m.meta.room) : undefined;
        return `<li class="${m.key === clientId() ? 'me' : ''}">${rankedName(m.meta.name, 16, m.key)}${r ? `<small>${r.status === 'playing' ? '게임 중' : '게임방'}</small>` : ''}</li>`;
      })
      .join('');
    renderChatLog(root, sess);
  };
  const unsub = sess.subscribe(draw);
  draw();
  bindChat(root, sess);

  $(root, '#ai').addEventListener('click', () => {
    sfx.click();
    void leaveLobby(nav.setup);
  });
  // 관리자: 대기실 최대 동시 접속 인원 바꾸기 (다음에 들어오는 사람부터 적용)
  root.querySelector('#cap')?.addEventListener('click', async () => {
    const v = prompt(`대기실 최대 동시 접속 인원 (2~200명)
지금: ${sess.max}명 · 바꾸면 다음에 들어오는 사람부터 적용돼요`, String(sess.max));
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 2 || n > 200) return toast('2~200 사이 숫자로 적어 주세요');
    try {
      sess.max = await sess.backend.setLobbyMax(n);
      toast(`대기실 정원을 ${sess.max}명으로 바꿨어요`);
      draw();
    } catch (e) {
      toast(friendly(e));
    }
  });
  $(root, '#manual').addEventListener('click', () => {
    sfx.click();
    showManualModal();
  });
  $(root, '#rank').addEventListener('click', async () => {
    sfx.click();
    await refreshRanking();
    void openWorldRanking(clientId()).then((ok) => ok || showRankingModal(clientId()));
  });
  $(root, '#copy').addEventListener('click', async () => {
    const link = lobbyLink(sess.code);
    try {
      await navigator.clipboard.writeText(link);
      toast('링크를 복사했어요! 친구에게 보내주세요');
    } catch {
      prompt('이 링크를 복사해서 보내주세요', link);
    }
  });
  $(root, '#create').addEventListener('click', async () => {
    sfx.click();
    try {
      const r = await sess.createRoom(myPlayer());
      await enterRoom(r.id);
    } catch (e) {
      toast(friendly(e));
    }
  });
}

// ---------- 게임방 ----------

async function enterRoom(id: string) {
  const sess = lobby!;
  let room = sess.room(id);
  if (!room) {
    toast('게임방이 사라졌어요');
    return renderLobby(sess);
  }
  const inIt = room.players.some((p) => p.id === clientId());
  try {
    if (!inIt) room = await sess.joinRoom(id, myPlayer());
    else await sess.setMyRoom(id);
  } catch (e) {
    toast(friendly(e));
    return renderLobby(sess);
  }
  if (!roomSess || roomSess.roomId !== id) {
    await roomSess?.leave();
    roomSess = new RoomSession(backend!, id, me());
    roomSess.onNewerVersion = () => toast('새 버전이 있어요. 새로고침해 주세요');
    await roomSess.join().catch(() => undefined);
  }
  // 아이템은 방에 저장된 것을 따른다
  const p = room.players.find((x) => x.id === clientId());
  if (p) state.shop[0] = [...p.items];
  if (room.status === 'playing') return resumeGame(room);
  renderRoom(id);
}

async function leaveRoom() {
  await roomSess?.leave();
  roomSess = null;
  await lobby?.leaveRoom();
  renderLobby(lobby!);
}

function renderRoom(id: string) {
  const sess = lobby!;
  const rs = roomSess!;
  const absentSince = new Map<string, number>();
  /** 이 화면이 각 사람을 방 명단에서 처음 본 때 */
  const seenSince = new Map<string, number>();
  let lastBeat = Date.now();
  const root = screen(
    `<header class="bar">
      <button class="btn ghost" id="leave">← 나가기</button>
      <h2 id="title"></h2>
      <button class="btn small-btn" id="copy">🔗 링크 복사</button>
    </header>
    <div class="room-grid">
      <section class="card slots-card">
        <div class="slots4" id="slots"></div>
        <h3>내 탱크 <small id="tank-name"></small></h3>
        <div class="zodiac-pick" id="tank"></div>
        <div id="tank-lock"></div>
        <div id="team-box"><h3>팀 선택</h3><div class="seg" id="team"></div></div>
        <h3>맵 <small id="map-note"></small></h3>
        <div class="seg small" id="map"></div>
        <div class="opt-row"><span class="lbl">게임 모드</span><div class="seg small" id="mode"></div></div>
        <div class="opt-row"><span class="lbl">게임 속도</span><div class="seg small" id="speed"></div></div>
        <div class="opt-row"><span class="lbl">바람 변화</span><div class="seg small" id="wind"></div></div>
        <p class="opt-note" id="sudden-note"></p>
      </section>
      <section class="card shop-card">
        <h3>아이템 상점 <small>게임 시작 전까지</small></h3>
        <div id="shop"></div>
      </section>
      <section class="card chat-card">
        <h3>방 채팅 <small>이 방 사람끼리만</small></h3>
        <div class="chat">
          <div class="chat-log"></div>
          <form class="chat-form"><input maxlength="120" placeholder="채팅 입력" autocomplete="off"/><button class="btn small-btn">보내기</button></form>
        </div>
      </section>
    </div>
    <footer class="start-bar"><button class="btn big primary" id="start">게임 시작 ▶</button></footer>`,
    'room',
    () => {
      unsubA();
      unsubB();
      unsubC();
      clearInterval(iv);
      window.removeEventListener('pagehide', onHide);
    },
  );

  let busy = false;
  /** 저장 중에 들어온 변경 (예: 아이템을 빠르게 연달아 살 때) — 끝나면 이어서 보낸다 */
  let queued: Partial<RoomPlayer> | null = null;
  const update = async (patch: Partial<RoomPlayer>) => {
    const room = sess.room(id);
    if (!room) return;
    if (busy) {
      // 예전에는 여기서 버려서, 세 번째 아이템이 서버에 저장되지 않는 일이 있었다
      queued = { ...queued, ...patch };
      return;
    }
    busy = true;
    try {
      await backend!.updatePlayer(id, { ...myPlayer(room), ...patch });
      await sess.refetch();
    } catch (e) {
      toast(friendly(e));
    } finally {
      busy = false;
      if (queued) {
        const next = queued;
        queued = null;
        void update(next);
      }
    }
  };

  const teamsOk = (r: Room) => {
    // 백발백중은 개인전 (팀 나눔 없음)
    if (r.map === 'target') return r.players.length >= 2;
    const a = r.players.filter((p) => p.team === 0).length;
    return r.players.length >= 2 && a > 0 && a < r.players.length;
  };

  const draw = () => {
    const room = sess.room(id);
    if (!room) {
      toast('게임방이 사라졌어요');
      setScreenCleanup(null);
      unsubA();
      unsubB();
      unsubC();
      clearInterval(iv);
      window.removeEventListener('pagehide', onHide);
      void rs.leave();
      roomSess = null;
      void sess.setMyRoom(null);
      return renderLobby(sess);
    }
    if (!room.players.some((p) => p.id === clientId())) {
      toast(document.hidden || Date.now() - shownAt < 15_000 ? '연결이 끊겨 게임방에서 나왔어요' : '방장이 게임방에서 내보냈어요');
      unsubA();
      unsubB();
      unsubC();
      clearInterval(iv);
      window.removeEventListener('pagehide', onHide);
      setScreenCleanup(null);
      void rs.leave();
      roomSess = null;
      void sess.setMyRoom(null);
      return renderLobby(sess);
    }
    if (room.status === 'playing' && started.get(room.id) !== room.game_no) {
      unsubA();
      unsubB();
      unsubC();
      clearInterval(iv);
      window.removeEventListener('pagehide', onHide);
      setScreenCleanup(null);
      return startOnline(room, null);
    }
    const mineP = room.players.find((p) => p.id === clientId())!;
    const host = hostOf(room);
    const iAmHost = host === clientId();
    const locked = !iAmHost && !!mineP.ready;
    if (locked !== shopLocked) {
      shopLocked = locked;
      drawShop();
    }
    $(root, '#title').innerHTML = `${escapeHtml(room.name)} <small>${room.players.length}/4</small>`;
    $(root, '#slots').innerHTML = Array.from({ length: 4 }, (_, i) => {
      const p = room.players[i];
      if (!p) return `<div class="pslot empty">빈자리</div>`;
      const away = !rs.present.has(p.id);
      const isHost = p.id === host;
      return `<div class="pslot ${p.id === clientId() ? 'me' : ''} ${p.ready && !isHost ? 'ready' : ''}" style="--c:${TEAM_COLORS[p.team]}">
        ${isHost ? '<div class="badge host">👑 방장</div>' : p.ready ? '<div class="badge ready">READY</div>' : '<div class="badge wait">준비 중</div>'}
        <div class="pic">${tankSvg(p.tank, 70, p.team === 1)}</div>
        <div class="pn">${rankedName(p.name, 16, p.id)}${p.id === clientId() ? ' <small>(나)</small>' : ''}</div>
        <div class="pt"><span class="team-dot" style="--c:${TEAM_COLORS[p.team]}"></span>${TEAM_NAMES[p.team]} · ${p.tank === 'random' ? '랜덤' : TANKS[tankOr(p.tank)].name}</div>
        ${p.items.length ? `<div class="pi">아이템 ${p.items.length}개</div>` : ''}
        ${away ? '<div class="away">연결 확인 중…</div>' : ''}
        ${iAmHost && room.status === 'waiting' && p.id !== clientId() ? `<button class="kick" data-kick="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="강퇴">✕ 강퇴</button>` : ''}
      </div>`;
    }).join('');
    root.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (sess.room(id)?.status !== 'waiting') return toast('게임 중에는 강퇴할 수 없어요');
        if (!confirm(`${b.dataset.name}님을 게임방에서 강퇴할까요?`)) return;
        sfx.click();
        await backend!.kickPlayer(id, clientId(), b.dataset.kick!).catch((e) => toast(friendly(e)));
        rs.sendChat(`${b.dataset.name}님이 강퇴되었어요`);
        await sess.refetch();
      }),
    );
    // 안 연 고양이는 그림을 보여 주되 자물쇠 (누르면 안내만). 남이 고른 고양이는 위 자리 그림에 그대로 보인다
    const tankHtml = TANK_IDS.map((t) => {
      const lock = mineP.tank !== t && !isTankOpen(t);
      return `<button data-v="${t}" class="${mineP.tank === t ? 'sel' : ''} ${lock ? 'locked' : ''}" ${locked ? 'disabled' : ''} title="${lock ? lockTitle(t) : `${TANKS[t].name} (${TANKS[t].animal}) · ${TANKS[t].role}`}">${tankSvg(t, 40)}<span>${TANKS[t].name}</span>${lock ? lockBadge : ''}</button>`;
    }).join('') + `<button data-v="random" class="rand ${mineP.tank === 'random' ? 'sel' : ''}" ${locked ? 'disabled ' : ''}title="게임 시작 때 정해져요 · 20% 확률로 십이지신 '열두빛'"><span class="dice">🎲</span><span>랜덤</span></button>`;
    const tankEl = $(root, '#tank');
    if (tankEl.dataset.html !== tankHtml) {
      tankEl.innerHTML = tankHtml;
      tankEl.dataset.html = tankHtml;
    }
    $(root, '#tank-lock').innerHTML = lockNote();
    $(root, '#tank-name').textContent =
      mineP.tank === 'random' ? '랜덤 · 게임 시작 때 정해져요 (20% 확률로 십이지신 열두빛)' : `${TANKS[tankOr(mineP.tank)].name} (${TANKS[tankOr(mineP.tank)].animal}) · ${TANKS[tankOr(mineP.tank)].role}`;
    $(root, '#map-note').textContent = (room.map === 'target' ? '🎯 백발백중: 모두 꼬꼬댁 · 깃털탄만 · 개인전 · 과녁(인원 × 5개)을 먼저 맞히면 200점 (높은 층일수록 +50점씩)! · ' : room.map !== 'random' && MAPS[room.map].lockTank ? '🐶 아슬아슬: 모두 멍뭉이 · 땅파기탄(2번)만! · ' : '') + (iAmHost ? '방장만 바꿀 수 있어요' : '방장이 정해요');
    const needTeam = room.map !== 'target' && (room.players.length >= 3 || !teamsOk(room));
    $(root, '#team-box').style.display = needTeam ? '' : 'none';
    $(root, '#team').innerHTML = ([0, 1] as const)
      .map((t) => `<button data-v="${t}" class="${mineP.team === t ? 'sel' : ''}" ${locked ? 'disabled' : ''} style="--c:${TEAM_COLORS[t]}"><span class="team-dot" style="--c:${TEAM_COLORS[t]}"></span>${TEAM_NAMES[t]}</button>`)
      .join('');
    const maps: (MapId | 'random')[] = [...MAP_IDS, 'random'];
    $(root, '#map').innerHTML = maps.map((m) => `<button data-v="${m}" class="${room.map === m ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'}>${m === 'random' ? '랜덤' : MAPS[m].name}</button>`).join('');
    const speed = room.speed ?? 1.5;
    const wind = room.wind ?? 'slow';
    const mode = room.mode ?? 'normal';
    $(root, '#mode').innerHTML = (['easy', 'normal'] as const)
      .map((v) => `<button data-v="${v}" class="${mode === v ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'} title="${v === 'easy' ? '사람이 쏜 탄이 적 쪽으로 휘어요 (AI 제외)' : ''}">${v === 'easy' ? '초보' : '일반'}</button>`)
      .join('');
    root.querySelectorAll<HTMLElement>('#mode button').forEach((b) =>
      b.addEventListener('click', async () => {
        sfx.click();
        await backend!.setMode(id, clientId(), b.dataset.v as 'easy' | 'normal').catch((e) => toast(friendly(e)));
        await sess.refetch();
      }),
    );
    $(root, '#speed').innerHTML = ([1, 1.5] as const)
      .map((v) => `<button data-v="${v}" class="${speed === v ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'}>${v === 1 ? '보통 (1배)' : '빠르게 (1.5배)'}</button>`)
      .join('');
    $(root, '#wind').innerHTML = (['slow', 'normal', 'fast'] as const)
      .map((v) => `<button data-v="${v}" class="${wind === v ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'}>${WIND_LABEL[v]}</button>`)
      .join('');
    $(root, '#sudden-note').textContent =
      room.map === 'target' ? '' : suddenFor(room)
        ? `🌊 서든데스: ${SUDDEN_TURN}턴 뒤부터 물이 차올라요`
        : roomSess?.anyUnseen(room.players.map((p) => p.id))
          ? '🌊 서든데스: 접속을 확인하는 중이에요'
          : '🌊 서든데스 꺼짐 — 새로고침하지 않은 기기가 있어요';
    const setOpt = async (sp: number, wd: WindMode) => {
      sfx.click();
      await backend!.setOptions(id, clientId(), sp, wd).catch((e) => toast(friendly(e)));
      await sess.refetch();
    };
    root.querySelectorAll<HTMLElement>('#speed button').forEach((b) => b.addEventListener('click', () => void setOpt(Number(b.dataset.v), wind)));
    root.querySelectorAll<HTMLElement>('#wind button').forEach((b) => b.addEventListener('click', () => void setOpt(speed, b.dataset.v as WindMode)));
    root.querySelectorAll<HTMLElement>('#tank button').forEach((b) =>
      b.addEventListener('click', () => {
        if (!isTankOpen(b.dataset.v!)) return; // 잠긴 칸은 아래 한 번만 붙인 클릭에서 (그리기마다 붙는 이 클릭이 겹쳐도 두 번 사지 않게)
        state.tank = b.dataset.v as TankChoice;
        sfx.click();
        void update({ tank: state.tank });
      }),
    );
    root.querySelectorAll<HTMLElement>('#team button').forEach((b) => b.addEventListener('click', () => void update({ team: Number(b.dataset.v) as 0 | 1 })));
    root.querySelectorAll<HTMLElement>('#map button').forEach((b) =>
      b.addEventListener('click', async () => {
        sfx.click();
        await backend!.setMap(id, clientId(), b.dataset.v as MapId | 'random').catch((e) => toast(friendly(e)));
        await sess.refetch();
      }),
    );
    const startBtn = $<HTMLButtonElement>(root, '#start');
    const ok = teamsOk(room);
    const others = room.players.filter((p) => p.id !== host);
    const readyN = others.filter((p) => p.ready).length;
    startBtn.classList.toggle('ready-on', !iAmHost && !!mineP.ready);
    if (iAmHost) {
      const can = ok && allReady(room);
      startBtn.disabled = !can;
      startBtn.textContent =
        room.players.length < 2 ? '친구를 기다리는 중… (2명부터 시작)' : !ok ? '한 팀에 모두 몰려 있어요' : can ? '게임 시작 ▶' : `모두 레디하면 시작할 수 있어요 (${readyN}/${others.length})`;
    } else {
      startBtn.disabled = false;
      startBtn.textContent = mineP.ready ? `레디 완료! 방장을 기다리는 중 (${readyN}/${others.length}) · 취소` : '레디!';
    }
    renderChatLog(root, rs);
  };

  let shopLocked = false;
  const drawShop = () => {
    renderShop(
      $(root, '#shop'),
      state.shop[0],
      () => {
        drawShop();
        void update({ items: [...state.shop[0]] });
      },
      shopLocked,
      state.points,
    );
  };

  const unsubA = sess.subscribe(draw);
  const unsubB = rs.onPresence(draw);
  const unsubC = rs.onChat(() => renderChatLog(root, rs));
  // 잠긴 고양이: 칸이나 아래 '시아코인 100개로 열기' 를 누르면 확인 글 → 한 번 더 누르면 산다. 열리면 골라 둔다
  // (탱크 칸 클릭은 그릴 때마다 다시 붙어 겹칠 수 있으므로, 열기는 여기서 한 번만 붙인다)
  const unlockHooks: UnlockHooks = {
    repaint: () => {
      if (root.isConnected) $(root, '#tank-lock').innerHTML = lockNote();
    },
    toast,
    opened: () => {
      const room = sess.room(id);
      const mine = room?.players.find((p) => p.id === clientId());
      if (!room || !mine || (mine.ready && hostOf(room) !== clientId())) return;
      state.tank = 'cat';
      void update({ tank: state.tank });
    },
  };
  const onUnlockClick = (e: Event) => {
    const t = e.target as HTMLElement;
    if (!t.closest('[data-unlock], button.locked:not(:disabled)')) return;
    sfx.click();
    void pressUnlock(unlockHooks);
  };
  $(root, '#tank').addEventListener('click', onUnlockClick);
  $(root, '#tank-lock').addEventListener('click', onUnlockClick);
  // 다른 기기에서 열고 돌아와도 자물쇠를 바로 푼다 (이 화면을 떠났으면 스스로 끈다)
  const offUnlock = onUnlockChange(() => (root.isConnected ? draw() : offUnlock()));
  void refreshProgress();
  // 대기방에서 접속이 끊긴 사람은 잠시(ABSENT_GRACE_MS) 기다린 뒤 방에서 뺀다 (방에 있는 사람 중 첫 번째가 처리)
  const iv = setInterval(() => {
    const room = sess.room(id);
    if (!room || room.status !== 'waiting') return;
    const now = Date.now();
    const here = room.players.filter((p) => rs.present.has(p.id));
    // 대기 중에도 방에 사람이 있다는 신호 (30초마다, 첫 번째 사람이)
    if (here[0]?.id === clientId() && now - lastBeat > 30_000) {
      lastBeat = now;
      void backend!.touchRoom(id, clientId()).catch(() => undefined);
    }
    for (const p of room.players) {
      if (!seenSince.has(p.id)) seenSince.set(p.id, now);
      if (rs.present.has(p.id) || now - seenSince.get(p.id)! < JOIN_GRACE_MS) absentSince.delete(p.id);
      else if (!absentSince.has(p.id)) absentSince.set(p.id, now);
      else if (now - absentSince.get(p.id)! > ABSENT_GRACE_MS && here[0]?.id === clientId()) {
        absentSince.delete(p.id);
        void backend!.leaveRoom(id, p.id).then(() => sess.refetch());
      }
    }
  }, 1000);
  // 창을 닫거나 다른 곳으로 가면 스스로 대기방에서 나간다
  const onHide = () => {
    if (sess.room(id)?.status === 'waiting') void backend!.leaveRoom(id, clientId()).catch(() => undefined);
  };
  window.addEventListener('pagehide', onHide);

  draw();
  drawShop();
  bindChat(root, rs);
  $(root, '#leave').addEventListener('click', () => {
    unsubA();
    unsubB();
    unsubC();
    clearInterval(iv);
    window.removeEventListener('pagehide', onHide);
    setScreenCleanup(null);
    void leaveRoom();
  });
  $(root, '#copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lobbyLink(sess.code));
      toast('대기실 링크를 복사했어요');
    } catch {
      prompt('이 링크를 복사해서 보내주세요', lobbyLink(sess.code));
    }
  });
  $(root, '#start').addEventListener('click', async () => {
    sfx.click();
    const room = sess.room(id);
    if (!room) return;
    if (hostOf(room) !== clientId()) {
      // 방장이 아니면 레디 켜고 끄기
      const mineP = room.players.find((p) => p.id === clientId());
      await update({ ready: !mineP?.ready });
      return;
    }
    const b = $<HTMLButtonElement>(root, '#start');
    b.disabled = true;
    try {
      await backend!.startGame(id, clientId(), randomSeed());
      await sess.refetch();
    } catch (e) {
      toast(friendly(e));
      b.disabled = false;
    }
  });
}

// ---------- 온라인 대전 ----------

function setupsOf(room: Room): PlayerSetup[] {
  // '랜덤'은 판의 시드로 정한다 (모든 기기가 같은 결과)
  const list: PlayerSetup[] = room.players.map((p, i) => {
    const r = new Rng(((room.seed ?? 1) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const tank = p.tank === 'random' ? randomTank(() => r.next()) : tankOr(p.tank);
    return { id: p.id, name: p.name, tank, team: p.team, ai: null, items: [...p.items] };
  });
  // 2:1이면 사람이 적은 팀에 AI(초보 또는 보통)가 한 명 들어온다 (시드로 정해서 모든 기기가 같다)
  const n0 = list.filter((p) => p.team === 0).length;
  const n1 = list.length - n0;
  if (list.length === 3 && Math.abs(n0 - n1) === 1 && room.map !== 'target') {
    const r = new Rng(((room.seed ?? 1) ^ 0x2545f491) >>> 0);
    const easy = r.next() < 0.5;
    list.push({ name: easy ? 'AI(초보)' : 'AI(보통)', tank: r.pick(RANDOM_TANK_IDS), team: n0 < n1 ? 0 : 1, ai: easy ? 'easy' : 'normal', items: [] });
  }
  return list;
}

/** 이 판에 서든데스를 켤지: 방 사람들의 기기가 모두 서든데스를 알 때만 */
function suddenFor(room: Room): number {
  return roomSess?.allAtLeast(room.players.map((p) => p.id), SUDDEN_VERSION) ? SUDDEN_TURN : 0;
}

function mapOf(room: Room): MapId {
  return room.map === 'random' ? new Rng((room.seed ?? 0) ^ 0x51ed270b).pick(RANDOM_MAP_IDS) : room.map;
}

async function resumeGame(room: Room) {
  if (!room.players.some((p) => p.id === clientId())) return renderLobby(lobby!);
  screen(`<div class="connecting"><div class="spinner"></div><p>진행 중인 게임에 다시 들어가는 중…</p></div>`, 'center');
  const game = new OnlineGame(roomSess!, room, clientId());
  const r = await game.resume();
  if (r === 'denied' || r === 'timeout') {
    game.dispose();
    // 다시 들어갈 수 없으면 그 판에서 나간 것으로 기록 (모두 나갔으면 방이 지워진다)
    await backend!.quitGame(room.id, clientId()).catch(() => undefined);
    toast(r === 'denied' ? 'AI가 이어서 조종하고 있어 이 판에는 다시 들어갈 수 없어요' : '게임 상태를 받아오지 못했어요');
    await roomSess?.leave();
    roomSess = null;
    await lobby!.setMyRoom(null);
    started.set(room.id, room.game_no);
    return renderLobby(lobby!);
  }
  startOnline(room, game, r);
}

function startOnline(room: Room, game: OnlineGame | null, resume?: Parameters<typeof launchGame>[0]['resume']) {
  started.set(room.id, room.game_no);
  online?.dispose();
  online = game ?? new OnlineGame(roomSess!, room, clientId());
  const g = online;
  const sess = lobby!;
  // 게임 중에는 기준 기기가 방에 사람이 있다는 신호를 보낸다
  const beat = setInterval(() => {
    if (online !== g) return clearInterval(beat);
    if (g.isHost()) void backend!.touchRoom(room.id, clientId()).catch(() => undefined);
  }, 30_000);
  // 게임 중 나가기 (나가기 버튼, 또는 자리를 오래 비워 AI가 내 탱크를 넘겨받았을 때)
  const quit = () => {
    if (online !== g) return;
    clearInterval(beat);
    // 모두 나가면 서버가 방을 지운다
    void backend!.quitGame(room.id, clientId()).then(() => sess.refetch());
    g.dispose();
    online = null;
    closeGame();
    void roomSess?.leave();
    roomSess = null;
    void sess.setMyRoom(null);
    renderLobby(sess);
  };
  launchGame({
    setups: setupsOf(room),
    mapId: mapOf(room),
    seed: room.seed ?? 1,
    speed: room.speed ?? 1.5,
    mode: room.mode ?? 'normal',
    wind: room.wind ?? 'slow',
    // 서든데스: 방의 모든 기기가 아는 판본일 때만 (예전 탭이 섞이면 끈다). 다시 들어온 판은 받은 판 상태의 설정을 따른다
    sudden: suddenFor(room),
    chat: roomSess ?? undefined,
    net: g,
    resume,
    onEnd: (s: MatchSummary) => {
      clearInterval(beat);
      // 판 결과 정리 (실패하면 몇 번 더 시도)
      const present = g.presentIds();
      // 결과는 기준 기기만 올린다. 다른 기기는 잠깐 기다렸다가 방이 아직 진행 중일 때만 (화면이 어긋난 기기가 먼저 정산하지 않게)
      const settler = g.isHost();
      // 백발백중은 승패를 기록하지 않는다 (점수는 백발백중 랭킹으로)
      const winner = s.winner === -1 || s.practice ? null : s.winner;
      lastWinner = winner;
      const settle = async () => {
        if (!settler) {
          await new Promise((r) => setTimeout(r, SETTLE_WAIT_MS));
          await sess.refetch();
          const now = sess.room(room.id);
          if (!now || now.status !== 'playing' || now.game_no !== g.gameNo) return;
        }
        for (let i = 0; i < 4; i++) {
          try {
            await backend!.endGame(room.id, g.gameNo, present, winner);
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          }
        }
      };
      const done = settle().catch(() => undefined);
      settling = done;
      const finish = async () => {
        await done;
        await sess.refetch();
        await refreshRanking();
        if (s.practice) return void recordTarget(s);
        // 내 전적 (승패가 난 판만 기록된다)
        const mine = ranking().find((r) => r.key === clientId());
        if (lastWinner !== null && mine) toast(`🏅 내 전적 ${mine.wins}승 ${mine.losses}패`);
      };
      void finish();
      g.dispose();
      online = null;
      closeGame();
      state.shop[0] = [];
      showResult(s, {
        primary: '게임방으로',
        onPrimary: () => backToRoom(room.id),
      });
    },
    onQuit: quit,
  });
  g.whenKicked(() => {
    toast(KICKED_TEXT);
    quit();
  });
}

async function backToRoom(id: string) {
  const sess = lobby!;
  // 이 기기의 결과 정리(기준 기기가 아니면 몇 초 기다림)가 끝난 뒤에 본다
  if (settling) await settling;
  await sess.refetch();
  const room = sess.room(id);
  if (!room || !room.players.some((p) => p.id === clientId())) {
    toast('게임방이 정리되었어요');
    return renderLobby(sess);
  }
  if (room.status === 'playing') {
    // 다른 기기가 결과를 정리할 때까지 잠깐 기다린다
    await backend!.endGame(room.id, room.game_no, [clientId(), ...[...(roomSess?.present ?? [])]], lastWinner).catch(() => undefined);
    await sess.refetch();
  }
  renderRoom(id);
}

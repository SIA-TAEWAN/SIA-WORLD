import { TANKS, TANK_IDS, randomTank, type TankChoice } from '../game/data';
import { MAPS, MAP_IDS, type MapId } from '../data/maps';
import type { PlayerSetup } from '../game/types';
import type { WindMode } from '../game/match';
import { Rng, randomSeed } from '../game/rng';
import type { MatchSummary } from '../scenes/GameScene';
import { TEAM_COLORS, TEAM_NAMES } from './teams';
import { getBackend, lobbyCode, lobbyLink, clientId } from '../net';
import { allReady, friendly, hostOf, type Backend, type Room, type RoomPlayer } from '../net/backend';
import { DuplicateNameError, LobbyFullError, LobbySession, LOBBY_MAX } from '../net/lobby';
import { RoomSession } from '../net/room';
import { OnlineGame } from '../net/online';
import { $, closeGame, launchGame, nav, screen, setScreenCleanup, state, toast } from './app';
import { escapeHtml } from './hud';
import { renderShop } from './shop';
import { tankSvg } from './tankSvg';
import { sfx } from './sfx';
import { showResult } from './offline';

let backend: Backend | null = null;
let lobby: LobbySession | null = null;
let roomSess: RoomSession | null = null;
let online: OnlineGame | null = null;
/** 게임방별로 이미 시작한 판 번호 (같은 판을 두 번 열지 않도록) */
const started = new Map<string, number>();

const me = () => ({ id: clientId(), name: state.name });
/** 마지막 판의 승리 팀 (게임방으로 돌아갈 때 정산이 아직이면 같이 보낸다) */
let lastWinner: number | null = null;
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

// ---------- 대기실 ----------

export async function showLobby() {
  if (!lobby) {
    screen(`<div class="connecting"><div class="spinner"></div><p>대기실에 들어가는 중…</p></div>`, 'center');
    backend = await getBackend();
    if (!backend) {
      toast('온라인 서버가 설정되지 않았어요');
      return nav.entry();
    }
    const sess = new LobbySession(backend, lobbyCode(), me());
    try {
      await sess.enter();
    } catch (e) {
      if (e instanceof LobbyFullError) toast('대기실이 가득 찼습니다 (최대 10명)');
      else if (e instanceof DuplicateNameError) toast('이 대기실에 같은 ID가 이미 있어요. 다른 ID로 들어와 주세요');
      else toast('서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요');
      return nav.entry();
    }
    lobby = sess;
    state.points = await backend.getPoints(state.name).catch(() => 1000);
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

async function leaveLobby() {
  await roomSess?.leave();
  roomSess = null;
  await lobby?.leave();
  lobby = null;
  nav.entry();
}

function renderLobby(sess: LobbySession) {
  const root = screen(
    `<header class="bar">
      <button class="btn ghost" id="exit">← 나가기</button>
      <h2>대기실 <small id="count"></small></h2>
      <span class="my-points" title="온라인에서 이기면 +100, 지면 -100 (최저 1,000)">🏅 ${state.points.toLocaleString()}P</span>
      <button class="btn small-btn" id="copy">🔗 링크 복사</button>
    </header>
    <div class="lobby-grid">
      <section class="card rooms-card">
        <div class="card-head"><h3>게임방</h3><button class="btn primary small-btn" id="create">＋ 방 만들기</button></div>
        <div class="room-list" id="rooms"></div>
      </section>
      <section class="card shop-card">
        <h3>아이템 상점 <small>매 판 1,000 포인트 · 3칸</small></h3>
        <div id="shop"></div>
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
    $(root, '#count').textContent = `${sess.members.length}/${LOBBY_MAX}명 · ${sess.code === 'main' ? '기본' : escapeHtml(sess.code)}`;
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
              <div class="rn">${escapeHtml(r.name)}<small>${r.map === 'random' ? '랜덤 맵' : MAPS[r.map].name} · ${r.players.map((p) => escapeHtml(p.name)).join(', ')}</small></div>
              <span class="cnt">${r.players.length}/4</span>
              <span class="st">${playing ? '게임 중' : '대기'}</span>
              <button class="btn small-btn ${can ? 'primary' : ''}" data-id="${r.id}" ${can ? '' : 'disabled'}>${label}</button>
            </div>`;
          })
          .join('')
      : '<p class="empty">아직 게임방이 없어요. 방을 만들어 친구를 불러보세요!</p>';
    root.querySelectorAll<HTMLElement>('.room-row button[data-id]').forEach((b) => b.addEventListener('click', () => enterRoom(b.dataset.id!)));
    $(root, '#people').innerHTML = sess.members
      .map((m) => {
        const r = m.meta.room ? sess.room(m.meta.room) : undefined;
        return `<li class="${m.key === clientId() ? 'me' : ''}">${escapeHtml(m.meta.name)}${r ? `<small>${r.status === 'playing' ? '게임 중' : '게임방'}</small>` : ''}</li>`;
      })
      .join('');
    renderChatLog(root, sess);
  };
  const drawShop = () => renderShop($(root, '#shop'), state.shop[0], drawShop, false, state.points);
  const unsub = sess.subscribe(draw);
  draw();
  drawShop();
  bindChat(root, sess);

  $(root, '#exit').addEventListener('click', () => void leaveLobby());
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
        <div id="team-box"><h3>팀 선택</h3><div class="seg" id="team"></div></div>
        <h3>맵 <small id="map-note"></small></h3>
        <div class="seg small" id="map"></div>
        <div class="opt-row"><span class="lbl">게임 속도</span><div class="seg small" id="speed"></div></div>
        <div class="opt-row"><span class="lbl">바람 변화</span><div class="seg small" id="wind"></div></div>
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
    },
  );

  let busy = false;
  const update = async (patch: Partial<RoomPlayer>) => {
    const room = sess.room(id);
    if (!room || busy) return;
    busy = true;
    try {
      await backend!.updatePlayer(id, { ...myPlayer(room), ...patch });
      await sess.refetch();
    } catch (e) {
      toast(friendly(e));
    } finally {
      busy = false;
    }
  };

  const teamsOk = (r: Room) => {
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
      void rs.leave();
      roomSess = null;
      void sess.setMyRoom(null);
      return renderLobby(sess);
    }
    if (!room.players.some((p) => p.id === clientId())) {
      toast('게임방에서 나가졌어요');
      unsubA();
      unsubB();
      unsubC();
      clearInterval(iv);
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
        <div class="pn">${escapeHtml(p.name)}${p.id === clientId() ? ' <small>(나)</small>' : ''}</div>
        <div class="pt"><span class="team-dot" style="--c:${TEAM_COLORS[p.team]}"></span>${TEAM_NAMES[p.team]} · ${p.tank === 'random' ? '랜덤' : TANKS[p.tank].name}</div>
        ${p.items.length ? `<div class="pi">아이템 ${p.items.length}개</div>` : ''}
        ${away ? '<div class="away">연결 확인 중…</div>' : ''}
      </div>`;
    }).join('');
    const tankHtml = TANK_IDS.map(
      (t) => `<button data-v="${t}" class="${mineP.tank === t ? 'sel' : ''}" ${locked ? 'disabled' : ''} title="${TANKS[t].name} (${TANKS[t].animal}) · ${TANKS[t].role}">${tankSvg(t, 40)}<span>${TANKS[t].name}</span></button>`,
    ).join('') + `<button data-v="random" class="rand ${mineP.tank === 'random' ? 'sel' : ''}" ${locked ? 'disabled ' : ''}title="게임 시작 때 정해져요 · 20% 확률로 십이지신 '열두빛'"><span class="dice">🎲</span><span>랜덤</span></button>`;
    const tankEl = $(root, '#tank');
    if (tankEl.dataset.html !== tankHtml) {
      tankEl.innerHTML = tankHtml;
      tankEl.dataset.html = tankHtml;
    }
    $(root, '#tank-name').textContent =
      mineP.tank === 'random' ? '랜덤 · 게임 시작 때 정해져요 (20% 확률로 십이지신 열두빛)' : `${TANKS[mineP.tank].name} (${TANKS[mineP.tank].animal}) · ${TANKS[mineP.tank].role}`;
    $(root, '#map-note').textContent = iAmHost ? '방장만 바꿀 수 있어요' : '방장이 정해요';
    const needTeam = room.players.length >= 3 || !teamsOk(room);
    $(root, '#team-box').style.display = needTeam ? '' : 'none';
    $(root, '#team').innerHTML = ([0, 1] as const)
      .map((t) => `<button data-v="${t}" class="${mineP.team === t ? 'sel' : ''}" ${locked ? 'disabled' : ''} style="--c:${TEAM_COLORS[t]}"><span class="team-dot" style="--c:${TEAM_COLORS[t]}"></span>${TEAM_NAMES[t]}</button>`)
      .join('');
    const maps: (MapId | 'random')[] = [...MAP_IDS, 'random'];
    $(root, '#map').innerHTML = maps.map((m) => `<button data-v="${m}" class="${room.map === m ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'}>${m === 'random' ? '랜덤' : MAPS[m].name}</button>`).join('');
    const speed = room.speed ?? 1;
    const wind = room.wind ?? 'normal';
    $(root, '#speed').innerHTML = ([1, 1.5] as const)
      .map((v) => `<button data-v="${v}" class="${speed === v ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'}>${v === 1 ? '보통 (1배)' : '빠르게 (1.5배)'}</button>`)
      .join('');
    $(root, '#wind').innerHTML = (['slow', 'normal', 'fast'] as const)
      .map((v) => `<button data-v="${v}" class="${wind === v ? 'sel' : ''}" ${iAmHost ? '' : 'disabled'}>${WIND_LABEL[v]}</button>`)
      .join('');
    const setOpt = async (sp: number, wd: WindMode) => {
      sfx.click();
      await backend!.setOptions(id, clientId(), sp, wd).catch((e) => toast(friendly(e)));
      await sess.refetch();
    };
    root.querySelectorAll<HTMLElement>('#speed button').forEach((b) => b.addEventListener('click', () => void setOpt(Number(b.dataset.v), wind)));
    root.querySelectorAll<HTMLElement>('#wind button').forEach((b) => b.addEventListener('click', () => void setOpt(speed, b.dataset.v as WindMode)));
    root.querySelectorAll<HTMLElement>('#tank button').forEach((b) =>
      b.addEventListener('click', () => {
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
  // 브라우저를 그냥 닫은 사람은 잠시 뒤 방에서 뺀다 (방에 있는 사람 중 첫 번째가 처리)
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
      if (rs.present.has(p.id)) absentSince.delete(p.id);
      else if (!absentSince.has(p.id)) absentSince.set(p.id, now);
      else if (now - absentSince.get(p.id)! > 8000 && here[0]?.id === clientId()) {
        absentSince.delete(p.id);
        void backend!.leaveRoom(id, p.id).then(() => sess.refetch());
      }
    }
  }, 2000);

  draw();
  drawShop();
  bindChat(root, rs);
  $(root, '#leave').addEventListener('click', () => {
    unsubA();
    unsubB();
    unsubC();
    clearInterval(iv);
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
  return room.players.map((p, i) => {
    const r = new Rng(((room.seed ?? 1) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const tank = p.tank === 'random' ? randomTank(() => r.next(), p.name) : p.tank;
    return { id: p.id, name: p.name, tank, team: p.team, ai: null, items: [...p.items] };
  });
}

function mapOf(room: Room): MapId {
  return room.map === 'random' ? new Rng((room.seed ?? 0) ^ 0x51ed270b).pick(MAP_IDS) : room.map;
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
  launchGame({
    setups: setupsOf(room),
    mapId: mapOf(room),
    seed: room.seed ?? 1,
    speed: room.speed ?? 1,
    wind: room.wind ?? 'normal',
    net: g,
    resume,
    onEnd: (s: MatchSummary) => {
      clearInterval(beat);
      // 판 결과 정리 (실패하면 몇 번 더 시도)
      const present = g.presentIds();
      const before = state.points;
      lastWinner = s.winner === -1 ? null : s.winner;
      const finish = async () => {
        for (let i = 0; i < 4; i++) {
          try {
            await backend!.endGame(room.id, g.gameNo, present, s.winner === -1 ? null : s.winner);
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          }
        }
        await sess.refetch();
        state.points = await backend!.getPoints(state.name).catch(() => state.points);
        const d = state.points - before;
        toast(d > 0 ? `🏅 승리! 포인트 +${d} → ${state.points.toLocaleString()}P` : d < 0 ? `포인트 ${d} → ${state.points.toLocaleString()}P` : `포인트 ${state.points.toLocaleString()}P (최저 1,000)`);
      };
      void finish();
      g.dispose();
      online = null;
      closeGame();
      state.shop[0] = [];
      showResult(s, {
        primary: '게임방으로',
        onPrimary: () => backToRoom(room.id),
        secondary: '대기실로',
        onSecondary: () => void leaveRoom(),
      });
    },
    onQuit: () => {
      clearInterval(beat);
      // 게임 중 나가기: 모두 나가면 서버가 방을 지운다
      void backend!.quitGame(room.id, clientId()).then(() => sess.refetch());
      g.dispose();
      online = null;
      closeGame();
      void roomSess?.leave();
      roomSess = null;
      void sess.setMyRoom(null);
      renderLobby(sess);
    },
  });
}

async function backToRoom(id: string) {
  const sess = lobby!;
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

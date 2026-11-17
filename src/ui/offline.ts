import { TANKS, TANK_IDS, WEAPONS, randomTank, type TankChoice, type TankId } from '../game/data';
import { MAPS, MAP_IDS, RANDOM_MAP_IDS, type MapId } from '../data/maps';
import type { Difficulty, PlayerSetup } from '../game/types';
import { Rng, randomSeed } from '../game/rng';
import { aiItems } from '../ai/ai';
import type { MatchSummary } from '../scenes/GameScene';
import { escapeHtml } from './hud';
import { tankSvg } from './tankSvg';
import { save } from './storage';
import { sfx } from './sfx';
import { TEAM_COLORS, TEAM_NAMES } from './teams';
import { closeGame, launchGame, nav, screen, state, toast, type Opponent } from './app';
import { renderShop as shopWidget } from './shop';
import { getBackend, onlineConfigured } from '../net';
import { setRanking, setTargetRanking } from './rank';
import { friendly } from '../net/backend';

// ---------- 1. 입장 ----------

export function showEntry() {
  const online = onlineConfigured();
  const logged = online && !!state.token && !!state.name;
  const root = screen(
    `<div class="entry-card">
      <div class="logo">
        <div class="logo-tanks">${tankSvg('tiger', 84)}${tankSvg('rabbit', 84, true)}</div>
        <h1>시아탱크</h1>
        <p class="tagline">각도 · 파워 · 바람! 링크 하나로 한 판</p>
      </div>
      ${
        logged
          ? `<p class="who"><b>${escapeHtml(state.name)}</b>님 환영해요! <button class="link" id="logout">로그아웃</button></p>`
          : `<label class="field">
        <span>내 ID</span>
        <input id="name" maxlength="10" autocomplete="username" placeholder="2~10자" value="${escapeHtml(state.name)}" />
      </label>
      ${online ? `<label class="field"><span>비밀번호</span><input id="pw" type="password" maxlength="40" autocomplete="current-password" placeholder="4자 이상" /></label>` : ''}`
      }
      <p class="hint" id="name-hint"></p>
      ${
        logged || !online
          ? `<button class="btn big primary" id="lobby">대기실 입장</button>`
          : `<div class="auth-row"><button class="btn big primary" id="login">로그인</button><button class="btn big" id="signup">회원가입</button></div>`
      }
      <button class="btn big" id="ai">AI와 1:1</button>
      ${manualHtml()}
    </div>`,
    'entry',
  );
  const input = root.querySelector<HTMLInputElement>('#name');
  const pw = root.querySelector<HTMLInputElement>('#pw');
  const hint = root.querySelector<HTMLElement>('#name-hint')!;
  const valid = () => {
    if (!input) return true;
    const v = input.value.trim();
    return v.length >= 2 && v.length <= 10;
  };
  const go = () => {
    if (!valid()) {
      hint.textContent = 'ID는 2~10자로 정해주세요';
      input?.focus();
      return false;
    }
    if (input) state.name = input.value.trim();
    save({ name: state.name });
    return true;
  };
  // 로그인 / 회원가입
  let busy = false;
  const auth = async (kind: 'in' | 'up') => {
    if (busy || !go()) return;
    const p = pw!.value;
    if (p.length < 4) {
      hint.textContent = '비밀번호는 4자 이상이에요';
      return pw!.focus();
    }
    busy = true;
    hint.textContent = kind === 'in' ? '로그인 중…' : '가입 중…';
    try {
      const b = (await getBackend())!;
      const tok = kind === 'in' ? await b.signIn(state.name, p) : await b.signUp(state.name, p);
      state.token = tok;
      save({ name: state.name, token: tok });
      toast(kind === 'in' ? `${state.name}님 어서 오세요!` : `가입 완료! ${state.name}님 환영해요`);
      nav.lobby();
    } catch (e) {
      hint.textContent = friendly(e);
    } finally {
      busy = false;
    }
  };
  input?.addEventListener('input', () => (hint.textContent = ''));
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (!online) return go() && showSetup();
    if (pw && !pw.value) return pw.focus();
    void auth('in');
  };
  input?.addEventListener('keydown', onEnter);
  pw?.addEventListener('keydown', onEnter);
  root.querySelector('#login')?.addEventListener('click', () => (sfx.click(), void auth('in')));
  root.querySelector('#signup')?.addEventListener('click', () => (sfx.click(), void auth('up')));
  root.querySelector('#logout')?.addEventListener('click', () => {
    sfx.click();
    state.token = '';
    save({ token: '' });
    showEntry();
  });
  root.querySelector('#ai')!.addEventListener('click', () => {
    sfx.click();
    if (go()) showSetup();
  });
  root.querySelector('#lobby')?.addEventListener('click', () => {
    sfx.click();
    if (!online) return toast('온라인 서버가 아직 설정되지 않았어요. AI 1:1을 즐겨주세요!');
    if (go()) nav.lobby();
  });
  if (input && !state.name) input.focus();
  else pw?.focus();
  // 저장된 로그인이 아직 유효한지 확인 (다른 곳에서 바뀌었으면 다시 로그인)
  if (logged)
    void getBackend().then(async (b) => {
      if (b && !(await b.checkSession(state.name, state.token))) {
        state.token = '';
        save({ token: '' });
        toast('로그인이 만료됐어요. 다시 로그인해 주세요');
        if (document.body.contains(root)) showEntry();
      }
    });
}

/** 첫 화면 사용 설명서: 항목을 누르면 자세한 내용이 펼쳐진다 */
const MANUAL: [string, string][] = [
  ['🔑 회원가입 · 로그인', `<p>처음이면 ID(2~10자)와 비밀번호(4자 이상)를 넣고 <b>회원가입</b>, 다음부터는 <b>로그인</b>을 누르세요.</p>
    <p>한 번 로그인하면 이 기기에서는 계속 유지돼요. 비밀번호 찾기가 없으니 꼭 기억해 두세요.</p>
    <p>AI와 1:1은 로그인 없이도 할 수 있어요.</p>`],
  ['🎮 조작 방법', `<ul><li><b>PC</b>: ← → 이동 · ↑ ↓ 포신 각도 · <b>스페이스</b>를 길게 눌렀다 떼면 발사</li>
    <li>1 · 2 · 3 무기 선택 · Q W E 아이템 · Enter 채팅</li>
    <li><b>휴대폰</b>: 화면 아래 버튼으로 조작, 두 손가락으로 오므리면 맵이 넓게 보여요</li>
    <li>파워 게이지를 누르면 <b>리미터</b>가 생겨서, 끝까지 눌러도 그 힘까지만 쏴요</li></ul>`],
  ['🎯 게임 규칙', `<ul><li>차례대로 한 번씩 쏘고, 상대 탱크의 체력을 모두 없애면 이겨요</li>
    <li><b>바람</b>이 포탄을 밀어요. 화면 위 바람 표시를 꼭 보세요</li>
    <li>탱크가 비탈에 서 있으면 그만큼 발사 각도가 바뀌어요</li>
    <li>세게 쏠수록 땅을 크게 파요. 땅이 꺼지면 탱크가 떨어지고, 맵 아래로 떨어지면 탈락이에요</li>
    <li><b>내 포탄이나 우리 팀 포탄에 맞아도</b> 체력이 닳아요. 가까이 쏠 때 조심!</li>
    <li>10턴마다 비행기가 <b>보급 상자</b>를 떨어뜨려요. 탱크로 가서 닿아야 얻어요</li></ul>`],
  ['🧱 특수 벽', `<p>가끔(턴마다 5%) 두 팀 사이에 빛나는 벽이 생겨서 <b>3턴</b> 동안 있어요. 포탄이 벽을 지나가면 효과가 생겨요 (천장 위로 넘기면 효과 없음).</p>
    <ul><li><b>⚡ 증폭벽</b>: 피해와 구덩이가 1.3배, 불·독도 1.3배로 세고 넓어져요</li>
    <li><b>🌀 회오리</b>: 벽을 돌며 위로 올라갔다가 원래 방향으로 날아가요</li>
    <li><b>×2 더블벽</b>: 벽에서 같은 포탄이 한 발 더 나가요</li>
    <li><b>×3 트리플벽</b>: 포탄이 세 갈래로 갈라져요</li></ul>`],
  ['🔥 불 · ☠️ 독', `<ul><li><b>여의룡 불꽃탄</b>: 땅에 불이 3턴 동안 남아요</li>
    <li><b>스르르 독안개</b>: 독안개가 남았다가 스르르 다음 차례에 사라져요</li>
    <li>불·독안개에 닿으면 5초 동안 최대 체력의 <b>10%</b>가 깎이고, 그 불·독안개는 사라져요</li>
    <li><b>꼬꼬댁 깃털탄 · 스르르 이무기</b>에 맞으면 <b>중독</b>(녹색 탱크, ☠️ 표시): 다음 차례부터 3번, 차례마다 10%씩 깎여요</li>
    <li>불·독으로는 죽지 않아요 (체력 1은 남아요)</li></ul>`],
  ['🐯 탱크와 무기', `<p>12지신 탱크 12대가 있고, 탱크마다 1·2번 무기와 <b>3번 필살기</b>가 달라요. 무기 설명은 탱크를 고를 때 볼 수 있어요.</p>
    <p>필살기는 맞히거나 맞을 때 게이지가 차고, 100%가 되면 쓸 수 있어요.</p>
    <p><b>🎲 랜덤</b>을 고르면 게임 시작 때 탱크가 정해지고, 20% 확률로 더 강한 <b>십이지신 '열두빛'</b>이 나와요.</p>`],
  ['🎯 백발백중', `<p><b>백발백중</b> — 꼬꼬댁과 깃털탄으로 계단 위 과녁을 맞히는 모드예요. 5턴 동안 과녁 하나당 200점! 최고 점수로 백발백중 랭킹이 매겨져요.</p>
    <ul><li>맵에서 <b>백발백중</b>을 고르면 탱크는 꼬꼬댁, 무기는 깃털탄으로 정해지고 아이템은 쓸 수 없어요</li>
    <li>모두 맨 왼쪽 층에서 시작해요. 땅은 파이지 않고, 서로 맞아도 피해가 없어요</li>
    <li>바람 세기는 보통으로 정해져 있고 방향만 턴마다 바뀌어요</li>
    <li>AI 대전에서는 혼자, 온라인에서는 여럿이 같은 과녁(인원 × 5개)을 두고 겨뤄요 (먼저 맞힌 사람이 점수를 가져가요)</li>
    <li>로그인하면 최고 점수가 <b>백발백중 랭킹</b>에 올라가고, 이 맵에서는 백발백중 등급(해·달·별·구름)이 닉네임 앞에 붙어요</li></ul>`],
  ['🛒 아이템', `<p>게임 전에 상점에서 3칸까지 살 수 있어요 (AI 대전은 1,000포인트, 온라인은 내 포인트로).</p>
    <ul><li>더블샷: 같은 각도·파워로 두 번 발사 · 파워업: 이번 발사 피해 +30%</li><li>수리킷: 누르면 바로 체력 20% 회복 · 순간이동: 포탄이 떨어진 곳으로 이동</li></ul>`],
  ['🐣 게임 모드', `<ul><li><b>일반</b>: 보통 게임</li>
    <li><b>초보</b>: 사람이 쏜 포탄이 꼭대기를 지나면 가까운 적 쪽으로 휘어요 (AI는 도움 없음)</li>
    <li>AI 대전은 설정 화면에서, 온라인은 게임방에서 방장이 골라요</li></ul>`],
  ['🌐 온라인 대전', `<ul><li><b>대기실 입장</b>(최대 30명) → 게임방을 만들거나 들어가요 (최대 4명, 팀전 가능)</li>
    <li>모두 <b>레디</b>하면 방장이 시작해요. 맵·게임 모드·속도·바람은 방장이 정해요</li>
    <li>2:1이면 사람이 적은 팀에 <b>AI(초보 또는 보통)</b>가 한 명 들어와요</li>
    <li>방장은 대기 중에 다른 사람을 <b>강퇴</b>할 수 있어요 (게임 중에는 안 돼요)</li>
    <li>대기실 링크를 친구에게 보내면 같은 대기실로 들어와요. 게임 중에도 Enter(또는 💬)로 채팅할 수 있어요</li></ul>`],
  ['🏆 포인트 · 랭킹', `<p>처음엔 1,000포인트예요. 온라인 대전에서 이기면 <b>+100</b>, 지면 <b>-100</b>이고 1,000 아래로는 내려가지 않아요.</p>
    <p>포인트 순위에 따라 닉네임 앞에 <b>해</b>(상위 10%) · <b>달</b>(30%) · <b>별</b>(60%) · <b>구름</b>(그 외)이 붙어요. 대기실의 🏆 랭킹 버튼으로 순위를 볼 수 있어요.</p>`],
];

function manualHtml() {
  return `<div class="manual"><h3>📖 사용 설명서</h3>${MANUAL.map(([t, b]) => `<details><summary>${t}</summary><div class="mbody">${b}</div></details>`).join('')}</div>`;
}

// ---------- 2. AI 1:1 설정 + 상점 ----------

function stat(label: string, v: number, max: number, text: string) {
  return `<div class="stat"><span>${label}</span><i><b style="width:${Math.min(100, (v / max) * 100)}%"></b></i><em>${text}</em></div>`;
}

export function showSetup() {
  const root = screen(
    `<header class="bar">
      <button class="btn ghost" id="back">← 처음으로</button>
      <h2>AI 1:1 설정</h2>
      <div class="me">${escapeHtml(state.name)}</div>
    </header>
    <div class="setup-grid">
      <section class="card tanks-card">
        <h3>탱크 선택</h3>
        <div class="tank-list" id="tanks"></div>
      </section>
      <section class="card opp-card">
        <h3>상대</h3>
        <div class="seg" id="opp"></div>
        <div class="row" id="opp-tank-row"><span class="lbl">상대 탱크</span><div class="seg small" id="opp-tank"></div></div>
        <div class="row" id="name2-row"><span class="lbl">2P 이름</span><input id="name2" maxlength="10" value="${escapeHtml(state.name2)}"/></div>
        <h3>맵</h3>
        <div class="maps" id="maps"></div>
        <div class="opt-row"><span class="lbl">게임 모드</span><div class="seg small" id="mode"></div></div>
        <div class="opt-row"><span class="lbl">게임 속도</span><div class="seg small" id="speed"></div></div>
        <div class="opt-row"><span class="lbl">바람 변화</span><div class="seg small" id="wind"></div></div>
      </section>
      <section class="card shop-card">
        <h3>아이템 상점 <small>매 판 1,000 포인트 · 3칸</small></h3>
        <div class="seg small" id="shop-tabs"></div>
        <div id="shop"></div>
      </section>
    </div>
    <footer class="start-bar"><button class="btn big primary" id="start">게임 시작 ▶</button></footer>`,
    'setup',
  );

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;

  const renderTanks = () => {
    const rnd = state.tank === 'random';
    const d = TANKS[rnd ? 'zodiac' : (state.tank as TankId)];
    $('#tanks').innerHTML = `<div class="zodiac-pick">${TANK_IDS.map(
      (id) => `<button data-id="${id}" class="${state.tank === id ? 'sel' : ''}" title="${TANKS[id].name} (${TANKS[id].animal}) · ${TANKS[id].role}">${tankSvg(id, 46)}<span>${TANKS[id].name}</span></button>`,
    ).join('')}<button data-id="random" class="rand ${rnd ? 'sel' : ''}" title="게임 시작 때 정해져요 · 20% 확률로 십이지신 '열두빛'"><span class="dice">🎲</span><span>랜덤</span></button></div>
      ${rnd ? `<div class="tank-card sel"><div class="pic">${tankSvg('random', 92)}</div><div class="info"><div class="tn">랜덤 <small>게임을 시작할 때 정해져요</small></div><p>12지신 중 하나가 무작위로 나오고, <b>20% 확률</b>로 전설의 <b>십이지신 '열두빛'</b>(다른 탱크보다 20% 강함)이 나와요.</p></div></div>` : ''}
      <div class="tank-card sel" style="${rnd ? 'display:none' : ''}">
        <div class="pic">${tankSvg(state.tank, 92)}</div>
        <div class="info">
          <div class="tn">${d.name} <small>${d.animal} · ${d.role}</small></div>
          ${stat('체력', d.hp, 1000, `${d.hp}`)}
          ${stat('방어', d.defense, 0.25, `${Math.round(d.defense * 100)}%`)}
          ${stat('이동', d.move, 160, `${d.move}`)}
          ${stat('빠르기', 800 - d.delay, 300, `딜레이 ${d.delay}`)}
          <div class="angle">발사각 ${d.angleMin}–${d.angleMax}°</div>
          <ol class="wl">${d.weapons.map((w, i) => `<li class="${i === 2 ? 'ult' : ''}"><b>${i === 2 ? '필살' : i + 1}</b> ${WEAPONS[w].name} <small>${WEAPONS[w].desc}</small></li>`).join('')}</ol>
        </div>
      </div>`;
    root.querySelectorAll<HTMLElement>('.zodiac-pick button').forEach((b) =>
      b.addEventListener('click', () => {
        state.tank = b.dataset.id as TankChoice;
        save({ tank: state.tank });
        sfx.click();
        renderTanks();
      }),
    );
  };

  const renderOpp = () => {
    const opts: [Opponent, string][] = [
      ['easy', 'AI 쉬움'],
      ['normal', 'AI 보통'],
      ['hard', 'AI 어려움'],
      ['local', '한 기기 2인'],
    ];
    $('#opp').innerHTML = opts.map(([v, l]) => `<button data-v="${v}" class="${state.opponent === v ? 'sel' : ''}">${l}</button>`).join('');
    $('#opp').querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.opponent = b.dataset.v as Opponent;
        save({ opponent: state.opponent });
        if (state.opponent !== 'local') state.shopFor = 0;
        sfx.click();
        renderOpp();
        renderShop();
      }),
    );
    $('#name2-row').style.display = state.opponent === 'local' ? '' : 'none';
    const ot: (TankId | 'random')[] = ['random', ...TANK_IDS];
    $('#opp-tank').innerHTML = ot.map((v) => `<button data-v="${v}" class="${state.oppTank === v ? 'sel' : ''}">${v === 'random' ? '랜덤' : TANKS[v].name}</button>`).join('');
    $('#opp-tank').querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.oppTank = b.dataset.v as TankId | 'random';
        sfx.click();
        renderOpp();
      }),
    );
  };
  $<HTMLInputElement>('#name2').addEventListener('input', (e) => (state.name2 = (e.target as HTMLInputElement).value));

  const renderOpts = () => {
    $('#mode').innerHTML = (['easy', 'normal'] as const)
      .map((v) => `<button data-v="${v}" class="${state.mode === v ? 'sel' : ''}" title="${v === 'easy' ? '내가 쏜 탄이 적 쪽으로 휘어요 (AI 제외)' : ''}">${v === 'easy' ? '초보' : '일반'}</button>`)
      .join('');
    root.querySelectorAll<HTMLElement>('#mode button').forEach((b) =>
      b.addEventListener('click', () => {
        state.mode = b.dataset.v as 'easy' | 'normal';
        sfx.click();
        renderOpts();
      }),
    );
    $('#speed').innerHTML = [1, 1.5].map((v) => `<button data-v="${v}" class="${state.speed === v ? 'sel' : ''}">${v === 1 ? '보통 (1배)' : '빠르게 (1.5배)'}</button>`).join('');
    const winds = [['slow', '느리게 ±2'], ['normal', '보통 ±5'], ['fast', '빠르게 ±8']] as const;
    $('#wind').innerHTML = winds.map(([v, l]) => `<button data-v="${v}" class="${state.wind === v ? 'sel' : ''}">${l}</button>`).join('');
    root.querySelectorAll<HTMLElement>('#speed button').forEach((b) =>
      b.addEventListener('click', () => {
        state.speed = Number(b.dataset.v);
        sfx.click();
        renderOpts();
      }),
    );
    root.querySelectorAll<HTMLElement>('#wind button').forEach((b) =>
      b.addEventListener('click', () => {
        state.wind = b.dataset.v as typeof state.wind;
        sfx.click();
        renderOpts();
      }),
    );
  };

  const renderMaps = () => {
    const opts: (MapId | 'random')[] = [...MAP_IDS, 'random'];
    $('#maps').innerHTML = opts
      .map((id) => {
        const m = id === 'random' ? null : MAPS[id];
        const bg = m ? `linear-gradient(${m.theme.skyTop}, ${m.theme.skyBottom} 60%, ${m.theme.grass} 60%, ${m.theme.dirtBottom})` : 'linear-gradient(135deg,#8ec5ff,#ffd38a)';
        return `<button class="map ${state.map === id ? 'sel' : ''}" data-id="${id}" style="--bg:${bg}">
          <span class="mn">${m ? m.name : '랜덤'}</span><small>${m ? m.desc : '셋 중 하나를 무작위로'}${m?.practice ? '<br><b>🐔 꼬꼬댁 · 깃털탄만 · 혼자 과녁 맞히기</b>' : m?.lockTank ? '<br><b>🐶 모두 멍뭉이 · 2번 땅파기탄만</b>' : ''}</small></button>`;
      })
      .join('');
    root.querySelectorAll<HTMLElement>('.map').forEach((b) =>
      b.addEventListener('click', () => {
        state.map = b.dataset.id as MapId | 'random';
        save({ map: state.map });
        sfx.click();
        renderMaps();
      }),
    );
  };

  const renderShop = () => {
    const local = state.opponent === 'local';
    $('#shop-tabs').style.display = local ? '' : 'none';
    $('#shop-tabs').innerHTML = [state.name, state.name2 || '2P']
      .map((n, i) => `<button data-i="${i}" class="${state.shopFor === i ? 'sel' : ''}">${escapeHtml(n)}</button>`)
      .join('');
    $('#shop-tabs').querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.shopFor = Number(b.dataset.i);
        renderShop();
      }),
    );
    shopWidget($('#shop'), state.shop[state.shopFor], renderShop, false, 1000); // AI 대전 상점 예산은 항상 1,000
  };

  renderTanks();
  renderOpp();
  renderMaps();
  renderOpts();
  renderShop();
  // 닉네임 앞 랭킹 구름을 위해 랭킹만 불러온다 (AI 대전 포인트는 1,000 고정)
  if (onlineConfigured() && state.name)
    void getBackend()
      .then((b) => Promise.all([b?.getRanking().then(setRanking), b?.getTargetRanking().then(setTargetRanking)]))
      .catch(() => undefined);
  $('#back').addEventListener('click', showEntry);
  $('#start').addEventListener('click', () => {
    if (state.opponent === 'local') {
      const n2 = state.name2.trim();
      if (n2.length < 2 || n2 === state.name) {
        toast('2P 이름은 2~10자로, 1P와 다르게 정해주세요');
        return;
      }
      state.name2 = n2;
    }
    startGame();
  });
}

// ---------- 3. 게임 ----------

function startGame() {
  sfx.click();
  const seed = randomSeed();
  const rng = new Rng(seed ^ 0xabcdef);
  const mapId: MapId = state.map === 'random' ? rng.pick(RANDOM_MAP_IDS) : state.map;
  const oppTank: TankId = state.oppTank === 'random' ? randomTank(() => rng.next()) : state.oppTank;
  const local = state.opponent === 'local';
  const diff = local ? null : (state.opponent as Difficulty);
  const setups: PlayerSetup[] = [
    { name: state.name, tank: state.tank === 'random' ? randomTank(Math.random, state.name.trim()) : state.tank, team: 0, ai: null, items: [...state.shop[0]] },
    {
      name: local ? state.name2 : `AI(${{ easy: '쉬움', normal: '보통', hard: '어려움' }[diff!]})`,
      tank: oppTank,
      team: 1,
      ai: diff,
      items: local ? [...state.shop[1]] : aiItems(diff!, rng),
    },
  ];
  // 백발백중: AI 상대 없이 혼자 (2P는 둘이서)
  if (MAPS[mapId].practice && !local) setups.pop();
  // 판이 끝나면 포인트·아이템 초기화
  state.shop = [[], []];

  launchGame({
    setups,
    mapId,
    seed,
    speed: state.speed,
    wind: state.wind,
    mode: state.mode,
    // 닉네임 '시아'는 AI 대전에서 필살기 게이지가 늘 가득
    fullUlt: setups.flatMap((s, i) => (!s.ai && s.name.trim() === '시아' ? [i] : [])),
    onEnd: (s: MatchSummary) => {
      closeGame();
      showResult(s);
      if (s.practice) void recordTarget(s);
    },
    onQuit: () => {
      closeGame();
      showSetup();
    },
  });
}

// ---------- 4. 결과 ----------

/** 백발백중 점수를 내 기록에 올린다 (로그인했을 때만) */
export async function recordTarget(s: MatchSummary) {
  const me = s.players.find((p) => p.mine);
  if (!me || !state.token || !onlineConfigured()) return;
  try {
    const b = await getBackend();
    if (!b) return;
    const best = await b.submitTargetScore(state.name, state.token, me.damage);
    setTargetRanking(await b.getTargetRanking());
    toast(`🎯 ${me.damage}점 · 내 최고 ${best}점`);
  } catch {
    /* 기록을 못 올려도 결과는 보여 준다 */
  }
}

function showTargetResult(s: MatchSummary, act: ResultActions) {
  const players = [...s.players].sort((a, b) => b.damage - a.damage);
  const top = players[0];
  const root = screen(
    `<div class="result-card">
      <div class="trophy">🎯</div>
      <h2>${players.length > 1 ? `${escapeHtml(top.name)} 1등!` : `${top.damage.toLocaleString()}점!`}</h2>
      <p class="sub">백발백중 · 과녁 하나 200점 (최대 1,000점)</p>
      <table class="score">
        <thead><tr><th>순위</th><th>플레이어</th><th>맞힌 과녁</th><th>점수</th></tr></thead>
        <tbody>${players
          .map((p, i) => `<tr class="${i === 0 ? 'win' : ''}"><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.damage / 200}개</td><td><b>${p.damage.toLocaleString()}</b></td></tr>`)
          .join('')}</tbody>
      </table>
      <div class="actions">
        <button class="btn big primary" id="again">${act.primary}</button>
        ${act.secondary ? `<button class="btn" id="home">${act.secondary}</button>` : ''}
      </div>
      <p class="hint">${state.token ? '최고 점수가 백발백중 랭킹에 올라가요' : '로그인하면 최고 점수가 백발백중 랭킹에 올라가요'}</p>
    </div>`,
    'result',
  );
  root.querySelector('#again')!.addEventListener('click', act.onPrimary);
  if (act.onSecondary) root.querySelector('#home')?.addEventListener('click', act.onSecondary);
}

export interface ResultActions {
  primary: string;
  onPrimary: () => void;
  /** 없으면 버튼 하나만 */
  secondary?: string;
  onSecondary?: () => void;
}

export function showResult(s: MatchSummary, actions?: ResultActions) {
  const act: ResultActions = actions ?? { primary: '다시 하기', onPrimary: showSetup, secondary: '처음으로', onSecondary: showEntry };
  if (s.practice) return showTargetResult(s, act);
  const winText = s.winner === -1 ? '무승부!' : `${TEAM_NAMES[s.winner]} 승리!`;
  const meWon = s.players.some((p) => p.team === s.winner && p.mine);
  const vsAi = true;
  const players = [...s.players].sort((a, b) => b.damage - a.damage);
  const root = screen(
    `<div class="result-card">
      <div class="trophy">${s.winner === -1 ? '🤝' : vsAi ? (meWon ? '🏆' : '💥') : '🏆'}</div>
      <h2 style="color:${s.winner === -1 ? '#fff' : TEAM_COLORS[s.winner]}">${winText}</h2>
      <p class="sub">${vsAi ? (meWon ? '멋진 포격이었어요!' : '아깝다! 바람을 다시 계산해볼까요?') : ''} · ${s.turns}턴</p>
      <table class="score">
        <thead><tr><th>플레이어</th><th>팀</th><th>탱크</th><th>가한 피해</th></tr></thead>
        <tbody>${players
          .map(
            (p) => `<tr class="${p.team === s.winner ? 'win' : ''}"><td>${escapeHtml(p.name)}${p.alive ? '' : ' <small>💀</small>'}</td>
          <td><span class="team-dot" style="--c:${TEAM_COLORS[p.team]}"></span>${TEAM_NAMES[p.team]}</td>
          <td>${TANKS[p.tank as TankId].name}</td><td><b>${p.damage.toLocaleString()}</b></td></tr>`,
          )
          .join('')}</tbody>
      </table>
      <div class="actions">
        <button class="btn big primary" id="again">${act.primary}</button>
        ${act.secondary ? `<button class="btn" id="home">${act.secondary}</button>` : ''}
      </div>
      <p class="hint">다음 판에는 포인트 1,000이 새로 지급돼요</p>
    </div>`,
    'result',
  );
  root.querySelector('#again')!.addEventListener('click', act.onPrimary);
  if (act.onSecondary) root.querySelector('#home')?.addEventListener('click', act.onSecondary);
}


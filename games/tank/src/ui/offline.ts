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
import { clientId, getBackend } from '../net';
import { worldHome } from '../net/world';
import { showManualModal } from './manual';
import { setRanking, setTargetRanking, showRankingModal } from './rank';
import { friendly } from '../net/backend';

// ---------- 1. 처음 화면 ----------
// 로그인하면 바로 대기실로 간다. 이 화면은 대기실에 못 들어갔을 때(서버 문제 등) 보인다.

export function showEntry() {
  const root = screen(
    `<div class="entry-card">
      <div class="logo">
        <div class="logo-tanks">${tankSvg('tiger', 84)}${tankSvg('rabbit', 84, true)}</div>
        <h1>시아탱크</h1>
        <p class="tagline">각도 · 파워 · 바람! 링크 하나로 한 판</p>
      </div>
      <p class="who"><b>${escapeHtml(state.name)}</b>님 환영해요!</p>
      <button class="btn big primary" id="lobby">대기실 입장</button>
      <button class="btn big" id="ai">AI와 1:1</button>
      <button class="btn" id="ranking">🏆 랭킹 보기</button>
      <button class="btn" id="manual">📖 게임 설명</button>
      <a class="btn" id="world" href="${worldHome()}">🌏 SIA WORLD로</a>
    </div>`,
    'entry',
  );
  root.querySelector('#ranking')!.addEventListener('click', async () => {
    sfx.click();
    try {
      const b = await getBackend();
      if (!b) throw new Error('no backend');
      const [pts, tg] = await Promise.all([b.getRanking(), b.getTargetRanking()]);
      setRanking(pts);
      setTargetRanking(tg);
      showRankingModal(clientId());
    } catch (e) {
      toast(friendly(e));
    }
  });
  root.querySelector('#manual')!.addEventListener('click', () => (sfx.click(), showManualModal()));
  root.querySelector('#ai')!.addEventListener('click', () => (sfx.click(), showSetup()));
  root.querySelector('#lobby')!.addEventListener('click', () => (sfx.click(), nav.lobby()));
}

// ---------- 2. AI 1:1 설정 + 상점 ----------

function stat(label: string, v: number, max: number, text: string) {
  return `<div class="stat"><span>${label}</span><i><b style="width:${Math.min(100, (v / max) * 100)}%"></b></i><em>${text}</em></div>`;
}

export function showSetup() {
  const root = screen(
    `<header class="bar">
      <button class="btn ghost" id="back">← 대기실로</button>
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
  void getBackend()
      .then((b) => Promise.all([b?.getRanking().then(setRanking), b?.getTargetRanking().then(setTargetRanking)]))
      .catch(() => undefined);
  $('#back').addEventListener('click', () => nav.lobby());
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

/** 백발백중 점수를 내 기록에 올린다 */
export async function recordTarget(s: MatchSummary) {
  const me = s.players.find((p) => p.mine);
  if (!me) return;
  try {
    const b = await getBackend();
    if (!b) return;
    const best = await b.submitTargetScore(me.damage);
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
      <p class="sub">백발백중 · 1층 200점 · 한 층 오를 때마다 +50점</p>
      <table class="score">
        <thead><tr><th>순위</th><th>플레이어</th><th>맞힌 과녁</th><th>점수</th></tr></thead>
        <tbody>${players
          .map((p, i) => `<tr class="${i === 0 ? 'win' : ''}"><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.hits ?? 0}개</td><td><b>${p.damage.toLocaleString()}</b></td></tr>`)
          .join('')}</tbody>
      </table>
      <div class="actions ${act.secondary ? '' : 'one'}">
        <button class="btn big primary" id="again">${act.primary}</button>
        ${act.secondary ? `<button class="btn" id="home">${act.secondary}</button>` : ''}
      </div>
      <p class="hint">최고 점수가 백발백중 랭킹에 올라가요</p>
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
  const act: ResultActions = actions ?? { primary: '다시 하기', onPrimary: showSetup, secondary: '대기실로', onSecondary: () => nav.lobby() };
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
      <div class="actions ${act.secondary ? '' : 'one'}">
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


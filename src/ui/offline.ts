import { TANKS, TANK_IDS, WEAPONS, type TankId } from '../game/data';
import { MAPS, MAP_IDS, type MapId } from '../data/maps';
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
import { onlineConfigured } from '../net';

// ---------- 1. 입장 ----------

export function showEntry() {
  const root = screen(
    `<div class="entry-card">
      <div class="logo">
        <div class="logo-tanks">${tankSvg('tiger', 84)}${tankSvg('rabbit', 84, true)}</div>
        <h1>시아탱크</h1>
        <p class="tagline">각도 · 파워 · 바람! 링크 하나로 한 판</p>
      </div>
      <label class="field">
        <span>내 ID</span>
        <input id="name" maxlength="10" autocomplete="off" placeholder="2~10자" value="${escapeHtml(state.name)}" />
      </label>
      <p class="hint" id="name-hint"></p>
      <button class="btn big primary" id="lobby">대기실 입장</button>
      <button class="btn big" id="ai">AI와 1:1</button>
      <p class="foot">PC: ← → 이동 · ↑ ↓ 각도 · 스페이스 길게 눌러 발사 · 1 2 3 무기 · Q W E 아이템</p>
    </div>`,
    'entry',
  );
  const input = root.querySelector<HTMLInputElement>('#name')!;
  const hint = root.querySelector<HTMLElement>('#name-hint')!;
  const valid = () => {
    const v = input.value.trim();
    return v.length >= 2 && v.length <= 10;
  };
  const go = () => {
    if (!valid()) {
      hint.textContent = 'ID는 2~10자로 정해주세요';
      input.focus();
      return false;
    }
    state.name = input.value.trim();
    save({ name: state.name });
    return true;
  };
  input.addEventListener('input', () => (hint.textContent = ''));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && go()) (onlineConfigured() ? nav.lobby() : showSetup());
  });
  root.querySelector('#ai')!.addEventListener('click', () => {
    sfx.click();
    if (go()) showSetup();
  });
  root.querySelector('#lobby')!.addEventListener('click', () => {
    sfx.click();
    if (!onlineConfigured()) return toast('온라인 서버가 아직 설정되지 않았어요. AI 1:1을 즐겨주세요!');
    if (go()) nav.lobby();
  });
  if (!state.name) input.focus();
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
    const d = TANKS[state.tank];
    $('#tanks').innerHTML = `<div class="zodiac-pick">${TANK_IDS.map(
      (id) => `<button data-id="${id}" class="${state.tank === id ? 'sel' : ''}" title="${TANKS[id].name} (${TANKS[id].animal}) · ${TANKS[id].role}">${tankSvg(id, 46)}<span>${TANKS[id].name}</span></button>`,
    ).join('')}</div>
      <div class="tank-card sel">
        <div class="pic">${tankSvg(state.tank, 92)}</div>
        <div class="info">
          <div class="tn">${d.name} <small>${d.animal} · ${d.role}</small></div>
          ${stat('체력', d.hp, 1300, `${d.hp}`)}
          ${stat('방어', d.defense, 0.25, `${Math.round(d.defense * 100)}%`)}
          ${stat('이동', d.move, 160, `${d.move}`)}
          ${stat('빠르기', 800 - d.delay, 300, `딜레이 ${d.delay}`)}
          <div class="angle">발사각 ${d.angleMin}–${d.angleMax}°</div>
          <ol class="wl">${d.weapons.map((w, i) => `<li class="${i === 2 ? 'ult' : ''}"><b>${i === 2 ? '필살' : i + 1}</b> ${WEAPONS[w].name} <small>${WEAPONS[w].desc}</small></li>`).join('')}</ol>
        </div>
      </div>`;
    root.querySelectorAll<HTMLElement>('.zodiac-pick button').forEach((b) =>
      b.addEventListener('click', () => {
        state.tank = b.dataset.id as TankId;
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

  const renderMaps = () => {
    const opts: (MapId | 'random')[] = [...MAP_IDS, 'random'];
    $('#maps').innerHTML = opts
      .map((id) => {
        const m = id === 'random' ? null : MAPS[id];
        const bg = m ? `linear-gradient(${m.theme.skyTop}, ${m.theme.skyBottom} 60%, ${m.theme.grass} 60%, ${m.theme.dirtBottom})` : 'linear-gradient(135deg,#8ec5ff,#ffd38a)';
        return `<button class="map ${state.map === id ? 'sel' : ''}" data-id="${id}" style="--bg:${bg}">
          <span class="mn">${m ? m.name : '랜덤'}</span><small>${m ? m.desc : '셋 중 하나를 무작위로'}</small></button>`;
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
    shopWidget($('#shop'), state.shop[state.shopFor], renderShop);
  };

  renderTanks();
  renderOpp();
  renderMaps();
  renderShop();
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
  const mapId: MapId = state.map === 'random' ? rng.pick(MAP_IDS) : state.map;
  const oppTank: TankId = state.oppTank === 'random' ? rng.pick(TANK_IDS) : state.oppTank;
  const local = state.opponent === 'local';
  const diff = local ? null : (state.opponent as Difficulty);
  const setups: PlayerSetup[] = [
    { name: state.name, tank: state.tank, team: 0, ai: null, items: [...state.shop[0]] },
    {
      name: local ? state.name2 : `AI(${{ easy: '쉬움', normal: '보통', hard: '어려움' }[diff!]})`,
      tank: oppTank,
      team: 1,
      ai: diff,
      items: local ? [...state.shop[1]] : aiItems(diff!, rng),
    },
  ];
  // 판이 끝나면 포인트·아이템 초기화
  state.shop = [[], []];

  launchGame({
    setups,
    mapId,
    seed,
    onEnd: (s: MatchSummary) => {
      closeGame();
      showResult(s);
    },
    onQuit: () => {
      closeGame();
      showSetup();
    },
  });
}

// ---------- 4. 결과 ----------

export interface ResultActions {
  primary: string;
  onPrimary: () => void;
  secondary: string;
  onSecondary: () => void;
}

export function showResult(s: MatchSummary, actions?: ResultActions) {
  const act: ResultActions = actions ?? { primary: '다시 하기', onPrimary: showSetup, secondary: '처음으로', onSecondary: showEntry };
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
        <button class="btn" id="home">${act.secondary}</button>
      </div>
      <p class="hint">다음 판에는 포인트 1,000이 새로 지급돼요</p>
    </div>`,
    'result',
  );
  root.querySelector('#again')!.addEventListener('click', act.onPrimary);
  root.querySelector('#home')!.addEventListener('click', act.onSecondary);
}


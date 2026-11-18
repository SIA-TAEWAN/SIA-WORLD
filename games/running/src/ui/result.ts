import { formatTime, tierOf, type RankedEntry } from '../game/ranking';
import { LOCAL_MODE } from '../net/api';
import { loadRankIcons } from '../net/world';
import type { RaceGame } from '../race/game';
import { zodiacFaceUrl } from '../assets';
import { esc, leaveRoom, nav, screen, state } from './app';
import { showRanking } from './menus';
import { sfx } from './sfx';

/** 결과 화면: 1~4등, 기록, 개인 최고 기록 갱신 여부, '한 판 더' · '나가기' */
export function showResult(race: RaceGame, results: RankedEntry[]) {
  const me = race.mySlot;
  const mine = results.find((r) => r.slot === me);
  const raced = mine && !race.taken[me];
  const root = screen(
    `<div class="result-card">
      <h2>🏁 경기 결과</h2>
      <p class="mine" id="mine">${
        !mine
          ? ''
          : !raced
            ? '<span class="soft">연결이 끊겨 AI가 이어 달렸어요</span>'
            : mine.status === 'finish'
              ? `내 기록 <b>${formatTime(mine.timeMs!)}</b>초 <span id="rec"></span>`
              : mine.status === 'foul'
                ? '실격! GO가 뜬 뒤에 눌러요'
                : `미완주 (${Math.floor(mine.x)}m)`
      }</p>
      <div class="rows">${results
        .map((r, i) => {
          const p = race.roster[r.slot];
          const isMe = r.slot === me;
          const tm =
            r.status === 'finish'
              ? `<span class="tm">${formatTime(r.timeMs!)}초</span><span class="tier" data-ms="${r.timeMs}"></span>`
              : r.status === 'foul'
                ? '<span class="tm foul">실격</span>'
                : `<span class="tm dnf">미완주 ${Math.floor(r.x)}m</span>`;
          const sub = p.id && race.taken[r.slot] ? '<small>AI가 이어 달림</small>' : '';
          return `<div class="rrow p${r.place} ${isMe ? 'me' : ''}" style="animation-delay:${200 + i * 260}ms"><span class="pl">${r.place}</span>
            <img class="av" src="${zodiacFaceUrl(p.char)}" alt="" /><span class="nm">${esc(p.name)}${sub}</span>${tm}</div>`;
        })
        .join('')}</div>
      <div class="actions"><button class="btn" id="exit">나가기</button><button class="btn primary" id="again">한 판 더 ▶</button></div>
      <div class="sub"><button class="btn small" id="rank">🏆 랭킹</button></div>
    </div><div class="cheer" id="cheer"></div>`,
    'result',
    'result',
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;

  // 순위 발표 소리 (한 줄씩)
  results.forEach((_, i) => sfx('rankShow', { delay: 200 + i * 260, rate: 1.3 - i * 0.1 }));

  // 등급 아이콘 (해·달·별·구름)
  void loadRankIcons().then(
    (m) => root.querySelectorAll<HTMLElement>('.tier').forEach((el) => (el.innerHTML = m.tierSvg(tierOf(Number(el.dataset.ms)), 26))),
    () => undefined,
  );

  // 개인 최고 기록 갱신 여부 (서버에 올린 결과)
  if (raced && mine.status === 'finish' && race.record) {
    void race.record.then((rec) => {
      state.best = rec.bestMs;
      const el = root.querySelector('#rec');
      if (!el) return;
      if (rec.improved) {
        el.innerHTML = '<span class="newrec">🎉 개인 최고 기록!</span>';
        sfx('newRecord', { delay: 900 });
        confetti($('#cheer'));
      } else el.innerHTML = `<span class="soft">최고 ${formatTime(rec.bestMs)}초</span>`;
      if (!rec.saved && !LOCAL_MODE) el.insertAdjacentHTML('beforeend', '<br/><span class="soft">서버에 기록을 올리지 못했어요</span>');
    });
  }

  $('#again').addEventListener('click', () => {
    sfx('click');
    if (state.room) nav.waiting();
    else nav.lobby();
  });
  $('#exit').addEventListener('click', () => {
    sfx('click');
    leaveRoom();
    nav.lobby();
  });
  $('#rank').addEventListener('click', () => void showRanking());
}

/** 색종이 (DESIGN.md: 승리 = 별·색종이) */
function confetti(box: HTMLElement) {
  const cols = ['var(--primary)', 'var(--pink)', 'var(--team-a)', 'var(--win)', 'var(--white)'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('i');
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = cols[i % cols.length];
    el.style.animationDelay = `${0.9 + Math.random() * 0.8}s`;
    el.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    box.append(el);
  }
}

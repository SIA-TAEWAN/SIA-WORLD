import type { MatchResult } from '../match/game';
import { zodiacFaceUrl } from '../assets';
import { esc, nav, screen } from './app';
import { aiSetup } from './menus';
import { sfx } from './sfx';

/** 결과 화면: 승/패, 점수, [다시하기] · [로비로]. AI전은 '연습 경기'로 표시 */
export function showResult(result: MatchResult) {
  const { setup, score, winner } = result;
  const me = setup.mySide;
  const won = winner === me;
  const row = (s: 0 | 1) => {
    const f = setup.fighters[s];
    return `<div class="vs-side s${s} ${s === winner ? 'win' : ''}"><img class="av" src="${zodiacFaceUrl(f.char)}" alt="" />
      <span class="nm">${esc(f.name)}</span><span class="wl">${s === winner ? '승' : '패'}</span></div>`;
  };
  const root = screen(
    `<div class="result-card ${won ? 'won' : 'lost'}">
      <h2>🏐 경기 결과</h2>
      ${setup.mode === 'ai' ? '<p class="kind"><span class="tag">연습 경기</span></p>' : ''}
      <p class="verdict">${won ? '승리!' : '패배…'}</p>
      <div class="vs">${row(0)}<div class="vs-score"><b>${score[0]}</b><i>:</i><b>${score[1]}</b></div>${row(1)}</div>
      ${setup.mode === 'ai' ? '<p class="soft note">연습 경기는 랭킹·전적에 기록되지 않아요</p>' : ''}
      <div class="actions"><button class="btn" id="exit">로비로</button><button class="btn primary" id="again">다시하기 ▶</button></div>
    </div><div class="cheer" id="cheer"></div>`,
    'result',
    'result',
  );
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  sfx(won ? 'win' : 'lose', { delay: 150 });
  if (won) confetti($('#cheer'));

  $('#again').addEventListener('click', () => {
    sfx('click');
    // AI 대전: 같은 캐릭터로 바로 다시 (상대는 새로 뽑는다). 3단계: 두 사람 모두 누르면 같은 방에서 재경기
    nav.match(aiSetup(setup.fighters[me].char));
  });
  $('#exit').addEventListener('click', () => {
    sfx('click');
    nav.lobby();
  });
}

/** 색종이 (DESIGN.md: 승리 = 별·색종이) */
function confetti(box: HTMLElement) {
  const cols = ['var(--primary)', 'var(--pink)', 'var(--team-a)', 'var(--win)', 'var(--white)'];
  for (let i = 0; i < 36; i++) {
    const el = document.createElement('i');
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = cols[i % cols.length];
    el.style.animationDelay = `${0.2 + Math.random() * 0.8}s`;
    el.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    box.append(el);
  }
}

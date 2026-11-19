import { STAR2_LIVES } from '../data/balance';
import { regionOf } from '../data/regions';
import { nextStage, stageOf } from '../data/stages';
import { stageOpen } from '../game/progress';
import { zodiacFullUrl } from '../assets';
import { esc, josa, nav, screen, state, type GameResult } from './app';
import { sfx } from './sfx';

/** 결과 화면: 별 1~3개 · 얻은 엽전 · 첫 클리어 보상 → [다음 스테이지] [다시하기] [메인으로] (PRD 2장) */
export function showResult(r: GameResult) {
  const st = stageOf(r.stage)!;
  const title = r.cleared ? '클리어!' : r.quit ? '포기했어요' : '실패…';
  const next = nextStage(st);
  const lost = r.startLives - r.lives;
  // 별 조건 세 줄: 이번 판에 채운 것에 표시
  const goal = (ok: boolean, text: string) => `<li class="${ok ? 'ok' : ''}"><i>★</i>${text}</li>`;
  const root = screen(
    `<div class="result-card ${r.cleared ? 'won' : 'lost'}">
       <h2>${esc(st.id)} ${esc(st.name)}</h2>
       <div class="verdict">${title}</div>
       <div class="big-stars" aria-label="별 ${r.stars}개">${[1, 2, 3].map((i) => `<i class="${i <= r.stars ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</i>`).join('')}</div>
       <img class="result-char" src="${zodiacFullUrl(r.setup.squad[0] ?? 'rat')}" alt="" />
       <ul class="goals">
         ${goal(r.stars >= 1, '클리어')}
         ${goal(r.stars >= 2, `생명 ${STAR2_LIVES} 이상 남기기`)}
         ${goal(r.stars >= 3, '생명을 하나도 잃지 않기')}
       </ul>
       <ul class="stats">
         <li><span>❤️ 남은 생명</span><b>${r.lives}<small> / ${r.startLives}${lost > 0 ? ` (−${lost})` : ''}</small></b></li>
         <li><span>💀 처치한 요괴</span><b>${r.kills.toLocaleString()}</b></li>
         <li><span>🪙 얻은 엽전</span><b class="coin" id="coins">…</b></li>
       </ul>
       <div class="unlocks" id="unlocks"></div>
       <p class="soft note" id="note">결과를 저장하는 중…</p>
     </div>
     <div class="actions">
       <button class="btn" id="home">메인으로</button>
       <button class="btn" id="again">다시하기</button>
     </div>
     <button class="btn primary big" id="next">다음 스테이지 ▶</button>
     ${r.cleared ? '<div class="cheer" id="cheer"></div>' : ''}`,
    'result',
  );
  if (r.cleared) {
    // 색종이 (DESIGN.md 8장: 승리 = 별·색종이)
    const cheer = root.querySelector('#cheer')!;
    const colors = ['var(--primary)', 'var(--pink)', 'var(--team-a)', 'var(--win)', 'var(--white)'];
    for (let i = 0; i < 36; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 1.2}s`;
      cheer.append(c);
    }
    for (let i = 1; i <= r.stars; i++) sfx('coin', { delay: i * 250, rate: 0.9 + i * 0.15 });
  }
  const nextBtn = root.querySelector('#next') as HTMLButtonElement;
  const againBtn = root.querySelector('#again') as HTMLButtonElement;
  /** [다음 스테이지]: 다음 스테이지가 있고 열려 있을 때만. 없으면 [다시하기]가 주 버튼이 된다 */
  const paintNext = () => {
    const open = !!next && stageOpen(state.profile, next);
    nextBtn.classList.toggle('hidden', !open);
    againBtn.classList.toggle('primary', !open);
    if (open) nextBtn.textContent = `다음 스테이지 ${next!.id} ▶`;
  };
  paintNext();
  const note = root.querySelector('#note') as HTMLElement;
  void r.saved.then((s) => {
    if (!root.isConnected) return;
    if (s === 'rejected') {
      root.querySelector('#coins')!.textContent = '0닢';
      note.textContent = '이 판은 기록되지 않았어요';
      return;
    }
    root.querySelector('#coins')!.innerHTML = `+${s.coins.toLocaleString()}닢`;
    const parts = [
      s.baseCoins > 0 ? `${r.cleared ? '클리어' : '버틴 만큼'} ${s.baseCoins}` : '',
      s.firstCoins > 0 ? `첫 클리어 ${s.firstCoins}` : '',
      s.starCoins > 0 ? `새 별 ${s.newStars}개 ${s.starCoins}` : '',
    ].filter(Boolean);
    note.textContent = parts.length
      ? parts.join(' + ')
      : r.cleared
        ? ''
        : '웨이브를 하나라도 넘기면 엽전을 조금 받아요';
    const lines: string[] = [];
    if (s.firstClear) lines.push('<p>🎉 <b>첫 클리어!</b></p>');
    else if (s.newStars > 0) lines.push(`<p>⭐ 별 <b>${s.bestStars}개</b>로 기록을 새로 썼어요!</p>`);
    const opened = s.opened ? stageOf(s.opened) : null;
    if (opened) lines.push(`<p>🗺️ <b>${esc(opened.id)} ${esc(opened.name)}</b> 열림!</p>`);
    else if (s.firstClear && !next) lines.push(`<p>🏆 <b>${esc(josa(regionOf(st.region)?.name ?? '', '을', '를'))}</b> 모두 지켜 냈어요!</p>`);
    if (lines.length) sfx('newRecord', { delay: 900 });
    root.querySelector('#unlocks')!.innerHTML = lines.join('');
    paintNext();
  });
  nextBtn.addEventListener('click', () => {
    if (!next) return;
    sfx('click');
    nav.prepare(next.id);
  });
  againBtn.addEventListener('click', () => {
    sfx('click');
    // 같은 스테이지·같은 캐릭터로 새 판 (시드만 새로)
    nav.game({ ...r.setup, seed: undefined });
  });
  root.querySelector('#home')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}

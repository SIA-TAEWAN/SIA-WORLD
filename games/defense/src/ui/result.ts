import { STAR2_LIVES } from '../data/balance';
import { regionOf } from '../data/regions';
import { nextStage, stageOf } from '../data/stages';
import { LIMITS, stageOpen } from '../game/progress';
import { ROSTER } from '../data/characters';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, josa, nav, screen, state, type GameResult } from './app';
import { sfx } from './sfx';

/** 결과 화면: 별 1~3개 · 얻은 엽전 · 첫 클리어 보상 → [다음 스테이지] [다시하기] [메인으로] (PRD 2장) */
export function showResult(r: GameResult) {
  const st = stageOf(r.stage)!;
  const title = r.endless ? `웨이브 ${r.wave}` : r.cleared ? '클리어!' : r.quit ? '포기했어요' : '실패…';
  const next = r.endless ? undefined : nextStage(st);
  const lost = r.startLives - r.lives;
  // 별 조건 세 줄: 이번 판에 채운 것에 표시
  const goal = (ok: boolean, text: string) => `<li class="${ok ? 'ok' : ''}"><i>★</i>${text}</li>`;
  const goals = (stars: number) => `${goal(stars >= 1, '클리어')}
         ${goal(stars >= 2, `생명 ${STAR2_LIVES} 이상 남기기`)}
         ${goal(stars >= 3, '생명을 하나도 잃지 않기')}`;
  const starIcons = (stars: number, animate: boolean) =>
    [1, 2, 3].map((i) => `<i class="${i <= stars ? 'on' : ''}"${animate ? ` style="animation-delay:${i * 0.25}s"` : ''}>★</i>`).join('');
  const root = screen(
    `<div class="result-card ${r.cleared || r.endless ? 'won' : 'lost'}">
       <h2>${r.endless ? '♾️' : esc(st.id)} ${esc(st.name)}</h2>
       <div class="verdict">${title}</div>
       ${
         r.endless
           ? `<p class="soft center">까지 버텼어요 <i class="tag hidden" id="record">새 기록!</i></p>
              <div class="squad-faces">${r.setup.squad.map((c) => `<img src="${zodiacFaceUrl(c)}" alt="" />`).join('')}</div>`
           : `<div class="big-stars" id="stars" aria-label="별 ${r.stars}개">${starIcons(r.stars, true)}</div>
       <img class="result-char" src="${zodiacFullUrl(r.setup.squad[0] ?? 'rat')}" alt="" />
       <ul class="goals" id="goals">
         ${goals(r.stars)}
       </ul>`
       }
       <ul class="stats">
         ${r.endless ? `<li><span>🏔️ 내 최고 기록</span><b id="best">${state.profile.endless ? `웨이브 ${state.profile.endless.wave}` : '–'}</b></li>` : `<li><span>❤️ 남은 생명</span><b>${r.lives}<small> / ${r.startLives}${lost > 0 ? ` (−${lost})` : ''}</small></b></li>`}
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
    if (typeof s === 'string') {
      root.querySelector('#coins')!.textContent = s === 'pending' ? '…' : '0닢';
      note.textContent =
        s === 'unrecorded'
          ? '서버에 연결하지 못한 판이라 기록되지 않았어요'
          : s === 'pending'
            ? '결과를 올리지 못했어요. 다음에 들어올 때 다시 보낼게요'
            : '이 판의 결과는 받아들여지지 않았어요';
      return;
    }
    if (!s.valid) {
      root.querySelector('#coins')!.textContent = '0닢';
      note.textContent = '기록이 정상 범위를 벗어나 반영되지 않았어요';
      return;
    }
    root.querySelector('#coins')!.innerHTML = `+${s.coins.toLocaleString()}닢`;
    // 별은 서버가 판 시작 때 적어 둔 시작 생명으로 센 값이 이 판의 별이다 (화면의 계산과 다르면 서버 쪽으로 고친다)
    if (!r.endless && r.cleared && s.stars !== r.stars) {
      const box = root.querySelector('#stars');
      if (box) {
        box.innerHTML = starIcons(s.stars, false);
        box.setAttribute('aria-label', `별 ${s.stars}개`);
      }
      const g = root.querySelector('#goals');
      if (g) g.innerHTML = goals(s.stars);
    }
    if (r.endless) {
      note.textContent = `넘긴 웨이브마다 ${LIMITS.endless_coin_per_wave}닢 (한 판 ${LIMITS.endless_coin_cap}닢까지)`;
      root.querySelector('#best')!.textContent = `웨이브 ${s.bestWave}`;
      if (s.newRecord) {
        root.querySelector('#record')!.classList.remove('hidden');
        sfx('newRecord', { delay: 500 });
      }
      return;
    }
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
    for (const c of s.unlocked) {
      const who = ROSTER.find((x) => x.id === c);
      if (who) lines.push(`<p><img src="${zodiacFaceUrl(c)}" alt="" />🔓 <b>${esc(who.nick)}</b> 해금! <small>${esc(who.role)}</small></p>`);
    }
    const opened = s.opened ? stageOf(s.opened) : null;
    if (opened) lines.push(`<p>🗺️ <b>${esc(opened.id)} ${esc(opened.name)}</b> 열림!</p>`);
    else if (s.firstClear && st.no === 5) lines.push(`<p>🏆 <b>${esc(josa(regionOf(st.region)?.name ?? '', '을', '를'))}</b> 모두 지켜 냈어요!</p>`);
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

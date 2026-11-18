import { RUN_SEC } from '../data/balance';
import { CHARACTER_BY_ID } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { zodiacFullUrl } from '../assets';
import { esc, mmss, nav, screen, type GameResult } from './app';
import { sfx } from './sfx';

/** 결과 화면: 생존 시간 · 처치 수 · 도달 레벨 · 얻은 엽전 → [다시하기] [메인으로] */
export function showResult(r: GameResult) {
  const map = MAPS[MAP_INDEX[r.map] ?? 0];
  const char = CHARACTER_BY_ID[r.setup.char];
  const title = r.cleared ? '클리어!' : r.quit ? '그만뒀어요' : '게임 오버';
  const root = screen(
    `<div class="result-card ${r.cleared ? 'won' : 'lost'}">
       <h2>${esc(map.name)} · ${esc(char.nick)}</h2>
       <div class="verdict">${title}</div>
       <img class="result-char" src="${zodiacFullUrl(r.setup.char)}" alt="" />
       <ul class="stats">
         <li><span>⏱️ 생존 시간</span><b>${mmss(r.time)}<small> / ${mmss(RUN_SEC)}</small></b></li>
         <li><span>💀 처치 수</span><b>${r.kills.toLocaleString()}</b></li>
         <li><span>⭐ 도달 레벨</span><b>Lv ${r.level}</b></li>
         <li><span>🪙 얻은 엽전</span><b class="coin">${r.coins.toLocaleString()}닢</b></li>
       </ul>
       <p class="soft note">엽전 모으기와 강화는 곧 열려요 (지금은 이번 판에서 주운 수만 보여 줘요)</p>
     </div>
     <div class="actions">
       <button class="btn" id="home">메인으로</button>
       <button class="btn primary" id="again">다시하기 ▶</button>
     </div>
     ${r.cleared ? '<div class="cheer" id="cheer"></div>' : ''}`,
    'result',
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
  }
  root.querySelector('#again')!.addEventListener('click', () => {
    sfx('click');
    // 같은 캐릭터·맵으로 새 판 (개발용 설정도 그대로, 시드만 새로)
    nav.game({ ...r.setup, seed: undefined });
  });
  root.querySelector('#home')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}

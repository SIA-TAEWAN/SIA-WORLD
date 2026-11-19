import { RUN_SEC } from '../data/balance';
import { endlessCoinCap, isEndless } from '../game/progress';
import { CHARACTER_BY_ID } from '../data/characters';
import { MAPS, MAP_INDEX } from '../data/maps';
import { zodiacFaceUrl, zodiacFullUrl } from '../assets';
import { esc, mmss, nav, screen, type GameResult } from './app';
import { sfx } from './sfx';

/** 결과 화면: 생존 시간 · 처치 수 · 도달 레벨 · 얻은 엽전 · 새 기록 · 새로 해금된 것 → [다시하기] [강화하러 가기] [메인으로] */
export function showResult(r: GameResult) {
  const map = MAPS[MAP_INDEX[r.map] ?? 0];
  const char = CHARACTER_BY_ID[r.setup.char];
  const endless = isEndless(r);
  // 무한 모드에는 클리어가 없다: 생존 시간 · 처치 수 · 새 기록만 보여 준다
  const title = r.cleared ? '클리어!' : r.quit ? '그만뒀어요' : '게임 오버';
  const capped = endless && r.coins >= endlessCoinCap(r.map);
  const root = screen(
    `<div class="result-card ${r.cleared ? 'won' : 'lost'}">
       <h2>${esc(map.name)} · ${esc(char.nick)}${endless ? ' <span class="tag endless">♾️ 무한 모드</span>' : ''}</h2>
       <div class="verdict">${title}</div>
       <img class="result-char" src="${zodiacFullUrl(r.setup.char)}" alt="" />
       <ul class="stats">
         <li><span>⏱️ 생존 시간 <i class="tag new hidden" id="record">새 기록!</i></span><b>${mmss(r.time)}${endless ? '' : `<small> / ${mmss(RUN_SEC)}</small>`}</b></li>
         <li><span>💀 처치 수</span><b>${r.kills.toLocaleString()}</b></li>
         <li><span>⭐ 도달 레벨</span><b>Lv ${r.level}</b></li>
         <li><span>🪙 얻은 엽전${capped ? ' <i class="tag cap">최대</i>' : ''}</span><b class="coin" id="coins">${r.coins.toLocaleString()}닢</b></li>
       </ul>
       <div class="unlocks" id="unlocks"></div>
       <p class="soft note" id="note">결과를 저장하는 중…</p>
     </div>
     <div class="actions">
       <button class="btn" id="home">메인으로</button>
       <button class="btn" id="upgrade">⚒️ 강화하러 가기</button>
     </div>
     <button class="btn primary big" id="again">다시하기 ▶</button>
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
  // 서버가 정한 결과가 오면 채운다: 받은 엽전 · 새 기록 · 새로 해금된 것
  const note = root.querySelector('#note') as HTMLElement;
  void r.saved.then((s) => {
    if (!root.isConnected) return;
    if (s === 'unrecorded') note.textContent = '서버에 연결하지 못한 판이라 기록되지 않았어요';
    else if (s === 'pending') note.textContent = '결과를 올리지 못했어요. 다음에 들어올 때 다시 보낼게요';
    else if (s === 'rejected') note.textContent = '이 판의 결과는 받아들여지지 않았어요';
    else {
      root.querySelector('#coins')!.textContent = `+${s.coins.toLocaleString()}닢`;
      note.textContent = !s.valid
        ? '기록이 정상 범위를 벗어나 랭킹에는 오르지 않아요'
        : capped
          ? `무한 모드는 한 판에 ${endlessCoinCap(r.map).toLocaleString()}닢까지 받아요`
          : '엽전으로 메인의 [강화]에서 더 강해질 수 있어요';
      if (s.newRecord) {
        root.querySelector('#record')!.classList.remove('hidden');
        sfx('newRecord');
      }
      const lines = [
        ...s.unlockedCharacters.map((c) => `<p><img src="${zodiacFaceUrl(c)}" alt="" />🔓 <b>${esc(CHARACTER_BY_ID[c].nick)}</b> 해금!</p>`),
        ...s.unlockedMaps.map((m) => `<p>🗺️ 새 맵 <b>${esc(MAPS[MAP_INDEX[m] ?? 0].name)}</b> 해금!</p>`),
      ];
      root.querySelector('#unlocks')!.innerHTML = lines.join('');
    }
  });
  root.querySelector('#again')!.addEventListener('click', () => {
    sfx('click');
    // 같은 캐릭터·맵·모드로 새 판 (개발용 설정도 그대로, 시드만 새로)
    nav.game({ ...r.setup, seed: undefined });
  });
  root.querySelector('#upgrade')!.addEventListener('click', () => {
    sfx('click');
    nav.upgrade();
  });
  root.querySelector('#home')!.addEventListener('click', () => {
    sfx('click');
    nav.main();
  });
}

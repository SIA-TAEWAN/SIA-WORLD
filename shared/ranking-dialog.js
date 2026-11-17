// SIA WORLD 랭킹 창 (로비와 시아탱크가 같이 쓴다).
//   탭: 💣 시아탱크(포인트) · 🎯 백발백중 · 🪙 카지노 · 💰 맞고
//   등급: 해 상위 10% · 달 30% · 별 60% · 그 외 구름 (shared/rank.js)
// 색은 DESIGN.md / shared/theme.css 값을 그대로 적는다 (시아탱크는 --panel 같은 변수 이름을 다른 뜻으로 써서 변수를 빌려 쓸 수 없다).
import { getRanking, formatAmount, RANKINGS } from './wallet.js';
import { withTiers, tierSvg } from './rank.js';

const STYLE_ID = 'sia-ranking-style';
/** 탭 순서 (시아탱크가 먼저) */
const TAB_ORDER = ['tank', 'target', 'casino', 'matgo'];
const CSS = `
.sia-rank-dim { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px;
  background: color-mix(in srgb, #2a1a10 55%, transparent); font-family: 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif; }
.sia-rank { box-sizing: border-box; width: min(460px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #fff8e8; color: #2a1a10; border: 4px solid #2a1a10; border-radius: 28px;
  box-shadow: 0 8px 0 #2a1a10; padding: 16px; }
.sia-rank * { box-sizing: border-box; }
.sia-rank .rh { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.sia-rank .rh h3 { margin: 0; font-size: 22px; font-weight: normal; }
.sia-rank .rh button { font: inherit; font-size: 15px; cursor: pointer; color: #2a1a10; background: #fff;
  border: 3px solid #2a1a10; border-radius: 12px; padding: 4px 12px; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.sia-rank .tabs button { flex: 1; min-width: 72px; white-space: nowrap; font: inherit; font-size: 14px; color: #2a1a10; cursor: pointer;
  border: 2px solid #2a1a10; background: #fff; border-radius: 12px; padding: 7px 4px; }
.sia-rank .tabs button.sel { background: #ffd34d; box-shadow: 0 3px 0 #2a1a10; }
.sia-rank .me-line { text-align: center; font-size: 15px; margin: 6px 0; }
.sia-rank .me-line b { font-weight: normal; color: #f0a500; }
.sia-rank .list { flex: 1; min-height: 0; overflow-y: auto; border-top: 2px dashed #e2d3b5; }
.sia-rank table { width: 100%; border-collapse: collapse; }
.sia-rank td { padding: 6px; border-bottom: 2px dashed #e2d3b5; font-size: 16px; vertical-align: middle; }
.sia-rank td.pl { width: 36px; text-align: center; }
.sia-rank td.tr { width: 34px; line-height: 0; }
.sia-rank td.nm { width: 100%; word-break: break-all; }
.sia-rank td.am { white-space: nowrap; text-align: right; color: #f0a500; }
.sia-rank tr.me { background: #fff4c2; color: #2a1a10; }
.sia-rank tr.me td.nm { color: #1f6fd1; }
.sia-rank .note { font-size: 12px; color: #8a6a4a; text-align: center; margin: 8px 0 0; }
`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * 랭킹 창 열기.
 * meId: 내 사용자 ID (내 줄 강조), first: 처음 보여 줄 탭 ('tank' | 'target' | 'casino' | 'matgo')
 */
export function openRanking({ meId = null, first = 'tank' } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.append(st);
  }
  const dim = document.createElement('div');
  dim.className = 'sia-rank-dim';
  dim.innerHTML = `<div class="sia-rank" role="dialog" aria-modal="true" aria-label="랭킹">
    <div class="rh"><h3>🏆 랭킹</h3><button type="button" data-close>닫기</button></div>
    <div class="tabs">${TAB_ORDER.filter((g) => RANKINGS[g])
      .map((g) => `<button type="button" data-g="${g}">${RANKINGS[g].label}</button>`)
      .join('')}</div>
    <p class="me-line"></p>
    <div class="list"><table></table></div>
    <p class="note"></p>
  </div>`;
  document.body.append(dim);
  const $ = (s) => dim.querySelector(s);
  const close = () => {
    dim.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  dim.addEventListener('click', (e) => {
    if (e.target === dim || e.target.closest('[data-close]')) close();
    const tab = e.target.closest('[data-g]');
    if (tab) void show(tab.dataset.g);
  });

  let shown = '';
  async function show(game) {
    shown = game;
    dim.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.g === game));
    const info = RANKINGS[game];
    $('.note').textContent = `${info.note} · 해 상위 10% · 달 30% · 별 60% · 그 외 구름 (${formatAmount(info.base)}${info.unit} 이하는 구름)`;
    $('.me-line').textContent = '불러오는 중…';
    $('table').innerHTML = '';
    try {
      const rows = withTiers(await getRanking(game), info.base);
      if (shown !== game) return;
      const mine = meId ? rows.find((r) => r.key === meId) : null;
      $('.me-line').innerHTML = mine
        ? `내 순위 <b>${mine.place}위</b> / ${rows.length}명 · ${tierSvg(mine.tier, 20)} · ${formatAmount(mine.amount)}${info.unit}`
        : '아직 순위가 없어요';
      $('table').innerHTML =
        rows
          .slice(0, 100)
          .map(
            (r) =>
              `<tr class="${r.key === meId ? 'me' : ''}"><td class="pl">${r.place}</td><td class="tr">${tierSvg(r.tier, 26)}</td>` +
              `<td class="nm">${esc(r.nickname)}</td><td class="am">${formatAmount(r.amount)}${info.unit}</td></tr>`,
          )
          .join('') || '<tr><td>아직 랭킹이 없어요</td></tr>';
    } catch {
      if (shown === game) $('.me-line').textContent = '랭킹을 불러오지 못했어요';
    }
  }
  void show(RANKINGS[first] ? first : 'tank');
  return close;
}

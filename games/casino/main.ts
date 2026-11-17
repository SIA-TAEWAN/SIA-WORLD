/** 시아카지노: 세븐포커 / 블랙잭 고르기 + 내 칩 */
import '../lib/style.css';
import { linkThemeCss, world, worldHome } from '../lib/world.ts';

linkThemeCss();

const app = document.getElementById('app')!;
app.innerHTML = '<div class="center">불러오는 중…</div>';

async function main() {
  const auth = await world.auth();
  await auth.requireLogin();
  const [wallet, z] = await Promise.all([world.wallet(), world.zodiac()]);
  const w = await wallet.ensureWallet().catch(() => null);
  app.innerHTML = `<div class="lobby">
    <header class="bar"><a class="btn ghost" href="${worldHome()}">← SIA WORLD</a><h1>🎰 시아카지노</h1>
      <span class="money">🪙 ${w ? wallet.formatAmount(w.chips) : '-'}칩</span></header>
    <section class="card pick">
      <a class="pick-card" href="poker/"><img src="${z.fullUrl('tiger')}" alt=""/><b>세븐포커</b><span>4장 받고 1장 버리기, 7구 히든까지 · 최대 4명</span></a>
      <a class="pick-card" href="holdem/"><img src="${z.fullUrl('monkey')}" alt=""/><b>텍사스 홀덤</b><span>내 카드 2장 + 공용 카드 5장, 노리밋 · 최대 4명</span></a>
      <a class="pick-card bj" href="blackjack/"><img src="${z.fullUrl('rabbit')}" alt=""/><b>블랙잭</b><span>딜러와 21을 겨루는 게임 · 최대 4명</span></a>
    </section>
    <p class="empty">방을 만들면 AI가 빈자리를 채워요. 친구가 들어오면 AI가 한 명씩 빠져요.</p>
  </div>`;
}

main().catch(() => {
  app.innerHTML = '<div class="center">연결하지 못했어요.<br/><br/><button class="btn primary" onclick="location.reload()">다시 시도</button></div>';
});

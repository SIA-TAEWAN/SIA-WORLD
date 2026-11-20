/** 시아카지노: 세븐포커 / 블랙잭 고르기 + 내 칩 */
import '../lib/style.css';
import { linkThemeCss, world, worldHome } from '../lib/world.ts';

linkThemeCss();

const app = document.getElementById('app')!;
app.innerHTML = '<div class="center">불러오는 중…</div>';

async function main() {
  const auth = await world.auth();
  await auth.requireLogin();
  // 다른 탭·기기에서 로그아웃(또는 다른 곳 로그인으로 밀려남)하면 로그인 화면으로 (다른 게임과 같다)
  auth.onSignedOut(() => location.replace(auth.loginUrl()));
  const wallet = await world.wallet();
  const w = await wallet.ensureWallet().catch(() => null);
  // 게임 그림(shared/images/casino): 카드 오른쪽에 깔고 왼쪽은 판 색으로 자연스럽게 번지게
  const art = (name: string) => new URL(`shared/images/casino/${name}.webp`, worldHome()).href;
  const ART =
    'right:0;top:0;width:auto;height:100%;max-width:100%;aspect-ratio:8/5;object-fit:cover;object-position:right center;' +
    '-webkit-mask-image:linear-gradient(to right,transparent,#000 38%);mask-image:linear-gradient(to right,transparent,#000 38%)';
  app.innerHTML = `<div class="lobby">
    <header class="bar"><a class="btn ghost" href="${worldHome()}">← SIA WORLD</a><h1>🎰 시아카지노</h1>
      <span class="money">🪙 ${w ? wallet.formatAmount(w.chips) : '-'}칩</span></header>
    <section class="card pick">
      <a class="pick-card" href="poker/"><img src="${art('poker')}" style="${ART}" alt=""/><b>세븐포커</b><span>4장 받고 1장 버리기, 7구 히든까지 · 최대 4명</span></a>
      <a class="pick-card" href="holdem/"><img src="${art('holdem')}" style="${ART}" alt=""/><b>텍사스 홀덤</b><span>내 카드 2장 + 공용 카드 5장, 노리밋 · 최대 4명</span></a>
      <a class="pick-card bj" href="blackjack/"><img src="${art('blackjack')}" style="${ART}" alt=""/><b>블랙잭</b><span>딜러와 21을 겨루는 게임 · 최대 4명</span></a>
      <a class="pick-card rl" href="roulette/"><img src="${art('roulette')}" style="${ART}" alt=""/><b>십이지신 룰렛</b><span>띠 ×12 · 이웃 ×6 · 계절 ×4 · 음양 ×2 · 최대 8명</span></a>
    </section>
    <p class="empty">방을 만들면 AI가 빈자리를 채워요. 친구가 들어오면 AI가 한 명씩 빠져요.</p>
  </div>`;
}

main().catch(() => {
  app.innerHTML = '<div class="center">연결하지 못했어요.<br/><br/><button class="btn primary" onclick="location.reload()">다시 시도</button></div>';
});

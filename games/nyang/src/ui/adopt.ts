/**
 * 입양 화면 (PRD 2장): 보호소의 아기 고양이 6마리 (털 색마다 한 마리, 성격은 날마다 바뀐다) → 고르고 이름 짓기 → 입양.
 */
import { COLOR, CONST, NAME_IDEAS, NAME_RE, PERSONALITY, SPOT_NAME, kstDay, shelterKittens, type ColorId, type PersonalityId } from '../data/balance';
import { errorText, type NyangApi } from '../net/api';
import type { NyangState } from '../game/rules';
import { catArt } from './catart';
import { buzz, esc, sfx, toast } from './common';

export function showAdopt(root: HTMLElement, api: NyangApi, done: (state: NyangState, slot: number) => void) {
  const kittens = shelterKittens(kstDay(Math.floor(api.now())));
  let pick = -1;
  root.innerHTML = `
    <section class="adopt">
      <div class="logo">시아집사</div>
      <div class="sub">보호소에서 기다리는 아기 고양이예요.<br/>함께 살 아이를 골라 주세요</div>
      <div class="kittens">${kittens
        .map(
          (k, i) => `<button class="kitten" data-i="${i}" type="button" aria-label="${COLOR[k.color].name} ${PERSONALITY[k.personality].name}">
            <span class="kimg"><img alt="" data-color="${k.color}"/></span>
            <b>${COLOR[k.color].name}</b><small>${PERSONALITY[k.personality].name}</small></button>`,
        )
        .join('')}</div>
      <div class="panel adopt-info hidden" id="adoptInfo"></div>
    </section>`;
  root.querySelectorAll<HTMLImageElement>('.kitten img').forEach((im) => {
    void catArt(im.dataset.color as ColorId, 'sit').then((u) => (im.src = u));
  });
  const info = root.querySelector<HTMLElement>('#adoptInfo')!;
  const ideas = [...NAME_IDEAS].sort(() => Math.random() - 0.5);
  let ideaAt = 0;
  const render = () => {
    const k = kittens[pick];
    const p = PERSONALITY[k.personality as PersonalityId];
    info.classList.remove('hidden');
    info.innerHTML = `
      <div class="ai-head"><span class="tag">${COLOR[k.color].name}</span><span class="tag pink">${p.name}</span></div>
      <p class="ai-desc">${esc(p.desc)}<br/><small>좋아하는 곳: ${p.likes.map((s) => SPOT_NAME[s]).join(' · ')} · 싫어하는 곳: ${p.dislikes.map((s) => SPOT_NAME[s]).join(' · ')}</small></p>
      <label class="namerow"><span>이름</span><input id="catName" maxlength="${CONST.name_max}" autocomplete="off" placeholder="이름을 지어 주세요" value="${esc(ideas[ideaAt % ideas.length])}"/>
        <button class="btn small" id="dice" type="button" aria-label="다른 이름">🎲</button></label>
      <button class="btn primary wide" id="adoptGo" type="button">입양하기 ▶</button>`;
    info.querySelector('#dice')!.addEventListener('click', () => {
      ideaAt++;
      (info.querySelector('#catName') as HTMLInputElement).value = ideas[ideaAt % ideas.length];
      sfx('click');
    });
    info.querySelector('#adoptGo')!.addEventListener('click', go);
  };
  let busy = false;
  async function go() {
    if (busy) return;
    const name = (info.querySelector('#catName') as HTMLInputElement).value.trim().replace(/\s+/g, ' ');
    if (!name || [...name].length > CONST.name_max || !NAME_RE.test(name)) return toast('이름은 한글 · 영문 · 숫자로 1~8글자예요');
    busy = true;
    const k = kittens[pick];
    try {
      const r = await api.adopt(k.color, k.personality, name);
      sfx('nyangMeow');
      buzz(30);
      done(r.state, r.slot);
    } catch (e) {
      console.error(e);
      toast(errorText(e));
    } finally {
      busy = false;
    }
  }
  root.querySelectorAll<HTMLButtonElement>('.kitten').forEach((b) =>
    b.addEventListener('click', () => {
      pick = Number(b.dataset.i);
      root.querySelectorAll('.kitten').forEach((x) => x.classList.toggle('sel', x === b));
      sfx('nyangMeow', { rate: 1.2 + Math.random() * 0.3 });
      render();
      info.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }),
  );
}

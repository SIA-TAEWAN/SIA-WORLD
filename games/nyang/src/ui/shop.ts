/**
 * 상점 · 보관함 (PRD 7 · 8장). 탭: 사료 · 간식 · 츄르 · 씨앗 · 장난감 · 가구 · 보관함(팔기 · 고양이에게 주기 · 특별 가구와 바꾸기).
 * 엽전은 시아집사 전용 지갑, 츄르 · 십이지 인형 선반은 시아코인 (서버 nyang_buy 가 _spend_sia_coin 으로 지갑에서 한 번에).
 * 시아코인으로 사는 것은 두 번 눌러야 산다 (잘못 누름 방지).
 */
import {
  CHURU, CONST, EXCHANGES, FOOD, FURNITURE_NAME, PLANT, SELL, SHOP, SEED_NAME, STYLE_OF, TOYS, isPlantId, kstDay,
  type ChuruId, type FoodId, type PlantId, type ShopItem, type ToyId,
} from '../data/balance';
import type { WorldArt } from '../data/world.gen';
import { itemCount, topLevel } from '../game/rules';
import { errorText } from '../net/api';
import { artImg } from './art';
import { buzz, esc, josa, sfx, toast } from './common';
import type { RoomCtx, ShopTabId } from './ctx';
import { presentIcon, toyIcon } from './props';

const TABS: { id: ShopTabId; name: string }[] = [
  { id: 'food', name: '사료' },
  { id: 'snack', name: '간식' },
  { id: 'churu', name: '츄르' },
  { id: 'seed', name: '씨앗' },
  { id: 'toy', name: '장난감' },
  { id: 'furniture', name: '가구' },
  { id: 'style', name: '벽지·바닥' },
  { id: 'bag', name: '보관함' },
];
const FURNITURE_ART: Record<string, WorldArt> = {
  vase: 'furniture-vase', scratcher: 'furniture-scratcher', hideaway: 'furniture-hideaway', cat_tower: 'furniture-cat-tower',
  zodiac_shelf: 'furniture-zodiac-shelf', moon_lamp: 'furniture-moon-lamp', fish_pillow: 'objects-fish-toy', yarn_basket: 'objects-yarn',
};
const FURNITURE_DESC: Record<string, string> = {
  vase: '해바라기 · 장미를 꽂아 두는 꽃병',
  scratcher: '고양이가 발톱을 긁어요',
  hideaway: '고양이가 쏙 숨어요',
  cat_tower: '고양이가 꼭대기까지 올라가요',
  zodiac_shelf: 'SIA WORLD 십이지 인형 12마리 선반 (시아코인 전용)',
  moon_lamp: '보름달꽃 3송이와 바꾸는 특별한 등',
};
const TAB_KEY = 'siaNyang:shopTab';

const fid = (id: string) => id.slice(id.indexOf(':') + 1);
function itemName(id: string): string {
  if (id.startsWith('food:')) return FOOD[fid(id) as FoodId]?.name ?? id;
  if (id.startsWith('churu:')) return `${CHURU[fid(id) as ChuruId]?.name ?? ''} 츄르`;
  if (id.startsWith('seed:')) return `${SEED_NAME[fid(id) as PlantId] ?? ''} 씨앗`;
  if (id.startsWith('plant:')) return SEED_NAME[fid(id) as PlantId] ?? id;
  if (id.startsWith('toy:')) return TOYS[fid(id) as ToyId]?.name ?? id;
  if (id.startsWith('furniture:')) return FURNITURE_NAME[fid(id)] ?? id;
  if (id.startsWith('style:')) return `${{ wall: '벽지', floor: '바닥', window: '창문' }[STYLE_OF[fid(id)]?.kind ?? 'wall']} · ${STYLE_OF[fid(id)]?.name ?? id}`;
  return ({ medicine: '약 간식', fur: '털 뭉치' } as Record<string, string>)[id] ?? id;
}
function itemIcon(id: string): string {
  const f = fid(id);
  if (id.startsWith('food:')) return `${artImg('objects-food-bag', '🍚', 'art')}${f === 'premium' ? '<em class="ico-tag">고급</em>' : '<em class="ico-tag">참치</em>'}`;
  if (id.startsWith('churu:')) return artImg(`objects-churu-${f}` as WorldArt, '🍡', 'art');
  if (id.startsWith('seed:')) return `${artImg('objects-seed-packet', '🌱', 'art')}${artImg(`plants-${f}-3` as WorldArt, '', 'art ico-on')}`;
  if (id.startsWith('plant:')) return artImg(`plants-${f}-3` as WorldArt, '🌼', 'art');
  if (id.startsWith('toy:')) return toyIcon(f);
  if (id.startsWith('furniture:')) return FURNITURE_ART[f] ? artImg(FURNITURE_ART[f], presentIcon('furniture'), 'art') : presentIcon('furniture');
  if (id.startsWith('style:')) return `<span class="swatch sw-${f}"></span>`;
  if (id === 'medicine') return artImg('objects-medicine', '💊', 'art');
  if (id === 'fur') return artImg('objects-fur-ball', '☁️', 'art');
  return '🎁';
}
function itemDesc(it: ShopItem): string {
  const id = it.id;
  if (id.startsWith('food:')) return `${it.give}번 먹일 양 · ${FOOD[fid(id) as FoodId].desc}`;
  if (id === 'medicine') return '감기 기운이 있을 때 주면 2시간 뒤에 나아요 (다 채우지 않아도)';
  if (id.startsWith('churu:')) return '하루 2개까지 · 기분 · 친밀도가 크게 올라요';
  if (id.startsWith('seed:')) {
    const p = PLANT[fid(id) as PlantId];
    return `${p.grow_sec / 3600}시간 · 물 한 번에 ${p.water_sec / 3600}시간 · ${p.use}`;
  }
  if (id.startsWith('toy:')) return TOYS[fid(id) as ToyId].desc;
  if (id.startsWith('style:')) return '🛋️ 꾸미기에서 바꿔요 (꾸미기 화면에서 바로 살 수도 있어요)';
  return FURNITURE_DESC[fid(id)] ?? '꾸미기에서 방에 놓을 수 있어요';
}
const priceHtml = (it: ShopItem, n = 1) =>
  it.sia ? `<i class="sia-ico">S</i>${it.sia * n}` : `<i class="coin-ico"></i>${(it.price * n).toLocaleString('ko-KR')}`;

export function openShop(ctx: RoomCtx, tab0?: ShopTabId) {
  if (document.querySelector('.shop-dim')) return;
  let tab: ShopTabId = tab0 ?? 'food';
  if (!tab0) {
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (t && TABS.some((x) => x.id === t)) tab = t as ShopTabId;
    } catch {
      /* 저장이 막힌 기기 */
    }
  }
  let armed = '';
  let armTimer = 0;
  let working = false;
  const dim = document.createElement('div');
  dim.className = 'dim sheet-dim shop-dim';
  dim.innerHTML = `<div class="sheet panel shop" role="dialog" aria-label="상점">
    <div class="shop-head"><h3>🛒 상점</h3><span class="pill"><i class="coin-ico"></i><b data-coins></b></span><span class="pill"><i class="sia-ico">S</i><b data-sia></b></span>
      <button class="btn iconbtn" type="button" data-close aria-label="닫기">✕</button></div>
    <div class="shop-tabs" role="tablist">${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}">${t.name}</button>`).join('')}</div>
    <div class="shop-body"></div></div>`;
  document.body.append(dim);
  sfx('click');
  const body = dim.querySelector<HTMLElement>('.shop-body')!;
  const close = () => {
    dim.remove();
    clearTimeout(armTimer);
  };

  function rowsShop(): string {
    const s = ctx.state();
    const lv = topLevel(s);
    const list = SHOP.filter((i) => i.tab === tab);
    const note =
      tab === 'food' ? '<p class="likes">기본 사료는 언제나 공짜예요. 사료 봉투를 누르면 산 사료로 바꿀 수 있어요</p>'
      : tab === 'churu' ? '<p class="likes">츄르는 시아코인으로만 살 수 있어요 (하나에 5개). 돌봐 줄 일이 있을 때 돌보면 시아코인을 받아요</p>'
      : tab === 'seed' ? '<p class="likes">씨앗은 친밀도가 오를수록 더 열려요 (내 고양이 중 가장 높은 단계)</p>'
      : tab === 'furniture' ? '<p class="likes">가구는 🛋️ 꾸미기에서 방에 놓아요. 고양이가 올라가고 · 숨고 · 긁고 · 자요</p>'
      : tab === 'style' ? '<p class="likes">벽지 · 바닥 · 커튼을 바꿔요. 엽전이 넉넉할 때 하나씩 모아 보세요</p>' : '';
    return note + list.map((it) => {
      const once = it.once === 1;
      const own = it.id.startsWith('furniture:') ? s.profile.furniture.includes(fid(it.id)) : itemCount(s.profile, it.id) > 0;
      const have = it.id.startsWith('furniture:') ? (own ? 1 : 0) : itemCount(s.profile, it.id);
      const locked = lv < it.level;
      let btns = '';
      if (locked) btns = `<span class="lock">🔒 Lv${it.level}</span>`;
      else if (once && own) btns = '<span class="owned">있어요</span>';
      else {
        const ns = once ? [1] : it.sia ? [1, 2] : it.tab === 'seed' ? [1, 5] : [1, 3];
        btns = ns.map((n) => {
          const key = `${it.id}#${n}`;
          const afford = s.profile.coins >= it.price * n && (!it.sia || s.profile.sia >= it.sia * n);
          return `<button class="btn small buy ${armed === key ? 'armed' : ''}" type="button" data-buy="${it.id}" data-n="${n}" ${afford ? '' : 'data-poor'}>
            ${armed === key ? '한 번 더!' : `${once ? '사기' : `${n}개`}<small>${priceHtml(it, n)}</small>`}</button>`;
        }).join('');
      }
      return `<div class="srow ${locked ? 'locked' : ''}"><div class="sico">${itemIcon(it.id)}</div>
        <div class="sinfo"><b>${esc(itemName(it.id))}</b>${!once && have ? `<em class="have">${have}개 있음</em>` : ''}<small>${esc(itemDesc(it))}</small></div>
        <div class="sbuy">${btns}</div></div>`;
    }).join('');
  }

  function rowsBag(): string {
    const s = ctx.state();
    const items = s.profile.items;
    const out: string[] = [];
    // 팔 수 있는 것 · 고양이에게 줄 것 · 바꿀 것
    const crops = Object.keys(items).filter((k) => k.startsWith('plant:') && isPlantId(fid(k)));
    const sellable = [...crops, ...(items.fur ? ['fur'] : [])];
    if (!sellable.length) out.push('<p class="likes">베란다에서 키운 꽃과 빗질로 모은 털 뭉치를 여기서 팔 수 있어요</p>');
    for (const k of sellable) {
      const n = items[k];
      const price = SELL[k] ?? 0;
      const f = fid(k);
      const acts: string[] = [];
      if (f === 'catgrass' || f === 'catnip') acts.push(`<button class="btn small" type="button" data-treat="${f}">고양이에게<small>주기</small></button>`);
      if (price) acts.push(`<button class="btn small" type="button" data-sell="${k}" data-n="1">1개 팔기<small><i class="coin-ico"></i>${price}</small></button>`);
      if (price && n > 1) acts.push(`<button class="btn small" type="button" data-sell="${k}" data-n="${n}">모두<small><i class="coin-ico"></i>${price * n}</small></button>`);
      const ex = EXCHANGES.find((e) => e.need === k);
      if (ex) acts.push(`<button class="btn small" type="button" data-ex="${ex.id}" ${n >= ex.n && !s.profile.furniture.includes(ex.id) ? '' : 'disabled'}>${esc(FURNITURE_NAME[ex.id])}<small>${Math.min(n, ex.n)}/${ex.n}송이</small></button>`);
      out.push(`<div class="srow"><div class="sico">${itemIcon(k)}</div><div class="sinfo"><b>${esc(itemName(k))}</b><em class="have">${n}개</em>
        <small>${k === 'fur' ? '빗질하면 모여요' : esc(PLANT[f as PlantId].use)}</small></div><div class="sbuy">${acts.join('')}</div></div>`);
    }
    // 그 밖에 가진 것 (보기만)
    const rest = Object.keys(items).filter((k) => !sellable.includes(k) && items[k] > 0).sort();
    if (rest.length) {
      out.push(`<h4>가진 것</h4><div class="bag-grid">${rest.map((k) => `<div class="bag-cell"><div class="sico">${itemIcon(k)}</div><small>${esc(itemName(k))}</small><b>${items[k]}</b></div>`).join('')}</div>`);
    }
    if (s.profile.furniture.length) {
      out.push(`<h4>가구 (꾸미기에서 방에 놓아요)</h4><div class="bag-grid">${[...new Set(s.profile.furniture)].map((f) => `<div class="bag-cell"><div class="sico">${itemIcon(`furniture:${f}`)}</div><small>${esc(FURNITURE_NAME[f] ?? f)}</small></div>`).join('')}</div>`);
    }
    return out.join('');
  }

  function paint() {
    const s = ctx.state();
    dim.querySelector('[data-coins]')!.textContent = s.profile.coins.toLocaleString('ko-KR');
    dim.querySelector('[data-sia]')!.textContent = s.profile.sia.toLocaleString('ko-KR');
    for (const b of dim.querySelectorAll<HTMLElement>('[data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
    const keep = body.scrollTop;
    body.innerHTML = tab === 'bag' ? rowsBag() : rowsShop();
    body.scrollTop = keep;
  }
  paint();

  async function act<R extends { state: ReturnType<RoomCtx['state']> }>(fn: () => Promise<R>, ok: (r: R) => void) {
    if (working) return;
    working = true;
    try {
      const r = await fn();
      ctx.apply(r);
      ok(r);
    } catch (e) {
      toast(errorText(e));
    } finally {
      working = false;
      paint();
    }
  }

  dim.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === dim || t.closest('[data-close]')) return close();
    const tb = t.closest<HTMLElement>('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab as ShopTabId;
      armed = '';
      try {
        localStorage.setItem(TAB_KEY, tab);
      } catch {
        /* 저장이 막힌 기기 */
      }
      sfx('toggle');
      body.scrollTop = 0;
      return paint();
    }
    const bb = t.closest<HTMLElement>('[data-buy]');
    if (bb) {
      const id = bb.dataset.buy!;
      const n = Number(bb.dataset.n) || 1;
      const it = SHOP.find((x) => x.id === id)!;
      if (bb.dataset.poor != null) return toast(it.sia ? '시아코인이 모자라요 — 돌봐 줄 일이 있을 때 돌보면 받아요' : '엽전이 모자라요 — 꽃을 키워 팔아 보세요');
      const key = `${id}#${n}`;
      if (it.sia && armed !== key) {
        // 시아코인은 두 번 눌러야 산다
        armed = key;
        clearTimeout(armTimer);
        armTimer = window.setTimeout(() => {
          armed = '';
          paint();
        }, 3000);
        sfx('click');
        return paint();
      }
      armed = '';
      return void act(
        () => ctx.api.buy(id, n),
        () => {
          sfx('nyangCoin');
          buzz(15);
          toast(it.once ? `${josa(itemName(id), '을', '를')} 샀어요${id.startsWith('furniture:') || id.startsWith('style:') ? ' — 🛋️ 꾸미기에서 방에 놓아요' : ''}` : `${itemName(id)} ${n * it.give}개를 샀어요`);
        },
      );
    }
    const sb = t.closest<HTMLElement>('[data-sell]');
    if (sb) {
      const id = sb.dataset.sell!;
      const n = Number(sb.dataset.n) || 1;
      return void act(
        () => ctx.api.sell(id, n),
        (r) => {
          sfx('nyangCoin');
          buzz([10, 30, 10]);
          toast(`${itemName(id)} ${n}개를 팔았어요 · 엽전 +${r.coins}`);
        },
      );
    }
    const ex = t.closest<HTMLElement>('[data-ex]');
    if (ex) {
      const id = ex.dataset.ex!;
      return void act(
        () => ctx.api.exchange(id),
        () => {
          sfx('nyangGift');
          buzz([10, 30, 10, 30, 10]);
          toast(`✨ ${josa(FURNITURE_NAME[id], '을', '를')} 받았어요! 꾸미기에서 방에 놓을 수 있어요`, 2800);
        },
      );
    }
    const tr = t.closest<HTMLElement>('[data-treat]');
    if (tr) {
      const kind = tr.dataset.treat as 'catgrass' | 'catnip';
      const c = ctx.cat(ctx.views[0].slot);
      const n = c.treatDay === kstDay(Math.floor(ctx.now())) ? c.treatN : 0;
      if (n >= CONST.treat_day_max) return toast('오늘은 풀을 그만 먹을래요 (하루 2번)');
      close();
      return ctx.giveTreat(kind);
    }
  });
}

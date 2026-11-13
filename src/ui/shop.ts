import { ITEMS, ITEM_IDS, ITEM_SLOTS, START_POINTS, type ItemId } from '../game/data';
import { sfx } from './sfx';

/** 아이템 상점: 내 포인트(기본 1,000)로 3칸까지, 판매(환불) 가능 */
export function renderShop(el: HTMLElement, mine: ItemId[], onChange: () => void, locked = false, budget = START_POINTS) {
  const spent = mine.reduce((s, i) => s + ITEMS[i].price, 0);
  const left = budget - spent;
  el.innerHTML = `
    <div class="points">남은 포인트 <b>${left.toLocaleString()}</b></div>
    <div class="shop">${ITEM_IDS.map((id) => {
      const it = ITEMS[id];
      const can = !locked && left >= it.price && mine.length < ITEM_SLOTS;
      return `<button class="shop-item" data-id="${id}" ${can ? '' : 'disabled'}>
        <span class="ic">${it.icon}</span><span class="nm">${it.name}</span><small>${it.desc}</small>
        <span class="price">${it.price}P</span><span class="dl">딜레이 +${it.delay}</span></button>`;
    }).join('')}</div>
    <div class="my-items"><span class="lbl">내 아이템</span>${Array.from({ length: ITEM_SLOTS }, (_, i) => {
      const id = mine[i];
      return id
        ? `<button class="my-slot" data-i="${i}" ${locked ? 'disabled' : ''} title="눌러서 판매(환불)"><span class="key">${'QWE'[i]}</span>${ITEMS[id].icon} ${ITEMS[id].name}<em>판매</em></button>`
        : `<div class="my-slot empty"><span class="key">${'QWE'[i]}</span>비어있음</div>`;
    }).join('')}</div>`;
  el.querySelectorAll<HTMLElement>('.shop-item').forEach((b) =>
    b.addEventListener('click', () => {
      mine.push(b.dataset.id as ItemId);
      sfx.click();
      onChange();
    }),
  );
  el.querySelectorAll<HTMLElement>('.my-slot[data-i]').forEach((b) =>
    b.addEventListener('click', () => {
      mine.splice(Number(b.dataset.i), 1);
      sfx.click();
      onChange();
    }),
  );
}

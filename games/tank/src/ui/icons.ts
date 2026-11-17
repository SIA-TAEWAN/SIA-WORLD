/** SpriteCook으로 그린 아이콘 (public/icons): 아이템 4종 · 특수 벽 4종 · 상자 · 낙하산 · 비행기 · 바람 */
export type IconId = 'double' | 'power' | 'repair' | 'teleport' | 'amp' | 'whirl' | 'x2' | 'x3' | 'crate' | 'chute' | 'plane' | 'wind';
export const ICON_IDS: IconId[] = ['double', 'power', 'repair', 'teleport', 'amp', 'whirl', 'x2', 'x3', 'crate', 'chute', 'plane', 'wind'];
export const iconUrl = (id: IconId | string) => `${import.meta.env.BASE_URL}icons/${id}.png`;
/** 맵 배경 그림 (public/bg): 큰 그림과 썸네일 */
export const mapBgUrl = (mapId: string, small = false) => `${import.meta.env.BASE_URL}bg/${mapId}${small ? '-s' : ''}.jpg`;

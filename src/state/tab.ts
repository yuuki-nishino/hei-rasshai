// イベントの中のタブ（screens.md §1.3）。localStorage の hei:tab に保存し、起動時に復元する
import { signal } from '@preact/signals';
import { readStorage, writeStorage } from './storage';

export type TabId = 'order' | 'kitchen' | 'menu' | 'event';
const TAB_IDS: readonly TabId[] = ['order', 'kitchen', 'menu', 'event'];
const KEY = 'hei:tab';

const saved = readStorage(KEY);
export const currentTab = signal<TabId>(TAB_IDS.includes(saved as TabId) ? (saved as TabId) : 'order');

export function selectTab(tab: TabId): void {
  currentTab.value = tab;
  writeStorage(KEY, tab);
}

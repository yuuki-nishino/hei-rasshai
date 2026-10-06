// タブ（screens.md §1.2、visual.md §3）。左右の矢印キーでも移れる。
// 中身の要素には role="tabpanel"・id={panelId}・aria-labelledby={tabId(selected)} を付ける（WAI-ARIA の Tabs。PR #36 のレビュー M6）
import type { TargetedKeyboardEvent } from 'preact';
import { blurActiveInput } from './blurActiveInput';
import styles from './Tabs.module.css';

type Props<T extends string> = {
  /** badge：件数の印（LINE の通知のような、赤い丸に白い数字）。0・未指定なら出さない */
  tabs: readonly { id: T; label: string; badge?: number }[];
  selected: T;
  onSelect: (id: T) => void;
  label: string;
  /** 中身の要素の id */
  panelId: string;
};

export const tabId = (id: string) => `tab-${id}`;

export function Tabs<T extends string>({ tabs, selected, onSelect, label, panelId }: Props<T>) {
  // 切り替える前に、入力中の欄を確定させる（iOS は、ボタンを押してもフォーカスを移さないため。レビュー M3）
  const select = (id: T) => {
    blurActiveInput();
    onSelect(id);
  };
  function onKeyDown(e: TargetedKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.id === selected);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    select(next.id);
    e.currentTarget.querySelector<HTMLButtonElement>(`#${tabId(next.id)}`)?.focus();
  }
  return (
    <div class={styles.tabs} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={tabId(t.id)}
          class={styles.tab}
          aria-selected={t.id === selected}
          aria-controls={panelId}
          aria-label={t.badge ? `${t.label} ${t.badge}件` : undefined}
          tabIndex={t.id === selected ? 0 : -1}
          onClick={() => select(t.id)}
        >
          {t.label}
          {t.badge ? (
            <span class={styles.badge} aria-hidden="true">
              {t.badge > 99 ? '99+' : t.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

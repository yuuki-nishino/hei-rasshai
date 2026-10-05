// タブ（screens.md §1.2）。左右の矢印キーでも移れる
import type { TargetedKeyboardEvent } from 'preact';
import styles from './Tabs.module.css';

type Props<T extends string> = {
  tabs: readonly { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
  label: string;
};

export function Tabs<T extends string>({ tabs, selected, onSelect, label }: Props<T>) {
  function onKeyDown(e: TargetedKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.id === selected);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    onSelect(next.id);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  }
  return (
    <div class={styles.tabs} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          class={styles.tab}
          aria-selected={t.id === selected}
          tabIndex={t.id === selected ? 0 : -1}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

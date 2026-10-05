// 画面の上の帯（のれん。visual.md §3）。イベント名などの見出しと、右端の操作
import type { ComponentChildren } from 'preact';
import styles from './Noren.module.css';

type Props = {
  title: string;
  sub?: string;
  /** 右端に置く操作（メニューなど） */
  actions?: ComponentChildren;
};

export function Noren({ title, sub, actions }: Props) {
  return (
    <header class={styles.noren}>
      <div class={styles.inner}>
        <div class={styles.text}>
          <h1 class={styles.title}>{title}</h1>
          {sub && <p class={styles.sub}>{sub}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}

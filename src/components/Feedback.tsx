// 読み込み中・0件・取得失敗の表示（screens.md §2）
import type { ComponentChildren } from 'preact';
import styles from './Feedback.module.css';

export function Loading({ label = '読み込み中…' }: { label?: string }) {
  return (
    <div class={styles.box} role="status" aria-busy="true">
      <div class={styles.spinner} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

/** 0件のとき。children に、最初の1件を作る操作などを置く */
export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class={styles.box}>
      <p class={styles.title}>{title}</p>
      {children}
    </div>
  );
}

/** 取得に失敗したとき。children に「もう一度」などの操作を置く */
export function ErrorView({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class={`${styles.box} ${styles.error}`} role="alert">
      <p class={styles.title}>{title}</p>
      {children}
    </div>
  );
}

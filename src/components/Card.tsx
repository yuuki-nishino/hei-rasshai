// カード（visual.md §3）。注文・メニューなど、1件ずつのまとまり
import type { ComponentChildren } from 'preact';
import styles from './Card.module.css';

export function Card({ muted = false, children }: { muted?: boolean; children: ComponentChildren }) {
  return <div class={`${styles.card} ${muted ? styles.muted : ''}`}>{children}</div>;
}

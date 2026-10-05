// ロゴ：イベント注文アプリ「毎度おおきに」（visual.md §4）
import styles from './Logo.module.css';

export function Logo() {
  return (
    <div class={styles.logo}>
      <p class={styles.kind}>イベント注文アプリ</p>
      <h1 class={styles.name}>毎度おおきに</h1>
    </div>
  );
}

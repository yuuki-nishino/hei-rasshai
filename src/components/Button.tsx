// ボタン（visual.md §3）。44px 以上。手書きの文字
import type { ButtonHTMLAttributes } from 'preact';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'danger' | 'dangerSolid';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'className'> & {
  variant?: Variant;
  /** 大きいボタン（56px）。注文の確定など */
  big?: boolean;
  /** 横幅いっぱい */
  block?: boolean;
};

export function Button({ variant = 'secondary', big = false, block = false, type = 'button', ...rest }: Props) {
  const cls = [styles.button, styles[variant], big && styles.big, block && styles.block].filter(Boolean).join(' ');
  return <button type={type} class={cls} {...rest} />;
}

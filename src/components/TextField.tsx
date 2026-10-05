// 入力欄（visual.md §3）。ラベル・補足・エラーを、入力欄に結び付ける。
// 数字は、type="number" ではなく inputMode="numeric" で（桁区切りや先頭の0を、こちらで扱える）
import type { PartialInputHTMLAttributes } from 'preact';
import { useId } from 'preact/hooks';
import styles from './TextField.module.css';

type Props = Pick<
  PartialInputHTMLAttributes<HTMLInputElement>,
  'name' | 'value' | 'placeholder' | 'inputMode' | 'autoComplete' | 'maxLength' | 'required' | 'disabled' | 'onInput' | 'onChange' | 'onBlur'
> & {
  label: string;
  hint?: string;
  error?: string | null;
};

export function TextField({ label, hint, error, ...rest }: Props) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div class={styles.field}>
      <label class={styles.label} for={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        class={`${styles.input} ${error ? styles.invalid : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint && (
        <p id={`${id}-hint`} class={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} class={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

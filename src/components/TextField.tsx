// 入力欄（visual.md §3）。ラベル・補足・エラーを、入力欄に結び付ける。
// 数字は、type="number" ではなく inputMode="numeric" で（桁区切りや先頭の0を、こちらで扱える）。
// 日付は kind="date"（端末の日付の選択。値は 'YYYY-MM-DD'）
import type { PartialInputHTMLAttributes } from 'preact';
import { useId } from 'preact/hooks';
import styles from './TextField.module.css';

type Props = Pick<
  PartialInputHTMLAttributes<HTMLInputElement>,
  'name' | 'value' | 'placeholder' | 'inputMode' | 'autoComplete' | 'maxLength' | 'required' | 'disabled' | 'onInput' | 'onChange' | 'onBlur'
> & {
  kind?: 'text' | 'date';
  label: string;
  hint?: string;
  error?: string | null;
};

export function TextField({ kind = 'text', label, hint, error, ...rest }: Props) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    class: `${styles.input} ${kind === 'date' ? styles.date : ''} ${error ? styles.invalid : ''}`,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };
  return (
    <div class={styles.field}>
      <label class={styles.label} for={id}>
        {label}
      </label>
      {/* type ごとに型が分かれている（Preact 11）ため、分けて書く */}
      {kind === 'date' ? <input type="date" {...common} {...rest} /> : <input type="text" {...common} {...rest} />}
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

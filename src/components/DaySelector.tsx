// 日付の切り替え（前日・翌日・日付の入力・今日）。売上・レジ締めで使う。初期値は今日。イベントの期間外でも選べる
import type { TargetedEvent } from 'preact';
import { addDays, formatDay, isValidDay, toDay } from '../lib/domain/day';
import { Button } from './Button';
import { TextField } from './TextField';
import styles from './DaySelector.module.css';

export function DaySelector({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  return (
    <div class={styles.day}>
      <button type="button" class={styles.step} onClick={() => onChange(addDays(day, -1))} aria-label="前の日">
        ← 前日
      </button>
      <TextField
        kind="date"
        label={formatDay(day, { year: true })}
        value={day}
        onInput={(e: TargetedEvent<HTMLInputElement>) => isValidDay(e.currentTarget.value) && onChange(e.currentTarget.value)}
      />
      <button type="button" class={styles.step} onClick={() => onChange(addDays(day, 1))} aria-label="次の日">
        翌日 →
      </button>
      {day !== toDay() && (
        <span class={styles.today}>
          <Button variant="secondary" onClick={() => onChange(toDay())}>
            今日に戻す
          </Button>
        </span>
      )}
    </div>
  );
}

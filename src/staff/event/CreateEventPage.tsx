// イベントの作成（screens.md §3.2）。オンライン必須（data-access.md §3.9）。作成したら、そのイベントを選ぶ
import type { TargetedEvent } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { Noren } from '../../components/Noren';
import { TextField } from '../../components/TextField';
import { AppError } from '../../lib/data/errors';
import { createEvent } from '../../lib/data/events';
import { toDay } from '../../lib/domain/day';
import { EVENT_NAME_MAX, validateEventForm, type EventForm, type EventFormErrors } from '../../lib/domain/event';
import { currentUser } from '../../state/auth';
import { selectEvent } from '../../state/event';
import { browserOnline } from '../../state/online';
import styles from './CreateEventPage.module.css';

function messageOf(e: unknown): string {
  if (e instanceof AppError && e.code === 'permission') return 'イベントの作成は、許可されたアカウントのみです';
  if (e instanceof AppError && e.code === 'offline') return '通信が必要です。電波を確認してから、もう一度押してください';
  return 'イベントを作成できませんでした。時間をおいて、もう一度押してください';
}

export function CreateEventPage({ onBack }: { onBack: () => void }) {
  const today = toDay();
  const [form, setForm] = useState<EventForm>({ name: '', startDate: today, endDate: today, floatCash: '' });
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const field = (key: keyof EventForm) => ({
    value: form[key],
    error: errors[key],
    onInput: (e: TargetedEvent<HTMLInputElement>) => {
      const value = e.currentTarget.value;
      setForm((f) => {
        const next = { ...f, [key]: value };
        // 開始日を終了日より後にしたら、終了日を合わせる（1日だけのイベントが多いため）
        if (key === 'startDate' && next.endDate < value) next.endDate = value;
        return next;
      });
      setErrors((er) => ({ ...er, [key]: undefined }));
    },
  });

  async function submit(e: Event) {
    e.preventDefault();
    const user = currentUser.value;
    const result = validateEventForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (!user) return;
    setSaving(true);
    setSubmitError(null);
    try {
      selectEvent(await createEvent(result.value, user));
    } catch (err) {
      console.error(err);
      setSubmitError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <>
      <Noren
        title="イベントを作成"
        actions={
          <Button variant="secondary" onClick={onBack} disabled={saving}>
            戻る
          </Button>
        }
      />
      <form class={styles.form} onSubmit={submit} noValidate>
        <TextField label="イベント名" placeholder="例：夏まつり 焼きそば屋" hint={`${EVENT_NAME_MAX}文字まで`} {...field('name')} />
        <div class={styles.dates}>
          <TextField kind="date" label="開始日" {...field('startDate')} />
          <TextField kind="date" label="終了日" {...field('endDate')} />
        </div>
        <TextField
          label="釣り銭の準備金（円）"
          inputMode="numeric"
          placeholder="例：10000"
          hint="レジ締めで使います。空なら0円。あとから変えられます"
          {...field('floatCash')}
        />
        {submitError && (
          <p class={styles.error} role="alert">
            {submitError}
          </p>
        )}
        <Button type="submit" variant="primary" big block disabled={saving || !browserOnline.value}>
          {saving ? '作成中…' : '作成する'}
        </Button>
      </form>
    </>
  );
}

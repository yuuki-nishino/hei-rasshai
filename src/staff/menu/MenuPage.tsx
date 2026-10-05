// メニュー（screens.md §3.8）。追加・名前と価格のインライン編集・▲▼の並べ替え・売り切れ・削除。
// 書き込みは待たずに進める（オフラインでも受け付ける。data-access.md §3.9）。拒否されたときだけ知らせる
import type { TargetedEvent, TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Empty, ErrorView, Loading } from '../../components/Feedback';
import { TextField } from '../../components/TextField';
import { AppError } from '../../lib/data/errors';
import { addMenuItem, deleteMenuItem, moveMenuItem, updateMenuItem, watchMenu } from '../../lib/data/menu';
import type { MenuItem } from '../../lib/data/types';
import { MENU_MAX, MENU_NAME_ERROR, MENU_NAME_MAX, parseMenuName, parsePrice, PRICE_ERROR } from '../../lib/domain/menu';
import { selectEvent } from '../../state/event';
import styles from './MenuPage.module.css';

function messageOf(e: unknown): string {
  if (e instanceof AppError && e.code === 'validation') return e.message;
  if (e instanceof AppError && e.code === 'permission') return 'メニューを変更できませんでした。イベントのメンバーでなくなった可能性があります';
  return 'メニューを保存できませんでした。画面の内容を確かめてください';
}

export function MenuPage({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);

  useEffect(
    () =>
      watchMenu(eventId, setItems, (e) => {
        if (e.code === 'permission') selectEvent(null); // 外された（data-access.md §5）
        else setLoadError('メニューを読み込めませんでした');
      }),
    [eventId],
  );

  /** 書き込みを待たずに進め、拒否されたら知らせる */
  const send = (p: Promise<void>) => {
    setError(null);
    p.catch((e: unknown) => {
      console.error(e);
      setError(messageOf(e));
    });
  };

  if (loadError) return <ErrorView title={loadError} />;
  if (!items) return <Loading label="メニューを読み込み中…" />;

  return (
    <section class={styles.page} aria-labelledby="menu-title">
      <div class={styles.head}>
        <h2 id="menu-title" class={styles.h2}>
          メニュー
        </h2>
        <span class={styles.count}>
          {items.length} / {MENU_MAX}件
        </span>
      </div>

      <AddForm items={items} onAdd={(input) => send(addMenuItem(eventId, input, items))} />

      {error && (
        <p class={styles.error} role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <Empty title="メニューがありません">
          <p>上の欄から、品名と価格を追加してください</p>
        </Empty>
      ) : (
        <ul class={styles.list}>
          {items.map((item, i) => (
            <MenuRow
              key={item.id}
              item={item}
              first={i === 0}
              last={i === items.length - 1}
              onUpdate={(patch) => send(updateMenuItem(eventId, item.id, patch))}
              onMove={(dir) => send(moveMenuItem(eventId, item.id, dir, items))}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`「${deleting?.name ?? ''}」を削除しますか？`}
        confirmLabel="削除する"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) send(deleteMenuItem(eventId, deleting.id));
          setDeleting(null);
        }}
      >
        これまでの注文と売上には、影響しません。
      </ConfirmDialog>
    </section>
  );
}

function AddForm({ items, onAdd }: { items: MenuItem[]; onAdd: (input: { name: string; price: number }) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<{ name?: string; price?: string }>({});
  const nameRef = useRef<HTMLDivElement>(null);
  const full = items.length >= MENU_MAX;

  function submit(e: Event) {
    e.preventDefault();
    const n = parseMenuName(name);
    const p = parsePrice(price);
    if (n === null || p === null) {
      setErrors({ name: n === null ? MENU_NAME_ERROR : undefined, price: p === null ? PRICE_ERROR : undefined });
      return;
    }
    onAdd({ name: n, price: p });
    setName('');
    setPrice('');
    setErrors({});
    // 続けて入力できるよう、名前へ戻る
    nameRef.current?.querySelector('input')?.focus();
  }

  return (
    <form class={styles.add} onSubmit={submit} noValidate>
      <div ref={nameRef}>
        <TextField
          label="品名"
          placeholder="例：焼きそば"
          hint={`${MENU_NAME_MAX}文字まで`}
          value={name}
          error={errors.name}
          onInput={(e: TargetedEvent<HTMLInputElement>) => setName(e.currentTarget.value)}
        />
      </div>
      <TextField
        label="価格（円）"
        inputMode="numeric"
        placeholder="500"
        value={price}
        error={errors.price}
        onInput={(e: TargetedEvent<HTMLInputElement>) => setPrice(e.currentTarget.value)}
      />
      <div class={styles.addButton}>
        <Button type="submit" variant="primary" block disabled={full}>
          {full ? `メニューは${MENU_MAX}件までです` : '追加'}
        </Button>
      </div>
    </form>
  );
}

type RowProps = {
  item: MenuItem;
  first: boolean;
  last: boolean;
  onUpdate: (patch: Partial<Pick<MenuItem, 'name' | 'price' | 'soldOut'>>) => void;
  onMove: (dir: 'up' | 'down') => void;
  onDelete: () => void;
};

function MenuRow({ item, first, last, onUpdate, onMove, onDelete }: RowProps) {
  // 入力中の値。フォーカスが外れたときに保存する。ほかのメンバーの変更は、編集中でなければ反映する
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [editing, setEditing] = useState<'name' | 'price' | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    if (editing !== 'name') setName(item.name);
    if (editing !== 'price') setPrice(String(item.price));
  }, [item.name, item.price, editing]);

  function commitName() {
    setEditing(null);
    const n = parseMenuName(name);
    if (n === null) {
      setName(item.name); // 不正な値は、元に戻して知らせる
      setRowError(MENU_NAME_ERROR);
      return;
    }
    setRowError(null);
    setName(n);
    if (n !== item.name) onUpdate({ name: n });
  }

  function commitPrice() {
    setEditing(null);
    const p = parsePrice(price);
    if (p === null) {
      setPrice(String(item.price));
      setRowError(PRICE_ERROR);
      return;
    }
    setRowError(null);
    setPrice(String(p));
    if (p !== item.price) onUpdate({ price: p });
  }

  // Enter で確定（フォーカスを外す → blur で保存）
  const blurOnEnter = (e: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <li class={`${styles.item} ${item.soldOut ? styles.soldOutItem : ''}`}>
      <input
        class={`${styles.input} ${styles.name}`}
        aria-label="品名"
        value={name}
        maxLength={MENU_NAME_MAX * 2}
        onFocus={() => setEditing('name')}
        onInput={(e) => setName(e.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={blurOnEnter}
      />
      <div class={styles.priceWrap}>
        <input
          class={`${styles.input} ${styles.price}`}
          aria-label={`${item.name}の価格（円）`}
          inputMode="numeric"
          value={price}
          onFocus={() => setEditing('price')}
          onInput={(e) => setPrice(e.currentTarget.value)}
          onBlur={commitPrice}
          onKeyDown={blurOnEnter}
        />
        <span class={styles.yen}>円</span>
      </div>
      <div class={styles.controls}>
        <button type="button" class={styles.move} aria-label={`${item.name}を上へ`} disabled={first} onClick={() => onMove('up')}>
          ▲
        </button>
        <button type="button" class={styles.move} aria-label={`${item.name}を下へ`} disabled={last} onClick={() => onMove('down')}>
          ▼
        </button>
        <button type="button" class={styles.toggle} aria-label={`${item.name}を売り切れにする`} aria-pressed={item.soldOut} onClick={() => onUpdate({ soldOut: !item.soldOut })}>
          {item.soldOut ? '売り切れ' : '販売中'}
        </button>
        <span class={styles.spacer} />
        <Button variant="danger" onClick={onDelete}>
          削除
        </Button>
      </div>
      {rowError && (
        <p class={styles.rowError} role="alert">
          {rowError}
        </p>
      )}
    </li>
  );
}

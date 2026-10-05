// メニューのまとめて追加（screens.md §3.8、data-model.md §5.6）。
// テキスト → 「確認」でプレビュー（parseBulkMenu）→ エラーが無ければ「n件を追加」。
// プレビューの後に文章を直したら、もう一度「確認」が要る（確かめていない内容を追加しない）
import { useId, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import type { MenuItem } from '../../lib/data/types';
import { MENU_MAX, parseBulkMenu, type BulkMenuResult } from '../../lib/domain/menu';
import styles from './BulkAdd.module.css';

type Props = {
  items: readonly MenuItem[];
  /** 追加する（書き込みは待たない。拒否は、呼んだ側が知らせる） */
  onAdd: (lines: BulkMenuResult['ok']) => void;
  onClose: () => void;
};

export function BulkAdd({ items, onAdd, onClose }: Props) {
  const id = useId();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<BulkMenuResult | null>(null);
  const room = MENU_MAX - items.length;

  const over = preview !== null && preview.ok.length > room;
  const canAdd = preview !== null && preview.errors.length === 0 && preview.ok.length > 0 && !over;

  // 行番号の順に、正しい行とエラー行を並べる
  const rows = preview
    ? [
        ...preview.ok.map((l) => ({ line: l.line, ok: true as const, name: l.name, price: l.price })),
        ...preview.errors.map((e) => ({ line: e.line, ok: false as const, text: e.text, reason: e.reason })),
      ].sort((a, b) => a.line - b.line)
    : [];

  return (
    <section class={styles.panel} aria-labelledby={`${id}-label`}>
      <label id={`${id}-label`} class={styles.label} for={`${id}-text`}>
        まとめて追加（1行に「品名 価格」）
      </label>
      <p id={`${id}-hint`} class={styles.hint}>
        {'例：「たこ焼き 500」「ラムネ,200」「焼きそば\u3000600円」。表計算ソフトから、2列をそのまま貼り付けても使えます'}
      </p>
      <textarea
        id={`${id}-text`}
        class={styles.textarea}
        aria-describedby={`${id}-hint`}
        value={text}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setPreview(null); // 直したら、確認し直す
        }}
      />
      <div class={styles.actions}>
        <Button variant="secondary" disabled={text.trim() === ''} onClick={() => setPreview(parseBulkMenu(text))}>
          確認
        </Button>
        <Button variant="secondary" onClick={onClose}>
          閉じる
        </Button>
      </div>

      {preview && (
        <>
          <p class={styles.summary} role="status">
            {preview.errors.length > 0
              ? `${preview.errors.length}行にエラーがあります。直してから、もう一度「確認」を押してください`
              : preview.ok.length === 0
                ? '追加する行がありません'
                : `${preview.ok.length}件を追加します。品名と価格を確かめてください`}
          </p>
          {over && (
            <p class={styles.error} role="alert">
              メニューは{MENU_MAX}件までです（いま{items.length}件。追加できるのは、あと{Math.max(0, room)}件）
            </p>
          )}
          <ul class={styles.preview} aria-label="追加する内容">
            {rows.map((r) =>
              r.ok ? (
                <li key={r.line} class={styles.row}>
                  <span class={styles.lineNo}>{r.line}行</span>
                  <span class={styles.name}>{r.name}</span>
                  <span class={styles.price}>{r.price.toLocaleString('ja-JP')}円</span>
                </li>
              ) : (
                <li key={r.line} class={`${styles.row} ${styles.errorRow}`}>
                  <span class={styles.lineNo}>{r.line}行</span>
                  <span class={styles.name}>{r.text}</span>
                  <span />
                  <span class={styles.reason}>{r.reason}</span>
                </li>
              ),
            )}
          </ul>
          <Button
            variant="primary"
            block
            disabled={!canAdd}
            onClick={() => {
              onAdd(preview.ok);
              setText('');
              setPreview(null);
              onClose();
            }}
          >
            {canAdd ? `${preview.ok.length}件を追加` : '追加できません'}
          </Button>
        </>
      )}
    </section>
  );
}

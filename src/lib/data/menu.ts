// メニュー（data-access.md §3.4）
// メニューの書き込みは、オンライン必須ではない（§3.9）。オフラインでも受け付け、つながったときに送られる。
// 返す Promise は、サーバーが受け取ったときに終わる。画面は待たずに進め、拒否されたときだけ知らせる（catch）
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  MENU_MAX,
  MENU_NAME_ERROR,
  nextMenuOrder,
  parseMenuName,
  PRICE_ERROR,
  PRICE_MAX,
  PRICE_MIN,
  reorderMenu,
  sortMenu,
} from '../domain/menu';
import { db } from '../firebase/staff';
import { AppError, toAppError } from './errors';
import type { MenuItem, Unsubscribe } from './types';

const menuCol = (eventId: string) => collection(db, 'events', eventId, 'menu');

/** メニューの購読（order の昇順、同じ値なら id の順） */
export function watchMenu(eventId: string, cb: (items: MenuItem[]) => void, onError: (e: AppError) => void): Unsubscribe {
  return onSnapshot(
    menuCol(eventId),
    (snap) =>
      cb(
        sortMenu(
          snap.docs.map((d) => ({
            id: d.id,
            name: String(d.get('name') ?? ''),
            price: Number(d.get('price') ?? 0),
            order: Number(d.get('order') ?? 0),
            soldOut: d.get('soldOut') === true,
          })),
        ),
      ),
    (e) => onError(toAppError(e)),
  );
}

async function write(p: Promise<void>): Promise<void> {
  try {
    await p;
  } catch (e) {
    throw toAppError(e);
  }
}

function validationError(message: string): AppError {
  return Object.assign(new AppError('validation'), { message });
}

/** 名前・価格の検査（ルールの validMenu と同じ条件）。正しければ null */
function checkPatch(patch: { name?: string; price?: number }): AppError | null {
  if (patch.name !== undefined && parseMenuName(patch.name) !== patch.name) return validationError(MENU_NAME_ERROR);
  if (patch.price !== undefined && !(Number.isInteger(patch.price) && patch.price >= PRICE_MIN && patch.price <= PRICE_MAX)) {
    return validationError(PRICE_ERROR);
  }
  return null;
}

/**
 * 追加（order = 最大 + 10）。名前・価格も、ここで検査する（オフラインで不正な値を足すと、つながるまで一覧に出てしまうため）。
 * 100件を超えるなら AppError('validation')。件数は、この端末が見ている一覧で数える（ルールでは数えられない。data-model.md §2.5）
 */
export function addMenuItem(eventId: string, input: { name: string; price: number }, items: readonly MenuItem[]): Promise<void> {
  if (items.length >= MENU_MAX) return Promise.reject(validationError(`メニューは${MENU_MAX}件までです`));
  const invalid = checkPatch(input);
  if (invalid) return Promise.reject(invalid);
  const ref = doc(menuCol(eventId));
  return write(setDoc(ref, { name: input.name, price: input.price, order: nextMenuOrder(items), soldOut: false }));
}

/** 名前・価格・売り切れの更新。検査してから書く */
export function updateMenuItem(eventId: string, id: string, patch: Partial<Pick<MenuItem, 'name' | 'price' | 'soldOut'>>): Promise<void> {
  const invalid = checkPatch(patch);
  if (invalid) return Promise.reject(invalid);
  return write(updateDoc(doc(menuCol(eventId), id), patch));
}

/** 上・下へ1つ動かし、全件の order を振り直す（変わる品だけを、1バッチで） */
export function moveMenuItem(eventId: string, id: string, dir: 'up' | 'down', items: readonly MenuItem[]): Promise<void> {
  const changes = reorderMenu(items, id, dir);
  if (changes.length === 0) return Promise.resolve();
  const batch = writeBatch(db);
  for (const c of changes) batch.update(doc(menuCol(eventId), c.id), { order: c.order });
  return write(batch.commit());
}

/** 削除。過去の注文は、名前・価格を書き写してあるため、影響しない */
export function deleteMenuItem(eventId: string, id: string): Promise<void> {
  return write(deleteDoc(doc(menuCol(eventId), id)));
}

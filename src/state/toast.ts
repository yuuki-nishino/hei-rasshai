// 画面の下に出す通知（screens.md §2）。成功は数秒で消し、失敗は閉じるまで残す
import { signal } from '@preact/signals';
import type { ToastKind } from '../components/Toast';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export const toasts = signal<ToastItem[]>([]);

let seq = 0;
const SUCCESS_MS = 3000;
const MAX = 4; // 溜まりすぎないよう、古いものから消す

export function showToast(kind: ToastKind, message: string): void {
  const id = ++seq;
  toasts.value = [...toasts.value, { id, kind, message }].slice(-MAX);
  if (kind === 'success') setTimeout(() => dismissToast(id), SUCCESS_MS);
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

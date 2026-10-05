// 入力中の欄からフォーカスを外し、blur での保存を先に済ませる。
// iOS の Safari は、ボタンを押してもフォーカスを移さないため、画面を切り替える前に呼ぶ（PR #36 のレビュー M3）
export function blurActiveInput(): void {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();
}

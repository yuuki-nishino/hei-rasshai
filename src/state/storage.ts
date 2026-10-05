// localStorage の読み書き（screens.md §1.3）。使えない環境（プライベートブラウズなど）でも、例外を出さない
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 保存できなくても、画面はそのまま動かす（再読み込みで、選択が戻らないだけ）
  }
}

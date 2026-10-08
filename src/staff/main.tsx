import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import { checkPendingAfterReload } from '../lib/data/writes';
import { clearCacheOnStart } from '../state/cacheClear';
import { App } from './App';

// 手書きの文字（スタッフ画面だけ）。定義が大きい（gzip後 約65KB）ため、最初の表示を止めないよう、後から読み込む。
// 読み込むまでは端末の文字で表示し、届いたら切り替わる（visual.md §2）
void import('@fontsource/zen-kurenaido/400.css');

const root = document.getElementById('app')!;

// 部品の見本（/#catalog）。本番のビルドには含めない（dev で実機の見た目を確かめるため。visual.md §5）
if (import.meta.env.MODE !== 'production' && location.hash === '#catalog') {
  void import('./catalog/Catalog').then(({ Catalog }) => render(<Catalog />, root));
} else {
  // ログアウトで消せなかったキャッシュは、画面を出す前に消す（再読み込みする）。持ち越した消去も試す（data-access.md §8）
  void clearCacheOnStart().then(() => {
    render(<App />, root);
    void checkPendingAfterReload(); // 再読み込みの前の未送信が残っていれば、「未送信あり」を出す（data-access.md §6.2）
  });
}

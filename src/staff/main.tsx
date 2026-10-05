import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import { App } from './App';

// 手書きの文字（スタッフ画面だけ）。定義が大きい（gzip後 約65KB）ため、最初の表示を止めないよう、後から読み込む。
// 読み込むまでは端末の文字で表示し、届いたら切り替わる（visual.md §2）
void import('@fontsource/zen-kurenaido/400.css');

const root = document.getElementById('app')!;

// 部品の見本（/#catalog）。本番のビルドには含めない（dev で実機の見た目を確かめるため。visual.md §5）
if (import.meta.env.MODE !== 'production' && location.hash === '#catalog') {
  void import('./catalog/Catalog').then(({ Catalog }) => render(<Catalog />, root));
} else {
  render(<App />, root);
}

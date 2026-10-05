// お客様画面（/s?e=&o=）。Auth・Service Worker・永続キャッシュを使わない（DESIGN.md §4）
import { Empty } from '../components/Feedback';
import { Noren } from '../components/Noren';

export function CustomerApp() {
  return (
    <>
      <Noren title="ご注文の状況" />
      <main>
        <Empty title="準備中" />
      </main>
    </>
  );
}

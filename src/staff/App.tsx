// スタッフ画面のルート。EventGate・Shell は、後のIssueで足す（screens.md §1.2）
import { signOut } from '../lib/data/auth';
import { currentUser } from '../state/auth';
import { AuthGate } from './auth/AuthGate';

function Home() {
  return (
    <main>
      <h1>毎度おおきに</h1>
      <p>{currentUser.value?.email} でログイン中</p>
      <p>イベント一覧（準備中）</p>
      <button type="button" onClick={() => void signOut()}>
        ログアウト
      </button>
    </main>
  );
}

export function App() {
  return (
    <AuthGate>
      <Home />
    </AuthGate>
  );
}

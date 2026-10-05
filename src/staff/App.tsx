// スタッフ画面のルート。EventGate・Shell は、後のIssueで足す（screens.md §1.2）
import { Button } from '../components/Button';
import { Empty } from '../components/Feedback';
import { Noren } from '../components/Noren';
import { signOut } from '../lib/data/auth';
import { currentUser } from '../state/auth';
import { AuthGate } from './auth/AuthGate';

function Home() {
  return (
    <>
      <Noren title="毎度おおきに" sub={`${currentUser.value?.email ?? ''} でログイン中`} />
      <main>
        <Empty title="イベント一覧（準備中）">
          <Button variant="secondary" onClick={() => void signOut()}>
            ログアウト
          </Button>
        </Empty>
      </main>
    </>
  );
}

export function App() {
  return (
    <AuthGate>
      <Home />
    </AuthGate>
  );
}

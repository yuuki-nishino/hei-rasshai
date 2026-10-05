// ログイン画面（screens.md §3.1）
import { useState } from 'preact/hooks';
import { AppError } from '../../lib/data/errors';
import { signInWithGoogle } from '../../lib/data/auth';

function messageOf(e: unknown): string {
  if (e instanceof AppError && e.code === 'offline') return '通信できません。電波を確認してください';
  if (e instanceof AppError && e.code === 'popup-blocked') {
    return 'ログインの画面が、ブラウザに止められました。ポップアップを許可してから、もう一度押してください';
  }
  return 'ログインできませんでした';
}

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  // ボタンは、ログイン中も押せるままにする。ポップアップを閉じたことを SDK が検知するまで、数秒かかるため
  // （iPhone で約3秒。#5）。押し直すと、前のポップアップは取り消され（'cancelled'。何も出さない）、新しく開く
  async function login() {
    setError(null);
    try {
      await signInWithGoogle(); // 成功すると、AuthGate が次の画面に切り替える。閉じたときは何も出さない
    } catch (e) {
      console.error(e);
      setError(messageOf(e));
    }
  }

  return (
    <main>
      <h1>毎度おおきに</h1>
      <p>イベントの注文受付・呼び出し・売上管理</p>
      <button type="button" onClick={login}>
        Googleでログイン
      </button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

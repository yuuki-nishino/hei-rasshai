// 認証の状態（screens.md §1.3）。undefined＝確認中（起動直後）、null＝未ログイン
import { signal } from '@preact/signals';
import { onAuthChange, type AuthUser } from '../lib/data/auth';

export const currentUser = signal<AuthUser | null | undefined>(undefined);

onAuthChange((user) => {
  currentUser.value = user;
});

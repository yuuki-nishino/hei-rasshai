// 招待（security-rules.md §4、ADR-0003）
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 有効期限：発行（createdAt）から1日。ルールと同じ

/** 招待のメールアドレス：前後の空白を除き、小文字にする。形がおかしければ null（ルール：^[^@]+@[^@]+$） */
export function normalizeInviteEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** 期限。createdAt が null（書き込み直後で、サーバーの時刻が未確定）なら null */
export function inviteExpiresAt(createdAt: Date | null): Date | null {
  return createdAt && new Date(createdAt.getTime() + INVITE_TTL_MS);
}

/** 招待のリンク（screens.md §1.1） */
export function joinUrl(origin: string, eventId: string): string {
  return `${origin}/join?e=${encodeURIComponent(eventId)}`;
}

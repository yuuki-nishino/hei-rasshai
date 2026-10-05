import { describe, expect, it } from 'vitest';
import { inviteExpiresAt, joinUrl, normalizeInviteEmail } from '../../src/lib/domain';

describe('normalizeInviteEmail', () => {
  it('前後の空白を除き、小文字にする', () => {
    expect(normalizeInviteEmail('  Taro.Yamada@Gmail.com ')).toBe('taro.yamada@gmail.com');
  });
  it.each(['', 'taro', 'taro@', '@gmail.com', 'ta ro@gmail.com', 'a@b@c.com', 'taro@gmail'])('%s は拒否', (s) => {
    expect(normalizeInviteEmail(s)).toBeNull();
  });
});

describe('inviteExpiresAt / joinUrl', () => {
  it('期限は、発行の1日後。発行時刻が未確定なら null', () => {
    expect(inviteExpiresAt(new Date('2026-08-01T10:00:00Z'))).toEqual(new Date('2026-08-02T10:00:00Z'));
    expect(inviteExpiresAt(null)).toBeNull();
  });
  it('招待のリンク', () => {
    expect(joinUrl('https://maido-ookini-dev.web.app', 'abc')).toBe('https://maido-ookini-dev.web.app/join?e=abc');
  });
});

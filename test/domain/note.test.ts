import { describe, expect, it } from 'vitest';
import { normalizeNote, NOTE_MAX } from '../../src/lib/domain';

describe('normalizeNote', () => {
  it('前後の空白を除く。空は空（メモなし）', () => {
    expect(normalizeNote('  辛さ抜き ')).toBe('辛さ抜き');
    expect(normalizeNote('')).toBe('');
    expect(normalizeNote('   ')).toBe('');
  });

  it('改行は空白にする（貼り付けた複数行も、1行になる）', () => {
    expect(normalizeNote('辛さ抜き\nネギ抜き')).toBe('辛さ抜き ネギ抜き');
    expect(normalizeNote('a\r\n\r\nb')).toBe('a b');
  });

  it('100文字ちょうどは通り、101文字は null。絵文字は2文字と数える（ルールと同じ）', () => {
    expect(normalizeNote('あ'.repeat(NOTE_MAX))).toBe('あ'.repeat(NOTE_MAX));
    expect(normalizeNote('あ'.repeat(NOTE_MAX + 1))).toBeNull();
    expect(normalizeNote('🍜'.repeat(50))).not.toBeNull();
    expect(normalizeNote('🍜'.repeat(51))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import * as domain from '../../src/lib/domain';

// テストの土台が動くことの確認。ドメインの関数を足したら、関数ごとのテストに置き換える
describe('lib/domain', () => {
  it('Firebase に依存せずに読み込める', () => {
    expect(domain).toBeTypeOf('object');
  });
});

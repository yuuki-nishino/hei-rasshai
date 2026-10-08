// カートのQR（#52）：中身から自動で決め、手で変えた選択は、調理の要否が変わるまで使う
import { beforeEach, describe, expect, it } from 'vitest';
import { addItemToCart, clearCart, qr, removeCartLine, setQr } from './cart';

const food = { id: 'y', name: '焼きそば', price: 500, soldOut: false };
const goods = { id: 'g', name: 'Tシャツ', price: 3000, soldOut: false, cook: false };

beforeEach(() => clearCart());

describe('カートのQR', () => {
  it('空のときはオン。調理なしだけならオフ。調理ありが入るとオン', () => {
    expect(qr.value).toBe(true);
    addItemToCart(goods);
    expect(qr.value).toBe(false);
    addItemToCart(food);
    expect(qr.value).toBe(true);
    removeCartLine('y');
    expect(qr.value).toBe(false);
  });

  it('手で変えた選択は、調理の要否が変わらない間は使う', () => {
    addItemToCart(goods);
    setQr(true);
    addItemToCart(goods); // 数量 +1：要否は変わらない
    expect(qr.value).toBe(true);
  });

  it('手でオフにしたあと、調理ありを足すと、自動（オン）へ戻る', () => {
    addItemToCart(food);
    setQr(false);
    expect(qr.value).toBe(false);
    addItemToCart(goods); // 要否は変わらない（調理ありのまま）
    expect(qr.value).toBe(false);
    clearCart();
    addItemToCart(goods);
    setQr(false);
    addItemToCart(food); // 調理なしだけ → 調理あり：自動へ戻る
    expect(qr.value).toBe(true);
  });

  it('カートを空にすると、選択も自動へ戻る', () => {
    addItemToCart(food);
    setQr(false);
    clearCart();
    expect(qr.value).toBe(true);
  });
});

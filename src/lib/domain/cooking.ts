// 調理の有無（#52）。商品ごとに「調理が必要」を持つ。グッズなど、調理せずに渡す商品は false
// 項目が無い（古い）商品・注文の行は、調理あり（true）として扱う

/** 調理が必要か。cook が false のときだけ「不要」 */
export function needsCooking(line: { cook?: boolean }): boolean {
  return line.cook !== false;
}

/**
 * 「番号QRを発行する」の初期値。調理が必要な商品が1つでもあれば、オン（調理画面に出す）。
 * 調理が要らない商品だけなら、オフ（その場で渡す）。カートが空のときは、オン
 */
export function defaultQr(lines: readonly { cook?: boolean }[]): boolean {
  return lines.length === 0 || lines.some(needsCooking);
}

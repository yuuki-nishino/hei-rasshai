// 注文のメモ（SPEC 4.3、data-model.md §2.6）。「辛さ抜き」など、調理で気をつけることを、注文に残す
export const NOTE_MAX = 100; // firestore.rules の validNote と同じ（UTF-16 の単位。絵文字は2文字）

/**
 * 入力を、保存する形に整える：改行は空白に、前後の空白は除く。空はそのまま空（メモなし）。
 * 100文字を超えたら null（長さは、ルールの size() と同じ数え方）
 */
export function normalizeNote(input: string): string | null {
  const note = input.replace(/[\r\n]+/g, ' ').trim();
  return note.length <= NOTE_MAX ? note : null;
}

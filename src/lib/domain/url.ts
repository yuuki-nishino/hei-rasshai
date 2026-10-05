// お客様画面のURL（screens.md §1.1）。QR に入れる
export function orderUrl(origin: string, eventId: string, orderId: string): string {
  return `${origin}/s?e=${encodeURIComponent(eventId)}&o=${encodeURIComponent(orderId)}`;
}

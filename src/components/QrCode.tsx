// QR コード（お客様画面のURL）。qrcode-generator で SVG を作り、画像として表示する（スタッフ画面だけ）
import qrcode from 'qrcode-generator';

export function QrCode({ value, label, size = 220 }: { value: string; label: string; size?: number }) {
  const qr = qrcode(0, 'M'); // 型番は自動。誤り訂正は M（15%）
  qr.addData(value);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={label} width={size} height={size} style={{ imageRendering: 'pixelated', background: '#fff' }} />;
}

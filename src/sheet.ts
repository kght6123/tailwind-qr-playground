import QRCode from 'qrcode';
import jsQR from 'jsqr';

export const HEADER = 144, LABEL = 72, GAP = 32, SCALE = 8;
export const columns = (count: number) => count === 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
const escape = (text: string) => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export function makeSheet(urls: string[], title: string) {
  if (!urls.length || urls.length > 16) throw new Error('QR枚数が不正です。');
  // A uniform QR version makes every cell identical and reliably recoverable.
  const version = Math.max(...urls.map(url => QRCode.create(url, { errorCorrectionLevel: 'M' }).version));
  const codes = urls.map(url => QRCode.create(url, { errorCorrectionLevel: 'M', version }));
  const qrSize = (codes[0].modules.size + 8) * SCALE;
  const cellWidth = qrSize + GAP, cellHeight = qrSize + LABEL + GAP;
  const cols = columns(urls.length), rows = Math.ceil(urls.length / cols);
  const width = cols * cellWidth + GAP, height = HEADER + rows * cellHeight;
  const heading = Array.from(title || 'Tailwind sample').slice(0, 24).join('');
  const fontSize = Math.min(30, Math.floor((width - 64) / Math.max(1, Array.from(heading).length)));
  let content = `<rect width="100%" height="100%" fill="white"/><g fill="#111" font-family="sans-serif"><text x="32" y="48" font-size="${fontSize}">${escape(heading)}</text><text x="32" y="88" font-size="18">最初のQRで開く</text><text x="32" y="116" font-size="18">→ 残りはページ内カメラで読む</text></g>`;
  codes.forEach((code, i) => {
    const x = GAP + i % cols * cellWidth, y = HEADER + Math.floor(i / cols) * cellHeight;
    let path = '';
    for (let row = 0; row < code.modules.size; row++) for (let col = 0; col < code.modules.size; col++) {
      if (code.modules.get(row, col)) path += `M${x + (col + 4) * SCALE} ${y + (row + 4) * SCALE}h8v8h-8z`;
    }
    content += `<path d="${path}" fill="black"/><text x="${x + qrSize / 2}" y="${y + qrSize + 40}" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#111">${i + 1} / ${urls.length}</text>`;
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`, width, height };
}
export async function sheetCanvas(svg: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    image.src = url; await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}
export async function pngBlob(svg: string): Promise<Blob> {
  const canvas = await sheetCanvas(svg);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像の生成に失敗しました。')), 'image/png'));
}
export function scanImage(canvas: HTMLCanvasElement): string[] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const results = new Set<string>();
  const read = (x: number, y: number, width: number, height: number) => {
    const data = ctx.getImageData(x, y, width, height);
    const result = jsQR(data.data, width, height, { inversionAttempts: 'dontInvert' });
    if (result) results.add(result.data);
  };
  // Recognize our exact exported geometry without trusting file metadata.
  for (let count = 1; count <= 16; count++) {
    const cols = columns(count), rows = Math.ceil(count / cols);
    const cellWidth = (canvas.width - GAP) / cols;
    const qrSize = cellWidth - GAP;
    const modules = qrSize / SCALE - 8;
    if (!Number.isInteger(modules) || modules < 21 || modules > 177 || (modules - 21) % 4) continue;
    const cellHeight = qrSize + LABEL + GAP;
    if (HEADER + rows * cellHeight !== canvas.height) continue;
    for (let i = 0; i < rows * cols; i++) read(GAP + i % cols * cellWidth, HEADER + Math.floor(i / cols) * cellHeight, qrSize, qrSize);
    if (results.size) return [...results];
  }
  // Generic photo: scale down for bounded decoding cost, one QR per image.
  const scaled = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  scaled.width = Math.round(canvas.width * scale); scaled.height = Math.round(canvas.height * scale);
  const context = scaled.getContext('2d')!;
  context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  const data = context.getImageData(0, 0, scaled.width, scaled.height);
  const result = jsQR(data.data, data.width, data.height);
  if (result) results.add(result.data);
  return [...results];
}

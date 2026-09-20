import QRCode from 'qrcode';

export const HEADER = 80, LABEL = 72, GAP = 32, SCALE = 8;
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
  let content = `<rect width="100%" height="100%" fill="white"/><g fill="#111" font-family="sans-serif"><text x="32" y="48" font-size="${fontSize}">${escape(heading)}</text></g>`;
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

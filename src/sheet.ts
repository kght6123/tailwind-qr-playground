import jsQR from 'jsqr';
import { HEADER, LABEL, GAP, SCALE, columns } from './sheet-layout';
export { HEADER, LABEL, GAP, SCALE, columns, makeSheet } from './sheet-layout';

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
  // Also accept sheets exported before the reading instructions were removed.
  for (const header of [HEADER, 144]) for (let count = 1; count <= 16; count++) {
    const cols = columns(count), rows = Math.ceil(count / cols);
    const cellWidth = (canvas.width - GAP) / cols;
    const qrSize = cellWidth - GAP;
    const modules = qrSize / SCALE - 8;
    if (!Number.isInteger(modules) || modules < 21 || modules > 177 || (modules - 21) % 4) continue;
    const cellHeight = qrSize + LABEL + GAP;
    if (header + rows * cellHeight !== canvas.height) continue;
    for (let i = 0; i < rows * cols; i++) read(GAP + i % cols * cellWidth, header + Math.floor(i / cols) * cellHeight, qrSize, qrSize);
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

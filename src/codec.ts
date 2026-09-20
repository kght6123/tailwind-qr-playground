import { deflateSync, Inflate } from 'fflate';

export const MAX_SOURCE = 65536;
export const MAX_PARTS = 16;
export const MAX_URL = 800;
export interface Sample { html: string; css: string }
export interface Part { id: string; index: number; total: number; chunk: string }
const utf8 = new TextEncoder();
const fail = (message: string): never => { throw new Error(message); };

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function bytes(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) fail('QRのデータ形式が不正です。');
  try { return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
  catch { return fail('QRのデータが壊れています。'); }
}
async function digest(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function sourceBytes(sample: Sample): Uint8Array {
  const data = utf8.encode(JSON.stringify({ html: sample.html, css: sample.css }));
  if (data.length > MAX_SOURCE) fail('コードはJSON形式で64 KiB以内にしてください。');
  return data;
}
export async function encode(sample: Sample, base: string): Promise<string[]> {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol)) fail('配信先URLが不正です。');
  url.hash = ''; url.search = '';
  const compressed = deflateSync(sourceBytes(sample), { level: 9 });
  const payload = base64(compressed);
  const id = await digest(compressed);
  const prefix = `${url.href}#v1.${id}.`;
  // Reserve two digits for both index and total, including separators.
  const capacity = MAX_URL - utf8.encode(prefix + '16.16.').length;
  if (capacity < 32) fail('配信先URLが長すぎます。');
  const total = Math.ceil(payload.length / capacity);
  if (total > MAX_PARTS) fail('QRが16枚を超えます。コードを短くしてください。');
  return Array.from({ length: total }, (_, i) => `${prefix}${i + 1}.${total}.${payload.slice(i * capacity, (i + 1) * capacity)}`);
}
export function parsePart(text: string, base: string): Part {
  if (utf8.encode(text).length > MAX_URL) fail('QRのURLが800バイトを超えています。');
  let url: URL;
  try { url = new URL(text); } catch { return fail('QRには本アプリのURLを指定してください。'); }
  const expected = new URL(base);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.search) fail('別のページのQRです。');
  const match = /^#v1\.([a-f0-9]{64})\.([1-9]\d?)\.([1-9]\d?)\.([A-Za-z0-9_-]+)$/.exec(url.hash);
  if (!match) fail('未対応の形式、または壊れたQRです。');
  const [, id, indexText, totalText, chunk] = match!;
  const index = Number(indexText), total = Number(totalText);
  if (total > MAX_PARTS || index > total) fail('QRの番号・総数が不正です。');
  return { id, index, total, chunk };
}
export class Collector {
  id = ''; total = 0;
  parts = new Map<number, string>();
  reset() { this.id = ''; this.total = 0; this.parts.clear(); }
  add(part: Part) {
    if (this.id && this.id !== part.id) fail('別のサンプルのQRです。');
    if (this.total && this.total !== part.total) fail('QRの総数が一致しません。');
    const previous = this.parts.get(part.index);
    if (previous && previous !== part.chunk) fail('同じ番号のQRの内容が一致しません。');
    this.id = part.id; this.total = part.total;
    this.parts.set(part.index, part.chunk);
  }
  get missing() { return Array.from({ length: this.total }, (_, i) => i + 1).filter(i => !this.parts.has(i)); }
  async decode(): Promise<Sample> {
    if (!this.total || this.missing.length) fail('まだ読み取っていないQRがあります。');
    const compressed = bytes(Array.from({ length: this.total }, (_, i) => this.parts.get(i + 1)).join(''));
    if (await digest(compressed) !== this.id) fail('整合性の検証に失敗しました。最初から読み直してください。');
    const output: Uint8Array[] = [];
    let length = 0;
    const inflater = new Inflate(chunk => {
      length += chunk.length;
      if (length > MAX_SOURCE) fail('展開後のデータが64 KiBを超えています。');
      output.push(chunk);
    });
    // Small pushes bound transient expansion before the size check.
    for (let i = 0; i < compressed.length; i += 32) inflater.push(compressed.subarray(i, i + 32), i + 32 >= compressed.length);
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of output) { data.set(chunk, offset); offset += chunk.length; }
    let sample: unknown;
    try { sample = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
    catch { return fail('復元したコードの形式が不正です。'); }
    if (!sample || typeof sample !== 'object' || !('html' in sample) || !('css' in sample)
      || typeof sample.html !== 'string' || typeof sample.css !== 'string') fail('HTML・CSSが見つかりません。');
    return sample as Sample;
  }
}

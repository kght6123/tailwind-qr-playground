import { describe, expect, it } from 'vitest';
import { Collector, encode, parsePart } from '../src/codec';
import { columns, makeSheet } from '../src/sheet';
import { deflateSync } from 'fflate';

const base = 'https://example.test/play/';
function noisy(length: number) {
  let seed = 63;
  return Array.from({ length }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return String.fromCharCode(33 + (seed >>> 0) % 90); }).join('');
}
describe('stateless QR transport', () => {
  it('round-trips Japanese, emoji and CSS from one QR', async () => {
    const sample = { html: '<p class="text-xl">日本語 🌿</p>', css: '@theme { --color-ink: #123; }' };
    const urls = await encode(sample, base); expect(urls).toHaveLength(1);
    const collector = new Collector(); collector.add(parsePart(urls[0], base));
    expect(await collector.decode()).toEqual(sample);
  });
  it('assembles reversed fragments and ignores duplicates within 800 byte URLs', async () => {
    const sample = { html: noisy(6000), css: '' };
    const urls = await encode(sample, base); expect(urls.length).toBeGreaterThan(2);
    const collector = new Collector();
    for (const url of urls.reverse()) {
      expect(new TextEncoder().encode(url).length).toBeLessThanOrEqual(800);
      collector.add(parsePart(url, base)); collector.add(parsePart(url, base));
    }
    expect(await collector.decode()).toEqual(sample);
  });
  it('rejects missing, foreign, conflicting and corrupted fragments', async () => {
    const urls = await encode({ html: noisy(2000), css: '' }, base);
    const collector = new Collector(); const part = parsePart(urls[0], base); collector.add(part);
    await expect(collector.decode()).rejects.toThrow('まだ');
    expect(() => collector.add({ ...part, id: '0'.repeat(64) })).toThrow('別の');
    expect(() => collector.add({ ...part, total: part.total + 1 })).toThrow('総数');
    expect(() => collector.add({ ...part, chunk: part.chunk + 'A' })).toThrow('同じ番号');
    collector.reset();
    for (const url of urls) collector.add({ ...parsePart(url, base), id: '0'.repeat(64) });
    await expect(collector.decode()).rejects.toThrow('整合性');
  });
  it('rejects unknown formats, wrong destinations, invalid indices and oversized input', async () => {
    const [url] = await encode({ html: '', css: '' }, base);
    expect(() => parsePart(url.replace('#v1.', '#v2.'), base)).toThrow();
    expect(() => parsePart(url.replace('example.test', 'evil.test'), base)).toThrow();
    expect(() => parsePart(url.replace('.1.1.', '.2.1.'), base)).toThrow();
    await expect(encode({ html: 'x'.repeat(65536), css: '' }, base)).rejects.toThrow('64 KiB');
    await expect(encode({ html: noisy(20000), css: '' }, base)).rejects.toThrow('16枚');
  });
  it('uses fixed publication grid thresholds', () => {
    expect([1,2,4,5,9,10,16].map(columns)).toEqual([1,2,2,3,3,4,4]);
    const sheet = makeSheet(['https://example.test'], '<script>日本語</script>');
    expect(sheet.svg).toContain('&lt;script&gt;');
    expect(sheet.svg).not.toContain('<script>');
  });
  it('stops decompression beyond the limit even with a valid hash', async () => {
    const compressed = deflateSync(new TextEncoder().encode(JSON.stringify({ html: 'x'.repeat(100000), css: '' })));
    const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', compressed)), b => b.toString(16).padStart(2, '0')).join('');
    const payload = btoa(String.fromCharCode(...compressed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const collector = new Collector(); collector.add(parsePart(`${base}#v1.${id}.1.1.${payload}`, base));
    await expect(collector.decode()).rejects.toThrow('64 KiB');
  });
});

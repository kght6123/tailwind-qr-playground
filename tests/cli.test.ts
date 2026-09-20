import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { Collector, parsePart } from '../src/codec';
import { HEADER, GAP, LABEL, columns } from '../src/sheet-layout';
const cli = resolve('cli-dist/index.mjs');
const directories: string[] = [];
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'tailwind-qr-cli-'));
  directories.push(dir); return dir;
}
function run(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
}
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('QR creation CLI', () => {
  it('creates one PNG containing all parts which the web codec can restore exactly', async () => {
    const dir = await workspace();
    const sample = { html: Array.from({ length: 100 }, (_, i) => `<p>${i} 日本語 ${Math.sin(i).toString(36)}</p>`).join('\n'), css: '@theme { --color-brand: #f09; }' };
    await writeFile(join(dir, 'sample.html'), sample.html);
    await writeFile(join(dir, 'sample.css'), sample.css);
    const result = run(dir, '--html', 'sample.html', '--css', 'sample.css', '--title', '日本語のサンプル', '--out', 'out/sheet.png', '--json');
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout).results[0];
    expect(report.qrCount).toBeGreaterThan(1);
    const png = PNG.sync.read(await readFile(report.output));
    expect([png.width, png.height]).toEqual([report.width, report.height]);
    const collector = new Collector();
    const cols = columns(report.qrCount), size = (png.width - GAP) / cols - GAP;
    for (let i = 0; i < report.qrCount; i++) {
      const cell = new PNG({ width: size, height: size });
      PNG.bitblt(png, cell, GAP + i % cols * (size + GAP), HEADER + Math.floor(i / cols) * (size + LABEL + GAP), size, size, 0, 0);
      const code = jsQR(new Uint8ClampedArray(cell.data), size, size);
      expect(code).not.toBeNull();
      expect(code!.data).toBe(report.urls[i]);
      collector.add(parsePart(code!.data, 'https://kght6123.github.io/tailwind-qr-playground/'));
    }
    expect(await collector.decode()).toEqual(sample);
  });

  it('resolves batch paths from the manifest and supports SVG and a custom reader URL', async () => {
    const dir = await workspace(); await mkdir(join(dir, 'samples'));
    await writeFile(join(dir, 'samples/a.html'), '<h1>test</h1>');
    await writeFile(join(dir, 'samples/list.json'), JSON.stringify([
      { html: 'a.html', title: '<A & B>', out: 'a.svg' },
      { html: 'a.html', out: 'b.svg', baseUrl: 'https://example.test/playground/' },
    ]));
    const result = run(dir, '--manifest', 'samples/list.json', '--json');
    expect(result.status, result.stderr).toBe(0);
    const reports = JSON.parse(result.stdout).results;
    expect(reports).toHaveLength(2);
    expect(await readFile(reports[0].output, 'utf8')).toContain('&lt;A &amp; B&gt;');
    expect(reports[1].urls[0]).toMatch(/^https:\/\/example.test\/playground\/#v1\./);
    expect(run(dir, '--manifest', 'samples/list.json').status).toBe(1);
    expect(run(dir, '--manifest', 'samples/list.json', '--force').status).toBe(0);
  });

  it('validates every batch entry before writing and never overwrites input files', async () => {
    const dir = await workspace();
    await writeFile(join(dir, 'a.html'), '<p>valid</p>');
    await writeFile(join(dir, 'large.html'), 'x'.repeat(65536));
    await writeFile(join(dir, 'list.json'), JSON.stringify([{ html: 'a.html', out: 'a.svg' }, { html: 'large.html', out: 'b.svg' }]));
    expect(run(dir, '--manifest', 'list.json').status).toBe(1);
    await expect(readFile(join(dir, 'a.svg'))).rejects.toThrow();
    expect(run(dir, '--html', 'a.html', '--base-url', 'javascript:alert(1)', '--out', 'a.svg').status).toBe(1);
    await writeFile(join(dir, 'source.svg'), '<p>keep</p>');
    expect(run(dir, '--html', 'source.svg', '--out', 'source.svg', '--force').status).toBe(1);
    expect(await readFile(join(dir, 'source.svg'), 'utf8')).toBe('<p>keep</p>');
  });
});

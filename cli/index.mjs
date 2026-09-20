import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname, extname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import { encode } from '../src/codec.ts';
import { makeSheet } from '../src/sheet-layout.ts';

const DEFAULT_BASE = 'https://kght6123.github.io/tailwind-qr-playground/';
const help = `Tailwind QR Playground — QR sheet generator (Node.js 22.12+)

Usage:
  tailwind-qr --html sample.html [--css sample.css] --out qr.png
  tailwind-qr --manifest samples.json [--json]

Options:
  --html <path>       HTML input file (UTF-8)
  --css <path>        CSS input file (UTF-8, optional)
  --title <text>      Sheet title (defaults to HTML filename)
  --out <path>       One combined .png or .svg sheet (default: qr.png)
  --base-url <url>    Reader URL (default: ${DEFAULT_BASE})
  --manifest <path>  JSON array of {html, css?, title?, out, baseUrl?}
                     Paths are relative to the manifest file.
  --font <path>      Font file for PNG titles (e.g. a Japanese TTF/OTF)
  --force            Allow overwriting existing output files
  --json             Print a JSON result including all QR URLs
  --help             Show this help

Each sample is limited to 64 KiB of JSON and 16 QR codes, as in the web app.
No browser or server is required. Source files are never uploaded.
`;

function text(value, label, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function main() {
  const { values } = parseArgs({ options: {
    html: { type: 'string' }, css: { type: 'string' }, title: { type: 'string' },
    out: { type: 'string' }, 'base-url': { type: 'string' }, manifest: { type: 'string' },
    font: { type: 'string' }, force: { type: 'boolean' }, json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  }, strict: true, allowPositionals: false });
  if (values.help) { process.stdout.write(help); return; }
  let jobs, root = process.cwd();
  if (values.manifest) {
    if (['html', 'css', 'title', 'out'].some(key => values[key] !== undefined)) {
      throw new Error('--manifest cannot be combined with --html, --css, --title or --out.');
    }
    const path = resolve(values.manifest);
    root = dirname(path);
    jobs = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(jobs) || !jobs.length) throw new Error('Manifest must be a non-empty JSON array.');
  } else {
    if (!values.html) throw new Error('--html or --manifest is required. Use --help for examples.');
    jobs = [{ html: values.html, css: values.css, title: values.title, out: values.out ?? 'qr.png' }];
  }
  const font = values.font ? resolve(values.font) : undefined;
  if (font) await readFile(font); // Fail before creating any output.
  const paths = new Set();
  const inputs = new Set();
  const planned = [];
  for (const [index, job] of jobs.entries()) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error(`Invalid manifest entry ${index + 1}.`);
    const unknown = Object.keys(job).filter(key => !['html', 'css', 'title', 'out', 'baseUrl'].includes(key));
    if (unknown.length) throw new Error(`Unknown manifest fields: ${unknown.join(', ')}`);
    const htmlPath = resolve(root, text(job.html, 'html', true));
    const cssPath = job.css === undefined ? undefined : resolve(root, text(job.css, 'css', true));
    inputs.add(htmlPath); if (cssPath) inputs.add(cssPath);
    const output = resolve(root, text(job.out, 'out', true));
    const format = extname(output).toLowerCase().slice(1);
    if (!['png', 'svg'].includes(format)) throw new Error('Output extension must be .png or .svg.');
    if (paths.has(output)) throw new Error(`Duplicate output: ${output}`);
    paths.add(output);
    const base = new URL(text(job.baseUrl ?? values['base-url'] ?? DEFAULT_BASE, 'base URL', true));
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('Base URL must be HTTP(S), without credentials, query or fragment.');
    }
    const title = text(job.title, 'title') ?? basename(htmlPath, extname(htmlPath));
    const sample = { html: await readFile(htmlPath, 'utf8'), css: cssPath ? await readFile(cssPath, 'utf8') : '' };
    const urls = await encode(sample, base.href);
    const sheet = makeSheet(urls, title);
    planned.push({ output, format, title, urls, sheet });
  }
  if (values.manifest) inputs.add(resolve(values.manifest));
  if (font) inputs.add(font);
  for (const job of planned) {
    if (inputs.has(job.output)) throw new Error(`Output must not replace an input file: ${job.output}`);
    if (await exists(job.output)) {
      const stat = await lstat(job.output);
      if (!stat.isFile()) throw new Error(`Output must be a regular file: ${job.output}`);
      if (!values.force) throw new Error(`Output already exists: ${job.output}. Use --force to overwrite.`);
    }
  }
  const results = [];
  for (const { output, format, title, urls, sheet } of planned) {
    const data = format === 'svg' ? sheet.svg : new Resvg(sheet.svg, {
      font: { loadSystemFonts: true, ...(font ? { fontFiles: [font] } : {}) },
    }).render().asPng();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, data, { flag: values.force ? 'w' : 'wx' });
    results.push({ output, format, title, qrCount: urls.length, width: sheet.width, height: sheet.height, urls });
  }
  if (values.json) process.stdout.write(JSON.stringify({ results }) + '\n');
  else for (const result of results) process.stdout.write(`${result.output} (${result.qrCount} QR, ${result.width} x ${result.height})\n`);
}
main().catch(error => {
  process.stderr.write(`tailwind-qr: ${error.message}\n`);
  process.exitCode = 1;
});

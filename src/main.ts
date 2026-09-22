import { createEditor } from './highlight';
import './style.css';
import jsQR from 'jsqr';
import { Collector, encode, parsePart, sourceBytes } from './codec';
import { makeSheet, pngBlob, scanImage } from './sheet';
import { previewDocument } from './preview';
import { loadDraft, saveDraft, remember, listHistory, type Draft } from './storage';

// iOS respects the viewport limit for focus zoom while Safari still allows
// user-initiated pinch zoom. Do not impose this limit on Android or desktop.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS) {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1';
}

document.querySelector('#app')!.innerHTML = `
  <header><h1><a class="brand" href="./">Tailwind QR Playground</a></h1><div class="header-actions"><button id="open-history" aria-haspopup="dialog" aria-controls="history-dialog">履歴</button><span class="badge">v4.3.3</span></div></header>
  <dialog id="history-dialog" aria-labelledby="history-title"><div class="history-heading"><h2 id="history-title">読み込み履歴</h2><button id="close-history" aria-label="履歴を閉じる">閉じる</button></div><div id="history-list" aria-live="polite"></div></dialog>
  <main>
    <div class="toolbar"><label>サンプル名<input id="title" value="はじめてのTailwind" maxlength="48"></label><button id="generate" class="primary">QR一覧を作る ↗</button><button id="open-reader">QRを読み込む</button></div>
    <p id="status" role="status" aria-live="polite"></p>
    <section class="workspace">
      <nav class="tabs" aria-label="表示切り替え"><button data-tab="html" aria-pressed="true">HTML</button><button data-tab="css" aria-pressed="false">CSS</button><button data-tab="preview" aria-pressed="false">プレビュー</button></nav>
      <div class="editors"><div class="pane html-pane"><div id="html" class="code-editor" role="textbox" aria-multiline="true" aria-label="HTMLコード"></div></div><div class="pane css-pane"><div id="css" class="code-editor" role="textbox" aria-multiline="true" aria-label="CSSコード"></div></div></div>
      <div class="preview-pane"><div class="pane-heading">LIVE PREVIEW <span>Tailwind CSS 4.3.3</span></div><iframe id="preview" title="サンプルのプレビュー" sandbox="allow-scripts" allow="camera 'none'; microphone 'none'; geolocation 'none'"></iframe></div>
    </section>
    <section id="reader" class="panel" hidden>
      <p id="progress" aria-live="polite">最初のQRを読み取ってください。</p><div class="reader-actions"><button id="camera-start" class="primary">QRをカメラで読む</button><button id="camera-stop">カメラを停止</button><label>カメラ<select id="camera-select"><option value="">自動（背面優先）</option></select></label><button id="reset">最初から読み直す</button></div>
      <div id="camera-view" hidden><video id="video" muted playsinline autoplay></video><div class="reticle"></div><p>枠内にQRを一つずつ合わせてください</p></div>
      <div id="drop-zone"><label>QR画像を選択（一覧PNGも対応）<input id="image-input" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><p>PCでは画像をここへドロップできます。</p></div>
      <label>QRのURLを貼り付け<textarea id="urls" rows="3" placeholder="複数のURLは改行で区切ってください"></textarea></label><button id="import-urls">URLを取り込む</button>
    </section>
    <section id="export" class="panel" hidden><div class="section-heading"><span id="export-count" class="badge"></span></div><div class="reader-actions"><button id="download-png" class="primary">QR一覧を画像で保存（PNG）</button><button id="download-svg">SVGで保存</button><button id="copy-urls">URLをコピー</button></div><img id="sheet-preview" alt="番号付き分割QRの一覧画像"><p class="hint">実際の読み取りを確認してください。</p></section>
    <footer>コードは端末内で処理 · 保存サーバーなし · カメラ画像の送信なし</footer>
  </main>`;

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const html = get('html'), css = get('css');
const status = get('status');
const base = new URL(location.pathname, location.origin).href;
const collector = new Collector();
let stream: MediaStream | undefined, frame = 0, cameraRequest = 0, busy = false;
let sheet: ReturnType<typeof makeSheet> | undefined, shareUrls: string[] = [], sheetUrl = '', filename = '';
const report = (message: string, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
const attempt = async (action: () => void | Promise<void>) => { try { await action(); } catch (error) { report(error instanceof Error ? error.message : String(error), true); } };
const htmlEditor = createEditor(html, 'markup'), cssEditor = createEditor(css, 'css');
const sample = () => ({ html: htmlEditor.toString(), css: cssEditor.toString() });
htmlEditor.updateCode(`<main class="min-h-screen bg-rose-50 p-6 flex items-center justify-center">\n  <article class="max-w-sm rounded-3xl bg-white p-6 shadow-xl">\n    <span class="text-sm font-semibold text-rose-700">HELLO, TAILWIND</span>\n    <h1 class="mt-4 text-3xl font-bold tracking-tight">小さなコード。<br>大きなアイデア。</h1>\n    <p class="mt-4 text-stone-600">クラスを書き換えて、変化を見てみよう。</p>\n    <button class="mt-6 rounded-full bg-rose-700 px-6 py-3 text-white hover:bg-rose-900">試してみる ↗</button>\n  </article>\n</main>`, false);
cssEditor.updateCode('@theme {\n  --font-sans: system-ui, sans-serif;\n}', false);
const draft = (): Draft => ({ ...sample(), title: get<HTMLInputElement>('title').value });
let draftFailed = false;
function persistDraft() {
  try { saveDraft(draft()); draftFailed = false; }
  catch { if (!draftFailed) report('編集状態を端末に保存できませんでした。', true); draftFailed = true; }
}
function applyDraft(value: Draft) {
  clearTimeout(timer);
  htmlEditor.updateCode(value.html, false); cssEditor.updateCode(value.css, false);
  get<HTMLInputElement>('title').value = value.title;
  get('export').hidden = true; sheet = undefined;
  render();
}
function render() { sourceBytes(sample()); get<HTMLIFrameElement>('preview').srcdoc = previewDocument(sample()); }
let timer: ReturnType<typeof setTimeout>;
const edited = () => {
  clearTimeout(timer); get('export').hidden = true; sheet = undefined;
  timer = setTimeout(() => { persistDraft(); void attempt(render); }, 350);
};
for (const editor of [html, css]) editor.addEventListener('input', edited);
htmlEditor.onUpdate(edited); cssEditor.onUpdate(edited);
get('title').addEventListener('input', edited);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.onclick = () => {
  document.querySelector('.workspace')!.setAttribute('data-active', button.dataset.tab!);
  for (const sibling of document.querySelectorAll('[data-tab]')) sibling.setAttribute('aria-pressed', String(sibling === button));
};
function progress() {
  get('camera-start').textContent = collector.parts.size && collector.missing.length ? '残りのQRをカメラで読む' : 'QRをカメラで読む';
  get('progress').textContent = collector.total ? `${collector.parts.size} / ${collector.total} 読み取り済み${collector.missing.length ? ` ｜ 残り：${collector.missing.join('、')}` : ' ｜ 復元完了'}` : '最初のQRを読み取ってください。';
}
function stopCamera() {
  cameraRequest++; cancelAnimationFrame(frame);
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  get<HTMLVideoElement>('video').srcObject = null; get('camera-view').hidden = true;
}
async function ingest(text: string) {
  const part = parsePart(text.trim(), base);
  if (collector.id && collector.id !== part.id) {
    stopCamera();
    if (!confirm('別のサンプルです。読み取り済みの断片を破棄して切り替えますか？')) return;
    collector.reset();
  }
  if (collector.parts.get(part.index) === part.chunk && collector.total === part.total) return;
  collector.add(part); progress();
  const firstOpen = get('reader').hidden;
  get('reader').hidden = false;
  if (firstOpen && collector.missing.length) get('reader').scrollIntoView({ behavior: 'smooth' });
  if (!collector.missing.length) {
    const restored = await collector.decode();
    const entry = { ...restored, title: `読み込み ${new Date().toLocaleString('ja-JP')}`, id: part.id, loadedAt: new Date().toISOString() };
    stopCamera(); applyDraft(entry); persistDraft();
    history.replaceState(null, '', base);
    get('reader').hidden = true;
    report('すべてのQRを読み取り、コードを復元しました。');
    try { await remember(entry); } catch { report('コードを復元しましたが、履歴を端末に保存できませんでした。', true); }
  } else report(`QR ${part.index}を取り込みました。残りを読み取ってください。`);
}
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('カメラにはHTTPSが必要です。画像選択またはURL貼り付けをご利用ください。');
  const request = cameraRequest;
  const deviceId = get<HTMLSelectElement>('camera-select').value;
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } } });
    if (request !== cameraRequest || document.hidden) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    const video = get<HTMLVideoElement>('video'); video.srcObject = stream; await video.play();
    if (request !== cameraRequest) return;
    get('camera-view').hidden = false;
    const select = get<HTMLSelectElement>('camera-select');
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    select.replaceChildren(new Option('自動（背面優先）', ''), ...devices.map((device, i) => new Option(device.label || `カメラ ${i + 1}`, device.deviceId)));
    select.value = deviceId;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 720;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    let last = 0;
    const scan = async (now: number) => {
      if (request !== cameraRequest) return;
      if (video.readyState >= 2 && now - last > 220 && !busy) {
        last = now; busy = true;
        try {
          const size = Math.min(video.videoWidth, video.videoHeight) * 0.8;
          context.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, 720, 720);
          const data = context.getImageData(0, 0, 720, 720);
          const code = jsQR(data.data, 720, 720, { inversionAttempts: 'dontInvert' });
          if (code) await attempt(() => ingest(code.data));
        } finally { busy = false; }
      }
      if (request === cameraRequest) frame = requestAnimationFrame(scan);
    };
    report('枠内に次のQRを合わせてください。'); frame = requestAnimationFrame(scan);
  } catch (error) {
    if (request !== cameraRequest) return;
    stopCamera();
    const name = error instanceof DOMException ? error.name : '';
    throw new Error(name === 'NotAllowedError' ? 'カメラが許可されていません。ブラウザの権限を確認するか画像・URLから取り込んでください。' : name === 'NotFoundError' ? 'カメラが見つかりません。画像・URLから取り込んでください。' : 'カメラを開始できません。他のアプリで使用中でないか確認して再試行してください。');
  }
}
async function importImages(files: FileList | File[]) {
  stopCamera();
  for (const file of Array.from(files)) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 32 * 1024 * 1024) throw new Error('32 MB以下のPNG・JPEG・WebPを選択してください。');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('画像は3200万画素以内にしてください。');
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      const urls = scanImage(canvas);
      if (!urls.length) throw new Error('QRが見つかりません。元の一覧PNG、またはQRを大きく写した画像を選択してください。');
      for (const value of urls) await ingest(value);
    } finally { URL.revokeObjectURL(url); }
  }
}
function download(blob: Blob, extension: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${filename}.${extension}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
get('generate').onclick = () => void attempt(async () => {
  const button = get<HTMLButtonElement>('generate'); button.disabled = true;
  try {
    shareUrls = await encode(sample(), base);
    const title = get<HTMLInputElement>('title').value;
    sheet = makeSheet(shareUrls, title);
    filename = `${(title || 'tailwind').replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 40)}-${parsePart(shareUrls[0], base).id.slice(0, 8)}`;
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
    sheetUrl = URL.createObjectURL(new Blob([sheet.svg], { type: 'image/svg+xml' }));
    get<HTMLImageElement>('sheet-preview').src = sheetUrl;
    get('export-count').textContent = `${shareUrls.length} QR / 1 IMAGE`;
    get('export').hidden = false; report('QR一覧を生成しました。PNGまたはSVGで一括保存できます。');
    get('export').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally { button.disabled = false; }
});
get('download-png').onclick = () => void attempt(async () => { if (sheet) download(await pngBlob(sheet.svg), 'png'); });
get('download-svg').onclick = () => { if (sheet) download(new Blob([sheet.svg], { type: 'image/svg+xml' }), 'svg'); };
get('copy-urls').onclick = () => void attempt(async () => { await navigator.clipboard.writeText(shareUrls.join('\n')); report('URLをコピーしました。分割時は全行を共有してください。'); });
get('open-reader').onclick = () => {
  if (collector.total && !collector.missing.length) { collector.reset(); history.replaceState(null, '', base); }
  progress();
  get('reader').hidden = false; get('reader').scrollIntoView({ behavior: 'smooth' }); };
get('camera-start').onclick = () => void attempt(startCamera);
get('camera-stop').onclick = stopCamera;
get('camera-select').onchange = () => { if (stream) void attempt(startCamera); };
get('reset').onclick = () => { stopCamera(); collector.reset(); progress(); history.replaceState(null, '', base); report('読み取りをリセットしました。'); };
get('import-urls').onclick = () => void attempt(async () => {
  stopCamera();
  for (const value of get<HTMLTextAreaElement>('urls').value.split(/\r?\n/).filter(value => value.trim())) await ingest(value);
});
get<HTMLInputElement>('image-input').onchange = event => void attempt(async () => { const input = event.target as HTMLInputElement; if (input.files) await importImages(input.files); input.value = ''; });
get('drop-zone').ondragover = event => { event.preventDefault(); };
get('drop-zone').ondrop = event => { event.preventDefault(); if (event.dataTransfer?.files) void attempt(() => importImages(event.dataTransfer!.files)); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopCamera(); persistDraft(); } });
window.addEventListener('pagehide', () => { stopCamera(); persistDraft(); });
window.addEventListener('hashchange', () => { if (location.hash) void attempt(() => ingest(location.href)); });
const historyDialog = get<HTMLDialogElement>('history-dialog');
get('close-history').onclick = () => historyDialog.close();
get('open-history').onclick = () => {
  stopCamera();
  const list = get('history-list'); list.textContent = '読み込み中…';
  historyDialog.showModal();
  void (async () => {
    try {
      const entries = await listHistory();
      list.replaceChildren();
      if (!entries.length) list.textContent = '読み込み履歴はまだありません。';
      for (const entry of entries) {
        const button = document.createElement('button'); button.className = 'history-entry';
        const title = document.createElement('span'); title.textContent = entry.title;
        const date = document.createElement('time'); date.dateTime = entry.loadedAt; date.textContent = new Date(entry.loadedAt).toLocaleString('ja-JP');
        const snippet = document.createElement('code'); snippet.textContent = entry.html.slice(0, 160);
        button.append(title, date, snippet);
        button.onclick = () => void attempt(() => {
          sourceBytes(entry); applyDraft(entry); persistDraft();
          collector.reset(); progress(); get('reader').hidden = true;
          history.replaceState(null, '', base);
          historyDialog.close(); report('履歴からコードを復元しました。');
        });
        list.append(button);
      }
    } catch (error) { list.textContent = error instanceof Error ? error.message : '履歴を読み込めませんでした。'; }
  })();
};
try { const saved = loadDraft(); if (saved) applyDraft(saved); }
catch { report('保存した編集状態を復元できませんでした。', true); }
void attempt(render);
if (location.hash) void attempt(() => ingest(location.href));

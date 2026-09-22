import { test, expect } from '@playwright/test';

test('renders Tailwind and isolates untrusted preview content', async ({ page }, testInfo) => {
  await page.goto('/');
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('h1')).toHaveCSS('font-size', '30px');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('evil.test')) requests.push(request.url()); });
  await page.getByRole('textbox', { name: 'HTMLコード' }).fill('<script>parent.document.body.dataset.pwned="yes"</script><img src="https://evil.test/a" onerror="alert(1)"><p class="text-3xl font-bold">安全な表示</p>');
  await expect(preview.locator('p')).toHaveText('安全な表示');
  await expect(preview.locator('p')).toHaveCSS('font-weight', '700');
  expect(await page.locator('body').getAttribute('data-pwned')).toBeNull();
  expect(requests).toEqual([]);
});

test('exports one PNG and restores every fragment from that image', async ({ page }, testInfo) => {
  await page.goto('/');
  const source = Array.from({ length: 110 }, (_, i) => `<p class="p-${i % 8}">${i} 日本語 ${Math.sin(i).toString(36)}</p>`).join('\n');
  await page.getByRole('textbox', { name: 'HTMLコード' }).fill(source);
  await page.getByRole('button', { name: 'QR一覧を作る' }).click();
  await expect(page.locator('#export')).toBeVisible();
  await expect(page.locator('#export-count')).not.toHaveText('1 QR / 1 IMAGE');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'QR一覧を画像で保存（PNG）' }).click();
  const download = await pending; const path = testInfo.outputPath('sheet.png');
  await download.saveAs(path);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await page.reload();
  await page.getByRole('button', { name: 'QRを読み込む', exact: true }).click();
  await page.locator('#image-input').setInputFiles(path!);
  await expect(page.locator('#status')).toContainText('コードを復元しました', { timeout: 60000 });
  await expect(page.locator('#reader')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'HTMLコード' })).toHaveJSProperty('textContent', source);
});

test('PNG grids decode all cells for 1, 2, 4, 5, 9, 10 and 16 QR codes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { makeSheet, sheetCanvas, scanImage } = await import('/src/sheet.ts');
    const results = [];
    for (const count of [1, 2, 4, 5, 9, 10, 16]) {
      const urls = Array.from({ length: count }, (_, i) => `https://example.test/#${i}.` + 'abcdef123XYZ_-'.repeat(54));
      const sheet = makeSheet(urls, '日本語の掲載用サンプル');
      const canvas = await sheetCanvas(sheet.svg);
      const decoded = scanImage(canvas);
      results.push({ count, matched: urls.every(url => decoded.includes(url)), pixels: canvas.width * canvas.height });
    }
    return results;
  });
  for (const item of result) { expect(item.matched).toBe(true); expect(item.pixels).toBeLessThan(32_000_000); }
});

test('mobile tabs and camera denial retain alternate input', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('denied', 'NotAllowedError'); } }); });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'HTMLコード' })).toBeVisible();
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.locator('#preview')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'QRを読み込む', exact: true }).click();
  await page.getByRole('button', { name: 'QRをカメラで読む', exact: true }).click();
  await expect(page.locator('#status')).toContainText('許可されていません');
  await expect(page.locator('#image-input')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const entry of ['manual', 'url'] as const) test(`reads QR frames from ${entry} entry and stops camera after reconstruction`, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Synthetic captureStream camera is tested on Chromium.');
  await page.goto('/');
  const source = Array.from({ length: 100 }, (_, i) => `<p>${i}-${Math.sin(i).toString(36)}-カメラ</p>`).join('');
  const urls = await page.evaluate(async source => {
    const { encode } = await import('/src/codec.ts');
    return encode({ html: source, css: '' }, location.origin + '/');
  }, source);
  expect(urls.length).toBeGreaterThan(1);
  if (entry === 'url') {
    await page.goto(urls[0]);
    await expect(page.locator('#progress')).toContainText(`1 / ${urls.length}`);
  } else {
    await page.getByRole('button', { name: 'QRを読み込む', exact: true }).click();
    await expect(page.locator('#progress')).toHaveText('最初のQRを読み取ってください。');
  }
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 800;
    const stream = canvas.captureStream(10);
    Object.assign(window, { cameraCanvas: canvas, cameraStream: stream });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => stream });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
    canvas.getContext('2d')!.fillRect(0, 0, 800, 800);
  });
  await page.locator('#camera-start').click();
  for (let i = entry === 'url' ? 1 : 0; i < urls.length; i++) {
    await page.evaluate(async url => {
      const { makeSheet, sheetCanvas, HEADER, GAP } = await import('/src/sheet.ts');
      const sheet = makeSheet([url], 'Camera');
      const image = await sheetCanvas(sheet.svg);
      const canvas = (window as any).cameraCanvas as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 800);
      const size = sheet.width - 2 * GAP;
      ctx.drawImage(image, GAP, HEADER, size, size, 110, 110, 580, 580);
      (window as any).cameraStream.getVideoTracks()[0].requestFrame();
    }, urls[i]);
    await expect(page.locator('#progress')).toContainText(`${i + 1} / ${urls.length}`, { timeout: 15000 });
  }
  await expect(page.getByRole('textbox', { name: 'HTMLコード' })).toHaveJSProperty('textContent', source);
  expect(await page.evaluate(() => (window as any).cameraStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('#camera-view')).toBeHidden();
  await expect(page.locator('#reader')).toBeHidden();
});

test('CodeJar highlights and supports indentation, brackets, undo and redo', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const html = page.getByRole('textbox', { name: 'HTMLコード' });
  await html.fill('<p class="text-green-600">日本語</p>');
  await expect(page.locator('#html .token.tag').first()).toBeVisible();
  await page.getByRole('button', { name: 'CSS', exact: true }).click();
  const css = page.getByRole('textbox', { name: 'CSSコード' });
  await css.fill('');
  await css.pressSequentially('p ');
  await css.press('{');
  await expect(css).toHaveJSProperty('textContent', 'p {}');
  await css.press('Enter');
  await expect(css).toHaveJSProperty('textContent', 'p {\n  \n}');
  await css.press('Tab');
  await expect(css).toHaveJSProperty('textContent', 'p {\n    \n}');
  await css.press('Shift+Tab');
  await expect(css).toHaveJSProperty('textContent', 'p {\n  \n}');
  await css.pressSequentially('color: red;');
  await expect(page.locator('#css .token.property')).toHaveText('color');
  // CodeJar groups a typing burst after its 300ms history debounce.
  await page.waitForTimeout(400);
  await css.press('ControlOrMeta+z');
  await expect(css).not.toContainText('color: red;');
  await css.press('ControlOrMeta+Shift+z');
  await expect(css).toContainText('color: red;');
  await page.screenshot({ path: testInfo.outputPath('codejar.png'), fullPage: true });
});

test('OPFS history restores imported samples while localStorage retains edits', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const editor = page.getByRole('textbox', { name: 'HTMLコード' });
  const height = await editor.evaluate(el => el.clientHeight);
  await page.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('読み込み履歴はまだありません');
  await page.getByRole('button', { name: '履歴を閉じる' }).click();
  const source = '<p class="text-pink-600">履歴のサンプル</p>';
  const urls = await page.evaluate(async html => {
    const { encode } = await import('/src/codec.ts');
    return encode({ html, css: 'p { padding: 8px; }' }, location.origin + '/');
  }, source);
  await page.goto(urls[0], { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#status')).toContainText('コードを復元しました');
  await page.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.getByRole('button', { name: '履歴を閉じる' }).click();
  await editor.fill('<p>編集途中</p>');
  await page.locator('#title').fill('作業中');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tailwind-qr:draft:v1')!).title)).toBe('作業中');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(editor).toHaveJSProperty('textContent', '<p>編集途中</p>');
  await expect(page.locator('#title')).toHaveValue('作業中');
  await page.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('history-mobile.png'), fullPage: true });
  await page.locator('.history-entry').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(editor).toHaveJSProperty('textContent', source);
  expect(await editor.evaluate(el => el.clientHeight)).toBe(height);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(editor).toHaveJSProperty('textContent', source);
  await page.goto(urls[0], { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#status')).toContainText('コードを復元しました');
  await page.getByRole('button', { name: '履歴', exact: true }).click();
  await expect(page.locator('.history-entry')).toHaveCount(1);
});

test('unavailable OPFS does not block QR restore or draft saving', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator.storage, 'getDirectory', { value: undefined }); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const urls = await page.evaluate(async () => {
    const { encode } = await import('/src/codec.ts');
    return encode({ html: '<p>復元可能</p>', css: '' }, location.origin + '/');
  });
  await page.goto(urls[0], { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#status')).toContainText('履歴を端末に保存できません');
  await expect(page.locator('#html')).toHaveJSProperty('textContent', '<p>復元可能</p>');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#html')).toHaveJSProperty('textContent', '<p>復元可能</p>');
});

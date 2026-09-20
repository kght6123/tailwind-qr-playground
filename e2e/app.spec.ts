import { test, expect } from '@playwright/test';

test('renders Tailwind and isolates untrusted preview content', async ({ page }, testInfo) => {
  await page.goto('/');
  const preview = page.frameLocator('#preview');
  await expect(preview.locator('h1')).toHaveCSS('font-size', '30px');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('evil.test')) requests.push(request.url()); });
  await page.getByLabel('HTMLコード').fill('<script>parent.document.body.dataset.pwned="yes"</script><img src="https://evil.test/a" onerror="alert(1)"><p class="text-3xl font-bold">安全な表示</p>');
  await expect(preview.locator('p')).toHaveText('安全な表示');
  await expect(preview.locator('p')).toHaveCSS('font-weight', '700');
  expect(await page.locator('body').getAttribute('data-pwned')).toBeNull();
  expect(requests).toEqual([]);
});

test('exports one PNG and restores every fragment from that image', async ({ page }, testInfo) => {
  await page.goto('/');
  const source = Array.from({ length: 110 }, (_, i) => `<p class="p-${i % 8}">${i} 日本語 ${Math.sin(i).toString(36)}</p>`).join('\n');
  await page.getByLabel('HTMLコード').fill(source);
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
  await expect(page.getByLabel('HTMLコード')).toHaveValue(source);
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
  await expect(page.getByLabel('HTMLコード')).toBeVisible();
  await page.getByRole('button', { name: 'プレビュー', exact: true }).click();
  await expect(page.locator('#preview')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'QRを読み込む', exact: true }).click();
  await page.getByRole('button', { name: '残りのQRをカメラで読む' }).click();
  await expect(page.locator('#status')).toContainText('許可されていません');
  await expect(page.locator('#image-input')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reads subsequent QR frames in-browser and stops camera after reconstruction', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Synthetic captureStream camera is tested on Chromium.');
  await page.goto('/');
  const source = Array.from({ length: 100 }, (_, i) => `<p>${i}-${Math.sin(i).toString(36)}-カメラ</p>`).join('');
  const urls = await page.evaluate(async source => {
    const { encode } = await import('/src/codec.ts');
    return encode({ html: source, css: '' }, location.origin + '/');
  }, source);
  expect(urls.length).toBeGreaterThan(1);
  await page.goto(urls[0]);
  await expect(page.locator('#progress')).toContainText(`1 / ${urls.length}`);
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 800;
    const stream = canvas.captureStream(10);
    Object.assign(window, { cameraCanvas: canvas, cameraStream: stream });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => stream });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
    canvas.getContext('2d')!.fillRect(0, 0, 800, 800);
  });
  await page.getByRole('button', { name: '残りのQRをカメラで読む' }).click();
  for (let i = 1; i < urls.length; i++) {
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
  await expect(page.getByLabel('HTMLコード')).toHaveValue(source);
  expect(await page.evaluate(() => (window as any).cameraStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('#camera-view')).toBeHidden();
});

test('native editors highlight HTML and CSS while keeping text and scrolling aligned', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const source = '<!-- 日本語 -->\n' + '<p class="text-green-600">長い文章とHTML &amp; CSS</p>\n'.repeat(50);
  await page.getByLabel('HTMLコード').fill(source);
  await expect(page.locator('.html-pane .token.tag').first()).toBeVisible();
  await expect(page.locator('.html-pane .code-highlight')).toHaveText(source + '\n');
  const dimensions = await page.locator('#html').evaluate(editor => {
    const input = editor as HTMLTextAreaElement;
    const backdrop = input.previousElementSibling as HTMLElement;
    input.scrollTop = input.scrollHeight;
    input.dispatchEvent(new Event('scroll'));
    return { inputHeight: input.scrollHeight, highlightedHeight: backdrop.scrollHeight, inputScroll: input.scrollTop, highlightedScroll: backdrop.scrollTop };
  });
  expect(dimensions.highlightedHeight).toBe(dimensions.inputHeight);
  expect(dimensions.highlightedScroll).toBe(dimensions.inputScroll);
  await page.getByRole('button', { name: 'CSS', exact: true }).click();
  await page.getByLabel('CSSコード').fill('/* 日本語 */\np { color: red; }');
  await expect(page.locator('.css-pane .token.property')).toHaveText('color');
  await expect(page.getByLabel('CSSコード')).toHaveValue('/* 日本語 */\np { color: red; }');
  await expect.poll(() => page.locator('.css-pane .code-highlight').evaluate(el => el.clientWidth)).toBe(await page.locator('#css').evaluate(el => el.clientWidth));
  await page.screenshot({ path: testInfo.outputPath('highlight.png'), fullPage: true });
});

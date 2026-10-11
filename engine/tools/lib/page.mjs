// Opens a video's player headless (export mode) for a format + size. Shared by stills and export.
import puppeteer from 'puppeteer-core';
import { serve } from '../serve.mjs';
import { findChrome } from './chrome.mjs';
import { resolveSize } from '../../js/formats.js';

export async function openPlayer(project, { format = 'landscape', size = '1080p', timeout = 120000 } = {}) {
  resolveSize(format, size); // throws on a bad format / size before Chrome starts
  const { srv, url } = await serve(project);
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    protocolTimeout: 900000,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => ['error', 'warning', 'warn'].includes(m.type()) && console.log(`[page ${m.type()}]`, m.text()));
  // an uncaught page error before the player is ready (e.g. a scene throwing at load) fails fast
  let failBoot;
  const booted = new Promise((_, rej) => (failBoot = rej));
  page.on('pageerror', (e) => { console.log('[pageerror]', e.message); failBoot(new Error(e.message)); });
  try {
    await page.goto(`${url}/index.html?export=1&format=${encodeURIComponent(format)}&size=${encodeURIComponent(size)}`);
    await Promise.race([page.waitForFunction('window.__ready === true', { timeout }), booted]);
  } catch (e) {
    await browser.close();
    srv.close();
    throw new Error(`player did not start: ${e.message}`);
  }
  booted.catch(() => {});
  const info = await page.evaluate(() => ({ duration: window.__duration, size: window.__size, format: window.__format, scenes: window.__scenes }));
  const close = async () => { await browser.close(); srv.close(); };
  return { page, info, close };
}

/** renders frame t and returns the JPEG bytes */
export async function frameJpeg(page, t, q = 0.92) {
  const data = await page.evaluate((tt, qq) => window.__frameJPEG(tt, qq), t, q);
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}

/** renders frame t and returns the PNG bytes (lossless; useful for pixel-diff reference stills) */
export async function framePng(page, t) {
  const data = await page.evaluate((tt) => window.__framePNG(tt), t);
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}

/** renders frame t and returns all sticker bboxes in design units [{x0,y0,x1,y1,scene}] */
export async function frameBoxes(page, t) {
  return page.evaluate((tt) => window.__frameBoxes(tt), t);
}

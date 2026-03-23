// ESM module
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = './assets/output';
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Capture a screenshot of the given HTML.
 * @param {string} html      - Fully rendered HTML string (with <base> tag for resource resolution)
 * @param {string} jobId     - Job ID used for output filename
 * @param {object} opts      - { width, height, scale } — template canvas dimensions + pixel ratio
 */
export async function captureScreenshot(html, jobId, opts = {}) {
  const width  = opts.width  || 1080;
  const height = opts.height || 1920;
  const scale  = opts.scale  || 2;   // 2x for retina-quality output

  let browser;

  const tryCapture = async () => {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
    });
    const page = await browser.newPage();

    // Match template canvas exactly; use scale for higher DPI output
    await page.setViewport({ width, height, deviceScaleFactor: scale });

    // Load HTML — <base> tag inside the HTML ensures CSS/SVG/fonts resolve via localhost
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for web fonts (Poppins etc.) to finish loading
    await page.evaluate(() => document.fonts.ready);

    // Wait for all images to decode
    await page.evaluate(() =>
      Promise.all(
        [...document.images].map(img =>
          img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })
        )
      )
    );

    // Capture exactly the template canvas (not the whole browser viewport)
    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height }
    });

    return screenshot;
  };

  let screenshot;
  try {
    screenshot = await tryCapture();
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    // Retry once without scale if first attempt fails
    screenshot = await tryCapture();
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Output filename encodes actual pixel dimensions for clarity
  const filename = `${jobId}_${width * scale}x${height * scale}.png`;
  const outputPath = join(OUTPUT_DIR, filename);
  writeFileSync(outputPath, screenshot);

  return { filename, path: outputPath };
}

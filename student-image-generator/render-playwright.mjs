import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const WIDTH = 1080;
const HEIGHT = 1920;

function formatDate(dateLabel) {
  const m = String(dateLabel || '').match(/(\d+)\/(\d+)/);
  if (!m) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const year = new Date().getFullYear();
  return `${year}${m[1].padStart(2, '0')}${m[2].padStart(2, '0')}`;
}

async function main() {
  const dataPath = process.argv[2] || path.resolve('sample-data.json');
  const outDir = process.argv[3] || path.resolve('out');

  const raw = await fs.readFile(dataPath, 'utf-8');
  const data = JSON.parse(raw);
  await fs.mkdir(outDir, { recursive: true });

  const templatePath = path.resolve('template.html');
  const htmlTemplate = await fs.readFile(templatePath, 'utf-8');
  const injected = htmlTemplate.replace(
    'render(window.__SCHEDULE_DATA__ || {',
    `window.__SCHEDULE_DATA__ = ${JSON.stringify(data)};\n    render(window.__SCHEDULE_DATA__ || {`
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  await page.setContent(injected, { waitUntil: 'networkidle' });
  await page.waitForTimeout(120);

  const studentId = String(data.studentId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const ymd = formatDate(data.dateLabel);
  const filename = `schedule_${studentId}_${ymd}.png`;
  const outPath = path.resolve(outDir, filename);

  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();

  console.log(outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

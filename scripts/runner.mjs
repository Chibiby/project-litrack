import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'screenshots');
const SCRIPT_LOG_PATH = path.join(SCREENSHOTS_DIR, 'SCRIPT_LOG.md');

let browser;
let context;
let page;

export function appendLog({ stepNum, screenName, elementLabel, coords, value, beforeImg, afterImg }) {
  const coordsStr = coords ? `(${Math.round(coords.x)}, ${Math.round(coords.y)})` : '-';
  const row = `| ${stepNum} | ${screenName} | ${elementLabel || '-'} | ${coordsStr} | ${value || '-'} | [${beforeImg}](./${beforeImg}) | [${afterImg}](./${afterImg}) |\n`;
  fs.appendFileSync(SCRIPT_LOG_PATH, row, 'utf-8');
}

export async function waitForCleanLoad(p) {
  await p.waitForLoadState('networkidle').catch(() => {});
  // Wait for loading spinners to disappear
  await p.waitForTimeout(800);
}

async function initBrowser() {
  console.log('Launching browser (headed, 1920x1080)...');
  browser = await chromium.launch({
    headless: false,
    args: [
      '--window-size=1920,1080',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  });

  page = await context.newPage();
  console.log('Browser initialized successfully.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        
        if (url.pathname === '/navigate') {
          console.log(`Navigating to ${data.url}...`);
          await page.goto(data.url, { waitUntil: 'domcontentloaded' });
          await waitForCleanLoad(page);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, currentUrl: page.url() }));
          return;
        }

        if (url.pathname === '/screenshot') {
          const imgName = data.name.endsWith('.png') ? data.name : `${data.name}.png`;
          const filePath = path.join(SCREENSHOTS_DIR, imgName);
          await waitForCleanLoad(page);
          await page.screenshot({ path: filePath, fullPage: false });
          console.log(`Captured: ${imgName}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: filePath, name: imgName }));
          return;
        }

        if (url.pathname === '/run-file') {
          const targetPath = path.resolve(ROOT_DIR, data.file);
          console.log(`Executing step file: ${targetPath}`);
          const fileUrl = pathToFileURL(targetPath).href + `?t=${Date.now()}`;
          const mod = await import(fileUrl);
          const result = await mod.default({
            page,
            context,
            browser,
            appendLog,
            waitForCleanLoad,
            SCREENSHOTS_DIR,
            payload: data.payload || {}
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        console.error('Server error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, stack: err.stack }));
      }
    });
  } else if (req.method === 'GET') {
    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        url: page ? page.url() : null,
        title: page ? await page.title() : null
      }));
      return;
    }
    res.writeHead(200);
    res.end('Runner OK');
  }
});

const PORT = 3333;
server.listen(PORT, async () => {
  console.log(`Runner server listening on http://127.0.0.1:${PORT}`);
  await initBrowser();
});

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

export async function withCapturePage(directory, action, port = 4189) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--configLoader', 'runner', '--outDir', directory,
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe', windowsHide: true });
  const log = { text: '' };
  server.stdout.on('data', data => { log.text += data; }); server.stderr.on('data', data => { log.text += data; });
  let browser;
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitForPreview(server, url, log);
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(`${url}/?capture=1`);
    await assertProvenance(url);
    await page.waitForFunction(() => window.__assetCapture, undefined, { timeout: 60000 });
    return await action(page, browser);
  } finally { await browser?.close(); server.kill(); }
}

/** Poll the preview for up to 30 seconds; a server that exits first fails with its log. */
async function waitForPreview(server, url, log) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(log.text);
    if (await responds(url)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Preview did not start: ${log.text}`);
}

async function responds(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

/** In CI the previewed build must be the commit being published. */
async function assertProvenance(url) {
  const provenance = await (await fetch(`${url}/build.json`)).json();
  if (process.env.DEPLOY_SHA && provenance.commit !== process.env.DEPLOY_SHA) throw new Error('Build provenance mismatch');
}

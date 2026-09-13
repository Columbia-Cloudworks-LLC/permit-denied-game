import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

export async function withCapturePage(directory, action, port = 4189) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--configLoader', 'runner', '--outDir', directory,
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe', windowsHide: true });
  let logs = '', browser;
  server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  try {
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Preview did not start: ${logs}`);
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    await page.goto(`${url}/?capture=1`);
    const provenance = await (await fetch(`${url}/build.json`)).json();
    if (process.env.DEPLOY_SHA && provenance.commit !== process.env.DEPLOY_SHA) throw new Error('Build provenance mismatch');
    await page.waitForFunction(() => window.__assetCapture, undefined, { timeout: 60000 });
    return await action(page, browser);
  } finally { await browser?.close(); server.kill(); }
}

// QA harness: vim mode indicator end-to-end (badge + caret + blur behavior).
// Runs the real frontend in headless Chromium; Tauri IPC is mocked IN-BROWSER
// only (addInitScript) — no app source changes. See README.md for setup/run.
import { chromium } from "playwright-core";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.MTT_URL ?? "http://localhost:1420";
const SHOTS = new URL("./shots/", import.meta.url);
const shot = (name) => fileURLToPath(new URL(name, SHOTS));
fs.mkdirSync(SHOTS, { recursive: true });

const MOCK = `
(() => {
  window.__qa_errors = [];
  const _e = console.error;
  console.error = (...a) => { window.__qa_errors.push(a.map(String).join(' ')); _e(...a); };
  addEventListener('error', e => window.__qa_errors.push('uncaught: ' + e.message));
  addEventListener('unhandledrejection', e => window.__qa_errors.push('rejection: ' + String(e.reason)));

  let cbId = 0;
  let evId = 0;
  const job = {
    id: 'job-qa-1', project_id: 'p1', space_id: 's1', folder_id: null,
    file_path: '/tmp/qa-demo.mp4', status: 'done',
    whisper_model: 'mlx-community/Qwen3-ASR-1.7B-bf16',
    created_at: 1700000000, title: 'QA Meeting', duration_secs: 60,
  };
  const segments = [
    { id: 1, job_id: 'job-qa-1', idx: 0, start: 0, end: 5, text: 'สวัสดีครับ ทดสอบระบบ', corrected_text: null, suspect: false },
    { id: 2, job_id: 'job-qa-1', idx: 1, start: 5, end: 10, text: 'hello vim mode QA', corrected_text: null, suspect: false },
  ];
  window.__tauri_calls = [];
  const handlers = {
    'list_spaces': () => [{ id: 's1', name: 'QA Space', created_at: 1700000000, pinned: true }],
    'list_folders': () => [],
    'list_jobs_by_space': () => [job],
    'list_jobs_by_project': () => [job],
    'get_job': () => job,
    'get_segments': () => segments,
    'get_segments_since': () => [],
    'get_job_notes': () => '<p>hello notes</p>',
    'save_job_notes': () => null,
    'get_ai_config': () => null,
    'get_storage_info': () => ({ path: '/tmp/qa', size_bytes: 1024 }),
    'get_whisper_model': () => 'mlx-community/Qwen3-ASR-1.7B-bf16',
    'save_whisper_model': () => null,
    'get_job_summary': () => null,
    'plugin:event|listen': () => ++evId,
    'plugin:event|unlisten': () => null,
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb, once) { const id = ++cbId; window['_' + id] = cb; return id; },
    unregisterCallback(id) { delete window['_' + id]; },
    convertFileSrc(p) { return '${BASE}/__nonexistent__' + p; },
    async invoke(cmd, args) {
      window.__tauri_calls.push(cmd);
      if (cmd in handlers) return handlers[cmd](args);
      return null;
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
})();
`;

const state = (page) => page.evaluate(() => {
  const badge = [...document.querySelectorAll('span')].find(s => ['NORMAL', 'INSERT'].includes(s.textContent));
  const ed = document.querySelector('.tiptap');
  return {
    badge: badge ? badge.textContent : null,
    badgeClasses: badge ? badge.className : null,
    caret: ed ? getComputedStyle(ed).caretColor : null,
    editorClasses: ed ? ed.className.split(' ').filter(c => c.startsWith('vim-') || c === 'tiptap' || c === 'ProseMirror') : null,
    editorFocused: ed ? document.activeElement === ed : null,
    editorText: ed ? ed.innerText.slice(0, 60) : null,
    vimModeSetting: JSON.parse(localStorage.getItem('mtt-editor') || '{}')?.state?.vimMode,
    qaErrors: window.__qa_errors,
  };
});

const log = (...a) => console.log(...a);
let failures = 0;
const check = (name, cond, detail) => {
  log(cond ? `PASS ${name}` : `FAIL ${name}`, JSON.stringify(detail));
  if (!cond) failures++;
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(MOCK);
const page = await ctx.newPage();
page.on('pageerror', e => log('PAGEERROR:', e.message));

await page.goto(`${BASE}/spaces/s1/jobs/job-qa-1`);
await page.waitForSelector('.tiptap', { timeout: 15000 });
await page.waitForTimeout(600);
log('INITIAL:', JSON.stringify(await state(page)));

// open Settings, toggle Vim Mode on
const settingsBtn = page.locator('header button:has(svg.lucide-settings)');
await settingsBtn.click();
await page.waitForSelector('button[role="switch"]');
const sw = page.locator('button[role="switch"]');
await sw.click();
// close modal via X
await page.locator('button:has(svg.lucide-x)').first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: shot('00-vim-on-unfocused.png') });
const t0 = await state(page);
check('0 badge hidden before focus', t0.badge === null, t0);

// TEST 1: click editor -> NORMAL amber
await page.locator('.tiptap').click();
await page.waitForTimeout(300);
const t1 = await state(page);
check('1 focus -> NORMAL amber', t1.badge === 'NORMAL' && t1.caret === 'rgb(245, 158, 11)', t1);
await page.screenshot({ path: shot('01-normal.png') });

// TEST 2: press i -> INSERT emerald; Esc -> NORMAL
await page.keyboard.press('i');
await page.waitForTimeout(300);
const t2a = await state(page);
check('2a i -> INSERT emerald', t2a.badge === 'INSERT' && t2a.caret === 'rgb(16, 185, 129)', t2a);
await page.screenshot({ path: shot('02-insert.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const t2b = await state(page);
check('2b Esc -> NORMAL amber', t2b.badge === 'NORMAL' && t2b.caret === 'rgb(245, 158, 11)', t2b);
await page.screenshot({ path: shot('03-normal-again.png') });

// TEST 3: blur -> badge gone; refocus -> badge back matching real mode
await page.locator('h1').first().click();
await page.waitForTimeout(300);
const t3a = await state(page);
check('3a blur -> badge hidden', t3a.badge === null, t3a);
await page.screenshot({ path: shot('04-blur.png') });
await page.locator('.tiptap').click();
await page.waitForTimeout(300);
const t3b = await state(page);
check('3b refocus -> NORMAL (plugin mode preserved)', t3b.badge === 'NORMAL', t3b);
await page.screenshot({ path: shot('05-refocus.png') });

// TEST 5: toggle vim off->on while editor focused — no stale badge
await settingsBtn.click();
await page.waitForSelector('button[role="switch"]');
await sw.click(); // off
await page.waitForTimeout(200);
await sw.click(); // on
await page.locator('button:has(svg.lucide-x)').first().click();
await page.waitForTimeout(700);
const t5 = await state(page);
check('5 toggle off->on: no stale badge until focus', t5.badge === null && t5.editorFocused === false, t5);
await page.screenshot({ path: shot('06-toggle-off-on.png') });

// TEST 4: vim off -> badge gone, typing works, caret default
await settingsBtn.click();
await page.waitForSelector('button[role="switch"]');
await sw.click(); // off
await page.locator('button:has(svg.lucide-x)').first().click();
await page.waitForTimeout(700);
await page.locator('.tiptap').click();
await page.keyboard.press('End');
await page.keyboard.type(' plain typing 123');
await page.waitForTimeout(300);
const t4 = await state(page);
check('4 vim off: no badge, typing works', t4.badge === null && t4.editorText.includes('plain typing 123'), t4);
await page.screenshot({ path: shot('07-vim-off-typed.png') });

const errs = await page.evaluate(() => window.__qa_errors);
check('console errors', errs.length === 0, errs);
await browser.close();
log(failures === 0 ? 'RESULT: ALL PASS' : `RESULT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
// QA harness: block-based j/k navigation + vim goal-column semantics,
// plus indicator regression checks (i/Esc/badge/caret/blur).
// Cursor placement is keyboard-only (g/0/l) — DOM-Range placement gets
// re-normalized by ProseMirror on focus. See README.md for setup/run.
import { chromium } from "playwright-core";

const BASE = process.env.MTT_URL ?? "http://localhost:1420";

const NOTES = '<h2>Head</h2><p>alpha one two three</p><p>ab</p><p>charlie three four five</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>task item text here</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>second task</p></div></li></ul><p>last line long enough</p>';

const MOCK = `
(() => {
  window.__qa_errors = [];
  const _e = console.error;
  console.error = (...a) => { window.__qa_errors.push(a.map(String).join(' ')); _e(...a); };
  addEventListener('error', e => window.__qa_errors.push('uncaught: ' + e.message));
  addEventListener('unhandledrejection', e => window.__qa_errors.push('rejection: ' + String(e.reason)));
  const job = { id: 'job-qa-1', project_id: 'p1', space_id: 's1', folder_id: null, file_path: '/tmp/x.mp4', status: 'done', whisper_model: 'm', created_at: 1700000000, title: 'QA Meeting', duration_secs: 60 };
  const handlers = {
    'list_spaces': () => [{ id: 's1', name: 'QA Space', created_at: 1700000000, pinned: true }],
    'list_folders': () => [], 'list_jobs_by_space': () => [job], 'list_jobs_by_project': () => [job],
    'get_job': () => job, 'get_segments': () => [], 'get_segments_since': () => [],
    'get_job_notes': () => ${JSON.stringify(NOTES)},
    'save_job_notes': () => null, 'get_ai_config': () => null,
    'get_storage_info': () => ({ path: '/tmp', size_bytes: 1 }),
    'get_whisper_model': () => 'm', 'save_whisper_model': () => null, 'get_job_summary': () => null,
    'plugin:event|listen': () => 1, 'plugin:event|unlisten': () => null,
  };
  let cbId = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) { const id = ++cbId; window['_' + id] = cb; return id; },
    unregisterCallback(id) { delete window['_' + id]; },
    convertFileSrc(p) { return '${BASE}/__x__' + p; },
    async invoke(cmd, args) { return cmd in handlers ? handlers[cmd](args) : null; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
})();
`;

const cursor = (page) => page.evaluate(() => {
  const sel = window.getSelection();
  const ed = document.querySelector('.tiptap');
  let node = sel?.anchorNode;
  let el = node?.nodeType === 3 ? node.parentElement : node;
  const block = el?.closest?.('p, h1, h2, h3');
  return {
    block: block?.textContent ?? null,
    off: sel?.anchorOffset ?? null,
    badge: [...document.querySelectorAll('span')].find(s => ['NORMAL','INSERT'].includes(s.textContent))?.textContent ?? null,
    caret: getComputedStyle(ed).caretColor,
  };
});

let failures = 0;
// Press a key, then assert cursor block/offset (and optionally badge/caret).
const expect = async (page, key, block, off, extra = {}) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
  const c = await cursor(page);
  const ok = c.block === block && c.off === off
    && (extra.badge === undefined || c.badge === extra.badge)
    && (extra.caret === undefined || c.caret === extra.caret);
  console.log(ok ? 'PASS' : 'FAIL', `${key} -> expected ${JSON.stringify({ block, off, ...extra })} got ${JSON.stringify(c)}`);
  if (!ok) failures++;
  return c;
};
const AMBER = 'rgb(245, 158, 11)';
const EMERALD = 'rgb(16, 185, 129)';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(MOCK);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto(`${BASE}/spaces/s1/jobs/job-qa-1`);
await page.waitForSelector('.tiptap', { timeout: 15000 });
await page.waitForTimeout(500);
await page.locator('header button:has(svg.lucide-settings)').click();
await page.waitForSelector('button[role="switch"]');
await page.locator('button[role="switch"]').click();
await page.locator('button:has(svg.lucide-x)').first().click();
await page.waitForTimeout(600);

// blocks: Head(h2,4) | alpha one two three(19) | ab(2) | charlie three four five(23) | task item text here(19) | second task(11) | last line long enough(21)
await page.locator('.tiptap').click();
await page.waitForTimeout(200);
// deterministic placement: g (top), j j j -> charlie@0, l x8 -> charlie@8
await expect(page, 'g', 'Head', 0);
await expect(page, 'j', 'alpha one two three', 0);
await expect(page, 'j', 'ab', 0);
await expect(page, 'j', 'charlie three four five', 0);
for (let i = 0; i < 8; i++) await page.keyboard.press('l');
await page.waitForTimeout(150);

// k streak — charlie@8 -> ab@2 (clamp) -> alpha@8 (restore) -> Head@4 (clamp) -> no-op
await expect(page, 'k', 'ab', 2);
await expect(page, 'k', 'alpha one two three', 8);
await expect(page, 'k', 'Head', 4);
await expect(page, 'k', 'Head', 4); // no-op at first block
// j streak back — Head@4 -> alpha@8 -> ab@2 -> charlie@8
await expect(page, 'j', 'alpha one two three', 8);
await expect(page, 'j', 'ab', 2);
await expect(page, 'j', 'charlie three four five', 8);
// into task items item-by-item and out to last; no-op at last
await expect(page, 'j', 'task item text here', 8);
await expect(page, 'j', 'second task', 8);
await expect(page, 'j', 'last line long enough', 8);
await expect(page, 'j', 'last line long enough', 8); // no-op at last block
// k back up through tasks
await expect(page, 'k', 'second task', 8);
await expect(page, 'k', 'task item text here', 8);
await expect(page, 'k', 'charlie three four five', 8);
// ArrowDown/ArrowUp aliases share the streak
await expect(page, 'ArrowDown', 'task item text here', 8);
await expect(page, 'j', 'second task', 8);
await expect(page, 'ArrowUp', 'task item text here', 8);
// Reset on other command: l makes col 9, k captures 9, clamp/restore
await expect(page, 'k', 'charlie three four five', 8);
await expect(page, 'l', 'charlie three four five', 9);
await expect(page, 'k', 'ab', 2);
await expect(page, 'j', 'charlie three four five', 9);
// Reset on mousedown: click near start of alpha, then j uses fresh goal
await page.locator('.tiptap p').first().click({ position: { x: 5, y: 8 } });
await page.waitForTimeout(200);
await expect(page, 'j', 'ab', 1);
// Regression: indicator i/Esc/blur/refocus
await expect(page, 'i', 'ab', 1, { badge: 'INSERT', caret: EMERALD });
await expect(page, 'Escape', 'ab', 1, { badge: 'NORMAL', caret: AMBER });
await page.locator('h1').first().click();
await page.waitForTimeout(200);
const blur = await cursor(page);
const blurOk = blur.badge === null;
console.log(blurOk ? 'PASS' : 'FAIL', 'blur -> badge hidden', JSON.stringify(blur));
if (!blurOk) failures++;
await page.locator('.tiptap p').first().click();
await page.waitForTimeout(200);
const refocus = await cursor(page);
const refocusOk = refocus.badge === 'NORMAL' && refocus.caret === AMBER;
console.log(refocusOk ? 'PASS' : 'FAIL', 'refocus -> NORMAL amber', JSON.stringify(refocus));
if (!refocusOk) failures++;

const errs = await page.evaluate(() => window.__qa_errors);
console.log(errs.length === 0 ? 'PASS' : 'FAIL', 'console errors', JSON.stringify(errs));
if (errs.length) failures++;
await browser.close();
console.log(failures === 0 ? 'RESULT: ALL PASS' : `RESULT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
/**
 * The build stamp must be honest: it should show the build that is actually
 * running, and must flag itself when that is not the deployed build.
 *
 *   node tests/build-stamp.test.mjs   -> exits 0 on success, 1 on failure
 *
 * Why this matters. index.html is served network-first by the service worker
 * but falls back to cache when offline, and version.js is deliberately NOT in
 * the service worker's STATIC_FILES so it is never cached. That combination is
 * what makes the self-check below meaningful: a cached page plus a fresh
 * version.js means the user is looking at stale code, and the stamp says so
 * instead of quietly displaying a plausible-looking wrong number.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'version.js'), 'utf8');
const SW = readFileSync(join(ROOT, 'sw.js'), 'utf8');

let pass = 0, fail = 0;
const chk = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); };

const declared = (SRC.match(/BUILD_ID\s*=\s*'([^']*)'/) || [])[1];

/** Run version.js against a stub DOM. `served` is what the network returns. */
async function run(served) {
  const body = { children: [], appendChild(e) { this.children.push(e); } };
  const last = () => body.children[body.children.length - 1];
  const doc = {
    body,
    readyState: 'complete',
    querySelector: () => last(),
    createElement: () => ({ style: {}, className: '' }),
    addEventListener() {},
  };
  const fetchImpl = served === null
    ? () => Promise.reject(new Error('offline'))
    : () => Promise.resolve({ ok: true, text: () => Promise.resolve(served) });
  new Function('document', 'fetch', 'window', SRC)(doc, fetchImpl, {});
  await new Promise(r => setTimeout(r, 10));
  return last();
}

console.log('\n[1] BUILD_ID is declared and is a git short SHA');
{
  chk(!!declared, `BUILD_ID is present (${declared})`);
  chk(/^[0-9a-f]{7,}$/.test(declared), 'looks like a git short SHA');
}

console.log('\n[2] version.js must stay out of the service-worker cache');
{
  // If it were cached, the self-check in section 5 could never detect a stale
  // page, which is the whole reason it lives in its own file.
  chk(!/\/version\.js/.test(SW), 'sw.js STATIC_FILES does not list version.js');
}

console.log('\n[3] every page loads version.js, and its path resolves to it');
for (const f of ['index.html', 'Summarizer.html', 'BBB-Stats.html', 'dashboard/index.html']) {
  const html = readFileSync(join(ROOT, f), 'utf8');
  const m = html.match(/<script src="([^"]*version\.js)\?v=\d+"><\/script>/);
  chk(!!m, `${f} loads it with a cache-buster`);
  if (m) {
    // Resolve the relative src against the page's own directory and require it
    // to land on the repo-root version.js. A bare "version.js" inside dashboard/
    // resolves to dashboard/version.js, which does not exist; Cloudflare's HTML
    // fallback then hands index.html to a <script> tag and the stamp dies
    // silently. The old literal-string check passed straight through that, so
    // the dashboard ran without a stamp until the ../ was added.
    const resolved = join(dirname(f), m[1]);
    chk(resolved === 'version.js', `${f} resolves to version.js (got ${resolved})`);
  }
}

console.log('\n[4] the stamp reports the running build');
{
  const el = await run(`const BUILD_ID = '${declared}';`);
  chk(el.textContent === `Build ${declared}`, `shows "Build ${declared}"`);
  chk(!el.onclick, 'is not tappable when current');
}

console.log('\n[5] a stale page against a fresh version.js is detected');
{
  const el = await run(`const BUILD_ID = '${declared}999';`);
  chk(/update available/.test(el.textContent), 'announces "update available"');
  chk(!!el.onclick, 'is tappable to reload');
}

console.log('\n[6] offline shows the cached build honestly, with no false alarm');
{
  const el = await run(null);
  chk(el.textContent === `Build ${declared}`, 'still shows the running build');
  chk(!/update available/.test(el.textContent), 'does not claim an update it cannot verify');
  chk(!el.onclick, 'is not tappable');
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
process.exit(fail ? 1 : 0);
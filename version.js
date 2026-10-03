// version.js — build identity, shown in the footer of every page.
//
// Deliberately NOT listed in STATIC_FILES in sw.js, so it is never served from
// the service-worker cache and always reflects what is actually deployed. Pages
// load it with a cache-busting query so the HTTP cache cannot reuse it either.
//
// The BUILD_ID below is the only place a build number exists. `npm run stamp`
// rewrites it from git HEAD; run that after committing app code, then commit
// the result. Because the stamp commit touches only this file, the displayed
// SHA identifies the app code exactly.
const BUILD_ID = 'fc16a5c';

(function () {
  var STAMP_CLASS = 'build-stamp';

  function stamp() {
    return document.querySelector('.' + STAMP_CLASS);
  }

  function render(stale) {
    var el = stamp();
    if (!el) {
      el = document.createElement('div');
      el.className = STAMP_CLASS;
      // Injected here rather than added to four stylesheets.
      el.style.cssText = [
        'margin:1.25rem auto 0.75rem',
        'padding:0 1rem',
        'text-align:center',
        'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        'color:#8a8f98',
        'opacity:0.75',
        'user-select:none',
      ].join(';');
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = 'Build ' + BUILD_ID + (stale ? ' · update available' : '');
    if (stale) {
      el.style.color = '#c8a02a';
      el.style.opacity = '1';
      el.style.cursor = 'pointer';
      el.title = 'Tap to load the latest version';
      el.onclick = function () { location.reload(); };
    }
    return el;
  }

  function start() {
    render(false);

    // Confirm the build we are displaying is still the deployed one. The service
    // worker is network-first for index.html but falls back to cache when
    // offline, so a cached page plus a fresh version.js means the user is
    // looking at stale code. Say so instead of silently showing a wrong number.
    fetch('version.js?probe=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var m = txt.match(/BUILD_ID\s*=\s*'([^']*)'/);
        if (m && m[1] && m[1] !== BUILD_ID) render(true);
      })
      .catch(function () {
        // Offline. The cached build is all there is, and the number shown is the
        // number of that cached build -- which is the honest thing to display.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
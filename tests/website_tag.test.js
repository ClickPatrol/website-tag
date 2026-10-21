// Runs website-tag.js against a small fake browser. Mirrors the scenarios in
// ClickPatrol/google-tag-manager tests so the snippet stays on the gallery
// contract. Usage: node tests/website_tag.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'website-tag.js'), 'utf8');
const match = html.match(/^<script>$([\s\S]*)^<\/script>$/m);
if (!match) throw new Error('no <script> block in website-tag.js');
const baseCode = match[1];

function makeWorld() {
  return { cookies: {}, ls: {}, win: {} };
}

function run(world, opts) {
  opts = opts || {};
  const url = new URL(opts.href || 'https://www.example.com/page');
  const injected = [];
  const listeners = {};
  const timeouts = [];

  const document = {
    readyState: opts.readyState || '',
    get cookie() {
      return Object.keys(world.cookies).map((k) => k + '=' + world.cookies[k]).join('; ');
    },
    set cookie(str) {
      const parts = str.split(';').map((s) => s.trim());
      const eq = parts[0].indexOf('=');
      const name = parts[0].substring(0, eq);
      const value = parts[0].substring(eq + 1);
      const attrs = parts.slice(1).join(';').toLowerCase();
      const domain = (attrs.match(/domain=([^;]+)/) || [])[1];
      if (domain === 'com') return;
      if (/expires=thu, 01 jan 1970/.test(attrs) || /max-age=(0|-)/.test(attrs)) {
        delete world.cookies[name];
        return;
      }
      world.cookies[name] = value;
      world.cookieAttrs = world.cookieAttrs || {};
      world.cookieAttrs[name] = attrs;
    },
    getElementById: () => null,
    getElementsByTagName: () => [],
    createElement: () => ({}),
    head: { appendChild: (el) => injected.push(el.src) },
  };

  const win = world.win;
  win.dataLayer = win.dataLayer || [];
  if (opts.preDataLayer) win.dataLayer.push.apply(win.dataLayer, opts.preDataLayer);
  win.localStorage = {
    getItem: (k) => (k in world.ls ? world.ls[k] : null),
    setItem: (k, v) => { world.ls[k] = String(v); },
    removeItem: (k) => { delete world.ls[k]; },
  };
  win.addEventListener = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  win.setTimeout = (fn) => { timeouts.push(fn); return 1; };
  const history = { pushState: () => {} };
  win.history = history;

  let code = baseCode.replace('ENTER-YOUR-UID-HERE', 'TEST-UID-1234');
  if (opts.dedupe === false) code = code.replace('var DEDUPE_CONVERSIONS = true;', 'var DEDUPE_CONVERSIONS = false;');
  if (opts.gclidRecovery) code = code.replace('var GCLID_RECOVERY = false;', 'var GCLID_RECOVERY = true;');
  if (opts.extend) {
    for (const key of opts.extend) {
      code = code.replace(new RegExp('(\\s' + key + ': )false'), '$1true');
    }
  }

  const ctx = {
    window: win,
    document,
    location: {
      hostname: url.hostname,
      search: url.search,
      href: url.href,
      protocol: url.protocol,
    },
    history,
    Date,
    Math,
    JSON,
    String,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: (fn) => { timeouts.push(fn); return 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { injected, win, listeners, timeouts };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}
const trck = (urls) => urls.filter((u) => u.indexOf('https://trck-002.clckptrl.com/') === 0);
const conv = (urls) => urls.filter((u) => u.indexOf('https://conversion.clckptrl.com/') === 0);

// 1. Measurement URL carries visitor_id before session_id, like the gallery.
{
  const w = makeWorld();
  const { injected } = run(w, { href: 'https://www.example.com/page?source=g&gclid=abc123&utm_source=google' });
  const t = trck(injected);
  const ok = t.length === 1 &&
    /^https:\/\/trck-002\.clckptrl\.com\/\?uid=TEST-UID-1234&source=g&gclid=abc123&utm_source=google&u=https%3A%2F%2Fwww\.example\.com%2Fpage%3Fsource%3Dg%26gclid%3Dabc123%26utm_source%3Dgoogle&visitor_id=cp_\d+[0-9a-f]{16}&session_id=cp_\d+[0-9a-f]{16}$/.test(t[0]);
  check('trck-002 URL has uid, query, u, visitor_id, session_id', ok, t[0]);
  check('cp_visitor_id is stored in cookie and localStorage', !!w.cookies.cp_visitor_id && w.ls.cp_visitor_id === w.cookies.cp_visitor_id, '');
  check('cp_visitor_id lives 400 days', /max-age=34560000/.test(w.cookieAttrs.cp_visitor_id), w.cookieAttrs.cp_visitor_id);
  check('cookies go on the registrable domain', /domain=example\.com/.test(w.cookieAttrs.cp_visitor_id), w.cookieAttrs.cp_visitor_id);
}

// 2. Existing visitor and session ids are reused.
{
  const w = makeWorld();
  w.cookies.cp_visitor_id = 'cp_existing_visitor';
  w.ls.cp_session_id = 'cp_stored_session';
  const { injected } = run(w);
  const t = trck(injected)[0] || '';
  check('existing visitor id is reused', t.includes('&visitor_id=cp_existing_visitor&'), t);
  check('session id falls back to localStorage', t.endsWith('&session_id=cp_stored_session'), t);
}

// 3. Classification is stored, then replayed on the next page without trck-002.
{
  const w = makeWorld();
  w.cookies.cp_session_id = 'cp_existing_session';
  const first = run(w, { href: 'https://www.example.com/?gclid=abc' });
  first.win.dataLayer.push({ event: 'ClickPatrol_Suspicious', traffic: 'fake', audience: { legitieme_audience: false } });
  const stored = w.cookies.cp_class ? decodeURIComponent(w.cookies.cp_class) : '';
  check('cp_class stores the click hash', /^1\.S\.f\._session\.[0-9a-z]+\.8j2i1t$/.test(stored), stored);

  w.win = {};
  const second = run(w, { href: 'https://www.example.com/pricing' });
  check('next page replays without trck-002', trck(second.injected).length === 0, second.injected.join(' '));
  const replayed = second.win.dataLayer.filter((i) => i.event === 'ClickPatrol_Suspicious');
  check('replay pushes event, traffic and audience', replayed.length === 1 && replayed[0].traffic === 'fake' && replayed[0].audience && replayed[0].audience.legitieme_audience === false, JSON.stringify(replayed));
  check('replay keeps the click hash on cp_class', decodeURIComponent(w.cookies.cp_class) === stored, decodeURIComponent(w.cookies.cp_class));

  w.win = {};
  const back = run(w, { href: 'https://www.example.com/?gclid=abc' });
  check('the same gclid replays after a page without it', trck(back.injected).length === 0, back.injected.join(' '));

  w.win = {};
  const changed = run(w, { href: 'https://www.example.com/?gclid=xyz' });
  check('a different gclid fetches trck-002 again', trck(changed.injected).length === 1, '');
}

// 4. Conversion already queued before the snippet ran.
{
  const w = makeWorld();
  const { injected } = run(w, { preDataLayer: [{ event: 'ClickPatrol_Conversion', conversion_id: 'order_10042', conversion_type: 'purchase', conversion_value: 189, conversion_currency: 'EUR', conversion_label: 'AbCdEfGhIjk' }] });
  const c = conv(injected);
  check('queued conversion is sent', c.length === 1 && c[0] === 'https://conversion.clckptrl.com/?uid=TEST-UID-1234&conversion_id=order_10042&conversion_label=AbCdEfGhIjk&conversion_value=189&conversion_currency=EUR&conversion_type=TRANSACTION', c[0] || '');
  check('trck-002 still loads on a conversion page', trck(injected).length === 1, '');
}

// 5. Conversion pushed later, and pushed twice on the same page.
{
  const w = makeWorld();
  const { injected, win } = run(w);
  check('no conversion before the push', conv(injected).length === 0, '');
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 'demo_request', conversion_type: 'lead' });
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 'demo_request', conversion_type: 'lead' });
  const c = conv(injected);
  check('later push sends once', c.length === 1 && c[0].endsWith('conversion_id=demo_request&conversion_type=LEAD'), JSON.stringify(c));
  check('cp_conv is marked with the session suffix', w.ls.cp_conv === w.cookies.cp_session_id.slice(-8) + '.demo_request', w.ls.cp_conv);
}

// 6. Refresh in the same session is ignored, unless dedupe is off.
{
  const w = makeWorld();
  const pushed = { event: 'ClickPatrol_Conversion', conversion_id: 'order_1', conversion_type: 'purchase' };
  const a = run(w, { preDataLayer: [Object.assign({}, pushed)] });
  w.win = {};
  const b = run(w, { preDataLayer: [Object.assign({}, pushed)] });
  check('refresh in the same session does not resend', conv(a.injected).length === 1 && conv(b.injected).length === 0, '');

  const w2 = makeWorld();
  run(w2, { dedupe: false, preDataLayer: [Object.assign({}, pushed)] });
  w2.win = {};
  const d = run(w2, { dedupe: false, preDataLayer: [Object.assign({}, pushed)] });
  check('dedupe off sends again after a refresh', conv(d.injected).length === 1, '');
}

// 7. Invalid conversions are ignored.
{
  const w = makeWorld();
  const { injected, win } = run(w);
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 'x', conversion_type: 'signup' });
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_type: 'lead' });
  check('unknown type or missing id sends nothing', conv(injected).length === 0, '');
  check('a conversion push does not write cp_class', !w.cookies.cp_class, '');
}

// 8. Click ids from cookies on a later page.
{
  const w = makeWorld();
  w.cookies._gcl_aw = 'GCL.123.cookieclid';
  w.cookies._gcl_gb = 'GCL.1730000000.wbraidvalue.label';
  w.cookies._gcl_ag = '2.1.k0AAAAA-gbraid$i1730000000$b1';
  w.cookies._fbc = 'fb.1.1700000000.IwAR123';
  w.cookies._uetmsclkid = '_uetabc';
  w.cookies.li_fat_id = 'li123';
  const { injected, win } = run(w);
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 'trial_started', conversion_type: 'lead' });
  const c = conv(injected)[0] || '';
  check('gclid from _gcl_aw without the GCL prefix', c.includes('&gclid=cookieclid'), c);
  check('wbraid is the third segment of _gcl_gb', c.includes('&wbraid=wbraidvalue&'), c);
  check('gbraid is the k field of _gcl_ag', c.includes('&gbraid=0AAAAA-gbraid&'), c);
  check('fbclid from _fbc', c.includes('&fbclid=IwAR123'), c);
  check('msclkid and li_fat_id from cookies', c.includes('&msclkid=_uetabc') && c.includes('&li_fat_id=li123'), c);
}

{
  const w = makeWorld();
  w.cookies._gcl_ag = '2.1.k0AAAAA-gbraid%24i1730000000';
  const { injected, win } = run(w);
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 't', conversion_type: 'lead' });
  const c = conv(injected)[0] || '';
  check('gbraid reads with a percent-encoded separator', c.includes('&gbraid=0AAAAA-gbraid'), c);
}

{
  const w = makeWorld();
  w.cookies._gcl_ag = 'GCL.123.notgbraid';
  w.cookies._gcl_gb = 'rawwbraid';
  const { injected, win } = run(w);
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 't', conversion_type: 'lead' });
  const c = conv(injected)[0] || '';
  check('a mismatched braid cookie is omitted', c && c.indexOf('gbraid=') === -1 && c.indexOf('wbraid=') === -1, c);
}

{
  const w = makeWorld();
  w.cookies._gcl_ag = '2.1.kcookiegbraid$i1730000000';
  w.cookies._gcl_gb = 'GCL.1730000000.cookiewbraid';
  const { injected, win } = run(w, { href: 'https://www.example.com/thanks?gbraid=urlgbraid&wbraid=urlwbraid' });
  win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 't', conversion_type: 'lead', gclid: 'pushclid' });
  const c = conv(injected)[0] || '';
  check('URL braid ids win over cookies', c.includes('&gbraid=urlgbraid') && c.includes('&wbraid=urlwbraid'), c);
  check('a click id in the push wins', c.includes('&gclid=pushclid'), c);
}

// 9. Optional switches stay off by default.
{
  const w = makeWorld();
  w.cookies._ga = 'GA1.1.123.456';
  run(w, { href: 'https://www.example.com/?vd=vdclid' });
  check('no _gcl_aw from vd by default', !w.cookies._gcl_aw, '');
  check('no cookie extension by default', !(w.cookieAttrs || {})._ga, '');
}

{
  const w = makeWorld();
  run(w, { gclidRecovery: true, href: 'https://www.example.com/?vd=vdclid' });
  check('GCLID recovery writes _gcl_aw from vd', /^GCL\.\d+\.vdclid$/.test(w.cookies._gcl_aw || ''), w.cookies._gcl_aw);

  const w2 = makeWorld();
  w2.cookies._gcl_aw = 'GCL.1.realclid';
  run(w2, { gclidRecovery: true, href: 'https://www.example.com/?vd=vdclid' });
  check('GCLID recovery keeps an existing _gcl_aw', w2.cookies._gcl_aw === 'GCL.1.realclid', w2.cookies._gcl_aw);

  const w3 = makeWorld();
  run(w3, { gclidRecovery: true, href: 'https://www.example.com/?gclid=real&vd=vdclid' });
  check('GCLID recovery skips when gclid is present', !w3.cookies._gcl_aw, w3.cookies._gcl_aw);
}

{
  const w = makeWorld();
  w.cookies._gcl_ag = '2.1.k0AAAAA-gbraid$i1730000000';
  w.cookies._ga = 'GA1.1.123.456';
  run(w, { extend: ['googleAds'] });
  check('Google Ads extension rewrites _gcl_ag for 90 days', /max-age=7776000/.test((w.cookieAttrs || {})._gcl_ag || ''), (w.cookieAttrs || {})._gcl_ag);
  check('extension keeps the raw cookie bytes', w.cookies._gcl_ag === '2.1.k0AAAAA-gbraid$i1730000000', w.cookies._gcl_ag);
  check('other groups stay off', !(w.cookieAttrs || {})._ga, '');
}

{
  const w = makeWorld();
  const held = run(w, { readyState: 'loading', href: 'https://www.example.com/page' });
  check('trck-002 waits while the document is still loading', trck(held.injected).length === 0, held.injected.join(' '));
  (held.listeners.load || []).forEach((fn) => fn());
  held.timeouts.splice(0).forEach((fn) => fn());
  check('trck-002 loads after window.load', trck(held.injected).length === 1, held.injected.join(' '));
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail && !r.pass ? '  [' + r.detail + ']' : ''));
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);

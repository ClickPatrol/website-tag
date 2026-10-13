<!--
  ClickPatrol Ad Traffic Quality - standalone <head> snippet
  ==========================================================
  Place this entire <script> in the <head> of every page.
  Replace the UID below with your own ClickPatrol UID
  (found in the ClickPatrol dashboard under Settings).
  Same behaviour as the ClickPatrol Google Tag Manager template.
  Use one install path per site: this snippet OR the GTM template OR a CMS plugin.
  What it does:
    1. Keeps a first-party visitor id (400 days) and session id (1 day, rolling)
       in a cookie + localStorage.
    2. After the first classification, reuses ClickPatrol_Legitimate /
       ClickPatrol_Suspicious (and audience flags) on later pages without
       calling the measurement script again.
    3. Reloads trck-002 when a click id appears that differs from the last
       stored one (source, gclid, …). The same source or gclid replays.
    4. Loads the ClickPatrol measurement script (trck-002) only when needed:
       https://trck-002.clckptrl.com/?uid=...&<page query>&u=<href>&visitor_id=...&session_id=...
    5. Sends a conversion to ClickPatrol on every ClickPatrol_Conversion push.
       Click ids come from the push, the page URL, or first-party ad cookies
       (gclid from _gcl_aw, gbraid from _gcl_ag, wbraid from _gcl_gb, …).
       A repeated conversion_id in the same session is ignored.
    6. Optional, all off by default: GCLID recovery for Safari/ITP and
       lifetime extension of first-party advertising cookies.

  Conversion (push after a confirmed lead or purchase, on any page):
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "ClickPatrol_Conversion",
      conversion_id: "order_10042",      // unique order id or stable event name
      conversion_label: "AbCdEfGhIjk",   // optional, Google Ads label (AW-123/LABEL)
      conversion_type: "purchase",       // "lead" or "purchase"
      conversion_value: 189.00,          // optional
      conversion_currency: "EUR"         // optional
    });
  Docs: https://docs.clickpatrol.com/conversion-tracking/
-->
<script>
(function () {
  "use strict";
  /* ====================== CONFIG ====================== */
  // REQUIRED: your ClickPatrol UID
  var UID = "ENTER-YOUR-UID-HERE";
  // Ignore a repeated ClickPatrol_Conversion with the same conversion_id in
  // this session (stops a thank-you page refresh from counting twice).
  var DEDUPE_CONVERSIONS = true;
  // Optional: if gclid is missing but a custom vd parameter is present
  // (Google Ads Final URL suffix vd={gclid}), recreate the _gcl_aw cookie so
  // Google Ads attribution survives Safari/ITP. Only with ad_storage consent.
  var GCLID_RECOVERY = false;
  // Optional: re-write the lifetime of existing first-party cookies per
  // provider. Safari/Firefox cap JavaScript cookies to ~7 days; HttpOnly
  // cookies cannot be extended from JavaScript.
  var EXTEND_COOKIES = {
    stape: false,           // stape, 13 months
    googleAnalytics: false, // _ga, 13 months
    googleAds: false,       // _gcl_au, _gcl_aw, _gcl_gb, _gcl_ag, _gcl_gs, 90 days
    facebook: false,        // _fbp, _fbc, 90 days
    tiktok: false,          // _ttp 13 months, ttclid 1 month
    affiliates: false,      // awin_*, rakuten_*, outbrain_cid, taboola_cid, cje, 365-400 days
    snapchat: false,        // _scclid 90 days, _scid 400 days
    linkedin: false,        // li_fat_id, 90 days
    microsoft: false,       // uet_vid, _uetmsclkid, 90 days
    pinterest: false,       // _epik, 90 days
    googleDV360: false      // _gcl_dc, 90 days
  };
  /* ==================================================== */
  var VISITOR_KEY = "cp_visitor_id";
  var SESSION_KEY = "cp_session_id";
  var CLASS_KEY = "cp_class";
  var AUDIENCE_KEY = "cp_audience";
  var CONV_KEY = "cp_conv";
  var CONV_SENT_FLAG = "_cpConvSent";
  var VISITOR_TTL_SECONDS = 400 * 24 * 60 * 60;
  var SESSION_TTL_SECONDS = 24 * 60 * 60;
  var CLASS_TTL_SECONDS = 24 * 60 * 60;
  var CLASS_MAX_BYTES = 64;
  var AUDIENCE_MAX_BYTES = 512;
  var CONV_MAX_IDS = 20;
  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DAY = 24 * 60 * 60;
  var L30 = 30 * DAY;
  var L90 = 90 * DAY;
  var L365 = 365 * DAY;
  var L400 = 400 * DAY;
  var SCHEMA = "1";
  var B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  var CLICK_KEYS = ["source", "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "li_fat_id", "vd"];
  var TRACKER_BASE = "https://trck-002.clckptrl.com/";
  var CONVERSION_BASE = "https://conversion.clckptrl.com/";
  var EXTEND_GROUPS = [
    { on: "stape", list: [["stape", L400]] },
    { on: "googleAnalytics", list: [["_ga", L400]] },
    { on: "googleAds", list: [["_gcl_au", L90], ["_gcl_aw", L90], ["_gcl_gb", L90], ["_gcl_ag", L90], ["_gcl_gs", L90]] },
    { on: "facebook", list: [["_fbp", L90], ["_fbc", L90]] },
    { on: "tiktok", list: [["_ttp", L400], ["ttclid", L30]] },
    { on: "affiliates", list: [["awin_awc", L400], ["awin_source", L400], ["awin_sn_awc", L365], ["rakuten_site_id", L400], ["rakuten_time_entered", L400], ["rakuten_ran_mid", L400], ["rakuten_ran_eaid", L400], ["rakuten_ran_site_id", L400], ["outbrain_cid", L400], ["taboola_cid", L400], ["cje", L400]] },
    { on: "snapchat", list: [["_scclid", L90], ["_scid", L400]] },
    { on: "linkedin", list: [["li_fat_id", L90]] },
    { on: "microsoft", list: [["uet_vid", L90], ["_uetmsclkid", L90]] },
    { on: "pinterest", list: [["_epik", L90]] },
    { on: "googleDV360", list: [["_gcl_dc", L90]] }
  ];
  var hookedDataLayer = false;
  var activeSessionId = "";
  var replaying = false;
  function getRawCookie(name) {
    var prefix = name + "=";
    var parts = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(prefix) === 0) {
        return parts[i].substring(prefix.length);
      }
    }
    return null;
  }
  function getCookie(name) {
    var raw = getRawCookie(encodeURIComponent(name));
    if (raw === null) { return null; }
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }
  function getAutoDomain() {
    var host = location.hostname;
    if (!host || host === "localhost" || /^[0-9.]+$/.test(host)) {
      return null;
    }
    var parts = host.split(".");
    for (var i = parts.length - 2; i >= 0; i--) {
      var candidate = parts.slice(i).join(".");
      var testName = "cp_domain_test";
      document.cookie = testName + "=1; domain=" + candidate + "; path=/; SameSite=Lax";
      if (document.cookie.indexOf(testName + "=") !== -1) {
        document.cookie = testName + "=; domain=" + candidate +
          "; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
        return candidate;
      }
    }
    return null;
  }
  var autoDomain = getAutoDomain();
  function writeRawCookie(name, rawValue, maxAgeSeconds) {
    var cookie = name + "=" + rawValue + "; path=/; max-age=" + maxAgeSeconds + "; SameSite=Lax";
    if (autoDomain) {
      cookie += "; domain=" + autoDomain;
    }
    if (location.protocol === "https:") {
      cookie += "; Secure";
    }
    document.cookie = cookie;
  }
  function setCookie(name, value, maxAgeSeconds) {
    writeRawCookie(encodeURIComponent(name), encodeURIComponent(value), maxAgeSeconds);
  }
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try {
      if (window.localStorage.getItem(key) === value) { return; }
      window.localStorage.setItem(key, value);
    } catch (e) {}
  }
  function lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }
  function generateId() {
    var hex = "0123456789abcdef";
    var random = "";
    for (var i = 0; i < 16; i++) {
      random += hex.charAt(Math.floor(Math.random() * 16));
    }
    return "cp_" + Date.now() + random;
  }
  function readOrCreateId(key, ttlSeconds) {
    var id = getCookie(key) || lsGet(key) || generateId();
    setCookie(key, id, ttlSeconds);
    lsSet(key, id);
    return id;
  }
  function getQueryParam(name) {
    var qs = location.search ? location.search.replace(/^\?/, "") : "";
    if (!qs) { return ""; }
    var parts = qs.split("&");
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split("=");
      try {
        var key = decodeURIComponent((pair[0] || "").replace(/\+/g, " "));
        if (key === name) {
          return decodeURIComponent((pair[1] || "").replace(/\+/g, " "));
        }
      } catch (e) {}
    }
    return "";
  }
  function toBase36(num) {
    var n = num;
    if (n <= 0) { return "0"; }
    var out = "";
    while (n > 0) {
      out = B36.charAt(n % 36) + out;
      n = Math.floor(n / 36);
    }
    return out;
  }
  function fromBase36(str) {
    if (!str) { return 0; }
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var idx = B36.indexOf(str.charAt(i));
      if (idx < 0) { return 0; }
      n = n * 36 + idx;
    }
    return n;
  }
  function sessionSuffix(id) {
    if (!id) { return ""; }
    return id.length <= 8 ? id : id.substring(id.length - 8);
  }
  function clickFingerprint() {
    var out = "";
    for (var i = 0; i < CLICK_KEYS.length; i++) {
      var value = getQueryParam(CLICK_KEYS[i]);
      if (value) {
        if (out) { out += "&"; }
        out += CLICK_KEYS[i] + "=" + value;
      }
    }
    return out;
  }
  function hashFingerprint(fp) {
    var h = 7;
    for (var i = 0; i < fp.length; i++) {
      var ch = fp.charAt(i);
      var v = B36.indexOf(ch.toLowerCase());
      if (v < 0) {
        if (ch === "=") { v = 37; }
        else if (ch === "&") { v = 38; }
        else if (ch === "-") { v = 39; }
        else if (ch === "_") { v = 40; }
        else if (ch === ".") { v = 41; }
        else { v = 42; }
      }
      h = h * 33 + v + i;
      if (h > 2000000000) { h = h - Math.floor(h / 1000000000) * 1000000000; }
    }
    return toBase36(h);
  }
  function isSafeAudienceJson(text) {
    if (!text || text.length < 3 || text.charAt(0) !== "{" || text.charAt(text.length - 1) !== "}") {
      return false;
    }
    if (text === "{}") { return false; }
    var allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_{}:,truefals\"-";
    for (var i = 0; i < text.length; i++) {
      if (allowed.indexOf(text.charAt(i)) < 0) { return false; }
    }
    return true;
  }
  function encodeClass(kind, trafficCode, sessId, ts) {
    var value = SCHEMA + "." + kind + "." + trafficCode + "." + sessionSuffix(sessId) + "." + toBase36(ts);
    var fp = clickFingerprint();
    if (fp) { value += "." + hashFingerprint(fp); }
    return value;
  }
  function parseClass(raw, sessId) {
    if (!raw) { return null; }
    var parts = raw.split(".");
    if ((parts.length !== 5 && parts.length !== 6) || parts[0] !== SCHEMA) { return null; }
    if ((parts[1] !== "L" && parts[1] !== "S") || (parts[2] !== "s" && parts[2] !== "f")) { return null; }
    if (parts[3] !== sessionSuffix(sessId)) { return null; }
    var ts = fromBase36(parts[4]);
    if (!ts || Date.now() - ts > DAY_MS) { return null; }
    return {
      raw: raw,
      event: parts[1] === "L" ? "ClickPatrol_Legitimate" : "ClickPatrol_Suspicious",
      traffic: parts[2] === "s" ? "safe" : "fake",
      ts: ts,
      clickHash: parts.length === 6 ? parts[5] : ""
    };
  }
  function encodeAudience(audience, sessId, ts) {
    if (!audience || typeof audience !== "object") { return ""; }
    var json;
    try { json = JSON.stringify(audience); } catch (e) { return ""; }
    if (!isSafeAudienceJson(json)) { return ""; }
    return SCHEMA + "." + sessionSuffix(sessId) + "." + toBase36(ts) + "." + encodeURIComponent(json);
  }
  function parseAudience(raw, sessId) {
    if (!raw) { return null; }
    var first = raw.indexOf(".");
    var second = first > 0 ? raw.indexOf(".", first + 1) : -1;
    var third = second > 0 ? raw.indexOf(".", second + 1) : -1;
    if (first < 0 || second < 0 || third < 0) { return null; }
    if (raw.substring(0, first) !== SCHEMA || raw.substring(first + 1, second) !== sessionSuffix(sessId)) {
      return null;
    }
    var ts = fromBase36(raw.substring(second + 1, third));
    if (!ts || Date.now() - ts > DAY_MS) { return null; }
    var json;
    try { json = decodeURIComponent(raw.substring(third + 1)); } catch (e) { return null; }
    if (!isSafeAudienceJson(json)) { return null; }
    var obj;
    try { obj = JSON.parse(json); } catch (e2) { return null; }
    if (!obj || typeof obj !== "object") { return null; }
    return { raw: raw, audience: obj, ts: ts };
  }
  function readStore(key, parseFn, sessId) {
    var parsed = parseFn(getCookie(key), sessId);
    if (parsed) { return parsed; }
    parsed = parseFn(lsGet(key), sessId);
    if (parsed) {
      if (key !== AUDIENCE_KEY || parsed.raw.length <= AUDIENCE_MAX_BYTES) {
        setCookie(key, parsed.raw, CLASS_TTL_SECONDS);
      }
      return parsed;
    }
    if (getCookie(key) || lsGet(key)) { lsRemove(key); }
    return null;
  }
  function hasNewClickId(sessId) {
    var fp = clickFingerprint();
    if (!fp) { return false; }
    var parsed = readStore(CLASS_KEY, parseClass, sessId);
    if (!parsed || !parsed.clickHash) { return true; }
    return parsed.clickHash !== hashFingerprint(fp);
  }
  function writeClassValue(value) {
    if (!value || value.length > CLASS_MAX_BYTES) { return; }
    setCookie(CLASS_KEY, value, CLASS_TTL_SECONDS);
    lsSet(CLASS_KEY, value);
  }
  function writeAudienceValue(value) {
    if (!value) { return; }
    if (value.length <= AUDIENCE_MAX_BYTES) {
      setCookie(AUDIENCE_KEY, value, CLASS_TTL_SECONDS);
    }
    lsSet(AUDIENCE_KEY, value);
  }
  function maybeRefresh(parsed, key, maxBytes) {
    if (Date.now() - parsed.ts < HOUR_MS) { return; }
    if (maxBytes && parsed.raw.length > maxBytes) { return; }
    setCookie(key, parsed.raw, CLASS_TTL_SECONDS);
  }
  function storeFromEvent(obj, sessId) {
    if (!obj || typeof obj !== "object" || !obj.event) { return; }
    var kind = obj.event === "ClickPatrol_Legitimate" ? "L" : obj.event === "ClickPatrol_Suspicious" ? "S" : "";
    var trafficCode = obj.traffic === "safe" ? "s" : obj.traffic === "fake" ? "f" : "";
    var now = Date.now();
    if (kind && trafficCode) {
      writeClassValue(encodeClass(kind, trafficCode, sessId, now));
    }
    if (obj.audience) {
      var encoded = encodeAudience(obj.audience, sessId, now);
      if (encoded) { writeAudienceValue(encoded); }
    }
  }
  function replayFromCache(sessId) {
    var parsed = readStore(CLASS_KEY, parseClass, sessId);
    if (!parsed) { return false; }
    maybeRefresh(parsed, CLASS_KEY, CLASS_MAX_BYTES);
    var payload = { event: parsed.event, traffic: parsed.traffic };
    var aud = readStore(AUDIENCE_KEY, parseAudience, sessId);
    if (aud) {
      maybeRefresh(aud, AUDIENCE_KEY, AUDIENCE_MAX_BYTES);
      payload.audience = aud.audience;
    }
    window.dataLayer = window.dataLayer || [];
    replaying = true;
    try { window.dataLayer.push(payload); } finally { replaying = false; }
    return true;
  }
  function asString(value) {
    if (value === undefined || value === null) { return ""; }
    var kind = typeof value;
    if (kind === "string") { return value; }
    if (kind === "number" || kind === "boolean") { return "" + value; }
    return "";
  }
  function mapConversionType(raw) {
    var value = asString(raw).toLowerCase();
    if (value === "lead") { return "LEAD"; }
    if (value === "purchase") { return "TRANSACTION"; }
    return "";
  }
  function stripGclAw(raw) {
    if (raw.indexOf("GCL.") !== 0) { return raw; }
    var second = raw.indexOf(".", 4);
    return second < 0 ? raw : raw.substring(second + 1);
  }
  // Google stores these ids only in this alphabet. Anything else is a parse
  // miss and would attribute the conversion to garbage.
  function clickToken(value) {
    return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : "";
  }
  // _gcl_gb: GCL.{seconds}.{wbraid}[.{labels}]. The id is the third segment.
  function stripGclGb(raw) {
    var parts = raw.split(".");
    if (parts.length < 3 || parts[0] !== "GCL") { return ""; }
    return clickToken(parts[2]);
  }
  // _gcl_ag: 2.{domain}.k{id}$i{seconds}[$...], as written by the Google tag.
  function stripGclAg(raw) {
    var parts = raw.split(".");
    if (parts.length !== 3 || parts[0] !== "2") { return ""; }
    var payload = parts[2];
    if (payload.indexOf("$") < 0 && payload.indexOf("%24") !== -1) {
      payload = payload.split("%24").join("$");
    }
    if (!payload || payload.indexOf("%") !== -1) { return ""; }
    var segments = payload.split("$");
    for (var i = 0; i < segments.length; i++) {
      if (segments[i] && segments[i].charAt(0) === "k") {
        return clickToken(segments[i].substring(1));
      }
    }
    return "";
  }
  function stripFbc(raw) {
    if (raw.indexOf("fb.") !== 0) { return raw; }
    var parts = raw.split(".");
    return parts.length < 4 ? raw : parts.slice(3).join(".");
  }
  function clickFromItemUrlOrCookie(item, param, cookieName, stripFn) {
    var value = asString(item[param]) || getQueryParam(param);
    if (value || !cookieName) { return value; }
    var fromCookie = getCookie(cookieName);
    if (!fromCookie) { return ""; }
    return stripFn ? stripFn(fromCookie) : fromCookie;
  }
  function conversionAlreadySent(sessId, convId) {
    var raw = lsGet(CONV_KEY);
    var prefix = sessionSuffix(sessId) + ".";
    if (!raw || raw.indexOf(prefix) !== 0) { return false; }
    var ids = raw.substring(prefix.length).split(",");
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === convId) { return true; }
    }
    return false;
  }
  function rememberConversion(sessId, convId) {
    var prefix = sessionSuffix(sessId) + ".";
    var raw = lsGet(CONV_KEY);
    var ids = [];
    if (raw && raw.indexOf(prefix) === 0 && raw.length > prefix.length) {
      ids = raw.substring(prefix.length).split(",");
    }
    var found = false;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === convId) { found = true; }
    }
    if (!found) { ids.push(convId); }
    if (ids.length > CONV_MAX_IDS) { ids = ids.slice(ids.length - CONV_MAX_IDS); }
    lsSet(CONV_KEY, prefix + ids.join(","));
  }
  // Claims one conversion_id per page load, also against the GTM template if
  // both are installed by mistake (same window flag).
  function claimConversionOnce(convId) {
    var raw = asString(window[CONV_SENT_FLAG]);
    var ids = raw ? raw.split(",") : [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === convId) { return false; }
    }
    ids.push(convId);
    window[CONV_SENT_FLAG] = ids.join(",");
    return true;
  }
  function appendQuery(url, key, value) {
    return value ? url + "&" + key + "=" + encodeURIComponent(value) : url;
  }
  function injectScript(src, id) {
    if (id) {
      var existing = document.getElementById(id);
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    }
    var s = document.createElement("script");
    if (id) { s.id = id; }
    s.async = true;
    s.src = src;
    var first = document.getElementsByTagName("script")[0];
    if (first && first.parentNode) {
      first.parentNode.insertBefore(s, first);
    } else {
      (document.head || document.documentElement).appendChild(s);
    }
  }
  function sendConversion(item) {
    var convId = asString(item.conversion_id);
    var wireType = mapConversionType(item.conversion_type);
    if (!convId || !wireType) { return; }
    var sessId = activeSessionId || getCookie(SESSION_KEY) || lsGet(SESSION_KEY) || "";
    if (DEDUPE_CONVERSIONS && conversionAlreadySent(sessId, convId)) { return; }
    if (!claimConversionOnce(convId)) { return; }
    // Marked before the request: a second push would otherwise pass the
    // check while this one is still in flight.
    if (DEDUPE_CONVERSIONS) { rememberConversion(sessId, convId); }
    var url = CONVERSION_BASE + "?uid=" + encodeURIComponent(UID);
    url = appendQuery(url, "conversion_id", convId);
    url = appendQuery(url, "conversion_label", asString(item.conversion_label));
    url = appendQuery(url, "conversion_value", asString(item.conversion_value));
    url = appendQuery(url, "conversion_currency", asString(item.conversion_currency));
    url = appendQuery(url, "conversion_type", wireType);
    url = appendQuery(url, "gclid", clickFromItemUrlOrCookie(item, "gclid", "_gcl_aw", stripGclAw));
    url = appendQuery(url, "gbraid", clickFromItemUrlOrCookie(item, "gbraid", "_gcl_ag", stripGclAg));
    url = appendQuery(url, "wbraid", clickFromItemUrlOrCookie(item, "wbraid", "_gcl_gb", stripGclGb));
    url = appendQuery(url, "msclkid", clickFromItemUrlOrCookie(item, "msclkid", "_uetmsclkid", null));
    url = appendQuery(url, "fbclid", clickFromItemUrlOrCookie(item, "fbclid", "_fbc", stripFbc));
    url = appendQuery(url, "ttclid", clickFromItemUrlOrCookie(item, "ttclid", "ttclid", null));
    url = appendQuery(url, "li_fat_id", clickFromItemUrlOrCookie(item, "li_fat_id", "li_fat_id", null));
    url = appendQuery(url, "twclid", clickFromItemUrlOrCookie(item, "twclid", "", null));
    url = appendQuery(url, "epik", clickFromItemUrlOrCookie(item, "epik", "_epik", null));
    url = appendQuery(url, "scclid", clickFromItemUrlOrCookie(item, "scclid", "_scclid", null));
    url = appendQuery(url, "qclid", clickFromItemUrlOrCookie(item, "qclid", "", null));
    url = appendQuery(url, "obclid", clickFromItemUrlOrCookie(item, "obclid", "", null));
    url = appendQuery(url, "tblci", clickFromItemUrlOrCookie(item, "tblci", "", null));
    injectScript(url, "");
  }
  function handleItem(item) {
    if (!item || typeof item !== "object" || !item.event) { return; }
    var name = String(item.event);
    if (name === "ClickPatrol_Conversion") {
      sendConversion(item);
    } else if (name.indexOf("ClickPatrol_") === 0 && !replaying) {
      storeFromEvent(item, activeSessionId);
    }
  }
  function hookDataLayer() {
    if (hookedDataLayer) { return; }
    hookedDataLayer = true;
    window.dataLayer = window.dataLayer || [];
    for (var i = 0; i < window.dataLayer.length; i++) {
      var queued = window.dataLayer[i];
      if (queued && typeof queued === "object" && queued.event === "ClickPatrol_Conversion") {
        try { sendConversion(queued); } catch (e) {}
      }
    }
    var orig = window.dataLayer.push;
    window.dataLayer.push = function () {
      for (var j = 0; j < arguments.length; j++) {
        try { handleItem(arguments[j]); } catch (e) {}
      }
      return orig.apply(window.dataLayer, arguments);
    };
  }
  function recoverGclid() {
    if (!GCLID_RECOVERY) { return; }
    var vdGclid = getQueryParam("vd");
    if (!getQueryParam("gclid") && vdGclid && !getCookie("_gcl_aw")) {
      setCookie("_gcl_aw", "GCL." + Math.floor(Date.now() / 1000) + "." + vdGclid, L90);
    }
  }
  function extendCookies() {
    for (var g = 0; g < EXTEND_GROUPS.length; g++) {
      if (EXTEND_COOKIES[EXTEND_GROUPS[g].on] !== true) { continue; }
      var list = EXTEND_GROUPS[g].list;
      for (var c = 0; c < list.length; c++) {
        // Raw read and write, so a value set by another vendor keeps its bytes.
        var raw = getRawCookie(list[c][0]);
        if (raw) { writeRawCookie(list[c][0], raw, list[c][1]); }
      }
    }
  }
  function injectTracker() {
    var visitorId = readOrCreateId(VISITOR_KEY, VISITOR_TTL_SECONDS);
    var sessionId = readOrCreateId(SESSION_KEY, SESSION_TTL_SECONDS);
    activeSessionId = sessionId;
    recoverGclid();
    extendCookies();
    hookDataLayer();
    if (!hasNewClickId(sessionId) && replayFromCache(sessionId)) {
      return;
    }
    var scriptUrl = TRACKER_BASE + "?uid=" + encodeURIComponent(UID);
    var pageQuery = location.search.substring(1);
    if (pageQuery) {
      scriptUrl += "&" + pageQuery;
    }
    scriptUrl += "&u=" + encodeURIComponent(location.href);
    scriptUrl += "&visitor_id=" + encodeURIComponent(visitorId);
    scriptUrl += "&session_id=" + encodeURIComponent(sessionId);
    injectScript(scriptUrl, "clickpatrol-cfp-script");
  }
  injectTracker();
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      injectTracker();
    }
  });
  if (window.history && history.pushState) {
    var originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      injectTracker();
    };
    window.addEventListener("popstate", injectTracker);
  }
})();
</script>

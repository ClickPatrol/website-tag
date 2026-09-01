<!--
  ClickPatrol Ad Traffic Quality - standalone <head> snippet
  ==========================================================
  Place this entire <script> in the <head> of every page.
  Replace the UID below with your own ClickPatrol UID
  (found in the ClickPatrol dashboard under Settings).
  What it does:
    1. Keeps a first-party session id (cookie + localStorage), valid for 1 day.
    2. After the first classification, reuses ClickPatrol_Legitimate /
       ClickPatrol_Suspicious (and audience flags) on later pages without
       calling the measurement script again.
    3. Loads the ClickPatrol measurement script (trck-002) only when needed:
       https://trck-002.clckptrl.com/?uid=...&<page query>&u=<href>&session_id=...
-->
<script>
(function () {
  "use strict";
  /* ====================== CONFIG ====================== */
  // REQUIRED: your ClickPatrol UID
  var UID = "ENTER-YOUR-UID-HERE";
  /* ==================================================== */
  var SESSION_KEY = "cp_session_id";
  var CLASS_KEY = "cp_class";
  var AUDIENCE_KEY = "cp_audience";
  var SESSION_TTL_SECONDS = 24 * 60 * 60;
  var CLASS_TTL_SECONDS = 24 * 60 * 60;
  var CLASS_MAX_BYTES = 64;
  var AUDIENCE_MAX_BYTES = 512;
  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var SCHEMA = "1";
  var B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  var CLICK_KEYS = ["source", "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "li_fat_id", "vd"];
  var TRACKER_BASE = "https://trck-002.clckptrl.com/";
  var hookedDataLayer = false;
  function getCookie(name) {
    var prefix = encodeURIComponent(name) + "=";
    var parts = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(prefix) === 0) {
        return decodeURIComponent(parts[i].substring(prefix.length));
      }
    }
    return null;
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
  function setCookie(name, value, maxAgeSeconds) {
    var cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) +
      "; path=/; max-age=" + maxAgeSeconds + "; SameSite=Lax";
    if (autoDomain) {
      cookie += "; domain=" + autoDomain;
    }
    if (location.protocol === "https:") {
      cookie += "; Secure";
    }
    document.cookie = cookie;
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
  function getQueryParam(name) {
    var qs = location.search ? location.search.replace(/^\?/, "") : "";
    if (!qs) { return ""; }
    var parts = qs.split("&");
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split("=");
      var key = decodeURIComponent((pair[0] || "").replace(/\+/g, " "));
      if (key === name) {
        return decodeURIComponent((pair[1] || "").replace(/\+/g, " "));
      }
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
  function hasNewClickId() {
    for (var i = 0; i < CLICK_KEYS.length; i++) {
      if (getQueryParam(CLICK_KEYS[i])) { return true; }
    }
    return false;
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
    return SCHEMA + "." + kind + "." + trafficCode + "." + sessionSuffix(sessId) + "." + toBase36(ts);
  }
  function parseClass(raw, sessId) {
    if (!raw) { return null; }
    var parts = raw.split(".");
    if (parts.length !== 5 || parts[0] !== SCHEMA) { return null; }
    if ((parts[1] !== "L" && parts[1] !== "S") || (parts[2] !== "s" && parts[2] !== "f")) { return null; }
    if (parts[3] !== sessionSuffix(sessId)) { return null; }
    var ts = fromBase36(parts[4]);
    if (!ts || Date.now() - ts > DAY_MS) { return null; }
    return {
      raw: raw,
      event: parts[1] === "L" ? "ClickPatrol_Legitimate" : "ClickPatrol_Suspicious",
      traffic: parts[2] === "s" ? "safe" : "fake",
      ts: ts
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
    window.dataLayer.push(payload);
    return true;
  }
  function hookDataLayer(sessId) {
    if (hookedDataLayer) { return; }
    hookedDataLayer = true;
    window.dataLayer = window.dataLayer || [];
    var orig = window.dataLayer.push;
    window.dataLayer.push = function () {
      for (var i = 0; i < arguments.length; i++) {
        var item = arguments[i];
        if (item && typeof item === "object" && item.event && String(item.event).indexOf("ClickPatrol_") === 0) {
          storeFromEvent(item, sessId);
        }
      }
      return orig.apply(window.dataLayer, arguments);
    };
  }
  function injectTracker() {
    var sessionId = getCookie(SESSION_KEY) || lsGet(SESSION_KEY) || generateId();
    setCookie(SESSION_KEY, sessionId, SESSION_TTL_SECONDS);
    lsSet(SESSION_KEY, sessionId);
    hookDataLayer(sessionId);
    if (!hasNewClickId() && replayFromCache(sessionId)) {
      return;
    }
    var scriptUrl = TRACKER_BASE + "?uid=" + encodeURIComponent(UID);
    var pageQuery = location.search.substring(1);
    if (pageQuery) {
      scriptUrl += "&" + pageQuery;
    }
    scriptUrl += "&u=" + encodeURIComponent(location.href);
    scriptUrl += "&session_id=" + encodeURIComponent(sessionId);
    var existing = document.getElementById("clickpatrol-cfp-script");
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    var s = document.createElement("script");
    s.id = "clickpatrol-cfp-script";
    s.async = true;
    s.src = scriptUrl;
    var first = document.getElementsByTagName("script")[0];
    if (first && first.parentNode) {
      first.parentNode.insertBefore(s, first);
    } else {
      (document.head || document.documentElement).appendChild(s);
    }
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

<!--
  ClickPatrol Ad Traffic Quality - standalone <head> snippet
  ==========================================================
  Place this entire <script> in the <head> of every page.
  Replace the UID below with your own ClickPatrol UID
  (found in the ClickPatrol dashboard under Settings).
  What it does:
    1. Keeps a first-party session id (cookie + localStorage), valid for 1 day.
    2. Loads the ClickPatrol measurement script (trck-002) and pushes the
       page parameters through:
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
  var SESSION_TTL_SECONDS = 24 * 60 * 60; // 1 day
  var TRACKER_BASE = "https://trck-002.clckptrl.com/";
  /* ---------- cookie helpers ---------- */
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
  // Broadest registrable domain (like GTM's domain:'auto') so the session id
  // is shared across subdomains.
  function getAutoDomain() {
    var host = location.hostname;
    if (!host || host === "localhost" || /^[0-9.]+$/.test(host)) {
      return null; // host-only cookie (localhost / IP)
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
  /* ---------- localStorage helpers (fail silently) ---------- */
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }
  /* ---------- session id ---------- */
  function generateId() {
    var hex = "0123456789abcdef";
    var random = "";
    for (var i = 0; i < 16; i++) {
      random += hex.charAt(Math.floor(Math.random() * 16));
    }
    return "cp_" + Date.now() + random;
  }
  var sessionId = getCookie(SESSION_KEY) || lsGet(SESSION_KEY) || generateId();
  setCookie(SESSION_KEY, sessionId, SESSION_TTL_SECONDS);
  lsSet(SESSION_KEY, sessionId);
  /* ---------- load the ClickPatrol measurement script ---------- */
  var scriptUrl = TRACKER_BASE + "?uid=" + encodeURIComponent(UID);
  var pageQuery = location.search.substring(1);
  if (pageQuery) {
    scriptUrl += "&" + pageQuery;
  }
  scriptUrl += "&u=" + encodeURIComponent(location.href);
  scriptUrl += "&session_id=" + encodeURIComponent(sessionId);
  var s = document.createElement("script");
  s.async = true;
  s.src = scriptUrl;
  var first = document.getElementsByTagName("script")[0];
  if (first && first.parentNode) {
    first.parentNode.insertBefore(s, first);
  } else {
    (document.head || document.documentElement).appendChild(s);
  }
})();
</script>

// 2Embed provider for Nuvio (ES5, Promise-only, no async/await)
var PROVIDER_ID = "twoembed";
var PROVIDER_NAME = "2Embed";

// "new" family (docs: /embed/movie/{tmdb|imdb}, /embed/tv/{id}/{s}/{e}); "cc" family (imdb based, Cloudflare protected)
var SITES = [
  { host: "https://www.2embed.stream", kind: "new" },
  { host: "https://www.2embed.online", kind: "new" },
  { host: "https://www.2embed.cc", kind: "cc" }
];
var PLAYER_FALLBACK = "https://uqloads.xyz";

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";

var FETCH_TIMEOUT_MS = 6000;
var VALIDATE_TIMEOUT_MS = 4000;
var OVERALL_TIMEOUT_MS = 15000;
var SITE_BUDGET_MS = 9000;   // max time spent on any single mirror
var NEG_CACHE_TTL_MS = 60 * 1000;
var META_WAIT_MS = 700;      // TMDB is only needed for the title, never wait long for it
var CACHE_TTL_MS = 5 * 60 * 1000;
var CACHE = {};
var MAX_DEPTH = 4;
var MAX_PAGES = 8;

var AD_HOSTS = /histats|doubleclick|googlesyndication|google-analytics|googletagmanager|facebook\.com|twitter\.com|adsterra|popads|propeller|exoclick/i;

var T0 = Date.now();
function log(m) { console.log("[" + PROVIDER_NAME + " +" + (Date.now() - T0) + "ms] " + m); }

function withTimeout(promise, ms, label) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function(resolve, reject) {
    var done = false;
    var t = setTimeout(function() {
      if (!done) { done = true; reject(new Error((label || "request") + " timeout")); }
    }, ms);
    promise.then(function(v) {
      if (!done) { done = true; clearTimeout(t); resolve(v); }
    }, function(e) {
      if (!done) { done = true; clearTimeout(t); reject(e); }
    });
  });
}

function request(url, headers, timeoutMs) {
  return withTimeout(
    fetch(url, { method: "GET", headers: headers || {}, redirect: "follow" }).then(function(r) {
      return r.text().then(function(t) {
        return { ok: r.ok, status: r.status, text: t, url: r.url || url };
      });
    }),
    timeoutMs || FETCH_TIMEOUT_MS,
    url.split("?")[0]
  );
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }
function originOf(url) { var m = /^(https?:\/\/[^\/]+)/i.exec(url || ""); return m ? m[1] : ""; }
function hostOf(url) { var m = /^https?:\/\/([^\/]+)/i.exec(url || ""); return m ? m[1] : ""; }

function labelFromRes(w, h) {
  if (w >= 3200 || h >= 2000) return "4K";
  if (w >= 1800 || h >= 1000) return "1080p";
  if (w >= 1200 || h >= 700) return "720p";
  if (w >= 800 || h >= 460) return "480p";
  if (h > 0) return h + "p";
  return "Auto";
}
function rankOf(label) {
  if (label === "4K") return 2160;
  var n = parseInt(label, 10);
  return isNaN(n) ? 0 : n;
}

function absUrl(base, rel) {
  if (!rel) return rel;
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.indexOf("//") === 0) return "https:" + rel;
  var clean = base.split("#")[0].split("?")[0];
  var m = /^(https?:\/\/[^\/]+)(\/.*)?$/i.exec(clean);
  if (!m) return rel;
  var origin = m[1];
  if (rel.charAt(0) === "/") return origin + rel;
  var parts = (m[2] || "/").split("/");
  parts.pop();
  rel.split("/").forEach(function(seg) {
    if (seg === "..") { if (parts.length > 1) parts.pop(); }
    else if (seg !== ".") parts.push(seg);
  });
  return origin + parts.join("/");
}

// ---------- base64 (Hermes may lack atob) ----------
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decode(s) {
  s = s.replace(/[^A-Za-z0-9+\/]/g, "");
  var out = "", bits = 0, acc = 0;
  for (var i = 0; i < s.length; i++) {
    acc = (acc << 6) | B64.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 255);
      acc = acc & ((1 << bits) - 1);
    }
  }
  return out;
}

// ---------- TMDB (title/imdb only; never blocks scraping) ----------
function fetchMeta(tmdbId, type) {
  var url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&language=en&append_to_response=external_ids";
  return request(url, { "Accept": "application/json" }).then(function(r) {
    if (!r.ok) throw new Error("TMDB HTTP " + r.status);
    var d = JSON.parse(r.text);
    var title = type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name);
    var date = type === "movie" ? d.release_date : d.first_air_date;
    var imdbId = (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || "";
    return { title: title || "", year: (date || "").slice(0, 4), imdbId: imdbId };
  });
}

// ---------- p,a,c,k,e,d unpacker ----------
function unpackAll(html) {
  var out = [];
  var re = /\}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    try {
      var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      var a = parseInt(m[2], 10);
      var c = parseInt(m[3], 10);
      var k = m[4].split("|");
      var enc = function(n) {
        return (n < a ? "" : enc(parseInt(n / a, 10))) +
          ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
      };
      var dict = {};
      while (c--) { dict[enc(c)] = k[c] || enc(c); }
      out.push(payload.replace(/\b\w+\b/g, function(w) {
        return Object.prototype.hasOwnProperty.call(dict, w) ? dict[w] : w;
      }));
    } catch (e) { /* ignore */ }
  }
  return out;
}

// `var links={"hls2":"...","hls4":["..."]}` -> URL strings
function parseLinksObject(text) {
  var out = [];
  var i = text.search(/links\s*=\s*\{/);
  if (i === -1) return out;
  var start = text.indexOf("{", i);
  var depth = 0, inStr = false, q = "", end = -1;
  for (var p = start; p < text.length; p++) {
    var ch = text.charAt(p);
    if (inStr) {
      if (ch === "\\") { p++; continue; }
      if (ch === q) inStr = false;
    } else if (ch === '"' || ch === "'") { inStr = true; q = ch; }
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end === -1) return out;
  try {
    var obj = JSON.parse(text.slice(start, end + 1));
    Object.keys(obj).forEach(function(key) {
      var v = obj[key];
      var arr = Object.prototype.toString.call(v) === "[object Array]" ? v : [v];
      arr.forEach(function(s) {
        if (typeof s === "string" && /^(https?:)?\/|^https?:/i.test(s)) out.push(s);
      });
    });
  } catch (e) { /* regex fallbacks below */ }
  return out;
}

// all text blobs of a page: raw + unpacked + base64-decoded atob(`...`) payloads
function blobsOf(html) {
  var blobs = [html].concat(unpackAll(html));
  var re = /atob\(\s*[`'"]([A-Za-z0-9+\/=\s]{40,})[`'"]\s*\)/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    try { blobs.push(b64decode(m[1])); } catch (e) { /* ignore */ }
  }
  return blobs;
}

function extractM3U8s(pageUrl, html) {
  var found = [];
  function push(u) {
    u = u.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
    u = absUrl(pageUrl, u);
    if (u && found.indexOf(u) === -1) found.push(u);
  }
  blobsOf(html).forEach(function(b) {
    parseLinksObject(b).forEach(push);
    var m;
    var r1 = /["'](https?:\\?\/\\?\/[^"'\s]+?\.m3u8[^"'\s]*)["']/gi;
    while ((m = r1.exec(b)) !== null) push(m[1]);
    var r2 = /["'](\/[^"'\s]+?\.m3u8[^"'\s]*)["']/gi;
    while ((m = r2.exec(b)) !== null) push(m[1]);
    var r3 = /(?:file|src|source|url)\s*[:=]\s*["']([^"']+?\.m3u8[^"']*)["']/gi;
    while ((m = r3.exec(b)) !== null) push(m[1]);
    var r4 = /["']?hls\d*["']?\s*:\s*["']([^"']+)["']/gi;
    while ((m = r4.exec(b)) !== null) push(m[1]);
  });
  return found;
}

// iframe / data-src children (+ raw player URLs inside script blobs)
function findChildPages(pageUrl, html) {
  var out = [];
  function add(u) {
    if (!u || u.indexOf("about:blank") === 0 || u.indexOf("javascript:") === 0) return;
    u = absUrl(pageUrl, u.replace(/\\\//g, "/").replace(/&amp;/g, "&"));
    if (!/^https?:/i.test(u) || AD_HOSTS.test(u) || u === pageUrl) return;
    if (out.indexOf(u) === -1) out.push(u);
  }
  var re = /<iframe\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var s = /\bdata-src\s*=\s*["']([^"']+)["']/i.exec(tag) || /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (s) add(s[1]);
  }
  blobsOf(html).forEach(function(b) {
    var r = /["'](https?:\\?\/\\?\/[^"'\s]*(?:streamsrcs|swish|\/embed\/|\/player\/|\/e\/)[^"'\s]*)["']/gi;
    var mm;
    while ((mm = r.exec(b)) !== null) add(mm[1]);
  });
  // streamsrcs ?id=XXX -> uqloads player page
  out.slice().forEach(function(u) {
    var idm = /streamsrcs[^?]*\?[^#]*\bid=([^&#]+)/i.exec(u);
    if (idm) add(PLAYER_FALLBACK + "/e/" + idm[1]);
  });
  return out;
}

function isCloudflare(r) {
  return (r.status === 403 || r.status === 503 || r.status === 429) &&
    /just a moment|cf-chl|challenge-platform|attention required/i.test(r.text || "");
}

// fetch a page; on 403 retry once with an Origin header
function fetchPage(url, referer, ctx) {
  var base = { "User-Agent": UA, "Referer": referer, "Accept": "text/html,application/xhtml+xml,*/*" };
  return request(url, base).then(function(r) {
    if (r.status === 403 && !isCloudflare(r)) {
      var h2 = {}; Object.keys(base).forEach(function(k) { h2[k] = base[k]; });
      h2["Origin"] = originOf(url);
      return request(url, h2);
    }
    return r;
  }).then(function(r) {
    log("GET " + url.substring(0, 90) + " -> HTTP " + r.status + " | " + (r.text ? r.text.length : 0) + " chars");
    if (isCloudflare(r)) throw new Error("Cloudflare challenge (HTTP " + r.status + ")");
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r;
  });
}

// follow iframes (depth-limited) until a page exposes an m3u8
function crawl(url, referer, depth, state) {
  if (depth > MAX_DEPTH || state.count >= MAX_PAGES || state.visited[url]) return Promise.resolve(null);
  state.visited[url] = true;
  state.count++;
  return fetchPage(url, referer, state.ctx).then(function(r) {
    var pageUrl = r.url || url;
    var urls = extractM3U8s(pageUrl, r.text);
    if (urls.length) {
      log("found " + urls.length + " candidate url(s) on " + hostOf(pageUrl));
      return { pageUrl: pageUrl, refererOrigin: originOf(referer), urls: urls };
    }
    var kids = findChildPages(pageUrl, r.text);
    log("no media on " + hostOf(pageUrl) + " | child pages: " + kids.length);
    // follow the first few child pages in parallel, first one that yields media wins
    return firstSuccess(kids.slice(0, 3).map(function(k) {
      return crawl(k, pageUrl, depth + 1, state);
    }));
  }).catch(function(e) {
    state.lastError = (e && e.message) || String(e);
    log("page failed (" + hostOf(url) + "): " + state.lastError);
    return null;
  });
}

// ---------- embed URL candidates per site family ----------
function candidates(site, tmdbId, type, season, episode) {
  var h = site.host;
  var tid = encodeURIComponent(tmdbId);
  var c = [];
  if (site.kind === "new") {
    if (type === "tv") {
      c.push({ needsMeta: false, build: function() { return h + "/embed/tv/" + tid + "/" + season + "/" + episode; } });
      c.push({ needsMeta: true, build: function(m) { return m && m.imdbId ? h + "/embed/tv/" + m.imdbId + "/" + season + "/" + episode : null; } });
    } else {
      c.push({ needsMeta: false, build: function() { return h + "/embed/movie/" + tid; } });
      c.push({ needsMeta: true, build: function(m) { return m && m.imdbId ? h + "/embed/movie/" + m.imdbId : null; } });
      c.push({ needsMeta: false, build: function() { return h + "/iframe.php?id=" + tid; } });
    }
  } else {
    if (type === "tv") {
      c.push({ needsMeta: true, build: function(m) { return m && m.imdbId ? h + "/embed/" + m.imdbId + "/season-" + season + "-episode-" + episode : null; } });
      c.push({ needsMeta: true, build: function(m) { return m && m.imdbId ? h + "/embedtv/" + m.imdbId + "&s=" + season + "&e=" + episode : null; } });
      c.push({ needsMeta: false, build: function() { return h + "/embedtv/" + tid + "&s=" + season + "&e=" + episode; } });
    } else {
      c.push({ needsMeta: true, build: function(m) { return m && m.imdbId ? h + "/embed/" + m.imdbId : null; } });
      c.push({ needsMeta: false, build: function() { return h + "/embed/" + tid; } });
    }
  }
  return c;
}

function trySite(site, metaPromise, tmdbId, type, season, episode, ctx) {
  var host = hostOf(site.host);
  log("=== " + host + " ===");
  var list = candidates(site, tmdbId, type, season, episode);
  var state = { visited: {}, count: 0, ctx: ctx, lastError: "" };

  function tryAt(i) {
    if (i >= list.length) {
      ctx.fails[host] = state.lastError || "nothing found";
      return Promise.resolve(null);
    }
    var cand = list[i];
    return (cand.needsMeta ? metaPromise : Promise.resolve(null)).then(function(meta) {
      var u = cand.build(meta);
      if (!u) { state.lastError = state.lastError || "no IMDb id"; return null; }
      log("embed: " + u);
      return crawl(u, site.host + "/", 0, state);
    }).then(function(res) {
      if (res) return res;
      // mirror is down / blocked: more URL variants on the same host won't help
      if (/timeout|HTTP 5\d\d|Cloudflare/i.test(state.lastError || "")) {
        ctx.fails[host] = state.lastError;
        return null;
      }
      return tryAt(i + 1);
    });
  }
  return withTimeout(tryAt(0), SITE_BUDGET_MS, host).catch(function(e) {
    ctx.fails[host] = (e && e.message) || "timeout";
    log("site budget exceeded: " + host);
    return null;
  });
}

// ---------- playlist validation + stream building ----------
// resolves with the lowest-index non-null result; once something valid exists it waits
// at most graceMs for lower-index (higher priority) candidates, so one slow request never stalls us
function orderedFirst(promises, graceMs) {
  return new Promise(function(resolve) {
    var n = promises.length, res = [], settled = [], done = false, timer = null;
    if (!n) return resolve(null);
    function finish(v) { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(v); } }
    function check(force) {
      if (done) return;
      var pendingLeft = false;
      for (var i = 0; i < n; i++) {
        if (!settled[i]) { if (!force) return; pendingLeft = true; continue; }
        if (res[i]) { finish(res[i]); return; }
      }
      if (!pendingLeft) finish(null);
    }
    promises.forEach(function(p, i) {
      p.then(function(v) { res[i] = v; }, function() { res[i] = null; }).then(function() {
        settled[i] = true;
        if (res[i] && !timer && typeof setTimeout === "function") {
          timer = setTimeout(function() { check(true); }, graceMs);
        }
        check(false);
      });
    });
  });
}

function validatePlaylist(url, headerSets) {
  return orderedFirst(headerSets.map(function(h) {
    return request(url, h, VALIDATE_TIMEOUT_MS).then(function(r) {
      return (r.ok && r.text && r.text.indexOf("#EXTM3U") !== -1) ? { headers: h, text: r.text } : null;
    }).catch(function() { return null; });
  }), 400);
}

function parseMaster(masterUrl, text) {
  var lines = text.split(/\r?\n/);
  var byKey = {};
  var best = { w: 0, h: 0 };
  var hasSeparateAudio = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(text);
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (l.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
    var res = /RESOLUTION=(\d+)x(\d+)/i.exec(l);
    var bw = /BANDWIDTH=(\d+)/i.exec(l);
    var uri = null;
    for (var j = i + 1; j < lines.length; j++) {
      var n = lines[j].trim();
      if (n && n.charAt(0) !== "#") { uri = n; break; }
    }
    if (!uri) continue;
    var w = res ? parseInt(res[1], 10) : 0;
    var h = res ? parseInt(res[2], 10) : 0;
    var b = bw ? parseInt(bw[1], 10) : 0;
    if (w > best.w || h > best.h) best = { w: w, h: h };
    var label = labelFromRes(w, h);
    var key = label === "Auto" ? ("bw" + b) : label;
    if (!byKey[key] || b > byKey[key].bandwidth) {
      byKey[key] = { label: label, bandwidth: b, url: absUrl(masterUrl, uri) };
    }
  }
  return {
    variants: Object.keys(byKey).map(function(k) { return byKey[k]; }),
    best: best,
    hasSeparateAudio: hasSeparateAudio
  };
}

function makeStream(ctx, url, label, headers) {
  var h = {};
  Object.keys(headers || {}).forEach(function(k) { h[k] = headers[k]; });
  return {
    name: PROVIDER_NAME + " " + label,
    title: ctx.displayTitle + " \u2022 " + label,
    url: url,
    quality: label,
    size: "Unknown",
    headers: h,
    provider: PROVIDER_ID
  };
}

function streamsFromPlaylist(ctx, m3u8Url, text, headers) {
  var master = parseMaster(m3u8Url, text);
  log("Variants: " + master.variants.length + " | separateAudio: " + master.hasSeparateAudio);
  var top = master.variants.length ? labelFromRes(master.best.w, master.best.h) : "Auto";
  if (master.variants.length < 2 || master.hasSeparateAudio) {
    return [makeStream(ctx, m3u8Url, top, headers)];
  }
  var out = [{ s: makeStream(ctx, m3u8Url, "Auto", headers), r: 1000000 }];
  master.variants.forEach(function(v) {
    out.push({ s: makeStream(ctx, v.url, v.label, headers), r: rankOf(v.label) });
  });
  var byQ = {};
  out.forEach(function(o) {
    var q = o.s.quality;
    if (!byQ[q] || o.r > byQ[q].r) byQ[q] = o;
  });
  return Object.keys(byQ).map(function(k) { return byQ[k]; })
    .sort(function(a, b) { return b.r - a.r; })
    .map(function(o) { return o.s; });
}

function finalize(ctx, found) {
  var po = originOf(found.pageUrl);
  var ro = found.refererOrigin || po;
  var headerSets = [
    { "User-Agent": UA, "Referer": po + "/", "Origin": po },
    { "User-Agent": UA, "Referer": ro + "/", "Origin": po },
    { "User-Agent": UA, "Referer": ro + "/", "Origin": ro },
    { "User-Agent": UA }
  ];
  var urls = found.urls.slice(0, 3);
  return orderedFirst(urls.map(function(u) {
    return validatePlaylist(u, headerSets).then(function(v) { return v ? { url: u, v: v } : null; });
  }), 600).then(function(best) {
    if (!best) {
      log("no playlist validated - returning unverified link");
      return [makeStream(ctx, urls[0], "Auto", headerSets[0])];
    }
    return streamsFromPlaylist(ctx, best.url, best.v.text, best.v.headers);
  });
}

function firstSuccess(promises) {
  return new Promise(function(resolve) {
    var pending = promises.length;
    var done = false;
    if (!pending) return resolve(null);
    promises.forEach(function(p) {
      p.then(function(v) {
        if (!done && v) { done = true; resolve(v); }
      }).catch(function() {}).then(function() {
        pending--;
        if (!done && pending === 0) resolve(null);
      });
    });
  });
}

function getStreamsFor(tmdbId, type, season, episode, ctx) {
  log("========== START ========== TMDB " + tmdbId + " | " + type + " S" + season + "E" + episode);
  var metaPromise = fetchMeta(tmdbId, type).then(function(meta) {
    if (meta.title) {
      ctx.displayTitle = type === "movie"
        ? meta.title + (meta.year ? " (" + meta.year + ")" : "")
        : meta.title + " S" + pad2(season) + "E" + pad2(episode);
    }
    return meta;
  }).catch(function(e) {
    log("TMDB meta failed: " + (e && e.message));
    return null;
  });

  var scrape = firstSuccess(SITES.map(function(site) {
    return trySite(site, metaPromise, tmdbId, type, season, episode, ctx);
  })).then(function(found) {
    if (!found) return [];
    return withTimeout(metaPromise, META_WAIT_MS, "meta").catch(function() { return null; })
      .then(function() { return finalize(ctx, found); });
  });

  return withTimeout(scrape, OVERALL_TIMEOUT_MS, "overall").catch(function(e) {
    ctx.fails["overall"] = (e && e.message) || "timeout";
    log("overall: " + ctx.fails["overall"]);
    return [];
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  var season = parseInt(seasonNum, 10) || 1;
  var episode = parseInt(episodeNum, 10) || 1;
  if (!tmdbId) return Promise.resolve([]);
  T0 = Date.now();

  var key = type + ":" + tmdbId + ":" + (type === "tv" ? season + ":" + episode : "");
  var hit = CACHE[key];
  if (hit && Date.now() - hit.t < (hit.streams.length ? CACHE_TTL_MS : NEG_CACHE_TTL_MS)) {
    log("cache hit " + key);
    return Promise.resolve(hit.streams.map(function(s) { return JSON.parse(JSON.stringify(s)); }));
  }

  var ctx = {
    fails: {},
    displayTitle: type === "movie" ? "TMDB " + tmdbId : "TMDB " + tmdbId + " S" + pad2(season) + "E" + pad2(episode)
  };
  return getStreamsFor(tmdbId, type, season, episode, ctx).then(function(streams) {
    log("========== END: " + streams.length + " stream(s) ==========");
    CACHE[key] = { t: Date.now(), streams: streams };
    return streams;
  }).catch(function(err) {
    log("FATAL: " + (err && err.message));
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}

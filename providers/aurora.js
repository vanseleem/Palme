var PROVIDER_ID = "aurora";
var PROVIDER_NAME = "Aurora";

var API_BASE = "https://player.vidflix.club/api/vidora/v1";
var SITE = "https://player.vidflix.club";
var PLAYER_KEY = "f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a";

var SOURCES = ["scrapify", "fsonic"];

var CDN_CANDIDATES = [
  { referer: "https://player.vidflix.club/", origin: "https://player.vidflix.club" },
  { referer: "https://netoda.tech/",         origin: "https://netoda.tech" },
  { referer: "https://cdn.vidspark.to/",     origin: "https://cdn.vidspark.to" },
  { referer: "",                             origin: "" }
];

var CDN_RULES = [
  { host: "hd4u.sbs",    referers: ["https://player.vidflix.club/"], origin: "https://player.vidflix.club" },
  { host: "netoda.tech", referers: ["https://netoda.tech/"],          origin: "https://netoda.tech" }
];

var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var FETCH_TIMEOUT_MS = 6000;
var HLS_TIMEOUT_MS = 5000;
var OVERALL_BUDGET_MS = 7000;

function log(m) { console.log("[" + PROVIDER_NAME + "] " + m); }

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

function absUrl(base, rel) {
  if (/^https?:\/\//i.test(rel)) return rel;
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

function pad2(n) { return n < 10 ? "0" + n : String(n); }

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

function hostOf(url) {
  var m = /^https?:\/\/([^\/:?#]+)/i.exec(url || "");
  return m ? m[1].toLowerCase() : "";
}

function ruleFor(url) {
  var host = hostOf(url);
  for (var i = 0; i < CDN_RULES.length; i++) {
    var h = CDN_RULES[i].host;
    if (host === h || host.slice(-(h.length + 1)) === "." + h) return CDN_RULES[i];
  }
  return null;
}

function cdnHeaders(referer, origin) {
  var h = { "User-Agent": UA };
  if (referer) h["Referer"] = referer;
  if (origin) h["Origin"] = origin;
  return h;
}

function buildCands(url) {
  var list = [];
  var seen = {};
  function add(c) {
    var k = (c.referer || "") + "|" + (c.origin || "");
    if (seen[k]) return;
    seen[k] = true;
    list.push(c);
  }
  var rule = ruleFor(url);
  if (rule) rule.referers.forEach(function(r) { add({ referer: r, origin: rule.origin || "" }); });
  CDN_CANDIDATES.forEach(function(c) { add({ referer: c.referer, origin: c.origin }); });
  return list;
}

function headersOf(c) {
  return cdnHeaders(c.referer, c.origin);
}

var SUB_KEY = /sub|caption|track|thumb|poster|preview|vtt|srt/i;
var SUB_URL = /\.(vtt|srt|ass|ssa|jpg|jpeg|png|webp|gif|svg)(\?|#|$)/i;
var MEDIA_KEY = /^(url|file|src|link|playlist|stream|source|hls|m3u8|manifest)$/i;

function walkMedia(node, out, depth, key) {
  if (node == null || depth > 7) return;
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node) && !SUB_URL.test(node) && !SUB_KEY.test(key || "") &&
        (MEDIA_KEY.test(key || "") || /\.(m3u8|mpd|mp4)(\?|#|$)/i.test(node))) {
      if (out.indexOf(node) === -1) out.push(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(function(n) { walkMedia(n, out, depth + 1, key); });
    return;
  }
  if (typeof node === "object") {
    Object.keys(node).forEach(function(k) {
      if (!SUB_KEY.test(k)) walkMedia(node[k], out, depth + 1, k);
    });
  }
}

function walkSubs(node, out, depth, inSubs) {
  if (node == null || depth > 7) return;
  if (Array.isArray(node)) {
    node.forEach(function(n) { walkSubs(n, out, depth + 1, inSubs); });
    return;
  }
  if (typeof node === "object") {
    var u = node.url || node.file || node.src || node.link;
    if (inSubs && typeof u === "string" && /^https?:\/\//i.test(u)) {
      var lang = node.lang || node.language || node.code || node.srclang || node.label || "";
      out.push({
        url: u,
        language: String(lang).toLowerCase().slice(0, 12) || "und",
        name: String(node.label || node.name || node.lang || node.language || "Subtitle")
      });
      return;
    }
    Object.keys(node).forEach(function(k) {
      walkSubs(node[k], out, depth + 1, inSubs || /sub|caption/i.test(k));
    });
  }
}

function unique(list) {
  var seen = {};
  return list.filter(function(x) {
    var k = typeof x === "string" ? x : x.url;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
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
  return { variants: Object.keys(byKey).map(function(k) { return byKey[k]; }), best: best, hasSeparateAudio: hasSeparateAudio };
}

function makeStream(ctx, url, label, rank, headers, subtitles) {
  var h = {};
  Object.keys(headers).forEach(function(k) { h[k] = headers[k]; });
  var tag = " \u2022 " + ctx.sourceName;
  return {
    name: PROVIDER_NAME + " " + label + tag,
    title: ctx.displayTitle + " \u2022 " + label + tag,
    url: url,
    quality: label,
    size: "Unknown",
    type: "hls",
    headers: h,
    subtitles: subtitles || [],
    provider: PROVIDER_ID,
    _rank: rank
  };
}

function tryCandidate(url, c) {
  var hdrs = headersOf(c);
  return request(url, hdrs, HLS_TIMEOUT_MS).then(function(r) {
    if (r.ok && r.text.indexOf("#EXTM3U") !== -1) return { r: r, cand: c };
    return null;
  }, function() { return null; });
}

function firstValid(tasks) {
  return new Promise(function(resolve) {
    var left = tasks.length;
    var done = false;
    if (!left) return resolve(null);
    tasks.forEach(function(p) {
      p.then(function(v) {
        if (done) return;
        if (v) { done = true; resolve(v); }
        else if (--left === 0) { done = true; resolve(null); }
      }, function() {
        if (!done && --left === 0) { done = true; resolve(null); }
      });
    });
  });
}

function expandSource(url, ctx) {
  var cands = buildCands(url);
  return firstValid(cands.map(function(c) { return tryCandidate(url, c); })).then(function(x) {
    if (!x) return [makeStream(ctx, url, "Auto", 1000000, headersOf(cands[0]), ctx.subtitles)];
    var r = x.r;
    var hdr = headersOf(x.cand);
    var finalUrl = /^https?:\/\//i.test(r.url || "") ? r.url : url;
    var master = parseMaster(finalUrl, r.text);
    var top = labelFromRes(master.best.w, master.best.h);
    if (master.variants.length < 2 || master.hasSeparateAudio) {
      return [makeStream(ctx, finalUrl, top, 1000000, hdr, ctx.subtitles)];
    }
    var out = [makeStream(ctx, finalUrl, "Auto", 1000000, hdr, ctx.subtitles)];
    master.variants.forEach(function(v) {
      out.push(makeStream(ctx, v.url, v.label, rankOf(v.label), hdr, ctx.subtitles));
    });
    return out;
  }).catch(function() {
    return [makeStream(ctx, url, "Auto", 1000000, headersOf(cands[0]), ctx.subtitles)];
  });
}

function fetchMeta(tmdbId, type) {
  var url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&language=en";
  return request(url, { "Accept": "application/json" }, 4000).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    var d = JSON.parse(r.text);
    var title = type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name);
    var date = type === "movie" ? d.release_date : d.first_air_date;
    return { title: title || "", year: (date || "").slice(0, 4) };
  });
}

function apiHeaders() {
  return {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "x-player-key": PLAYER_KEY,
    "Referer": SITE + "/",
    "Origin": SITE
  };
}

function callApi(source, tmdbId, type, season, episode) {
  var path = type === "movie"
    ? "movie/" + encodeURIComponent(tmdbId)
    : "tv/" + encodeURIComponent(tmdbId) + "/" + season + "/" + episode;
  var url = API_BASE + "/" + path + "?source=" + encodeURIComponent(source);
  return request(url, apiHeaders(), FETCH_TIMEOUT_MS).then(function(r) {
    var data = null;
    try { data = JSON.parse(r.text); } catch (e) { }
    if (!r.ok || !data || data.result === false) return null;
    return data;
  }).catch(function() { return null; });
}

function sourceStreams(sourceName, tmdbId, type, season, episode, baseDisplayTitle) {
  return callApi(sourceName, tmdbId, type, season, episode).then(function(data) {
    if (!data) { log(sourceName + ": no response"); return []; }
    var found = [];
    walkMedia(data, found, 0, "");
    found = unique(found);
    found.sort(function(a, b) { return (/\.m3u8/i.test(b) ? 1 : 0) - (/\.m3u8/i.test(a) ? 1 : 0); });
    if (!found.length) { log(sourceName + ": no media url"); return []; }
    var subs = [];
    walkSubs(data, subs, 0, false);
    var ctx = { displayTitle: baseDisplayTitle, subtitles: unique(subs), sourceName: sourceName };
    log(sourceName + ": " + found.length + " url(s) found");
    return Promise.all(found.map(function(u) { return expandSource(u, ctx); })).then(function(groups) {
      var out = [];
      groups.forEach(function(g) { g.forEach(function(s) { out.push(s); }); });
      return out;
    });
  }).catch(function(e) { log(sourceName + " failed: " + (e && e.message)); return []; });
}

function rollingCollect(promises, maxMs) {
  return new Promise(function(resolve) {
    var out = [];
    var pending = promises.length;
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; log("budget hit — returning partial results"); resolve(out); }
    }, maxMs);
    if (!pending) { clearTimeout(timer); return resolve([]); }
    promises.forEach(function(p) {
      p.then(function(v) {
        if (Array.isArray(v)) { v.forEach(function(s) { out.push(s); }); }
        pending--;
        if (pending === 0 && !done) { done = true; clearTimeout(timer); resolve(out); }
      }, function() {
        pending--;
        if (pending === 0 && !done) { done = true; clearTimeout(timer); resolve(out); }
      });
    });
  });
}

function getStreamsFor(tmdbId, type, season, episode) {
  var baseDisplayTitle = type === "movie"
    ? "TMDB " + tmdbId
    : "TMDB " + tmdbId + " S" + pad2(season) + "E" + pad2(episode);

  var metaP = fetchMeta(tmdbId, type).then(function(meta) {
    if (meta && meta.title) {
      var t = type === "movie"
        ? meta.title + (meta.year ? " (" + meta.year + ")" : "")
        : meta.title + " S" + pad2(season) + "E" + pad2(episode);
      metaP.resolvedTitle = t;
    }
    return meta;
  }).catch(function() { return null; });

  var tasks = SOURCES.map(function(src) {
    return sourceStreams(src, tmdbId, type, season, episode, baseDisplayTitle);
  });

  return rollingCollect(tasks, OVERALL_BUDGET_MS).then(function(streams) {
    var seen = {};
    var out = [];
    streams.forEach(function(s) {
      if (seen[s.url]) return;
      seen[s.url] = true;
      out.push(s);
    });
    out.sort(function(a, b) { return b._rank - a._rank; });
    out.forEach(function(s) { delete s._rank; });
    log("Returned " + out.length + " total stream(s)");
    return out;
  }).catch(function(err) {
    log("FAILED: " + (err && err.message));
    return [];
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  var season = parseInt(seasonNum, 10) || 1;
  var episode = parseInt(episodeNum, 10) || 1;
  log("getStreams: " + tmdbId + " " + type + (type === "tv" ? " S" + season + "E" + episode : ""));
  if (!tmdbId) return Promise.resolve([]);
  return getStreamsFor(String(tmdbId), type, season, episode).catch(function(err) {
    log("error: " + (err && err.message));
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}

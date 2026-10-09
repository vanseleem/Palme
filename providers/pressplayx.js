var PROVIDER_ID = "pressplayx";
var PROVIDER_NAME = "PressPlayX";
var GATEWAYS = [
  { label: "pressplayx.to", api: "https://moviesapi.to/api/vidora/v1", origin: "https://pressplayx.to" },
  { label: "moviesapi.to",  api: "https://moviesapi.to/api/vidora/v1", origin: "https://moviesapi.to" }
];

var CDN_CANDIDATES = [
  { referer: "https://cdn.vidspark.to/", origin: "https://cdn.vidspark.to" },
  { referer: "https://pressplayx.to/",   origin: "" },
  { referer: "https://moviesapi.to/",    origin: "" },
  { referer: "",                         origin: "" }
];

var CDN_RULES = [
  { host: "hd4u.sbs", referers: ["https://cdn.vidspark.to/"], origin: "https://cdn.vidspark.to" }
];

var USE_VAPLAYER_FALLBACK = true;
var VAPLAYER_API = "https://streamdata.vaplayer.ru/api.php";
var VAPLAYER_HEADERS = {
  "Origin": "https://nextgencloudfabric.com",
  "Referer": "https://nextgencloudfabric.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var PLAYER_KEY = "3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13";

var FETCH_TIMEOUT_MS = 12000;
var MAX_SOURCES = 3;
var TRY_IMDB_FALLBACK = true;

function log(m) { console.log("[" + PROVIDER_NAME + "] " + m); }

function withTimeout(promise, ms, label) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function(resolve, reject) {
    var done = false;
    var t = setTimeout(function() {
      if (!done) { done = true; reject(new Error((label || "request") + " timeout")); }
    }, ms);
    function clear() { if (typeof clearTimeout === "function") clearTimeout(t); }
    promise.then(function(v) {
      if (!done) { done = true; clear(); resolve(v); }
    }, function(e) {
      if (!done) { done = true; clear(); reject(e); }
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

function originOf(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(url || "");
  return m ? m[1] : "";
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

function labelFromName(name) {
  var n = String(name || "").toLowerCase();
  if (n.indexOf("2160p") !== -1 || n.indexOf("4k") !== -1) return "4K";
  if (n.indexOf("1080p") !== -1) return "1080p";
  if (n.indexOf("720p") !== -1) return "720p";
  if (n.indexOf("480p") !== -1) return "480p";
  return "Auto";
}

function rankOf(label) {
  if (label === "4K") return 2160;
  var n = parseInt(label, 10);
  return isNaN(n) ? 0 : n;
}

function kindOfUrl(url) {
  var u = String(url || "");
  if (/\.m3u8/i.test(u)) return "hls";
  var path = u.split("#")[0].split("?")[0];
  if (/\.(mp4|m4v|mkv|webm)$/i.test(path)) return "mp4";
  if (/\.mpd$/i.test(path)) return "dash";
  return "hls";
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

function headersOf(c) {
  return c.full || cdnHeaders(c.referer, c.origin);
}

function buildCands(url, opts) {
  opts = opts || {};
  var list = [];
  var seen = {};
  function add(c) {
    var k = (c.full ? "full:" : "") + (c.referer || "") + "|" + (c.origin || "");
    if (seen[k]) return;
    seen[k] = true;
    list.push(c);
  }
  if (opts.customHeaders) {
    add({ full: opts.customHeaders, referer: opts.customHeaders["Referer"] || "", origin: opts.customHeaders["Origin"] || "" });
  }
  if (opts.hint) add({ referer: opts.hint.referer || "", origin: opts.hint.origin || "" });
  var rule = ruleFor(url);
  if (rule) rule.referers.forEach(function(r) { add({ referer: r, origin: rule.origin || "" }); });
  CDN_CANDIDATES.forEach(function(c) { add({ referer: c.referer, origin: c.origin }); });
  return list;
}

var SUB_KEY = /sub|caption|track|thumb|poster|preview|vtt|srt/i;
var SUB_URL = /\.(vtt|srt|ass|ssa|jpg|jpeg|png|webp|gif|svg)(\?|#|$)/i;
var MEDIA_KEY = /^(url|file|src|link|playlist|stream|source|hls|m3u8|manifest)$/i;

function hintFrom(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  var hd = (o.headers && typeof o.headers === "object") ? o.headers : {};
  var ref = o.referer || o.referrer || o.Referer || hd.Referer || hd.referer || hd.referrer || "";
  var org = o.origin || o.Origin || hd.Origin || hd.origin || "";
  if (typeof ref !== "string" || !/^https?:\/\//i.test(ref)) ref = "";
  if (typeof org !== "string" || !/^https?:\/\//i.test(org)) org = "";
  if (!ref && !org) return null;
  return { referer: ref || (org + "/"), origin: org || originOf(ref) };
}

function walkMedia(node, out, depth, key, hint) {
  if (node == null || depth > 7) return;
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node) && !SUB_URL.test(node) && !SUB_KEY.test(key || "") &&
        (MEDIA_KEY.test(key || "") || /\.(m3u8|mpd|mp4)(\?|#|$)/i.test(node))) {
      out.push({ url: node, hint: hint || null });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(function(n) { walkMedia(n, out, depth + 1, key, hint); });
    return;
  }
  if (typeof node === "object") {
    var h = hintFrom(node) || hint;
    Object.keys(node).forEach(function(k) {
      if (!SUB_KEY.test(k) && k !== "headers") walkMedia(node[k], out, depth + 1, k, h);
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
  return {
    variants: Object.keys(byKey).map(function(k) { return byKey[k]; }),
    best: best,
    hasSeparateAudio: hasSeparateAudio
  };
}

function makeStream(ctx, url, label, rank, headers, trust, type) {
  var h = {};
  Object.keys(headers).forEach(function(k) { h[k] = headers[k]; });
  return {
    name: PROVIDER_NAME + " " + label,
    title: ctx.displayTitle + " \u2022 " + label + " \u2022 " + ctx.gatewayLabel,
    url: url,
    quality: label,
    size: "Unknown",
    type: type || "hls",
    headers: h,
    subtitles: ctx.subtitles,
    provider: PROVIDER_ID,
    _rank: rank,
    _trust: trust
  };
}

function tryCandidate(url, c) {
  var hdrs = headersOf(c);
  function attempt(n) {
    return request(url, hdrs).then(function(r) {
      if (r.ok && r.text.indexOf("#EXTM3U") !== -1) return { r: r, cand: c };
      if (n === 0 && (r.status === 429 || r.status >= 500)) return attempt(1);
      return null;
    }, function() {
      return n === 0 ? attempt(1) : null;
    });
  }
  return attempt(0);
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

// ---------------------------------------------------------------- expandSource (ORIGINAL — single top stream when audio is separate)
function expandSource(url, ctx, opts) {
  var kind = kindOfUrl(url);
  var cands = buildCands(url, opts);

  if (kind !== "hls") {
    var d = labelFromName(url);
    return Promise.resolve([makeStream(ctx, url, d, 1000000, headersOf(cands[0]), 1, kind)]);
  }

  return firstValid(cands.map(function(c) { return tryCandidate(url, c); })).then(function(x) {
    if (!x) {
      log("playlist not retrievable with any header set: " + url.split("?")[0]);
      return [makeStream(ctx, url, "Auto", 1000000, headersOf(cands[0]), 0)];
    }
    var r = x.r;
    var hdr = headersOf(x.cand);
    var finalUrl = /^https?:\/\//i.test(r.url || "") ? r.url : url;
    var master = parseMaster(finalUrl, r.text);
    var top = labelFromRes(master.best.w, master.best.h);

    // *** THE ORIGINAL BEHAVIOR: if audio is separate, return ONE stream labeled with the top quality ***
    if (master.variants.length < 2 || master.hasSeparateAudio) {
      return [makeStream(ctx, finalUrl, top, 1000000, hdr, 2)];
    }
    var out = [makeStream(ctx, finalUrl, "Auto", 1000000, hdr, 2)];
    master.variants.forEach(function(v) {
      out.push(makeStream(ctx, v.url, v.label, rankOf(v.label), hdr, 2));
    });
    return out;
  }).catch(function(e) {
    log("expand failed: " + (e && e.message));
    return [makeStream(ctx, url, "Auto", 1000000, headersOf(cands[0]), 0)];
  });
}

function better(a, b) {
  if (a._trust !== b._trust) return a._trust > b._trust;
  return a._rank > b._rank;
}

function pickBest(groups) {
  var byQ = {};
  groups.forEach(function(g) {
    g.forEach(function(s) {
      var cur = byQ[s.quality];
      if (!cur || better(s, cur)) byQ[s.quality] = s;
    });
  });
  var all = Object.keys(byQ).map(function(k) { return byQ[k]; });
  function byRank(a, b) { return b._rank - a._rank; }
  return {
    good: all.filter(function(s) { return s._trust === 2; }).sort(byRank),
    extra: all.filter(function(s) { return s._trust === 1; }).sort(byRank),
    bad: all.filter(function(s) { return s._trust === 0; }).sort(byRank)
  };
}

function clean(s) {
  delete s._rank;
  delete s._trust;
  return s;
}

function fetchMeta(tmdbId, type) {
  var url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&language=en&append_to_response=external_ids";
  return request(url, { "Accept": "application/json" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    var d = JSON.parse(r.text);
    var title = type === "movie" ? (d.title || d.original_title) : (d.name || d.original_name);
    var date = type === "movie" ? d.release_date : d.first_air_date;
    return {
      title: title || "",
      year: (date || "").slice(0, 4),
      imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || ""
    };
  });
}

function applyMeta(ctx, meta, type, season, episode) {
  if (meta && meta.title) {
    ctx.displayTitle = type === "movie"
      ? meta.title + (meta.year ? " (" + meta.year + ")" : "")
      : meta.title + " S" + pad2(season) + "E" + pad2(episode);
  }
}

function apiHeaders(gw) {
  return {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "x-player-key": PLAYER_KEY,
    "Referer": gw.origin + "/",
    "Origin": gw.origin
  };
}

function callApi(gw, path) {
  return request(gw.api + "/" + path, apiHeaders(gw)).then(function(r) {
    var data = null;
    try { data = JSON.parse(r.text); } catch (e) { /* not JSON */ }
    if (!data || typeof data !== "object") return { kind: "bad", why: "HTTP " + r.status + " (not JSON)" };
    if (data.result === true || (r.ok && data.result !== false)) return { kind: "ok", data: data };
    var msg = String(data.message || "");
    if (r.status === 401 || r.status === 403 || /unauthor|forbid|denied|invalid|origin|referer|key/i.test(msg)) {
      return { kind: "bad", why: "HTTP " + r.status + " " + msg };
    }
    return { kind: "none", why: msg || ("HTTP " + r.status) };
  }).catch(function(e) {
    return { kind: "bad", why: (e && e.message) || "network error" };
  });
}

function resolveApi(ctx) {
  var noneApis = {};

  function tryImdb(gw) {
    if (!TRY_IMDB_FALLBACK) return Promise.resolve(null);
    return ctx.metaP.then(function(meta) {
      if (!meta || !meta.imdbId) return null;
      return callApi(gw, ctx.path(meta.imdbId)).then(function(res) {
        if (res.kind === "ok") { log(gw.label + ": found by IMDb id " + meta.imdbId); return { gw: gw, data: res.data }; }
        return null;
      });
    });
  }

  function step(i) {
    if (i >= GATEWAYS.length) return Promise.resolve(null);
    var gw = GATEWAYS[i];
    if (noneApis[gw.api]) return step(i + 1);
    return callApi(gw, ctx.path(ctx.tmdbId)).then(function(res) {
      if (res.kind === "ok") return { gw: gw, data: res.data };
      if (res.kind === "none") {
        log(gw.label + ": " + res.why);
        return tryImdb(gw).then(function(found) {
          if (found) return found;
          noneApis[gw.api] = true;
          return step(i + 1);
        });
      }
      log(gw.label + " rejected: " + res.why);
      return step(i + 1);
    });
  }
  return step(0);
}

function vaplayerStage(ctx, type, season, episode) {
  var none = { good: [], extra: [], bad: [] };
  var url = VAPLAYER_API + "?tmdb=" + encodeURIComponent(ctx.tmdbId) + "&type=" + type;
  if (type === "tv") url += "&season=" + season + "&episode=" + episode;
  log("vaplayer fallback: " + url);

  return request(url, VAPLAYER_HEADERS).then(function(r) {
    var data = null;
    try { data = JSON.parse(r.text); } catch (e) { /* not JSON */ }
    if (!r.ok || !data || data.status_code != 200 || !data.data || !Array.isArray(data.data.stream_urls)) {
      log("vaplayer: nothing (HTTP " + r.status + ")");
      return none;
    }

    var subs = [];
    if (Array.isArray(data.default_subs)) {
      data.default_subs.forEach(function(s) {
        if (!s || typeof s.url !== "string") return;
        var lang = s.lang || s.code || "";
        subs.push({
          url: s.url,
          language: String(lang).toLowerCase().slice(0, 12) || "und",
          name: String(lang || "Subtitle")
        });
      });
    }
    ctx.subtitles = subs;
    ctx.gatewayLabel = "vaplayer";

    return Promise.all(data.data.stream_urls.map(function(u) {
      if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return Promise.resolve([]);
      return expandSource(u, ctx, { customHeaders: VAPLAYER_HEADERS });
    })).then(function(groups) {
      var res = pickBest(groups);
      log("vaplayer: " + res.good.length + " verified, " + res.extra.length + " direct, " + res.bad.length + " unverified");
      return res;
    });
  });
}

function fallbackStage(ctx, type, season, episode) {
  var none = { good: [], extra: [], bad: [] };
  if (!USE_VAPLAYER_FALLBACK) return Promise.resolve(none);
  return ctx.metaP.then(function(meta) {
    applyMeta(ctx, meta, type, season, episode);
    return vaplayerStage(ctx, type, season, episode);
  }).catch(function(e) {
    log("vaplayer fallback failed: " + (e && e.message));
    return none;
  });
}

function gatewayStage(ctx, found, type, season, episode) {
  var none = { good: [], extra: [], bad: [] };
  ctx.gatewayLabel = found.gw.label;

  return ctx.metaP.then(function(meta) {
    applyMeta(ctx, meta, type, season, episode);

    var media = [];
    walkMedia(found.data, media, 0, "", null);
    media = unique(media);
    media.sort(function(a, b) {
      return (/\.m3u8/i.test(b.url) ? 1 : 0) - (/\.m3u8/i.test(a.url) ? 1 : 0);
    });
    if (!media.length) {
      log("no media url in reply");
      return none;
    }

    var subs = [];
    walkSubs(found.data, subs, 0, false);
    ctx.subtitles = unique(subs);

    return Promise.all(media.slice(0, MAX_SOURCES).map(function(m) {
      return expandSource(m.url, ctx, { hint: m.hint });
    })).then(function(groups) {
      var res = pickBest(groups);
      log(found.gw.label + ": " + res.good.length + " verified, " + res.extra.length + " direct, " + res.bad.length + " unverified");
      return res;
    });
  });
}

function getStreamsFor(tmdbId, type, season, episode) {
  var ctx = {
    tmdbId: tmdbId,
    path: function(id) {
      return type === "movie"
        ? "movie/" + encodeURIComponent(id)
        : "tv/" + encodeURIComponent(id) + "/" + season + "/" + episode;
    },
    displayTitle: type === "movie" ? "TMDB " + tmdbId : "TMDB " + tmdbId + " S" + pad2(season) + "E" + pad2(episode),
    gatewayLabel: "",
    subtitles: [],
    metaP: null
  };
  ctx.metaP = fetchMeta(tmdbId, type).catch(function() { return null; });

  return resolveApi(ctx).then(function(found) {
    if (!found) {
      log(type + " " + tmdbId + ": not available on any gateway");
      return { good: [], extra: [], bad: [] };
    }
    return gatewayStage(ctx, found, type, season, episode);
  }).then(function(gw) {
    if (gw.good.length) return gw.good.concat(gw.extra).map(clean);

    if (gw.bad.length) log("gateway links could not be verified; trying vaplayer");
    return fallbackStage(ctx, type, season, episode).then(function(fb) {
      if (fb.good.length) return fb.good.concat(fb.extra).map(clean);

      var direct = gw.extra.concat(fb.extra);
      if (direct.length) return direct.map(clean);

      var last = gw.bad.concat(fb.bad);
      if (last.length) {
        var s = clean(last[0]);
        s.name = s.name + " (unverified)";
        s.title = s.title + " \u2022 unverified";
        return [s];
      }
      return [];
    });
  }).then(function(out) {
    log("Returned " + out.length + " stream(s)");
    return out;
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

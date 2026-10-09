var PROVIDER_ID = "vidnest";
var PROVIDER_NAME = "VidNest";

var API_BASE = "https://new.vidnest.fun";
var SITE_ORIGIN = "https://vidnest.fun";
var CF_PROXY = "https://script.iamtjake.workers.dev";

var SERVERS = ["moviebox", "klikxxi", "allmovies", "onehd", "hollymoviehd"];

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
var API_TIMEOUT_MS = 20000;
var HLS_TIMEOUT_MS = 15000;
var SESSION_TIMEOUT_MS = 10000;

function log(m) { console.log("[" + PROVIDER_NAME + "] " + m); }
function snip(t, n) { return String(t || "").substring(0, n || 240).replace(/\s+/g, " "); }

function withTimeout(promise, ms, label) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () {
      if (!done) { done = true; reject(new Error((label || "request") + " timeout")); }
    }, ms);
    promise.then(function (v) {
      if (!done) { done = true; clearTimeout(t); resolve(v); }
    }, function (e) {
      if (!done) { done = true; clearTimeout(t); reject(e); }
    });
  });
}

function request(url, headers, timeoutMs) {
  return withTimeout(
    fetch(url, { method: "GET", headers: headers || {}, redirect: "follow", credentials: "include" }).then(function (r) {
      return r.text().then(function (t) {
        return { ok: r.ok, status: r.status, text: t, url: r.url || url };
      });
    }),
    timeoutMs || API_TIMEOUT_MS,
    url.split("?")[0]
  );
}

function initSession() {
  log("Initializing session...");
  return request(SITE_ORIGIN + "/", {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  }, SESSION_TIMEOUT_MS).then(function (r) {
    log("Session init: HTTP " + r.status);
    return true;
  }).catch(function (e) {
    log("Session init failed: " + (e && e.message));
    return false;
  });
}

var ALPHA = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";
var ALPHA_MAP = (function () {
  var m = {};
  for (var i = 0; i < ALPHA.length; i++) m[ALPHA.charAt(i)] = i;
  return m;
})();

function alphaIdx(c) {
  var v = ALPHA_MAP[c];
  return v === undefined ? 64 : v;
}

function utf8Decode(bytes) {
  var pct = "";
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    pct += "%" + (h.length < 2 ? "0" + h : h);
  }
  try { return decodeURIComponent(pct); } catch (e) {
    var out = "";
    for (var j = 0; j < bytes.length; j++) out += String.fromCharCode(bytes[j]);
    return out;
  }
}

function decodeVidnest(data) {
  var bytes = [];
  for (var i = 0; i < data.length; i += 4) {
    var chunk = data.substr(i, 4);
    while (chunk.length < 4) chunk += "=";
    var l0 = alphaIdx(chunk.charAt(0));
    var l1 = alphaIdx(chunk.charAt(1));
    var l2 = alphaIdx(chunk.charAt(2));
    var l3 = alphaIdx(chunk.charAt(3));
    bytes.push(((l0 << 2) | (l1 >> 4)) & 255);
    if (l2 !== 64) bytes.push((((l1 & 15) << 4) | (l2 >> 2)) & 255);
    if (l3 !== 64) bytes.push((((l2 & 3) << 6) | l3) & 255);
  }
  return utf8Decode(bytes);
}

function fetchVidnest(path) {
  var url = API_BASE + path;
  log("GET " + url);
  var headers = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Origin": SITE_ORIGIN,
    "Referer": SITE_ORIGIN + "/",
    "X-Requested-With": "XMLHttpRequest"
  };
  return request(url, headers, API_TIMEOUT_MS).then(function (r) {
    log("HTTP " + r.status + " len=" + (r.text ? r.text.length : 0));
    if (!r.ok) throw new Error("HTTP " + r.status + " " + snip(r.text));
    var payload;
    try { payload = JSON.parse(r.text); } catch (e) {
      throw new Error("non-JSON response: " + snip(r.text));
    }
    if (payload && payload.encrypted) {
      if (typeof payload.data !== "string") throw new Error("encrypted payload without data");
      var dec = decodeVidnest(payload.data);
      try { return JSON.parse(dec); } catch (e2) {
        log("decoded payload is not JSON: " + snip(dec));
        return { raw: dec };
      }
    }
    return payload;
  });
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

function absUrl(base, rel) {
  if (/^https?:\/\//i.test(rel)) return rel;
  if (/^\/\//.test(rel)) return "https:" + rel;
  var clean = base.split("#")[0].split("?")[0];
  var m = /^(https?:\/\/[^\/]+)(\/.*)?$/i.exec(clean);
  if (!m) return rel;
  var origin = m[1];
  if (rel.charAt(0) === "/") return origin + rel;
  var parts = (m[2] || "/").split("/");
  parts.pop();
  rel.split("/").forEach(function (seg) {
    if (seg === "..") { if (parts.length > 1) parts.pop(); }
    else if (seg !== ".") parts.push(seg);
  });
  return origin + parts.join("/");
}

function parseQuality(s) {
  s = String(s == null ? "" : s);
  if (/4k|2160/i.test(s)) return "4K";
  var m = /(?:^|[^0-9])(1440|1080|720|480|360|240|144)(?:p|[^0-9]|$)/i.exec(s);
  return m ? m[1] + "p" : null;
}

function parseQualityFromUrl(url) {
  var path = String(url).split("?")[0];
  var m = /[\/_.\-](2160|1440|1080|720|480|360)p?(?=[\/_.\-]|$)/i.exec(path);
  if (m) return parseInt(m[1], 10) === 2160 ? "4K" : m[1] + "p";
  m = /(\d{3,4})p/i.exec(path);
  return m ? parseQuality(m[1]) : null;
}

function qualityFrom(node, url) {
  if (node && typeof node === "object") {
    var keys = ["quality", "resolution", "label", "name", "res", "height", "format"];
    for (var i = 0; i < keys.length; i++) {
      var v = node[keys[i]];
      if (v == null || typeof v === "object") continue;
      var q = parseQuality(v);
      if (q) return q;
    }
  }
  return parseQualityFromUrl(url) || "Auto";
}

var IMG_RE = /\.(?:jpe?g|png|webp|gif|svg|ico|avif)(?:\?|#|$)/i;
var SUB_EXT_RE = /\.(?:srt|vtt|ass|ssa)(?:\?|#|$)/i;
var SUB_CONTAINER_RE = /^(?:subtitles?|captions?|tracks?|subs)$/i;
var IMG_KEY_RE = /poster|image|thumb|cover|logo|backdrop|banner|avatar|icon/i;
var URL_KEYS = ["url", "file", "src", "link", "stream", "playlist", "source", "href", "download"];

function isHttp(s) { return typeof s === "string" && /^https?:\/\//i.test(s); }

function pickLang(node) {
  if (!node || typeof node !== "object") return "Subtitle";
  var v = node.lang || node.language || node.lan || node.label || node.name || node.display;
  return typeof v === "string" && v ? v : "Subtitle";
}

function addFound(f, url, node, inSub) {
  if (IMG_RE.test(url)) return;
  if (inSub || SUB_EXT_RE.test(url)) {
    f.subs.push({ url: url, lang: pickLang(node) });
  } else {
    f.streams.push({ url: url, label: qualityFrom(node, url) });
  }
}

function walk(node, f, inSub, depth) {
  if (node == null || depth > 8) return;
  if (typeof node === "string") {
    if (isHttp(node)) addFound(f, node, null, inSub);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(function (n) { walk(n, f, inSub, depth + 1); });
    return;
  }
  if (typeof node !== "object") return;

  var direct = null;
  for (var i = 0; i < URL_KEYS.length; i++) {
    if (isHttp(node[URL_KEYS[i]])) { direct = node[URL_KEYS[i]]; break; }
  }
  if (direct) addFound(f, direct, node, inSub);

  Object.keys(node).forEach(function (k) {
    var v = node[k];
    if (v && typeof v === "object") {
      walk(v, f, inSub || SUB_CONTAINER_RE.test(k), depth + 1);
    } else if (k === "raw" && typeof v === "string") {
      (v.match(/https?:\/\/[^\s"'<>\\]+/g) || []).forEach(function (u) { addFound(f, u, null, inSub); });
    } else if (!direct && isHttp(v) && !IMG_KEY_RE.test(k) && URL_KEYS.indexOf(k) === -1) {
      addFound(f, v, node, inSub);
    }
  });
}

function extract(data) {
  var f = { streams: [], subs: [] };
  walk(data, f, false, 0);
  return f;
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
    variants: Object.keys(byKey).map(function (k) { return byKey[k]; }),
    best: best,
    hasSeparateAudio: hasSeparateAudio
  };
}

function makeStream(ctx, url, label, rank, headers, subtitles, isHls) {
  var h = {};
  Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
  return {
    name: PROVIDER_NAME + " " + label,
    title: ctx.displayTitle + " \u2022 " + label,
    url: url,
    quality: label,
    size: "Unknown",
    type: isHls ? "hls" : "mp4",
    headers: h,
    subtitles: subtitles || [],
    provider: PROVIDER_ID,
    _rank: rank
  };
}

function proxied(targetUrl) {
  return CF_PROXY + "?url=" + encodeURIComponent(targetUrl);
}

function isWorkerProxy(url) {
  return /vidnest-[^.\/]+\.workers\.dev/i.test(url);
}

function toStreams(ctx, item, subtitles) {
  var headers = {
    "User-Agent": UA,
    "Referer": SITE_ORIGIN + "/",
    "Origin": SITE_ORIGIN
  };
  var label = item.label;
  var url = item.url;

  if (isWorkerProxy(url)) {
    url = proxied(url);
    headers = { "User-Agent": UA };
    log("routed via CF proxy: " + url.substring(0, 90));
  }

  if (!/\.m3u8/i.test(item.url)) {
    return Promise.resolve([makeStream(ctx, url, label, rankOf(label) || 1, headers, subtitles, false)]);
  }

  return request(url, headers, HLS_TIMEOUT_MS).then(function (r) {
    if (!r.ok || r.text.indexOf("#EXTM3U") === -1) {
      log("proxy rejected (" + r.status + "): " + url.substring(0, 90));
      return [makeStream(ctx, url, label, rankOf(label) || 1000000, headers, subtitles, true)];
    }
    var master = parseMaster(url, r.text);
    var top = labelFromRes(master.best.w, master.best.h);
    if (master.variants.length < 2 || master.hasSeparateAudio) {
      return [makeStream(ctx, url, top, 1000000, headers, subtitles, true)];
    }
    var out = [makeStream(ctx, url, "Auto", 1000000, headers, subtitles, true)];
    master.variants.forEach(function (v) {
      out.push(makeStream(ctx, v.url, v.label, rankOf(v.label), headers, subtitles, true));
    });
    return out;
  }).catch(function (e) {
    log("proxy error (" + (e && e.message) + ")");
    return [makeStream(ctx, url, label, rankOf(label) || 1000000, headers, subtitles, true)];
  });
}

function mediaPath(server, type, tmdbId, season, episode) {
  var id = encodeURIComponent(tmdbId);
  return type === "movie"
    ? "/" + server + "/movie/" + id
    : "/" + server + "/tv/" + id + "/" + season + "/" + episode;
}

function subtitlePath(type, tmdbId, season, episode) {
  var id = encodeURIComponent(tmdbId);
  return type === "movie" ? "/subtitles/" + id : "/subtitles/" + id + "/" + season + "/" + episode;
}

function getStreamsFor(tmdbId, type, season, episode) {
  var ctx = {
    displayTitle: type === "movie"
      ? "TMDB " + tmdbId
      : "TMDB " + tmdbId + " S" + pad2(season) + "E" + pad2(episode)
  };

  return initSession().then(function () {
    var subsP = fetchVidnest(subtitlePath(type, tmdbId, season, episode)).then(function (d) {
      var f = extract(d);
      log("subtitles endpoint: " + f.subs.length + " track(s)");
      return f.subs;
    }).catch(function (e) {
      log("subtitles failed: " + (e && e.message));
      return [];
    });

    var serverPs = SERVERS.map(function (srv) {
      return fetchVidnest(mediaPath(srv, type, tmdbId, season, episode)).then(function (d) {
        var f = extract(d);
        log(srv + ": " + f.streams.length + " stream url(s)");
        return f;
      }).catch(function (e) {
        log(srv + " failed: " + (e && e.message));
        return { streams: [], subs: [] };
      });
    });

    return Promise.all([Promise.all(serverPs), subsP]).then(function (res) {
      var found = [];
      var rawSubs = res[1].slice();
      res[0].forEach(function (f) {
        found = found.concat(f.streams);
        rawSubs = rawSubs.concat(f.subs);
      });

      var seenSub = {};
      var subtitles = [];
      rawSubs.forEach(function (s) {
        if (seenSub[s.url]) return;
        seenSub[s.url] = true;
        subtitles.push({
          url: s.url,
          language: String(s.lang || "und").toLowerCase().slice(0, 12),
          name: s.lang || "Subtitle"
        });
      });

      if (!found.length) {
        log("no stream urls found");
        return [];
      }

      return Promise.all(found.map(function (it) {
        return toStreams(ctx, it, subtitles);
      })).then(function (groups) {
        var seen = {};
        var out = [];
        groups.forEach(function (g) {
          g.forEach(function (s) {
            if (seen[s.url]) return;
            seen[s.url] = true;
            out.push(s);
          });
        });
        out.sort(function (a, b) { return b._rank - a._rank; });
        out.forEach(function (s) { delete s._rank; });
        log("Returned " + out.length + " stream(s)");
        return out;
      });
    });
  }).catch(function (err) {
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
  return getStreamsFor(String(tmdbId), type, season, episode).catch(function (err) {
    log("error: " + (err && err.message));
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}

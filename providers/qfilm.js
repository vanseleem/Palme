var BASE = "https://a.qfilm.tv";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MIRROR_TIMEOUT = 15000;
var MAX_PROVIDERS = 4;
var BAD_HOST = /(^|\.)(qfilm\.tv|facebook\.com|twitter\.com|google\.com|googleapis\.com|gstatic\.com|w3\.org|schema\.org|cloudflare\.com|jquery\.com|jsdelivr\.net|t\.me|telegram\.org|themoviedb\.org)$/i;

function fetchText(url, referer) {
  url = String(url).replace(/[^\x00-\x7F]/g, function(c) { return encodeURIComponent(c); });
  var headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  if (referer) headers["Referer"] = String(referer).replace(/[^\x00-\x7F]/g, function(c) { return encodeURIComponent(c); });
  return fetch(url, { headers: headers, redirect: "follow" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}

function decodeHtml(str) {
  return String(str || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function normalizeTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEscapes(s) {
  return String(s || "")
    .replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/&amp;/g, "&");
}

function originOf(u) {
  var m = String(u || "").match(/^(https?:\/\/[^\/?#]+)/i);
  return m ? m[1] : BASE;
}

function withTimeout(promise, ms, fallback) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function(resolve) {
    var done = false;
    var t = setTimeout(function() { if (!done) { done = true; resolve(fallback); } }, ms);
    function finish(v) {
      if (done) return;
      done = true;
      if (typeof clearTimeout === "function") clearTimeout(t);
      resolve(v);
    }
    promise.then(finish, function() { finish(fallback); });
  });
}

function similarity(a, b) {
  a = normalizeTitle(a); b = normalizeTitle(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
    return 0.5 + 0.4 * Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  var aa = a.split(" "); var bb = b.split(" ");
  var setB = {}; bb.forEach(function(x) { setB[x] = 1; });
  var common = 0; aa.forEach(function(x) { if (setB[x]) common++; });
  return common / Math.max(aa.length, bb.length);
}

function cleanSiteTitle(str) {
  var s = decodeHtml(String(str || ""))
    .replace(/مشاهدة|فيلم|مسلسل|مترجم[ةه]?|مدبلج[ةه]?|اون\s*لاين|اونلاين|أون\s*لاين|كامل[ةه]?|\bHD\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  var noYear = s.replace(/\(?\b(?:19|20)\d{2}\b\)?/g, " ").replace(/\s+/g, " ").trim();
  return noYear || s;
}

function scoreResult(r, titles, year) {
  var cleaned = cleanSiteTitle(r.title);
  var s = 0;
  titles.forEach(function(t) {
    var sc = Math.max(similarity(cleaned, t), similarity(r.title, t) * 0.9);
    if (sc > s) s = sc;
  });
  if (year) {
    var ys = String(r.title).match(/\b(?:19|20)\d{2}\b/g);
    if (ys) {
      var ok = ys.some(function(y) { return Math.abs(Number(y) - Number(year)) <= 1; });
      s = ok ? Math.min(1, s + 0.1) : s * 0.5;
    }
  }
  return s;
}

function getTmdbTitles(tmdbId) {
  var langs = ["ar", "en"];
  var titles = [];
  var year = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/movie/" + encodeURIComponent(tmdbId) +
                   "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        // collect both title and original_title for better matching
        [data.title, data.original_title].forEach(function(t) {
          if (t && titles.indexOf(t) === -1) titles.push(t);
        });
        if (!year && data.release_date) year = data.release_date.slice(0, 4);
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (!titles.length) throw new Error("Could not get TMDB titles for " + tmdbId);
    console.log("[QFilm] TMDB titles:", titles.join(" | "));
    return { titles: titles, year: year };
  });
}

function searchQFilm(title) {
  var cleanTitle = String(title || "").replace(/[:\u060C-\u061F]/g, " ").replace(/\s+/g, " ").trim();
  var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle);
  console.log("[QFilm] Search:", cleanTitle);
  return fetchText(url, BASE + "/").then(function(html) {
    var results = [];
    var seen = {};
    var re = /<a[^>]*href=["']([^"']*\/watch\.php\?vid=([^"'&]+))["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var fullUrl = decodeHtml(m[1]); var vid = m[2]; var linkTitle = decodeHtml(m[3]);
      if (seen[vid]) continue; seen[vid] = 1;
      var absolute = fullUrl.indexOf("http") === 0 ? fullUrl : BASE + fullUrl;
      results.push({ url: absolute, title: linkTitle, vid: vid });
    }
    if (!results.length) {
      var re2 = /<a[^>]*href=["']([^"']*\/watch\.php\?vid=([^"'&]+))["'][^>]*>/gi;
      while ((m = re2.exec(html)) !== null) {
        var fullUrl2 = decodeHtml(m[1]); var vid2 = m[2];
        if (seen[vid2]) continue; seen[vid2] = 1;
        var absolute2 = fullUrl2.indexOf("http") === 0 ? fullUrl2 : BASE + fullUrl2;
        results.push({ url: absolute2, title: vid2, vid: vid2 });
      }
    }
    console.log("[QFilm] Search results:", results.length);
    return results;
  });
}

function chooseResult(results, titles, year) {
  var best = null; var bestScore = 0;
  results.forEach(function(r) {
    var s = scoreResult(r, titles, year);
    if (s > bestScore) { bestScore = s; best = r; }
  });
  if (best) console.log("[QFilm] Best:", best.title, "score:", bestScore.toFixed(3));
  return bestScore >= 0.3 ? best : null;
}

function hostLabel(host) {
  var parts = String(host).replace(/^www\./, "").split(".");
  var name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function rawMirror(raw) {
  var u = cleanEscapes(raw).trim();
  if (!u) return null;
  if (u.indexOf("//") === 0) u = "https:" + u;
  if (u.charAt(0) === "/") u = BASE + u;
  if (!/^https?:\/\//i.test(u)) return null;
  var m = u.match(/^https?:\/\/([^\/?#:]+)/i);
  if (!m) return null;
  var host = m[1].toLowerCase();
  if (BAD_HOST.test(host)) return null;
  if (/\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?|ttf)(?:\?|$)/i.test(u)) return null;
  return { embed: u, host: host, label: hostLabel(host) };
}

function normalizeMirror(raw) {
  var u = cleanEscapes(raw).trim();
  if (u.indexOf("//") === 0) u = "https:" + u;
  var m = u.match(/^(https?:\/\/)([^\/?#:]+)(?::\d+)?(\/[^?#]*)?(\?[^#]*)?/i);
  if (!m) return null;
  var host = m[2].toLowerCase();
  if (BAD_HOST.test(host)) return null;
  var origin = m[1].toLowerCase() + host;
  var path = m[3] || "/"; var query = m[4] || "";
  var id = null; var embed = null; var mm;
  if ((mm = path.match(/^\/embed-([a-z0-9]{8,20})(?:\.html)?$/i))) {
    id = mm[1]; embed = origin + "/embed-" + id + ".html";
  } else if ((mm = path.match(/^\/(?:d|dl)\/([a-z0-9]{8,20})(?:_[a-z])?\/?$/i))) {
    id = mm[1]; embed = origin + "/embed-" + id + ".html";
  } else if (/^\/dl\/?$/i.test(path) && (mm = query.match(/[?&]id=([a-z0-9]{8,20})/i))) {
    id = mm[1]; embed = origin + "/embed-" + id + ".html";
  } else if ((mm = path.match(/^\/download\/([a-z0-9]{8,20})\/?$/i))) {
    id = mm[1]; embed = origin + "/e/" + id;
  } else if ((mm = path.match(/^\/(?:e|embed)\/([a-z0-9]{8,20})\/?$/i))) {
    id = mm[1]; embed = origin + path;
  } else {
    return null;
  }
  return { embed: embed, host: host, id: id, label: hostLabel(host) };
}

function collectUrls(text, out) {
  var re = /(?:https?:)?\/\/[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}(?::\d+)?\/[^\s"'<>\\)\]]*/gi;
  var m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
}

function b64decode(s) {
  try {
    if (typeof atob === "function") return atob(s);
    if (typeof Buffer !== "undefined") return Buffer.from(s, "base64").toString("binary");
  } catch (e) {}
  return "";
}

function harvestMirrors(html) {
  var out = [];
  var seen = {};
  function add(mir) {
    if (!mir) return;
    var k = mir.embed.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(mir);
  }
  var text = cleanEscapes(html);
  var m;

  // <option> values
  var reOpt = /<option[^>]+value=["']([^"']+)["'][^>]*>/gi;
  while ((m = reOpt.exec(text)) !== null) add(rawMirror(m[1]) || normalizeMirror(m[1]));

  // <iframe src>
  var reIf = /<iframe[^>]+src=["']([^"']+)["']/gi;
  while ((m = reIf.exec(text)) !== null) add(rawMirror(m[1]) || normalizeMirror(m[1]));

  // data-src / data-url / data-link / data-embed attributes (server buttons)
  var reData = /data-(?:src|url|link|embed|server|iframe)\s*=\s*["']([^"']+)["']/gi;
  while ((m = reData.exec(text)) !== null) add(rawMirror(m[1]) || normalizeMirror(m[1]));

  // JS arrays: var servers = [...] / var s = [...] / var serverList = [...]
  var reArr = /var\s+(?:servers?|srv|s|serverList|srvList|playerList|links?)\s*=\s*\[([^\]]{10,})\]/gi;
  while ((m = reArr.exec(text)) !== null) {
    var arrText = m[1];
    // Extract quoted strings from the array that look like URLs
    var reStr = /["']([^"']{10,})["']/g;
    var sm;
    while ((sm = reStr.exec(arrText)) !== null) {
      add(rawMirror(sm[1]) || normalizeMirror(sm[1]));
    }
    // Also extract any inline src= or href= within HTML strings in the array
    var reInSrc = /src=["']([^"']+)["']/gi;
    while ((sm = reInSrc.exec(arrText)) !== null) add(rawMirror(sm[1]) || normalizeMirror(sm[1]));
  }

  // JS objects: { "1": "url", "2": "url" } or { s1: "url", s2: "url" }
  var reObj = /var\s+(?:servers?|srv|serverList|srvList|links?)\s*=\s*\{([^}]{10,})\}/gi;
  while ((m = reObj.exec(text)) !== null) {
    var objText = m[1];
    var reVal = /:\s*["']([^"']{10,})["']/g;
    var om;
    while ((om = reVal.exec(objText)) !== null) add(rawMirror(om[1]) || normalizeMirror(om[1]));
  }

  // Collect all remaining URLs
  var urls = [];
  collectUrls(text, urls);

  // Decode base64 strings that might contain URLs
  var reB64 = /["']([A-Za-z0-9+\/]{24,}={0,2})["']/g;
  while ((m = reB64.exec(text)) !== null) {
    var dec = b64decode(m[1]);
    if (dec && dec.indexOf("//") !== -1) collectUrls(cleanEscapes(dec), urls);
  }

  // atob() calls
  var reAtob = /atob\s*\(\s*["']([A-Za-z0-9+\/]{24,}={0,2})["']\s*\)/g;
  while ((m = reAtob.exec(text)) !== null) {
    var dec2 = b64decode(m[1]);
    if (dec2 && dec2.indexOf("//") !== -1) collectUrls(cleanEscapes(dec2), urls);
  }

  urls.forEach(function(u) { add(rawMirror(u) || normalizeMirror(u)); });
  return out;
}

function packerEncode(c, a) {
  return (c < a ? "" : packerEncode(parseInt(c / a, 10), a)) +
    ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
}

function unpackEval(html) {
  var m = html.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return null;
  try {
    var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    var base = parseInt(m[2], 10); var count = parseInt(m[3], 10);
    var keywords = m[4].split("|");
    var dict = {};
    while (count--) {
      var key = packerEncode(count, base);
      dict[key] = keywords[count] || key;
    }
    return payload.replace(/\b\w+\b/g, function(w) { return dict.hasOwnProperty(w) ? dict[w] : w; });
  } catch (e) { return null; }
}

function extractStreamsFromPlayer(playerHtml) {
  var streams = [];
  var seen = {};

  function addStream(u) {
    u = String(u || "").replace(/^http:\/\//, "https://").trim();
    if (!u || seen[u]) return;
    seen[u] = 1;
    streams.push(u);
  }

  // Build layers to search: raw + unpacked + atob-decoded
  var layers = [cleanEscapes(playerHtml)];

  var unpacked = unpackEval(playerHtml);
  if (unpacked) layers.push(cleanEscapes(unpacked));

  // Collect atob() decoded content as extra layers
  var reAtob = /atob\s*\(\s*["']([A-Za-z0-9+\/]{24,}={0,2})["']\s*\)/g;
  var am;
  while ((am = reAtob.exec(playerHtml)) !== null) {
    var dec = b64decode(am[1]);
    if (dec && dec.length > 20) layers.push(cleanEscapes(dec));
  }

  layers.forEach(function(layer) {
    // Direct .m3u8 / .mp4 URLs
    var re = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/gi;
    var m;
    while ((m = re.exec(layer)) !== null) addStream(m[0]);

    // Named assignment: file|source|src|url|hls|stream = "...m3u8|mp4"
    var re2 = /(?:file|source|src|url|hls|stream|link|video)\s*[:=]\s*["']([^"']{12,}\.(?:m3u8|mp4)[^"']*)["']/gi;
    while ((m = re2.exec(layer)) !== null) {
      if (m[1].indexOf("http") === 0) addStream(m[1]);
    }

    // JSON "file":"..." or "hls":"..."
    var re3 = /"(?:file|hls|src|url|stream)"\s*:\s*"([^"]{12,}\.(?:m3u8|mp4)[^"]*)"/gi;
    while ((m = re3.exec(layer)) !== null) {
      if (m[1].indexOf("http") === 0) addStream(m[1]);
    }
  });

  console.log("[QFilm] player yielded", streams.length, "stream(s)");
  return streams;
}

function qualityFromUrl(url) {
  var s = String(url).toLowerCase();
  if (/2160|4k/.test(s)) return "4K";
  if (/1440/.test(s)) return "1440p";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "Auto";
}

function qualityRankValue(q) {
  if (q === "4K") return 6; if (q === "1440p") return 5; if (q === "1080p") return 4;
  if (q === "720p") return 3; if (q === "Auto") return 4; if (q === "480p") return 2;
  if (q === "360p") return 1; return 0;
}

function makeStream(url, label, playerUrl) {
  var origin = originOf(playerUrl);
  var streamReferer = origin + "/";
  if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
  return {
    name: "🎬 QFilm",
    title: "🎬 QFilm \u2022 " + label,
    url: url,
    quality: qualityFromUrl(url),
    referer: streamReferer,
    headers: { "User-Agent": UA, "Referer": streamReferer, "Origin": origin, "Accept": "*/*" }
  };
}

function resolveMirror(mir, referer) {
  return fetchText(mir.embed, referer).then(function(html) {
    var urls = extractStreamsFromPlayer(html);
    return { mirror: mir, urls: urls };
  }).catch(function(err) {
    console.log("[QFilm]", mir.label, "failed:", err.message);
    return { mirror: mir, urls: [] };
  });
}

function resolveVid(vid) {
  var playUrl = BASE + "/play.php?vid=" + vid;
  var embedUrl = BASE + "/embed.php?vid=" + vid;
  console.log("[QFilm] play:", playUrl, "embed:", embedUrl);

  return Promise.all([
    fetchText(playUrl, BASE + "/").catch(function() { return ""; }),
    fetchText(embedUrl, BASE + "/").catch(function() { return ""; })
  ]).then(function(htmls) {
    var rawMirrors = [];
    htmls.forEach(function(h) {
      harvestMirrors(h).forEach(function(mir) { rawMirrors.push(mir); });
    });

    // Dedupe by host
    var byHost = {}; var hostOrder = [];
    rawMirrors.forEach(function(mir) {
      if (byHost[mir.host]) return;
      byHost[mir.host] = mir; hostOrder.push(mir.host);
    });

    console.log("[QFilm] unique hosts:", hostOrder.length, "->", hostOrder.map(function(h) { return byHost[h].label; }).join(", "));

    var mirrors = hostOrder.slice(0, MAX_PROVIDERS).map(function(h) { return byHost[h]; });
    if (!mirrors.length) return [];

    return Promise.all(mirrors.map(function(mir) {
      return withTimeout(resolveMirror(mir, embedUrl), MIRROR_TIMEOUT, { mirror: mir, urls: [] });
    })).then(function(results) {
      var streams = []; var fallbacks = [];
      results.forEach(function(r) {
        var label = r.mirror.label;
        if (r.urls.length) {
          r.urls.sort(function(a, b) {
            return qualityRankValue(qualityFromUrl(b)) - qualityRankValue(qualityFromUrl(a));
          });
          streams.push(makeStream(r.urls[0], label, r.mirror.embed));
        } else {
          fallbacks.push({
            name: "🎬 QFilm",
            title: "🎬 QFilm (Embed) \u2022 " + label,
            url: r.mirror.embed,
            quality: "Auto",
            type: "iframe",
            referer: embedUrl
          });
        }
      });
      var out = streams.length ? streams : fallbacks;
      out = out.slice(0, MAX_PROVIDERS);
      console.log("[QFilm] FINAL output:", out.length);
      return out;
    });
  }).catch(function(err) {
    console.log("[QFilm] resolveVid error:", err.message);
    return [];
  });
}

function getMovieStreams(tmdbId) {
  return getTmdbTitles(tmdbId).then(function(meta) {
    return Promise.all(meta.titles.map(function(t) {
      return searchQFilm(t).catch(function() { return []; });
    })).then(function(groups) {
      var all = []; var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) { if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); } });
      });
      console.log("[QFilm] Unique movie candidates:", all.length);
      if (!all.length) return [];
      var best = chooseResult(all, meta.titles, meta.year);
      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[QFilm] Movie error:", err.message);
    return [];
  });
}

// FIXED: positive type guard — QFilm is MOVIE ONLY
function getStreams(tmdbId, mediaType) {
  console.log("[QFilm] getStreams:", tmdbId, mediaType);
  if (mediaType !== "movie") {
    console.log("[QFilm] Skipping — QFilm is strictly movies only, got:", mediaType);
    return Promise.resolve([]);
  }
  return getMovieStreams(tmdbId).then(function(list) {
    return list.slice(0, MAX_PROVIDERS);
  });
}

module.exports = { getStreams: getStreams };

var BASE = "https://llaroza.pics"; // llaroza.mom redirects here
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";

var MAX_SERVERS = 12;     // how many servers from play.php to resolve
var REQUEST_TIMEOUT = 10000;

function withTimeout(promise, ms) {
  // Some plugin runtimes have no setTimeout - never let that break fetching
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") return promise;
  return new Promise(function(resolve, reject) {
    var done = false;
    var t = setTimeout(function() {
      if (!done) { done = true; reject(new Error("timeout")); }
    }, ms);
    promise.then(function(v) {
      if (!done) { done = true; clearTimeout(t); resolve(v); }
    }, function(e) {
      if (!done) { done = true; clearTimeout(t); reject(e); }
    });
  });
}

function fetchText(url, referer) {
  url = String(url).replace(/[^\x00-\x7F]/g, function(c) {
    return encodeURIComponent(c);
  });
  var headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  if (referer) headers["Referer"] = String(referer).replace(/[^\x00-\x7F]/g, function(c) {
    return encodeURIComponent(c);
  });
  return withTimeout(fetch(url, { headers: headers, redirect: "follow" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }), REQUEST_TIMEOUT);
}

function decodeHtml(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(str) {
  return decodeHtml(String(str || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  a = normalizeTitle(a);
  b = normalizeTitle(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.85;
  var aa = a.split(" ");
  var bb = b.split(" ");
  var setB = {};
  bb.forEach(function(x) { setB[x] = 1; });
  var common = 0;
  aa.forEach(function(x) { if (setB[x]) common++; });
  return common / Math.max(aa.length, bb.length);
}

function absUrl(u, base) {
  u = decodeHtml(String(u || "")).replace(/\\\//g, "/").replace(/\\u0026/g, "&").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  var origin = String(base || BASE).replace(/^(https?:\/\/[^\/]+).*$/i, "$1");
  if (u.charAt(0) === "/") return origin + u;
  return origin + "/" + u;
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

function getTmdbTitles(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var langs = ["ar", "en"];
  var titles = [];
  var year = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        var title = type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
        if (title && titles.indexOf(title) === -1) titles.push(title);
        if (!year) {
          var dateStr = type === "movie" ? data.release_date : data.first_air_date;
          if (dateStr) year = dateStr.slice(0, 4);
        }
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (!titles.length) throw new Error("Could not get TMDB titles for " + tmdbId);
    console.log("[Laroza] TMDB titles:", titles.join(" | "));
    return { titles: titles, year: year };
  });
}

function searchLaroza(title) {
  var cleanTitle = String(title || "").replace(/[:\u060C-\u061F]/g, " ").replace(/\s+/g, " ").trim();
  var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle);
  console.log("[Laroza] Search:", cleanTitle);
  return fetchText(url, BASE + "/").then(function(html) {
    var results = [];
    var seen = {};
    var re = /<a[^>]*href=["']([^"']*\/video\.php\?vid=([^"'&]+))["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var fullUrl = decodeHtml(m[1]);
      var vid = m[2];
      var linkTitle = decodeHtml(m[3]);
      if (seen[vid]) continue;
      seen[vid] = 1;
      var absolute = fullUrl.indexOf("http") === 0 ? fullUrl : BASE + fullUrl;
      results.push({ url: absolute, title: linkTitle, vid: vid });
    }
    if (!results.length) {
      var re2 = /<a[^>]*href=["']([^"']*\/video\.php\?vid=([^"'&]+))["'][^>]*>/gi;
      while ((m = re2.exec(html)) !== null) {
        var fullUrl2 = decodeHtml(m[1]);
        var vid2 = m[2];
        if (seen[vid2]) continue;
        seen[vid2] = 1;
        var absolute2 = fullUrl2.indexOf("http") === 0 ? fullUrl2 : BASE + fullUrl2;
        results.push({ url: absolute2, title: vid2, vid: vid2 });
      }
    }
    console.log("[Laroza] Search results:", results.length);
    return results;
  });
}

function chooseResult(results, titles) {
  var best = null;
  var bestScore = 0;
  results.forEach(function(r) {
    var s = 0;
    titles.forEach(function(t) {
      var sc = similarity(r.title, t);
      if (sc > s) s = sc;
    });
    if (s > bestScore) { bestScore = s; best = r; }
  });
  if (best) console.log("[Laroza] Best:", best.title, "score:", bestScore.toFixed(3));
  return bestScore >= 0.3 ? best : null;
}

function buildEmbedUrl(vid) {
  return BASE + "/embed.php?vid=" + vid;
}

function buildPlayUrl(vid) {
  return BASE + "/play.php?vid=" + vid;
}

// ---------------------------------------------------------------------------
// SERVER LIST (play.php shows "سيرفر 1 ... سيرفر 16"; embed.php only gives one)
// ---------------------------------------------------------------------------

function extractServerUrls(playHtml, vid, playUrl) {
  var urls = [];
  var seen = {};
  var m;

  function add(raw) {
    var u = absUrl(raw, playUrl);
    if (!u || seen[u]) return;
    if (!/[\/?=]/.test(String(raw))) return; // skip things like data-server="3"
    if (/\.(?:jpe?g|png|gif|webp|svg|css|js|ico|woff2?)(?:\?|$)/i.test(u)) return;
    if (u.replace(/#.*$/, "") === playUrl) return; // the page itself
    seen[u] = 1;
    urls.push(u);
  }

  // 1) data attributes on the server buttons (<li data-embed-url="...">, etc.)
  var reAttr = /\bdata-(?:embed-url|embed|embedurl|url|src|href|link|iframe|player)\s*=\s*["']([^"']+)["']/gi;
  while ((m = reAttr.exec(playHtml)) !== null) add(m[1]);

  // 2) any embed.php?... URL anywhere in the page (onclick handlers, JS arrays, hrefs)
  var reEmbed = /[^\s"'<>(),]*embed\.php\?[^\s"'<>(),]+/gi;
  while ((m = reEmbed.exec(playHtml)) !== null) add(m[0]);

  // 3) per-server play.php links (play.php?vid=XXX&serv=2 and similar)
  var rePlay = /[^\s"'<>(),]*play\.php\?[^\s"'<>(),]*vid=[^\s"'<>(),]*&[^\s"'<>(),]+/gi;
  while ((m = rePlay.exec(playHtml)) !== null) add(m[0]);

  console.log("[Laroza] server urls from play.php:", urls.length);
  return urls;
}

// ---------------------------------------------------------------------------
// PLAYER PAGE (okhd & co.)
// ---------------------------------------------------------------------------

function findPlayerIframe(html, pageUrl) {
  var m = html.match(/<iframe[^>]*src=["']([^"']*okhd\.[^"']+)["']/i);
  if (m) return absUrl(m[1], pageUrl);
  m = html.match(/<iframe[^>]*src=["']((?:https?:)?\/\/[^"']+)["']/i);
  if (m) return absUrl(m[1], pageUrl);
  return null;
}

function decodePackedToken(word, base) {
  var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var n = 0;
  for (var i = 0; i < word.length; i++) {
    var d = chars.indexOf(word.charAt(i));
    if (d < 0 || d >= base) return -1;
    n = n * base + d;
  }
  return n;
}

function unpackEval(html) {
  var m = html.match(/\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return null;
  var payload = m[1];
  var base = parseInt(m[2], 10);
  var keywords = m[4].split("|");
  return payload.replace(/\b\w+\b/g, function(w) {
    var idx = decodePackedToken(w, base);
    return (idx >= 0 && keywords[idx]) ? keywords[idx] : w;
  });
}

function scanForStreams(text) {
  var streams = [];
  var seen = {};
  var m;

  var re = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/gi;
  while ((m = re.exec(text)) !== null) {
    var u = m[0].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
    if (seen[u]) continue;
    seen[u] = 1;
    streams.push(u);
  }

  var re2 = /(?:file|source|src|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi;
  while ((m = re2.exec(text)) !== null) {
    var u2 = m[1].replace(/\\\//g, "/");
    if (u2.indexOf("http") !== 0) continue;
    if (seen[u2]) continue;
    seen[u2] = 1;
    streams.push(u2);
  }
  return streams;
}

function extractStreamsFromPlayer(playerHtml) {
  var unpacked = null;
  try { unpacked = unpackEval(playerHtml); } catch (e) {}
  var found = unpacked ? scanForStreams(unpacked) : [];
  if (!found.length) found = scanForStreams(playerHtml);
  return found;
}

function qualityFromUrl(url) {
  var s = String(url).toLowerCase();
  if (/2160|4k/.test(s)) return "4K";
  if (/1440/.test(s)) return "1440p";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "Unknown";
}

function makeStream(url, label, playerUrl) {
  // The CDN wants the player page's referer/origin (e.g. mp6.okhd.site), not Laroza's
  var origin = originOf(playerUrl) || "https://mp6.okhd.site";
  var streamReferer = origin + "/";

  // Force HTTPS (Android blocks cleartext)
  if (url.indexOf("http://") === 0) {
    url = "https://" + url.slice(7);
  }

  return {
    name: " 🎖️ Laroza",
    title: label ? "🎖️ Laroza \u2022 " + label : "⚜️ Laroza",
    url: url,
    quality: qualityFromUrl(url),
    referer: streamReferer,
    headers: {
      "User-Agent": UA,
      "Referer": streamReferer,
      "Origin": origin,
      "Accept": "*/*"
    }
  };
}

function makeEmbedFallback(playerUrl, label, referer) {
  return {
    name: "🍒 Laroza",
    title: label ? "🍒 Laroza (Embed) \u2022 " + label : "🍒 Laroza (Embed)",
    url: playerUrl,
    quality: "Auto",
    type: "iframe",
    referer: referer
  };
}

// Resolve ONE server url (embed.php?... or play.php?...&serv=N) into stream objects
function resolveServer(serverUrl, label, playUrl) {
  return fetchText(serverUrl, playUrl).then(function(html) {
    var playerUrl = findPlayerIframe(html, serverUrl);

    if (!playerUrl) {
      // the embed page itself might already contain the stream
      var inline = extractStreamsFromPlayer(html);
      return inline.map(function(u) { return makeStream(u, label, serverUrl); });
    }

    return fetchText(playerUrl, serverUrl).then(function(playerHtml) {
      var directUrls = extractStreamsFromPlayer(playerHtml);
      if (directUrls.length) {
        return directUrls.map(function(u) { return makeStream(u, label, playerUrl); });
      }
      return [makeEmbedFallback(playerUrl, label, serverUrl)];
    }).catch(function(err) {
      console.log("[Laroza] player failed (" + label + "):", err.message);
      return [makeEmbedFallback(playerUrl, label, serverUrl)];
    });
  }).catch(function(err) {
    console.log("[Laroza] " + label + " failed:", err.message);
    return [];
  });
}

function resolveVid(vid) {
  var playUrl = buildPlayUrl(vid);
  var videoUrl = BASE + "/video.php?vid=" + vid;

  return fetchText(playUrl, videoUrl).then(function(playHtml) {
    var servers = extractServerUrls(playHtml, vid, playUrl);
    if (!servers.length) {
      // nothing parsed: show what the page looks like so the parser can be adjusted
      var at = playHtml.indexOf("\u0633\u064a\u0631\u0641\u0631");
      console.log("[Laroza] No servers parsed. Page length:", playHtml.length,
        "snippet:", playHtml.slice(Math.max(0, at - 200), at + 600).replace(/\s+/g, " "));
    }
    return servers;
  }).catch(function(err) {
    console.log("[Laroza] play.php failed:", err.message);
    return [];
  }).then(function(servers) {
    if (!servers.length) servers = [buildEmbedUrl(vid)]; // old behaviour as last resort
    servers = servers.slice(0, MAX_SERVERS);

    var usedFallback = servers.length === 1 && servers[0] === buildEmbedUrl(vid);

    return Promise.all(servers.map(function(s, i) {
      return resolveServer(s, "Server " + (i + 1), playUrl);
    })).then(function(groups) {
      var all = [];
      var seenUrl = {};
      groups.forEach(function(g) {
        g.forEach(function(st) {
          if (seenUrl[st.url]) return;
          seenUrl[st.url] = 1;
          all.push(st);
        });
      });
      // keep iframe fallbacks only when no server gave a direct stream
      var direct = all.filter(function(st) { return st.type !== "iframe"; });
      var out = direct.length ? direct : all;
      console.log("[Laroza] streams:", out.length, "(direct:", direct.length + ")");
      if (!out.length && !usedFallback) {
        console.log("[Laroza] multi-server found nothing, trying plain embed.php");
        return resolveServer(buildEmbedUrl(vid), "Server 1", playUrl);
      }
      return out;
    });
  });
}

function getMovieStreams(tmdbId) {
  return getTmdbTitles(tmdbId, "movie").then(function(meta) {
    return Promise.all(meta.titles.map(function(t) {
      return searchLaroza(t).catch(function() { return []; });
    })).then(function(groups) {
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[Laroza] Unique movie candidates:", all.length);
      if (!all.length) return [];
      var best = chooseResult(all, meta.titles);
      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[Laroza] Movie error:", err.message);
    return [];
  });
}

function getTvStreams(tmdbId, season, episode) {
  var wanted = Number(episode) || 1;
  return getTmdbTitles(tmdbId, "tv").then(function(meta) {
    var searches = [];
    meta.titles.forEach(function(t) {
      searches.push(t + " الحلقة " + wanted);
      searches.push(t + " " + wanted);
      searches.push(t);
    });

    return Promise.all(searches.map(function(q) {
      return searchLaroza(q).catch(function() { return []; });
    })).then(function(groups) {
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[Laroza] Unique TV candidates:", all.length);

      var withEp = all.filter(function(r) {
        var dec = r.title;
        return new RegExp("(?:الحلق[ةه]\\s*" + wanted + "\\b|\\b" + wanted + "\\b)", "i").test(dec);
      });
      var pool = withEp.length ? withEp : all;
      console.log("[Laroza] TV candidates with ep " + wanted + ":", withEp.length, "/ pool:", pool.length);

      if (!pool.length) return [];
      var best = chooseResult(pool, meta.titles);
      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[Laroza] TV error:", err.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[Laroza] getStreams:", tmdbId, mediaType, season, episode);
  if (mediaType === "tv") return getTvStreams(tmdbId, season, episode);
  return getMovieStreams(tmdbId);
}

module.exports = {
  getStreams: getStreams
};

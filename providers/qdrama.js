var BASE = "https://vod.q-drama.com";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MAX_SERVERS = 12;
var REQUEST_TIMEOUT = 10000;
var MAX_SEARCH_PAGES = 3;

function withTimeout(promise, ms) {
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

function toWesternDigits(str) {
  return String(str)
    .replace(/[\u0660-\u0669]/g, function(c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function(c) { return String(c.charCodeAt(0) - 0x06F0); });
}

function normalizeTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u06AF\u06A9]/g, "\u0643")
    .replace(/\u06CC/g, "\u064A")
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

function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function getTmdbTitles(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var langs = ["ar", "en"];
  var titles = [];
  var year = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + lang + "&append_to_response=translations,alternative_titles";
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        var title = type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
        if (title && titles.indexOf(title) === -1) titles.push(title);

        var translations = (data.translations && data.translations.translations) || [];
        translations.forEach(function(t) {
          if (t.iso_639_1 === "ar" && t.data) {
            var arTitle = type === "movie" ? t.data.title : t.data.name;
            if (arTitle && titles.indexOf(arTitle) === -1) titles.push(arTitle);
          }
        });

        var alts = (data.alternative_titles && data.alternative_titles.results) || [];
        alts.forEach(function(a) {
          if (a.title && titles.indexOf(a.title) === -1) titles.push(a.title);
        });

        if (!year) {
          var dateStr = type === "movie" ? data.release_date : data.first_air_date;
          if (dateStr) year = dateStr.slice(0, 4);
        }
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (!titles.length) throw new Error("Could not get TMDB titles for " + tmdbId);
    console.log("[QDrama] TMDB titles:", titles.join(" | "));
    return { titles: titles, year: year };
  });
}

function searchQDrama(title, page) {
  var cleanTitle = String(title || "").replace(/[:\u060C-\u061F]/g, " ").replace(/\s+/g, " ").trim();
  var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle) + (page > 1 ? "&page=" + page : "");
  console.log("[QDrama] Search:", cleanTitle, "page:", page || 1);
  return fetchText(url, BASE + "/").then(function(html) {
    var results = [];
    var seen = {};
    var re = /<a[^>]*href=["']([^"']*\/watch\.php\?vid=([^"'&]+))["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
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
      var re2 = /<a[^>]*href=["']([^"']*\/watch\.php\?vid=([^"'&]+))["'][^>]*>/gi;
      while ((m = re2.exec(html)) !== null) {
        var fullUrl2 = decodeHtml(m[1]);
        var vid2 = m[2];
        if (seen[vid2]) continue;
        seen[vid2] = 1;
        var absolute2 = fullUrl2.indexOf("http") === 0 ? fullUrl2 : BASE + fullUrl2;
        results.push({ url: absolute2, title: vid2, vid: vid2 });
      }
    }
    console.log("[QDrama] Search results:", results.length);
    return results;
  });
}

function parseEpisodeInfo(title) {
  var info = { episode: null, season: null, dubbed: false, subbed: false, englishTitle: null };
  var decoded = toWesternDigits(decodeHtml(title));

  var epMatch = /الحلق[ةه]\s*(\d+)/.exec(decoded);
  if (epMatch) info.episode = parseInt(epMatch[1], 10);

  var seasonMatch = /الموسم\s*(\d+)/.exec(decoded);
  if (seasonMatch) info.season = parseInt(seasonMatch[1], 10);

  if (/مدبلج[ةه]?/.test(decoded)) info.dubbed = true;
  if (/مترجم[ةه]?/.test(decoded)) info.subbed = true;

  var dashMatch = /\s+-\s+([A-Za-z][A-Za-z0-9\s:'!&.-]+)$/.exec(decoded);
  if (dashMatch) info.englishTitle = dashMatch[1].trim();

  return info;
}

function extractSeriesName(title) {
  var decoded = toWesternDigits(decodeHtml(title));
  decoded = decoded.replace(/^مسلسل\s+/, "").replace(/^أنمي\s+/, "").replace(/^برنامج\s+/, "");
  decoded = decoded.replace(/الحلق[ةه]\s*\d+.*$/, "").trim();
  decoded = decoded.replace(/\s*-\s*[A-Za-z].*$/, "").trim();
  decoded = decoded.replace(/\s*مترجم[ةه]?.*$/, "").trim();
  decoded = decoded.replace(/\s*مدبلج[ةه]?.*$/, "").trim();
  return decoded;
}

function chooseResult(results, titles, wantedSeason, wantedEpisode) {
  var best = null;
  var bestScore = 0;

  results.forEach(function(r) {
    var s = 0;
    var epInfo = parseEpisodeInfo(r.title);

    if (wantedEpisode && epInfo.episode !== null && epInfo.episode === wantedEpisode) {
      s += 50;
    } else if (wantedEpisode && epInfo.episode !== null && epInfo.episode !== wantedEpisode) {
      s -= 30;
    }

    if (wantedSeason && epInfo.season !== null) {
      if (epInfo.season === wantedSeason) s += 30;
      else s -= 20;
    }

    titles.forEach(function(t) {
      var sc = similarity(r.title, t);
      if (sc > s) s = Math.max(s, sc * 50);
    });

    var seriesName = extractSeriesName(r.title);
    titles.forEach(function(t) {
      var sc = similarity(seriesName, t);
      if (sc > 0.7) s += 20;
    });

    if (s > bestScore) { bestScore = s; best = r; }
  });

  if (best) console.log("[QDrama] Best match:", best.title, "score:", bestScore);
  return bestScore >= 40 ? best : null;
}

function buildPlayUrl(vid) {
  return BASE + "/play.php?vid=" + vid;
}

function parseServers(html) {
  var servers = [];
  var seen = {};

  var liRegex = /<li[^>]*data-embed-\s*url\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  var m;
  while ((m = liRegex.exec(html)) !== null) {
    var url = decodeHtml(m[1]);
    if (seen[url]) continue;
    seen[url] = 1;
    var inner = m[2];
    var nameMatch = inner.match(/<strong>([^<]*)<\/strong>/i);
    var name = nameMatch ? nameMatch[1].trim() : "Server " + (servers.length + 1);
    servers.push({ name: name, url: url });
  }

  if (!servers.length) {
    var iframeRe = /<iframe[^>]*src=["']([^"']+)["']/gi;
    while ((m = iframeRe.exec(html)) !== null) {
      var url2 = absUrl(m[1], BASE);
      if (url2 && !seen[url2]) {
        seen[url2] = 1;
        servers.push({ name: "Server " + (servers.length + 1), url: url2 });
      }
    }
  }

  return servers;
}

function unpackEval(html) {
  var m = html.match(/\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return null;
  var payload = m[1];
  var base = parseInt(m[2], 10);
  var keywords = m[4].split("|");
  var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return payload.replace(/\b\w+\b/g, function(w) {
    var n = 0;
    for (var i = 0; i < w.length; i++) {
      var d = chars.indexOf(w.charAt(i));
      if (d < 0 || d >= base) return w;
      n = n * base + d;
    }
    return keywords[n] || w;
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
    if (u2.indexOf("http") !== 0 || seen[u2]) continue;
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
  return "Auto";
}

function makeStream(url, label, playerUrl, quality) {
  var origin = originOf(playerUrl) || BASE;
  var streamReferer = origin + "/";
  if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
  return {
    name: "QDrama",
    title: label ? "QDrama \u2022 " + label : "QDrama",
    url: url,
    quality: quality || qualityFromUrl(url),
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
    name: "QDrama",
    title: label ? "QDrama (Embed) \u2022 " + label : "QDrama (Embed)",
    url: playerUrl,
    quality: "Auto",
    type: "iframe",
    referer: referer
  };
}

function resolveServer(server, playUrl) {
  var embedUrl = server.url;
  var host = hostOf(embedUrl);

  return fetchText(embedUrl, playUrl).then(function(html) {
    var playerUrl = null;
    var iframeMatch = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    if (iframeMatch) playerUrl = absUrl(iframeMatch[1], embedUrl);

    if (playerUrl && playerUrl !== embedUrl) {
      return fetchText(playerUrl, embedUrl).then(function(playerHtml) {
        var directUrls = extractStreamsFromPlayer(playerHtml);
        if (directUrls.length) {
          return directUrls.map(function(u) { return makeStream(u, server.name, playerUrl); });
        }
        return [makeEmbedFallback(playerUrl, server.name, embedUrl)];
      }).catch(function() {
        return [makeEmbedFallback(playerUrl, server.name, embedUrl)];
      });
    }

    var directUrls = extractStreamsFromPlayer(html);
    if (directUrls.length) {
      return directUrls.map(function(u) { return makeStream(u, server.name, embedUrl); });
    }

    return [makeEmbedFallback(embedUrl, server.name, playUrl)];
  }).catch(function(err) {
    console.log("[QDrama] Server error:", server.name, err.message);
    return [makeEmbedFallback(embedUrl, server.name, playUrl)];
  });
}

function resolveVid(vid) {
  var playUrl = buildPlayUrl(vid);
  var watchUrl = BASE + "/watch.php?vid=" + vid;

  return fetchText(playUrl, watchUrl).then(function(playHtml) {
    var servers = parseServers(playHtml);
    console.log("[QDrama] Servers found:", servers.length);

    if (!servers.length) {
      return fetchText(watchUrl, BASE + "/").then(function(watchHtml) {
        var watchServers = parseServers(watchHtml);
        if (watchServers.length) return resolveServersList(watchServers, playUrl);
        return [];
      });
    }

    return resolveServersList(servers, playUrl);
  }).catch(function(err) {
    console.log("[QDrama] play.php failed:", err.message);
    return [];
  });
}

function resolveServersList(servers, playUrl) {
  servers = servers.slice(0, MAX_SERVERS);
  return Promise.all(servers.map(function(s) {
    return withTimeout(resolveServer(s, playUrl), REQUEST_TIMEOUT);
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
    var direct = all.filter(function(st) { return st.type !== "iframe"; });
    var out = direct.length ? direct : all;
    console.log("[QDrama] Streams:", out.length, "(direct:", direct.length + ")");
    return out;
  });
}

function getMovieStreams(tmdbId) {
  return getTmdbTitles(tmdbId, "movie").then(function(meta) {
    return Promise.all(meta.titles.map(function(t) {
      return searchQDrama(t).catch(function() { return []; });
    })).then(function(groups) {
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[QDrama] Unique movie candidates:", all.length);
      if (!all.length) return [];
      var best = chooseResult(all, meta.titles, null, null);
      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[QDrama] Movie error:", err.message);
    return [];
  });
}

function getTvStreams(tmdbId, season, episode) {
  var wanted = Number(episode) || 1;
  var wantedSeason = Number(season) || 1;

  return getTmdbTitles(tmdbId, "tv").then(function(meta) {
    var searches = [];
    meta.titles.forEach(function(t) {
      searches.push(t + " الحلقة " + wanted);
      searches.push(t + " الموسم " + wantedSeason + " الحلقة " + wanted);
      searches.push(t + " " + wanted);
      searches.push(t);
    });

    return Promise.all(searches.map(function(q) {
      return searchQDrama(q).catch(function() { return []; });
    })).then(function(groups) {
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[QDrama] Unique TV candidates:", all.length);

      var best = chooseResult(all, meta.titles, wantedSeason, wanted);
      if (!best) return [];
      console.log("[QDrama] Selected:", best.title);
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[QDrama] TV error:", err.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[QDrama] getStreams:", tmdbId, mediaType, season, episode);

  if (!TMDB_API_KEY || TMDB_API_KEY === "YOUR_TMDB_API_KEY") {
    console.log("[QDrama] TMDB_API_KEY is not set");
    return Promise.resolve([]);
  }

  if (mediaType === "tv" || mediaType === "series") {
    return getTvStreams(tmdbId, season, episode);
  }
  return getMovieStreams(tmdbId);
}

module.exports = {
  getStreams: getStreams
};

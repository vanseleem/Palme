var BASE = "https://a.qfilm.tv";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MIRROR_TIMEOUT = 15000;
var MAX_PROVIDERS = 4;
var SEARCH_PAGES = 2;
var BAD_HOST = /(^|\.)(qfilm\.tv|q-drama\.com|qdrama\.com|facebook\.com|twitter\.com|google\.com|googleapis\.com|gstatic\.com|w3\.org|schema\.org|cloudflare\.com|jquery\.com|jsdelivr\.net|t\.me|telegram\.org|themoviedb\.org)$/i;
var SERIES_MARK = /مسلسل|برنامج|الحلق[ةه]|حلق[ةه]\s*\d|الموسم/;

function fetchText(url, referer, expectHost) {
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
  return fetch(url, { headers: headers, redirect: "follow" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    var finalUrl = String(r.url || url);
    if (expectHost && finalUrl.indexOf(expectHost) === -1) {
      throw new Error("cross-site " + finalUrl);
    }
    return r.text();
  });
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

function normalizeTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEscapes(s) {
  return String(s || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, "&");
}

function originOf(u) {
  var m = String(u || "").match(/^(https?:\/\/[^\/?#]+)/i);
  return m ? m[1] : BASE;
}

function withTimeout(promise, ms, fallback) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function(resolve) {
    var done = false;
    var t = setTimeout(function() {
      if (!done) { done = true; resolve(fallback); }
    }, ms);
    function finish(v) {
      if (done) return;
      done = true;
      if (typeof clearTimeout === "function") clearTimeout(t);
      resolve(v);
    }
    promise.then(finish, function() { finish(fallback); });
  });
}

function isTvRequest(mediaType, season, episode) {
  var t = String(mediaType == null ? "" : mediaType).toLowerCase();
  if (t === "tv" || t === "series" || t === "show" || t === "episode" || t === "tvshow" || t === "tv_show") return true;
  if (t === "movie" || t === "film" || t === "movies") return false;
  if ((season != null && season !== "") || (episode != null && episode !== "")) return true;
  return false;
}

function isMovieTitle(str) {
  var s = decodeHtml(String(str || ""));
  if (SERIES_MARK.test(s)) return false;
  return /(?:^|\s)فيلم(?:\s|\(|$)/.test(s);
}

function movieCore(title) {
  var s = decodeHtml(String(title || ""));
  s = s.replace(/مشاهدة|تحميل|اون\s*لاين|أون\s*لاين|اونلاين/gi, " ");
  s = s.replace(/\bHD\b/gi, " ");
  s = s.replace(/مترجم[ةه]?|مدبلج[ةه]?|كامل[ةه]?/gi, " ");
  s = s.replace(/فيلم/gi, " ");
  s = s.replace(/\(\s*(?:19|20)\d{2}\s*\)/g, " ");
  s = s.replace(/\b(?:19|20)\d{2}\b/g, " ");
  return normalizeTitle(s);
}

function titleYear(title) {
  var ys = String(title || "").match(/\b(?:19|20)\d{2}\b/g);
  if (!ys || !ys.length) return null;
  return Number(ys[ys.length - 1]);
}

function movieScore(result, titles, year) {
  var blob = (result.caption || "") + " " + (result.title || "");
  if (SERIES_MARK.test(blob)) return 0;
  if (!isMovieTitle(result.caption) && !isMovieTitle(result.title)) return 0;
  var core = movieCore(result.caption || result.title);
  if (!core) return 0;
  var ok = false;
  titles.forEach(function(t) {
    if (movieCore(t) === core) ok = true;
  });
  if (!ok) return 0;
  var ry = titleYear((result.caption || "") + " " + (result.title || ""));
  if (year && ry && Math.abs(ry - Number(year)) > 1) return 0;
  return (year && ry) ? 1 : 0.95;
}

function getTmdbTitles(tmdbId) {
  var langs = ["ar", "en"];
  var titles = [];
  var year = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/movie/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        if (!data || data.success === false || data.status_code) return;
        var title = data.title || data.original_title;
        if (title && titles.indexOf(title) === -1) titles.push(title);
        if (data.original_title && titles.indexOf(data.original_title) === -1) titles.push(data.original_title);
        if (!year && data.release_date) year = data.release_date.slice(0, 4);
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (!titles.length) throw new Error("Could not get TMDB titles for " + tmdbId);
    console.log("[QFilm] TMDB titles:", titles.join(" | "), "year:", year);
    return { titles: titles, year: year };
  });
}

function searchQFilm(title) {
  var cleanTitle = String(title || "")
    .replace(/\(\s*(?:19|20)\d{2}\s*\)/g, " ")
    .replace(/[:\u060C-\u061F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanTitle) return Promise.resolve([]);

  function pageAt(page) {
    var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle) + (page > 1 ? "&page=" + page : "");
    console.log("[QFilm] Search:", cleanTitle, "page", page);
    return fetchText(url, BASE + "/", "qfilm.tv").then(function(html) {
      var results = [];
      var seen = {};
      var parts = html.split('<li class="col-xs-6');
      for (var i = 1; i < parts.length; i++) {
        var p = parts[i];
        var href = p.match(/href=["']([^"']*\/watch\.php\?vid=([^"'&]+))["']/i);
        if (!href) continue;
        var vid = href[2];
        if (seen[vid]) continue;
        seen[vid] = 1;
        var attr = p.match(/title=["']([^"']+)["']/i);
        var cap = p.match(/<h3 class="caption">\s*([\s\S]*?)\s*<\/h3>/i);
        var caption = cap ? decodeHtml(cap[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
        var linkTitle = attr ? decodeHtml(attr[1]) : caption;
        var absolute = href[1].indexOf("http") === 0 ? href[1] : BASE + href[1];
        if (absolute.indexOf("qfilm.tv") === -1) continue;
        results.push({ url: absolute, title: linkTitle, caption: caption || linkTitle, vid: vid });
      }
      return results;
    });
  }

  var all = [];
  var seen = {};
  var chain = Promise.resolve();
  for (var page = 1; page <= SEARCH_PAGES; page++) {
    (function(pg) {
      chain = chain.then(function() {
        return pageAt(pg).then(function(list) {
          list.forEach(function(r) {
            if (seen[r.vid]) return;
            seen[r.vid] = 1;
            all.push(r);
          });
        }).catch(function() {});
      });
    })(page);
  }
  return chain.then(function() {
    console.log("[QFilm] Search results:", all.length);
    return all;
  });
}

function confirmMoviePage(vid) {
  var url = BASE + "/watch.php?vid=" + vid;
  return fetchText(url, BASE + "/", "qfilm.tv").then(function(html) {
    if (/class="AiredEPS"|id="season_season_/i.test(html)) return false;
    var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    var heading = h1 ? decodeHtml(h1[1].replace(/<[^>]+>/g, " ")) : "";
    if (SERIES_MARK.test(heading)) return false;
    if (!/فيلم/.test(heading)) return false;
    var cats = html.match(/class="CatsDesc"([\s\S]*?)<\/div>/i);
    if (cats && /cat=[^"']*series/i.test(cats[1])) return false;
    return true;
  }).catch(function() { return false; });
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

  var reOpt = /<option[^>]+value=["']([^"']+)["'][^>]*>/gi;
  while ((m = reOpt.exec(text)) !== null) add(rawMirror(m[1]));

  var reServers = /var\s+servers\s*=\s*\[([\s\S]*?)\];/i;
  var srvMatch = reServers.exec(text);
  if (srvMatch) {
    var srvText = srvMatch[1].replace(/\\"/g, '"');
    var reIframeSrc = /src=["']([^"']+)["']/gi;
    while ((m = reIframeSrc.exec(srvText)) !== null) add(rawMirror(m[1]));
  }

  var reIf = /<iframe[^>]+src=["']([^"']+)["']/gi;
  while ((m = reIf.exec(text)) !== null) add(rawMirror(m[1]));

  var urls = [];
  collectUrls(text, urls);

  var reB64 = /["']([A-Za-z0-9+\/]{24,}={0,2})["']/g;
  while ((m = reB64.exec(text)) !== null) {
    var dec = b64decode(m[1]);
    if (dec && dec.indexOf("//") !== -1) collectUrls(cleanEscapes(dec), urls);
  }

  urls.forEach(function(u) { add(rawMirror(u)); });
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
    var base = parseInt(m[2], 10);
    var count = parseInt(m[3], 10);
    var keywords = m[4].split("|");
    var dict = {};
    while (count--) {
      var key = packerEncode(count, base);
      dict[key] = keywords[count] || key;
    }
    return payload.replace(/\b\w+\b/g, function(w) {
      return dict.hasOwnProperty(w) ? dict[w] : w;
    });
  } catch (e) {
    return null;
  }
}

function extractStreamsFromPlayer(playerHtml) {
  var streams = [];
  var seen = {};
  var unpacked = unpackEval(playerHtml);
  var search = cleanEscapes(unpacked || playerHtml);

  var re = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/gi;
  var m;
  while ((m = re.exec(search)) !== null) {
    var u = m[0];
    if (seen[u]) continue;
    seen[u] = 1;
    streams.push(u);
  }

  var re2 = /(?:file|source|src|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi;
  while ((m = re2.exec(search)) !== null) {
    var u2 = m[1];
    if (u2.indexOf("http") !== 0) continue;
    if (seen[u2]) continue;
    seen[u2] = 1;
    streams.push(u2);
  }

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
  if (q === "4K") return 6;
  if (q === "1440p") return 5;
  if (q === "1080p") return 4;
  if (q === "720p") return 3;
  if (q === "Auto") return 4;
  if (q === "480p") return 2;
  if (q === "360p") return 1;
  return 0;
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
    headers: {
      "User-Agent": UA,
      "Referer": streamReferer,
      "Origin": origin,
      "Accept": "*/*"
    }
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
    fetchText(playUrl, BASE + "/", "qfilm.tv").catch(function() { return ""; }),
    fetchText(embedUrl, BASE + "/", "qfilm.tv").catch(function() { return ""; })
  ]).then(function(htmls) {
    var rawMirrors = [];
    htmls.forEach(function(h) {
      harvestMirrors(h).forEach(function(mir) { rawMirrors.push(mir); });
    });

    var byHost = {};
    var hostOrder = [];
    rawMirrors.forEach(function(mir) {
      if (byHost[mir.host]) return;
      byHost[mir.host] = mir;
      hostOrder.push(mir.host);
    });

    console.log("[QFilm] unique hosts found:", hostOrder.length, "->", hostOrder.map(function(h) { return byHost[h].label; }).join(", "));

    var mirrors = hostOrder.slice(0, MAX_PROVIDERS).map(function(h) { return byHost[h]; });
    console.log("[QFilm] resolving", mirrors.length, "of", hostOrder.length, "hosts (MAX_PROVIDERS=" + MAX_PROVIDERS + ")");

    if (!mirrors.length) return [];

    return Promise.all(mirrors.map(function(mir) {
      return withTimeout(resolveMirror(mir, embedUrl), MIRROR_TIMEOUT, { mirror: mir, urls: [] });
    })).then(function(results) {
      var streams = [];
      var fallbacks = [];
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
      console.log("[QFilm] FINAL output:", out.length, "(MAX_PROVIDERS=" + MAX_PROVIDERS + ")");
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
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[QFilm] Unique movie candidates:", all.length);
      var ranked = all.filter(function(r) { return movieScore(r, meta.titles, meta.year) >= 0.95; });
      ranked.sort(function(a, b) {
        return movieScore(b, meta.titles, meta.year) - movieScore(a, meta.titles, meta.year);
      });
      if (!ranked.length) return [];

      function tryNext(i) {
        if (i >= ranked.length || i >= 3) return Promise.resolve([]);
        var best = ranked[i];
        console.log("[QFilm] Confirm:", best.caption || best.title);
        return confirmMoviePage(best.vid).then(function(ok) {
          if (!ok) {
            console.log("[QFilm] Rejected non-movie page", best.vid);
            return tryNext(i + 1);
          }
          return resolveVid(best.vid);
        });
      }
      return tryNext(0);
    });
  }).catch(function(err) {
    console.log("[QFilm] Movie error:", err.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[QFilm] getStreams:", tmdbId, mediaType, season, episode);
  if (isTvRequest(mediaType, season, episode)) {
    console.log("[QFilm] Skipping — QFilm is strictly movies only");
    return Promise.resolve([]);
  }
  return getMovieStreams(tmdbId).then(function(list) {
    return list.slice(0, MAX_PROVIDERS);
  });
}

module.exports = {
  getStreams: getStreams
};

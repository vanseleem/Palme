var BASE = "https://vod.q-drama.com";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MAX_SERVERS = 3;
var MIRROR_TIMEOUT = 15000;
var SEARCH_PAGES = 3;
var BAD_HOST = /(^|\.)(q-drama\.com|qdrama\.com|qfilm\.tv|facebook\.com|twitter\.com|google\.com|googleapis\.com|gstatic\.com|w3\.org|schema\.org|cloudflare\.com|jquery\.com|jsdelivr\.net|t\.me|telegram\.org|themoviedb\.org)$/i;

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

function isMovieRequest(mediaType, season, episode) {
  var t = String(mediaType == null ? "" : mediaType).toLowerCase();
  if (t === "movie" || t === "film" || t === "movies") return true;
  if (t === "tv" || t === "series" || t === "show" || t === "episode" || t === "tvshow" || t === "tv_show") return false;
  if ((season != null && season !== "") || (episode != null && episode !== "")) return false;
  return true;
}

function isSeriesTitle(str) {
  var s = decodeHtml(String(str || ""));
  if (/مسلسل|برنامج/.test(s)) return true;
  if (/الحلق[ةه]|الموسم/.test(s) && !/(?:^|\s)فيلم(?:\s|\()/.test(s)) return true;
  return false;
}

function seriesCores(title) {
  var s = decodeHtml(String(title || ""));
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/الحلق[ةه]\s*\d+.*/gi, " ");
  s = s.replace(/الموسم\s*\d+/gi, " ");
  s = s.replace(/مشاهدة|مترجم[ةه]?|مدبلج[ةه]?|\bHD\b|اون\s*لاين|اونلاين/gi, " ");
  s = s.replace(/\(\s*الأخيرة\s*\)/g, " ");
  s = s.replace(/^(?:مسلسل|برنامج|فيلم)\s+/i, "");
  s = s.replace(/\s+/g, " ").trim();
  var cores = [];
  s.split(/\s+-\s+/).forEach(function(part) {
    part = part.replace(/\s+\d+\s*:\s*.*\( /g, " ").replace(/\s+\d+\s* \)/g, " ").replace(/\s+/g, " ").trim();
    if (part) cores.push(part);
  });
  if (!cores.length && s) cores.push(s);
  return cores;
}

function seriesScore(result, titles) {
  var blob = (result.caption || "") + " " + (result.title || "");
  if (!isSeriesTitle(blob)) return 0;
  if (/(?:^|\s)فيلم(?:\s|\()/.test(blob) && !/مسلسل|برنامج/.test(blob)) return 0;
  var cores = seriesCores(result.caption || result.title).map(normalizeTitle).filter(Boolean);
  var best = 0;
  titles.forEach(function(t) {
    var q = normalizeTitle(t);
    if (!q) return;
    cores.forEach(function(c) {
      if (c === q) best = Math.max(best, 1);
    });
    if (best >= 1) return;
    var qTokens = q.split(" ").length;
    cores.forEach(function(c) {
      if (c.indexOf(q) !== 0) return;
      var rest = c.slice(q.length).trim();
      if (!rest) { best = Math.max(best, 1); return; }
      var restTokens = rest.split(" ").filter(Boolean);
      if (qTokens >= 2 && q.length >= 8 && restTokens.length <= 2 && !/^part\b/.test(rest)) {
        best = Math.max(best, 0.9);
      }
    });
  });
  return best;
}

function getTmdbTitles(tmdbId) {
  var langs = ["ar", "en"];
  var titles = [];
  var year = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/tv/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        if (!data || data.success === false || data.status_code) return;
        var title = data.name || data.original_name;
        if (title && titles.indexOf(title) === -1) titles.push(title);
        if (data.original_name && titles.indexOf(data.original_name) === -1) titles.push(data.original_name);
        if (!year && data.first_air_date) year = data.first_air_date.slice(0, 4);
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (!titles.length) throw new Error("Could not get TMDB titles for " + tmdbId);
    console.log("[QDrama] TMDB titles:", titles.join(" | "));
    return { titles: titles, year: year };
  });
}

function searchQDrama(title) {
  var cleanTitle = String(title || "")
    .replace(/\(\s*(?:19|20)\d{2}\s*\)/g, " ")
    .replace(/[:\u060C-\u061F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanTitle) return Promise.resolve([]);

  function pageAt(page) {
    var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle) + (page > 1 ? "&page=" + page : "");
    console.log("[QDrama] Search:", cleanTitle, "page", page);
    return fetchText(url, BASE + "/", "q-drama.com").then(function(html) {
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
        if (absolute.indexOf("q-drama.com") === -1) continue;
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
      chain = chain.then(function(found) {
        if (found) return true;
        return pageAt(pg).then(function(list) {
          list.forEach(function(r) {
            if (seen[r.vid]) return;
            seen[r.vid] = 1;
            all.push(r);
          });
          return false;
        }).catch(function() { return false; });
      });
    })(page);
  }
  return chain.then(function() {
    console.log("[QDrama] Search results:", all.length);
    return all;
  });
}

function parseEpisodeMap(chunk) {
  var map = {};
  var re = /watch\.php\?vid=([^"'&\s]+)[^>]*>[\s\S]*?<em>(\d+)<\/em>/gi;
  var m;
  while ((m = re.exec(chunk)) !== null) {
    map[String(Number(m[2]))] = m[1];
  }
  return map;
}

function pickEpisodeVid(html, season, episode) {
  var wantedSeason = Number(season) || 1;
  var wantedEp = Number(episode) || 1;
  var seasons = {};
  var re = /id="season_season_(\d+)"[\s\S]*?<div class="AiredEPS">([\s\S]*?)<\/div>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    seasons[String(Number(m[1]))] = parseEpisodeMap(m[2]);
  }
  var keys = Object.keys(seasons);
  if (keys.length) {
    var list = seasons[String(wantedSeason)];
    if (!list) {
      console.log("[QDrama] Season", wantedSeason, "not on page. Have:", keys.join(","));
      return null;
    }
    var vid = list[String(wantedEp)] || null;
    console.log("[QDrama] Season tab", wantedSeason, "episode", wantedEp, "->", vid || "missing");
    return vid;
  }
  var one = html.match(/<div class="AiredEPS">([\s\S]*?)<\/div>/i);
  if (!one) return null;
  if (wantedSeason > 1) {
    console.log("[QDrama] Single episode list but season", wantedSeason, "requested");
    return null;
  }
  var eps = parseEpisodeMap(one[1]);
  var vid2 = eps[String(wantedEp)] || null;
  console.log("[QDrama] Flat list episode", wantedEp, "->", vid2 || "missing");
  return vid2;
}

function hostLabel(host) {
  var parts = String(host).replace(/^www\./, "").split(".");
  var name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function rawMirror(raw) {
  var u = cleanEscapes(raw).trim();
  if (u.indexOf("//") === 0) u = "https:" + u;
  var m = u.match(/^https?:\/\/([^\/?#:]+)/i);
  if (!m || BAD_HOST.test(m[1])) return null;
  return { embed: u, host: m[1].toLowerCase(), label: hostLabel(m[1]) };
}

function normalizeMirror(raw) {
  var u = cleanEscapes(raw).trim();
  if (u.indexOf("//") === 0) u = "https:" + u;
  var m = u.match(/^(https?:\/\/)([^\/?#:]+)(?::\d+)?(\/[^?#]*)?(\?[^#]*)?/i);
  if (!m) return null;
  var host = m[2].toLowerCase();
  if (BAD_HOST.test(host)) return null;
  var origin = m[1].toLowerCase() + host;
  var path = m[3] || "/";
  var query = m[4] || "";
  var id = null, embed = null, mm;

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

  var reOpt = /<option[^>]+value=["']([^"']+)["'][^>]*>/gi;
  while ((m = reOpt.exec(text)) !== null) {
    if (m[1].indexOf("http") !== 0) continue;
    add(rawMirror(m[1]) || normalizeMirror(m[1]));
  }

  var reIf = /<iframe[^>]+src=["']([^"']+)["']/gi;
  while ((m = reIf.exec(text)) !== null) {
    add(rawMirror(m[1]) || normalizeMirror(m[1]));
  }

  var urls = [];
  collectUrls(text, urls);

  var reB64 = /["']([A-Za-z0-9+\/]{24,}={0,2})["']/g;
  while ((m = reB64.exec(text)) !== null) {
    var dec = b64decode(m[1]);
    if (dec && dec.indexOf("//") !== -1) collectUrls(cleanEscapes(dec), urls);
  }

  urls.forEach(function(u) {
    add(rawMirror(u) || normalizeMirror(u));
  });
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

  console.log("[QDrama] m3u8/mp4 found:", streams.length);
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
  if (q === "4K") return 5;
  if (q === "1440p") return 4;
  if (q === "1080p") return 3;
  if (q === "720p") return 2;
  if (q === "Auto") return 3;
  if (q === "480p") return 1;
  return 0;
}

function makeStream(url, label, playerUrl) {
  var origin = originOf(playerUrl);
  var streamReferer = origin + "/";
  if (url.indexOf("http://") === 0) url = "https://" + url.slice(7);
  return {
    name: "QDrama",
    title: label ? "QDrama \u2022 " + label : "QDrama",
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
    console.log("[QDrama]", mir.label, "streams:", urls.length);
    if (!urls.length) return { mirror: mir, streams: [] };
    urls.sort(function(a, b) {
      return qualityRankValue(qualityFromUrl(b)) - qualityRankValue(qualityFromUrl(a));
    });
    return { mirror: mir, streams: [makeStream(urls[0], mir.label, mir.embed)] };
  }).catch(function(err) {
    console.log("[QDrama]", mir.label, "failed:", err.message);
    return { mirror: mir, streams: [] };
  });
}

function resolveVid(vid) {
  var embedUrl = BASE + "/embed.php?vid=" + vid;
  console.log("[QDrama] embed:", embedUrl);

  return fetchText(embedUrl, BASE + "/", "q-drama.com").then(function(html) {
    var mirrors = harvestMirrors(html);
    console.log("[QDrama] mirrors found:", mirrors.length, "->", mirrors.map(function(x) { return x.label; }).join(", "));
    if (!mirrors.length) return [];
    mirrors = mirrors.slice(0, MAX_SERVERS);

    return Promise.all(mirrors.map(function(mir) {
      return withTimeout(resolveMirror(mir, embedUrl), MIRROR_TIMEOUT, { mirror: mir, streams: [] });
    })).then(function(results) {
      var streams = [];
      var seenHosts = {};
      results.forEach(function(r) {
        if (!r.streams.length) return;
        var host = r.mirror.host;
        if (seenHosts[host]) return;
        seenHosts[host] = 1;
        streams.push(r.streams[0]);
      });
      streams = streams.slice(0, MAX_SERVERS);
      console.log("[QDrama] unique sources:", streams.length);
      if (streams.length) return streams;

      console.log("[QDrama] No direct URL — returning embed fallback");
      var fallbacks = [];
      var seenHosts2 = {};
      results.forEach(function(r) {
        var host = r.mirror.host;
        if (seenHosts2[host]) return;
        seenHosts2[host] = 1;
        fallbacks.push({
          name: "QDrama",
          title: "QDrama (Embed) \u2022 " + r.mirror.label,
          url: r.mirror.embed,
          quality: "Auto",
          type: "iframe",
          referer: embedUrl
        });
      });
      return fallbacks.slice(0, MAX_SERVERS);
    });
  }).catch(function(err) {
    console.log("[QDrama] embed.php failed:", err.message);
    return [];
  });
}

function locateEpisode(meta, season, episode) {
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
    var ranked = all.filter(function(r) { return seriesScore(r, meta.titles) >= 0.9; });
    ranked.sort(function(a, b) {
      return seriesScore(b, meta.titles) - seriesScore(a, meta.titles);
    });
    console.log("[QDrama] Strict series hits:", ranked.length, "of", all.length);
    if (!ranked.length) return null;

    function tryNext(i) {
      if (i >= ranked.length || i >= 4) return Promise.resolve(null);
      var hit = ranked[i];
      console.log("[QDrama] Open:", hit.caption || hit.title);
      var watchUrl = BASE + "/watch.php?vid=" + hit.vid;
      return fetchText(watchUrl, BASE + "/", "q-drama.com").then(function(html) {
        var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        var heading = h1 ? decodeHtml(h1[1].replace(/<[^>]+>/g, " ")) : "";
        if (/(?:^|\s)فيلم(?:\s|\()/.test(heading) && !/مسلسل|برنامج/.test(heading)) {
          return tryNext(i + 1);
        }
        if (!isSeriesTitle(heading) && !/class="AiredEPS"/i.test(html)) return tryNext(i + 1);
        var probe = { caption: heading, title: heading };
        if (seriesScore(probe, meta.titles) < 0.9 && seriesScore(hit, meta.titles) < 1) {
          return tryNext(i + 1);
        }
        var vid = pickEpisodeVid(html, season, episode);
        if (!vid) return tryNext(i + 1);
        return vid;
      }).catch(function() { return tryNext(i + 1); });
    }
    return tryNext(0);
  });
}

function getTvStreams(tmdbId, season, episode) {
  var wantedSeason = Number(season) || 1;
  var wantedEp = Number(episode) || 1;
  return getTmdbTitles(tmdbId).then(function(meta) {
    return locateEpisode(meta, wantedSeason, wantedEp).then(function(vid) {
      if (!vid) {
        console.log("[QDrama] No episode", wantedSeason, wantedEp);
        return [];
      }
      return resolveVid(vid);
    });
  }).catch(function(err) {
    console.log("[QDrama] TV error:", err.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[QDrama] getStreams:", tmdbId, mediaType, season, episode);
  if (isMovieRequest(mediaType, season, episode)) {
    console.log("[QDrama] Skipping — QDrama is strictly series only");
    return Promise.resolve([]);
  }
  return getTvStreams(tmdbId, season, episode);
}

module.exports = {
  getStreams: getStreams
};

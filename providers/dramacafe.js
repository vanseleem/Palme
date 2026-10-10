var BASE = "https://ddramacafe-tv.casa";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MAX_SERVERS = 4;

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
  return fetch(url, { headers: headers, redirect: "follow" }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
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
    console.log("[DramaCafe] TMDB titles:", titles.join(" | "));
    return { titles: titles, year: year };
  });
}

function searchDramaCafe(title) {
  var cleanTitle = String(title || "").replace(/[:\u060C-\u061F]/g, " ").replace(/\s+/g, " ").trim();
  var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle);
  console.log("[DramaCafe] Search:", cleanTitle);
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
    console.log("[DramaCafe] Search results:", results.length);
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
  if (best) console.log("[DramaCafe] Best:", best.title, "score:", bestScore.toFixed(3));
  return bestScore >= 0.3 ? best : null;
}

function buildEmbedUrl(vid) {
  return BASE + "/embed.php?vid=" + vid;
}

function findPlayerIframe(embedHtml) {
  var m = embedHtml.match(/<iframe[^>]*src=["']([^"']+)["']/i);
  if (m) {
    var u = decodeHtml(m[1]);
    if (u.indexOf("//") === 0) u = "https:" + u;
    if (u.indexOf("/") === 0) u = BASE + u;
    return u;
  }
  m = embedHtml.match(/contentUrl["'][^>]*content=["']([^"']+)["']/i);
  if (m) {
    var u2 = decodeHtml(m[1]);
    if (u2.indexOf("//") === 0) u2 = "https:" + u2;
    return u2;
  }
  return null;
}

function unpackEval(html) {
  var m = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) return null;
  var payload = m[1];
  var base = parseInt(m[2], 10);
  var count = parseInt(m[3], 10);
  var keywords = m[4].split("|");
  while (count--) {
    if (keywords[count]) {
      var key = keywords[count];
      var pat = new RegExp("\\b" + count.toString(base) + "\\b", "g");
      payload = payload.replace(pat, function() { return key; });
    }
  }
  return payload;
}

function extractStreamsFromPlayer(playerHtml) {
  var streams = [];
  var seen = {};
  var unpacked = unpackEval(playerHtml);
  var search = unpacked || playerHtml;
  console.log("[DramaCafe] unpacked:", unpacked ? "yes (" + search.length + " chars)" : "no");

  var re = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/gi;
  var m;
  while ((m = re.exec(search)) !== null) {
    var u = m[0].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
    if (seen[u]) continue;
    seen[u] = 1;
    streams.push(u);
  }

  var re2 = /(?:file|source|src|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi;
  while ((m = re2.exec(search)) !== null) {
    var u2 = m[1].replace(/\\\//g, "/");
    if (u2.indexOf("http") !== 0) continue;
    if (seen[u2]) continue;
    seen[u2] = 1;
    streams.push(u2);
  }

  console.log("[DramaCafe] m3u8/mp4 found:", streams.length);
  return streams;
}

function extractDood(embedUrl) {
  return fetchText(embedUrl, BASE + "/").then(function(html) {
    var pm = html.match(/["'](\/pass_md5\/[^"']+)["']/i);
    if (!pm) return [];
    var tk = pm[1].match(/\/pass_md5\/([^\/?#]+)/);
    var token = tk ? tk[1] : '';
    var exm = html.match(/[?&]expiry=([0-9]+)/i);
    var expiry = exm ? exm[1] : String(Math.floor(Date.now() / 1000) + 3600);
    var origin = originOf(embedUrl);
    return fetchText(origin + pm[1], embedUrl).then(function(base) {
      base = String(base || '').trim();
      if (!base || base.length < 10 || !/^https?:/i.test(base)) return [];
      var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      var rnd = '';
      for (var i = 0; i < 10; i++) rnd += chars.charAt(Math.floor(Math.random() * chars.length));
      return [{ url: base + rnd + '?token=' + token + '&expiry=' + expiry, quality: 'Auto' }];
    });
  }).catch(function() { return []; });
}

function extractVk(embedUrl) {
  return fetchText(embedUrl, BASE + "/").then(function(html) {
    var out = [];
    var re = /"url(\d{3,4})"\s*:\s*"(https?:[^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      out.push({ url: m[2].replace(/\\\//g, '/'), quality: m[1] + 'p' });
    }
    if (!out.length) {
      var hls = /"hls"\s*:\s*"(https?:[^"]+)"/.exec(html);
      if (hls) out.push({ url: hls[1].replace(/\\\//g, '/'), quality: 'Auto' });
    }
    return out;
  }).catch(function() { return []; });
}

function extractOk(embedUrl) {
  return fetchText(embedUrl, BASE + "/").then(function(html) {
    var out = [];
    var m = /data-options\s*=\s*"([^"]+)"/.exec(html);
    if (m) {
      try {
        var options = JSON.parse(decodeHtml(m[1]));
        var meta = options && options.flashvars && options.flashvars.metadata;
        if (typeof meta === 'string') meta = JSON.parse(meta);
        if (meta) {
          (meta.videos || []).forEach(function(v) {
            if (v && v.url) out.push({ url: v.url, quality: 'Auto' });
          });
          var hls = meta.hlsManifestUrl || meta.ondemandHls || meta.hlsMasterPlaylistUrl;
          if (hls) out.push({ url: hls, quality: 'Auto' });
          if (out.length) return out;
        }
      } catch (e) {}
    }
    var mm = /"hlsManifestUrl"\s*:\s*"([^"]+)"/i.exec(html);
    if (mm) return [{ url: mm[1], quality: 'Auto' }];
    mm = /"videoUrl"\s*:\s*"([^"]+)"/i.exec(html);
    if (mm) return [{ url: mm[1], quality: 'Auto' }];
    return out;
  }).catch(function() { return []; });
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

function qualityRankValue(q) {
  if (q === "4K") return 4;
  if (q === "1440p") return 3;
  if (q === "1080p") return 2;
  if (q === "720p") return 1;
  if (q === "Auto") return 2;
  return 0;
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function makeStream(url, label, playerUrl, quality) {
  var origin = originOf(playerUrl) || BASE;
  var streamReferer = origin + "/";

  if (url.indexOf("http://") === 0) {
    url = "https://" + url.slice(7);
  }

  return {
    name: "DramaCafe",
    title: label ? "DramaCafe \u2022 " + label : "DramaCafe",
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
  return servers;
}

function resolveServer(server) {
  var embedUrl = server.url;
  var host = hostOf(embedUrl);

  var urlPromise;
  if (/vk\.com|vkvideo\.ru/.test(host)) {
    urlPromise = extractVk(embedUrl);
  } else if (/ok\.ru/.test(host)) {
    urlPromise = extractOk(embedUrl);
  } else if (/dood|playmogo|uqload|ds2play|vidspeed|bysesukior|mixdrop|hgcloud|voe/.test(host)) {
    urlPromise = extractDood(embedUrl);
  } else {
    urlPromise = fetchText(embedUrl, BASE + "/").then(function(html) {
      return extractStreamsFromPlayer(html).map(function(u) {
        return { url: u, quality: qualityFromUrl(u) };
      });
    });
  }

  return urlPromise.then(function(items) {
    if (items.length) {
      items.sort(function(a, b) { return qualityRankValue(b.quality) - qualityRankValue(a.quality); });
      var best = items[0];
      return [makeStream(best.url, server.name, embedUrl, best.quality)];
    }
    console.log("[DramaCafe] no direct URL for", server.name, "- using embed fallback");
    return [makeStream(embedUrl, server.name + " (embed)", embedUrl, "Auto")];
  }).catch(function(err) {
    console.log("[DramaCafe] server error:", server.name, err.message, "- using embed fallback");
    return [makeStream(embedUrl, server.name + " (embed)", embedUrl, "Auto")];
  });
}

function resolveSingleServer(vid) {
  var embedUrl = buildEmbedUrl(vid);
  return fetchText(embedUrl, BASE + "/").then(function(embedHtml) {
    var playerUrl = findPlayerIframe(embedHtml);
    if (!playerUrl) return [];
    return fetchText(playerUrl, embedUrl).then(function(playerHtml) {
      var directUrls = extractStreamsFromPlayer(playerHtml);
      if (!directUrls.length) {
        return [makeStream(playerUrl, "Server (embed)", playerUrl, "Auto")];
      }
      directUrls.sort(function(a, b) { return qualityRankValue(qualityFromUrl(b)) - qualityRankValue(qualityFromUrl(a)); });
      return [makeStream(directUrls[0], "Server", playerUrl)];
    }).catch(function(err) {
      console.log("[DramaCafe] fallback player error:", err.message);
      return [];
    });
  }).catch(function(err) {
    console.log("[DramaCafe] fallback embed error:", err.message);
    return [];
  });
}

function resolveVid(vid) {
  var playUrl = BASE + "/play.php?vid=" + vid;
  console.log("[DramaCafe] play:", playUrl);
  return fetchText(playUrl, BASE + "/").then(function(playHtml) {
    var servers = parseServers(playHtml);
    console.log("[DramaCafe] servers found:", servers.length);
    if (!servers.length) {
      console.log("[DramaCafe] no servers, falling back to single server");
      return resolveSingleServer(vid);
    }
    return Promise.all(servers.map(function(s) {
      return resolveServer(s);
    })).then(function(groups) {
      var all = [];
      groups.forEach(function(g) { all = all.concat(g); });
      all = all.slice(0, MAX_SERVERS);
      console.log("[DramaCafe] working streams:", all.length);
      if (!all.length) {
        console.log("[DramaCafe] none extracted, trying single-server fallback");
        return resolveSingleServer(vid);
      }
      return all;
    });
  }).catch(function(err) {
    console.log("[DramaCafe] play page error:", err.message);
    return resolveSingleServer(vid);
  });
}

function getMovieStreams(tmdbId) {
  return getTmdbTitles(tmdbId, "movie").then(function(meta) {
    return Promise.all(meta.titles.map(function(t) {
      return searchDramaCafe(t).catch(function() { return []; });
    })).then(function(groups) {
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[DramaCafe] Unique movie candidates:", all.length);
      if (!all.length) return [];
      var best = chooseResult(all, meta.titles);
      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[DramaCafe] Movie error:", err.message);
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
      return searchDramaCafe(q).catch(function() { return []; });
    })).then(function(groups) {
      var all = [];
      var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) {
          if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); }
        });
      });
      console.log("[DramaCafe] Unique TV candidates:", all.length);

      var withEp = all.filter(function(r) {
        var dec = r.title;
        return new RegExp("(?:الحلق[ةه]\\s*" + wanted + "\\b|\\b" + wanted + "\\b)", "i").test(dec);
      });
      var pool = withEp.length ? withEp : all;
      console.log("[DramaCafe] TV candidates with ep " + wanted + ":", withEp.length, "/ pool:", pool.length);

      if (!pool.length) return [];
      var best = chooseResult(pool, meta.titles);
      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[DramaCafe] TV error:", err.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[DramaCafe] getStreams:", tmdbId, mediaType, season, episode);
  if (mediaType === "tv") return getTvStreams(tmdbId, season, episode);
  return getMovieStreams(tmdbId);
}

module.exports = {
  getStreams: getStreams
};

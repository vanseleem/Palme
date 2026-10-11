var BASE = "https://vod.q-drama.com";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MAX_SERVERS = 3;
var MIRROR_TIMEOUT = 15000;
var BAD_HOST = /(^|\.)(q-drama\.com|facebook\.com|twitter\.com|google\.com|googleapis\.com|gstatic\.com|w3\.org|schema\.org|cloudflare\.com|jquery\.com|jsdelivr\.net|t\.me|telegram\.org|themoviedb\.org)$/i;

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
    .replace(/\\\//g, "/").replace(/&amp;/g, "&");
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

// FIXED: accepts optional stripSeasonEp flag to remove episode noise before scoring
function cleanSiteTitle(str, stripSeasonEp) {
  var s = decodeHtml(String(str || ""))
    .replace(/مشاهدة|فيلم|مسلسل|مترجم[ةه]?|مدبلج[ةه]?|اون\s*لاين|اونلاين|أون\s*لاين|كامل[ةه]?|\bHD\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  if (stripSeasonEp) {
    // Remove "الموسم N" and "الحلقة N" (and written Arabic ordinals) so the
    // pure series title is compared — otherwise episode words inflate the
    // denominator and push similarity below the 0.3 threshold.
    s = s
      .replace(/الموسم\s*\d+/g, " ")
      .replace(/الحلق[ةه]\s*\d+/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/(?:الأول[ىي]?|الثاني[ةه]?|الثالثة?|الرابعة?|الخامسة?|السادسة?|السابعة?|الثامنة?|التاسعة?|العاشرة?)(?:\s+و\S+)*/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  var noYear = s.replace(/\(?\b(?:19|20)\d{2}\b\)?/g, " ").replace(/\s+/g, " ").trim();
  return noYear || s;
}

// FIXED: passes stripSeasonEp=true for TV so series titles score correctly
function scoreResult(r, titles, year, isTv) {
  var cleaned = cleanSiteTitle(r.title, !!isTv);
  var s = 0;
  titles.forEach(function(t) {
    var sc = Math.max(similarity(cleaned, t), similarity(r.title, t) * 0.9);
    if (sc > s) s = sc;
  });
  if (!isTv && year) {
    var ys = String(r.title).match(/\b(?:19|20)\d{2}\b/g);
    if (ys) {
      var ok = ys.some(function(y) { return Math.abs(Number(y) - Number(year)) <= 1; });
      s = ok ? Math.min(1, s + 0.1) : s * 0.5;
    }
  }
  return s;
}

function getTmdbTitles(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var langs = ["ar", "en"];
  var titles = [];
  var year = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) +
                   "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        var t = type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
        if (t && titles.indexOf(t) === -1) titles.push(t);
        // Also pick up original_name for TV to get the English name regardless of lang
        if (type === "tv" && data.original_name && titles.indexOf(data.original_name) === -1) {
          titles.push(data.original_name);
        }
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

function searchQDrama(title) {
  var cleanTitle = String(title || "").replace(/[:\u060C-\u061F]/g, " ").replace(/\s+/g, " ").trim();
  var url = BASE + "/search.php?keywords=" + encodeURIComponent(cleanTitle);
  console.log("[QDrama] Search:", cleanTitle);
  return fetchText(url, BASE + "/").then(function(html) {
    var results = []; var seen = {};
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
    console.log("[QDrama] Search results:", results.length);
    return results;
  });
}

function chooseResult(results, titles, year, isTv) {
  var best = null; var bestScore = 0;
  results.forEach(function(r) {
    var s = scoreResult(r, titles, year, isTv);
    if (s > bestScore) { bestScore = s; best = r; }
  });
  if (best) console.log("[QDrama] Best:", best.title, "score:", bestScore.toFixed(3));
  // For pre-filtered pools (episode-specific), lower threshold to 0.2 since
  // the pool is already constrained; top caller decides whether to lower.
  return bestScore >= 0.3 ? best : null;
}

// Accept an optional lower threshold for already-filtered pools
function chooseResultLow(results, titles, isTv) {
  var best = null; var bestScore = 0;
  results.forEach(function(r) {
    var s = scoreResult(r, titles, null, isTv);
    if (s > bestScore) { bestScore = s; best = r; }
  });
  if (best) console.log("[QDrama] Best (low-threshold):", best.title, "score:", bestScore.toFixed(3));
  return bestScore >= 0.15 ? best : null;
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
  var out = []; var seen = {};
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
  while ((m = reOpt.exec(text)) !== null) {
    if (m[1].indexOf("http") !== 0) continue;
    add(rawMirror(m[1]) || normalizeMirror(m[1]));
  }

  // <iframe src>
  var reIf = /<iframe[^>]+src=["']([^"']+)["']/gi;
  while ((m = reIf.exec(text)) !== null) add(rawMirror(m[1]) || normalizeMirror(m[1]));

  // data-src / data-url / data-link / data-embed / data-server attributes
  var reData = /data-(?:src|url|link|embed|server|iframe)\s*=\s*["']([^"']+)["']/gi;
  while ((m = reData.exec(text)) !== null) add(rawMirror(m[1]) || normalizeMirror(m[1]));

  // JS arrays: var servers/s/serverList/links = [...]
  var reArr = /var\s+(?:servers?|srv|s|serverList|srvList|playerList|links?)\s*=\s*\[([^\]]{10,})\]/gi;
  while ((m = reArr.exec(text)) !== null) {
    var arrText = m[1];
    var reStr = /["']([^"']{10,})["']/g; var sm;
    while ((sm = reStr.exec(arrText)) !== null) add(rawMirror(sm[1]) || normalizeMirror(sm[1]));
    var reInSrc = /src=["']([^"']+)["']/gi;
    while ((sm = reInSrc.exec(arrText)) !== null) add(rawMirror(sm[1]) || normalizeMirror(sm[1]));
  }

  // JS objects: var servers = { "1": "url", ... }
  var reObj = /var\s+(?:servers?|srv|serverList|srvList|links?)\s*=\s*\{([^}]{10,})\}/gi;
  while ((m = reObj.exec(text)) !== null) {
    var reVal = /:\s*["']([^"']{10,})["']/g; var om;
    while ((om = reVal.exec(m[1])) !== null) add(rawMirror(om[1]) || normalizeMirror(om[1]));
  }

  var urls = [];
  collectUrls(text, urls);

  // Base64 strings
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
  var streams = []; var seen = {};

  function addStream(u) {
    u = String(u || "").replace(/^http:\/\//, "https://").trim();
    if (!u || seen[u]) return;
    seen[u] = 1;
    streams.push(u);
  }

  var layers = [cleanEscapes(playerHtml)];
  var unpacked = unpackEval(playerHtml);
  if (unpacked) layers.push(cleanEscapes(unpacked));

  var reAtob = /atob\s*\(\s*["']([A-Za-z0-9+\/]{24,}={0,2})["']\s*\)/g;
  var am;
  while ((am = reAtob.exec(playerHtml)) !== null) {
    var dec = b64decode(am[1]);
    if (dec && dec.length > 20) layers.push(cleanEscapes(dec));
  }

  layers.forEach(function(layer) {
    var re = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/gi;
    var m;
    while ((m = re.exec(layer)) !== null) addStream(m[0]);

    var re2 = /(?:file|source|src|url|hls|stream|link|video)\s*[:=]\s*["']([^"']{12,}\.(?:m3u8|mp4)[^"']*)["']/gi;
    while ((m = re2.exec(layer)) !== null) {
      if (m[1].indexOf("http") === 0) addStream(m[1]);
    }

    var re3 = /"(?:file|hls|src|url|stream)"\s*:\s*"([^"]{12,}\.(?:m3u8|mp4)[^"]*)"/gi;
    while ((m = re3.exec(layer)) !== null) {
      if (m[1].indexOf("http") === 0) addStream(m[1]);
    }
  });

  console.log("[QDrama] player yielded", streams.length, "stream(s)");
  return streams;
}

function qualityFromUrl(url) {
  var s = String(url).toLowerCase();
  if (/2160|4k/.test(s)) return "4K"; if (/1440/.test(s)) return "1440p";
  if (/1080/.test(s)) return "1080p"; if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p"; if (/360/.test(s)) return "360p";
  return "Auto";
}

function qualityRankValue(q) {
  if (q === "4K") return 5; if (q === "1440p") return 4; if (q === "1080p") return 3;
  if (q === "720p") return 2; if (q === "Auto") return 3; if (q === "480p") return 1;
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
    headers: { "User-Agent": UA, "Referer": streamReferer, "Origin": origin, "Accept": "*/*" }
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

// FIXED: also fetch play.php (same as QFilm) to catch any server URLs in play page
function resolveVid(vid) {
  var playUrl = BASE + "/play.php?vid=" + vid;
  var embedUrl = BASE + "/embed.php?vid=" + vid;
  console.log("[QDrama] play:", playUrl, "embed:", embedUrl);

  return Promise.all([
    fetchText(playUrl, BASE + "/").catch(function() { return ""; }),
    fetchText(embedUrl, BASE + "/").catch(function() { return ""; })
  ]).then(function(htmls) {
    var rawMirrors = [];
    htmls.forEach(function(h) {
      harvestMirrors(h).forEach(function(mir) { rawMirrors.push(mir); });
    });

    var byHost = {}; var hostOrder = [];
    rawMirrors.forEach(function(mir) {
      if (byHost[mir.host]) return;
      byHost[mir.host] = mir; hostOrder.push(mir.host);
    });

    console.log("[QDrama] unique hosts:", hostOrder.length, "->",
      hostOrder.map(function(h) { return byHost[h].label; }).join(", "));

    if (!hostOrder.length) return [];
    var mirrors = hostOrder.slice(0, MAX_SERVERS).map(function(h) { return byHost[h]; });

    return Promise.all(mirrors.map(function(mir) {
      return withTimeout(resolveMirror(mir, embedUrl), MIRROR_TIMEOUT, { mirror: mir, streams: [] });
    })).then(function(results) {
      var streams = []; var seenHosts = {};
      results.forEach(function(r) {
        if (!r.streams.length) return;
        var host = r.mirror.host;
        if (seenHosts[host]) return;
        seenHosts[host] = 1;
        streams.push(r.streams[0]);
      });
      streams = streams.slice(0, MAX_SERVERS);
      if (streams.length) return streams;

      console.log("[QDrama] No direct URL — returning embed fallback");
      var fallbacks = []; var seenHosts2 = {};
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
    console.log("[QDrama] resolveVid error:", err.message);
    return [];
  });
}

// FIXED: season-aware episode search and filtering
function getTvStreams(tmdbId, season, episode) {
  var wanted = Number(episode) || 1;
  var wantedSeason = Number(season) || 1;

  return getTmdbTitles(tmdbId, "tv").then(function(meta) {
    var searches = [];
    meta.titles.forEach(function(t) {
      if (wantedSeason > 1) {
        // For multi-season: search with season+episode first (most precise)
        searches.push(t + " الموسم " + wantedSeason + " الحلقة " + wanted);
        searches.push(t + " الحلقة " + wanted);
        searches.push(t + " الموسم " + wantedSeason);
      } else {
        // For single-season (Arabic series): search with episode number
        searches.push(t + " الحلقة " + wanted);
        searches.push(t + " " + wanted);
      }
      searches.push(t);
    });

    return Promise.all(searches.map(function(q) {
      return searchQDrama(q).catch(function() { return []; });
    })).then(function(groups) {
      var all = []; var seen = {};
      groups.forEach(function(g) {
        g.forEach(function(r) { if (!seen[r.vid]) { seen[r.vid] = 1; all.push(r); } });
      });
      console.log("[QDrama] Unique TV candidates:", all.length);

      // FIXED: filter by episode AND season
      var withEp = all.filter(function(r) {
        var t = r.title;

        // Episode must match
        var epRe = new RegExp("(?:الحلق[ةه]\\s*" + wanted + "\\b|\\b" + wanted + "\\b)", "i");
        if (!epRe.test(t)) return false;

        // For multi-season shows: also verify season when explicitly present in title
        if (wantedSeason > 1) {
          var seasonInTitle = t.match(/الموسم\s*(\d+)/);
          if (seasonInTitle) {
            // Title has a season number — it must match
            return parseInt(seasonInTitle[1]) === wantedSeason;
          }
          // No season number in title — accept (might be a flat episode list)
        }
        return true;
      });

      var pool = withEp.length ? withEp : all;
      console.log("[QDrama] After ep/season filter:", withEp.length, "pool:", pool.length);

      if (!pool.length) return [];

      // For pre-filtered pools use a lower threshold (series title vs episode title always diverges)
      var best = withEp.length
        ? (chooseResult(withEp, meta.titles, null, true) || chooseResultLow(withEp, meta.titles, true))
        : chooseResult(all, meta.titles, null, true);

      if (!best) return [];
      return resolveVid(best.vid);
    });
  }).catch(function(err) {
    console.log("[QDrama] TV error:", err.message);
    return [];
  });
}

// FIXED: strict series-only guard — no movie logic at all
function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[QDrama] getStreams:", tmdbId, mediaType, season, episode);
  if (mediaType !== "tv" && mediaType !== "series") {
    console.log("[QDrama] Skipping — QDrama is strictly series only, got:", mediaType);
    return Promise.resolve([]);
  }
  return getTvStreams(tmdbId, season, episode);
}

module.exports = { getStreams: getStreams };

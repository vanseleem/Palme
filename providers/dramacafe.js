

var BASE = "https://ddramacafe-tv.casa";
var PROVIDER_ID = "dramacafe";
var PROVIDER_NAME = "DramaCafe";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";

var SITE_TIMEOUT = 15000;
var EMBED_TIMEOUT = 12000;
var MATCH_THRESHOLD = 0.42;
var MAX_MOVIE_CANDIDATES = 3;
var MAX_EPISODE_CANDIDATES = 2;
var MAX_SERVERS = 3;

function log(m) { console.log("[DramaCafe] " + m); }

// ═════════════════════════════ HTTP ═════════════════════════════

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

function asciiSafe(v) {
  return String(v).replace(/[^\x00-\x7F]/g, function (c) {
    try { return encodeURIComponent(c); } catch (e) { return ""; }
  });
}

function fetchText(url, referer, timeoutMs) {
  url = asciiSafe(url);
  var headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en;q=0.9"
  };
  if (referer) headers["Referer"] = asciiSafe(referer);
  return withTimeout(
    fetch(url, { method: "GET", headers: headers, redirect: "follow" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }),
    timeoutMs || SITE_TIMEOUT,
    url.split("?")[0]
  );
}

// ═════════════════════════════ TEXT ═════════════════════════════

function decodeEntities(str) {
  return String(str == null ? "" : str)
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function toWesternDigits(str) {
  return String(str)
    .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
}

function normalizeText(input) {
  var s = toWesternDigits(decodeEntities(input)).toLowerCase();
  if (typeof s.normalize === "function") {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  s = s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\u0686/g, "\u062C")
    .replace(/\u067E/g, "\u0628")
    .replace(/\u06A4/g, "\u0641")
    .replace(/[\u06AF\u06A9]/g, "\u0643")
    .replace(/\u06CC/g, "\u064A");
  return s.replace(/[^\u0621-\u064Aa-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

// ═══════════════════════ Arabic vocabulary ═══════════════════════

var KIND_BY_WORD = {};
[
  ["فيلم", "movie"], ["فلم", "movie"], ["افلام", "movie"], ["أفلام", "movie"],
  ["مسلسل", "series"], ["مسلسلات", "series"],
  ["انمي", "anime"], ["أنمي", "anime"], ["انيمي", "anime"], ["أنيمي", "anime"],
  ["مسرحيه", "play"], ["مسرحية", "play"],
  ["برنامج", "show"], ["برامج", "show"],
  ["movie", "movie"], ["film", "movie"],
  ["series", "series"], ["show", "series"],
  ["anime", "anime"]
].forEach(function (p) { KIND_BY_WORD[normalizeText(p[0])] = p[1]; });

var DUB_WORDS = {};
["مدبلج", "مدبلجة", "مدبلج عربي", "بالدبلجة", "دبلجة", "dubbed", "dub"]
  .forEach(function (w) { DUB_WORDS[normalizeText(w)] = true; });

var SUB_WORDS = {};
["مترجم", "مترجمة", "مترجم عربي", "بالترجمة", "subtitled", "subbed", "sub"]
  .forEach(function (w) { SUB_WORDS[normalizeText(w)] = true; });

var SEASON_WORDS = {};
["الموسم", "موسم", "الجزء", "جزء", "season"]
  .forEach(function (w) { SEASON_WORDS[normalizeText(w)] = true; });

var EPISODE_WORDS = {};
["الحلقة", "حلقة", "الحلقه", "حلقه", "episode", "ep"]
  .forEach(function (w) { EPISODE_WORDS[normalizeText(w)] = true; });

var NOISE_WORDS = {};
[
  "كامل", "كاملة", "hd", "fhd", "uhd", "4k", "bluray", "blu-ray",
  "hdrip", "webrip", "web-dl", "720p", "1080p", "2160p",
  "بجودة", "جودة", "عالية", "عالي", "عاليه",
  "اون", "لاين", "اونلاين", "أونلاين", "مشاهدة", "مباشرة", "يوتيوب",
  "الان", "الآن", "جديد", "جديدة", "حصريا", "حصرياً", "حصري",
  "اخر", "اخير", "الأخيرة", "الاخيرة",
  "complete", "full", "watch", "online", "streaming",
  "quality", "high", "youtube"
].forEach(function (w) { NOISE_WORDS[normalizeText(w)] = true; });

var ORDINALS = {};
[
  ["الأول", 1], ["الاول", 1], ["الأولى", 1], ["الاولى", 1], ["اول", 1], ["أول", 1], ["أولى", 1],
  ["الثاني", 2], ["الثانية", 2], ["ثاني", 2], ["ثانية", 2], ["تانى", 2], ["تانية", 2],
  ["الثالث", 3], ["الثالثة", 3], ["ثالث", 3], ["ثالثة", 3], ["تالت", 3], ["تالتة", 3],
  ["الرابع", 4], ["الرابعة", 4], ["رابع", 4], ["رابعة", 4],
  ["الخامس", 5], ["الخامسة", 5], ["خامس", 5], ["خامسة", 5],
  ["السادس", 6], ["السادسة", 6], ["سادس", 6], ["سادسة", 6],
  ["السابع", 7], ["السابعة", 7], ["سابع", 7], ["سابعة", 7],
  ["الثامن", 8], ["الثامنة", 8], ["ثامن", 8], ["ثامنة", 8],
  ["التاسع", 9], ["التاسعة", 9], ["تاسع", 9], ["تاسعة", 9],
  ["العاشر", 10], ["العاشرة", 10], ["عاشر", 10], ["عاشرة", 10]
].forEach(function (p) { ORDINALS[normalizeText(p[0])] = p[1]; });

function numberFromToken(token) {
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10);
  return ORDINALS[token] || null;
}

// ═══════════════════════ parseTitle ═══════════════════════

function parseTitle(raw) {
  var info = {
    kind: null, name: "", year: null,
    season: null, episode: null,
    dubbed: false, subbed: false
  };
  var tokens = normalizeText(raw).split(" ").filter(Boolean);

  var kindIdx = -1;
  for (var k = 0; k < Math.min(tokens.length, 3); k++) {
    if (KIND_BY_WORD[tokens[k]]) { kindIdx = k; break; }
  }
  if (kindIdx !== -1) {
    info.kind = KIND_BY_WORD[tokens[kindIdx]];
    tokens.splice(kindIdx, 1);
  }

  tokens = tokens.filter(function (t) {
    if (DUB_WORDS[t]) { info.dubbed = true; return false; }
    if (SUB_WORDS[t]) { info.subbed = true; return false; }
    return true;
  });

  if (info.kind === "series" || info.kind === "anime" || info.kind === "show") {
    var epIdx = -1;
    for (var e = 0; e < tokens.length; e++) {
      if (EPISODE_WORDS[tokens[e]]) { epIdx = e; break; }
    }
    if (epIdx !== -1) {
      var next = tokens[epIdx + 1];
      if (next && /^\d+$/.test(next)) {
        info.episode = parseInt(next, 10);
      } else if (next && ORDINALS[next]) {
        info.episode = ORDINALS[next];
      }
      tokens = tokens.slice(0, epIdx);
    }

    for (var i = tokens.length - 2; i >= 0; i--) {
      if (SEASON_WORDS[tokens[i]]) {
        var sNum = numberFromToken(tokens[i + 1]);
        if (sNum) {
          info.season = sNum;
          tokens.splice(i, 2);
          break;
        }
      }
    }
  } else {
    for (var j = tokens.length - 1; j >= 0; j--) {
      if (/^(19|20)\d\d$/.test(tokens[j])) {
        if (tokens.length > 1) {
          info.year = parseInt(tokens[j], 10);
          tokens.splice(j, 1);
        }
        break;
      }
    }
  }

  info.name = tokens.filter(function (t) { return !NOISE_WORDS[t]; }).join(" ");
  return info;
}

// ═══════════════════════ Similarity ═══════════════════════

function bigramMap(str) {
  var s = str.replace(/ /g, "");
  var map = {};
  var size = 0;
  for (var i = 0; i < s.length - 1; i++) {
    var g = s.substr(i, 2);
    map[g] = (map[g] || 0) + 1;
    size++;
  }
  return { map: map, size: size };
}

function diceScore(a, b) {
  if (a === b) return 1;
  var x = bigramMap(a), y = bigramMap(b);
  if (!x.size || !y.size) return 0;
  var common = 0;
  Object.keys(x.map).forEach(function (g) {
    if (y.map[g]) common += Math.min(x.map[g], y.map[g]);
  });
  return (2 * common) / (x.size + y.size);
}

// ═══════════════════════ TMDB ═══════════════════════

function fetchTmdb(tmdbId, type) {
  var url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&language=ar&append_to_response=translations,alternative_titles";
  return fetchText(url, null, SITE_TIMEOUT).then(function (body) { return JSON.parse(body); });
}

function buildMeta(data, type) {
  var isTv = type === "tv";
  var raw = [
    isTv ? data.name : data.title,
    isTv ? data.original_name : data.original_title
  ];

  var translations = (data.translations && data.translations.translations) || [];
  translations.forEach(function (t) {
    if (t.iso_639_1 === "ar" && t.data) raw.push(isTv ? t.data.name : t.data.title);
    if (t.iso_639_1 === "en" && t.data) raw.push(isTv ? t.data.name : t.data.title);
  });

  var alts = (data.alternative_titles && data.alternative_titles.titles) || [];
  alts.forEach(function (a) { if (a.title) raw.push(a.title); });

  var isArabic = data.original_language === "ar";
  var isAnime = (data.genres || []).some(function (g) { return g.id === 16; });

  var seen = {};
  var titles = [];
  raw.forEach(function (t) {
    if (!t) return;
    var n = normalizeText(t);
    if (!n || seen[n]) return;
    seen[n] = true;
    titles.push(t);
  });

  var dateStr = isTv ? data.first_air_date : data.release_date;
  var year = dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;

  return {
    type: type,
    arabic: isArabic,
    anime: isAnime,
    year: isNaN(year) ? null : year,
    displayTitle: titles.length ? titles[0] : (isTv ? data.name : data.title),
    targets: titles.map(function (t) { return normalizeText(t); }),
    rawTitles: titles
  };
}

// ═══════════════════════ Search ═══════════════════════

function parseWatchAnchors(html) {
  var byVid = {};
  var out = [];
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var attrs = m[1];
    var inner = m[2];
    var hrefM = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!hrefM) continue;
    var href = decodeEntities(hrefM[1]);
    var vm = /watch\.php\?vid=([A-Za-z0-9]+)/i.exec(href);
    if (!vm) continue;
    var vid = vm[1];
    if (byVid[vid]) continue;

    var titleM = /title\s*=\s*["']([^"']*)["']/i.exec(attrs);
    var title = titleM ? decodeEntities(titleM[1]).trim() : "";
    if (!title) {
      title = decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    }

    byVid[vid] = { vid: vid, title: title, url: BASE + "/watch.php?vid=" + vid };
    out.push(byVid[vid]);
  }
  return out;
}

function searchOnce(query) {
  var clean = String(query || "").replace(/[:\u060C-\u061F]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return Promise.resolve([]);
  var url = BASE + "/search.php?keywords=" + encodeURIComponent(clean) + "&video-id=";
  log("search: " + clean);
  return fetchText(url, BASE + "/").then(function (html) {
    var anchors = parseWatchAnchors(html);
    log("  -> " + anchors.length + " result(s)");
    return anchors;
  }).catch(function (e) {
    log("  -> search error: " + (e && e.message));
    return [];
  });
}

function searchMany(meta, season, episode) {
  var queries = [];

  meta.rawTitles.slice(0, 4).forEach(function (t) {
    queries.push(t);

    if (meta.type === "movie") {
      if (meta.year) queries.push(t + " " + meta.year);
      queries.push("فيلم " + t);
    } else {
      var kindWord = meta.anime ? "انمي" : "مسلسل";
      if (episode) {
        queries.push(t + " الحلقة " + episode);
        queries.push(kindWord + " " + t + " الحلقة " + episode);
      }
      if (season > 1) {
        queries.push(t + " الموسم " + season);
        queries.push(kindWord + " " + t + " الموسم " + season);
      }
      queries.push(kindWord + " " + t);
      queries.push(t);
    }
  });

  var seen = {};
  queries = queries.filter(function (q) {
    var k = normalizeText(q);
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });

  log("running " + queries.length + " queries");

  return Promise.all(queries.map(function (q) {
    return searchOnce(q);
  })).then(function (groups) {
    var byVid = {};
    var all = [];
    groups.forEach(function (g) {
      g.forEach(function (r) {
        if (byVid[r.vid]) return;
        byVid[r.vid] = true;
        all.push(r);
      });
    });
    log("total unique candidates: " + all.length);
    return all;
  });
}

// ═══════════════════════ Scoring ═══════════════════════

function compatibleKind(wantKind, gotKind) {
  if (!gotKind) return true;
  if (wantKind === gotKind) return true;
  if (wantKind === "series" && (gotKind === "anime" || gotKind === "show")) return true;
  if (wantKind === "anime" && (gotKind === "series" || gotKind === "show")) return true;
  return false;
}

function scoreCandidate(entry, meta, wantedSeason, wantedEpisode) {
  var parsed = parseTitle(entry.title);
  var wantKind = meta.type === "movie" ? "movie" : (meta.anime ? "anime" : "series");

  if (!compatibleKind(wantKind, parsed.kind)) return { score: 0 };

  var probe = parsed.name || normalizeText(entry.title);
  var base = 0;
  meta.targets.forEach(function (target) {
    var sc = diceScore(probe, target);
    if (sc > base) base = sc;
  });

  var yearBonus = 0;
  if (meta.type === "movie" && meta.year) {
    if (parsed.year !== null) {
      var yd = Math.abs(parsed.year - meta.year);
      if (yd === 0) yearBonus = 0.15;
      else if (yd === 1) yearBonus = 0.07;
      else if (yd > 1) yearBonus = -0.20;
    }
  }

  var seasonBonus = 0;
  if (meta.type === "tv" && wantedSeason) {
    if (parsed.season === wantedSeason) seasonBonus = 0.20;
    else if (parsed.season !== null && parsed.season !== wantedSeason) seasonBonus = -0.15;
  }

  var epBonus = 0;
  if (meta.type === "tv" && wantedEpisode) {
    if (parsed.episode === wantedEpisode) epBonus = 0.20;
    else if (parsed.episode !== null && parsed.episode !== wantedEpisode) epBonus = -0.15;
  }

  return {
    score: base + yearBonus + seasonBonus + epBonus,
    parsed: parsed,
    base: base
  };
}

function rankCandidates(candidates, meta, season, episode) {
  return candidates.map(function (c) {
    var s = scoreCandidate(c, meta, season, episode);
    return { entry: c, score: s.score, parsed: s.parsed, base: s.base };
  }).sort(function (a, b) { return b.score - a.score; });
}

// ═══════════════════════ Episode resolution ═══════════════════════

function findEpisodeVid(watchUrl, meta, season, episode) {
  return fetchText(watchUrl, BASE + "/").then(function (html) {
    var anchors = parseWatchAnchors(html);
    log("episode list size: " + anchors.length);

    var best = null;
    var bestScore = -1;

    anchors.forEach(function (a) {
      var parsed = parseTitle(a.title);
      var s = 0;

      if (parsed.kind && parsed.kind !== "series" && parsed.kind !== "anime" && parsed.kind !== "show") return;

      if (episode) {
        if (parsed.episode === episode) s += 10;
        else if (parsed.episode !== null) return;
      }

      if (season > 1) {
        if (parsed.season === season) s += 5;
        else if (parsed.season !== null && parsed.season !== season) return;
        else if (parsed.season === null) return;
      } else {
        if (parsed.season === 1 || parsed.season === null) s += 2;
        else return;
      }

      var nameOk = false;
      meta.targets.forEach(function (t) {
        if (parsed.name === t) { nameOk = true; s += 5; }
        else if (parsed.name.indexOf(t) !== -1 || t.indexOf(parsed.name) !== -1) { nameOk = true; s += 3; }
      });
      if (!nameOk && meta.targets.length) return;

      if (s > bestScore) { bestScore = s; best = a; }
    });

    if (best) {
      log("episode match: " + best.title + " -> " + best.vid);
      return best.vid;
    }
    log("no episode match on watch page");
    return null;
  }).catch(function (e) {
    log("watch page error: " + (e && e.message));
    return null;
  });
}

// ═══════════════════════ Play page servers ═══════════════════════

function parseServersFromPlayPage(html) {
  var out = [];
  var seen = {};

  function add(url, num, label) {
    url = decodeEntities(String(url || "")).trim();
    if (!url) return;
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) return;
    if (seen[url]) return;
    seen[url] = 1;
    out.push({ url: url, number: num || (out.length + 1), label: label || "" });
  }

  var liRe = /<li\b([^>]*data-embed-url[^>]*)>([\s\S]{0,600}?)<\/li>/gi;
  var m;
  while ((m = liRe.exec(html)) !== null) {
    var attrs = m[1];
    var inner = m[2];

    var idM = /data-embed-id\s*=\s*["']?(\d+)["']?/i.exec(attrs);
    var urlM = /data-embed-url\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!urlM) continue;

    var labelM = /<strong[^>]*>([^<]+)<\/strong>/i.exec(inner);
    var label = labelM ? decodeEntities(labelM[1]).trim() : "";

    add(urlM[1], idM ? parseInt(idM[1], 10) : 0, label);
  }

  if (!out.length) {
    var reAny = /data-embed-url\s*=\s*["']([^"']+)["']/gi;
    while ((m = reAny.exec(html)) !== null) add(m[1]);
  }

  if (!out.length) {
    var phM = /id=["']Playerholder["'][\s\S]{0,800}?<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(html);
    if (phM) add(phM[1], 1, "default");
  }

  if (!out.length) {
    var ifRe = /<iframe\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = ifRe.exec(html)) !== null) add(m[1]);
  }

  log("servers found on play page: " + out.length);
  return out;
}

// ═══════════════════════ Helpers ═══════════════════════

function hostOf(url) {
  var m = /^https?:\/\/([^\/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}
function originOf(url) {
  var m = /^(https?:\/\/[^\/?#]+)/i.exec(url);
  return m ? m[1] : "";
}

function qualityFromUrl(url) {
  var s = String(url).toLowerCase();
  if (/2160|4k/.test(s)) return "2160p";
  if (/1440/.test(s)) return "1440p";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  if (/240/.test(s)) return "240p";
  var m = /(\d{3,4})p\b/i.exec(s);
  return m ? m[1] + "p" : "Auto";
}

function qualityRank(q) {
  if (q === "Auto") return 1080;
  var n = parseInt(q, 10);
  return isNaN(n) ? 0 : n;
}

function serverLabelFromUrl(url, fallback) {
  var h = hostOf(url);
  if (/1vid/.test(h))          return "1Vid";
  if (/vk\.com|vkvideo/.test(h)) return "VK";
  if (/ok\.ru/.test(h))        return "OK.ru";
  if (/hgcloud/.test(h))       return "HGCloud";
  if (/vidspeed/.test(h))      return "Vidspeed";
  if (/listeamed/.test(h))     return "Listeamed";
  if (/uqload/.test(h))        return "Uqload";
  if (/ds2play/.test(h))       return "DS2Play";
  if (/voe\.sx/.test(h))       return "Voe";
  if (/yourupload/.test(h))    return "YourUpload";
  if (/streamtape/.test(h))    return "Streamtape";
  if (/mixdrop/.test(h))       return "Mixdrop";
  if (/dood/.test(h))          return "Dood";
  if (/filemoon/.test(h))      return "Filemoon";
  return fallback || (h.split(".").slice(-2, -1)[0] || h);
}

function cleanMediaUrl(url) {
  return String(url)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

function unpackPacker(text) {
  var out = [];
  if (text.indexOf("p,a,c,k,e") === -1) return out;
  var digits = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var patterns = [
    /\}\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\[\s\S])*)'\s*\.split\(\s*'\|'\s*\)/g,
    /\}\(\s*"((?:[^"\\]|\\[\s\S])*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\[\s\S])*)"\s*\.split\(\s*"\|"\s*\)/g
  ];
  patterns.forEach(function (re) {
    var m;
    while ((m = re.exec(text)) !== null) {
      var radix = parseInt(m[2], 10);
      var words = m[4].split("|");
      var payload = m[1].replace(/\\\\/g, "\\").replace(/\\'/g, "'").replace(/\\"/g, '"');
      out.push(payload.replace(/\b\w+\b/g, function (w) {
        var n = 0;
        for (var i = 0; i < w.length; i++) {
          var d = digits.indexOf(w.charAt(i));
          if (d < 0 || d >= radix) return w;
          n = n * radix + d;
        }
        return words[n] ? words[n] : w;
      }));
    }
  });
  return out;
}

var BAD_ASSET = /\.(?:jpe?g|png|gif|webp|vtt|srt|css|js|json|html?)(?:[?#]|$)/i;

function scanMediaUrls(text, baseUrl) {
  var patterns = [
    /sources\s*:\s*\[\s*\{\s*["']?file["']?\s*:\s*["']([^"']+)["']/gi,
    /sources\s*:\s*\[\s*["']([^"']+)["']/gi,
    /["']?file["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
    /["']hls\d*["']\s*:\s*["']([^"']+)["']/gi,
    /wurl\s*=\s*["']([^"']+)["']/gi,
    /["'](https?:\\?\/\\?\/[^"'\s]+?\.(?:m3u8|mp4)[^"'\s]*)["']/gi,
    /(https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)[^"'\s<>]*)/gi
  ];
  var found = [], seen = {};
  patterns.forEach(function (re) {
    var m;
    while ((m = re.exec(text)) !== null) {
      var url = cleanMediaUrl(m[1]);
      if (url.indexOf("//") === 0) url = "https:" + url;
      if (url.indexOf("http") !== 0) continue;
      if (seen[url] || BAD_ASSET.test(url)) continue;
      seen[url] = 1;
      found.push(url);
    }
  });
  return found;
}

// ═══════════════════════ Extractors ═══════════════════════

function extractVk(embedUrl) {
  return fetchText(embedUrl, "https://vk.com/", EMBED_TIMEOUT).then(function (html) {
    var headers = {
      "User-Agent": UA,
      "Referer": "https://vk.com/",
      "Origin": "https://vk.com"
    };
    var out = [];
    var seen = {};

    function add(url, quality) {
      url = cleanMediaUrl(url);
      if (!url || url.indexOf("http") !== 0) return;
      if (seen[url]) return;
      seen[url] = 1;
      out.push({ url: url, quality: quality, headers: headers });
    }

    var hls = /"hls"\s*:\s*"(https?:[^"]+)"/.exec(html);
    if (hls) add(hls[1], "Auto");

    var re = /"url(\d{3,4})"\s*:\s*"(https?:[^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) add(m[2], m[1] + "p");

    var srcRe = /<source\s+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
    while ((m = srcRe.exec(html)) !== null) add(m[1], qualityFromUrl(m[1]));

    out.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
    return out;
  });
}

var OK_QUALITY = { mobile: "144p", lowest: "240p", low: "360p", sd: "480p", hd: "720p", full: "1080p", quad: "1440p", ultra: "2160p" };
function extractOk(embedUrl) {
  return fetchText(embedUrl, BASE + "/", EMBED_TIMEOUT).then(function (html) {
    var headers = { "User-Agent": UA, "Referer": "https://ok.ru/" };
    var m = /data-options\s*=\s*"([^"]+)"/.exec(html);
    if (!m) return [];
    try {
      var options = JSON.parse(decodeEntities(m[1]));
      var meta = options.flashvars && options.flashvars.metadata;
      if (typeof meta === "string") meta = JSON.parse(meta);
      if (!meta) return [];
      var out = [];
      (meta.videos || []).forEach(function (v) {
        if (v && v.url) out.push({ url: cleanMediaUrl(v.url), quality: OK_QUALITY[v.name] || "Auto", headers: headers });
      });
      var hls = meta.hlsManifestUrl || meta.ondemandHls || meta.hlsMasterPlaylistUrl;
      if (hls) out.push({ url: cleanMediaUrl(hls), quality: "Auto", headers: headers });
      return out;
    } catch (e) { return []; }
  });
}

function extractUqload(embedUrl) {
  return fetchText(embedUrl, BASE + "/", EMBED_TIMEOUT).then(function (html) {
    var origin = originOf(embedUrl);
    var headers = {
      "User-Agent": UA,
      "Referer": embedUrl,
      "Origin": origin,
      "Accept": "*/*"
    };
    var out = [];

    var m = /sources\s*:\s*\[\s*\{\s*["']?file["']?\s*:\s*["']([^"']+)["']/i.exec(html);
    if (m) {
      out.push({ url: cleanMediaUrl(m[1]), quality: "Auto", headers: headers });
      return out;
    }

    var srcM = /<source\s+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i.exec(html);
    if (srcM) {
      out.push({ url: cleanMediaUrl(srcM[1]), quality: qualityFromUrl(srcM[1]), headers: headers });
      return out;
    }

    var texts = [html].concat(unpackPacker(html));
    var seen = {};
    texts.forEach(function (t) {
      scanMediaUrls(t, embedUrl).forEach(function (u) {
        if (seen[u]) return;
        seen[u] = 1;
        out.push({ url: u, quality: qualityFromUrl(u), headers: headers });
      });
    });
    return out;
  });
}

function extractGeneric(embedUrl) {
  return fetchText(embedUrl, BASE + "/", EMBED_TIMEOUT).then(function (html) {
    var texts = [html].concat(unpackPacker(html));
    var urls = [];
    texts.forEach(function (t) {
      scanMediaUrls(t, embedUrl).forEach(function (u) {
        if (urls.indexOf(u) === -1) urls.push(u);
      });
    });
    var origin = originOf(embedUrl);
    var headers = { "User-Agent": UA, "Referer": origin + "/", "Origin": origin, "Accept": "*/*" };
    return urls.map(function (u) {
      var isHls = /\.m3u8/i.test(u);
      return { url: u, quality: isHls ? "Auto" : qualityFromUrl(u), headers: headers };
    });
  });
}

function resolveEmbed(embedUrl, label) {
  var host = hostOf(embedUrl);
  var job;

  if (/(^|\.)vk\.com$|vkvideo\.ru$/.test(host)) job = extractVk(embedUrl);
  else if (/(^|\.)ok\.ru$/.test(host)) job = extractOk(embedUrl);
  else if (/uqload/.test(host)) job = extractUqload(embedUrl);
  else job = extractGeneric(embedUrl);

  return job.then(function (items) {
    if (!items.length) return [];
    items.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
    var best = items[0];
    best.server = label;
    return [best];
  }).catch(function (e) {
    log("embed fail (" + label + "): " + (e && e.message));
    return [];
  });
}

// ═══════════════════════ Resolve ═══════════════════════

var SERVER_PRIORITY = ["vk", "vidspeed", "1vid", "uqload", "hgcloud", "listeamed"];

function serverPriority(label) {
  var l = String(label || "").toLowerCase();
  for (var i = 0; i < SERVER_PRIORITY.length; i++) {
    if (l.indexOf(SERVER_PRIORITY[i]) !== -1) return i;
  }
  return 999;
}

function resolveVid(vid, displayTitle) {
  var playUrl = BASE + "/play.php?vid=" + vid;
  var watchUrl = BASE + "/watch.php?vid=" + vid;
  log("play: " + playUrl);

  return fetchText(playUrl, BASE + "/").then(function (html) {
    var servers = parseServersFromPlayPage(html);
    if (servers.length) return servers;
    log("play.php had none - trying watch.php");
    return fetchText(watchUrl, BASE + "/").then(function (h2) {
      return parseServersFromPlayPage(h2);
    });
  }).then(function (servers) {
    if (!servers.length) { log("no servers available"); return []; }

    // Sort by reliability priority — VK first, then Vidspeed, 1vid, Uqload, etc.
    servers.sort(function (a, b) {
      return serverPriority(a.label) - serverPriority(b.label);
    });

    log("resolving ALL " + servers.length + " server(s) in parallel (MAX_SERVERS=" + MAX_SERVERS + " caps the visible list)");

    // Resolve EVERY server — nothing is skipped, so no source is ever missed.
    return Promise.all(servers.map(function (srv) {
      var label = srv.label || serverLabelFromUrl(srv.url, "Server " + srv.number);
      return resolveEmbed(srv.url, label).then(function (streams) {
        return { priority: serverPriority(label), label: label, streams: streams };
      });
    })).then(function (results) {
      // Drop servers that returned nothing
      var working = results.filter(function (r) { return r.streams.length > 0; });
      log("working servers: " + working.length + " (from " + results.length + " total)");

      // Apply MAX_SERVERS cap AFTER priority sort and AFTER filtering
      var capped = working.slice(0, MAX_SERVERS);

      // Flatten — 1 stream per server (best quality only)
      var out = [];
      var seen = {};
      capped.forEach(function (r) {
        r.streams.slice(0, 1).forEach(function (it) {
          if (seen[it.url]) return;
          seen[it.url] = 1;
          var q = it.quality || "Auto";
          out.push({
            name: PROVIDER_NAME + " " + it.server + (q !== "Auto" ? " " + q : ""),
            title: displayTitle + " • " + it.server + (q !== "Auto" ? " " + q : ""),
            url: it.url,
            quality: q,
            size: "Unknown",
            type: /\.m3u8/i.test(it.url) ? "hls" : "mp4",
            headers: it.headers,
            provider: PROVIDER_ID
          });
        });
      });

      log("returning " + out.length + " stream(s) from top " + capped.length + " server(s)");
      return out;
    });
  });
}

// ═══════════════════════ Movies ═══════════════════════

function getMovieStreams(meta, displayTitle) {
  return searchMany(meta, null, null).then(function (candidates) {
    if (!candidates.length) return [];
    var ranked = rankCandidates(candidates, meta, null, null);
    var top = ranked[0];
    log("top movie: " + top.entry.title + " (" + top.score.toFixed(3) + ")");
    if (top.score < MATCH_THRESHOLD) return [];

    var tried = {};
    var i = 0;
    function tryNext() {
      if (i >= Math.min(ranked.length, MAX_MOVIE_CANDIDATES)) return Promise.resolve([]);
      var cand = ranked[i++];
      if (tried[cand.entry.vid]) return tryNext();
      tried[cand.entry.vid] = 1;
      return resolveVid(cand.entry.vid, displayTitle).then(function (streams) {
        return streams.length ? streams : tryNext();
      });
    }
    return tryNext();
  });
}

// ═══════════════════════ Series ═══════════════════════

function getTvStreams(meta, season, episode, displayTitle) {
  return searchMany(meta, season, episode).then(function (candidates) {
    if (!candidates.length) return [];

    var ranked = rankCandidates(candidates, meta, season, episode);
    if (!ranked.length) return [];

    var tried = {};
    var i = 0;

    function tryNext() {
      if (i >= Math.min(ranked.length, MAX_EPISODE_CANDIDATES * 3)) return Promise.resolve([]);
      var cand = ranked[i++];
      if (tried[cand.entry.vid]) return tryNext();
      tried[cand.entry.vid] = 1;

      // Direct hit: the search result itself is the right episode
      if (cand.parsed.episode === episode &&
          (season === 1 ? (cand.parsed.season === 1 || cand.parsed.season === null)
                        : cand.parsed.season === season)) {
        return resolveVid(cand.entry.vid, displayTitle).then(function (streams) {
          return streams.length ? streams : tryNext();
        });
      }

      // Otherwise: get the episode list from the watch page
      return findEpisodeVid(cand.entry.url, meta, season, episode).then(function (epVid) {
        if (!epVid || tried[epVid]) return tryNext();
        tried[epVid] = 1;
        return resolveVid(epVid, displayTitle).then(function (streams) {
          return streams.length ? streams : tryNext();
        });
      });
    }
    return tryNext();
  });
}

// ═══════════════════════ Entry ═══════════════════════

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  var season = parseInt(seasonNum, 10) || 1;
  var episode = parseInt(episodeNum, 10) || 1;

  if (!TMDB_API_KEY || TMDB_API_KEY === "YOUR_TMDB_API_KEY") {
    log("TMDB_API_KEY not set");
    return Promise.resolve([]);
  }

  return fetchTmdb(tmdbId, type).then(function (data) {
    var meta = buildMeta(data, type);
    if (!meta.targets.length) { log("no usable titles"); return []; }

    var displayTitle = type === "tv"
      ? meta.displayTitle + " S" + pad2(season) + "E" + pad2(episode)
      : meta.displayTitle + (meta.year ? " (" + meta.year + ")" : "");

    log(type + ' "' + meta.displayTitle + '" lang=' + (meta.arabic ? "ar" : "en") + (meta.anime ? " [anime]" : ""));

    return type === "tv"
      ? getTvStreams(meta, season, episode, displayTitle)
      : getMovieStreams(meta, displayTitle);
  }).catch(function (err) {
    log("error: " + (err && err.message));
    return [];
  });
}

module.exports = { getStreams: getStreams };

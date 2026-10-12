var BASE = "https://larozaa.casa";
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
  var info = { ar: null, en: null, orig: null, lang: null };

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(r) { return r.json(); }).then(function(data) {
        var title = type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name);
        if (title && titles.indexOf(title) === -1) titles.push(title);
        if (lang === "ar") info.ar = title || null;
        if (lang === "en") info.en = title || null;
        var orig = type === "movie" ? data.original_title : data.original_name;
        if (orig && !info.orig) info.orig = orig;
        if (data.original_language && !info.lang) info.lang = data.original_language;
        if (!year) {
          var dateStr = type === "movie" ? data.release_date : data.first_air_date;
          if (dateStr) year = dateStr.slice(0, 4);
        }
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (!titles.length && !info.orig) throw new Error("Could not get TMDB titles for " + tmdbId);
    if (info.orig && titles.indexOf(info.orig) === -1) titles.push(info.orig);
    console.log("[Laroza] TMDB titles:", titles.join(" | "), "lang:", info.lang);
    return { titles: titles, year: year, ar: info.ar, en: info.en, orig: info.orig, lang: info.lang };
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
    name: " Laroza",
    title: label ? "Laroza \u2022 " + label : "Laroza",
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
    name: "Laroza",
    title: label ? "Laroza (Embed) \u2022 " + label : "Laroza (Embed)",
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

// Longer phrases first at match time. Spelling is already normalized (no hamza, ة→ه, ى→ي).
var SEASON_ORDINALS = [
  ["الحادي والعشرون", 21], ["الثاني والعشرون", 22], ["الثالث والعشرون", 23],
  ["الرابع والعشرون", 24], ["الخامس والعشرون", 25], ["السادس والعشرون", 26],
  ["السابع والعشرون", 27], ["الثامن والعشرون", 28], ["التاسع والعشرون", 29],
  ["الحادي عشر", 11], ["الثاني عشر", 12], ["الثالث عشر", 13], ["الرابع عشر", 14],
  ["الخامس عشر", 15], ["السادس عشر", 16], ["السابع عشر", 17], ["الثامن عشر", 18],
  ["التاسع عشر", 19], ["العشرون", 20], ["الثلاثون", 30],
  ["الاول", 1], ["الاولى", 1], ["الاولي", 1],
  ["الثاني", 2], ["الثانيه", 2],
  ["الثالث", 3], ["الثالثه", 3],
  ["الرابع", 4], ["الرابعه", 4],
  ["الخامس", 5], ["الخامسه", 5],
  ["السادس", 6], ["السادسه", 6],
  ["السابع", 7], ["السابعه", 7],
  ["الثامن", 8], ["الثامنه", 8],
  ["التاسع", 9], ["التاسعه", 9],
  ["العاشر", 10], ["العاشره", 10]
];

var TITLE_DROP = { مسلسل: 1, برنامج: 1, مترجم: 1, مترجمه: 1, مدبلج: 1, مدبلجه: 1 };

function normTitle(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(str) {
  return normTitle(str).split(" ").filter(function(t) { return t && !TITLE_DROP[t]; });
}

function toWesternDigits(str) {
  return String(str || "").replace(/[٠-٩]/g, function(d) {
    return String("٠١٢٣٤٥٦٧٨٩".indexOf(d));
  });
}

function stripTags(title) {
  var t = toWesternDigits(decodeHtml(title || ""));
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/مشاهدة\s*عائلية|عائلي(?:ة|ه)?|مترجم(?:ة|ه)?|مدبلج(?:ة|ه)?|أ?ون\s*لاين|HD/gi, " ");
  return t;
}

function splitHead(title) {
  var t = stripTags(title);
  var m = t.match(/الحلق[هةه]/);
  if (!m) return { head: t, episode: null };
  var head = t.slice(0, m.index);
  var tail = t.slice(m.index + m[0].length);
  var em = tail.match(/(\d{1,4})/);
  return { head: head, episode: em ? parseInt(em[1], 10) : null };
}

function ordinalNum(text) {
  var n = normTitle(text);
  var best = null;
  var bestLen = 0;
  for (var i = 0; i < SEASON_ORDINALS.length; i++) {
    var phrase = SEASON_ORDINALS[i][0];
    if (n.indexOf(phrase) !== -1 && phrase.length > bestLen) {
      best = SEASON_ORDINALS[i][1];
      bestLen = phrase.length;
    }
  }
  return best;
}

function removeSequence(tokens, seq) {
  if (!seq.length) return tokens.slice();
  for (var i = 0; i + seq.length <= tokens.length; i++) {
    var ok = true;
    for (var j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) { ok = false; break; }
    }
    if (ok) return tokens.slice(0, i).concat(tokens.slice(i + seq.length));
  }
  return tokens.slice();
}

function parseSeasonFromHead(head, query) {
  var md = head.match(/(?:الموسم|الجزء)\s*(\d{1,2})/);
  if (md) return { season: parseInt(md[1], 10), how: "marker-digit" };
  var mw = head.match(/(?:الموسم|الجزء)\s*([^\d|]{0,40})/);
  if (mw) {
    var num = ordinalNum(mw[1]);
    if (num) return { season: num, how: "marker-word" };
  }
  // "شباب البومب ج14" on hub titles
  var jt = titleTokens(head);
  for (var ji = 0; ji < jt.length; ji++) {
    var jm = jt[ji].match(/^ج(\d{1,2})$/);
    if (jm) {
      var jn = parseInt(jm[1], 10);
      if (jn >= 1 && jn <= 40) return { season: jn, how: "jeem" };
    }
  }
  var rest = removeSequence(titleTokens(head), titleTokens(query));
  var nums = [];
  rest.forEach(function(t) {
    if (!/^\d{1,4}$/.test(t)) return;
    var n = parseInt(t, 10);
    if (n >= 1900 && n <= 2099) return;
    if (n >= 1 && n <= 60) nums.push(n);
  });
  if (nums.length) return { season: nums[nums.length - 1], how: "bare" };
  return { season: null, how: "none" };
}

function labelOf(title, query) {
  var parts = splitHead(title);
  var parsed = parseSeasonFromHead(parts.head, query);
  var h = parts.head.replace(/(?:الموسم|الجزء)\s*\d{1,2}/g, " ");
  h = h.replace(/(?:الموسم|الجزء)\s+\S+(?:\s+\S+){0,2}/g, " ");
  var lab = normTitle(h);
  lab = lab.replace(/(^|\s)ج\d{1,2}(?=\s|$)/g, " ");
  if (parsed.season != null) {
    lab = lab.replace(new RegExp("(^|\\s)" + parsed.season + "(\\s|$)"), " ");
  }
  return lab.replace(/\s+/g, " ").trim();
}

function hasLatin(token) {
  return /[a-z]/.test(token);
}

// Latin shows are matched on their Latin words only, so an Arabic alias
// ("صراع العروش", "لعبة الحبار") can sit on either side. Extra Latin words
// are a different show: "Dead City", "Dark Matter", "Walter Boys".
// Arabic shows must match exactly unless a season was parsed, in which case
// a short subtitle is allowed ("الهيبة العودة", "اللعب مع الكبار").
var GENERIC_EXTRA = { جميع: 1, المواسم: 1, مواسم: 1, كامل: 1 };

function nameScore(label, query, allowSubtitle) {
  var nq = titleTokens(query);
  var nl = titleTokens(label);
  if (!nq.length || !nl.length) return 0;
  var qLatin = nq.some(hasLatin);
  var ql;
  var ll;
  if (qLatin) {
    ql = nq.filter(function(t) { return hasLatin(t) || /^\d{1,4}$/.test(t); });
    ll = nl.filter(function(t) { return hasLatin(t) || /^\d{1,4}$/.test(t); });
  } else {
    ql = nq.filter(function(t) { return !hasLatin(t); });
    ll = nl.filter(function(t) { return !hasLatin(t); });
  }
  if (!ql.length || !ll.length) return 0;
  if (ql.join(" ") === ll.join(" ")) return 1;
  if (!qLatin && ll.join(" ").indexOf(ql.join(" ") + " ") === 0) {
    var extras = ll.slice(ql.length);
    var generic = extras.length > 0;
    for (var i = 0; i < extras.length; i++) {
      if (!GENERIC_EXTRA[extras[i]]) { generic = false; break; }
    }
    // "جميع المواسم" is a catalog suffix, not a different show.
    if (generic) return 0.88;
    // Season subtitles ("الهيبة العودة") only after a season number was parsed.
    if (allowSubtitle && extras.length <= 4) return 0.9;
  }
  return 0;
}

function isMovieTitle(title) {
  var n = normTitle(title);
  return n.indexOf("فيلم") === 0 || n.indexOf("مشاهده فيلم") !== -1;
}

function isSeriesResult(title) {
  if (isMovieTitle(title)) return false;
  var n = normTitle(title);
  return n.indexOf("الحلق") !== -1 || n.indexOf("مسلسل") === 0 || n.indexOf("برنامج") === 0;
}

function titleFlags(title) {
  var n = normTitle(title);
  return {
    family: n.indexOf("عائلي") !== -1 ? 1 : 0,
    sub: n.indexOf("مترجم") !== -1 ? 1 : 0,
    dub: n.indexOf("مدبلج") !== -1 ? 1 : 0
  };
}

function tvQueryPlan(meta) {
  var lang = meta.lang || "ar";
  function uniq(arr) {
    var out = [];
    arr.forEach(function(x) {
      if (x && out.indexOf(x) === -1) out.push(x);
    });
    return out;
  }
  var primary;
  var secondary = [];
  if (lang === "ar") {
    primary = uniq([meta.ar, meta.orig]);
    if (meta.en && titleTokens(meta.en).length >= 2) secondary = [meta.en];
  } else {
    primary = uniq([meta.en, meta.orig]);
    if (meta.ar && (titleTokens(meta.ar).length >= 2 || normTitle(meta.ar).length >= 10)) secondary = [meta.ar];
  }
  var plan = [];
  primary.forEach(function(q) { plan.push({ q: q, weight: 2 }); });
  secondary.forEach(function(q) { plan.push({ q: q, weight: 1 }); });
  return plan;
}

function seriesIdsFromHtml(html) {
  var ids = [];
  function add(id) {
    if (id && ids.indexOf(id) === -1) ids.push(id);
  }
  // The "المسلسل" line is the real hub. Description links often point at an empty shell.
  var info = String(html || "").match(/fa-tv[\s\S]{0,600}?view-serie1\.php\?ser=([A-Za-z0-9]+)/i);
  if (info) {
    add(info[1]);
    return ids;
  }
  var re = /view-serie1\.php\?ser=([A-Za-z0-9]+)/gi;
  var m;
  while ((m = re.exec(html)) !== null) add(m[1]);
  return ids;
}

function parseHub(html) {
  var h1m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  var h1 = h1m ? stripHtml(h1m[1]) : "";
  var eps = [];
  var re = /<section class="ls-season-panel" id="ls-season-(\d+)"([\s\S]*?)(?=<section class="ls-season-panel"|$)/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var dataSeason = parseInt(m[1], 10);
    var body = m[2];
    var cre = /<article class="ls-card" data-episode="(\d+)">\s*<a href="([^"]+)" title="([^"]*)"/gi;
    var c;
    while ((c = cre.exec(body)) !== null) {
      var vm = c[2].match(/vid=([^&"']+)/);
      if (!vm) continue;
      eps.push({
        dataSeason: dataSeason,
        dataEpisode: parseInt(c[1], 10),
        vid: vm[1],
        title: decodeHtml(c[3])
      });
    }
  }
  return { h1: h1, eps: eps };
}

function hubMatchesPlan(hub, plan) {
  var h1 = hub.h1 || "";
  if (!normTitle(stripTags(h1))) return false;
  for (var i = 0; i < plan.length; i++) {
    var q = plan[i].q;
    var parsed = parseSeasonFromHead(stripTags(h1), q);
    if (nameScore(labelOf(h1, q), q, parsed.season != null) >= 0.84) return true;
  }
  return false;
}

function openHubs(picked, plan) {
  var hubs = {};
  var chain = Promise.resolve();
  picked.forEach(function(row) {
    chain = chain.then(function() {
      if (Object.keys(hubs).length >= 4) return;
      return fetchText(BASE + "/video.php?vid=" + encodeURIComponent(row.vid), BASE + "/").then(function(html) {
        var ids = seriesIdsFromHtml(html);
        var inner = Promise.resolve();
        ids.forEach(function(ser) {
          inner = inner.then(function() {
            if (hubs[ser] || Object.keys(hubs).length >= 4) return;
            return fetchText(BASE + "/view-serie1.php?ser=" + ser, BASE + "/").then(function(page) {
              var hub = parseHub(page);
              if (!hub.eps.length) return;
              if (!hubMatchesPlan(hub, plan)) return;
              hubs[ser] = { h1: hub.h1, eps: hub.eps, weight: row.weight, via: row.title };
              console.log("[Laroza] hub", hub.h1, "eps", hub.eps.length);
            }).catch(function(e) {
              console.log("[Laroza] hub failed", ser, e.message);
            });
          });
        });
        return inner;
      }).catch(function(e) {
        console.log("[Laroza] video page failed", row.vid, e.message);
      });
    });
  });
  return chain.then(function() { return hubs; });
}

function episodeNumbers(title) {
  var t = stripTags(title);
  var nums = [];
  var re = /الحلق[هةه]\D{0,16}(\d{1,4})/g;
  var m;
  while ((m = re.exec(t)) !== null) nums.push(parseInt(m[1], 10));
  return nums;
}

function bestTitleRead(title, plan) {
  var best = null;
  for (var i = 0; i < plan.length; i++) {
    var q = plan[i].q;
    var parts = splitHead(title);
    var parsed = parseSeasonFromHead(parts.head, q);
    var sc = nameScore(labelOf(title, q), q, parsed.season != null);
    if (!best || sc > best.sc) best = { sc: sc, parsed: parsed, parts: parts, q: q };
  }
  return best;
}

function chooseEpisode(hubs, plan, season, episode) {
  var cards = [];
  Object.keys(hubs).forEach(function(ser) {
    var hub = hubs[ser];
    hub.eps.forEach(function(ep) {
      var read = bestTitleRead(ep.title, plan);
      if (!read || read.sc < 0.84) return;
      var nums = episodeNumbers(ep.title);
      var epNo = nums.length ? nums[0] : (read.parts.episode != null ? read.parts.episode : ep.dataEpisode);
      var absNo = nums.length >= 2 && nums[nums.length - 1] !== nums[0] ? nums[nums.length - 1] : null;
      cards.push({
        ep: ep,
        hub: hub,
        read: read,
        epNo: epNo,
        absNo: absNo
      });
    });
  });
  // Osman-style titles carry two numbers: "الموسم الحلقة 4 | الحلقة 134".
  // The second is the absolute index. Season panel 1 also dumps that absolute
  // list and would otherwise answer S1E134. Drop those collisions.
  var claimedAbs = {};
  cards.forEach(function(c) {
    if (c.absNo != null && c.read.parsed.season != null && c.read.parsed.season >= 2) {
      claimedAbs[c.absNo] = c.read.parsed.season;
    }
  });
  var hits = [];
  cards.forEach(function(c) {
    var seasonOf = c.read.parsed.season;
    if (seasonOf == null) {
      if (!c.ep.dataSeason) return;
      if (c.ep.dataSeason === 1 && claimedAbs[c.epNo]) return;
      seasonOf = c.ep.dataSeason;
    }
    if (seasonOf !== season || c.epNo !== episode || !c.ep.vid) return;
    hits.push({
      vid: c.ep.vid,
      title: c.ep.title,
      h1: c.hub.h1,
      flags: titleFlags(c.ep.title),
      weight: c.hub.weight,
      parsedSeason: c.read.parsed.season,
      dataSeason: c.ep.dataSeason
    });
  });
  if (!hits.length) {
    console.log("[Laroza] no exact S" + season + "E" + episode);
    return null;
  }
  hits.sort(function(a, b) {
    if (a.flags.family !== b.flags.family) return a.flags.family - b.flags.family;
    var ad = a.flags.dub && !a.flags.sub ? 1 : 0;
    var bd = b.flags.dub && !b.flags.sub ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (b.weight !== a.weight) return b.weight - a.weight;
    var ap = a.parsedSeason === season ? 0 : 1;
    var bp = b.parsedSeason === season ? 0 : 1;
    return ap - bp;
  });
  return hits[0];
}

function findTvEpisode(meta, season, episode) {
  var plan = tvQueryPlan(meta);
  if (!plan.length) return Promise.resolve(null);
  console.log("[Laroza] TV queries:", plan.map(function(p) { return p.q; }).join(" | "));
  return Promise.all(plan.map(function(item) {
    return searchLaroza(item.q).then(function(rows) {
      return rows.map(function(r) {
        r.query = item.q;
        r.weight = item.weight;
        return r;
      });
    }).catch(function() { return []; });
  })).then(function(groups) {
    var found = [];
    var seen = {};
    groups.forEach(function(g) {
      g.forEach(function(r) {
        if (seen[r.vid] || !isSeriesResult(r.title)) return;
        var parsed = parseSeasonFromHead(splitHead(r.title).head, r.query);
        var sc = nameScore(labelOf(r.title, r.query), r.query, parsed.season != null);
        if (sc < 0.84) return;
        seen[r.vid] = 1;
        var seasonRank = parsed.season == null ? 1 : (parsed.season === season ? 0 : 2);
        found.push({
          vid: r.vid,
          title: r.title,
          query: r.query,
          weight: r.weight,
          score: sc,
          seasonRank: seasonRank,
          flags: titleFlags(r.title)
        });
      });
    });
    found.sort(function(a, b) {
      if (a.seasonRank !== b.seasonRank) return a.seasonRank - b.seasonRank;
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (b.score !== a.score) return b.score - a.score;
      if (a.flags.family !== b.flags.family) return a.flags.family - b.flags.family;
      var ad = a.flags.dub && !a.flags.sub ? 1 : 0;
      var bd = b.flags.dub && !b.flags.sub ? 1 : 0;
      return ad - bd;
    });
    var picked = [];
    var perQ = {};
    found.forEach(function(r) {
      perQ[r.query] = perQ[r.query] || 0;
      if (perQ[r.query] >= 3) return;
      perQ[r.query] += 1;
      picked.push(r);
    });
    console.log("[Laroza] TV name hits:", found.length, "opening", picked.length);
    return openHubs(picked, plan).then(function(hubs) {
      return chooseEpisode(hubs, plan, season, episode);
    });
  });
}

function getTvStreams(tmdbId, season, episode) {
  var wantedSeason = Number(season) || 1;
  var wantedEp = Number(episode) || 1;
  return getTmdbTitles(tmdbId, "tv").then(function(meta) {
    console.log("[Laroza] TV", meta.lang, "S" + wantedSeason + "E" + wantedEp);
    return findTvEpisode(meta, wantedSeason, wantedEp);
  }).then(function(hit) {
    if (!hit || !hit.vid) return [];
    console.log("[Laroza] TV matched:", hit.title);
    return resolveVid(hit.vid);
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
  getStreams: getStreams,
  findTvEpisode: findTvEpisode,
  getTmdbTitles: getTmdbTitles
};

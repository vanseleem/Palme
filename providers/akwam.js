var BASE = "https://akwam.ss";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MAX_SERVERS = 4;               /* one watch page per quality (1080p / 720p / 480p / ...) */
var MAX_CANDIDATE_PAGES = 4;
var MAX_QUERIES = 6;
var FETCH_TIMEOUT_MS = 8000;
/* First wave is the English title + the Arabic title. Extra alternate titles
   only run when that wave did not already find an obvious match. */
var FIRST_QUERY_WAVE = 2;
/* Akwam search lists NEWEST FIRST, 25 per page, so older titles (Friends, Psycho ...)
   sit on page 2+. Pages are fetched one level at a time, only until a match is accepted. */
var MAX_SEARCH_PAGES = 4;
var SEARCH_CONCURRENCY = 4;
/* after the first watch page returns links, wait at most this long for the other qualities */
var WATCH_GRACE_MS = 1500;

function log() {
  try {
    console.log.apply(console, ["[Akwam]"].concat(Array.prototype.slice.call(arguments)));
  } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

function encodeNonAscii(u) {
  return String(u).replace(/[^\x00-\x7F]+/g, function (run) {
    try { return encodeURIComponent(run); } catch (e) { return ""; }
  });
}

function withTimeout(promise, ms, label) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; reject(new Error("timeout " + label)); }
    }, ms);
    promise.then(function (v) {
      if (!done) { done = true; clearTimeout(timer); resolve(v); }
    }, function (e) {
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    });
  });
}

function fetchText(url, referer, attempt) {
  attempt = attempt || 0;
  var target = encodeNonAscii(url);
  var headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  if (referer) headers["Referer"] = encodeNonAscii(referer);
  var p = fetch(target, { headers: headers, redirect: "follow" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
  return withTimeout(p, FETCH_TIMEOUT_MS, target).catch(function (err) {
    var msg = String(err && err.message || err);
    /* a timeout retry just doubles the wait; a 404 will not appear on the second try */
    if (attempt < 1 && msg.indexOf("HTTP 404") === -1 && msg.indexOf("timeout") === -1) {
      return fetchText(url, referer, attempt + 1);
    }
    throw err;
  });
}

function getJson(url) {
  return fetchText(url).then(function (t) { return JSON.parse(t); }).catch(function () { return null; });
}

/* run fn over items with at most `limit` in flight; results keep the input order */
function mapPool(items, limit, fn) {
  var i = 0;
  var out = new Array(items.length);
  function worker() {
    if (i >= items.length) return Promise.resolve();
    var idx = i++;
    return fn(items[idx], idx).then(function (v) {
      out[idx] = v;
      return worker();
    });
  }
  var n = Math.max(1, Math.min(limit, items.length));
  var workers = [];
  for (var w = 0; w < n; w++) workers.push(worker());
  return Promise.all(workers).then(function () { return out; });
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function decodeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(str) {
  return decodeHtml(String(str || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/* Lower-case, strip accents/diacritics, fold Arabic letter variants, Arabic digits -> ASCII,
   everything that is not a letter/digit becomes a single space. */
function foldText(str) {
  var s = decodeHtml(str);
  try { if (s.normalize) s = s.normalize("NFD"); } catch (e) {}
  return s.toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064a")
    .replace(/\u06a9/g, "\u0643")
    .replace(/\u06cc/g, "\u064a")
    .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06f0-\u06f9]/g, function (d) { return String(d.charCodeAt(0) - 0x06f0); })
    .replace(/&/g, " and ")
    .replace(/['\u2019\u2018`\u00b4]/g, "")
    .replace(/[^a-z0-9\u0621-\u064a]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSet(str) {
  var o = {};
  String(str).split(/\s+/).forEach(function (w) { if (w) o[w] = 1; });
  return o;
}

/* words that are decoration on Akwam page titles (already folded) */
var NOISE = makeSet(
  "فيلم مسلسل افلام مسلسلات مترجم مترجمه مترجمين مدبلج مدبلجه اون لاين اونلاين مشاهده وتحميل تحميل " +
  "بجوده عاليه جوده انمي برنامج حصريا كامل كامله hd bluray webrip hdtv dvdrip 480p 720p 1080p 2160p 4k akwam اكوام"
);
var STOP_LAT = makeSet("the a an");
var ROMAN = { ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9" };

var AR_UNITS = {
  "الحادي": 1, "الاول": 1, "الاولي": 1, "اول": 1,
  "الثاني": 2, "الثانيه": 2, "الثالث": 3, "الثالثه": 3,
  "الرابع": 4, "الرابعه": 4, "الخامس": 5, "الخامسه": 5,
  "السادس": 6, "السادسه": 6, "السابع": 7, "السابعه": 7,
  "الثامن": 8, "الثامنه": 8, "التاسع": 9, "التاسعه": 9,
  "العاشر": 10, "العاشره": 10
};

/* season / part marker: الموسم الاول, الموسم 2, الجزء الثاني, الموسم الحادي عشر, season 3 */
var SEASON_RE_SRC = "(?:^|\\s)(?:الموسم|موسم|الجزء|جزء|season)\\s+([^\\s]+)(?:\\s+(عشر|عشره))?";

function ordinalValue(tok, tens) {
  if (/^\d+$/.test(tok)) return Number(tok);
  var v = AR_UNITS[tok];
  if (v == null) return null;
  return tens ? 10 + v : v;
}

function seasonOfFolded(f) {
  var m = new RegExp(SEASON_RE_SRC).exec(f);
  if (m) {
    var v = ordinalValue(m[1], !!m[2]);
    if (v != null) return v;
  }
  m = /(?:^|\s)s(\d{1,2})(?:\s|$)/.exec(f);
  return m ? Number(m[1]) : null;
}

function stripSeasonEpisode(f, isMovie) {
  f = f.replace(new RegExp(SEASON_RE_SRC, "g"), function (all, tok, tens) {
    var v = ordinalValue(tok, !!tens);
    if (v == null) return all;
    /* movies: "الجزء الثاني" is part of the name -> keep it as a number */
    return isMovie ? " " + v + " " : " ";
  });
  f = f.replace(/(?:^|\s)(?:الحلقه|حلقه|episode|ep)\s*\d+/g, " ");
  if (!isMovie) f = f.replace(/(?:^|\s)s\d{1,2}(?:\s*e\d{1,3})?(?=\s|$)/g, " ");
  return f.replace(/\s+/g, " ").trim();
}

function isNumTok(t) { return /^\d+$/.test(t); }
function isArTok(t) { return /[\u0621-\u064a]/.test(t); }

function tokenize(folded) {
  var raw = folded.split(" ").filter(Boolean);
  var out = raw.filter(function (w) { return !NOISE[w]; });
  if (!out.length) out = raw;
  var multi = out.length > 1;
  var res = out.map(function (w) {
    if (isArTok(w)) return (w.length >= 4 && w.indexOf("\u0627\u0644") === 0) ? w.slice(2) : w;
    if (multi && STOP_LAT[w]) return null;
    if (multi && ROMAN[w]) return ROMAN[w];
    return w;
  }).filter(Boolean);
  return res.length ? res : out;
}

function parseTitle(raw, isMovie) {
  var f = foldText(raw);
  var season = isMovie ? null : seasonOfFolded(f);
  var toks = tokenize(stripSeasonEpisode(f, isMovie));
  return { toks: toks, season: season };
}

function maxPlausibleYear() {
  try { return new Date().getFullYear() + 1; } catch (e) { return 2027; }
}

/* a trailing 19xx/20xx token is the release year (unless it is the whole title, e.g. "1917") */
function splitYear(toks) {
  if (toks.length > 1) {
    var last = toks[toks.length - 1];
    if (/^(19|20)\d\d$/.test(last) && Number(last) <= maxPlausibleYear()) {
      return { year: Number(last), rest: toks.slice(0, -1) };
    }
  }
  return { year: null, rest: toks };
}

function arrEq(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function toSet(a) { var o = {}; a.forEach(function (x) { o[x] = 1; }); return o; }
function setEq(a, b) {
  var sa = toSet(a), sb = toSet(b), k;
  for (k in sa) if (!sb[k]) return false;
  for (k in sb) if (!sa[k]) return false;
  return true;
}
function containsSeq(longer, shorter) {
  if (!shorter.length || shorter.length > longer.length) return false;
  for (var i = 0; i + shorter.length <= longer.length; i++) {
    var ok = true;
    for (var j = 0; j < shorter.length; j++) {
      if (longer[i + j] !== shorter[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/* compare only the part of the candidate written in the same script as the wanted title */
function filterByScript(C, T) {
  var tAr = T.some(isArTok);
  var tLat = T.some(function (t) { return !isArTok(t) && !isNumTok(t); });
  if (tAr && tLat) return C;
  return C.filter(function (t) {
    if (isNumTok(t)) return true;
    if (isArTok(t)) return tAr;
    return tLat;
  });
}

/*  1    identical token list
    0.97 same tokens, different order
    0.9  long titles (>=4 tokens) that differ by at most one word, same numbers
    0.8  movies only: one title contains the other (>=2 words, same numbers) - needs a matching year */
function compareTokens(C, T, isMovie) {
  if (!C.length || !T.length) return 0;
  if (arrEq(C, T)) return 1;
  if (setEq(C, T)) return 0.97;
  var numsC = C.filter(isNumTok), numsT = T.filter(isNumTok);
  var sc = toSet(C), st = toSet(T), inter = 0, uni = 0, k;
  for (k in st) { uni++; if (sc[k]) inter++; }
  for (k in sc) if (!st[k]) uni++;
  var jac = uni ? inter / uni : 0;
  if (T.length >= 4 && C.length >= 4 && jac >= 0.8 && Math.abs(C.length - T.length) <= 1 && setEq(numsC, numsT)) return 0.9;
  if (isMovie) {
    var shorter = C.length <= T.length ? C : T;
    var longer = C.length <= T.length ? T : C;
    var words = shorter.filter(function (x) { return !isNumTok(x); });
    if (words.length >= 2 && containsSeq(longer, shorter) && setEq(numsC, numsT)) return 0.8;
  }
  return 0;
}

/* best score of a candidate title against all known TMDB titles */
function scoreTitle(candRaw, tmdbTitles, isMovie, dropTokens) {
  var c = parseTitle(candRaw, isMovie);
  if (dropTokens) {
    var kept = c.toks.filter(function (t) { return !dropTokens[t]; });
    if (kept.length) c.toks = kept;
  }
  var ys = splitYear(c.toks);
  var variants = [{ toks: c.toks, year: null }];
  if (ys.year) variants.push({ toks: ys.rest, year: ys.year });
  var best = { score: 0, year: null };
  tmdbTitles.forEach(function (tt) {
    var t = parseTitle(tt, isMovie).toks;
    if (!t.length) return;
    variants.forEach(function (v) {
      var s = compareTokens(filterByScript(v.toks, t), t, isMovie);
      if (s > best.score) best = { score: s, year: v.year };
    });
  });
  return { score: best.score, year: best.year, season: c.season };
}

function looseOverlap(candRaw, titles) {
  var c = toSet(foldText(candRaw).split(" ").filter(function (w) { return w && !NOISE[w]; }));
  var best = 0;
  titles.forEach(function (t) {
    var tt = toSet(foldText(t).split(" ").filter(Boolean));
    var inter = 0, uni = 0, k;
    for (k in tt) { uni++; if (c[k]) inter++; }
    for (k in c) if (!tt[k]) uni++;
    if (uni && inter / uni > best) best = inter / uni;
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* TMDB                                                                */
/* ------------------------------------------------------------------ */

function getMeta(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var isMovie = type === "movie";
  var base = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY;
  return Promise.all([
    getJson(base + "&language=ar"),
    getJson(base + "&language=en-US&append_to_response=alternative_titles")
  ]).then(function (r) {
    var ar = r[0], en = r[1];
    if (!ar && !en) throw new Error("TMDB lookup failed for " + tmdbId);
    var titles = [];
    var seen = {};
    function add(t) {
      if (!t) return;
      t = String(t).trim();
      var k = foldText(t);
      if (!t || !k || seen[k]) return;
      seen[k] = 1;
      titles.push(t);
    }
    [en, ar].forEach(function (d) { if (d) add(isMovie ? d.title : d.name); });
    [en, ar].forEach(function (d) { if (d) add(isMovie ? d.original_title : d.original_name); });
    var alts = (en && en.alternative_titles) ? (en.alternative_titles.titles || en.alternative_titles.results || []) : [];
    var added = 0;
    alts.forEach(function (a) {
      if (added < 4 && a && a.title && /[\u0600-\u06FF]/.test(a.title)) {
        var before = titles.length;
        add(a.title);
        if (titles.length > before) added++;
      }
    });
    var d = en || ar;
    var dateStr = isMovie ? d.release_date : d.first_air_date;
    var year = dateStr ? Number(String(dateStr).slice(0, 4)) : null;
    if (!titles.length) throw new Error("No usable TMDB titles for " + tmdbId);
    log("TMDB titles:", titles.join(" | "), "year:", year || "?");
    var oc = (!isMovie && d.origin_country && d.origin_country[0]) ? String(d.origin_country[0]).toUpperCase() : "";
    var dropTokens = oc === "US" ? makeSet("us usa") : (oc === "GB" ? makeSet("uk") : null);
    return { titles: titles, year: year, title: titles[0], isMovie: isMovie, dropTokens: dropTokens, cache: {} };
  });
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function buildQueries(meta) {
  var qs = [], seen = {};
  function add(q) {
    q = String(q || "")
      .replace(/[:\u060C-\u061F]/g, " ")
      .replace(/\s+-\s+|\s+[\u2013\u2014]\s+/g, " ")
      .replace(/\s+/g, " ").trim();
    var k = foldText(q);
    if (!q || !k || seen[k]) return;
    seen[k] = 1;
    qs.push(q);
  }
  meta.titles.slice(0, 4).forEach(function (t) {
    add(t);
    var head = String(t).split(/\s*[:\u2013\u2014]\s+|\s+-\s+/)[0];
    if (head && head !== t && foldText(head).length >= 3) add(head);
  });
  return qs.slice(0, MAX_QUERIES);
}

function slugTitle(url) {
  var m = String(url).match(/\/(?:movie|series|shows?)\/[^\/]+\/([^?#"']+)/i);
  if (!m) return "";
  var t = m[1];
  try { t = decodeURIComponent(t); } catch (e) {}
  return t.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractSearchResults(html) {
  var map = {}, order = [];
  var re = /<a\b([^>]*?)href=["']([^"']*\/(movie|series|shows?)\/([^"'\/?#]+)[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var attrs = (m[1] || "") + " " + (m[5] || "");
    var url = decodeHtml(m[2]);
    var kind = m[3].toLowerCase() === "movie" ? "movie" : "series";
    var key = kind + "/" + m[4];
    var block = m[6];
    var title = "";
    var tm = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
      block.match(/class=["'][^"']*(?:entry-title|title|text-white)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    if (tm) title = stripHtml(tm[1]);
    if (!title || title === "-->" || title.length < 2) {
      var at = attrs.match(/\btitle=["']([^"']+)["']/i) || block.match(/<img\b[^>]*\balt=["']([^"']+)["']/i);
      if (at) title = stripHtml(at[1]);
    }
    var weak = false;
    if (!title || title === "-->" || title.length < 2) {
      title = slugTitle(url);
      weak = true;
    }
    if (!title || title.length < 2) continue;
    var absolute = /^https?:/i.test(url) ? url : (url.indexOf("//") === 0 ? "https:" + url : BASE + url);
    if (!map[key]) {
      map[key] = { url: absolute, title: title, kind: kind, key: m[4], weak: weak };
      order.push(map[key]);
    } else if (map[key].weak && !weak) {
      map[key].title = title;
      map[key].weak = false;
    }
  }
  return order;
}

/* highest page number the pager links to ("search?q=X&page=2" or "search?q=X&amp;page=2") */
function lastPageOf(html) {
  var max = 1, m, re = /\/search\?[^"'\s]*?\bpage=(\d+)/gi;
  while ((m = re.exec(html)) !== null) {
    var n = Number(m[1]);
    if (n > max && n < 200) max = n;
  }
  return max;
}

function searchAkwam(query, page) {
  page = page || 1;
  var url = BASE + "/search?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  log("Search:", url);
  return fetchText(url, BASE + "/").then(function (html) {
    var results = extractSearchResults(html);
    var last = lastPageOf(html);
    log("Search results for", query + " (p" + page + "/" + last + "):", results.length);
    return { results: results, lastPage: last };
  }).catch(function (err) {
    log("Search failed:", query, "p" + page, err && err.message);
    return { results: [], lastPage: page };
  });
}

/* Search in levels. Level 1 = page 1 of the two main titles. If nothing is accepted, level 2 =
   page 2 of those + page 1 of the alternate titles, and so on (max MAX_SEARCH_PAGES).
   After every level the real accept test runs, so we stop as soon as the right page is found.
   Loose fuzzy matching is only allowed on the last level. */
function findMatch(meta, isTv, wantSeason) {
  var queries = buildQueries(meta);
  var map = {}, all = [], lastPage = {};

  function absorb(group) {
    (group || []).forEach(function (r) {
      var k = r.kind + "/" + r.key;
      if (!map[k]) { map[k] = r; all.push(r); }
      else if (map[k].weak && !r.weak) { map[k].title = r.title; map[k].weak = false; }
    });
  }

  function tasksFor(level) {
    var tasks = [];
    queries.forEach(function (q, qi) {
      var page = qi < FIRST_QUERY_WAVE ? level : level - 1;
      if (page < 1 || page > MAX_SEARCH_PAGES) return;
      if (page > 1 && !(lastPage[qi] >= page)) return;
      tasks.push({ qi: qi, q: q, page: page });
    });
    return tasks;
  }

  function step(level) {
    var tasks = tasksFor(level);
    if (!tasks.length) return Promise.resolve(null);
    return mapPool(tasks, SEARCH_CONCURRENCY, function (t) {
      return searchAkwam(t.q, t.page).then(function (r) {
        lastPage[t.qi] = Math.max(lastPage[t.qi] || 0, r.lastPage);
        absorb(r.results);
        return r;
      });
    }).then(function () {
      var more = level < MAX_SEARCH_PAGES && tasksFor(level + 1).length > 0;
      var pick = isTv ? pickSeries(all, meta, wantSeason, !more) : pickMovie(all, meta, !more);
      return pick.then(function (picked) {
        log("Search level", level, "candidates:", all.length, picked ? "-> match" : (more ? "-> deeper" : "-> none"));
        if (picked || !more) return picked;
        return step(level + 1);
      });
    });
  }

  return step(1);
}

/* ------------------------------------------------------------------ */
/* Candidate pages                                                     */
/* ------------------------------------------------------------------ */

/* "السنة : 1960" is what movie / season / episode pages use */
var YEAR_LABEL_RE = /(?:السنة|سنة\s*(?:الإنتاج|الانتاج|الاصدار|الإصدار)|تاريخ\s*(?:الإصدار|الاصدار|العرض)|release\s*date)[\s\S]{0,100}?\b((?:19|20)\d{2})\b/i;

function parsePage(url, html) {
  var h = html.match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  var t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  var yl = html.match(YEAR_LABEL_RE);
  return {
    url: url,
    html: html,
    title: stripHtml(h ? h[1] : (t ? t[1] : "")),
    labelYear: yl ? Number(yl[1]) : null
  };
}

/* every candidate page is downloaded once per lookup, even when several search levels see it */
function getPage(url, meta) {
  var cache = meta.cache || (meta.cache = {});
  if (!cache[url]) {
    cache[url] = fetchText(url, BASE + "/").then(function (html) { return parsePage(url, html); });
    cache[url].catch(function () { delete cache[url]; });
  }
  return cache[url];
}

function loadCandidate(x, meta, isMovie) {
  return getPage(x.r.url, meta).then(function (page) {
    var ps = page.title ? scoreTitle(page.title, meta.titles, isMovie, meta.dropTokens) : { score: 0, year: null, season: null };
    var card = x.s || { score: 0, year: null, season: null };
    return {
      r: x.r,
      i: x.i,
      page: page,
      title: page.title || x.r.title,
      score: ps.score > 0 ? ps.score : card.score,
      year: ps.year || page.labelYear || card.year || null,
      season: ps.season != null ? ps.season : card.season
    };
  }).catch(function (err) {
    log("Candidate page failed:", x.r.url, err && err.message);
    return null;
  });
}

function cmpScore(a, b) { return (b.s.score - a.s.score) || (a.i - b.i); }
function yearDiff(a, b) { return (a && b) ? Math.abs(Number(a) - Number(b)) : 99; }

function movieAccept(score, year, metaYear) {
  if (score < 0.8) return false;
  if (year && metaYear) {
    var d = yearDiff(year, metaYear);
    /* same title, years a bit apart: still the same film when the title matches exactly */
    return d <= 1 || (d <= 3 && score >= 0.97);
  }
  return score >= 0.97;
}

function pickMovie(results, meta, allowLoose) {
  var list = results.filter(function (r) { return r.kind === "movie"; });
  var scored = list.map(function (r, i) { return { r: r, i: i, s: scoreTitle(r.title, meta.titles, true) }; });
  var cands = scored.filter(function (x) { return x.s.score >= 0.8; }).sort(cmpScore).slice(0, MAX_CANDIDATE_PAGES);
  if (!cands.length && allowLoose) {
    /* card titles can be truncated: confirm the closest few on their real page title */
    cands = scored.map(function (x) { x.loose = looseOverlap(x.r.title, meta.titles); return x; })
      .filter(function (x) { return x.loose >= 0.3; })
      .sort(function (a, b) { return (b.loose - a.loose) || (a.i - b.i); })
      .slice(0, 3);
  }
  if (!cands.length) return Promise.resolve(null);
  return Promise.all(cands.map(function (x) { return loadCandidate(x, meta, true); })).then(function (loaded) {
    var ok = loaded.filter(function (c) {
      if (!c) return false;
      var pass = movieAccept(c.score, c.year, meta.year);
      log("Movie candidate:", c.title, "score:", c.score.toFixed(2), "year:", c.year || "?", pass ? "OK" : "rejected");
      return pass;
    });
    ok.sort(function (a, b) {
      return (b.score - a.score) || (yearDiff(a.year, meta.year) - yearDiff(b.year, meta.year)) || (a.i - b.i);
    });
    return ok[0] || null;
  });
}

function seriesAccept(c, meta, wantSeason) {
  if (c.score < 0.9) return false;
  if (c.season != null) {
    if (c.season !== wantSeason) return false;
  } else {
    if (wantSeason !== 1) return false;               /* never serve an unnumbered page as season 2+ */
    if (c.year && meta.year && c.year > meta.year + 1) return false;   /* it is a later season */
  }
  if (c.year && meta.year && c.year < meta.year - 1) return false;     /* older show with the same name */
  return true;
}

function pickSeries(results, meta, wantSeason, allowLoose) {
  var list = results.filter(function (r) { return r.kind === "series"; });
  var scored = list.map(function (r, i) { return { r: r, i: i, s: scoreTitle(r.title, meta.titles, false, meta.dropTokens) }; });
  var plausible = scored.filter(function (x) { return x.s.score >= 0.9; });
  var exact = plausible.filter(function (x) { return x.s.season === wantSeason; }).sort(cmpScore);
  var unnumbered = plausible.filter(function (x) { return x.s.season == null; }).sort(cmpScore);
  var cands = exact.length ? exact.slice(0, MAX_CANDIDATE_PAGES)
    : unnumbered.slice(0, wantSeason === 1 ? MAX_CANDIDATE_PAGES : 2);
  if (!cands.length && allowLoose) {
    cands = scored.map(function (x) { x.loose = looseOverlap(x.r.title, meta.titles); return x; })
      .filter(function (x) { return x.loose >= 0.3 && (x.s.season == null || x.s.season === wantSeason); })
      .sort(function (a, b) { return (b.loose - a.loose) || (a.i - b.i); })
      .slice(0, 3);
  }
  if (!cands.length) return Promise.resolve(null);
  return Promise.all(cands.map(function (x) { return loadCandidate(x, meta, false); })).then(function (loaded) {
    var ok = loaded.filter(function (c) {
      if (!c) return false;
      var pass = seriesAccept(c, meta, wantSeason);
      log("Series candidate:", c.title, "score:", c.score.toFixed(2), "season:", c.season == null ? "-" : c.season, pass ? "OK" : "rejected");
      return pass;
    });
    ok.sort(function (a, b) {
      var ae = a.season === wantSeason ? 1 : 0, be = b.season === wantSeason ? 1 : 0;
      /* equal score + season: prefer the page whose year is closest to TMDB's */
      return (b.score - a.score) || (be - ae) ||
        (yearDiff(a.year, meta.year) - yearDiff(b.year, meta.year)) || (a.i - b.i);
    });
    return ok[0] || null;
  });
}

/* ------------------------------------------------------------------ */
/* Episodes                                                            */
/* ------------------------------------------------------------------ */

var EP_RE_SRC = "(?:الحلقه|حلقه|episode|ep)\\s*";

function epNumberOf(str) {
  var f = foldText(str);
  var m = new RegExp(EP_RE_SRC + "(\\d{1,4})(?=\\s|$)").exec(f) || /(?:^|\s)s\d{1,2}\s*e(\d{1,4})(?=\s|$)/.exec(f);
  return m ? Number(m[1]) : null;
}

function epPrefixOf(str) {
  return foldText(str).split(new RegExp(EP_RE_SRC + "\\d"))[0].trim();
}

function parseEpisodeLinks(html) {
  var out = [], seen = {};
  function add(href, text) {
    var url = decodeHtml(href);
    var abs = /^https?:/i.test(url) ? url : (url.indexOf("//") === 0 ? "https:" + url : BASE + url);
    if (seen[abs]) {
      if (text && !seen[abs].text) seen[abs].text = text;
      return;
    }
    var idm = abs.match(/\/episode\/(\d+)/);
    var slug = abs.replace(/^.*\/episode\/\d+\/?/, "");
    try { slug = decodeURIComponent(slug); } catch (e) {}
    seen[abs] = { url: abs, id: idm ? Number(idm[1]) : 0, slug: slug, text: text || "" };
    out.push(seen[abs]);
  }
  var re = /<a\b[^>]*href=["']([^"']*\/episode\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) add(m[1], stripHtml(m[2]));
  var re2 = /href=["']([^"']*\/episode\/[^"']+)["']/gi;
  while ((m = re2.exec(html)) !== null) add(m[1], "");
  out.forEach(function (l) {
    var n = epNumberOf(l.slug);
    var base = l.slug;
    if (n == null && l.text) {
      n = epNumberOf(l.text);
      /* number lives in the anchor text ("حلقة 3"), not the slug, so the
         series prefix has to come from that text too — otherwise every
         episode title becomes its own group and only episode 1 is kept */
      if (n != null) base = l.text;
    }
    l.ep = n;
    l.prefix = epPrefixOf(base);
  });
  return out;
}

function tokenJaccard(a, b) {
  var sa = toSet(String(a).split(" ").filter(Boolean)), sb = toSet(String(b).split(" ").filter(Boolean));
  var inter = 0, uni = 0, k;
  for (k in sa) { uni++; if (sb[k]) inter++; }
  for (k in sb) if (!sa[k]) uni++;
  return uni ? inter / uni : 0;
}

function pickEpisode(links, wanted, hintTitle) {
  var withN = links.filter(function (l) { return l.ep != null; });
  if (withN.length) {
    /* keep only the episodes of THIS series: the page also lists "latest/related" episodes of others */
    var hint = foldText(hintTitle || "");
    var counts = {};
    withN.forEach(function (l) { counts[l.prefix] = (counts[l.prefix] || 0) + 1; });
    var bestPrefix = null, bestScore = -1;
    Object.keys(counts).forEach(function (p) {
      var sc = counts[p] + (hint && tokenJaccard(p, hint) >= 0.8 ? 1000 : 0);
      if (sc > bestScore) { bestScore = sc; bestPrefix = p; }
    });
    var main = withN.filter(function (l) { return l.prefix === bestPrefix; });
    if (main.length < 2 && !(hint && tokenJaccard(bestPrefix, hint) >= 0.8)) {
      main = withN;
    }
    var hit = main.filter(function (l) { return l.ep === wanted; });
    if (!hit.length) hit = withN.filter(function (l) { return l.ep === wanted; });
    if (!hit.length) {
      log("Episode", wanted, "not on page. Available:", withN.map(function (l) { return l.ep; }).sort(function (a, b) { return a - b; }).join(","));
      return null;
    }
    hit.sort(function (a, b) {
      var ja = tokenJaccard(foldText(a.text || a.slug), hint);
      var jb = tokenJaccard(foldText(b.text || b.slug), hint);
      if (jb !== ja) return jb - ja;
      return a.id - b.id;
    });
    return hit[0];
  }
  /* no number in any link: fall back to position by id */
  var byId = links.slice().sort(function (a, b) { return a.id - b.id; });
  return byId[wanted - 1] || null;
}

/* ------------------------------------------------------------------ */
/* Streams                                                             */
/* ------------------------------------------------------------------ */

function extractWatchUrls(html) {
  var urls = [], seen = {};
  var re = /href=["']([^"']*\/watch\/[^"']+)["']/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = decodeHtml(m[1]);
    var abs = /^https?:/i.test(url) ? url : (url.indexOf("//") === 0 ? "https:" + url : BASE + url);
    if (!seen[abs]) { seen[abs] = 1; urls.push(abs); }
  }
  return urls.slice(0, MAX_SERVERS);
}

var QUALITY_TIERS = [
  { rank: 7, label: "2160p", re: /4k|uhd|2160/i },
  { rank: 6, label: "1440p", re: /1440|qhd/i },
  { rank: 5, label: "1080p", re: /1080|fhd/i },
  { rank: 4, label: "720p", re: /720|\bhd\b/i },
  { rank: 4, label: "Auto", re: /auto/i },
  { rank: 3, label: "480p", re: /480/i },
  { rank: 2, label: "360p", re: /360/i },
  { rank: 1, label: "240p", re: /240/i }
];

function qualityTier(quality) {
  var q = String(quality || "");
  for (var i = 0; i < QUALITY_TIERS.length; i++) {
    if (QUALITY_TIERS[i].re.test(q)) return QUALITY_TIERS[i];
  }
  return { rank: 0, label: null };
}

function hostOf(url) {
  var m = String(url || "").match(/^(?:https?:)?\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase() : String(url || "");
}

/* same file = same host + same file name (query strings / tokens ignored when there is a clean path) */
function mediaKey(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/?#]+)(?:\/[^?#]*)?\/([^\/?#]+)$/i);
  if (!m) return String(url || "");
  var name = m[2];
  try { name = decodeURIComponent(name); } catch (e) {}
  return m[1].toLowerCase() + "|" + name.toLowerCase();
}

function normalizeMediaUrl(u) {
  u = decodeHtml(u).trim().split("#")[0];
  if (!u || /^(javascript|data|blob):/i.test(u)) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return BASE + u;
  return /^https?:/i.test(u) ? u : "";
}

function extractSources(html) {
  var streams = [], seen = {};
  function push(rawUrl, quality) {
    var url = normalizeMediaUrl(rawUrl);
    if (!url || seen[url]) return;
    seen[url] = 1;
    if (!quality) {
      var qm = url.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240)p?(?:[^0-9]|$)/i);
      quality = qm ? qm[1] : "";
    }
    streams.push({ url: url, quality: quality || "Unknown" });
  }
  var re = /<source\b[^>]*>/gi, tag;
  while ((tag = re.exec(html)) !== null) {
    var s = tag[0];
    var src = s.match(/\bsrc=["']([^"']+)["']/i);
    if (!src) continue;
    var q = s.match(/\b(?:size|label|res|data-res|data-quality|title)=["']([^"']+)["']/i);
    push(src[1], q ? q[1] : "");
  }
  var vre = /<video\b[^>]*\bsrc=["']([^"']+)["']/gi, vm;
  while ((vm = vre.exec(html)) !== null) push(vm[1], "");
  var fre = /["']?file["']?\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi, fm;
  while ((fm = fre.exec(html)) !== null) push(fm[1], "");
  /* the page also prints the direct file link (used by its VLC / MX Player buttons) */
  var dre = /href=["'](https?:\/\/[^"']+\.(?:mp4|m3u8|mkv)(?:\?[^"']*)?)["']/gi, dm;
  while ((dm = dre.exec(html)) !== null) push(dm[1], "");
  return streams;
}

/* ------------------------------------------------------------------ */
/* Streams returned to Nuvio                                               */
/* ------------------------------------------------------------------ */

/* 720p first: these are full BluRay MP4s and 1080p/4K usually cannot keep
   up with Akwam's CDN, so the player sits on the buffer. 480p is the smooth
   fallback. Higher qualities stay in the list for fast connections. */
function playRank(quality) {
  var label = qualityTier(quality).label;
  if (label === "720p") return 60;
  if (label === "480p") return 50;
  if (label === "1080p") return 40;
  if (label === "360p") return 30;
  if (label === "Auto") return 25;
  if (label === "240p") return 20;
  if (label === "1440p") return 10;
  if (label === "2160p") return 0;
  return 15;
}

function streamObject(src) {
  var tier = qualityTier(src.quality);
  var label = tier.label || "Unknown";
  var hls = /\.m3u8(?:[?#]|$)/i.test(src.url);
  var referer = src.referer || (BASE + "/");
  var headers = { "User-Agent": UA, "Referer": referer };
  var title = label === "Unknown" ? "Akwam" : "Akwam " + label;
  if (src.prettySize) title += " \u00b7 " + src.prettySize;
  return {
    name: "Akwam",
    title: title,
    url: src.url,
    quality: label,
    type: hls ? "hls" : "mp4",
    headers: headers,
    provider: "akwam",
    behaviorHints: {
      notWebReady: true,
      bingeGroup: "akwam-" + label,
      proxyHeaders: { request: headers }
    }
  };
}

/* drop exact duplicates (same file listed on several watch pages) */
function dedupeSources(sources) {
  var out = [], byKey = {};
  sources.forEach(function (s) {
    if (!s || !s.url) return;
    var label = qualityTier(s.quality).label;
    var k = mediaKey(s.url) + "|" + (label || "?");
    var prev = byKey[k];
    if (!prev) { byKey[k] = s; out.push(s); }
    else if (!qualityTier(prev.quality).label && label) prev.quality = s.quality;
  });
  return out;
}

/* one entry per host + quality */
function toStreams(list) {
  var out = [], seen = {};
  list.forEach(function (s) {
    var label = qualityTier(s.quality).label;
    var key = label ? hostOf(s.url) + "|" + label : s.url;
    if (seen[key]) return;
    seen[key] = 1;
    out.push(streamObject(s));
  });
  return out;
}

function byPlay(a, b) {
  return (playRank(b.quality) - playRank(a.quality)) || (a._i - b._i);
}

function finalizeStreams(sources) {
  var uniq = dedupeSources(sources);
  uniq.forEach(function (s, i) { s._i = i; });
  uniq.sort(byPlay);
  return toStreams(uniq);
}

/* quality tabs on a title/episode page, in order: [1080p, 720p, 480p] */
function tabLabels(html) {
  var labels = [], m, t;
  var re = /<a\b[^>]*href=["']#tab-\d+["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    t = stripHtml(m[1]);
    if (t) labels.push(t);
  }
  return labels;
}

/* sizes printed on the page, in the same order as the quality tabs */
function extractSizeMap(html) {
  var labels = tabLabels(html), sizes = [], m, t;
  var reS = /class=["'][^"']*font-size-14[^"']*["'][^>]*>([\s\S]*?)</gi;
  while ((m = reS.exec(html)) !== null) {
    t = stripHtml(m[1]);
    if (t && /\d/.test(t) && /[MG]B|جيجا|ميجا/i.test(t)) sizes.push(t);
  }
  var map = {};
  var n = Math.min(labels.length, sizes.length);
  for (var i = 0; i < n; i++) {
    var label = qualityTier(labels[i]).label;
    if (label && !map[label]) map[label] = sizes[i];
  }
  return map;
}

/* The title / episode page lists one watch page PER QUALITY (tabs: 1080p, 720p, 480p, in the same
   order as the watch links) and each watch page only plays its own quality. So the first page
   alone would give just 1080p (the biggest file) - fetch them all in parallel, and don't wait
   long for stragglers once something is available. */
function collectStreams(html, pageUrl) {
  var urls = extractWatchUrls(html);
  var labels = tabLabels(html);
  var sizes = extractSizeMap(html);
  log("Watch pages:", urls.length, "tabs:", labels.join(","));
  if (!urls.length) return Promise.resolve({ watchCount: 0, streams: [] });

  return new Promise(function (resolve) {
    var found = [], pending = urls.length, finished = false, grace = null;
    function done() {
      if (finished) return;
      finished = true;
      if (grace) { try { clearTimeout(grace); } catch (e) {} }
      var streams = finalizeStreams(found);
      log("Sources:", found.length, "streams:", streams.map(function (s) { return s.quality; }).join(","));
      resolve({ watchCount: urls.length, streams: streams });
    }
    function distinctQualities() {
      var seen = {}, n = 0;
      found.forEach(function (s) {
        var l = qualityTier(s.quality).label || s.url;
        if (!seen[l]) { seen[l] = 1; n++; }
      });
      return n;
    }
    urls.forEach(function (w, idx) {
      fetchText(w, pageUrl).then(function (wh) {
        var src = extractSources(wh);
        var pageSizes = extractSizeMap(wh);
        src.forEach(function (s) {
          s.referer = w;
          /* quality from the tab that points at this watch page, if the file itself does not say */
          if (!qualityTier(s.quality).label && labels[idx]) s.quality = labels[idx];
          var label = qualityTier(s.quality).label;
          var size = label && (sizes[label] || pageSizes[label]);
          if (size) s.prettySize = size;
          found.push(s);
        });
        if (src.length) {
          if (distinctQualities() >= urls.length) return done();
          if (!grace && typeof setTimeout === "function") grace = setTimeout(done, WATCH_GRACE_MS);
        }
      }).catch(function (err) {
        log("Watch page failed:", w, err && err.message);
      }).then(function () {
        pending--;
        if (pending <= 0) done();
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Main flow                                                           */
/* ------------------------------------------------------------------ */

function resolve(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv";
  var wantSeason = Number(season) || 1;
  var wantEpisode = Number(episode) || 1;
  var out = { picked: null, episodeUrl: null, watchCount: 0, streams: [], reason: "" };
  var started = Date.now();
  return getMeta(tmdbId, isTv ? "tv" : "movie").then(function (meta) {
    out.meta = meta;
    return findMatch(meta, isTv, wantSeason).then(function (picked) {
      if (!picked) { out.reason = "NO_MATCH"; out.ms = Date.now() - started; return out; }
      out.picked = { url: picked.page.url, title: picked.title, score: picked.score, year: picked.year, season: picked.season };
      log("SELECTED:", picked.title, picked.page.url, "score:", picked.score.toFixed(2));
      if (!isTv) {
        return collectStreams(picked.page.html, picked.page.url).then(function (r) {
          out.watchCount = r.watchCount; out.streams = r.streams;
          if (!r.streams.length) out.reason = r.watchCount ? "NO_LINKS" : "NO_WATCH_PAGES";
          out.ms = Date.now() - started;
          return out;
        });
      }
      var links = parseEpisodeLinks(picked.page.html);
      log("Episode links:", links.length);
      var ep = pickEpisode(links, wantEpisode, picked.title);
      if (!ep) { out.reason = "NO_EPISODE"; out.ms = Date.now() - started; return out; }
      out.episodeUrl = ep.url;
      return fetchText(ep.url, picked.page.url).then(function (epHtml) {
        return collectStreams(epHtml, ep.url);
      }).then(function (r) {
        out.watchCount = r.watchCount; out.streams = r.streams;
        if (!r.streams.length) out.reason = r.watchCount ? "NO_LINKS" : "NO_WATCH_PAGES";
        out.ms = Date.now() - started;
        return out;
      });
    });
  }).catch(function (err) {
    out.reason = "ERROR: " + (err && err.message);
    out.ms = Date.now() - started;
    log("Error:", out.reason);
    return out;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  log("getStreams:", tmdbId, mediaType, season, episode);
  return resolve(tmdbId, mediaType, season, episode).then(function (r) {
    log("Result:", r.reason || "OK", "streams:", r.streams.length, "in", ((r.ms || 0) / 1000).toFixed(1) + "s");
    return r.streams;
  }).catch(function () { return []; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams,
    _resolve: resolve,
    _internals: {
      scoreTitle: scoreTitle,
      foldText: foldText,
      extractSearchResults: extractSearchResults,
      lastPageOf: lastPageOf,
      parseEpisodeLinks: parseEpisodeLinks,
      pickEpisode: pickEpisode,
      extractSources: extractSources,
      finalizeStreams: finalizeStreams,
      buildQueries: buildQueries,
      mediaKey: mediaKey,
      mapPool: mapPool,
      streamObject: streamObject,
      parsePage: parsePage
    }
  };
}

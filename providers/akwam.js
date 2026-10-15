var BASE = "https://akwam.ss";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var MAX_SERVERS = 10;
var MAX_CANDIDATE_PAGES = 4;
var MAX_QUERIES = 8;
var FETCH_TIMEOUT_MS = 12000;
var PROBE_BYTES = 65535;
var PROBE_TIMEOUT_MS = 4500;
var PREROLL_SEC = 6;

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
    if (attempt < 1 && msg.indexOf("HTTP 404") === -1) {
      return fetchText(url, referer, attempt + 1);
    }
    throw err;
  });
}

function getJson(url) {
  return fetchText(url).then(function (t) { return JSON.parse(t); }).catch(function () { return null; });
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
function scoreTitle(candRaw, tmdbTitles, isMovie, dropTokens, primaryTitles) {
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
  var season = c.season;
  if (season == null && primaryTitles && primaryTitles.length) {
    var seq = sequelNumber(c.toks, primaryTitles, isMovie);
    if (seq) season = seq;
  }
  return { score: best.score, year: best.year, season: season };
}

/* "الاختيار 2: رجال الظل" is a later part, not season 1, even when TMDB lists it as an alternate title. */
function sequelNumber(candToks, primaryTitles, isMovie) {
  var nums = [];
  candToks.forEach(function (t) {
    if (!isNumTok(t)) return;
    var n = Number(t);
    if (n >= 2 && n <= 20) nums.push(String(n));
  });
  if (nums.length !== 1) return null;
  var words = candToks.filter(function (t) { return !isNumTok(t); });
  if (!words.length) return null;
  var pWords = {}, pNums = {};
  primaryTitles.forEach(function (title) {
    parseTitle(title, isMovie).toks.forEach(function (t) {
      if (isNumTok(t)) pNums[String(Number(t))] = 1;
      else pWords[t] = 1;
    });
  });
  if (pNums[nums[0]]) return null;
  for (var i = 0; i < words.length; i++) if (pWords[words[i]]) return Number(nums[0]);
  return null;
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
    var primaryTitles = titles.slice();
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
    var runtime = null;
    if (isMovie) runtime = (en && en.runtime) || (ar && ar.runtime) || null;
    else {
      var ert = (en && en.episode_run_time) || (ar && ar.episode_run_time) || [];
      runtime = ert.length ? ert[0] : null;
    }
    if (runtime != null && !(runtime >= 5 && runtime <= 400)) runtime = null;
    return { titles: titles, year: year, title: titles[0], isMovie: isMovie, dropTokens: dropTokens, runtime: runtime, primaryTitles: primaryTitles };
  });
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function cleanQuery(q) {
  return String(q || "")
    .replace(/[!?؟！。.]+/g, " ")
    .replace(/[:\u060C-\u061F]/g, " ")
    .replace(/\s+-\s+|\s+[\u2013\u2014]\s+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function buildQueries(meta) {
  var qs = [], seen = {};
  function add(q) {
    q = cleanQuery(q);
    var k = foldText(q);
    if (!q || !k || seen[k]) return;
    seen[k] = 1;
    qs.push(q);
  }
  var primary = meta.titles.slice(0, 4);
  primary.forEach(function (t) { add(t); });
  /* Akwam lists each TV season as its own result ("Friends الموسم الاول") and a short
     English name is often pushed off page 1 by lookalikes. Ask for the season pages directly. */
  if (!meta.isMovie) primary.slice(0, 2).forEach(function (t) { add(t + " الموسم"); });
  primary.forEach(function (t) {
    var head = String(t).split(/\s*[:\u2013\u2014]\s+|\s+-\s+/)[0];
    if (head && head !== t && foldText(head).length >= 3) add(head);
  });
  return qs.slice(0, MAX_QUERIES);
}

var AR_ORDINALS = ["", "الاول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];

function latinToArabic(str) {
  var map = { a: "ا", b: "ب", c: "ك", d: "د", e: "ي", f: "ف", g: "ج", h: "ه", i: "ي", j: "ج", k: "ك", l: "ل", m: "م", n: "ن", o: "و", p: "ب", q: "ك", r: "ر", s: "س", t: "ت", u: "و", v: "ف", w: "و", x: "كس", y: "ي", z: "ز" };
  var voiced = { b: 1, d: 1, g: 1, l: 1, m: 1, n: 1, r: 1, v: 1, z: 1 };
  return String(str || "").toLowerCase().split(/\s+/).map(function (word) {
    if (!word || STOP_LAT[word] || word === "of") return "";
    var chars = word.replace(/[^a-z0-9]+/g, "").split("");
    var out = "";
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch >= "0" && ch <= "9") { out += ch; continue; }
      var ar = map[ch] || "";
      if (ch === "s" && i === chars.length - 1 && i > 0 && voiced[chars[i - 1]]) ar = "ز";
      if (ar && out.charAt(out.length - 1) === ar.charAt(0) && ar.length === 1) continue;
      out += ar;
    }
    return out;
  }).filter(Boolean).join(" ").trim();
}

function extraQueries(meta, wantSeason) {
  var qs = [];
  var seen = {};
  function add(q) {
    q = cleanQuery(q);
    var k = foldText(q);
    if (!q || !k || seen[k]) return;
    seen[k] = 1;
    qs.push(q);
  }
  var primary = meta.titles.slice(0, 3);
  primary.forEach(function (t) {
    if (!meta.isMovie) {
      var n = Number(wantSeason) || 1;
      var ord = AR_ORDINALS[n] || String(n);
      add(t + " الموسم " + ord);
      add(t + " الجزء " + ord);
    }
    if (!/[\u0621-\u064a]/.test(t)) {
      var ar = latinToArabic(t);
      if (ar && ar.length >= 3) add(ar);
    }
  });
  return qs.slice(0, 6);
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
    if (!title || title === "-->" || title.length < 2) {
      var text = stripHtml(block);
      if (text && text.length >= 2 && text.length <= 180 && !/^(مشاهدة|تحميل|play|download|-->)$/i.test(text)) title = text;
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

function searchAkwam(query, page) {
  var url = BASE + "/search?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  log("Search:", url);
  return fetchText(url, BASE + "/").then(function (html) {
    var results = extractSearchResults(html);
    log("Search results for", query + (page > 1 ? " p" + page : "") + ":", results.length);
    return results;
  }).catch(function (err) {
    log("Search failed:", query, err && err.message);
    return [];
  });
}

function mergeResults(groups) {
  var map = {}, out = [];
  groups.forEach(function (g) {
    g.forEach(function (r) {
      var k = r.kind + "/" + r.key;
      if (!map[k]) { map[k] = r; out.push(r); }
      else if (map[k].weak && !r.weak) { map[k].title = r.title; map[k].weak = false; }
    });
  });
  return out;
}

function searchQueries(queries) {
  return Promise.all(queries.map(function (q) {
    return searchAkwam(q.q, q.page || 1);
  })).then(mergeResults);
}

function searchAll(meta, wantSeason) {
  var first = buildQueries(meta).map(function (q) { return { q: q, page: 1 }; });
  return searchQueries(first).then(function (results) {
    log("Unique candidates:", results.length);
    return { results: results, queries: first.map(function (q) { return q.q; }) };
  });
}

function searchDeep(meta, wantSeason, seenQueries) {
  var jobs = [];
  var seen = {};
  (seenQueries || []).forEach(function (q) { seen[foldText(q)] = 1; });
  function add(q, page) {
    var k = foldText(q) + "#" + (page || 1);
    if (!q || seen[k]) return;
    seen[k] = 1;
    jobs.push({ q: q, page: page || 1 });
  }
  (seenQueries || []).slice(0, 3).forEach(function (q) {
    add(q, 2);
    add(q, 3);
  });
  extraQueries(meta, wantSeason).forEach(function (q) { add(q, 1); });
  jobs = jobs.slice(0, 10);
  if (!jobs.length) return Promise.resolve([]);
  log("Deep search:", jobs.map(function (j) { return j.q + (j.page > 1 ? " p" + j.page : ""); }).join(" | "));
  return searchQueries(jobs);
}

/* ------------------------------------------------------------------ */
/* Candidate pages                                                     */
/* ------------------------------------------------------------------ */

var YEAR_LABEL_RE = /(?:سنة\s*الإنتاج|سنة\s*الانتاج|سنة\s*الاصدار|سنة\s*الإصدار|تاريخ\s*الإصدار|تاريخ\s*الاصدار|تاريخ\s*العرض|release\s*date)[\s\S]{0,120}?\b((?:19|20)\d{2})\b/i;
var YEAR_SIMPLE_RE = /السنة\s*[:：]\s*((?:19|20)\d{2})/;
var RUNTIME_RE = /مدة(?:\s*(?:الفيلم|المسلسل|الحلقة))?\s*[:：]?\s*(\d{1,3})\s*دقيقة/i;

function parseRuntimeMin(html) {
  var m = String(html || "").match(RUNTIME_RE);
  var n = m ? Number(m[1]) : 0;
  return n >= 5 && n <= 400 ? n : null;
}

function parsePage(url, html) {
  var h = html.match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  var t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  var yl = html.match(YEAR_SIMPLE_RE) || html.match(YEAR_LABEL_RE);
  return {
    url: url,
    html: html,
    title: stripHtml(h ? h[1] : (t ? t[1] : "")),
    labelYear: yl ? Number(yl[1]) : null,
    runtimeMin: parseRuntimeMin(html)
  };
}

function loadCandidate(x, meta, isMovie) {
  return fetchText(x.r.url, BASE + "/").then(function (html) {
    var page = parsePage(x.r.url, html);
    var ps = page.title ? scoreTitle(page.title, meta.titles, isMovie, meta.dropTokens, meta.primaryTitles) : { score: 0, year: null, season: null };
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

function movieAccept(score, year, metaYear, part) {
  if (part != null && part >= 2) return false;
  if (score < 0.8) return false;
  if (year && metaYear) return yearDiff(year, metaYear) <= 1;
  return score >= 0.97;
}

function pickMovie(results, meta) {
  var list = results.filter(function (r) { return r.kind === "movie"; });
  var scored = list.map(function (r, i) { return { r: r, i: i, s: scoreTitle(r.title, meta.titles, true, null, meta.primaryTitles) }; });
  var cands = scored.filter(function (x) { return x.s.score >= 0.8; }).sort(cmpScore).slice(0, MAX_CANDIDATE_PAGES);
  if (!cands.length) {
    /* card titles can be truncated: confirm the closest few on their real page title */
    cands = scored.map(function (x) { x.loose = looseOverlap(x.r.title, meta.titles); return x; })
      .filter(function (x) { return x.loose >= 0.3; })
      .sort(function (a, b) { return (b.loose - a.loose) || (a.i - b.i); })
      .slice(0, 3);
  }
  return Promise.all(cands.map(function (x) { return loadCandidate(x, meta, true); })).then(function (loaded) {
    var ok = loaded.filter(function (c) {
      if (!c) return false;
      var pass = movieAccept(c.score, c.year, meta.year, c.season);
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

function pickSeries(results, meta, wantSeason) {
  var list = results.filter(function (r) { return r.kind === "series"; });
  var scored = list.map(function (r, i) { return { r: r, i: i, s: scoreTitle(r.title, meta.titles, false, meta.dropTokens, meta.primaryTitles) }; });
  var plausible = scored.filter(function (x) { return x.s.score >= 0.9; });
  var exact = plausible.filter(function (x) { return x.s.season === wantSeason; }).sort(cmpScore);
  var unnumbered = plausible.filter(function (x) { return x.s.season == null; }).sort(cmpScore);
  var cands = exact.length ? exact.slice(0, MAX_CANDIDATE_PAGES)
    : unnumbered.slice(0, wantSeason === 1 ? MAX_CANDIDATE_PAGES : 2);
  if (!cands.length) {
    cands = scored.map(function (x) { x.loose = looseOverlap(x.r.title, meta.titles); return x; })
      .filter(function (x) { return x.loose >= 0.3 && (x.s.season == null || x.s.season === wantSeason); })
      .sort(function (a, b) { return (b.loose - a.loose) || (a.i - b.i); })
      .slice(0, 3);
  }
  return Promise.all(cands.map(function (x) { return loadCandidate(x, meta, false); })).then(function (loaded) {
    var ok = loaded.filter(function (c) {
      if (!c) return false;
      var pass = seriesAccept(c, meta, wantSeason);
      log("Series candidate:", c.title, "score:", c.score.toFixed(2), "season:", c.season == null ? "-" : c.season, pass ? "OK" : "rejected");
      return pass;
    });
    ok.sort(function (a, b) {
      var ae = a.season === wantSeason ? 1 : 0, be = b.season === wantSeason ? 1 : 0;
      return (b.score - a.score) || (be - ae) || (yearDiff(a.year, meta.year) - yearDiff(b.year, meta.year)) || (a.i - b.i);
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
  var m = new RegExp(EP_RE_SRC + "(\\d{1,4})(?=\\s|\( )").exec(f) || /(?:^|\s)s\d{1,2}\s*e(\d{1,4})(?=\s| \))/.exec(f);
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
    var fromText = l.text ? epNumberOf(l.text) : null;
    var fromSlug = epNumberOf(l.slug);
    /* "حلقة 1" is the real number. Slugs like /episode-11/ are often just ids. */
    l.ep = fromText != null ? fromText : fromSlug;
    l.prefix = epPrefixOf(l.slug);
    l.group = seriesKeyFromText(l.text);
  });
  return out;
}

function seriesKeyFromText(text) {
  var f = foldText(text || "");
  if (!f) return "";
  var m = f.match(/(?:الحلقه|حلقه|episode|ep)\s*\d+\s*(.*)$/);
  var rest = m ? m[1] : "";
  rest = rest.replace(/^(?:مسلسل|فيلم|مشاهده)\s+/, "");
  var sm = rest.match(/^(.*?(?:الموسم|موسم|الجزء|جزء|season)\s+\S+(?:\s+(?:عشر|عشره))?)/);
  if (sm && sm[1]) return sm[1].replace(/\s+/g, " ").trim();
  return "";
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
    /* Slugs are often the episode name ("pilot") while the visible text is
       "حلقة 3 : مسلسل LOST الموسم الاول ...". Group on that series key. */
    var hint = foldText(hintTitle || "");
    function bestKey(keyOf) {
      var counts = {};
      withN.forEach(function (l) {
        var k = keyOf(l);
        if (!k) return;
        counts[k] = (counts[k] || 0) + 1;
      });
      var best = "", bestScore = -1, bestCount = 0;
      Object.keys(counts).forEach(function (k) {
        var sc = counts[k] + (hint && tokenJaccard(k, hint) >= 0.45 ? 1000 : 0);
        if (sc > bestScore) { bestScore = sc; best = k; bestCount = counts[k]; }
      });
      return { key: best, count: bestCount };
    }
    var grouped = bestKey(function (l) { return l.group; });
    var main = [];
    if (grouped.count >= 2) main = withN.filter(function (l) { return l.group === grouped.key; });
    if (main.length < 2) {
      var pref = bestKey(function (l) { return l.prefix; });
      if (pref.count >= 2) main = withN.filter(function (l) { return l.prefix === pref.key; });
    }
    if (main.length < 2) {
      var hinted = withN.filter(function (l) { return l.group && hint && tokenJaccard(l.group, hint) >= 0.45; });
      if (hinted.length) main = hinted;
    }
    if (main.length < 2) main = withN;
    var hit = main.filter(function (l) { return l.ep === wanted; });
    if (!hit.length) {
      log("Episode", wanted, "not on page. Available:", main.map(function (l) { return l.ep; }).sort(function (a, b) { return a - b; }).join(","));
      return null;
    }
    hit.sort(function (a, b) { return a.id - b.id; });
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

function normalizeMediaUrl(u) {
  u = decodeHtml(u).trim();
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
      var qm = url.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360|240)p?(?:[^0-9]|$)/);
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
  var fre = /["']?file["']?\s*:\s*["']([^"']+\.(?:mp4|mkv|webm|m3u8)[^"']*)["']/gi, fm;
  while ((fm = fre.exec(html)) !== null) push(fm[1], "");
  return streams;
}

function u32be(u8, i) {
  return ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
}
function fourcc(u8, i) {
  if (!u8 || i + 4 > u8.length) return "";
  return String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
}
function mp4Header(u8) {
  if (!u8 || u8.length < 12 || fourcc(u8, 4) !== "ftyp") return null;
  var fsz = u32be(u8, 0);
  if (fsz >= 8 && fsz + 8 <= u8.length && fourcc(u8, fsz + 4) === "moov") {
    var moov = u32be(u8, fsz);
    if (moov >= 8 && moov < 40 * 1024 * 1024) return { isMp4: true, moov: moov, fastStart: true };
  }
  return { isMp4: true, moov: 0, fastStart: false };
}
function looksLikeMkv(u8) {
  if (!u8 || u8.length < 4) return false;
  if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3) return true;
  var s = "";
  var n = Math.min(u8.length, 96);
  for (var i = 0; i < n; i++) s += (u8[i] >= 32 && u8[i] < 127) ? String.fromCharCode(u8[i]) : " ";
  return /matroska|webm/i.test(s);
}
function looksLikeM3u8(u8) {
  if (!u8 || u8.length < 7) return false;
  var s = "";
  for (var i = 0; i < Math.min(u8.length, 12); i++) s += String.fromCharCode(u8[i]);
  return s.indexOf("#EXTM3U") === 0;
}
function isTlsError(err) {
  var c = err && err.cause;
  var blob = String((c && c.code) || "") + " " + String((c && c.message) || "") + " " + String((err && err.message) || "");
  return /CERT|TLS|SSL|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED/i.test(blob);
}
function guessedBps(quality) {
  var label = qualityTier(quality).label;
  if (label === "2160p") return 2200 * 1024;
  if (label === "1440p") return 1100 * 1024;
  if (label === "1080p") return 550 * 1024;
  if (label === "720p" || label === "Auto") return 280 * 1024;
  if (label === "480p") return 140 * 1024;
  if (label === "360p") return 80 * 1024;
  return 220 * 1024;
}

/* Akwam's CDN is a download server: multi-megabyte moov atoms, octet-stream
   attachments, and some hosts omit the TLS chain (the player then spins forever).
   Probe a small range, keep only files that can actually start, and prefer the
   highest quality the measured throughput can sustain. */
function fetchProbe(url, referer, manualRedirect) {
  var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
  var timer = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, PROBE_TIMEOUT_MS);
  var headers = {
    "User-Agent": UA,
    "Referer": referer || (BASE + "/"),
    "Range": "bytes=0-" + PROBE_BYTES
  };
  var opts = { headers: headers, redirect: manualRedirect ? "manual" : "follow" };
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts).then(function (r) {
    var status = r.status;
    if (status >= 300 && status < 400) {
      clearTimeout(timer);
      if (r.body && r.body.cancel) { try { r.body.cancel(); } catch (e2) {} }
      return { redirect: r.headers.get("location") || "", status: status, u8: new Uint8Array(0), total: 0 };
    }
    var total = 0;
    var crm = String(r.headers.get("content-range") || "").match(/\/(\d+)\s*$/);
    if (crm) total = Number(crm[1]);
    var cl = Number(r.headers.get("content-length") || 0);
    if (!total && status === 200) total = cl;
    if (status === 200 && cl > PROBE_BYTES + 4096) {
      clearTimeout(timer);
      if (r.body && r.body.cancel) { try { r.body.cancel(); } catch (e3) {} }
      try { if (ctrl) ctrl.abort(); } catch (e4) {}
      return { status: status, noRange: true, total: total, u8: new Uint8Array(0) };
    }
    return r.arrayBuffer().then(function (ab) {
      clearTimeout(timer);
      return { status: status, u8: new Uint8Array(ab), total: total, noRange: false };
    });
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}

function probeOne(src) {
  var t0 = Date.now();
  function read(res, viaHttp, httpUrl) {
    var ms = Math.max(80, Date.now() - t0);
    var u8 = res.u8 || new Uint8Array(0);
    var header = mp4Header(u8);
    var hls = looksLikeM3u8(u8);
    var mkv = looksLikeMkv(u8);
    var speed = u8.length > 0 ? u8.length / (ms / 1000) : 0;
    return {
      ok: !!(header || hls || mkv) && !res.noRange,
      isMp4: !!(header && header.isMp4),
      isMkv: mkv,
      isHls: hls,
      moov: header && header.fastStart ? header.moov : (mkv ? 512 * 1024 : 0),
      fastStart: !!(header && header.fastStart) || hls || mkv,
      total: res.total || 0,
      speed: speed,
      ms: ms,
      viaHttp: !!viaHttp,
      httpUrl: httpUrl || "",
      noRange: !!res.noRange,
      status: res.status || 0
    };
  }
  return fetchProbe(src.url, src.referer, false).then(function (res) {
    return read(res, src.url.indexOf("http://") === 0, "");
  }).catch(function (err) {
    if (src.url.indexOf("https://") !== 0 || !isTlsError(err)) {
      return { ok: false, isMp4: false, speed: 0, error: String((err && err.message) || err) };
    }
    var httpUrl = "http://" + src.url.slice("https://".length);
    t0 = Date.now();
    return fetchProbe(httpUrl, src.referer, true).then(function (res) {
      if (res.redirect) return { ok: false, isMp4: false, speed: 0, tlsBroken: true };
      var out = read(res, true, httpUrl);
      out.tlsBroken = true;
      return out;
    }).catch(function () {
      return { ok: false, isMp4: false, speed: 0, tlsBroken: true };
    });
  });
}

function judgeStream(src, probe, runtimeMin) {
  var speed = probe.speed || 0;
  var bytes = probe.total || 0;
  var bps = (runtimeMin && bytes) ? (bytes / (runtimeMin * 60)) : guessedBps(src.quality);
  if (bps < 20 * 1024) bps = guessedBps(src.quality);
  var moov = probe.isHls ? 64 * 1024
    : (probe.isMkv ? (probe.moov || 512 * 1024)
    : (probe.fastStart && probe.moov ? probe.moov : Math.max(bytes || 0, 12 * 1024 * 1024)));
  var ratio = bps ? speed / bps : 0;
  var startup = speed > 0 ? (moov + bps * PREROLL_SEC) / speed : 9999;
  if (probe.noRange || !probe.fastStart) startup = Math.max(startup, 999);
  var tier = qualityTier(src.quality).rank;
  var score = -1;
  if (probe.isHls && speed > 0) score = 8000 + tier;
  else if ((probe.isMp4 || probe.isHls || probe.isMkv) && speed > 0 && !probe.noRange && probe.fastStart) {
    if (ratio >= 1.15 && startup <= 12) score = 4000 + tier * 40 - startup;
    else if (ratio >= 1 && startup <= 20) score = 2500 + tier * 25 - startup;
    else score = ratio * 400 + tier - Math.min(startup, 90) / 10;
  }
  return { score: score, ratio: ratio, startup: startup, bps: bps, tier: tier };
}

function mediaKey(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/?#]+)(?:\/[^?#]*)?\/([^\/?#]+)$/i);
  if (!m) return String(url || "");
  var name = m[2];
  try { name = decodeURIComponent(name); } catch (e) {}
  return m[1].toLowerCase() + "|" + name.toLowerCase();
}

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

function streamObject(src) {
  var label = qualityTier(src.quality).label || "Unknown";
  var headers = { "User-Agent": UA, "Referer": src.referer || (BASE + "/") };
  var bytes = (src.probe && src.probe.total) || 0;
  var item = {
    name: "Akwam",
    title: label === "Unknown" ? "Akwam" : "Akwam " + label,
    url: src.url,
    quality: label,
    headers: headers,
    provider: "akwam",
    behaviorHints: {
      notWebReady: src.url.indexOf("http://") === 0,
      proxyHeaders: { request: headers }
    }
  };
  if (bytes) {
    item.bytes = bytes;
    item.size = bytes;
    item.behaviorHints.videoSize = bytes;
  }
  if (src.judge && isFinite(src.judge.startup)) item.startupSec = Math.round(src.judge.startup * 10) / 10;
  return item;
}

function rankForPlayback(sources, runtimeMin) {
  var uniq = [], seen = {};
  sources.forEach(function (s) {
    if (!s || !s.url) return;
    var key = mediaKey(s.url);
    if (seen[key]) return;
    seen[key] = 1;
    uniq.push(s);
  });
  if (!uniq.length) return Promise.resolve([]);
  return mapPool(uniq, 2, function (s) {
    return probeOne(s).then(function (p) {
      s.probe = p;
      if (p.httpUrl && (p.isMp4 || p.isHls || p.isMkv)) s.url = p.httpUrl;
      s.judge = judgeStream(s, p, runtimeMin);
      var j = s.judge;
      log("Probe", (qualityTier(s.quality).label || s.quality),
        (p.speed ? Math.round(p.speed / 1024) : 0) + "KB/s",
        "need", Math.round(j.bps / 1024) + "KB/s",
        "start", isFinite(j.startup) ? j.startup.toFixed(1) + "s" : "?",
        "x" + (j.ratio ? j.ratio.toFixed(2) : "0"),
        p.httpUrl ? "http-fixed" : "https",
        (p.isHls ? "hls" : (p.isMkv ? "mkv" : (p.isMp4 ? "mp4" : "bad"))));
      return s;
    });
  }).then(function (list) {
    var sustainable = list.filter(function (s) {
      return s.judge && s.judge.ratio >= 1 && s.judge.score > 0 && s.judge.startup <= 20;
    });
    var pool = sustainable;
    if (!pool.length) {
      pool = list.filter(function (s) { return s.judge && s.judge.score > 0; })
        .sort(function (a, b) { return (b.judge.ratio - a.judge.ratio) || (a.judge.startup - b.judge.startup); })
        .slice(0, 1);
    }
    if (!pool.length) {
      log("Probes failed, falling back to quality order");
      return finalizeStreams(sources);
    }
    var best = {};
    pool.forEach(function (s) {
      var label = qualityTier(s.quality).label || "Unknown";
      var key = label === "Unknown" ? s.url : label;
      if (!best[key] || s.judge.score > best[key].judge.score) best[key] = s;
    });
    var chosen = [];
    for (var k in best) chosen.push(best[k]);
    chosen.sort(function (a, b) { return b.judge.score - a.judge.score; });
    var top = chosen[0];
    log("Playback pick:", top && (qualityTier(top.quality).label || top.quality),
      "start", top && top.judge.startup.toFixed(1) + "s",
      "of", chosen.length);
    return chosen.map(streamObject);
  });
}

function finalizeStreams(sources) {
  var out = [], seen = {};
  sources.forEach(function (s) {
    var tier = qualityTier(s.quality);
    var label = tier.label || "Unknown";
    var key = label === "Unknown" ? s.url : hostOf(s.url) + "|" + label;
    if (seen[key]) return;
    seen[key] = 1;
    out.push({
      name: "Akwam",
      title: label === "Unknown" ? "Akwam" : "Akwam " + label,
      url: s.url,
      quality: label,
      headers: { "User-Agent": UA, "Referer": s.referer || (BASE + "/") },
      provider: "akwam",
      _rank: tier.rank
    });
  });
  out.sort(function (a, b) { return b._rank - a._rank; });
  out.forEach(function (s) { delete s._rank; });
  return out;
}

function collectStreams(html, pageUrl, runtimeMin) {
  var watchUrls = extractWatchUrls(html);
  log("Watch pages:", watchUrls.length);
  return Promise.all(watchUrls.map(function (w) {
    return fetchText(w, pageUrl).then(function (wh) {
      var src = extractSources(wh);
      src.forEach(function (s) { s.referer = w; });
      return src;
    }).catch(function (err) {
      log("Watch page failed:", w, err && err.message);
      return [];
    });
  })).then(function (groups) {
    var all = [];
    groups.forEach(function (g) { g.forEach(function (s) { all.push(s); }); });
    return rankForPlayback(all, runtimeMin).then(function (streams) {
      return { watchCount: watchUrls.length, streams: streams };
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
  return getMeta(tmdbId, isTv ? "tv" : "movie").then(function (meta) {
    out.meta = meta;
    return searchAll(meta, wantSeason).then(function (found) {
      out.candidates = found.results.length;
      function choose(results) {
        return isTv ? pickSeries(results, meta, wantSeason) : pickMovie(results, meta);
      }
      return choose(found.results).then(function (picked) {
        if (picked) return picked;
        log("No confident match, widening search");
        return searchDeep(meta, wantSeason, found.queries).then(function (more) {
          var merged = mergeResults([found.results, more]);
          out.candidates = merged.length;
          log("Unique candidates after deep:", merged.length);
          return choose(merged);
        });
      });
    }).then(function (picked) {
      if (!picked) { out.reason = "NO_MATCH"; return out; }
      out.picked = { url: picked.page.url, title: picked.title, score: picked.score, year: picked.year, season: picked.season };
      log("SELECTED:", picked.title, picked.page.url, "score:", picked.score.toFixed(2), "year:", picked.year || "?");
      if (!isTv) {
        var movieRuntime = picked.page.runtimeMin || meta.runtime || null;
        return collectStreams(picked.page.html, picked.page.url, movieRuntime).then(function (r) {
          out.watchCount = r.watchCount; out.streams = r.streams;
          if (!r.streams.length) out.reason = r.watchCount ? "NO_LINKS" : "NO_WATCH_PAGES";
          return out;
        });
      }
      var links = parseEpisodeLinks(picked.page.html);
      log("Episode links:", links.length);
      var ep = pickEpisode(links, wantEpisode, picked.title);
      if (!ep) { out.reason = "NO_EPISODE"; return out; }
      out.episodeUrl = ep.url;
      out.episodeNumber = ep.ep;
      return fetchText(ep.url, picked.page.url).then(function (epHtml) {
        var runtime = parseRuntimeMin(epHtml) || picked.page.runtimeMin || meta.runtime || null;
        return collectStreams(epHtml, ep.url, runtime);
      }).then(function (r) {
        out.watchCount = r.watchCount; out.streams = r.streams;
        if (!r.streams.length) out.reason = r.watchCount ? "NO_LINKS" : "NO_WATCH_PAGES";
        return out;
      });
    });
  }).catch(function (err) {
    out.reason = "ERROR: " + (err && err.message);
    log("Error:", out.reason);
    return out;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  log("getStreams:", tmdbId, mediaType, season, episode);
  return resolve(tmdbId, mediaType, season, episode).then(function (r) {
    log("Result:", r.reason || "OK", "streams:", r.streams.length);
    return r.streams;
  }).catch(function () { return []; });
}

module.exports = {
  getStreams: getStreams,
  _resolve: resolve,
  _internals: {
    scoreTitle: scoreTitle,
    foldText: foldText,
    extractSearchResults: extractSearchResults,
    parseEpisodeLinks: parseEpisodeLinks,
    pickEpisode: pickEpisode,
    extractSources: extractSources,
    finalizeStreams: finalizeStreams,
    buildQueries: buildQueries
  }
};

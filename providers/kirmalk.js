var BASE_URL = 'https://kirmalk.com';
var TMDB_API_KEY = '83d364331c40bfbe29858aeed82f45cc';
var DEBUG = true;
// When no stream is found, return ONE fake entry whose title is the failure trace, so it is visible inside Nuvio.
var DEBUG_STREAM = true;

var MAX_SEARCH_PAGES = 3;
var MAX_QUERIES = 6;
var MAX_GROUPS = 4;
var MAX_MOVIE_CANDIDATES = 4;
var SITE_TIMEOUT = 15000;
var HOST_TIMEOUT = 15000;

var UA_SITE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
var UA_HOST = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

var TRACE = [];

function log(message) {
  TRACE.push(String(message));
  if (TRACE.length > 80) TRACE.shift();
  if (DEBUG && typeof console !== 'undefined') console.log('[Kirmalk] ' + message);
}

// ───────────────────────────── Text helpers ─────────────────────────────

function decodeEntities(str) {
  return String(str == null ? '' : str)
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(str) {
  return decodeEntities(String(str).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function toWesternDigits(str) {
  return String(str)
    .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
}

// Lower-case, fold Arabic letter variants, drop diacritics and punctuation.
function normalizeText(input) {
  var s = toWesternDigits(decodeEntities(input)).toLowerCase();
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  s = s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .replace(/\u06CC/g, '\u064A')
    .replace(/[\u06AF\u06A9]/g, '\u0643');
  return s.replace(/[^\u0621-\u064Aa-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Search-box text: keep letters/digits, drop punctuation (boolean full-text dislikes it).
function cleanQuery(text) {
  return decodeEntities(text)
    .replace(/[\u060C\u061B\u061F\u066A-\u066D\u06D4]/g, ' ')
    .replace(/[!-\/:-@\[-`{-~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same text, but alef/diacritic variants folded (used as a fallback query).
function foldQuery(text) {
  return cleanQuery(text)
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627');
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function setOf(words) {
  var set = {};
  words.forEach(function (w) { set[normalizeText(w)] = true; });
  return set;
}

// ───────────────────────────── Title vocabulary ─────────────────────────

var KIND_BY_WORD = {};
[['فيلم', 'movie'], ['مسرحية', 'play'], ['مسلسل', 'series'], ['انمي', 'series'], ['كرتون', 'series'], ['برنامج', 'show']]
  .forEach(function (p) { KIND_BY_WORD[normalizeText(p[0])] = p[1]; });

var LEAD_WORDS = setOf(['مشاهدة', 'تحميل']);
var DUB_WORDS = setOf(['مدبلج', 'مدبلجة']);
var SUB_WORDS = setOf(['مترجم', 'مترجمة']);
var SEASON_WORDS = setOf(['الموسم', 'موسم', 'الجزء', 'جزء']);
var EP_WORDS = setOf(['الحلقة', 'حلقة']);
var NOISE_WORDS = setOf(['كامل', 'كاملة', 'hd', 'fhd', 'uhd', '4k', 'bluray', 'hdrip', 'webrip', '720p', '1080p']);

var ORDINALS = {};
[
  ['الاول', 1], ['الاولى', 1], ['الثاني', 2], ['الثانية', 2], ['الثالث', 3], ['الثالثة', 3],
  ['الرابع', 4], ['الرابعة', 4], ['الخامس', 5], ['الخامسة', 5], ['السادس', 6], ['السادسة', 6],
  ['السابع', 7], ['السابعة', 7], ['الثامن', 8], ['الثامنة', 8], ['التاسع', 9], ['التاسعة', 9],
  ['العاشر', 10], ['العاشرة', 10]
].forEach(function (p) { ORDINALS[normalizeText(p[0])] = p[1]; });

function numberFromToken(token) {
  if (/^\d{1,4}$/.test(token)) return parseInt(token, 10);
  return ORDINALS[token] || null;
}

// "مسلسل الاعراف 2 الحلقة 26 السادسة والعشرون مدبلجة HD"  -> series info
// "مشاهدة فيلم برشامة 2026 HD"                              -> movie info
function parseTitle(raw) {
  var info = { kind: null, name: '', aliases: [], year: null, season: null, episode: null, variant: '' };
  var aliases = [];
  var text = decodeEntities(raw).replace(/\(([^)]*)\)/g, function (_, inner) { aliases.push(inner); return ' '; });
  var tokens = normalizeText(text).split(' ').filter(Boolean);

  while (tokens.length && LEAD_WORDS[tokens[0]]) tokens.shift();
  if (tokens.length && KIND_BY_WORD[tokens[0]]) info.kind = KIND_BY_WORD[tokens.shift()];

  tokens = tokens.filter(function (t) {
    if (DUB_WORDS[t]) { info.variant = 'dub'; return false; }
    if (SUB_WORDS[t]) { info.variant = 'sub'; return false; }
    return true;
  });

  var epIdx = -1;
  for (var i = 0; i < tokens.length; i++) {
    if (EP_WORDS[tokens[i]]) { epIdx = i; break; }
  }
  if (epIdx !== -1) {
    info.episode = numberFromToken(tokens[epIdx + 1] || '');
    tokens = tokens.slice(0, epIdx);
    if (!info.kind) info.kind = 'series';
  }
  if (!info.kind) info.kind = 'movie';

  if (info.kind === 'series' || info.kind === 'show') {
    for (var j = 0; j < tokens.length - 1; j++) {
      if (SEASON_WORDS[tokens[j]]) {
        var n = numberFromToken(tokens[j + 1]);
        if (n) { info.season = n; tokens.splice(j, 2); break; }
      }
    }
  } else {
    for (var k = tokens.length - 1; k >= 0; k--) {
      if (/^(19|20)\d\d$/.test(tokens[k])) {
        if (tokens.length > 1) { info.year = parseInt(tokens[k], 10); tokens.splice(k, 1); }
        break;
      }
    }
  }

  info.name = tokens.filter(function (t) { return !NOISE_WORDS[t]; }).join(' ');
  info.aliases = aliases.map(normalizeText).filter(Boolean);
  return info;
}

// ───────────────────────────── Fuzzy compare ────────────────────────────

function bigramMap(str) {
  var s = str.replace(/ /g, '');
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
  var x = bigramMap(a);
  var y = bigramMap(b);
  if (!x.size || !y.size) return 0;
  var common = 0;
  Object.keys(x.map).forEach(function (g) {
    if (y.map[g]) common += Math.min(x.map[g], y.map[g]);
  });
  return (2 * common) / (x.size + y.size);
}

function numberTokens(str) {
  return (str.match(/\d+/g) || []).join(',');
}

// ───────────────────────────────── HTTP ─────────────────────────────────

function withTimeout(promise, ms, label) {
  if (typeof setTimeout !== 'function') return promise;
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('timeout: ' + label)); }, ms);
    promise.then(
      function (v) { clearTimeout(timer); resolve(v); },
      function (e) { clearTimeout(timer); reject(e); }
    );
  });
}

function doFetch(url, options) {
  if (typeof fetch === 'function') return fetch(url, options);
  if (typeof fetchWithTimeout === 'function') return fetchWithTimeout(url, options, SITE_TIMEOUT);
  return Promise.reject(new Error('no fetch available in this sandbox'));
}

function fetchText(url, headers, timeoutMs) {
  var short = url.split('?')[0];
  var p;
  try {
    p = doFetch(url, { method: 'GET', headers: headers, redirect: 'follow' });
  } catch (e) {
    return Promise.reject(e);
  }
  return withTimeout(p, timeoutMs, short)
    .then(function (res) {
      var status = res ? res.status : undefined;
      var ok = (res && res.ok !== undefined) ? res.ok : (status === undefined || (status >= 200 && status < 400));
      log('GET ' + short.replace(/^https?:\/\//, '') + ' -> ' + (status === undefined ? '?' : status));
      if (!ok) throw new Error('HTTP ' + status + ' ' + short);
      return typeof res.text === 'function' ? res.text() : String(res.body || res.data || '');
    });
}

function siteGet(url, referer) {
  return fetchText(url, {
    'User-Agent': UA_SITE,
    'Referer': referer || BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'ar,en;q=0.9'
  }, SITE_TIMEOUT);
}

function originOf(url) {
  var m = /^(https?:\/\/[^\/?#]+)/i.exec(url);
  return m ? m[1] : '';
}

function hostOf(url) {
  var m = /^https?:\/\/([^\/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

function absoluteUrl(url, baseUrl) {
  var u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return originOf(baseUrl) + u;
  if (!u || /^(?:javascript|data|mailto|#)/i.test(u)) return '';
  var dir = baseUrl.split('#')[0].split('?')[0];
  dir = dir.slice(0, dir.lastIndexOf('/') + 1);
  return dir + u;
}

function sequentialFirst(items, fn) {
  var i = 0;
  function next() {
    if (i >= items.length) return Promise.resolve([]);
    var item = items[i++];
    return fn(item).then(function (res) { return (res && res.length) ? res : next(); });
  }
  return next();
}

// ───────────────────────────── HTML extraction ──────────────────────────

function getAttr(tag, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

// Every <a href="...watch.php?vid=ID" title="..."> on a page, de-duplicated by vid.
function parseWatchAnchors(html) {
  var byVid = {};
  var out = [];
  var re = /<a\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var idm = /watch\.php\?vid=([A-Za-z0-9_-]+)/.exec(decodeEntities(getAttr(tag, 'href')));
    if (!idm) continue;
    var vid = idm[1];
    var title = decodeEntities(getAttr(tag, 'title')).replace(/\s+/g, ' ').trim();
    var closeAt = html.indexOf('</a>', re.lastIndex);
    var text = closeAt === -1 ? '' : stripTags(html.slice(re.lastIndex, Math.min(closeAt, re.lastIndex + 600)));
    if (byVid[vid]) {
      if (!byVid[vid].title && title) byVid[vid].title = title;
      continue;
    }
    byVid[vid] = { vid: vid, title: title || (text.length > 8 ? text : '') };
    out.push(byVid[vid]);
  }
  return out.filter(function (e) { return e.title; });
}

function parseMaxPage(html) {
  var max = 1;
  var re = /[?&;]page=(\d+)/g;
  var m;
  while ((m = re.exec(html)) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

// "المواسم والحلقات" block: anchors whose text is "N حلقة" -> watch.php?vid=ID
function parseEpisodeList(html) {
  var list = [];
  var seenEp = {};
  var re = /<a\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var idm = /watch\.php\?vid=([A-Za-z0-9_-]+)/.exec(decodeEntities(getAttr(m[0], 'href')));
    if (!idm) continue;
    var closeAt = html.indexOf('</a>', re.lastIndex);
    if (closeAt === -1) continue;
    var text = toWesternDigits(stripTags(html.slice(re.lastIndex, Math.min(closeAt, re.lastIndex + 300))));
    var tm = /^(?:(?:ال)?حلق[ةه]\s*)?(\d{1,4})(?:\s*(?:ال)?حلق[ةه])?$/.exec(text);
    if (!tm) continue;
    var ep = parseInt(tm[1], 10);
    if (seenEp[ep]) continue;
    seenEp[ep] = true;
    list.push({ episode: ep, vid: idm[1] });
  }
  return list;
}

// ───────────────────────────────── TMDB ─────────────────────────────────

function fetchJson(url) {
  return fetchText(url, { 'Accept': 'application/json' }, SITE_TIMEOUT).then(function (body) {
    return JSON.parse(body);
  });
}

function loadTmdb(tmdbId, type) {
  var base = 'https://api.themoviedb.org/3/' + type + '/' + encodeURIComponent(tmdbId) + '?api_key=' + TMDB_API_KEY;
  var arP = fetchJson(base + '&language=ar&append_to_response=translations,alternative_titles')
    .catch(function (e) { log('TMDB ar failed: ' + e.message); return null; });
  var enP = fetchJson(base + '&language=en-US')
    .catch(function (e) { log('TMDB en failed: ' + e.message); return null; });
  return Promise.all([arP, enP]).then(function (r) { return { ar: r[0], en: r[1] }; });
}

function uniqueBy(list, keyFn) {
  var seen = {};
  var out = [];
  list.forEach(function (item) {
    var k = keyFn(item);
    if (!k || seen[k]) return;
    seen[k] = true;
    out.push(item);
  });
  return out;
}

function buildMeta(tm, type) {
  var isTv = type === 'tv';
  var ar = tm.ar;
  var en = tm.en;
  if (!ar && !en) return null;

  var raw = [];
  function push(t) { if (t && typeof t === 'string') raw.push(t); }
  function nameOf(d) { return d ? (isTv ? d.name : d.title) : ''; }
  function originalOf(d) { return d ? (isTv ? d.original_name : d.original_title) : ''; }

  push(nameOf(ar));
  if (ar && ar.translations && ar.translations.translations) {
    ar.translations.translations.forEach(function (t) {
      if (t.iso_639_1 === 'ar' && t.data) push(isTv ? t.data.name : t.data.title);
    });
  }
  if (ar && ar.alternative_titles) {
    var alts = ar.alternative_titles.results || ar.alternative_titles.titles || [];
    alts.forEach(function (a) { if (a && a.title && hasArabic(a.title)) push(a.title); });
  }
  push(nameOf(en));
  push(originalOf(ar));
  push(originalOf(en));

  var titles = uniqueBy(raw, normalizeText).slice(0, 10);
  var arabicFirst = titles.filter(hasArabic).concat(titles.filter(function (t) { return !hasArabic(t); }));

  var src = ar || en;
  var dateStr = isTv ? src.first_air_date : src.release_date;
  var year = dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;

  var seasons = (ar && ar.seasons) || (en && en.seasons) || [];
  var epCounts = {};
  seasons.forEach(function (s) { if (s.season_number >= 1) epCounts[s.season_number] = s.episode_count; });

  return {
    type: type,
    year: isNaN(year) ? null : year,
    titles: arabicFirst,
    targets: uniqueBy(arabicFirst.map(normalizeText), function (x) { return x; }),
    // Episodes that come before season S (for continuous numbering on the site).
    priorEpisodes: function (S) {
      var total = 0;
      for (var s = 1; s < S; s++) {
        if (!epCounts[s]) return null;
        total += epCounts[s];
      }
      return total;
    }
  };
}

function buildQueries(meta, season) {
  var base = uniqueBy(meta.titles.map(cleanQuery), function (q) { return normalizeText(q); });
  var q = [];
  if (meta.type === 'movie') {
    base.slice(0, 2).forEach(function (b) {
      if (meta.year) q.push(b + ' ' + meta.year);
      q.push(b);
    });
    base.slice(2, 4).forEach(function (b) { q.push(b); });
  } else {
    if (season > 1 && base[0]) q.push(base[0] + ' ' + season);
    base.slice(0, 3).forEach(function (b) { q.push(b); });
  }
  if (base[0]) {
    var folded = foldQuery(base[0]);
    if (folded !== base[0]) q.push(folded);
  }
  return uniqueBy(q, function (x) { return x; }).slice(0, MAX_QUERIES);
}

// ───────────────────────────────── Search ───────────────────────────────

function searchPage(query, page) {
  var url = BASE_URL + '/search.php?keywords=' + encodeURIComponent(query) + (page > 1 ? '&page=' + page : '');
  return siteGet(url).then(function (html) {
    var entries = parseWatchAnchors(html);
    if (entries.length || page > 1) return { entries: entries, maxPage: parseMaxPage(html) };
    // Fallback parameter name in case "keywords" returned nothing at all.
    var alt = BASE_URL + '/search.php?q=' + encodeURIComponent(query);
    return siteGet(alt).then(function (h2) {
      return { entries: parseWatchAnchors(h2), maxPage: parseMaxPage(h2) };
    }).catch(function () { return { entries: [], maxPage: 1 }; });
  });
}

// onEntries(entries) returns true to stop everything.
function searchPages(query, onEntries) {
  var page = 1;
  function step() {
    return searchPage(query, page).then(function (res) {
      log('search "' + query + '" p' + page + ' -> ' + res.entries.length + ' results');
      if (onEntries(res.entries)) return true;
      if (!res.entries.length || page >= MAX_SEARCH_PAGES || page >= res.maxPage) return false;
      page += 1;
      return step();
    }).catch(function (err) {
      log('search failed (' + query + ' p' + page + '): ' + (err && err.message));
      return false;
    });
  }
  return step();
}

function searchQueries(queries, onEntries, afterQuery) {
  var qi = 0;
  function next() {
    if (qi >= queries.length) return Promise.resolve(false);
    return searchPages(queries[qi++], onEntries).then(function (stop) {
      if (stop || (afterQuery && afterQuery())) return true;
      return next();
    });
  }
  return next();
}

// ───────────────────────────── Player resolution ────────────────────────

var BAD_ASSET = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?|ttf|eot)(?:[?#]|$)/i;
var BAD_MEDIA = /\.(?:jpe?g|png|gif|webp|svg|ico|vtt|srt|css|js|json|html?)(?:[?#]|$)/i;
var SKIP_HOST = /(?:^|\.)(?:kirmalk\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|t\.me|wa\.me|whatsapp\.com|google\.com|googleapis\.com|gstatic\.com|googletagmanager\.com|google-analytics\.com|cloudflare\.com|jquery\.com|bootstrapcdn\.com|fontawesome\.com|youtube\.com|youtu\.be|w3\.org|schema\.org|jsdelivr\.net|gravatar\.com|pinterest\.com|linkedin\.com|tiktok\.com|telegram\.me)$/i;

var DOOD_HOST_RE = /(?:^|\.)(?:hdup\d*\.com|doodstream\.com|dood\.(?:wf|watch|sh|re|pm|to|li|so|la|ws|yt)|d000d\.com|do7go\.com|ds2video\.com|doodstream\.com\.tr)$/i;

function isDoodHost(url) {
  var h = hostOf(url);
  return DOOD_HOST_RE.test(h);
}

function randomString(len) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var out = '';
  for (var i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

// DoodStream-style player page:
//   $.get('/pass_md5/<id>/<token>', d => src = d + makePlay())
//   makePlay() = <10 random chars> + "?token=<token>&expiry=" + Date.now()
function doodMediaFromPage(html, pageUrl) {
  var media = extractMedia(html, pageUrl, true);
  if (media.length) return Promise.resolve(media);

  var m = /\/pass_md5\/[^"'\s<>]+/i.exec(html);
  if (!m) return Promise.resolve([]);
  var passPath = m[0];
  var h = hostOf(pageUrl);

  var tm = /token=([A-Za-z0-9]+)&expiry/.exec(html);
  var token = tm ? tm[1] : passPath.split('/').pop();

  return fetchText('https://' + h + passPath, {
    'User-Agent': UA_HOST,
    'Referer': pageUrl,
    'X-Requested-With': 'XMLHttpRequest'
  }, HOST_TIMEOUT).then(function (base) {
    base = String(base).trim();
    if (!/^https?:\/\//i.test(base)) {
      log('pass_md5 unexpected body: ' + base.slice(0, 60));
      return [];
    }
    return [base + randomString(10) + '?token=' + token + '&expiry=' + Date.now()];
  }).catch(function (err) {
    log('pass_md5 failed: ' + (err && err.message));
    return [];
  });
}

function decodeBase(token, radix) {
  var alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var n = 0;
  for (var i = 0; i < token.length; i++) {
    var d = alphabet.indexOf(token.charAt(i));
    if (d === -1 || d >= radix) return NaN;
    n = n * radix + d;
  }
  return n;
}

function unpackOne(payload, radix, keyStr) {
  if (!(radix >= 2 && radix <= 62)) return '';
  var words = keyStr.split('|');
  var text = payload
    .replace(/\\\\/g, '\u0001')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\u0001/g, '\\');
  return text.replace(/\b\w+\b/g, function (w) {
    var n = decodeBase(w, radix);
    var rep = (n === n && words[n]) ? words[n] : '';
    return rep ? rep : w;
  });
}

// Dean Edwards packer: eval(function(p,a,c,k,e,d){...}('payload',radix,count,'a|b'.split('|'),0,{}))
function unpackAll(text) {
  var results = [];
  var current = text;
  for (var pass = 0; pass < 3; pass++) {
    var re = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*\.split\s*\(\s*(['"])\|\7\s*\)/g;
    var found = [];
    var m;
    while ((m = re.exec(current)) !== null) {
      var u = unpackOne(m[2], parseInt(m[3], 10), m[6]);
      if (u) found.push(u);
    }
    if (!found.length) break;
    results = results.concat(found);
    current = found.join('\n');
  }
  return results;
}

function cleanMediaUrl(u, pageUrl) {
  var s = decodeEntities(String(u))
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .trim();
  return s ? absoluteUrl(s, pageUrl) : '';
}

function mediaRank(url) {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return 0;
  if (/\.mp4(?:[?#]|$)/i.test(url)) return 1;
  return 2;
}

// Direct stream URLs (m3u8 / mp4) inside a page, including packed player scripts.
function extractMedia(html, pageUrl, strict) {
  var texts = [html].concat(unpackAll(html));
  var found = [];

  function add(u) {
    var url = cleanMediaUrl(u, pageUrl);
    if (!url || !/^https?:\/\//i.test(url) || BAD_MEDIA.test(url)) return;
    if (found.indexOf(url) === -1) found.push(url);
  }

  texts.forEach(function (raw) {
    var t = raw.replace(/\\\//g, '/');
    var m;
    var r1 = /["']?(?:file|src|source|hls\d?|video_url|stream|url)["']?\s*[:=]\s*["']([^"']+?\.(?:m3u8|mp4|webm|mkv)(?:\?[^"']*)?)["']/gi;
    while ((m = r1.exec(t)) !== null) add(m[1]);
    var r2 = /["']hls\d*["']\s*:\s*["']([^"']+)["']/gi;
    while ((m = r2.exec(t)) !== null) add(m[1]);
    var r3 = /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    while ((m = r3.exec(t)) !== null) add(m[1]);
  });

  if (!found.length && !strict) {
    texts.forEach(function (raw) {
      var t = raw.replace(/\\\//g, '/');
      var m;
      var r4 = /https?:\/\/[^\s"'<>\\)]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\)]*)?/gi;
      while ((m = r4.exec(t)) !== null) add(m[0]);
    });
  }

  return found
    .map(function (u, i) { return { u: u, i: i }; })
    .sort(function (a, b) { return (mediaRank(a.u) - mediaRank(b.u)) || (a.i - b.i); })
    .map(function (x) { return x.u; });
}

// External player / embed URLs referenced by a page.
function extractHostUrls(html, pageUrl, loose) {
  var urls = [];
  function add(u) {
    var url = absoluteUrl(decodeEntities(u).replace(/\\\//g, '/').trim(), pageUrl);
    if (!/^https?:\/\//i.test(url)) return;
    var h = hostOf(url);
    if (!h || SKIP_HOST.test(h) || BAD_ASSET.test(url)) return;
    if (urls.indexOf(url) === -1) urls.push(url);
  }
  var m;
  var r1 = /<iframe\b[^>]*?\b(?:src|data-src)\s*=\s*["']([^"']+)["']/gi;
  while ((m = r1.exec(html)) !== null) add(m[1]);
  var r2 = /(?:location(?:\.href)?\s*=|window\.open\s*\()\s*["']([^"']+)["']/gi;
  while ((m = r2.exec(html)) !== null) add(m[1]);
  var r3 = /http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/gi;
  while ((m = r3.exec(html)) !== null) add(m[1]);
  if (loose) {
    var r4 = /https?:\/\/[^\s"'<>\\)]+/gi;
    while ((m = r4.exec(html)) !== null) add(m[0]);
  }
  return urls;
}

function rankHosts(urls) {
  function score(u) {
    var n = 0;
    if (isDoodHost(u)) n += 3;
    if (/embed|\/e\/|player|iframe|stream/i.test(u)) n += 2;
    if (/\.(?:php|aspx?)(?:[?#]|$)/i.test(u)) n -= 1;
    return n;
  }
  return urls
    .map(function (u, i) { return { u: u, i: i, s: score(u) }; })
    .sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); })
    .map(function (x) { return x.u; });
}

function resolveHost(hostUrl, referer, depth) {
  log('host: ' + hostUrl);
  var h = hostOf(hostUrl);
  var dood = isDoodHost(hostUrl);

  // First hop must look like the iframe on kirmalk.com (embeds are whitelisted per referring site).
  return fetchText(hostUrl, {
    'User-Agent': UA_HOST,
    'Referer': depth === 0 ? BASE_URL + '/' : referer,
    'Accept': 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'ar,en;q=0.9'
  }, HOST_TIMEOUT).then(function (html) {
    if (/Embeds disabled|Embed disabled|embedding is disabled/i.test(html)) {
      log('embed disabled by host (referer sent: ' + (depth === 0 ? BASE_URL + '/' : referer) + ') — trying /e/ and /d/');
      var codeMatch = /embed-([a-z0-9]+)\.html/i.exec(hostUrl) || /\/[ed]\/([a-z0-9]+)/i.exec(hostUrl);
      if (!codeMatch) return [];
      var alts = ['https://' + h + '/e/' + codeMatch[1], 'https://' + h + '/d/' + codeMatch[1]];
      return sequentialFirst(alts, function (alt) {
        return fetchText(alt, { 'User-Agent': UA_HOST, 'Referer': BASE_URL + '/' }, HOST_TIMEOUT).then(function (aHtml) {
          if (/Embeds disabled|Embed disabled|embedding is disabled/i.test(aHtml)) return [];
          var direct = extractMedia(aHtml, alt, false);
          if (direct.length) return [{ pageUrl: alt, media: direct }];
          return doodMediaFromPage(aHtml, alt).then(function (m3) {
            return m3.length ? [{ pageUrl: alt, media: m3 }] : [];
          });
        }).catch(function () { return []; });
      });
    }

    if (dood) {
      return doodMediaFromPage(html, hostUrl).then(function (m) {
        log('dood media found: ' + m.length);
        if (m.length) return [{ pageUrl: hostUrl, media: m }];
        if (depth >= 2) return [];
        var nested = extractHostUrls(html, hostUrl, false)
          .filter(function (u) { return hostOf(u) !== h; })
          .slice(0, 2);
        return sequentialFirst(nested, function (u) { return resolveHost(u, hostUrl, depth + 1); });
      });
    }

    var media = extractMedia(html, hostUrl, false);
    log('host media found: ' + media.length);
    if (media.length) return [{ pageUrl: hostUrl, media: media }];
    if (depth >= 2) return [];
    var nested = extractHostUrls(html, hostUrl, false)
      .filter(function (u) { return hostOf(u) !== h; })
      .slice(0, 2);
    return sequentialFirst(nested, function (u) { return resolveHost(u, hostUrl, depth + 1); });
  }).catch(function (err) {
    log('host failed: ' + (err && err.message));
    return [];
  });
}

function qualityFromUrl(url) {
  var s = String(url).toLowerCase();
  if (/2160|4k/.test(s)) return '4K';
  if (/1440/.test(s)) return '1440p';
  if (/1080/.test(s)) return '1080p';
  if (/720/.test(s)) return '720p';
  if (/480/.test(s)) return '480p';
  if (/360/.test(s)) return '360p';
  return 'Auto';
}

function buildStreams(resolved, label) {
  var streams = [];
  var seen = {};
  resolved.forEach(function (r) {
    var origin = originOf(r.pageUrl);
    r.media.forEach(function (url) {
      if (seen[url]) return;
      seen[url] = true;
      streams.push({
        name: 'Kirmalk',
        title: 'Kirmalk \u2022 ' + label,
        url: url,
        quality: qualityFromUrl(url),
        headers: { 'User-Agent': UA_HOST, 'Referer': origin + '/', 'Origin': origin }
      });
    });
  });
  return streams;
}

// vid -> embed.php (external host URL) -> host player -> direct stream(s)
function resolveVid(vid, label) {
  var watchUrl = BASE_URL + '/watch.php?vid=' + vid;
  var pages = [
    { url: BASE_URL + '/embed.php?vid=' + vid, referer: watchUrl, strict: false },
    { url: BASE_URL + '/view.php?vid=' + vid, referer: watchUrl, strict: false, loose: true },
    { url: watchUrl, referer: BASE_URL + '/', strict: true }
  ];
  return sequentialFirst(pages, function (p) {
    return siteGet(p.url, p.referer).then(function (html) {
      var direct = extractMedia(html, p.url, p.strict);
      if (direct.length) return [{ pageUrl: p.url, media: direct }];
      var hosts = rankHosts(extractHostUrls(html, p.url, p.loose || (!p.strict && html.length < 4000))).slice(0, 5);
      log(p.url.split('?')[0].replace(BASE_URL, '') + ' -> ' + hosts.length + ' host url(s)');
      return sequentialFirst(hosts, function (h) { return resolveHost(h, p.url, 0); });
    }).catch(function (err) {
      log('page failed (' + p.url.replace(BASE_URL, '') + '): ' + (err && err.message));
      return [];
    });
  }).then(function (resolved) {
    var streams = buildStreams(resolved, label);
    log('vid ' + vid + ' -> ' + streams.length + ' stream(s)');
    return streams;
  });
}

// ───────────────────────────────── Movies ───────────────────────────────

// Returns null when the upload is not this movie, otherwise a score.
function scoreMovieEntry(entry, meta) {
  var info = parseTitle(entry.title);
  if (info.kind !== 'movie') return null;
  var yearDiff = (meta.year && info.year) ? Math.abs(meta.year - info.year) : null;
  if (yearDiff !== null && yearDiff > 1) return null;

  var names = [info.name].concat(info.aliases);
  var best = 0;
  names.forEach(function (n) {
    if (!n) return;
    meta.targets.forEach(function (t) {
      if (n === t) {
        best = Math.max(best, 100);
      } else if (yearDiff !== null && Math.min(n.length, t.length) >= 4 &&
                 numberTokens(n) === numberTokens(t) && diceScore(n, t) >= 0.88) {
        best = Math.max(best, 80);
      }
    });
  });
  if (!best) return null;
  return {
    vid: entry.vid,
    title: entry.title,
    score: best + (yearDiff === 0 ? 10 : yearDiff === 1 ? 5 : 0)
  };
}

function movieStreams(meta) {
  var found = [];
  var seen = {};

  function onEntries(entries) {
    var confident = false;
    entries.forEach(function (entry) {
      if (seen[entry.vid]) return;
      var scored = scoreMovieEntry(entry, meta);
      if (!scored) return;
      seen[entry.vid] = true;
      scored.order = found.length;
      found.push(scored);
      if (scored.score >= 105) confident = true;
    });
    return confident;
  }

  var queries = buildQueries(meta, 1);
  return searchQueries(queries, onEntries, function () { return found.length > 0; }).then(function () {
    found.sort(function (a, b) { return (b.score - a.score) || (a.order - b.order); });
    log('movie candidates: ' + found.map(function (c) { return c.vid + ' (' + c.score + ')'; }).join(', '));
    var list = found.slice(0, MAX_MOVIE_CANDIDATES);
    return sequentialFirst(list, function (c) { return resolveVid(c.vid, 'فيلم'); });
  });
}

// ───────────────────────────────── Series ───────────────────────────────

// Exact name, name + trailing season digit ("الاعراف 2"), then a strict fuzzy fallback.
function matchSeriesName(info, targets) {
  var names = [info.name].concat(info.aliases).filter(Boolean);
  var ni, ti, n, t, tm;

  for (ni = 0; ni < names.length; ni++) {
    n = names[ni];
    tm = /^(.*\S)\s+(\d{1,2})$/.exec(n);
    for (ti = 0; ti < targets.length; ti++) {
      t = targets[ti];
      if (n === t) return { base: t, trailing: null };
      if (tm && tm[1] === t) return { base: t, trailing: parseInt(tm[2], 10) };
    }
  }
  for (ni = 0; ni < names.length; ni++) {
    n = names[ni];
    tm = /^(.*\S)\s+(\d{1,2})$/.exec(n);
    for (ti = 0; ti < targets.length; ti++) {
      t = targets[ti];
      if (t.length < 5) continue;
      if (tm && numberTokens(tm[1]) === numberTokens(t) && diceScore(tm[1], t) >= 0.9) {
        return { base: t, trailing: parseInt(tm[2], 10) };
      }
      if (numberTokens(n) === numberTokens(t) && diceScore(n, t) >= 0.9) {
        return { base: t, trailing: null };
      }
    }
  }
  return null;
}

function findEpisodeOnPage(group, targetEp) {
  var rep = group.entries[0];
  return siteGet(BASE_URL + '/watch.php?vid=' + rep.vid).then(function (html) {
    var list = parseEpisodeList(html);
    log('episode list (' + rep.vid + '): ' + list.length + ' episodes');
    var hit = list.filter(function (x) { return x.episode === targetEp; })[0];
    if (hit) return hit.vid;
    if (list.length) return null;
    // Fallback when the list block is missing: titles on the page for the same series + variant.
    var vid = null;
    parseWatchAnchors(html).forEach(function (a) {
      if (vid) return;
      var info = parseTitle(a.title);
      if (info.episode === targetEp && info.name === rep.name && info.variant === group.variant) vid = a.vid;
    });
    return vid;
  });
}

function resolveGroup(group, S, E, meta) {
  var targetEp = E;
  if (group.absolute) {
    var prior = meta.priorEpisodes(S);
    if (prior === null) return Promise.resolve([]);
    targetEp = prior + E;
  }
  var variantLabel = group.variant === 'dub' ? 'مدبلج' : group.variant === 'sub' ? 'مترجم' : '';
  var label = 'S' + S + 'E' + E + (variantLabel ? ' \u2022 ' + variantLabel : '');

  var direct = null;
  group.entries.forEach(function (e) { if (!direct && e.episode === targetEp) direct = e; });
  var vidP = direct ? Promise.resolve(direct.vid) : findEpisodeOnPage(group, targetEp);

  return vidP.then(function (vid) {
    if (!vid) {
      log('episode ' + targetEp + ' not found for "' + group.base + '" season ' + (group.season || '?') + ' ' + group.variant);
      return [];
    }
    return resolveVid(vid, label);
  }).catch(function (err) {
    log('group failed: ' + (err && err.message));
    return [];
  });
}

function tvStreams(meta, S, E) {
  var groups = {};
  var order = [];

  function usable() {
    return order.some(function (k) {
      var g = groups[k];
      return g.season === S || (g.season === null && S === 1);
    });
  }

  function onEntries(entries) {
    entries.forEach(function (entry) {
      var info = parseTitle(entry.title);
      if (info.kind !== 'series' && info.kind !== 'show') return;
      if (info.episode === null) return;
      var m = matchSeriesName(info, meta.targets);
      if (!m) return;
      var season = info.season || m.trailing || null;
      var key = m.base + '|' + (season || 0) + '|' + info.variant;
      var g = groups[key];
      if (!g) {
        g = groups[key] = { base: m.base, season: season, variant: info.variant, entries: [], seen: {}, absolute: false };
        order.push(key);
      }
      if (!g.seen[entry.vid]) {
        g.seen[entry.vid] = true;
        g.entries.push({ vid: entry.vid, episode: info.episode, name: info.name });
      }
    });
    return usable();
  }

  return searchQueries(buildQueries(meta, S), onEntries, null).then(function () {
    var all = order.map(function (k) { return groups[k]; });
    var exact = all.filter(function (g) { return g.season === S; });
    var plain = all.filter(function (g) { return g.season === null && S === 1; });
    var absolute = [];
    if (!exact.length && !plain.length && S > 1) {
      absolute = all.filter(function (g) { return g.season === null; });
      absolute.forEach(function (g) { g.absolute = true; });
    }
    var list = exact.concat(plain, absolute).slice(0, MAX_GROUPS);
    log('series groups: ' + list.map(function (g) {
      return g.base + ' s' + (g.season || '-') + ' ' + (g.variant || 'ar') + (g.absolute ? ' (abs)' : '');
    }).join(' | '));

    var acc = [];
    var successes = 0;
    function nextGroup(i) {
      if (i >= list.length || successes >= 2) return Promise.resolve(acc);
      return resolveGroup(list[i], S, E, meta).then(function (streams) {
        if (streams.length) { successes += 1; acc = acc.concat(streams); }
        return nextGroup(i + 1);
      });
    }
    return nextGroup(0);
  });
}

// ──────────────────────────────── Entry point ───────────────────────────

function debugStreams(reason) {
  if (!DEBUG_STREAM) return [];
  var lines = TRACE.slice(-9).map(function (l) { return l.length > 110 ? l.slice(0, 110) + '…' : l; });
  return [{
    name: 'Kirmalk DEBUG',
    title: ('NO STREAMS (' + reason + ')\n' + lines.join('\n')).slice(0, 900),
    url: BASE_URL + '/',
    quality: 'Auto',
    headers: {}
  }];
}

function getStreams(tmdbId, mediaType, season, episode) {
  TRACE = [];
  log('request: ' + tmdbId + ' ' + mediaType + ' S' + season + 'E' + episode);
  if (!tmdbId) return Promise.resolve([]);
  var type = mediaType === 'movie' ? 'movie' : mediaType === 'tv' ? 'tv' : null;
  if (!type) return Promise.resolve([]);

  var S = parseInt(season, 10);
  var E = parseInt(episode, 10);
  if (type === 'tv' && !(S >= 1 && E >= 1)) return Promise.resolve([]);

  return loadTmdb(tmdbId, type).then(function (tm) {
    var meta = buildMeta(tm, type);
    if (!meta) { log('no TMDB data'); return []; }
    log('titles: ' + meta.titles.join(' | ') + (meta.year ? ' (' + meta.year + ')' : ''));
    return type === 'movie' ? movieStreams(meta) : tvStreams(meta, S, E);
  }).then(function (streams) {
    log('final streams: ' + streams.length);
    return streams.length ? streams : debugStreams('none found');
  }).catch(function (err) {
    log('getStreams error: ' + (err && err.message));
    return debugStreams('error');
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== 'undefined') {
  global.getStreams = getStreams;
}

var BASE_URL = 'https://yam.ahwaktv.net';
var PROVIDER_ID = 'ahwaktv';
var PROVIDER_NAME = 'AhwakTV';

var TMDB_API_KEY = '83d364331c40bfbe29858aeed82f45cc';

var CONTENT_LANG = 'both';
var SKIP_DUB_SUB_ARABIC = true;

var MAX_SEARCH_PAGES = 5;
var MAX_MOVIE_CANDIDATES = 3;
var MAX_EPISODE_CANDIDATES = 4;
var MAX_SERVERS = 6;
var MAX_QUERIES = 10;
var SITE_TIMEOUT = 15000;
var EMBED_TIMEOUT = 12000;

var UA_SITE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
var UA_EMBED = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function log(message) {
  console.log('[AhwakTV] ' + message);
}

function decodeEntities(str) {
  return String(str == null ? '' : str)
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function (_, dec) { return String.fromCharCode(parseInt(dec, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function toWesternDigits(str) {
  return String(str)
    .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
}

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
    .replace(/\u0638/g, '\u0636')
    .replace(/\u0686/g, '\u062C')
    .replace(/\u067E/g, '\u0628')
    .replace(/\u06A4/g, '\u0641')
    .replace(/[\u06AF\u06A9]/g, '\u0643')
    .replace(/\u06CC/g, '\u064A');
  return s.replace(/[^\u0621-\u064Aa-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedSet(words) {
  var set = {};
  words.forEach(function (w) { set[normalizeText(w)] = true; });
  return set;
}

function cleanQuery(text) {
  return decodeEntities(text)
    .replace(/[\u060C\u061B\u061F\u066A-\u066D\u06D4]/g, ' ')
    .replace(/[!-\/:-@\[-`{-\\~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasArabicScript(text) {
  return /[\u0600-\u06FF]/.test(text);
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

var KIND_BY_WORD = {};
[
  ['فيلم', 'movie'], ['مسرحية', 'play'], ['مسلسل', 'series'], ['انمي', 'series'], ['برنامج', 'show'],
  ['movie', 'movie'], ['film', 'movie'], ['play', 'play'], ['series', 'series'], ['show', 'show'], ['anime', 'series']
].forEach(function (p) { KIND_BY_WORD[normalizeText(p[0])] = p[1]; });

var DUB_WORDS = normalizedSet(['مدبلج', 'مدبلجة', 'dubbed', 'dub']);
var SUB_WORDS = normalizedSet(['مترجم', 'مترجمة', 'subtitled', 'subbed', 'sub']);
var SEASON_WORDS = normalizedSet(['الموسم', 'موسم', 'الجزء', 'جزء', 'season']);
var EPISODE_WORDS = normalizedSet(['الحلقة', 'episode', 'ep']);
var NOISE_WORDS = normalizedSet([
  'كامل', 'كاملة', 'hd', 'fhd', 'uhd', '4k', 'bluray', 'hdrip', 'webrip', '720p', '1080p',
  'بجودة', 'جودة', 'عالية', 'اون', 'لاين', 'اونلاين', 'مشاهدة', 'مباشرة', 'يوتيوب',
  'complete', 'full', 'watch', 'online', 'streaming', 'blu-ray', 'web-rip',
  'quality', 'high', 'youtube', 'فقط', 'حصريا', 'والاخيره', 'الاخيره', 'مصري', 'كوميديا'
]);

var ORDINALS = {};
[
  ['الاول', 1], ['الاولى', 1],
  ['الثاني', 2], ['الثانية', 2],
  ['الثالث', 3], ['الثالثة', 3],
  ['الرابع', 4], ['الرابعة', 4],
  ['الخامس', 5], ['الخامسة', 5],
  ['السادس', 6], ['السادسة', 6],
  ['السابع', 7], ['السابعة', 7],
  ['الثامن', 8], ['الثامنة', 8],
  ['التاسع', 9], ['التاسعة', 9],
  ['العاشر', 10], ['العاشرة', 10]
].forEach(function (p) { ORDINALS[normalizeText(p[0])] = p[1]; });

var ORDINAL_WORDS = {
  1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع', 5: 'الخامس',
  6: 'السادس', 7: 'السابع', 8: 'الثامن', 9: 'التاسع', 10: 'العاشر',
  11: 'الحادي عشر', 12: 'الثاني عشر', 13: 'الثالث عشر', 14: 'الرابع عشر', 15: 'الخامس عشر',
  16: 'السادس عشر', 17: 'السابع عشر', 18: 'الثامن عشر', 19: 'التاسع عشر', 20: 'العشرون',
  21: 'الحادي والعشرون', 22: 'الثاني والعشرون', 23: 'الثالث والعشرون', 24: 'الرابع والعشرون',
  25: 'الخامس والعشرون', 26: 'السادس والعشرون', 27: 'السابع والعشرون', 28: 'الثامن والعشرون',
  29: 'التاسع والعشرون', 30: 'الثلاثون'
};

function arabicOrdinal(n) {
  return ORDINAL_WORDS[n] || null;
}

function readOrdinal(tokens, i) {
  var t = tokens[i];
  if (t === undefined || t === null) return null;

  if (ORDINALS[t] !== undefined) {
    var base = ORDINALS[t];
    var next = tokens[i + 1];
    if (next === 'عشر' && base >= 1 && base <= 9) {
      return { value: base + 10, len: 2 };
    }
    if ((next === 'والعشرون' || next === 'والعشرين') && base >= 1 && base <= 9) {
      return { value: base + 20, len: 2 };
    }
    return { value: base, len: 1 };
  }

  if (t === 'العشرون' || t === 'العشرين') return { value: 20, len: 1 };
  if (t === 'الثلاثون' || t === 'الثلاثين') return { value: 30, len: 1 };

  return null;
}

function stripParentheses(text) {
  return text.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
}

function parseTitle(raw) {
  var info = { kind: null, name: '', year: null, season: null, episode: null, dubbed: false, subbed: false };
  var cleaned = stripParentheses(String(raw || '').split('|')[0]);
  var tokens = normalizeText(cleaned).split(' ').filter(Boolean);

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

  var episodic = info.kind === 'series' || info.kind === 'show';
  if (!episodic && info.kind !== 'movie' && info.kind !== 'play') {
    for (var ei = 0; ei < tokens.length; ei++) {
      if (EPISODE_WORDS[tokens[ei]] || SEASON_WORDS[tokens[ei]]) { episodic = true; break; }
    }
  }

  if (episodic) {
    var epIdx = -1;
    for (var e = 0; e < tokens.length; e++) {
      if (EPISODE_WORDS[tokens[e]]) { epIdx = e; break; }
    }

    if (epIdx !== -1) {
      var afterEp = tokens[epIdx + 1];
      if (afterEp && /^\d+$/.test(afterEp)) {
        info.episode = parseInt(afterEp, 10);
        tokens.splice(epIdx, 2);

        var ci = epIdx;
        while (ci < tokens.length) {
          var ord = readOrdinal(tokens, ci);
          if (ord && ord.value === info.episode) {
            tokens.splice(ci, ord.len);
            continue;
          }
          if (tokens[ci] === 'والاخيره' || tokens[ci] === 'الاخيره') {
            tokens.splice(ci, 1);
            continue;
          }
          if (tokens[ci] === 'و' && tokens[ci + 1] === 'الاخيره') {
            tokens.splice(ci, 2);
            continue;
          }
          break;
        }
      } else {
        var epOrd = readOrdinal(tokens, epIdx + 1);
        if (epOrd) {
          info.episode = epOrd.value;
          tokens.splice(epIdx, 1 + epOrd.len);
        }
      }
    }

    for (var i = 0; i < tokens.length; i++) {
      if (SEASON_WORDS[tokens[i]]) {
        var sOrd = readOrdinal(tokens, i + 1);
        if (sOrd) {
          info.season = sOrd.value;
          tokens.splice(i, 1 + sOrd.len);
          break;
        }
        if (/^\d{1,2}$/.test(tokens[i + 1] || '')) {
          info.season = parseInt(tokens[i + 1], 10);
          tokens.splice(i, 2);
          break;
        }
      }
    }
  } else {
    for (var j = tokens.length - 1; j >= 0; j--) {
      if (/^(19|20)\d\d$/.test(tokens[j])) {
        if (tokens.length > 1) { info.year = parseInt(tokens[j], 10); tokens.splice(j, 1); }
        break;
      }
    }
  }

  info.name = tokens.filter(function (t) { return !NOISE_WORDS[t]; }).join(' ');
  return info;
}

function asciiSafe(value) {
  return String(value).replace(/[^\x00-\x7F]/g, function (c) { return encodeURIComponent(c); });
}

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

function fetchText(url, headers, timeoutMs) {
  url = asciiSafe(url);
  if (headers && headers['Referer']) headers['Referer'] = asciiSafe(headers['Referer']);
  return withTimeout(fetch(url, { method: 'GET', headers: headers, redirect: 'follow' }), timeoutMs, url.split('?')[0])
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url.split('?')[0]);
      return res.text();
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

function hostOf(url) {
  var m = /^https?:\/\/([^\/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

function originOf(url) {
  var m = /^(https?:\/\/[^\/?#]+)/i.exec(url);
  return m ? m[1] : '';
}

function absoluteUrl(url, baseUrl) {
  var u = decodeEntities(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return originOf(baseUrl) + u;
  return '';
}

function getAttr(tag, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : '';
}

function parseWatchAnchors(html) {
  var byVid = {};
  var out = [];
  var re = /<a\b[^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var tag = m[0];
    var idMatch = /watch\.php\?vid=([A-Za-z0-9]+)/.exec(decodeEntities(getAttr(tag, 'href')));
    if (!idMatch) continue;
    var vid = idMatch[1];
    var title = decodeEntities(getAttr(tag, 'title')).trim();
    var closeAt = html.indexOf('</a>', re.lastIndex);
    var inner = closeAt === -1 ? '' : html.slice(re.lastIndex, Math.min(closeAt, re.lastIndex + 400));
    var text = decodeEntities(inner.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (byVid[vid]) {
      if (!byVid[vid].title && title) byVid[vid].title = title;
      if (inner && inner.indexOf('<em') !== -1) byVid[vid].htmlInner = inner;
      continue;
    }
    byVid[vid] = { vid: vid, title: title, text: text, index: m.index, htmlInner: inner };
    out.push(byVid[vid]);
  }
  return out;
}

function parseMaxPage(html) {
  var max = 1;
  var re = /[?&;]page=(\d+)/g;
  var m;
  while ((m = re.exec(html)) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

function fetchTmdb(tmdbId, type) {
  var url = 'https://api.themoviedb.org/3/' + type + '/' + encodeURIComponent(tmdbId) +
    '?api_key=' + TMDB_API_KEY + '&language=ar&append_to_response=translations,alternative_titles';
  return fetchText(url, { 'Accept': 'application/json' }, SITE_TIMEOUT).then(function (body) {
    return JSON.parse(body);
  });
}

function buildMeta(data, type) {
  var isTv = type === 'tv';
  var raw = [isTv ? data.name : data.title, isTv ? data.original_name : data.original_title];

  var translations = (data.translations && data.translations.translations) || [];
  translations.forEach(function (t) {
    if (t.iso_639_1 === 'ar' && t.data) raw.push(isTv ? t.data.name : t.data.title);
    if (t.iso_639_1 === 'en' && t.data) raw.push(isTv ? t.data.name : t.data.title);
  });

  if (!isTv) {
    var alts = (data.alternative_titles && data.alternative_titles.titles) || [];
    alts.forEach(function (a) { raw.push(a.title); });
  }

  var arabic = data.original_language === 'ar';
  var english = data.original_language === 'en';

  var processable = true;
  if (CONTENT_LANG === 'arabic' && !arabic) processable = false;
  if (CONTENT_LANG === 'english' && !english) processable = false;

  var seenNorm = {};
  var titles = [];
  raw.forEach(function (t) {
    if (!t) return;
    if (arabic && !hasArabicScript(t)) return;
    var norm = normalizeText(t);
    if (!norm || seenNorm[norm]) return;
    seenNorm[norm] = true;
    titles.push({ raw: t, norm: norm });
  });

  var englishTitle = '';
  for (var e = 0; e < titles.length; e++) {
    if (!hasArabicScript(titles[e].raw)) { englishTitle = titles[e].raw; break; }
  }

  var dateStr = isTv ? data.first_air_date : data.release_date;
  var year = dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;

  return {
    type: type,
    arabic: arabic,
    english: english,
    processable: processable,
    year: isNaN(year) ? null : year,
    displayTitle: titles.length ? titles[0].raw : (isTv ? data.name : data.title),
    englishTitle: englishTitle,
    targets: titles.map(function (t) { return t.norm; }),
    rawTitles: titles.slice(0, 4).map(function (t) { return t.raw; }),
    slugTitles: (function () {
      var seen = {};
      var out = [];
      raw.forEach(function (t) {
        if (!t) return;
        var norm = normalizeText(t);
        if (!norm || seen[norm]) return;
        seen[norm] = true;
        out.push(t);
      });
      return out.slice(0, 6);
    })(),
    queries: titles.slice(0, 3).map(function (t) { return cleanQuery(t.raw); }).filter(Boolean)
  };
}

function buildQueries(title, meta, type, season, episode) {
  var queries = [];
  var seen = {};

  function add(q) {
    if (!q) return;
    q = cleanQuery(q);
    if (!q) return;
    var key = q.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    queries.push(q);
  }

  add(title);
  if (meta.englishTitle && meta.englishTitle !== title) add(meta.englishTitle);
  if (type === 'tv') {
    add('مسلسل ' + title);
    if (meta.englishTitle && meta.englishTitle !== title) add('مسلسل ' + meta.englishTitle);
  }

  if (type === 'tv' && season) {
    var arSeason = arabicOrdinal(season);
    var epWord = episode && EP_ORDINALS[episode];
    if (episode) {
      if (epWord) add(title + ' الحلقة ' + episode + ' ' + epWord);
      add(title + ' الحلقة ' + episode);
      add(title + ' الموسم ' + season + ' الحلقة ' + episode);
      if (arSeason) add(title + ' الموسم ' + arSeason + ' الحلقة ' + episode);
      add(title + ' ' + season + ' الحلقة ' + episode);
      add(title + ' الجزء ' + season + ' الحلقة ' + episode);
      if (arSeason) add(title + ' الجزء ' + arSeason + ' الحلقة ' + episode);
    }
    if (arSeason) add(title + ' الموسم ' + arSeason);
    add(title + ' ' + season);
    add(title + ' الجزء ' + season);
    if (arSeason) add(title + ' الجزء ' + arSeason);
  }

  if (type === 'movie' && meta.year) {
    add(title + ' ' + meta.year);
  }

  if (meta.arabic) {
    if (title.indexOf('ال') === 0) add(title.slice(2));
    add(title.replace(/^(مسلسل|فيلم|مسرحية)\s+/, ''));
  }

  if (meta.englishTitle && meta.englishTitle !== title) {
    add(meta.englishTitle);
    if (type === 'tv' && season && episode) {
      var epWordEn = EP_ORDINALS[episode];
      if (epWordEn) add(meta.englishTitle + ' الحلقة ' + episode + ' ' + epWordEn);
      add(meta.englishTitle + ' الحلقة ' + episode);
      add(meta.englishTitle + ' الموسم ' + season + ' الحلقة ' + episode);
      add(meta.englishTitle + ' الجزء ' + season + ' الحلقة ' + episode);
    }
  }

  return queries;
}

function strictTitleMatch(parsedName, targets) {
  var parsedTokens = normalizeText(parsedName).split(' ').filter(Boolean);
  if (!parsedTokens.length) return { matched: false };
  var parsedStr = parsedTokens.join(' ');

  for (var i = 0; i < targets.length; i++) {
    var targetTokens = normalizeText(targets[i]).split(' ').filter(Boolean);
    if (!targetTokens.length) continue;
    var targetStr = targetTokens.join(' ');

    if (parsedStr === targetStr) return { matched: true, targetIndex: i };

    if (targetTokens.length === 1) {
      if (parsedTokens.indexOf(targetTokens[0]) !== -1) return { matched: true, targetIndex: i, partial: true };
      continue;
    }

    for (var start = 0; start <= parsedTokens.length - targetTokens.length; start++) {
      var ok = true;
      for (var j = 0; j < targetTokens.length; j++) {
        if (parsedTokens[start + j] !== targetTokens[j]) { ok = false; break; }
      }
      if (ok) return { matched: true, targetIndex: i };
    }
  }
  return { matched: false };
}

function searchPage(query, page) {
  var url = BASE_URL + '/search.php?keywords=' + encodeURIComponent(query) +
    (page > 1 ? '&page=' + page : '');
  return siteGet(url).then(function (html) {
    return {
      entries: parseWatchAnchors(html).filter(function (a) { return a.title; }),
      maxPage: parseMaxPage(html)
    };
  });
}

function searchPages(query, onEntries) {
  var page = 1;
  function step() {
    return searchPage(query, page).then(function (res) {
      if (onEntries(res.entries)) return true;
      if (page >= MAX_SEARCH_PAGES || page >= res.maxPage) return false;
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
  function nextQuery() {
    if (qi >= queries.length) return Promise.resolve(false);
    return searchPages(queries[qi++], onEntries).then(function (stop) {
      if (stop || (afterQuery && afterQuery())) return true;
      return nextQuery();
    });
  }
  return nextQuery();
}

function scoreMovieEntry(entry, meta) {
  var info = parseTitle(entry.title);
  if (info.kind !== 'movie' && info.kind !== 'play') return null;
  if (meta.arabic && SKIP_DUB_SUB_ARABIC && (info.dubbed || info.subbed)) return null;

  var yearDiff = meta.year && info.year ? Math.abs(meta.year - info.year) : null;
  if (yearDiff !== null && yearDiff > 1) return null;

  var match = strictTitleMatch(info.name, meta.targets);
  if (!match.matched) return null;

  return {
    vid: entry.vid,
    title: entry.title,
    year: info.year,
    score: 100 + (yearDiff === 0 ? 10 : yearDiff === 1 ? 5 : 0),
    confident: yearDiff !== null || !meta.year
  };
}

function findMovieCandidates(meta) {
  var found = [];
  var seen = {};
  var queries = buildQueries(meta.displayTitle, meta, 'movie', null, null).slice(0, MAX_QUERIES);

  function onEntries(entries) {
    var confident = false;
    entries.forEach(function (entry) {
      if (seen[entry.vid]) return;
      var scored = scoreMovieEntry(entry, meta);
      if (!scored) return;
      seen[entry.vid] = true;
      scored.order = found.length;
      found.push(scored);
      if (scored.confident) confident = true;
    });
    return confident;
  }

  return searchQueries(queries, onEntries, function () { return found.length > 0; }).then(function () {
    return found.sort(function (a, b) { return (b.score - a.score) || (a.order - b.order); });
  });
}

function yearAcceptable(candidate, meta) {
  if (candidate.year || !meta.year) return Promise.resolve(true);
  return siteGet(BASE_URL + '/watch.php?vid=' + candidate.vid).then(function (html) {
    var head = [];
    var desc = /<meta[^>]+name=["']description["'][^>]*>/i.exec(html);
    var title = /<title>([^<]*)<\/title>/i.exec(html);
    if (desc) head.push(getAttr(desc[0], 'content'));
    if (title) head.push(title[1]);
    var years = (toWesternDigits(decodeEntities(head.join(' '))).match(/\b(?:19|20)\d\d\b/g) || []).map(Number);
    if (!years.length) return true;
    return years.some(function (y) { return Math.abs(y - meta.year) <= 1; });
  }).catch(function () { return true; });
}

function getMovieStreams(meta, title) {
  return findMovieCandidates(meta).then(function (candidates) {
    log('movie candidates: ' + candidates.map(function (c) { return c.vid + '(' + c.score + ')'; }).join(', '));
    var list = candidates.slice(0, MAX_MOVIE_CANDIDATES);
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve([]);
      var cand = list[i++];
      return yearAcceptable(cand, meta).then(function (ok) {
        if (!ok) return next();
        return getServerStreams(cand.vid, title).catch(function (err) {
          log('servers failed for ' + cand.vid + ': ' + (err && err.message));
          return [];
        }).then(function (streams) {
          return streams.length ? streams : next();
        });
      });
    }
    return next();
  });
}

function matchFlexible(name, targets) {
  var tokens = normalizeText(name).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  var joined = tokens.join(' ');
  var t;
  for (t = 0; t < targets.length; t++) {
    if (joined === targets[t]) return { season: null, targetIndex: t };
  }
  for (t = 0; t < targets.length; t++) {
    var tt = String(targets[t] || '').split(' ').filter(Boolean);
    if (!tt.length || tokens.length < tt.length) continue;
    var ok = true;
    for (var j = 0; j < tt.length; j++) {
      if (tokens[j] !== tt[j]) { ok = false; break; }
    }
    if (!ok) continue;
    var rest = tokens.slice(tt.length);
    var season = null;
    if (rest.length && /^\d{1,2}$/.test(rest[0])) {
      var n = parseInt(rest[0], 10);
      if (n >= 1 && n <= 40) {
        season = n;
        rest = rest.slice(1);
      }
    }
    if (rest.length && season === null) continue;
    if (rest.length > 5) continue;
    return { season: season, targetIndex: t };
  }
  return null;
}

function seasonHintOf(info, mm) {
  if (info && info.season != null) return info.season;
  if (mm && mm.season != null) return mm.season;
  return null;
}

var SITE_TITLE_NOISE = normalizedSet([
  'اهواك', 'تي', 'في', 'مشاهده', 'افلام', 'مسلسلات', 'رمضان', 'جميع', 'المواسم',
  'الملفات', 'الحلقات', 'اون', 'لاين', 'موقع', 'مشاهدة'
]);

function cleanHead(text) {
  var tokens = normalizeText(stripParentheses(String(text || '').split('|')[0])).split(' ').filter(Boolean);
  if (tokens.length && KIND_BY_WORD[tokens[0]]) tokens.shift();
  tokens = tokens.filter(function (t) {
    return !SITE_TITLE_NOISE[t] && !NOISE_WORDS[t] && !DUB_WORDS[t] && !SUB_WORDS[t] && !/^(19|20)\d\d$/.test(t);
  });
  return tokens.join(' ');
}

function headingTexts(html) {
  var out = [];
  var tm = /<title>([^<]*)<\/title>/i.exec(html);
  if (tm) out.push(decodeEntities(tm[1]));
  var re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    out.push(decodeEntities(m[1].replace(/<[^>]+>/g, ' ')));
  }
  return out;
}

function hubMatches(html, targets) {
  if (!html) return false;
  if (/هذا المسلسل غير متوفر/.test(html) && !/id=["']Season\d+["']/.test(html)) return false;
  var heads = headingTexts(html);
  for (var i = 0; i < heads.length; i++) {
    var name = cleanHead(heads[i]);
    if (name && targets.indexOf(name) !== -1) return true;
  }
  return false;
}

function episodeFromAnchor(a) {
  var info = parseTitle(a.title || '');
  var ep = info.episode;
  if (ep == null && a.htmlInner) {
    var em = /<em>\s*([0-9]{1,4})\s*<\/em>/i.exec(a.htmlInner);
    if (em) ep = parseInt(em[1], 10);
  }
  if (ep == null && a.text && String(a.text).length < 24) {
    var n = /\d+/.exec(toWesternDigits(a.text));
    if (n) ep = parseInt(n[0], 10);
  }
  return { info: info, episode: ep };
}

function parseSeasonBlocks(html) {
  var marks = [];
  var re = /id=["']Season(\d+)["']/gi;
  var m;
  while ((m = re.exec(html)) !== null) marks.push({ season: parseInt(m[1], 10), index: m.index });
  var blocks = [];
  for (var i = 0; i < marks.length; i++) {
    var end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    var chunk = html.slice(marks[i].index, end);
    var ulEnd = chunk.search(/<\/ul>/i);
    if (ulEnd !== -1) chunk = chunk.slice(0, ulEnd);
    var rel = chunk.search(/id=["']pm-related["']|قد يعجبك|pm-video-watch-sidebar/i);
    if (rel !== -1) chunk = chunk.slice(0, rel);
    var anchors = parseWatchAnchors(chunk);
    var episodes = [];
    var seenVid = {};
    var seenEp = {};
    anchors.forEach(function (a) {
      if (seenVid[a.vid]) return;
      seenVid[a.vid] = true;
      var parsed = episodeFromAnchor(a);
      if (parsed.episode == null) return;
      if (seenEp[parsed.episode]) return;
      seenEp[parsed.episode] = true;
      episodes.push({ episode: parsed.episode, vid: a.vid, info: parsed.info, title: a.title || '' });
    });
    blocks.push({ season: marks[i].season, episodes: episodes });
  }
  return blocks;
}

function pickEpisode(blocks, season, episode, arabic) {
  var block = null;
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].season === season) block = blocks[i];
  }
  if (!block) return null;
  var opts = block.episodes.filter(function (e) { return e.episode === episode; });
  if (arabic && SKIP_DUB_SUB_ARABIC) {
    var clean = opts.filter(function (e) { return !(e.info && (e.info.dubbed || e.info.subbed)); });
    if (clean.length) opts = clean;
    else if (opts.length) return null;
  }
  return opts.length ? opts[0].vid : null;
}

function findFlat(html, targets, season, episode, arabic) {
  var anchors = parseWatchAnchors(html);
  var seen = {};
  var hit = null;
  anchors.forEach(function (a) {
    if (hit || seen[a.vid] || !a.title) return;
    seen[a.vid] = true;
    var info = parseTitle(a.title);
    if (info.kind === 'movie' || info.kind === 'play' || info.episode == null) return;
    if (arabic && SKIP_DUB_SUB_ARABIC && (info.dubbed || info.subbed)) return;
    var mm = matchFlexible(info.name, targets);
    if (!mm) return;
    var hint = seasonHintOf(info, mm);
    if (hint == null) hint = 1;
    if (hint === season && info.episode === episode) hit = a.vid;
  });
  return hit;
}

var EP_ORDINALS = {
  1: 'الاولي', 2: 'الثانية', 3: 'الثالثة', 4: 'الرابعة', 5: 'الخامسة',
  6: 'السادسة', 7: 'السابعة', 8: 'الثامنة', 9: 'التاسعة', 10: 'العاشرة'
};

function episodeOrdinalInQuery(tokens, episode) {
  var word = EP_ORDINALS[episode];
  if (!word) return false;
  var norm = normalizeText(word);
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i] === norm) return true;
  }
  return false;
}

function seriesQueryRank(query, season, episode) {
  var tokens = normalizeText(query).split(' ').filter(Boolean);
  var hasEp = false;
  var hasSeason = false;
  for (var i = 0; i < tokens.length; i++) {
    if (EPISODE_WORDS[tokens[i]] && tokens[i + 1] === String(episode)) hasEp = true;
    if (SEASON_WORDS[tokens[i]]) hasSeason = true;
  }
  if (!hasSeason) {
    for (var j = 0; j < tokens.length; j++) {
      if (tokens[j] === String(season) && !EPISODE_WORDS[tokens[j - 1]]) hasSeason = true;
    }
  }
  if (hasEp && hasSeason) return 0;
  if (hasEp && episodeOrdinalInQuery(tokens, episode)) return 0;
  if (hasEp) return 1;
  if (hasSeason) return 2;
  return 3;
}

function queryUsesEnglishTitle(query, meta) {
  if (!meta || !meta.englishTitle) return false;
  var nameTokens = normalizeText(meta.englishTitle).split(' ').filter(Boolean);
  if (!nameTokens.length) return false;
  var tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens[0] === normalizeText('مسلسل') || tokens[0] === normalizeText('فيلم')) tokens.shift();
  if (tokens.length < nameTokens.length) return false;
  for (var i = 0; i < nameTokens.length; i++) {
    if (tokens[i] !== nameTokens[i]) return false;
  }
  return true;
}

function prioritizeSeriesQueries(queries, season, episode, meta) {
  var preferLatin = meta && !meta.arabic && meta.englishTitle;
  return queries.map(function (q, i) {
    return { q: q, i: i, r: seriesQueryRank(q, season, episode) };
  }).sort(function (a, b) {
    if (a.r !== b.r) return a.r - b.r;
    if (preferLatin) {
      var ae = queryUsesEnglishTitle(a.q, meta);
      var be = queryUsesEnglishTitle(b.q, meta);
      if (ae !== be) return ae ? -1 : 1;
    }
    return a.i - b.i;
  }).map(function (x) { return x.q; });
}

function isDirectEpisode(m, season, episode) {
  if (!m || !m.info || m.info.episode !== episode) return false;
  if (m.seasonHint === season) return true;
  return season === 1 && m.seasonHint == null;
}

function hubUrls(meta) {
  var urls = [];
  var seen = {};
  function add(url) {
    if (!url || seen[url]) return;
    seen[url] = true;
    urls.push(url);
  }
  var sources = (meta.slugTitles && meta.slugTitles.length) ? meta.slugTitles : (meta.rawTitles || []);
  var items = [];
  sources.forEach(function (raw) {
    var clean = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (hasArabicScript(clean)) {
      var hyph = clean.replace(/\s+/g, '-');
      items.push({
        ar: true,
        hyph: hyph,
        yeh: hyph.replace(/\u064A/g, '\u0649'),
        bare: hyph.replace(/\u0623/g, '\u0627').replace(/\u0625/g, '\u0627')
      });
    } else {
      var folded = clean;
      if (typeof folded.normalize === 'function') folded = folded.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var slug = folded.replace(/['’"\.:,!؟?]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      items.push({ ar: false, low: slug.toLowerCase(), rawSlug: slug });
    }
  });
  function wave(fn) {
    items.forEach(function (it) {
      var path = fn(it);
      if (path) add(BASE_URL + path);
    });
  }
  wave(function (it) {
    return '/view-serie.php?name=' + encodeURIComponent(it.ar ? it.hyph : it.low);
  });
  wave(function (it) {
    return '/view-serie.php?name=' + encodeURIComponent('مسلسل-' + (it.ar ? it.hyph : it.low));
  });
  wave(function (it) {
    if (it.ar) return '/view-serie.php?name=' + encodeURIComponent(it.hyph + '-مترجم');
    return '/view-serie.php?name=' + encodeURIComponent('مسلسل-' + it.low + '-مترجم');
  });
  wave(function (it) {
    if (it.ar) return '/view-serie.php?name=' + encodeURIComponent(it.hyph + '-مدبلج');
    return '/category.php?cat=' + encodeURIComponent(it.rawSlug + '-series-full-episodes');
  });
  wave(function (it) {
    if (!it.ar) return null;
    if (it.yeh !== it.hyph) return '/view-serie.php?name=' + encodeURIComponent(it.yeh);
    if (it.bare !== it.hyph) return '/view-serie.php?name=' + encodeURIComponent(it.bare);
    return null;
  });
  return urls.slice(0, 8);
}

function loadHubs(meta) {
  return Promise.all(hubUrls(meta).map(function (url) {
    return siteGet(url).then(function (html) {
      if (!hubMatches(html, meta.targets)) return null;
      return { url: url, html: html, blocks: parseSeasonBlocks(html) };
    }).catch(function () { return null; });
  })).then(function (list) { return list.filter(Boolean); });
}

function findSeriesMatches(meta, season, episode) {
  var matched = [];
  var seen = {};

  function absorb(entries) {
    var added = 0;
    entries.forEach(function (entry) {
      if (seen[entry.vid]) return;
      var info = parseTitle(entry.title || '');
      if (info.kind === 'movie' || info.kind === 'play' || info.episode == null) return;
      if (meta.arabic && SKIP_DUB_SUB_ARABIC && (info.dubbed || info.subbed)) return;
      var mm = matchFlexible(info.name, meta.targets);
      if (!mm) return;
      seen[entry.vid] = true;
      var hint = seasonHintOf(info, mm);
      matched.push({ vid: entry.vid, title: entry.title, info: info, seasonHint: hint, partial: !!mm.partial });
      added++;
    });
    return added;
  }

  function exactDirect() {
    return matched.some(function (m) { return !m.partial && isDirectEpisode(m, season, episode); });
  }

  var queries = prioritizeSeriesQueries(
    buildQueries(meta.displayTitle, meta, 'tv', season, episode),
    season,
    episode,
    meta
  ).slice(0, MAX_QUERIES);
  var qi = 0;
  var WAVE = 4;

  function searchOne(query, page) {
    return searchPage(query, page).then(function (res) {
      return res.entries;
    }).catch(function (err) {
      log('search failed (' + query + ' p' + page + '): ' + (err && err.message));
      return [];
    });
  }

  function finishSpecific() {
    if (exactDirect() || !matched.length) return Promise.resolve(matched);
    var top = [];
    for (var i = 0; i < queries.length && top.length < 2; i++) {
      if (seriesQueryRank(queries[i], season, episode) <= 1) top.push(queries[i]);
    }
    if (!top.length) return Promise.resolve(matched);
    return Promise.all(top.map(function (q) { return searchOne(q, 2); })).then(function (groups) {
      groups.forEach(absorb);
      return matched;
    });
  }

  function wave() {
    if (exactDirect()) return Promise.resolve(matched);
    if (qi >= queries.length) return finishSpecific();
    var nextRank = seriesQueryRank(queries[qi], season, episode);
    if (nextRank >= 2) {
      if (matched.length) return finishSpecific();
      var bare = queries[qi];
      return searchOne(bare, 1).then(function (entries) {
        absorb(entries);
        return matched;
      });
    }
    var batch = [];
    while (batch.length < WAVE && qi < queries.length && seriesQueryRank(queries[qi], season, episode) <= 1) {
      batch.push(queries[qi++]);
    }
    return Promise.all(batch.map(function (q) { return searchOne(q, 1); })).then(function (groups) {
      groups.forEach(absorb);
      return wave();
    });
  }

  return wave();
}

function serieUrlFromWatch(html) {
  var m = /href\s*=\s*["']([^"']*view-serie\.php\?[^"']+)["']/i.exec(html || '');
  return m ? absoluteUrl(m[1], BASE_URL) : '';
}

function probeMatches(matches, meta, season, episode, limit) {
  var ordered = [];
  function take(pred) {
    matches.forEach(function (m) {
      if (pred(m) && ordered.indexOf(m) === -1) ordered.push(m);
    });
  }
  take(function (m) { return m.seasonHint === season && !m.partial; });
  take(function (m) { return m.seasonHint === season; });
  take(function (m) { return m.seasonHint == null && !m.partial; });
  take(function (m) { return m.seasonHint == null; });
  take(function () { return true; });

  var slice = ordered.slice(0, limit || 5);
  var i = 0;
  var seenHub = {};
  function next() {
    if (i >= slice.length) return Promise.resolve(null);
    var item = slice[i++];
    return siteGet(BASE_URL + '/watch.php?vid=' + item.vid).then(function (html) {
      var serie = serieUrlFromWatch(html);
      if (!serie || seenHub[serie]) return next();
      seenHub[serie] = true;
      return siteGet(serie, BASE_URL + '/watch.php?vid=' + item.vid).then(function (serieHtml) {
        if (!hubMatches(serieHtml, meta.targets)) return next();
        var vid = pickEpisode(parseSeasonBlocks(serieHtml), season, episode, meta.arabic);
        if (vid) return vid;
        return findFlat(serieHtml, meta.targets, season, episode, meta.arabic) || next();
      }, function () { return next(); });
    }).catch(function () { return next(); });
  }
  return next();
}

function collectSeriesVids(meta, season, episode) {
  return loadHubs(meta).then(function (hubs) {
    var vids = [];
    function add(v) { if (v && vids.indexOf(v) === -1) vids.push(v); }
    hubs.forEach(function (h) {
      add(pickEpisode(h.blocks, season, episode, meta.arabic));
      if (!h.blocks.length) add(findFlat(h.html, meta.targets, season, episode, meta.arabic));
    });
    log('hubs ' + hubs.map(function (h) { return h.url.replace(BASE_URL, ''); }).join(' | ') + ' vids=' + vids.join(','));
    if (vids.length) return vids;
    return findSeriesMatches(meta, season, episode).then(function (matches) {
      log('series title hits: ' + matches.length);
      function addMatching(pred) {
        matches.forEach(function (m) { if (pred(m) && !m.partial) add(m.vid); });
        matches.forEach(function (m) { if (pred(m) && m.partial) add(m.vid); });
      }
      var explicit = matches.some(function (m) {
        return !m.partial && m.info.episode === episode && m.seasonHint === season;
      });
      addMatching(function (m) { return m.info.episode === episode && m.seasonHint === season; });
      if (season === 1) {
        addMatching(function (m) { return m.info.episode === episode && m.seasonHint == null; });
      }
      if (explicit) return vids;
      var probeLimit = vids.length ? 1 : 2;
      return probeMatches(matches, meta, season, episode, probeLimit).then(function (probed) {
        if (probed) {
          var at = vids.indexOf(probed);
          if (at !== -1) vids.splice(at, 1);
          vids.unshift(probed);
        }
        return vids;
      });
    });
  });
}

function getSeriesStreams(meta, season, episode, title) {
  return collectSeriesVids(meta, season, episode).then(function (vids) {
    var list = vids.slice(0, MAX_EPISODE_CANDIDATES);
    log('episode vids: ' + list.join(', '));
    if (!list.length) return [];
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve([]);
      var vid = list[i++];
      return getServerStreams(vid, title).catch(function (err) {
        log('servers failed for ' + vid + ': ' + (err && err.message));
        return [];
      }).then(function (streams) {
        return streams.length ? streams : next();
      });
    }
    return next();
  });
}

function fetchEmbedUrls(vid) {
  return siteGet(BASE_URL + '/see.php?vid=' + vid, BASE_URL + '/watch.php?vid=' + vid).then(function (html) {
    var urls = [];
    var seen = {};
    var re = /data-embed-url\s*=\s*["']([^"']+)["']/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var url = absoluteUrl(m[1], BASE_URL);
      if (!url || seen[url] || hostOf(url) === hostOf(BASE_URL)) continue;
      seen[url] = true;
      urls.push(url);
    }
    if (!urls.length) {
      var ire = /<iframe\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;
      while ((m = ire.exec(html)) !== null) {
        var u = absoluteUrl(m[1], BASE_URL);
        if (!u || seen[u] || hostOf(u) === hostOf(BASE_URL)) continue;
        seen[u] = true;
        urls.push(u);
      }
    }
    return urls;
  });
}

function serverLabel(host) {
  if (/(^|\.)vk\.com\( |(^|\.)vkvideo\.ru \)/.test(host)) return 'VK';
  if (/(^|\.)ok\.ru$/.test(host)) return 'OK.ru';
  if (/uqload/.test(host)) return 'Uqload';
  if (/vidmoly/.test(host)) return 'Vidmoly';
  if (/1vid/.test(host)) return '1vid';
  if (/mixdrop|mxdrop/.test(host)) return 'Mixdrop';
  if (/vidspeed/.test(host)) return 'Vidspeed';
  if (/hgcloud/.test(host)) return 'HGCloud';
  if (/vidhide/.test(host)) return 'VidHide';
  if (/listeamed/.test(host)) return 'Listeamed';
  return host.split('.').slice(-2, -1)[0] || host;
}

function qualityFromUrl(url) {
  var m = /(\d{3,4})p\b/i.exec(url);
  return m ? m[1] + 'p' : null;
}

function cleanMediaUrl(url) {
  return String(url)
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function unpackAll(text) {
  var out = [];
  if (text.indexOf('p,a,c,k,e') === -1) return out;
  var digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var patterns = [
    /\}\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\[\s\S])*)'\s*\.split\(\s*'\|'\s*\)/g,
    /\}\(\s*"((?:[^"\\]|\\[\s\S])*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\[\s\S])*)"\s*\.split\(\s*"\|"\s*\)/g
  ];
  patterns.forEach(function (re) {
    var m;
    while ((m = re.exec(text)) !== null) {
      var radix = parseInt(m[2], 10);
      var words = m[4].split('|');
      var payload = m[1].replace(/\\\\/g, '\\').replace(/\\'/g, "'").replace(/\\"/g, '"');
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
    /["'](https?:\\?\/\\?\/[^"'\s]+?\.(?:m3u8|mp4)[^"'\s]*)["']/gi
  ];
  var found = [];
  var seen = {};
  patterns.forEach(function (re) {
    var m;
    while ((m = re.exec(text)) !== null) {
      var url = absoluteUrl(cleanMediaUrl(m[1]), baseUrl);
      if (!url || seen[url] || BAD_ASSET.test(url)) continue;
      seen[url] = true;
      found.push(url);
    }
  });
  return found;
}

function embedHeaders(embedUrl) {
  var origin = originOf(embedUrl);
  return { 'User-Agent': UA_EMBED, 'Referer': origin + '/', 'Origin': origin };
}

function extractGeneric(embedUrl) {
  return fetchText(embedUrl, { 'User-Agent': UA_EMBED, 'Referer': BASE_URL + '/', 'Accept-Language': 'ar,en;q=0.9' }, EMBED_TIMEOUT)
    .then(function (html) {
      var texts = [html].concat(unpackAll(html));
      var urls = [];
      texts.forEach(function (t) {
        scanMediaUrls(t, embedUrl).forEach(function (u) { if (urls.indexOf(u) === -1) urls.push(u); });
      });
      var headers = embedHeaders(embedUrl);
      return urls.map(function (u) {
        var isHls = /\.m3u8/i.test(u);
        return { url: u, quality: isHls ? 'Auto' : (qualityFromUrl(u) || 'Unknown'), headers: headers };
      });
    });
}

function extractVk(embedUrl) {
  return fetchText(embedUrl, { 'User-Agent': UA_EMBED, 'Referer': BASE_URL + '/', 'Accept-Language': 'ar,en;q=0.9' }, EMBED_TIMEOUT)
    .then(function (html) {
      var headers = { 'User-Agent': UA_EMBED, 'Referer': 'https://vk.com/' };
      var out = [];
      var re = /"url(\d{3,4})"\s*:\s*"(https?:[^"]+)"/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        out.push({ url: cleanMediaUrl(m[2]), quality: m[1] + 'p', headers: headers });
      }
      if (!out.length) {
        var hls = /"hls"\s*:\s*"(https?:[^"]+)"/.exec(html);
        if (hls) out.push({ url: cleanMediaUrl(hls[1]), quality: 'Auto', headers: headers });
      }
      return out;
    });
}

var OK_QUALITY = { mobile: '144p', lowest: '240p', low: '360p', sd: '480p', hd: '720p', full: '1080p', quad: '1440p', ultra: '2160p' };

function extractOk(embedUrl) {
  return fetchText(embedUrl, { 'User-Agent': UA_EMBED, 'Referer': BASE_URL + '/', 'Accept-Language': 'ar,en;q=0.9' }, EMBED_TIMEOUT)
    .then(function (html) {
      var m = /data-options\s*=\s*"([^"]+)"/.exec(html);
      if (!m) return [];
      var options = JSON.parse(decodeEntities(m[1]));
      var meta = options && options.flashvars && options.flashvars.metadata;
      if (typeof meta === 'string') meta = JSON.parse(meta);
      if (!meta) return [];
      var headers = { 'User-Agent': UA_EMBED, 'Referer': 'https://ok.ru/' };
      var out = [];
      (meta.videos || []).forEach(function (v) {
        if (v && v.url) out.push({ url: cleanMediaUrl(v.url), quality: OK_QUALITY[v.name] || 'Unknown', headers: headers });
      });
      var hls = meta.hlsManifestUrl || meta.ondemandHls || meta.hlsMasterPlaylistUrl;
      if (hls) out.push({ url: cleanMediaUrl(hls), quality: 'Auto', headers: headers });
      return out;
    });
}

function resolveEmbed(embedUrl) {
  var host = hostOf(embedUrl);
  var job;
  if (/(^|\.)vk\.com\( |(^|\.)vkvideo\.ru \)/.test(host)) job = extractVk(embedUrl);
  else if (/(^|\.)ok\.ru$/.test(host)) job = extractOk(embedUrl);
  else job = extractGeneric(embedUrl);
  return job.then(function (items) {
    var label = serverLabel(host);
    return items.map(function (it) { it.server = label; return it; });
  }).catch(function (err) {
    log(serverLabel(host) + ' failed: ' + (err && err.message));
    return [];
  });
}

function qualityRank(q) {
  if (q === 'Auto') return 9999;
  var n = parseInt(q, 10);
  return isNaN(n) ? 0 : n;
}

function displayQuality(q) {
  if (q === 'Auto' || q === 'Unknown' || !q) return 'Auto';
  return q;
}

function getServerStreams(vid, title) {
  return fetchEmbedUrls(vid).then(function (embedUrls) {
    log('servers for ' + vid + ': ' + embedUrls.length);
    return Promise.all(embedUrls.slice(0, MAX_SERVERS).map(resolveEmbed));
  }).then(function (groups) {
    var byServer = {};
    groups.forEach(function (items) {
      items.forEach(function (it) {
        if (!it || !it.url) return;
        var key = it.server || 'Server';
        var rank = qualityRank(it.quality);
        if (!byServer[key] || rank > byServer[key].rank) {
          byServer[key] = { server: key, rank: rank, item: it };
        }
      });
    });

    var streams = [];
    var seenUrls = {};
    Object.keys(byServer).forEach(function (k) {
      var entry = byServer[k];
      var it = entry.item;
      if (seenUrls[it.url]) return;
      seenUrls[it.url] = true;
      var shownQuality = displayQuality(it.quality);
      streams.push({
        name: PROVIDER_NAME + ' ' + entry.server + ' ' + shownQuality,
        title: title,
        url: it.url,
        quality: shownQuality,
        size: 'Unknown',
        headers: it.headers,
        provider: PROVIDER_ID
      });
    });

    streams.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
    return streams;
  });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
  var season = parseInt(seasonNum, 10) || 1;
  var episode = parseInt(episodeNum, 10) || 1;

  if (!TMDB_API_KEY || TMDB_API_KEY === 'YOUR_TMDB_API_KEY') {
    log('TMDB_API_KEY is not set');
    return Promise.resolve([]);
  }

  return fetchTmdb(tmdbId, type).then(function (data) {
    var meta = buildMeta(data, type);
    if (!meta.processable) {
      log('skipped (content filter=' + CONTENT_LANG + '): ' + meta.displayTitle + ' [' + (meta.arabic ? 'ar' : 'en') + ']');
      return [];
    }
    if (!meta.targets.length) {
      log('no usable title for TMDB ' + tmdbId);
      return [];
    }
    var title = type === 'tv'
      ? meta.displayTitle + ' S' + pad2(season) + 'E' + pad2(episode)
      : meta.displayTitle + (meta.year ? ' (' + meta.year + ')' : '');
    log(type + ' "' + meta.displayTitle + '" lang=' + (meta.arabic ? 'ar' : 'en') +
        ' queries=' + JSON.stringify(buildQueries(meta.displayTitle, meta, type, season, episode)));
    return type === 'tv' ? getSeriesStreams(meta, season, episode, title) : getMovieStreams(meta, title);
  }).catch(function (err) {
    log('error: ' + (err && err.message));
    return [];
  });
}

module.exports = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  version: '1.3.0',
  supportedTypes: ['movie', 'tv'],
  formats: ['m3u8', 'mp4'],
  getStreams: getStreams
};

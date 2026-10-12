
var DOMAIN = "https://alooytv16.xyz";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var REQUEST_TIMEOUT = 12000;

// Longer phrases first. Spelling is normalized (no hamza, ة→ه, ى→ي).
var SEASON_ORDINALS = [
  ["الحادي والعشرون", 21], ["الثاني والعشرون", 22], ["الثالث والعشرون", 23],
  ["الحادي عشر", 11], ["الثاني عشر", 12], ["الثالث عشر", 13], ["الرابع عشر", 14],
  ["الخامس عشر", 15], ["السادس عشر", 16], ["السابع عشر", 17], ["الثامن عشر", 18],
  ["التاسع عشر", 19], ["العشرون", 20],
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

var FLAG_TOKEN = { مدبلج: 1, مدبلجه: 1, مترجم: 1, مترجمه: 1, مسلسل: 1, برنامج: 1 };

function withTimeout(promise, ms) {
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

function decodeHtml(str) {
  return String(str || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function clean(str) {
  return decodeHtml(String(str || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function get(url, referer) {
  return withTimeout(fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": referer || (DOMAIN + "/")
    },
    redirect: "follow"
  }).then(function(res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  }), REQUEST_TIMEOUT);
}

function absoluteUrl(value, base) {
  var raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.indexOf("//") === 0) return "https:" + raw;
  var origin = String(base || DOMAIN).match(/^(https?:\/\/[^/]+)/i);
  if (raw.charAt(0) === "/") return (origin ? origin[1] : DOMAIN) + raw;
  return DOMAIN + "/" + raw.replace(/^\.\//, "");
}

function normTitle(str) {
  return clean(str)
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

function rawTokens(str) {
  var n = normTitle(str);
  return n ? n.split(" ") : [];
}

function ordinalNum(text) {
  var n = normTitle(text);
  var best = null;
  var bestLen = 0;
  var phrase = "";
  for (var i = 0; i < SEASON_ORDINALS.length; i++) {
    phrase = SEASON_ORDINALS[i][0];
    if (n.indexOf(phrase) !== -1 && phrase.length > bestLen) {
      best = SEASON_ORDINALS[i][1];
      bestLen = phrase.length;
    }
  }
  return best == null ? null : { n: best, phrase: SEASON_ORDINALS[bestLen === 0 ? 0 : SEASON_ORDINALS.findIndex(function(row, idx) {
    return SEASON_ORDINALS[idx][0].length === bestLen && SEASON_ORDINALS[idx][1] === best && n.indexOf(SEASON_ORDINALS[idx][0]) !== -1;
  })] };
}

function ordinalHit(text) {
  var n = normTitle(text);
  var best = null;
  var bestLen = 0;
  for (var i = 0; i < SEASON_ORDINALS.length; i++) {
    var phrase = SEASON_ORDINALS[i][0];
    if (n.indexOf(phrase) === 0 && phrase.length > bestLen) {
      best = { n: SEASON_ORDINALS[i][1], phrase: phrase };
      bestLen = phrase.length;
    }
  }
  return best;
}

function findSeq(tokens, seq, from) {
  var start = from || 0;
  for (var i = start; i + seq.length <= tokens.length; i++) {
    var ok = true;
    for (var j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function parseTitle(title) {
  var tokens = rawTokens(title);
  var drop = {};
  var season = null;
  function take(n, indexes) {
    if (!(n >= 1 && n <= 40)) return;
    season = n;
    for (var i = 0; i < indexes.length; i++) drop[indexes[i]] = 1;
  }

  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    var sm = t.match(/^s0*(\d{1,2})$/);
    if (sm) take(parseInt(sm[1], 10), [i]);
    var jm = t.match(/^ج0*(\d{1,2})$/);
    if (jm) take(parseInt(jm[1], 10), [i]);
    if ((t === "s" || t === "ج") && i + 1 < tokens.length && /^\d{1,2}$/.test(tokens[i + 1])) {
      take(parseInt(tokens[i + 1], 10), [i, i + 1]);
    }
    if (t === "الموسم" || t === "الجزء") {
      if (i + 1 < tokens.length && /^\d{1,2}$/.test(tokens[i + 1])) {
        take(parseInt(tokens[i + 1], 10), [i, i + 1]);
      } else {
        var rest = tokens.slice(i + 1).join(" ");
        var hit = ordinalHit(rest);
        if (hit) {
          var seq = hit.phrase.split(" ");
          var at = findSeq(tokens, seq, i + 1);
          var indexes = [i];
          if (at >= 0) {
            for (var k = 0; k < seq.length; k++) indexes.push(at + k);
          }
          take(hit.n, indexes);
        }
      }
    }
  }

  if (season == null && tokens.length) {
    var last = tokens[tokens.length - 1];
    if (/^\d{1,2}$/.test(last)) take(parseInt(last, 10), [tokens.length - 1]);
  }

  var core = [];
  for (var c = 0; c < tokens.length; c++) {
    if (drop[c] || FLAG_TOKEN[tokens[c]] || tokens[c] === "فيلم" || tokens[c] === "فلم") continue;
    core.push(tokens[c]);
  }
  return { season: season, core: core };
}

function isFilmTitle(title) {
  var n = normTitle(title);
  return n.indexOf("فيلم ") === 0 || n === "فيلم" || n.indexOf("فلم ") === 0 || n === "فلم";
}

function hasLatin(token) {
  return /[a-z]/.test(token);
}

// Exact core after season/dub tokens are removed.
// A short subtitle ("اللعبة ج5 الكلاسيكو", "المداح 4 أسطورة العودة") is allowed
// only once a season number was parsed. Extra words with no season are a
// different show: "أشغال شقة جدا", "الهيبة رأس الجبل", "Forget You Not".
function nameScore(title, query) {
  if (!title || !query || isFilmTitle(title)) return 0;
  var show = parseTitle(title);
  var want = parseTitle(query);
  var ll = show.core.slice();
  var ql = want.core.slice();
  if (!ll.length || !ql.length) return 0;
  var qLatin = ql.some(hasLatin);
  if (qLatin) {
    ql = ql.filter(function(t) { return hasLatin(t); });
    ll = ll.filter(function(t) { return hasLatin(t); });
  } else {
    ql = ql.filter(function(t) { return !hasLatin(t); });
    ll = ll.filter(function(t) { return !hasLatin(t); });
  }
  if (!ql.length || !ll.length) return 0;
  if (ql.join(" ") === ll.join(" ")) return 1;
  if (!qLatin && show.season != null && ll.join(" ").indexOf(ql.join(" ") + " ") === 0) {
    var extras = ll.slice(ql.length);
    if (extras.length > 0 && extras.length <= 4) return 0.9;
  }
  return 0;
}

function titleFlags(title) {
  var n = normTitle(title);
  return {
    sub: n.indexOf("مترجم") !== -1 ? 1 : 0,
    dub: n.indexOf("مدبلج") !== -1 ? 1 : 0
  };
}

function bestScore(title, queries) {
  var best = 0;
  for (var i = 0; i < queries.length; i++) {
    var sc = nameScore(title, queries[i].q);
    if (sc > best) best = sc;
  }
  return best;
}

function searchVariants(text) {
  var raw = clean(text);
  if (!raw) return [];
  var folded = raw
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
  return folded && folded !== raw ? [raw, folded] : [raw];
}

function queryPlan(meta) {
  var seen = {};
  var plan = [];
  function add(text, weight) {
    searchVariants(text).forEach(function(q) {
      if (!q || seen[q]) return;
      seen[q] = 1;
      plan.push({ q: q, weight: weight });
    });
  }
  add(meta.ar, 2);
  add(meta.en, 2);
  add(meta.orig, 1);
  (meta.titles || []).forEach(function(t) { add(t, 1); });
  return plan;
}

function searchCards(html) {
  var out = [];
  var seen = {};
  var re = /<div class="movie-title">\s*<h3>\s*<a\b([^>]+)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var hrefMatch = m[1].match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    var url = absoluteUrl(hrefMatch[1], DOMAIN + "/");
    if (!/\/watch\//i.test(url)) continue;
    var title = clean(m[2]);
    var key = url.split("?")[0];
    if (!title || seen[key]) continue;
    seen[key] = 1;
    out.push({ url: key, title: title });
  }
  return out;
}

function searchAlooy(title) {
  var url = DOMAIN + "/search?q=" + encodeURIComponent(title);
  return get(url, DOMAIN + "/").then(function(html) {
    return searchCards(html);
  });
}

function h1Of(html) {
  var m = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? clean(m[1]) : "";
}

function localGenresOnly(html) {
  var m = String(html || "").match(/Genre:\s*<\/strong>([\s\S]{0,500})/i);
  if (!m) return false;
  var gs = [];
  var re = /\/genre\/([^"'?#]+)\.html/gi;
  var g;
  while ((g = re.exec(m[1])) !== null) gs.push(String(g[1]).toLowerCase());
  if (!gs.length) return false;
  for (var i = 0; i < gs.length; i++) {
    var slug = gs[i];
    var local = slug === "kleeji" || slug === "arabic" || slug === "turki" || slug === "farisi" || slug.indexOf("ramadan") === 0;
    if (!local) return false;
  }
  return true;
}

// TMDB translates The Office to "المكتب", which is a different Gulf show.
// Uploaded release years on this site are not air dates, so genre is the check:
// a non-Arabic show filed only under خليجي/عربي/تركي, with no Latin in the title.
function isForeignTitleCollision(html, meta, cardTitle) {
  var lang = String((meta && meta.lang) || "").toLowerCase();
  if (!lang || lang === "ar" || lang === "tr" || lang === "fa") return false;
  if (/[a-z]/i.test(cardTitle || "")) return false;
  return localGenresOnly(html);
}

function parseBlocks(html) {
  var parts = String(html || "").split(/<div class="season"[^>]*>/i);
  var blocks = [];
  for (var i = 1; i < parts.length; i++) {
    var body = parts[i];
    var sm = body.match(/<span>([\s\S]*?)<\/span>/i);
    var label = sm ? clean(sm[1]) : "";
    var eps = [];
    var re = /<a\b([^>]*\bbtn-ep\b[^>]*)>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(body)) !== null) {
      var hrefMatch = m[1].match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) continue;
      var text = clean(m[2]);
      var em = text.match(/^(?:ep\s*#\s*)?(\d+)$/i);
      if (!em) continue;
      var href = absoluteUrl(hrefMatch[1], DOMAIN + "/");
      if (!/[?&]key=/i.test(href)) continue;
      eps.push({ n: parseInt(em[1], 10), url: href });
    }
    blocks.push({
      label: label,
      season: parseTitle(label).season,
      eps: eps
    });
  }
  return blocks;
}

function blocksFor(blocks, titleSeason, wanted) {
  var exact = [];
  var labeled = 0;
  blocks.forEach(function(b) {
    if (!b.eps.length) return;
    if (b.season != null) labeled++;
    if (b.season === wanted) exact.push(b);
  });
  if (exact.length) return exact;
  if (titleSeason === wanted) {
    var only = blocks.filter(function(b) { return b.eps.length; });
    if (only.length === 1) return only;
  }
  if (titleSeason == null && wanted === 1 && labeled === 0) {
    var unlabeled = blocks.filter(function(b) { return b.eps.length && b.season == null; });
    if (unlabeled.length === 1) return unlabeled;
  }
  return [];
}

// In-season pages label Ep#1. اخوتي S2/S3 label the absolute index (165, 195…).
function pickEpisode(eps, wanted) {
  if (!eps.length || !(wanted >= 1)) return null;
  var min = eps[0].n;
  var absolute = min > 1 && min > eps.length;
  if (!absolute) {
    for (var i = 0; i < eps.length; i++) {
      if (eps[i].n === wanted) return eps[i];
    }
    return null;
  }
  if (wanted <= eps.length) return eps[wanted - 1];
  return null;
}

function findTvEpisode(meta, season, episode) {
  var wantedSeason = Number(season) || 0;
  var wantedEp = Number(episode) || 0;
  var plan = queryPlan(meta || {});
  if (!plan.length || wantedSeason < 1 || wantedEp < 1) return Promise.resolve(null);
  console.log("[AlooyTV] queries:", plan.map(function(p) { return p.q; }).join(" | "), "S" + wantedSeason + "E" + wantedEp);

  return Promise.all(plan.map(function(item) {
    return searchAlooy(item.q).then(function(cards) {
      return cards.map(function(c) {
        c.weight = item.weight;
        return c;
      });
    }).catch(function(e) {
      console.log("[AlooyTV] search failed:", item.q, e.message);
      return [];
    });
  })).then(function(groups) {
    var found = [];
    var seen = {};
    groups.forEach(function(g) {
      g.forEach(function(card) {
        if (seen[card.url] || isFilmTitle(card.title)) return;
        var parsed = parseTitle(card.title);
        if (parsed.season != null && parsed.season !== wantedSeason) return;
        var sc = bestScore(card.title, plan);
        if (sc < 0.84) return;
        seen[card.url] = 1;
        var flags = titleFlags(card.title);
        found.push({
          url: card.url,
          title: card.title,
          score: sc,
          weight: card.weight,
          flags: flags,
          titleSeason: parsed.season,
          explicit: parsed.season === wantedSeason ? 1 : 0
        });
      });
    });
    found.sort(function(a, b) {
      if (a.explicit !== b.explicit) return b.explicit - a.explicit;
      if (b.score !== a.score) return b.score - a.score;
      var ad = a.flags.dub && !a.flags.sub ? 1 : 0;
      var bd = b.flags.dub && !b.flags.sub ? 1 : 0;
      if (ad !== bd) return ad - bd;
      if (a.flags.sub !== b.flags.sub) return b.flags.sub - a.flags.sub;
      return (b.weight || 0) - (a.weight || 0);
    });
    var picked = found.slice(0, 4);
    console.log("[AlooyTV] candidates:", picked.map(function(c) { return c.title; }).join(" | ") || "(none)");
    if (!picked.length) return null;

    return Promise.all(picked.map(function(card) {
      return get(card.url, DOMAIN + "/").then(function(html) {
        if (isForeignTitleCollision(html, meta, card.title)) {
          console.log("[AlooyTV] rejected local collision:", card.title);
          return null;
        }
        var h1 = h1Of(html);
        if (h1 && bestScore(h1, plan) < 0.84) {
          console.log("[AlooyTV] rejected h1:", h1);
          return null;
        }
        var blocks = parseBlocks(html);
        var chosen = blocksFor(blocks, card.titleSeason, wantedSeason);
        for (var i = 0; i < chosen.length; i++) {
          var ep = pickEpisode(chosen[i].eps, wantedEp);
          if (!ep) continue;
          console.log("[AlooyTV] matched:", card.title, "|", chosen[i].label, "| Ep#" + ep.n);
          return {
            url: ep.url,
            title: card.title,
            label: chosen[i].label,
            epNo: ep.n,
            flags: card.flags,
            score: card.score
          };
        }
        return null;
      }).catch(function(e) {
        console.log("[AlooyTV] page failed:", card.url, e.message);
        return null;
      });
    })).then(function(hits) {
      var ok = hits.filter(Boolean);
      ok.sort(function(a, b) {
        var ad = a.flags.dub && !a.flags.sub ? 1 : 0;
        var bd = b.flags.dub && !b.flags.sub ? 1 : 0;
        if (ad !== bd) return ad - bd;
        if (a.flags.sub !== b.flags.sub) return b.flags.sub - a.flags.sub;
        return b.score - a.score;
      });
      return ok[0] || null;
    });
  });
}

function extractSources(html) {
  var sources = [];
  function add(url) {
    if (!url) return;
    url = decodeHtml(url).trim();
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) return;
    if (sources.indexOf(url) === -1) sources.push(url);
  }
  var re = /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) add(m[1]);
  var unique = [];
  var seen = {};
  sources.forEach(function(url) {
    var key = String(url).split("?")[0].split("#")[0];
    if (seen[key]) return;
    seen[key] = 1;
    unique.push(url);
  });
  return unique;
}

function makeStream(url, episode) {
  return {
    name: "AlooyTV",
    title: "AlooyTV \u2022 Episode " + episode,
    url: url,
    quality: "Auto",
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": DOMAIN + "/"
    }
  };
}

function getTmdbMeta(tmdbId) {
  var info = { ar: null, en: null, orig: null, lang: null, titles: [] };
  return ["ar", "en"].reduce(function(chain, lang) {
    return chain.then(function() {
      var apiUrl = "https://api.themoviedb.org/3/tv/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&language=" + lang;
      return fetch(apiUrl).then(function(res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function(data) {
        if (!data) return;
        var title = data.name || data.original_name;
        if (lang === "ar") info.ar = title || null;
        if (lang === "en") info.en = title || null;
        if (title && info.titles.indexOf(title) === -1) info.titles.push(title);
        if (data.original_name && !info.orig) info.orig = data.original_name;
        if (data.original_language && !info.lang) info.lang = data.original_language;
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (info.orig && info.titles.indexOf(info.orig) === -1) info.titles.push(info.orig);
    if (!info.titles.length) throw new Error("Could not get TMDB titles for " + tmdbId);
    console.log("[AlooyTV] TMDB:", info.titles.join(" | "), "lang:", info.lang);
    return info;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[AlooyTV] Request:", tmdbId, mediaType, season, episode);
  if (!tmdbId || mediaType !== "tv" || !episode) return Promise.resolve([]);
  var wantedEp = Number(episode);
  if (!isFinite(wantedEp) || wantedEp < 1) return Promise.resolve([]);
  return getTmdbMeta(tmdbId).then(function(meta) {
    return findTvEpisode(meta, season, wantedEp);
  }).then(function(hit) {
    if (!hit || !hit.url) return [];
    return get(hit.url, hit.url.split("?")[0]).then(function(html) {
      var sources = extractSources(html);
      console.log("[AlooyTV] sources:", sources.length);
      return sources.map(function(source) { return makeStream(source, wantedEp); });
    });
  }).catch(function(e) {
    console.log("[AlooyTV] error:", e.message);
    return [];
  });
}

module.exports = {
  getStreams: getStreams,
  findTvEpisode: findTvEpisode,
  getTmdbMeta: getTmdbMeta,
  nameScore: nameScore,
  parseTitle: parseTitle
};

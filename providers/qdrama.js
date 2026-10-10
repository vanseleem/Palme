/**
 * Q-Drama Provider for Nuvio
 * Arabic movies and TV series from vod.q-drama.com
 * Fixed version — search + episode lookup + fallback server parsing
 */

var PROVIDER_ID = "qdrama";
var PROVIDER_NAME = "QDrama";
var BASE_URL = "https://vod.q-drama.com";

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
var FETCH_TIMEOUT_MS = 20000;
var MAX_FETCHES = 12;

// ─────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────
function log(m) { console.log("[" + PROVIDER_NAME + "] " + m); }
function snip(t, n) { return String(t || "").substring(0, n || 200).replace(/\s+/g, " "); }

// ─────────────────────────────────────────────────────────────
// HTTP LAYER
// ─────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
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

function request(url, headers) {
    return withTimeout(
        fetch(url, {
            method: "GET",
            headers: headers || {},
            redirect: "follow"
        }).then(function (r) {
            return r.text().then(function (t) {
                return { ok: r.ok, status: r.status, text: t, url: r.url || url };
            });
        }),
        FETCH_TIMEOUT_MS,
        url.split("?")[0]
    );
}

function getPage(url, referer) {
    var h = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.3",
        "Referer": referer || (BASE_URL + "/")
    };
    log("→ " + url);
    return request(url, h).then(function (r) {
        log("← " + r.status + " len=" + r.text.length + " final=" + r.url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r;
    });
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function pad2(n) { return n < 10 ? "0" + n : String(n); }

function absUrl(base, rel) {
    rel = String(rel).trim();
    if (/^https?:\/\//i.test(rel)) return rel;
    if (/^\/\//.test(rel)) return "https:" + rel;
    var clean = base.split("#")[0].split("?")[0];
    var m = /^(https?:\/\/[^\/]+)(\/.*)?$/i.exec(clean);
    if (!m) return rel;
    var origin = m[1];
    if (rel.charAt(0) === "/") return origin + rel;
    var parts = (m[2] || "/").split("/");
    parts.pop();
    rel.split("/").forEach(function (seg) {
        if (seg === "..") { if (parts.length > 1) parts.pop(); }
        else if (seg !== ".") parts.push(seg);
    });
    return origin + parts.join("/");
}

function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) {
        var k = typeof x === "string" ? x : x.url;
        if (seen[k]) return;
        seen[k] = true;
        out.push(x);
    });
    return out;
}

function stripHtml(s) {
    return String(s || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
}

// ─────────────────────────────────────────────────────────────
// ARABIC NORMALIZATION (script-aware)
// ─────────────────────────────────────────────────────────────
var ARABIC_RE = /[\u0600-\u06FF]/;

function hasArabic(s) { return ARABIC_RE.test(String(s || "")); }
function hasLatin(s) { return /[A-Za-z]/.test(String(s || "")); }

function normalizeTitle(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (hasArabic(s)) {
        s = s
            .replace(/[أإآٱ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/ؤ/g, "و")
            .replace(/ئ/g, "ي")
            .replace(/ة/g, "ه")
            .replace(/[\u064B-\u0652\u0670]/g, "")
            .replace(/\u0640/g, "");
    }
    if (hasLatin(s)) {
        s = s.toLowerCase()
            .replace(/[^\w\s\u0600-\u06FF]/g, " ")
            .replace(/\s+/g, " ");
    }
    return s.replace(/\s+/g, " ").trim();
}

function similarity(a, b) {
    a = normalizeTitle(a);
    b = normalizeTitle(b);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
        var shorter = Math.min(a.length, b.length);
        var longer = Math.max(a.length, b.length);
        return Math.round(40 + 50 * (shorter / longer));
    }
    var aw = a.split(/\s+/), bw = b.split(/\s+/);
    var hits = 0;
    aw.forEach(function (w) { if (w.length > 2 && bw.indexOf(w) !== -1) hits++; });
    return hits ? Math.round(30 * hits / Math.max(aw.length, bw.length)) : 0;
}

// ─────────────────────────────────────────────────────────────
// PACKED JS / BASE64 DECODERS
// ─────────────────────────────────────────────────────────────
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decode(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
    var out = "";
    for (var i = 0; i < s.length; i += 4) {
        var a = B64.indexOf(s.charAt(i));
        var b = B64.indexOf(s.charAt(i + 1));
        var c = i + 2 < s.length ? B64.indexOf(s.charAt(i + 2)) : -1;
        var d = i + 3 < s.length ? B64.indexOf(s.charAt(i + 3)) : -1;
        if (a < 0 || b < 0) break;
        out += String.fromCharCode(((a << 2) | (b >> 4)) & 255);
        if (c >= 0) out += String.fromCharCode((((b & 15) << 4) | (c >> 2)) & 255);
        if (d >= 0) out += String.fromCharCode((((c & 3) << 6) | d) & 255);
    }
    return out;
}

function unpack(p, a, c, k) {
    function e(n) {
        return (n < a ? "" : e(parseInt(n / a, 10))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    }
    var d = {};
    while (c--) d[e(c)] = k[c] || e(c);
    p = p.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    return p.replace(/\b\w+\b/g, function (w) { return d[w] === undefined ? w : d[w]; });
}

function unpackAll(text) {
    var out = [];
    var re = /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/g;
    var m;
    while ((m = re.exec(text))) {
        try { out.push(unpack(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4].split("|"))); } catch (e) { /* skip */ }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────
function searchQDrama(query) {
    if (!query || !String(query).trim()) return Promise.resolve([]);
    var url = BASE_URL + "/search.php?keywords=" + encodeURIComponent(query) + "&video-id=";
    log("SEARCH: " + query);

    return getPage(url).then(function (r) {
        var html = r.text;
        var results = [];
        var m;

        log("SEARCH watch.php hits: " + (html.match(/watch\.php/g) || []).length);

        // Robust: any anchor whose href contains watch.php?vid=
        var re = /<a\b[^>]*href\s*=\s*["']([^"']*watch\.php\?vid=[^"']+)["'][^>]*>/gi;
        while ((m = re.exec(html))) {
            var href = m[1];
            var vidM = /vid=([A-Za-z0-9]+)/i.exec(href);
            if (!vidM) continue;
            var titleM = /title\s*=\s*["']([^"']*)["']/i.exec(m[0]);
            var title = titleM ? stripHtml(titleM[1]) : "";
            if (!title) {
                var tail = html.substring(m.index, m.index + 600);
                var h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(tail);
                if (h3) title = stripHtml(h3[1]);
            }
            if (!title || title.length < 2) continue;
            var full = absUrl(BASE_URL, href);
            results.push({ vid: vidM[1], title: title, url: full });
        }

        log("SEARCH '" + query + "' → " + results.length + " results");
        return uniq(results);
    }).catch(function (e) {
        log("SEARCH ERROR: " + (e && e.message));
        return [];
    });
}

// ─────────────────────────────────────────────────────────────
// SEARCH QUERY BUILDER
// ─────────────────────────────────────────────────────────────
function buildSearchQueries(titles, year, type, season, episode) {
    var queries = [];
    var seen = {};

    function push(q) {
        q = String(q || "").trim();
        if (!q || seen[q]) return;
        seen[q] = true;
        queries.push(q);
    }

    titles.forEach(function (title) {
        if (!title) return;
        var isAr = hasArabic(title);

        push(title);
        if (year) push(title + " " + year);

        if (isAr) {
            push(title.replace(/^(فيلم|مسلسل|مسلسلة)\s+/i, ""));
            if (type === "movie" && !/^فيلم/.test(title)) push("فيلم " + title);
            if (type === "tv" && !/^مسلسل/.test(title)) push("مسلسل " + title);
        }

        if (type === "tv") {
            var s = parseInt(season, 10) || 1;
            var e = parseInt(episode, 10) || 1;
            push(title + " الحلقة " + e);
            push(title + " الموسم " + s + " الحلقة " + e);
            push(title + " S" + pad2(s) + "E" + pad2(e));
        }
    });

    return queries;
}

// ─────────────────────────────────────────────────────────────
// BEST MATCH SCORING
// ─────────────────────────────────────────────────────────────
function pickBest(results, titles, year, type, season, episode) {
    if (!results.length) return null;

    var scored = results.map(function (r) {
        var best = 0;
        titles.forEach(function (t) {
            if (!t) return;
            var s = similarity(t, r.title);
            if (s > best) best = s;
        });

        if (year && String(r.title).indexOf(String(year)) !== -1) best += 20;
        if (type === "movie" && /فيلم|movie/i.test(r.title)) best += 5;
        if (type === "tv" && /مسلسل|series|season/i.test(r.title)) best += 5;

        if (type === "tv") {
            var s = parseInt(season, 10) || 1;
            var e = parseInt(episode, 10) || 1;
            var t = normalizeTitle(r.title);

            if (t.indexOf("الموسم " + s) !== -1 || t.indexOf("موسم " + s) !== -1) best += 30;
            else if (s === 1 && t.indexOf("الموسم") === -1) best += 10;

            var epPatterns = [
                "الحلقة " + e, "الحلقه " + e,
                "الحلقة " + pad2(e), "الحلقه " + pad2(e)
            ];
            var epFound = false;
            epPatterns.forEach(function (p) {
                if (t.indexOf(p) !== -1) epFound = true;
            });
            if (epFound) best += 50;

            if (/كامل|جميع الحلقات/.test(t)) best -= 25;
        }

        return { result: r, score: best };
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    log("BEST: '" + scored[0].result.title + "' (score " + scored[0].score + " from " + scored.length + " candidates)");
    return scored[0].score >= 25 ? scored[0].result : null;
}

// ─────────────────────────────────────────────────────────────
// EPISODE LOOKUP VIA SEARCH
// Q-Drama does NOT expose an episode list on watch pages.
// The only reliable path is searching for the episode title.
// ─────────────────────────────────────────────────────────────
function findEpisodeViaSearch(baseTitle, season, episode) {
    var e = parseInt(episode, 10) || 1;
    var s = parseInt(season, 10) || 1;

    var queries = [
        baseTitle + " الحلقة " + e,
        baseTitle + " الحلقه " + e,
        baseTitle + " الموسم " + s + " الحلقة " + e
    ];

    var seen = {}, plan = [];
    queries.forEach(function (q) { if (!seen[q]) { seen[q] = true; plan.push(q); } });

    var chain = Promise.resolve(null);
    plan.forEach(function (q) {
        chain = chain.then(function (found) {
            if (found) return found;
            return searchQDrama(q).then(function (results) {
                if (!results.length) return null;
                for (var i = 0; i < results.length; i++) {
                    var t = results[i].title;
                    var norm = normalizeTitle(t);
                    if (norm.indexOf("الحلقه " + e) !== -1 ||
                        norm.indexOf("الحلقة " + e) !== -1) {
                        log("EPISODE match: " + t);
                        return results[i];
                    }
                }
                return null;
            });
        });
    });
    return chain;
}

// ─────────────────────────────────────────────────────────────
// EXTRACT VIDEO SOURCES FROM EMBED PAGE
// ─────────────────────────────────────────────────────────────
function collectStreams(text, base) {
    var streams = [];
    var m, re;

    (text.match(/https?:\/\/[^\s"'<>\\()\[\]]+?\.m3u8[^\s"'<>\\()\[\],]*/gi) || []).forEach(function (u) {
        streams.push(u);
    });

    re = /(?:file|src|source|url|hls\w*|stream\w*)["']?\s*[:=]\s*["']((?:\.{0,2}\/)?[^"'\s]+?\.m3u8[^"'\s]*)["']/gi;
    while ((m = re.exec(text))) {
        streams.push(absUrl(base, m[1]));
    }

    (text.match(/https?:\/\/[^\s"'<>\\()\[\]]+?\.mp4[^\s"'<>\\()\[\],]*/gi) || []).forEach(function (u) {
        streams.push(u);
    });

    re = /(?:file|src|source|url)["']?\s*[:=]\s*["']((?:\.{0,2}\/)?[^"'\s]+?\.mp4[^"'\s]*)["']/gi;
    while ((m = re.exec(text))) {
        streams.push(absUrl(base, m[1]));
    }

    re = /sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/gi;
    while ((m = re.exec(text))) {
        streams.push(absUrl(base, m[1]));
    }

    re = /["']?file["']?\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
    while ((m = re.exec(text))) {
        streams.push(absUrl(base, m[1]));
    }

    return uniq(streams);
}

function collectSubtitles(text, base) {
    var subs = [];
    var m, re;

    re = /\{[^{}]*?["']?(?:file|src|url)["']?\s*:\s*["']([^"']+\.(?:vtt|srt)[^"']*)["'][^{}]*\}/gi;
    while ((m = re.exec(text))) {
        var lb = /["']?(?:label|language|lang|name|srclang)["']?\s*:\s*["']([^"']+)["']/i.exec(m[0]);
        subs.push({ url: absUrl(base, m[1]), lang: lb ? lb[1] : "Subtitle" });
    }

    (text.match(/https?:\/\/[^\s"'<>\\()\[\]]+?\.(?:vtt|srt)[^\s"'<>\\()\[\],]*/gi) || []).forEach(function (u) {
        subs.push({ url: u, lang: "Subtitle" });
    });

    return uniq(subs);
}

function extractFromServer(serverUrl, referer) {
    log("EXTRACT: " + serverUrl);

    return request(serverUrl, {
        "User-Agent": UA,
        "Referer": referer,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.7,en;q=0.3"
    }).then(function (r) {
        var html = r.text;

        var variants = [html];
        var packed = unpackAll(html);
        variants = variants.concat(packed);

        var b64Matches = html.match(/atob\(\s*["']([A-Za-z0-9+\/=_\-]{20,})["']\s*\)/g) || [];
        b64Matches.forEach(function (m) {
            var b64 = /atob\(\s*["']([A-Za-z0-9+\/=_\-]{20,})["']\s*\)/.exec(m);
            if (b64) {
                try {
                    var decoded = b64decode(b64[1]);
                    variants.push(decoded);
                    variants = variants.concat(unpackAll(decoded));
                } catch (e) { /* skip */ }
            }
        });

        var allStreams = [];
        var allSubs = [];
        variants.forEach(function (v) {
            var normalized = v.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/g, "&");
            allStreams = allStreams.concat(collectStreams(normalized, serverUrl));
            allSubs = allSubs.concat(collectSubtitles(normalized, serverUrl));
        });

        // Server-specific: Vidmoly
        if (serverUrl.indexOf("vidmoly") !== -1) {
            var vm = /sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/i.exec(html);
            if (vm) allStreams.push(vm[1]);
        }

        // Server-specific: Uqload
        if (serverUrl.indexOf("uqload") !== -1) {
            var uq = /sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/i.exec(html);
            if (uq) allStreams.push(uq[1]);
        }

        // Server-specific: OK.ru
        if (serverUrl.indexOf("ok.ru") !== -1) {
            var ok = /["']?(?:url|videoSrc)["']?\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
            var okm;
            while ((okm = ok.exec(html))) allStreams.push(okm[1]);
        }

        // Server-specific: abyssplayer
        if (serverUrl.indexOf("abyssplayer") !== -1) {
            var ab = /["']?file["']?\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
            var abm;
            while ((abm = ab.exec(html))) allStreams.push(abm[1]);
        }

        allStreams = uniq(allStreams);
        log("EXTRACT " + serverUrl.split("/")[2] + " → " + allStreams.length + " streams");
        return { streams: allStreams, subs: uniq(allSubs) };
    }).catch(function (e) {
        log("EXTRACT failed: " + (e && e.message));
        return { streams: [], subs: [] };
    });
}

// ─────────────────────────────────────────────────────────────
// PARSE EMBED SERVERS FROM embed.php
// ─────────────────────────────────────────────────────────────
function parseEmbedServers(html) {
    var servers = [];
    var m;

    var re = /<option\s+value="([^"]+)"[^>]*>\s*([^<]+)\s*<\/option>/gi;
    while ((m = re.exec(html))) {
        var name = stripHtml(m[2]).trim();
        var url = m[1].replace(/&amp;/g, "&");
        if (/^https?:\/\//i.test(url)) {
            servers.push({ name: name, url: url });
        }
    }

    if (!servers.length) {
        re = /<iframe[^>]+src="([^"]+)"/i;
        m = re.exec(html);
        if (m) {
            servers.push({ name: "Default", url: m[1] });
        }
    }

    log("Found " + servers.length + " servers");
    return servers;
}

// ─────────────────────────────────────────────────────────────
// DETECT QUALITY FROM URL
// ─────────────────────────────────────────────────────────────
function detectQuality(url) {
    var m = /(\d{3,4})p?/i.exec(url);
    if (m) return parseInt(m[1], 10);
    if (/1080/i.test(url)) return 1080;
    if (/720/i.test(url)) return 720;
    if (/480/i.test(url)) return 480;
    return 0;
}

// ─────────────────────────────────────────────────────────────
// CORE: GET STREAMS
// ─────────────────────────────────────────────────────────────
function getStreamsFor(tmdbId, type, season, episode, titles, year) {
    var displayTitle = (titles[0] || ("TMDB " + tmdbId)) +
        (type === "tv" ? " S" + pad2(season) + "E" + pad2(episode) : "");

    var queries = buildSearchQueries(titles, year, type, season, episode);
    log("Query plan: " + queries.slice(0, 6).join(" | "));

    var chain = Promise.resolve([]);
    queries.slice(0, 6).forEach(function (q) {
        chain = chain.then(function (acc) {
            return searchQDrama(q).then(function (r) { return acc.concat(r); });
        });
    });

    return chain.then(function (allResults) {
        var unique = uniq(allResults);
        log("Total unique: " + unique.length);
        var best = pickBest(unique, titles, year, type, season, episode);
        if (!best) { log("No confident match"); return []; }

        if (type === "tv") {
            var baseTitle = (titles[0] || best.title).replace(/^(مسلسل|فيلم)\s+/i, "").trim();
            return findEpisodeViaSearch(baseTitle, season, episode).then(function (ep) {
                if (ep) { log("Using episode page: " + ep.url); return ep.url; }
                log("Episode search failed, falling back to best: " + best.url);
                return best.url;
            });
        }
        return best.url;
    }).then(function (playUrl) {
        if (!playUrl) return [];
        log("PLAY: " + playUrl);

        var vidMatch = /vid=([A-Za-z0-9]+)/i.exec(playUrl);
        if (!vidMatch) { log("No vid in URL"); return []; }
        var vid = vidMatch[1];

        var embedUrl = BASE_URL + "/embed.php?vid=" + vid;
        return Promise.all([
            getPage(embedUrl, playUrl).catch(function (e) { log("embed fetch fail: " + e.message); return { text: "" }; }),
            getPage(playUrl, BASE_URL + "/").catch(function (e) { log("watch fetch fail: " + e.message); return { text: "" }; })
        ]).then(function (pages) {
            var servers = parseEmbedServers(pages[0].text);
            log("Servers from embed.php: " + servers.length);

            if (!servers.length) {
                var cm = /<meta\s+itemprop="contentUrl"\s+content="([^"]+)"/i.exec(pages[1].text);
                if (cm && /^https?:\/\//i.test(cm[1])) {
                    servers.push({ name: "سيرفر 1", url: cm[1] });
                    log("Fallback server: " + cm[1]);
                }
            }

            if (!servers.length) { log("No servers at all"); return []; }

            return Promise.all(servers.map(function (srv) {
                return extractFromServer(srv.url, playUrl).then(function (res) {
                    return { server: srv.name, streams: res.streams, subs: res.subs };
                });
            })).then(function (groups) {
                var seen = {}, out = [], allSubs = [];
                groups.forEach(function (g) {
                    allSubs = allSubs.concat(g.subs);
                    g.streams.forEach(function (url) {
                        if (seen[url]) return;
                        seen[url] = true;
                        out.push({
                            url: url, server: g.server,
                            quality: detectQuality(url),
                            type: /\.m3u8/i.test(url) ? "hls" : "mp4"
                        });
                    });
                });
                out.sort(function (a, b) { return b.quality - a.quality; });
                allSubs = uniq(allSubs);
                log("TOTAL: " + out.length + " streams, " + allSubs.length + " subs");

                return out.map(function (s) {
                    return {
                        name: PROVIDER_NAME + " - " + s.server + " (" + s.type.toUpperCase() + ")",
                        title: displayTitle + " • " + s.server,
                        url: s.url,
                        quality: s.quality >= 1080 ? "1080p" : s.quality >= 720 ? "720p"
                               : s.quality >= 480 ? "480p" : "Auto",
                        size: "Unknown",
                        type: s.type,
                        headers: {
                            "User-Agent": UA,
                            "Referer": playUrl,
                            "Origin": BASE_URL
                        },
                        provider: PROVIDER_ID,
                        subtitles: allSubs
                    };
                });
            });
        });
    }).catch(function (err) {
        log("FAILED: " + (err && err.stack || err && err.message || err));
        return [];
    });
}

// ─────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum, episodeNum, meta) {
    var type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
    var season = parseInt(seasonNum, 10) || 1;
    var episode = parseInt(episodeNum, 10) || 1;

    meta = meta || {};
    var titles = [];
    [meta.title, meta.name, meta.original_title, meta.original_name, meta.originalTitle]
        .forEach(function (t) { if (t && titles.indexOf(t) === -1) titles.push(t); });
    (meta.aliases || meta.alternativeTitles || []).forEach(function (t) {
        if (t && titles.indexOf(t) === -1) titles.push(t);
    });

    var year = meta.year || meta.releaseYear || null;

    log("getStreams: " + tmdbId + " " + type +
        (type === "tv" ? " S" + season + "E" + episode : "") +
        " | titles=" + JSON.stringify(titles) + " | year=" + year);

    if (!titles.length) {
        log("No titles — aborting. Nuvio must pass meta.title.");
        return Promise.resolve([]);
    }

    return getStreamsFor(String(tmdbId || ""), type, season, episode, titles, year);
}

if (typeof module !== "undefined" && module.exports) module.exports = { getStreams: getStreams };
if (typeof global !== "undefined") global.getStreams = getStreams;

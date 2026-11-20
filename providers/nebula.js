var PROVIDER_ID = "nebula";
var PROVIDER_NAME = "Nebula";

var STREAM_API = "https://streamdata.vaplayer.ru/api.php";
var PLAYER_ORIGIN = "https://nextgencloudfabric.com";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var TMDB_API_KEY = "83d364331c40bfbe29858aeed82f45cc";
var FETCH_TIMEOUT_MS = 12000;

function log(m) { console.log("[" + PROVIDER_NAME + "] " + m); }

// ---------------------------------------------------------------- http
function withTimeout(promise, ms, label) {
  if (typeof setTimeout !== "function") return promise;
  return new Promise(function(resolve, reject) {
    var done = false;
    var t = setTimeout(function() {
      if (!done) { done = true; reject(new Error((label || "request") + " timeout")); }
    }, ms);
    promise.then(function(v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
                 function(e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

function request(url, headers, timeoutMs) {
  return withTimeout(
    fetch(url, { method: "GET", headers: headers || {}, redirect: "follow" }).then(function(r) {
      return r.text().then(function(t) {
        return { ok: r.ok, status: r.status, text: t, url: r.url || url };
      });
    }),
    timeoutMs || FETCH_TIMEOUT_MS,
    url.split("?")[0]
  );
}

// ---------------------------------------------------------------- helpers
function labelFromRes(w, h) {
  if (w >= 3200 || h >= 2000) return "4K";
  if (w >= 1800 || h >= 1000) return "1080p";
  if (w >= 1200 || h >= 700) return "720p";
  if (w >= 800 || h >= 460) return "480p";
  if (h > 0) return h + "p";
  return "Auto";
}

function rankOf(label) {
  if (label === "4K") return 2160;
  var n = parseInt(label, 10);
  return isNaN(n) ? 0 : n;
}

function absUrl(base, rel) {
  if (/^https?:\/\//i.test(rel)) return rel;
  var clean = base.split("#")[0].split("?")[0];
  var m = /^(https?:\/\/[^\/]+)(\/.*)?$/i.exec(clean);
  if (!m) return rel;
  var origin = m[1];
  if (rel.charAt(0) === "/") return origin + rel;
  var parts = (m[2] || "/").split("/");
  parts.pop();
  rel.split("/").forEach(function(seg) {
    if (seg === "..") { if (parts.length > 1) parts.pop(); }
    else if (seg !== ".") parts.push(seg);
  });
  return origin + parts.join("/");
}

// ---------------------------------------------------------------- TMDB → IMDb (required by the stream API)
function resolveImdbId(tmdbId, type) {
  var url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&language=en&append_to_response=external_ids";
  return request(url, { "Accept": "application/json" }).then(function(r) {
    if (!r.ok) throw new Error("TMDB HTTP " + r.status);
    var d = JSON.parse(r.text);
    var imdbId = (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || "";
    if (!imdbId || imdbId.indexOf("tt") !== 0) {
      throw new Error("No valid IMDb ID for TMDB " + tmdbId);
    }
    return imdbId;
  });
}

// ---------------------------------------------------------------- HLS parser (for quality variants)
function parseMaster(masterUrl, text) {
  var lines = text.split(/\r?\n/);
  var byKey = {};
  var best = { w: 0, h: 0 };
  var hasSeparateAudio = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(text);
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (l.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
    var res = /RESOLUTION=(\d+)x(\d+)/i.exec(l);
    var bw = /BANDWIDTH=(\d+)/i.exec(l);
    var uri = null;
    for (var j = i + 1; j < lines.length; j++) {
      var n = lines[j].trim();
      if (n && n.charAt(0) !== "#") { uri = n; break; }
    }
    if (!uri) continue;
    var w = res ? parseInt(res[1], 10) : 0;
    var h = res ? parseInt(res[2], 10) : 0;
    var b = bw ? parseInt(bw[1], 10) : 0;
    if (w > best.w || h > best.h) best = { w: w, h: h };
    var label = labelFromRes(w, h);
    var key = label === "Auto" ? ("bw" + b) : label;
    if (!byKey[key] || b > byKey[key].bandwidth) {
      byKey[key] = { label: label, bandwidth: b, url: absUrl(masterUrl, uri) };
    }
  }
  return {
    variants: Object.keys(byKey).map(function(k) { return byKey[k]; }),
    best: best,
    hasSeparateAudio: hasSeparateAudio
  };
}

function makeStream(ctx, url, label, rank, headers) {
  var h = {};
  Object.keys(headers).forEach(function(k) { h[k] = headers[k]; });
  return {
    name: PROVIDER_NAME + " " + label,
    title: ctx.displayTitle + " \u2022 " + label,
    url: url,
    quality: label,
    size: "Unknown",
    type: "hls",
    headers: h,
    provider: PROVIDER_ID,
    _rank: rank
  };
}

// ---------------------------------------------------------------- vaplayer stream API
function fetchStreamUrls(imdbId, type, season, episode) {
  var params = new URLSearchParams({ imdb: imdbId, type: type });
  if (type === "tv" && season != null && episode != null) {
    params.set("season", String(season));
    params.set("episode", String(episode));
  }
  var url = STREAM_API + "?" + params.toString();

  var referer = type === "tv"
    ? PLAYER_ORIGIN + "/embed/tv/" + imdbId + "/" + season + "/" + episode
    : PLAYER_ORIGIN + "/embed/movie/" + imdbId;

  var headers = {
    "User-Agent": USER_AGENT,
    "Referer": referer,
    "Origin": PLAYER_ORIGIN
  };

  log("Stream API: " + url);

  return request(url, headers).then(function(r) {
    if (!r.ok) throw new Error("VaPlayer API HTTP " + r.status);
    var json = JSON.parse(r.text);
    if (json.status_code !== "200" && json.status_code !== 200) {
      throw new Error("VaPlayer API error: " + (json.error || "status_code=" + json.status_code));
    }
    return (json.data && json.data.stream_urls) || [];
  });
}

// ---------------------------------------------------------------- stream assembly
function buildStreams(ctx, imdbId, type, season, episode) {
  return fetchStreamUrls(imdbId, type, season, episode).then(function(streamUrls) {
    if (!streamUrls.length) {
      log("No stream URLs returned");
      return [];
    }

    var expandPromises = streamUrls.map(function(u) {
      if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return Promise.resolve([]);

      return request(u, {
        "User-Agent": USER_AGENT,
        "Referer": PLAYER_ORIGIN + "/",
        "Origin": PLAYER_ORIGIN
      }).then(function(r) {
        if (!r.ok || r.text.indexOf("#EXTM3U") === -1) {
          return [makeStream(ctx, u, "Auto", 1000000, {
            "User-Agent": USER_AGENT,
            "Referer": PLAYER_ORIGIN + "/",
            "Origin": PLAYER_ORIGIN
          })];
        }

        var master = parseMaster(u, r.text);
        var top = labelFromRes(master.best.w, master.best.h);

        if (master.variants.length < 2 || master.hasSeparateAudio) {
          return [makeStream(ctx, u, top, 1000000, {
            "User-Agent": USER_AGENT,
            "Referer": PLAYER_ORIGIN + "/",
            "Origin": PLAYER_ORIGIN
          })];
        }

        var out = [makeStream(ctx, u, "Auto", 1000000, {
          "User-Agent": USER_AGENT,
          "Referer": PLAYER_ORIGIN + "/",
          "Origin": PLAYER_ORIGIN
        })];
        master.variants.forEach(function(v) {
          out.push(makeStream(ctx, v.url, v.label, rankOf(v.label), {
            "User-Agent": USER_AGENT,
            "Referer": PLAYER_ORIGIN + "/",
            "Origin": PLAYER_ORIGIN
          }));
        });
        return out;
      }).catch(function() {
        return [makeStream(ctx, u, "Auto", 1000000, {
          "User-Agent": USER_AGENT,
          "Referer": PLAYER_ORIGIN + "/",
          "Origin": PLAYER_ORIGIN
        })];
      });
    });

    return Promise.all(expandPromises).then(function(groups) {
      var byQuality = {};
      groups.forEach(function(g) {
        g.forEach(function(s) {
          if (!byQuality[s.quality] || s._rank > byQuality[s.quality]._rank) {
            byQuality[s.quality] = s;
          }
        });
      });
      var out = Object.keys(byQuality).map(function(k) { return byQuality[k]; });
      out.sort(function(a, b) { return b._rank - a._rank; });
      out.forEach(function(s) { delete s._rank; });
      log("Returned " + out.length + " stream(s)");
      return out;
    });
  });
}

// ---------------------------------------------------------------- core
function getStreamsFor(tmdbId, type, season, episode) {
  var ctx = {
    tmdbId: tmdbId,
    displayTitle: type === "movie"
      ? "TMDB " + tmdbId
      : "TMDB " + tmdbId + " S" + pad2(season) + "E" + pad2(episode)
  };

  return resolveImdbId(tmdbId, type)
    .then(function(imdbId) {
      log("IMDb ID: " + imdbId);
      ctx.displayTitle = "IMDb " + imdbId;
      return buildStreams(ctx, imdbId, type, season, episode);
    })
    .catch(function(err) {
      log("Error: " + (err && err.message));
      return [];
    });
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

// ---------------------------------------------------------------- entry point
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  var season = parseInt(seasonNum, 10) || 1;
  var episode = parseInt(episodeNum, 10) || 1;
  log("getStreams: " + tmdbId + " " + type + " S" + season + "E" + episode);

  return getStreamsFor(tmdbId, type, season, episode).catch(function(err) {
    log("error: " + (err && err.message));
    return [];
  });
}

// ---------------------------------------------------------------- export
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
            }

/**
 * netmirror - Built from src/netmirror/
 * Generated: 2026-09-21T03:47:55.658Z
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/netmirror/constants.js
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var PLATFORM_MAP = {
  netflix: {
    ott: "nf",
    search: "/mobile/search.php",
    post: "/mobile/post.php",
    episodes: "/mobile/episodes.php",
    playlist: "/mobile/playlist.php",
    img: "poster/v",
    epImg: "epimg/150"
  },
  primevideo: {
    ott: "pv",
    search: "/mobile/pv/search.php",
    post: "/mobile/pv/post.php",
    episodes: "/mobile/pv/episodes.php",
    playlist: "/mobile/pv/playlist.php",
    img: "pv/v",
    epImg: "pvepimg"
  },
  hotstar: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    img: "hs/v",
    epImg: "hsepimg"
  },
  disney: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    img: "hs/v",
    epImg: "hsepimg"
  }
};
var NEW_TV_BASE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "X-Requested-With": "NetmirrorNewTV v1.0",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
  "Accept": "application/json, text/plain, */*"
};
var NEW_TV_DOMAINS = [
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
];

// src/netmirror/utils.js
var resolvedApiUrl = "";
function safeAtob(encoded) {
  if (typeof atob === "function") {
    return atob(encoded);
  }
  return Buffer.from(encoded, "base64").toString("binary");
}
function resolveApiUrl() {
  return __async(this, null, function* () {
    if (resolvedApiUrl)
      return resolvedApiUrl;
    for (const encoded of NEW_TV_DOMAINS) {
      const base = safeAtob(encoded).replace(/\/$/, "");
      try {
        const response = yield fetch(`${base}/checknewtv.php`, {
          headers: __spreadProps(__spreadValues({}, NEW_TV_BASE_HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" })
        });
        const data = yield response.json();
        const tokenHash = data.token_hash;
        if (tokenHash) {
          resolvedApiUrl = safeAtob(tokenHash).replace(/\/$/, "");
          return resolvedApiUrl;
        }
      } catch (error) {
      }
    }
    throw new Error("Failed to resolve NewTV API base URL");
  });
}
function buildNewTvHeaders(ott, extra = {}) {
  return __spreadValues(__spreadProps(__spreadValues({}, NEW_TV_BASE_HEADERS), {
    "Ott": ott
  }), extra);
}

// ---- episode / argument helpers (added) ----
function toPosInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return isFinite(n) && n > 0 ? n : null;
}
function normalizeMediaType(t) {
  const s = String(t || "").toLowerCase();
  return s === "tv" || s === "series" || s === "show" || s === "episode" || s === "anime" ? "tv" : "movie";
}
function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}
// Accepts only values that look like a season / episode label ("S2", "02", 2), never ids.
function labelNumber(v, prefix) {
  if (v === null || v === undefined) return null;
  const m = String(v).trim().match(new RegExp("^" + prefix + "?\\s*(\\d{1,4})$", "i"));
  return m ? parseInt(m[1], 10) : null;
}
function firstDefined() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
  }
  return null;
}
function parseEpisodes(list, fallbackSeason) {
  return (Array.isArray(list) ? list : []).filter((e) => e).map((ep) => {
    const own = labelNumber(firstDefined(ep.s, ep.sNum, ep.season), "S");
    return {
      id: ep.id,
      s: own !== null ? own : fallbackSeason,
      ep: labelNumber(firstDefined(ep.ep, ep.epNum, ep.episode), "E")
    };
  });
}
function seasonNumberOf(entry, idx) {
  const n = labelNumber(firstDefined(entry && entry.s, entry && entry.sNum, entry && entry.season), "S");
  return n !== null ? n : idx + 1;
}
function mediaKeys(data) {
  const keys = [];
  (data && data.streams || []).forEach((st) => {
    if (st && st.url) keys.push(String(st.url).split("?")[0]);
  });
  if (data && data.mp4) keys.push(String(data.mp4).split("?")[0]);
  return keys;
}
function sameMedia(a, b) {
  const kb = mediaKeys(b);
  return mediaKeys(a).some((k) => kb.indexOf(k) !== -1);
}

// src/netmirror/index.js
var net27RefCache = {};
function fetchNet27(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    const url = mediaType === "tv" ? `https://net27.cc/api/embed-tmdb/${tmdbId}?type=tv&s=${season}&e=${episode}` : `https://net27.cc/api/embed-tmdb/${tmdbId}`;
    const response = yield fetch(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://net27.cc/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok)
      return null;
    const data = yield response.json();
    return data && data.ok === true ? data : null;
  });
}
function getNet27Reference(tmdbId) {
  if (!net27RefCache[tmdbId]) {
    net27RefCache[tmdbId] = fetchNet27(tmdbId, "tv", 1, 1).then((d) => {
      if (!d)
        delete net27RefCache[tmdbId];
      return d;
    }).catch(() => {
      delete net27RefCache[tmdbId];
      return null;
    });
  }
  return net27RefCache[tmdbId];
}
function fetchFromNetflixDirect(tmdbId, mediaType, season, episode, title) {
  return __async(this, null, function* () {
    try {
      const isTv = mediaType === "tv";
      const needRef = isTv && !(season === 1 && episode === 1);
      const results = yield Promise.all([
        fetchNet27(tmdbId, mediaType, season, episode),
        needRef ? getNet27Reference(tmdbId) : Promise.resolve(null)
      ]);
      const data = results[0];
      const ref = results[1];
      if (!data)
        return null;
      if (needRef && ref && sameMedia(data, ref)) {
        console.warn("[NetMirror] net27 returned the S1E1 stream for S" + season + "E" + episode + " - ignoring this lane");
        return null;
      }
      if (needRef && !ref)
        console.warn("[NetMirror] net27 episode could not be cross-checked against S1E1");
      const mediaHeaders = {
        "Referer": "https://videodownloader.site/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
      };
      const subtitles = (data.captions || []).map((cap) => {
        let subUrl = cap.url;
        if (subUrl.startsWith("/")) {
          subUrl = "https://net27.cc" + subUrl;
        }
        return {
          url: subUrl,
          language: cap.lang || "en",
          name: cap.name || "English",
          headers: mediaHeaders
        };
      });
      const streams = [];
      if (data.streams && data.streams.length > 0) {
        data.streams.forEach((stream) => {
          streams.push({
            name: `NetMirror (Netflix) - ${stream.resolution}p`,
            title: `${title}`,
            url: stream.url,
            quality: `${stream.resolution}p`,
            headers: mediaHeaders,
            subtitles,
            provider: "netmirror"
          });
        });
      } else if (data.mp4) {
        streams.push({
          name: "NetMirror (Netflix) - Auto",
          title: `${title}`,
          url: data.mp4,
          quality: "Auto",
          headers: mediaHeaders,
          subtitles,
          provider: "netmirror"
        });
      }
      return streams;
    } catch (err) {
      console.error("[NetMirror] Direct API error:", err.message);
      return null;
    }
  });
}
function normTitle(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, " ").trim();
}
function pickSearchResult(results, title) {
  const want = normTitle(title);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && normTitle(r.t || r.title || r.name) === want)
      return r;
  }
  return results[0];
}
function fetchFromPlatform(platformKey, title, mediaType, season, episode, displayTitle) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    const apiBase = yield resolveApiUrl();
    const searchUrl = `${apiBase}/newtv/search.php?s=${encodeURIComponent(title)}`;
    const searchResp = yield fetch(searchUrl, {
      headers: buildNewTvHeaders(platform.ott)
    });
    const searchData = yield searchResp.json();
    if (!searchData.searchResult || searchData.searchResult.length === 0)
      return null;
    const result = pickSearchResult(searchData.searchResult, title);
    const contentId = result.id;
    const postUrl = `${apiBase}/newtv/post.php?id=${contentId}`;
    const postResp = yield fetch(postUrl, {
      headers: buildNewTvHeaders(platform.ott, { Lastep: "", Usertoken: "" })
    });
    const postData = yield postResp.json();
    let targetId = contentId;
    if (mediaType === "tv") {
      const targetEp = yield findEpisode(contentId, postData, platform, apiBase, season, episode);
      if (targetEp) {
        targetId = targetEp.id;
        console.log("[NetMirror] " + platformKey + " episode S" + season + "E" + episode + " -> id " + targetId);
      } else {
        console.warn("[NetMirror] " + platformKey + ": episode S" + season + "E" + episode + " not found");
        return null;
      }
    } else {
      const isSeries = postData.type === "t" || postData.episodes && postData.episodes.filter((e) => e !== null).length > 0;
      if (isSeries)
        return null;
      targetId = postData.main_id || contentId;
    }
    const playerUrl = `${apiBase}/newtv/player.php?id=${targetId}`;
    const playerResp = yield fetch(playerUrl, {
      headers: buildNewTvHeaders(platform.ott, { "Usertoken": "" })
    });
    const response = yield playerResp.json();
    if (response.status === "ok" && response.video_link) {
      return [{
        name: `NetMirror (${platformKey.charAt(0).toUpperCase() + platformKey.slice(1)})`,
        title: `${displayTitle || title}`,
        url: response.video_link,
        quality: "Auto",
        headers: {
          Referer: response.referer || apiBase
        }
      }];
    }
    return null;
  });
}
function scanSeason(seasonId, startPage, seasonNumber, platform, apiBase, wantSeason, wantEp) {
  return __async(this, null, function* () {
    let pg = startPage;
    for (let guard = 0; guard < 40; guard++) {
      const resp = yield fetch(`${apiBase}/newtv/episodes.php?id=${seasonId}&page=${pg}`, {
        headers: buildNewTvHeaders(platform.ott)
      });
      const data = yield resp.json();
      const found = parseEpisodes(data.episodes, seasonNumber).find((e) => e.s === wantSeason && e.ep === wantEp);
      if (found)
        return found;
      if (data.nextPageShow !== 1)
        break;
      pg++;
    }
    return null;
  });
}
function findEpisode(contentId, postData, platform, apiBase, wantSeason, wantEp) {
  return __async(this, null, function* () {
    const seasons = Array.isArray(postData.season) ? postData.season : [];
    const isSel = (x) => x && (x.selected === true || x.selected === 1 || x.selected === "1" || x.selected === "true");
    const selectedIdx = seasons.findIndex(isSel);
    const selectedId = selectedIdx >= 0 ? seasons[selectedIdx].id : postData.nextPageSeason;
    const selectedNum = selectedIdx >= 0 ? seasonNumberOf(seasons[selectedIdx], selectedIdx) : null;
    const hit = (list) => list.find((e) => e.s === wantSeason && e.ep === wantEp);
    let found = hit(parseEpisodes(postData.episodes, selectedNum));
    if (found)
      return found;
    if (postData.nextPageShow === 1 && selectedId) {
      found = yield scanSeason(selectedId, 2, selectedNum, platform, apiBase, wantSeason, wantEp);
      if (found)
        return found;
    }
    const others = [];
    seasons.forEach((x, idx) => {
      if (x && x.id && x.id !== selectedId)
        others.push({ id: x.id, num: seasonNumberOf(x, idx) });
    });
    others.sort((a, b) => (b.num === wantSeason ? 1 : 0) - (a.num === wantSeason ? 1 : 0));
    for (let i = 0; i < others.length; i++) {
      found = yield scanSeason(others[i].id, 1, others[i].num, platform, apiBase, wantSeason, wantEp);
      if (found)
        return found;
    }
    return null;
  });
}
function getStreams(tmdbId, rawMediaType, rawSeason, rawEpisode) {
  return __async(this, null, function* () {
    try {
      const mediaType = normalizeMediaType(rawMediaType);
      let season = null;
      let episode = null;
      if (mediaType === "tv") {
        season = toPosInt(rawSeason);
        episode = toPosInt(rawEpisode);
        if (!season || !episode) {
          console.warn("[NetMirror] TV request without a valid season/episode:", rawSeason, rawEpisode);
          return [];
        }
      }
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preferred = settings.preferredPlatform || "all";
      const tmdbType = mediaType === "tv" ? "tv" : "movie";
      const tmdbResp = yield fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      const tmdbData = yield tmdbResp.json();
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      if (!title)
        throw new Error("Could not fetch title from TMDB");
      const displayTitle = mediaType === "tv" ? `${title} S${pad2(season)}E${pad2(episode)}` : title;
      let platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred, ...platforms.filter((p) => p !== preferred)];
      }
      for (const platformKey of platforms) {
        try {
          let streams = [];
          // Only trust net27 for MOVIES. For TV it returns the S1E1 stream for
          // any request and its own E1-guard is too fragile to rely on.
          if (platformKey === "netflix" && mediaType !== "tv") {
            streams = yield fetchFromNetflixDirect(tmdbId, mediaType, season, episode, displayTitle);
          }
          if (!streams || streams.length === 0) {
            streams = yield fetchFromPlatform(platformKey, title, mediaType, season, episode, displayTitle);
          }
          if (streams && streams.length > 0)
            return streams;
        } catch (e) {
          console.warn("[NetMirror] " + platformKey + " lane failed:", e && e.message);
        }
      }
      return [];
    } catch (error) {
      console.warn("[NetMirror] getStreams error:", error && error.message);
      return [];
    }
  });
}
function onSettings() {
  return __async(this, null, function* () {
    return [
      {
        type: "header",
        label: "Source Selection"
      },
      {
        type: "select",
        key: "preferredPlatform",
        label: "Preferred Streaming Source",
        description: "Select which platform to try first. If content isn't found, others will be searched as fallback.",
        options: [
          { label: "All (Auto)", value: "all" },
          { label: "Netflix", value: "netflix" },
          { label: "Prime Video", value: "primevideo" },
          { label: "Hotstar / Disney+", value: "hotstar" }
        ],
        defaultValue: "all"
      },
      {
        type: "header",
        label: "Advanced"
      },
      {
        type: "toggle",
        key: "forceHd",
        label: "Force High Quality",
        description: "Attempts to force the player into HD mode when possible.",
        defaultValue: true
      }
    ];
  });
}
module.exports = { getStreams, onSettings };

var PROVIDER_ID = "atlantic";
var PROVIDER_NAME = "Atlantic";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
var HELIOS_BASE = "https://stream.hls.lol";
var AES_GCM_KEY_HEX = "117c358bcfcaf8fe2cfca57c9d2238a300e1c4de2efb83a5012ba84d8a31f1dd";

// Endpoints from the DevTools Network capture:
//   moscow → sources.Moscow (ms_)
//   planets → sources.Saturn (pl_)
//   pandora → dash (pd_)
// (cdn, media, subs are metadata endpoints — not used for stream URLs)
var ENDPOINTS = ["moscow", "planets", "pandora"];

function log(m) { console.log("[Atlantic] " + m); }

function hexToBytes(hex) {
  // Trim to even length (some payloads include a trailing extra char)
  if (hex.length % 2 !== 0) hex = hex.slice(0, hex.length - 1);
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    bytes[i / 2] = isNaN(b) ? 0 : b;
  }
  return bytes;
}

function utf8Decode(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
}

function decryptAtlanticUrl(encryptedUrl) {
  return new Promise(function(resolve, reject) {
    if (!encryptedUrl || typeof encryptedUrl !== "string") {
      reject(new Error("Empty URL"));
      return;
    }
    // Prefix is 2 lowercase letters + underscore: ms_, pl_, pd_, hl_, etc.
    var idx = encryptedUrl.indexOf("_");
    if (idx < 2 || idx > 3) {
      // Not encrypted, return as-is
      resolve(encryptedUrl);
      return;
    }
    var hexPayload = encryptedUrl.slice(idx + 1);
    var encryptedBytes = hexToBytes(hexPayload);
    if (encryptedBytes.length < 29) {
      reject(new Error("Payload too short (" + encryptedBytes.length + " bytes)"));
      return;
    }
    var iv = encryptedBytes.slice(0, 12);
    var ciphertext = encryptedBytes.slice(12);
    if (typeof crypto === "undefined" || !crypto.subtle) {
      log("crypto.subtle unavailable");
      resolve(encryptedUrl);
      return;
    }
    var keyBytes = hexToBytes(AES_GCM_KEY_HEX);
    crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
      .then(function(k) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, k, ciphertext);
      })
      .then(function(d) {
        resolve(utf8Decode(new Uint8Array(d)));
      })
      .catch(function(err) {
        reject(new Error("AES-GCM: " + (err && err.message)));
      });
  });
}

function buildQuery(pairs) {
  var out = [];
  for (var i = 0; i < pairs.length; i++) {
    out.push(encodeURIComponent(pairs[i][0]) + "=" + encodeURIComponent(pairs[i][1]));
  }
  return out.join("&");
}

function fetchEndpoint(name, tmdbId, mediaType, season, episode) {
  return new Promise(function(resolve) {
    var pairs = [["tmdbId", String(tmdbId)], ["type", mediaType]];
    if (mediaType === "tv") {
      pairs.push(["seasonId", String(season || 1)]);
      pairs.push(["episodeId", String(episode || 1)]);
    }
    var url = HELIOS_BASE + "/" + name + "?" + buildQuery(pairs);
    log("GET " + url);

    // Minimal headers — no Referer/Origin (Nuvio fetch can't set those anyway)
    fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*"
      }
    })
      .then(function(r) {
        log("/" + name + " HTTP " + r.status);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function(text) {
        log("/" + name + " body length: " + text.length);
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {
          log("/" + name + " not JSON: " + text.substring(0, 120));
        }
        resolve(parsed);
      })
      .catch(function(e) {
        log("/" + name + " failed: " + (e && e.message));
        resolve(null);
      });
  });
}

function makeStream(url, serverName, quality) {
  return {
    name: PROVIDER_NAME + " " + quality,
    title: "\u2728 " + serverName + " \u2022 " + quality,
    url: url,
    quality: quality,
    headers: {
      "User-Agent": USER_AGENT
    },
    provider: PROVIDER_ID
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function(resolve) {
    log("Request: " + tmdbId + " " + mediaType + " S" + season + "E" + episode);
    if (!tmdbId) { resolve([]); return; }
    if (mediaType === "tv" && (!season || !episode)) { resolve([]); return; }

    var endpointPromises = ENDPOINTS.map(function(name) {
      return fetchEndpoint(name, tmdbId, mediaType, season, episode);
    });

    Promise.all(endpointPromises).then(function(results) {
      var encrypted = [];

      results.forEach(function(resp, i) {
        if (!resp || typeof resp !== "object") return;

        // Shape 1: {sources: {Moscow: {url: "ms_...", type: "hls", server: "Moscow"}}}
        if (resp.sources && typeof resp.sources === "object") {
          Object.keys(resp.sources).forEach(function(k) {
            var s = resp.sources[k];
            if (s && typeof s.url === "string" && s.url.indexOf("_") !== -1) {
              encrypted.push({
                url: s.url,
                server: s.server || k,
                label: s.label || "AUTO"
              });
            }
          });
        }

        // Shape 2: {dash: "pd_..."}   (pandora response)
        if (typeof resp.dash === "string" && resp.dash.indexOf("pd_") === 0) {
          encrypted.push({
            url: resp.dash,
            server: "Pandora",
            label: "DASH"
          });
        }

        // Shape 3: {url: "ms_..."} top-level
        if (typeof resp.url === "string" && /^[a-z]{2}_/.test(resp.url)) {
          encrypted.push({
            url: resp.url,
            server: ENDPOINTS[i] || "Server",
            label: "AUTO"
          });
        }
      });

      log("Collected " + encrypted.length + " encrypted URL(s)");

      var decPromises = encrypted.map(function(item) {
        return decryptAtlanticUrl(item.url).then(function(decrypted) {
          log(item.server + " decrypted OK (" + decrypted.length + " chars)");
          return { url: decrypted, server: item.server, label: item.label };
        }).catch(function(e) {
          log(item.server + " decrypt FAILED: " + (e && e.message));
          return null;
        });
      });

      return Promise.all(decPromises).then(function(decryptedList) {
        var streams = [];
        var seen = {};
        decryptedList.forEach(function(item) {
          if (!item) return;
          if (seen[item.url]) return;
          seen[item.url] = true;
          streams.push(makeStream(item.url, item.server, "AUTO"));
        });
        log("Returned " + streams.length + " stream(s)");
        resolve(streams);
      });
    }).catch(function(e) {
      log("getStreams error: " + (e && e.message));
      resolve([]);
    });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}

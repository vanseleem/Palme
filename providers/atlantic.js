var PROVIDER_ID = "atlantic";
var PROVIDER_NAME = "Atlantic";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
var HELIOS_BASE = "https://stream.hls.lol";
var AES_GCM_KEY_HEX = "117c358bcfcaf8fe2cfca57c9d2238a300e1c4de2efb83a5012ba84d8a31f1dd";

// Per-server endpoints — each returns its own {sources: {...}}
var ENDPOINTS = ["moscow", "planets", "saturn", "nova", "omsk"];

function log(m) { console.log("[Atlantic] " + m); }

function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
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
    var m = /^([a-z]{2})_(.+)$/i.exec(encryptedUrl);
    if (!m) { resolve(encryptedUrl); return; }

    var hexPayload = m[2];
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
      .catch(function(err) { reject(err); });
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
    log("GET /" + name);

    fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Referer": "https://atlantic.st/",
        "Origin": "https://atlantic.st"
      }
    })
      .then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function(data) { resolve(data); })
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
      "User-Agent": USER_AGENT,
      "Referer": "https://atlantic.st/",
      "Origin": "https://atlantic.st"
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
        if (!resp) return;

        // Per-server response: {sources: {Moscow: {url: "ms_...", type: "hls"}}}
        if (resp.sources && typeof resp.sources === "object") {
          Object.keys(resp.sources).forEach(function(k) {
            var s = resp.sources[k];
            if (s && s.url && typeof s.url === "string" && s.type !== "dash") {
              encrypted.push({
                url: s.url,
                server: s.server || k,
                label: s.label || "AUTO"
              });
            }
          });
        }

        // Top-level URL fallback
        if (typeof resp.url === "string" && /^[a-z]{2}_/i.test(resp.url)) {
          encrypted.push({ url: resp.url, server: ENDPOINTS[i], label: "AUTO" });
        }
      });

      log("Collected " + encrypted.length + " encrypted URL(s)");

      var decPromises = encrypted.map(function(item) {
        return decryptAtlanticUrl(item.url).then(function(decrypted) {
          log(item.server + " -> " + decrypted.substring(0, 80));
          return { url: decrypted, server: item.server, label: item.label };
        }).catch(function(e) {
          log(item.server + " decrypt failed: " + (e && e.message));
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

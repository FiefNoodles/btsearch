const parseTorrent = require("parse-torrent");
const express = require("express");
const app = express();
const fetch = require("node-fetch");
const torrentStream = require("torrent-stream");
const bodyParser = require("body-parser");
const pLimit = require('p-limit');
const http = require("http");
const limit = pLimit(10);

function getSize(size) {
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;

  return (
    "💾 " +
    (size / gb > 1 ? `${(size / gb).toFixed(2)} GB` : `${(size / mb).toFixed(2)} MB`)
  );
}

function getQuality(name) {
  name = name.toLowerCase();

  if (["2160", "4k", "uhd"].some((x) => name.includes(x))) return "🌟4k";
  if (["1080", "fhd"].some((x) => name.includes(x))) return " 🎥FHD";
  if (["720", "hd"].some((x) => name.includes(x))) return "📺HD";
  if (["480p", "380p", "sd"].some((x) => name.includes(x))) return "📱SD";
  return "";
}

const toStream = async (parsed, uri, tor, type, s, e) => {
  const infoHash = parsed.infoHash.toLowerCase();
  let title = tor.extraTag || parsed.name;
  let index = 0;

  if (!parsed.files && uri.startsWith("magnet")) {
    try {
      const engine = torrentStream("magnet:" + uri, {
        connections: 3, // Limit the number of connections/streams
      });

      const res = await new Promise((resolve, reject) => {
        engine.on("ready", function () {
          resolve(engine.files);
        });

        setTimeout(() => {
          resolve([]);
        }, 5000); // Timeout if the server is too slow
      });

      parsed.files = res;
      engine.destroy();
    } catch (error) {
      console.error("Error fetching torrent data:", error);
    }
  }

  if (type === "series") {
    index = (parsed.files || []).findIndex((element) => {
      return (
        element["name"]?.toLowerCase()?.includes(`s0${s}`) &&
        element["name"]?.toLowerCase()?.includes(`e0${e}`) &&
        [".mkv", ".mp4", ".avi", ".flv"].some((ext) =>
          element["name"]?.toLowerCase()?.includes(ext)
        )
      );
    });

    if (index === -1) {
      return null;
    }
    title += index === -1 ? "" : `\n${parsed.files[index]["name"]}`;
  }

  title += "\n" + getQuality(title);

  const subtitle = "S:" + tor["Seeders"] + " /P:" + tor["Peers"];
  title += ` | ${
    index === -1
      ? `${getSize(parsed.length || 0)}`
      : `${getSize((parsed.files && parsed.files[index]?.length) || 0)}`
  } | ${subtitle} `;

  return {
    name: tor["Tracker"],
    type,
    infoHash,
    fileIdx: index === -1 ? 0 : index,
    sources: (parsed.announce || []).map((x) => {
      return "tracker:" + x;
    }).concat(["dht:" + infoHash]),
    title,
    behaviorHints: {
      bingeGroup: `Jackett-Addon|${infoHash}`,
      notWebReady: true,
    },
  };
};

const isRedirect = async (url) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Request timeout"));
    }, 5000); // 5-second timeout

    http.get(url, { method: "HEAD" }, (response) => {
      clearTimeout(timeoutId);
      if (response.statusCode === 301 || response.statusCode === 302) {
        const locationURL = new URL(response.headers.location);
        if (locationURL.href.startsWith("http")) {
          resolve(isRedirect(locationURL.href));
        } else {
          resolve(locationURL.href);
        }
      } else if (response.statusCode >= 200 && response.statusCode < 300) {
        resolve(url);
      } else {
        resolve(null);
      }
    }).on("error", (error) => {
      clearTimeout(timeoutId);
      console.error("Error while following redirection:", error);
      resolve(null);
    });
  });
};

const streamFromMagnet = async (tor, uri, type, s, e, retries = 3) => {
  return new Promise(async (resolve, reject) => {
    let retryCount = 0;

    const attemptStream = async () => {
      try {
        // Follow redirection in case the URI is not directly accessible
        const realUrl = uri?.startsWith("magnet:?") ? uri : await isRedirect(uri);

        if (!realUrl) {
          console.log("No real URL found.");
          resolve(null);
          return;
        }

        if (realUrl.startsWith("magnet:?")) {
          const parsedTorrent = parseTorrent(realUrl);
          resolve(await toStream(parsedTorrent, realUrl, tor, type, s, e));
        } else if (realUrl.startsWith("http")) {
          parseTorrent.remote(realUrl, (err, parsed) => {
            if (!err) {
              resolve(toStream(parsed, realUrl, tor, type, s, e));
            } else {
              console.error("Error parsing HTTP:", err);
              resolve(null);
            }
          });
        } else {
          console.error("No HTTP nor magnet URI found.");
          resolve(null);
        }
      } catch (error) {
        console.error("Error while streaming from magnet:", error);
        retryCount++;
        if (retryCount < retries) {
          console.log("Retrying...");
          attemptStream();
        } else {
          console.error("Exceeded retry attempts. Giving up.");
          resolve(null);
        }
      }
    };

    attemptStream();
  });
};

let stream_results = [];
let torrent_results = [];

const host1 = {
  hostUrl: "http://206.189.27.179:9117",
  apiKey: "8pngmdxpel62ejnekdf3h1rpq4pcm7t6",
};

const host2 = {
  hostUrl: "http://94.61.74.253:9117",
  apiKey: "e71yh2n0fopfnyk2j2ywzjfa3sz4xv8d",
};

const fetchTorrentFromHost1 = async (query) => {
  const { hostUrl, apiKey } = host1;
  const url = `${hostUrl}/api/v2.0/indexers/all/results?apikey=${apiKey}&Query=${query}&Category%5B%5D=2000&Category%5B%5D=5000&Category%5B%5D=8000&Tracker%5B%5D=bitsearch&Tracker%5B%5D=concen`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        cookie:
          "Jackett=CfDJ8AG_XUDhxS5AsRKz0FldsDJIHUJANrfynyi54VzmYuhr5Ha5Uaww2hSQytMR8fFWjPvDH2lKCzaQhRYI9RuK613PZxJWz2tgHqg1wUAcPTMfi8b_8rm1Igw1-sZB_MnimHHK7ZSP7HfkWicMDaJ4bFGZwUf0xJOwcgjrwcUcFzzsVSTALt97-ibhc7PUn97v5AICX2_jsd6khO8TZosaPFt0cXNgNofimAkr5l6yMUjShg7R3TpVtJ1KxD8_0_OyBjR1mwtcxofJam2aZeFqVRxluD5hnzdyxOWrMRLSGzMPMKiaPXNCsxWy_yQhZhE66U_bVFadrsEeQqqaWb3LIFA",
      },
      referrerPolicy: "no-referrer",
      method: "GET",
    });

    if (!response.ok) {
      console.error("Error fetching torrents from host 1. Status:", response.status);
      return [];
    }

    const results = await response.json();
    console.log({ Host1: results["Results"].length });

    if (results["Results"].length !== 0) {
      return results["Results"].map((result) => ({
        Tracker: result["Tracker"],
        Category: result["CategoryDesc"],
        Title: result["Title"],
        Seeders: result["Seeders"],
        Peers: result["Peers"],
        Link: result["Link"],
        MagnetUri: result["MagnetUri"],
        Host: "Host1", // Add a new property indicating the host
      }));
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching torrents from host 1:", error);
    return [];
  }
};

const fetchTorrentFromHost2 = async (query) => {
  const { hostUrl, apiKey } = host2;
  const url = `${hostUrl}/api/v2.0/indexers/all/results?apikey=${apiKey}&Query=${query}&Category%5B%5D=2000&Category%5B%5D=5000&Category%5B%5D=8000&Tracker%5B%5D=megapeer`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        cookie:
          "Jackett=CfDJ8AG_XUDhxS5AsRKz0FldsDJIHUJANrfynyi54VzmYuhr5Ha5Uaww2hSQytMR8fFWjPvDH2lKCzaQhRYI9RuK613PZxJWz2tgHqg1wUAcPTMfi8b_8rm1Igw1-sZB_MnimHHK7ZSP7HfkWicMDaJ4bFGZwUf0xJOwcgjrwcUcFzzsVSTALt97-ibhc7PUn97v5AICX2_jsd6khO8TZosaPFt0cXNgNofimAkr5l6yMUjShg7R3TpVtJ1KxD8_0_OyBjR1mwtcxofJam2aZeFqVRxluD5hnzdyxOWrMRLSGzMPMKiaPXNCsxWy_yQhZhE66U_bVFadrsEeQqqaWb3LIFA",
      },
      referrerPolicy: "no-referrer",
      method: "GET",
    });

    if (!response.ok) {
      console.error("Error fetching torrents from host 2. Status:", response.status);
      return [];
    }

    const results = await response.json();
    console.log({ Host2: results["Results"].length });

    if (results["Results"].length !== 0) {
      return results["Results"].map((result) => ({
        Tracker: result["Tracker"],
        Category: result["CategoryDesc"],
        Title: result["Title"],
        Seeders: result["Seeders"],
        Peers: result["Peers"],
        Link: result["Link"],
        MagnetUri: result["MagnetUri"],
        Host: "Host2", // Add a new property indicating the host
      }));
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching torrents from host 2:", error);
    return [];
  }
};

function getMeta(id, type) {
  var [tt, s, e] = id.split(":");

  return fetch(`https://v2.sg.media-imdb.com/suggestion/t/${tt}.json`)
    .then((res) => res.json())
    .then((json) => json.d[0])
    .then(({ l, y }) => ({ name: l, year: y }))
    .catch((err) =>
      fetch(`https://v3-cinemeta.strem.io/meta/${type}/${tt}.json`)
        .then((res) => res.json())
        .then((json) => json.meta)
    );
}

app.get("/manifest.json", (req, res) => {
  const manifest = {
    id: "mikmc.od.org+++",
    version: "3.0.0",
    name: "HYJackett",
    description: "Movie & TV Streams from Jackett",
    logo: "https://raw.githubusercontent.com/mikmcdanbyeee55/bitsearch/main/hyjackett.jpg",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
  };

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");
  return res.send(manifest);
});

app.get("/stream/:type/:id", async (req, res) => {
  const media = req.params.type;
  let id = req.params.id;
  id = id.replace(".json", "");

  let [tt, s, e] = id.split(":");
  let query = "";
  let meta = await getMeta(tt, media);

  console.log({ meta: id });
  console.log({ meta });
  query = meta?.name;

  if (media === "movie") {
    query += " " + meta?.year;
  } else if (media === "series") {
    query += " S" + (s ?? "1").padStart(2, "0");
  }
  query = encodeURIComponent(query);

  // Fetch torrents from both hosts
  // Fetch torrents from both hosts
const result1 = await fetchTorrentFromHost1(query);
const result2 = await fetchTorrentFromHost2(query);

// Combine results from both hosts
// Combine results from both hosts
const combinedResults = result1.concat(result2);

// Process and filter the combined results
const uniqueResults = [];
const seenTorrents = new Set();

combinedResults.forEach((torrent) => {
  const torrentKey = `${torrent.Tracker}-${torrent.Title}`;
  if (
    !seenTorrents.has(torrentKey) &&
    (torrent["MagnetUri"] !== "" || torrent["Link"] !== "") &&
    torrent["Peers"] > 1
  ) {
    seenTorrents.add(torrentKey);
    uniqueResults.push(torrent);
  }
});

let stream_results = await Promise.all(
  uniqueResults.map((torrent) => {
    return streamFromMagnet(
      torrent,
      torrent["MagnetUri"] || torrent["Link"],
      media,
      s,
      e
    );
  })
);

stream_results = stream_results.filter((e) => !!e);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Content-Type", "application/json");

  console.log({ check: "check" });

  console.log({ Final: stream_results.length });

  return res.send({ streams: stream_results });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("The server is working on port " + port);
});

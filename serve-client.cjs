// Static host for the PlugBoard SPA. No dependencies (Node core only).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CLIENT_PORT = Number(process.env.CLIENT_PORT || 3000);
const API_PORT = Number(process.env.API_PORT || 4000);
const ROOT = path.join(__dirname, "client", "dist");
const PROXY_PREFIXES = ["/api", "/plugin-assets"];

// --- browser-presence watchdog -------------------------------------------------
// The SPA holds an SSE connection to /__alive. When the last browser tab closes,
// that connection drops; after a short grace we stop the whole app (supervisor
// tree), so closing the dashboard quits PlugBoard. A refresh reconnects within
// the grace window, so it does not trigger a shutdown.
const SUPERVISOR_PID = process.env.SUPERVISOR_PID || "";
const IDLE_GRACE_MS = 10000;
let liveConnections = 0;
let everConnected = false;
let idleSince = null;

function handleAlive(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 2000\n\n");
  liveConnections++;
  everConnected = true;
  idleSince = null;
  const keepAlive = setInterval(() => { try { res.write(": ka\n\n"); } catch (e) {} }, 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
    liveConnections = Math.max(0, liveConnections - 1);
    if (liveConnections === 0) idleSince = Date.now();
  });
}

if (SUPERVISOR_PID) {
  setInterval(() => {
    if (everConnected && liveConnections === 0 && idleSince && Date.now() - idleSince > IDLE_GRACE_MS) {
      // Browser closed -> stop the whole app (kills the supervisor process tree,
      // including this UI host, the API, and any plugin apps).
      spawnSync("taskkill", ["/PID", SUPERVISOR_PID, "/T", "/F"], { windowsHide: true });
      process.exit(0);
    }
  }, 3000);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json",
};

function proxy(req, res) {
  const options = {
    host: "127.0.0.1", port: API_PORT, method: req.method,
    path: req.url, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
  };
  const upstream = http.request(options, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "The PlugBoard API is not reachable yet. Is it still starting?" }));
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  // Strip query string, block path traversal, default to index.html.
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        // SPA fallback: unknown non-file routes are client-side routes.
        fs.readFile(path.join(ROOT, "index.html"), (err3, html) => {
          if (err3) { res.writeHead(404).end("Not found"); return; }
          res.writeHead(200, { "content-type": MIME[".html"] });
          res.end(html);
        });
        return;
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(data);
    });
  });
}

http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/__alive") handleAlive(req, res);
  else if (PROXY_PREFIXES.some((p) => url === p || url.startsWith(p + "/"))) proxy(req, res);
  else serveStatic(req, res);
}).listen(CLIENT_PORT, () => {
  console.log(`PlugBoard UI on http://localhost:${CLIENT_PORT}  (API proxied to :${API_PORT})`);
});

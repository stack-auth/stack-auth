#!/usr/bin/env node

// Static file server for ./public plus a /api/status endpoint that TCP-checks
// local service ports (works for non-HTTP services like PostgreSQL/SMTP too,
// which a browser-side fetch can't probe).

const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const prefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
const port = Number(process.env.DEV_LAUNCHPAD_PORT ?? `${prefix}00`);
const publicDir = path.join(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const checkPort = (portToCheck) => new Promise((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port: portToCheck });
  socket.setTimeout(1500);
  let settled = false;
  const done = (result) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(result);
  };
  socket.once("connect", () => done(true));
  socket.once("timeout", () => done(false));
  socket.once("error", () => done(false));
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === "/api/status") {
    const ports = [...new Set(
      (url.searchParams.get("ports") ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
    )].slice(0, 128);
    const results = await Promise.all(ports.map(checkPort));
    const body = Object.fromEntries(ports.map((p, i) => [p, results[i]]));
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
    return;
  }

  let filePath = path.normalize(path.join(publicDir, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  }
  if (!stat) {
    // SPA-style fallback, matching the previous `serve -s` behavior
    filePath = path.join(publicDir, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME_TYPES[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`[dev-launchpad] Serving ${publicDir} at http://localhost:${port}`);
});

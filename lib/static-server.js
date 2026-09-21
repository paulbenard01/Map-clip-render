/**
 * The project's little local file server.
 *
 * Used by lib/renderer.js (so the headless page can load its own map data)
 * and by server.js (which serves the builder and adds API routes on top).
 * Local only, by design: nothing here reaches the network, which is what
 * makes renders reproducible and keeps the tool usable offline.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".map": "application/json", ".mp4": "video/mp4",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * Serves `req` from `rootDir`. Returns true if it handled the request, so a
 * caller can try its own routes first and fall through to static files.
 */
function serveStatic(req, res, rootDir, opts) {
  opts = opts || {};
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = opts.index || "/map.html";

  const filePath = path.join(rootDir, urlPath);
  // Keep traversal inside the project folder.
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    res.writeHead(404);
    res.end("Not found: " + urlPath);
    return true;
  }
  if (stat.isDirectory()) {
    res.writeHead(404);
    res.end("Not found: " + urlPath);
    return true;
  }

  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Content-Length": stat.size,
    // The builder reloads assets constantly while editing; never let a stale
    // copy of a scene or a just-uploaded photo be served from cache.
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/** Starts a static-only server on an ephemeral port. */
function startServer(rootDir, opts) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => serveStatic(req, res, rootDir, opts));
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { MIME, contentType, serveStatic, startServer };

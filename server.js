#!/usr/bin/env node
/**
 * The builder's local backend.
 *
 * Serves builder.html and the project's own files, and adds the handful of
 * endpoints the editor needs on top: listing and saving scenes, taking image
 * uploads, searching openly-licensed photos, and running renders.
 *
 * Renders go through lib/renderer.js — the same frame-exact capture loop the
 * CLI uses. The UI never captures video itself.
 *
 * Everything binds to 127.0.0.1. The only outbound network calls in the whole
 * project are the image searches below, and those happen while you're
 * authoring, never while rendering: a found photo is downloaded into assets/
 * and referenced by local path, so renders stay offline and reproducible.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");

const { serveStatic } = require("./lib/static-server.js");
const { renderScene, ensureBasemap } = require("./lib/renderer.js");
const Engine = require("./lib/scene-engine.js");
const images = require("./lib/image-search.js");

const ROOT = __dirname;
const SCENES_DIR = path.join(ROOT, "scenes");
const ASSETS_DIR = path.join(ROOT, "assets");
const OUTPUT_DIR = path.join(ROOT, "output");

const PORT = Number(process.env.PORT) || 4317;

// jobId -> { id, status, phase, frame, totalFrames, message, outPath, error, controller, listeners[] }
const jobs = new Map();

// ------------------------------------------------------------ helpers
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(payload);
}

function readBody(req, limitBytes) {
  limitBytes = limitBytes || 32 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  return JSON.parse(buf.toString("utf8"));
}

/** Filenames that can't climb out of their directory. */
function safeName(name, fallback) {
  const base = path.basename(String(name || "")).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+/, "");
  return base || fallback;
}

// ------------------------------------------------------------- routes
async function handleApi(req, res, url) {
  const route = url.pathname;

  // ---- scenes ----
  if (route === "/api/scenes" && req.method === "GET") {
    fs.mkdirSync(SCENES_DIR, { recursive: true });
    const files = listScenes(SCENES_DIR)
      .sort((a, b) => (a.folder || "").localeCompare(b.folder || "") || a.name.localeCompare(b.name));
    return sendJson(res, 200, { scenes: files });
  }

  if (route === "/api/scenes" && req.method === "POST") {
    const body = await readJson(req);
    const name = safeName(body.name, "untitled");
    const file = name.endsWith(".json") ? name : name + ".json";
    // An optional single subfolder, sanitised the same way the filename is.
    const folder = body.folder ? safeName(body.folder, "") : "";
    const dir = folder ? path.join(SCENES_DIR, folder) : SCENES_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, file);
    const serialized = Engine.serializeScene(body.scene || {});
    // The filename is what the person actually chose, so it wins over
    // whatever `name` the scene was carrying (a template's, usually).
    serialized.name = path.basename(file, ".json");
    fs.writeFileSync(target, JSON.stringify(serialized, null, 2) + "\n");
    const rel = (folder ? folder + "/" : "") + file;
    return sendJson(res, 200, { saved: "/scenes/" + rel, name: path.basename(file, ".json") });
  }

  // ---- asset upload ----
  if (route === "/api/assets" && req.method === "POST") {
    const filename = safeName(url.searchParams.get("filename"), "upload.jpg");
    const buf = await readBody(req);
    if (!buf.length) return sendJson(res, 400, { error: "Empty upload" });
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    const target = uniquePath(ASSETS_DIR, filename);
    fs.writeFileSync(target, buf);
    return sendJson(res, 200, { path: "/assets/" + path.basename(target), bytes: buf.length });
  }

  // ---- openly-licensed image search ----
  if (route === "/api/images/search" && req.method === "GET") {
    const q = url.searchParams.get("q") || "";
    const source = url.searchParams.get("source") || "all";
    if (!q.trim()) return sendJson(res, 400, { error: "Missing search term" });
    try {
      const results = await images.search(q, source);
      return sendJson(res, 200, { results });
    } catch (err) {
      return sendJson(res, 502, { error: "Image search failed: " + err.message });
    }
  }

  if (route === "/api/images/import" && req.method === "POST") {
    const body = await readJson(req);
    if (!body.url) return sendJson(res, 400, { error: "Missing url" });
    try {
      const saved = await images.importToAssets(body, ASSETS_DIR, ROOT);
      return sendJson(res, 200, saved);
    } catch (err) {
      return sendJson(res, 502, { error: "Could not fetch that image: " + err.message });
    }
  }

  // ---- render ----
  if (route === "/api/render" && req.method === "POST") {
    const body = await readJson(req);
    if (!body.scene) return sendJson(res, 400, { error: "Missing scene" });
    const job = startRenderJob(body);
    return sendJson(res, 202, { jobId: job.id, totalFrames: job.totalFrames });
  }

  const renderMatch = route.match(/^\/api\/render\/([a-z0-9]+)(\/events|\/cancel)?$/);
  if (renderMatch) {
    const job = jobs.get(renderMatch[1]);
    if (!job) return sendJson(res, 404, { error: "No such render job" });

    if (renderMatch[2] === "/events") return streamJob(req, res, job);
    if (renderMatch[2] === "/cancel" && req.method === "POST") {
      job.controller.abort();
      return sendJson(res, 200, { cancelled: true });
    }
    return sendJson(res, 200, publicJob(job)); // polling fallback
  }

  return false;
}


/**
 * Walks scenes/ for scene files, one level of subfolders deep.
 *
 * Subfolders are how a project's clips stay together — scenes/sarnath/ rather
 * than nine files loose among everything else. One level is deliberate: deeper
 * nesting would want a tree widget, and a flat group list is easier to scan.
 */
function listScenes(dir, folder, depth) {
  folder = folder || "";
  depth = depth || 0;
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return out; }

  entries.forEach((entry) => {
    if (entry.isDirectory()) {
      if (depth < 1 && !entry.name.startsWith(".")) {
        out.push.apply(out, listScenes(path.join(dir, entry.name), path.join(folder, entry.name), depth + 1));
      }
      return;
    }
    if (!entry.name.endsWith(".json")) return;

    const full = path.join(dir, entry.name);
    const rel = path.join(folder, entry.name).split(path.sep).join("/");
    let title = null, duration = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      title = parsed.name || null;
      duration = Engine.computeDuration(Engine.normalizeScene(parsed));
    } catch (err) { /* a scene mid-edit shouldn't break the list */ }

    out.push({
      file: rel,
      name: path.basename(entry.name, ".json"),
      folder: folder.split(path.sep).join("/"),
      title,
      duration,
      modified: fs.statSync(full).mtimeMs,
    });
  });
  return out;
}

function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 2;
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${base}-${n++}${ext}`);
  return candidate;
}

// ------------------------------------------------------------- render jobs
function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    frame: job.frame,
    totalFrames: job.totalFrames,
    message: job.message,
    output: job.output || null,
    error: job.error || null,
  };
}

function startRenderJob(body) {
  const id = crypto.randomBytes(6).toString("hex");
  const controller = new AbortController();
  const normalized = Engine.normalizeScene(body.scene);
  const draft = !!body.draft;
  const fps = body.fps || (draft ? 12 : normalized.fps);

  const job = {
    id,
    status: "running",
    phase: "starting",
    frame: 0,
    totalFrames: Math.max(1, Math.round(Engine.computeDuration(normalized) * fps)),
    message: "Starting",
    controller,
    listeners: [],
    log: [],
  };
  jobs.set(id, job);

  renderScene({
    scene: body.scene,
    name: body.name || "scene",
    ratio: body.ratio,
    style: body.style,
    fps: body.fps,
    width: body.width,
    draft,
    out: body.out ? path.join(OUTPUT_DIR, safeName(body.out, "scene.mp4")) : undefined,
    signal: controller.signal,
    log: (msg) => { job.log.push(String(msg).trim()); if (job.log.length > 200) job.log.shift(); },
    onProgress: (p) => {
      job.phase = p.phase;
      job.frame = p.frame;
      job.totalFrames = p.totalFrames;
      job.message = p.message;
      emit(job);
    },
  }).then((result) => {
    job.status = "done";
    job.phase = "done";
    job.message = "Done";
    // Served back through the same local server, so the page can preview it.
    job.output = {
      url: "/output/" + path.basename(result.outPath),
      file: result.outPath,
      width: result.width,
      height: result.height,
      fps: result.fps,
      duration: result.duration,
    };
    emit(job, true);
  }).catch((err) => {
    job.status = err && err.cancelled ? "cancelled" : "error";
    job.phase = job.status;
    job.error = err && err.cancelled ? "Cancelled" : (err.message || String(err));
    job.message = job.error;
    emit(job, true);
  });

  return job;
}

function emit(job, final) {
  const payload = "data: " + JSON.stringify(publicJob(job)) + "\n\n";
  job.listeners.forEach((res) => {
    try { res.write(payload); } catch (err) { /* client went away */ }
  });
  if (final) {
    job.listeners.forEach((res) => { try { res.end(); } catch (err) { /* ignore */ } });
    job.listeners = [];
    // Keep the finished job around briefly so a late poll still sees it.
    setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000).unref();
  }
}

function streamJob(req, res, job) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write("data: " + JSON.stringify(publicJob(job)) + "\n\n");

  if (job.status !== "running") { res.end(); return true; }

  job.listeners.push(res);
  req.on("close", () => {
    job.listeners = job.listeners.filter((r) => r !== res);
  });
  return true;
}

// ------------------------------------------------------------------ main
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname.startsWith("/api/")) {
    Promise.resolve(handleApi(req, res, url))
      .then((handled) => {
        if (handled === false) sendJson(res, 404, { error: "Unknown endpoint " + url.pathname });
      })
      .catch((err) => sendJson(res, 500, { error: err.message || String(err) }));
    return;
  }

  serveStatic(req, res, ROOT, { index: "/builder.html" });
});

/**
 * Opens the builder in the default browser.
 *
 * Best-effort on purpose: if the platform's opener isn't there, the URL is
 * already printed above and the server carries on regardless. Failing to
 * launch a browser is never a reason to fail to start.
 */
function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd"
    : process.platform === "darwin" ? "open"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch (err) {
    /* no browser opener available — the printed URL still works */
  }
}

// The basemap in data/ is generated from world-atlas rather than committed,
// so a fresh clone doesn't have it yet. Build it before accepting requests:
// otherwise the builder's first fetch of /data/land.geo.json 404s, and the
// page fails on a JSON parse error that says nothing about the real cause.
ensureBasemap((msg) => console.log(msg));

server.listen(PORT, "127.0.0.1", () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Heritle scene builder running at ${url}`);
  console.log(`  scenes: ${path.relative(ROOT, SCENES_DIR)}/   output: ${path.relative(ROOT, OUTPUT_DIR)}/`);
  console.log("  Leave this window open while you work. Ctrl+C to stop.");

  if (!process.argv.includes("--no-open") && !process.env.HERITLE_NO_OPEN) {
    openBrowser(url);
  }
});

// A friendlier message than a raw stack trace when the port is already taken,
// which usually just means the builder is already running in another window.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error("The builder is probably already running — try http://127.0.0.1:" + PORT);
    console.error("If not, close the other window, or start this one with:  set PORT=4318 && node server.js");
    process.exit(1);
  }
  throw err;
});

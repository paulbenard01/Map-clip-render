/**
 * renderer.js — the frame-exact capture pipeline.
 *
 * Starts a local server, opens map.html in headless Chromium, steps through
 * the scene one frame at a time jumping the camera straight to the
 * interpolated state for that exact timestamp, screenshots each frame, then
 * hands the sequence to ffmpeg.
 *
 * This is deliberately *not* a real-time capture. Stepping frame by frame is
 * what makes output timing exact regardless of how fast the machine is — the
 * same reason animation software renders this way. The builder's preview uses
 * smooth real-time playback because scrubbing is a different job, but the
 * export button comes through here.
 *
 * Both the CLI (render.js) and the builder's /api/render endpoint call
 * renderScene(); there is one capture loop, not two.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const { chromium } = require("playwright");

const { startServer } = require("./static-server.js");
const Engine = require("./scene-engine.js");

const ROOT = path.join(__dirname, "..");

/**
 * Builds the offline basemap if it's missing or out of date.
 *
 * The version check matters as much as the existence check: when a fix
 * changes the generated data, an existing install has files that are present
 * but wrong, and nothing would otherwise notice.
 */
function ensureBasemap(log) {
  const dataDir = path.join(ROOT, "data");
  const { BASEMAP_VERSION } = require("./build-basemap.js");

  let reason = null;
  if (!fs.existsSync(path.join(dataDir, "land.geo.json"))) {
    reason = "Basemap data not found, building it now (one-time step)...";
  } else {
    let stamp = null;
    try { stamp = JSON.parse(fs.readFileSync(path.join(dataDir, "version.json"), "utf8")); } catch (err) { stamp = null; }
    if (!stamp || stamp.version !== BASEMAP_VERSION) {
      reason = "Basemap data is out of date, rebuilding it (one-time step)...";
    }
  }
  if (!reason) return;

  log(reason);
  spawnSync(process.execPath, [path.join(ROOT, "lib", "build-basemap.js")], { stdio: "inherit" });
}

/**
 * Output dimensions, plus how to get them out of the browser.
 *
 * A draft is half resolution, but it must frame *identically* to the full
 * render or it's useless for the thing it exists for — checking the shot.
 * Shrinking the viewport at the same zoom would show half as much map, so a
 * draft instead keeps the full-size CSS viewport and captures it at
 * deviceScaleFactor 0.5. Same field of view, half the pixels, and the GPU
 * still only rasterises the smaller buffer, so it stays fast.
 */
function resolveDimensions(ratio, width, draft) {
  let w, h;
  if (ratio === "9:16") { w = width || 1080; h = Math.round(w * 16 / 9); }
  else if (ratio === "16:9") { w = width || 1920; h = Math.round(w * 9 / 16); }
  else throw new Error('Unsupported ratio (use "9:16" or "16:9"): ' + ratio);

  // The layout size the page believes it has — the same either way, which is
  // what keeps the framing identical.
  const cssWidth = w;
  const cssHeight = h;
  const deviceScaleFactor = draft ? 0.5 : 1;

  if (draft) { w = Math.round(w * deviceScaleFactor); h = Math.round(h * deviceScaleFactor); }
  // libx264 requires even dimensions.
  if (w % 2) w += 1;
  if (h % 2) h += 1;
  return { width: w, height: h, cssWidth, cssHeight, deviceScaleFactor };
}

/**
 * Renders a scene to an MP4.
 *
 * Options:
 *   scene        scene object (from the builder), or
 *   scenePath    path to a scene JSON file (from the CLI)
 *   name         output basename when rendering an in-memory scene
 *   ratio        "9:16" | "16:9"        (default: scene.aspect, else 16:9)
 *   style        preset key             (default: scene.style)
 *   fps          frames per second      (default: scene.fps, else 30)
 *   width        output width override
 *   out          output file path
 *   draft        half resolution, 12fps, rougher encode
 *   keepFrames   keep the intermediate PNGs
 *   onProgress   ({ phase, frame, totalFrames, message }) => void
 *   signal       AbortSignal to cancel mid-render
 *
 * Resolves to { outPath, width, height, fps, duration, totalFrames }.
 */
async function renderScene(options) {
  const opts = options || {};
  const onProgress = opts.onProgress || function () {};
  const log = opts.log || function () {};
  const signal = opts.signal;

  const throwIfAborted = () => {
    if (signal && signal.aborted) {
      const err = new Error("Render cancelled");
      err.cancelled = true;
      throw err;
    }
  };

  let scene, sceneName, scenePath = null;
  if (opts.scenePath) {
    scenePath = path.resolve(opts.scenePath);
    if (!fs.existsSync(scenePath)) throw new Error("Scene file not found: " + scenePath);
    scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
    sceneName = path.basename(scenePath, ".json");
  } else if (opts.scene) {
    scene = opts.scene;
    sceneName = opts.name || scene.name || "scene";
  } else {
    throw new Error("renderScene needs either scenePath or scene");
  }

  ensureBasemap(log);

  const normalized = Engine.normalizeScene(scene);
  const ratio = opts.ratio || normalized.aspect;
  const style = opts.style || normalized.style;
  const draft = !!opts.draft;
  const fps = opts.fps || (draft ? 12 : normalized.fps);

  const { width, height, cssWidth, cssHeight, deviceScaleFactor } = resolveDimensions(ratio, opts.width, draft);
  const duration = Engine.computeDuration(normalized);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const safeName = String(sceneName).replace(/[^a-zA-Z0-9._-]/g, "-");
  const outPath = path.resolve(opts.out || path.join(ROOT, "output", `${safeName}${draft ? ".draft" : ""}.mp4`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  log(`Scene:      ${scenePath || "(in-memory) " + sceneName}`);
  log(`Style:      ${style}`);
  log(`Output:     ${width}x${height} @ ${fps}fps, ${duration.toFixed(2)}s (${totalFrames} frames)${draft ? "  [draft]" : ""}`);
  log(`Target:     ${outPath}`);

  onProgress({ phase: "starting", frame: 0, totalFrames, message: "Starting browser" });

  const server = await startServer(ROOT);
  const port = server.address().port;
  let browser = null;
  let tmpDir = null;

  try {
    throwIfAborted();
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: cssWidth, height: cssHeight },
      deviceScaleFactor,
    });

    page.on("console", (msg) => { if (msg.type() === "error") log("[page error] " + msg.text()); });
    page.on("pageerror", (err) => log("[page exception] " + err.message));

    let url;
    if (scenePath && scenePath.startsWith(ROOT)) {
      // CLI path: let the page fetch the file straight off the local server.
      const sceneUrlPath = "/" + path.relative(ROOT, scenePath).split(path.sep).join("/");
      url = `http://127.0.0.1:${port}/map.html?scene=${encodeURIComponent(sceneUrlPath)}&style=${encodeURIComponent(style)}`;
    } else {
      // Builder path (or a scene file outside the project): hand the page the
      // scene directly rather than writing a temp file into the project.
      await page.addInitScript((json) => { window.__SCENE_JSON = json; }, JSON.stringify(scene));
      url = `http://127.0.0.1:${port}/map.html?style=${encodeURIComponent(style)}`;
    }

    await page.goto(url);
    await page.waitForFunction("window.__ready === true", { timeout: 30000 });
    throwIfAborted();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heritle-frames-"));

    log("Rendering frames...");
    onProgress({ phase: "frames", frame: 0, totalFrames, message: "Rendering frames" });

    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted();
      const t = i / fps;
      await page.evaluate((t) => window.__setFrame(t), t);
      // Two rAF ticks: lets MapLibre paint the jumpTo before the screenshot.
      // Everything is local GeoJSON already loaded, so this settles well
      // under a frame's worth of time — no network-driven jitter.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(tmpDir, `frame_${String(i).padStart(6, "0")}.png`) });

      if (i % 10 === 0 || i === totalFrames - 1) {
        log(`\r  frame ${i + 1} / ${totalFrames}`, true);
        onProgress({ phase: "frames", frame: i + 1, totalFrames, message: `frame ${i + 1} / ${totalFrames}` });
      }
    }
    log("");

    await browser.close();
    browser = null;
    server.close();

    throwIfAborted();
    log("Encoding with ffmpeg...");
    onProgress({ phase: "encoding", frame: totalFrames, totalFrames, message: "Encoding with ffmpeg" });

    await encode({ tmpDir, outPath, fps, draft, signal });

    if (!opts.keepFrames) fs.rmSync(tmpDir, { recursive: true, force: true });
    else log("Frames kept at: " + tmpDir);
    tmpDir = null;

    log("Done: " + outPath);
    onProgress({ phase: "done", frame: totalFrames, totalFrames, message: "Done", outPath });

    return { outPath, width, height, fps, duration, totalFrames, style, ratio };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { server.close(); } catch (err) { /* already closed */ }
    if (tmpDir && !opts.keepFrames) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function encode(opts) {
  const { tmpDir, outPath, fps, draft, signal } = opts;
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-framerate", String(fps),
      "-i", path.join(tmpDir, "frame_%06d.png"),
      "-c:v", "libx264",
      "-preset", draft ? "veryfast" : "medium",
      "-crf", draft ? "28" : "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outPath,
    ];
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    ff.stderr.on("data", (d) => { stderr += d.toString(); });

    const onAbort = () => ff.kill("SIGKILL");
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    ff.on("error", (err) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(
        err.code === "ENOENT"
          ? "ffmpeg not found. Install it and make sure it's on your PATH (see README)."
          : "ffmpeg failed to start: " + err.message
      ));
    });
    ff.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (code === 0) return resolve();
      if (signal && signal.aborted) {
        const err = new Error("Render cancelled");
        err.cancelled = true;
        return reject(err);
      }
      reject(new Error("ffmpeg exited with code " + code + "\n" + stderr.split("\n").slice(-12).join("\n")));
    });
  });
}

module.exports = { renderScene, resolveDimensions, ensureBasemap, ROOT };

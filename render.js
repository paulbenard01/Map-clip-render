#!/usr/bin/env node
/**
 * Heritle map-animation renderer.
 *
 * Usage:
 *   node render.js --scene scenes/example-sarnath.json --ratio 9:16 --out output/sarnath.mp4
 *
 * Flags:
 *   --scene   <path>        Scene JSON file (required)
 *   --ratio   9:16 | 16:9   Output aspect ratio (default: from scene, else 16:9)
 *   --style   <name>        dark-navy | muted-editorial | mono-contrast (default: from scene, else dark-navy)
 *   --fps     <n>           Frames per second (default: from scene, else 30)
 *   --out     <path.mp4>    Output file (default: output/<scene-name>.mp4)
 *   --width   <px>          Override output width (height follows the ratio)
 *   --draft                 Fast low-res preview: half resolution, 12fps, rougher encode
 *   --keep-frames           Don't delete the intermediate PNG frames after encoding
 *
 * Fully offline: the basemap is a local file (see lib/build-basemap.js), so
 * nothing here reaches the network. Re-run `npm run build-basemap` if you
 * ever delete the data/ folder.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = __dirname;

// ---------------------------------------------------------------- CLI args
function parseArgs(argv) {
  const args = { draft: false, keepFrames: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene") args.scene = argv[++i];
    else if (a === "--ratio") args.ratio = argv[++i];
    else if (a === "--style") args.style = argv[++i];
    else if (a === "--fps") args.fps = parseInt(argv[++i], 10);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--width") args.width = parseInt(argv[++i], 10);
    else if (a === "--draft") args.draft = true;
    else if (a === "--keep-frames") args.keepFrames = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Heritle map-animation renderer

  node render.js --scene <scene.json> [options]

Options:
  --ratio 9:16|16:9     Output aspect ratio (default: from scene, else 16:9)
  --style <name>        dark-navy | muted-editorial | mono-contrast
  --fps <n>             Frames per second (default: from scene, else 30)
  --out <path.mp4>      Output file path
  --width <px>          Override output width in pixels
  --draft               Fast low-res preview render
  --keep-frames         Keep the intermediate PNG frames on disk
`);
}

// ------------------------------------------------------------ tiny server
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".map": "application/json",
};

function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/") urlPath = "/map.html";
      const filePath = path.join(rootDir, urlPath);
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found: " + urlPath); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ------------------------------------------------------------ duration calc
function computeDuration(scene) {
  if (typeof scene.duration === "number") return scene.duration;
  const ends = [3]; // floor
  const cams = scene.camera || [];
  if (cams.length) ends.push(cams[cams.length - 1].t + 1.5);
  (scene.pins || []).forEach((p) => { if (typeof p.until === "number") ends.push(p.until + 0.5); });
  (scene.titles || []).forEach((t) => { if (typeof t.until === "number") ends.push(t.until + 0.5); });
  (scene.routes || []).forEach((r) => {
    const start = r.startAt || 0, dur = r.drawDuration != null ? r.drawDuration : 1.2;
    ends.push(start + dur + (typeof r.until === "number" ? (r.until - start - dur) + 1.5 : 1.5));
  });
  return Math.max(...ends);
}

// ------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.scene) { printHelp(); process.exit(args.help ? 0 : 1); }

  const scenePath = path.resolve(args.scene);
  if (!fs.existsSync(scenePath)) { console.error("Scene file not found:", scenePath); process.exit(1); }
  const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));

  // Ensure the offline basemap exists.
  const dataDir = path.join(ROOT, "data");
  if (!fs.existsSync(path.join(dataDir, "land.geo.json"))) {
    console.log("Basemap data not found, building it now (one-time step)...");
    spawnSync(process.execPath, [path.join(ROOT, "lib", "build-basemap.js")], { stdio: "inherit" });
  }

  const ratio = args.ratio || scene.aspect || "16:9";
  const style = args.style || scene.style || "dark-navy";
  let fps = args.fps || scene.fps || 30;

  let width, height;
  if (ratio === "9:16") { width = args.width || 1080; height = Math.round(width * 16 / 9); }
  else if (ratio === "16:9") { width = args.width || 1920; height = Math.round(width * 9 / 16); }
  else { console.error('Unsupported --ratio (use "9:16" or "16:9"):', ratio); process.exit(1); }

  if (args.draft) { width = Math.round(width / 2 / 2) * 2; height = Math.round(height / 2 / 2) * 2; fps = args.fps || 12; }
  // libx264 requires even dimensions.
  width = width % 2 === 0 ? width : width + 1;
  height = height % 2 === 0 ? height : height + 1;

  const duration = computeDuration(scene);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const sceneName = path.basename(scenePath, ".json");
  const outPath = path.resolve(args.out || path.join(ROOT, "output", `${sceneName}${args.draft ? ".draft" : ""}.mp4`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`Scene:      ${scenePath}`);
  console.log(`Style:      ${style}`);
  console.log(`Output:     ${width}x${height} @ ${fps}fps, ${duration.toFixed(2)}s (${totalFrames} frames)${args.draft ? "  [draft]" : ""}`);
  console.log(`Target:     ${outPath}`);

  const server = await startServer(ROOT);
  const port = server.address().port;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

  // Scene path served relative to project root, e.g. /scenes/foo.json
  const sceneUrlPath = "/" + path.relative(ROOT, scenePath).split(path.sep).join("/");
  const url = `http://127.0.0.1:${port}/map.html?scene=${encodeURIComponent(sceneUrlPath)}&style=${encodeURIComponent(style)}`;

  page.on("console", (msg) => { if (msg.type() === "error") console.error("[page error]", msg.text()); });
  page.on("pageerror", (err) => console.error("[page exception]", err.message));

  await page.goto(url);
  await page.waitForFunction("window.__ready === true", { timeout: 30000 });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heritle-frames-"));

  process.stdout.write("Rendering frames...\n");
  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    await page.evaluate((t) => window.__setFrame(t), t);
    // Two rAF ticks: lets MapLibre paint the jumpTo before we screenshot.
    // Everything here is local GeoJSON already loaded, so this settles
    // in well under a frame's worth of time — no network-driven jitter.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const framePath = path.join(tmpDir, `frame_${String(i).padStart(6, "0")}.png`);
    await page.screenshot({ path: framePath });
    if (i % 10 === 0 || i === totalFrames - 1) {
      process.stdout.write(`\r  frame ${i + 1} / ${totalFrames}`);
    }
  }
  process.stdout.write("\n");

  await browser.close();
  server.close();

  console.log("Encoding with ffmpeg...");
  const crf = args.draft ? "28" : "18";
  const ffArgs = [
    "-y",
    "-framerate", String(fps),
    "-i", path.join(tmpDir, "frame_%06d.png"),
    "-c:v", "libx264",
    "-preset", args.draft ? "veryfast" : "medium",
    "-crf", crf,
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ];
  const ff = spawnSync("ffmpeg", ffArgs, { stdio: "inherit" });
  if (ff.status !== 0) {
    console.error("ffmpeg failed. Frames were kept at:", tmpDir);
    process.exit(1);
  }

  if (!args.keepFrames) fs.rmSync(tmpDir, { recursive: true, force: true });
  else console.log("Frames kept at:", tmpDir);

  console.log("Done:", outPath);
}

main().catch((err) => { console.error(err); process.exit(1); });

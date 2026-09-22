#!/usr/bin/env node
/**
 * Renders a portrait explainer composition (video/<name>/index.html) to MP4.
 *
 *   node video/render.js sarnath                      full render, output/sarnath.mp4
 *   node video/render.js sarnath --stills 5,20.5,90   PNG frames to output/stills/ for review
 *   node video/render.js sarnath --from 60 --to 75    just a slice
 *   node video/render.js sarnath --draft              540x960, faster, for timing checks
 *
 * The composition is a pure function of time (window.__setFrame(t)), so the
 * frame range is split across several headless browsers that each pipe
 * JPEG screenshots straight into their own ffmpeg; the pieces are then joined
 * without re-encoding. No audio: the voiceover goes on in the edit.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const { startServer } = require("../lib/static-server.js");

const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const a = { name: null, fps: 30, workers: Math.max(1, Math.min(4, require("os").cpus().length - 1)), draft: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--fps") a.fps = +argv[++i];
    else if (k === "--from") a.from = +argv[++i];
    else if (k === "--to") a.to = +argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--workers") a.workers = +argv[++i];
    else if (k === "--stills") a.stills = argv[++i].split(",").map(Number);
    else if (k === "--draft") a.draft = true;
    else if (!k.startsWith("--")) a.name = k;
  }
  return a;
}

async function openPage(browser, url, scale) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: scale });
  page.on("pageerror", (e) => console.error("[page] " + e.message));
  // Missing photos 404 by design (they render as placeholders), so skip resource errors.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.error("[page] " + m.text()); });
  await page.goto(url);
  await page.waitForFunction("window.__ready === true || window.__error", null, { timeout: 120000 });
  const err = await page.evaluate("window.__error");
  if (err) throw new Error("composition failed to load:\n" + err);
  return page;
}

async function frame(page, t, type) {
  await page.evaluate((t) => window.__setFrame(t), t);
  return page.screenshot(type === "png" ? { type: "png" } : { type: "jpeg", quality: 93 });
}

function ffmpegSegment(out, fps, draft) {
  const args = [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    ...(draft ? ["-vf", "scale=540:960"] : []),
    "-c:v", "libx264", "-preset", draft ? "veryfast" : "medium", "-crf", draft ? "26" : "17",
    "-pix_fmt", "yuv420p", "-r", String(fps), out,
  ];
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exited " + c)))));
  return { ff, done };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.name) { console.error("usage: node video/render.js <composition> [--stills t,t] [--from s --to s] [--draft]"); process.exit(1); }
  const comp = path.join(__dirname, a.name, "index.html");
  if (!fs.existsSync(comp)) { console.error("no composition at " + comp); process.exit(1); }
  for (const f of ["data/countries.geo.json", "data/video/terrain.json"]) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`Missing ${f}. Run: npm run build-basemap && npm run build-terrain && node video/tools/prepare-map.js`);
      process.exit(1);
    }
  }

  const server = await startServer(ROOT);
  const url = `http://127.0.0.1:${server.address().port}/video/${a.name}/index.html`;
  const browser = await chromium.launch({ args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"] });
  const outDir = path.join(ROOT, "output");
  fs.mkdirSync(outDir, { recursive: true });

  try {
    if (a.stills) {
      const dir = path.join(outDir, "stills", a.name);
      fs.mkdirSync(dir, { recursive: true });
      const page = await openPage(browser, url, 1);
      for (const t of a.stills) {
        const buf = await frame(page, t, "png");
        const f = path.join(dir, `t${t.toFixed(2).padStart(7, "0")}.png`);
        fs.writeFileSync(f, buf);
        console.log(f);
      }
      return;
    }

    const probe = await openPage(browser, url, 1);
    const duration = await probe.evaluate("window.__duration");
    await probe.close();
    const t0 = a.from ?? 0, t1 = a.to ?? duration;
    const first = Math.round(t0 * a.fps), last = Math.round(t1 * a.fps);
    const total = last - first;
    const W = Math.min(a.workers, total);
    const per = Math.ceil(total / W);
    const out = a.out || path.join(outDir, `${a.name}${a.from != null || a.to != null ? `-${t0}-${t1}` : ""}${a.draft ? "-draft" : ""}.mp4`);
    const tmp = fs.mkdtempSync(path.join(outDir, ".segments-"));
    console.log(`Rendering ${a.name}: ${total} frames (${t0}s to ${t1}s) at ${a.fps}fps on ${W} browsers`);

    let doneFrames = 0;
    const started = Date.now();
    const tick = setInterval(() => {
      const el = (Date.now() - started) / 1000;
      const rate = doneFrames / el;
      process.stdout.write(`\r  ${doneFrames}/${total} frames  ${rate.toFixed(1)} fps  ~${rate ? Math.round((total - doneFrames) / rate) : "?"}s left   `);
    }, 2000);

    const segs = [];
    await Promise.all(Array.from({ length: W }, async (_, w) => {
      const a0 = first + w * per, a1 = Math.min(last, a0 + per);
      if (a1 <= a0) return;
      const file = path.join(tmp, `seg${String(w).padStart(2, "0")}.mp4`);
      segs[w] = file;
      const page = await openPage(browser, url, 1);
      const { ff, done } = ffmpegSegment(file, a.fps, a.draft);
      for (let f = a0; f < a1; f++) {
        const buf = await frame(page, f / a.fps, "jpeg");
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
        doneFrames++;
      }
      ff.stdin.end();
      await done;
      await page.close();
    }));
    clearInterval(tick);
    process.stdout.write("\n");

    const list = path.join(tmp, "list.txt");
    fs.writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s}'`).join("\n"));
    await new Promise((res, rej) => {
      const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
      ff.on("close", (c) => (c === 0 ? res() : rej(new Error("concat failed " + c))));
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`Done in ${((Date.now() - started) / 60000).toFixed(1)} min: ${out}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

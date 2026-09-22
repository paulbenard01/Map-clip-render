#!/usr/bin/env node
/**
 * Opt-in high-resolution terrain hillshade.
 *
 * This is NOT part of the normal setup and nothing else in the project runs
 * it automatically. The vector basemap (country borders, coastlines)
 * `lib/build-basemap.js` builds is small and always available; this is a
 * separate, much larger one-time download of Natural Earth's cross-blended
 * hypsometric relief — real terrain texture (visible mountain ranges,
 * vegetation vs. desert tinting), not flat country colour.
 *
 * Source: Natural Earth's 10m raster series (public domain), fetched
 * directly from their S3 bucket. Still respects the project's "no live map
 * service" rule — this is a single static image, fetched once, at setup
 * time, never at render time, same as the country/land data already is.
 *
 * What this actually costs: ~143MB downloaded (a zip containing a 700MB
 * uncompressed TIFF), which gets converted to a 12MB JPEG and the
 * intermediate files deleted — that JPEG is the only thing left on disk
 * afterward, at data/terrain/relief.jpg.
 *
 * Usage:  npm run build-terrain
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TERRAIN_DIR = path.join(ROOT, "data", "terrain");
const ZIP_URL = "https://naturalearth.s3.amazonaws.com/10m_raster/HYP_HR_SR.zip";
const ZIP_NAME = "HYP_HR_SR.zip";
const TIF_NAME = "HYP_HR_SR.tif";
const TFW_NAME = "HYP_HR_SR.tfw";
const MANUAL_DOWNLOAD_PAGE = "https://www.naturalearthdata.com/downloads/10m-raster-data/10m-cross-blend-hypso/";

function requireSharp() {
  try {
    return require("sharp");
  } catch (err) {
    console.error(
      "\nTerrain conversion needs the 'sharp' package, which isn't part of the\n" +
      "normal install on purpose — it's a large native dependency, only needed\n" +
      "for this opt-in feature. Install it once, then re-run this script:\n\n" +
      "  npm install sharp\n"
    );
    process.exit(1);
  }
}

function download(url, destPath, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects downloading " + url));
    console.log("Downloading " + url);
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        return download(res.headers.location, destPath, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(
          `Download failed: ${res.statusCode} ${res.statusMessage}\n\n` +
          "Natural Earth may have moved this file. You can complete this by hand:\n" +
          `  1. Go to ${MANUAL_DOWNLOAD_PAGE}\n` +
          '  2. Download the "Large size" option\n' +
          `  3. Extract ${TIF_NAME} and ${TFW_NAME} into ${path.relative(ROOT, TERRAIN_DIR)}/\n` +
          "  4. Re-run this script — it'll pick up the extracted files and skip straight to conversion."
        ));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = ((received / total) * 100).toFixed(0);
          process.stdout.write(`\r  ${pct}%  (${(received / 1e6).toFixed(0)}MB / ${(total / 1e6).toFixed(0)}MB)`);
        }
      });
      res.pipe(file);
      file.on("finish", () => { file.close(); process.stdout.write("\n"); resolve(); });
    });
    req.on("error", (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
  });
}

/** A standard Esri world file: pixel size, rotation (unused here), origin. */
function parseWorldFile(tfwPath) {
  const lines = fs.readFileSync(tfwPath, "utf8").trim().split(/\r?\n/).map(Number);
  const [pixelWidth, , , pixelHeight, originX, originY] = lines;
  return { pixelWidth, pixelHeight, originX, originY };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Web Mercator's y coordinate goes to infinity at the poles (log(tan(...))
// blows up), which is exactly what MapLibre's ImageSource uses internally to
// place the image — coordinates any closer to ±90° than this produce NaN
// tile math there and the raster silently never renders. This is the actual
// projection's hard limit, the same one every web map (Google, Leaflet,
// MapLibre itself) clips to.
const MERCATOR_LAT_LIMIT = 85.0511;

async function main() {
  fs.mkdirSync(TERRAIN_DIR, { recursive: true });

  const outJpg = path.join(TERRAIN_DIR, "relief.jpg");
  const outBounds = path.join(TERRAIN_DIR, "bounds.json");
  if (fs.existsSync(outJpg) && fs.existsSync(outBounds)) {
    console.log(`Terrain already built at ${path.relative(ROOT, TERRAIN_DIR)}/ — delete it to rebuild.`);
    return;
  }

  const sharp = requireSharp();

  const zipPath = path.join(TERRAIN_DIR, ZIP_NAME);
  const tifPath = path.join(TERRAIN_DIR, TIF_NAME);
  const tfwPath = path.join(TERRAIN_DIR, TFW_NAME);

  if (!fs.existsSync(tifPath) || !fs.existsSync(tfwPath)) {
    if (!fs.existsSync(zipPath)) await download(ZIP_URL, zipPath);

    console.log("Extracting...");
    try {
      // `unzip` is on essentially every dev machine (macOS/Linux, and
      // Windows via WSL/git-bash) — avoids a zip-parsing dependency for a
      // one-time, opt-in step.
      execFileSync("unzip", ["-o", zipPath, TIF_NAME, TFW_NAME, "-d", TERRAIN_DIR], { stdio: "inherit" });
    } catch (err) {
      console.error(
        `\nCouldn't run 'unzip'. Extract ${ZIP_NAME} yourself (any zip tool) into\n` +
        `${path.relative(ROOT, TERRAIN_DIR)}/ and re-run this script.`
      );
      process.exit(1);
    }
  }

  console.log("Reading the world file for exact geographic bounds...");
  const wf = parseWorldFile(tfwPath);
  const meta = await sharp(tifPath).metadata();

  // A world file's origin is the *centre* of the top-left pixel, so the
  // raster's true edge sits half a pixel beyond the nominal ±180°/±90°.
  const west = clamp(wf.originX, -180, 180);
  const east = clamp(wf.originX + wf.pixelWidth * meta.width, -180, 180);

  // Crop off the polar caps rather than just clamping the coordinates to
  // them: Web Mercator's y goes to infinity at ±90°, which is exactly what
  // MapLibre's image source uses internally to place the raster — feeding
  // it coordinates that close to a pole makes that math produce NaN and the
  // image silently never renders. Cropping the pixels themselves (instead
  // of only clamping the corner coordinates) keeps content and coordinates
  // matched 1:1, so nothing gets vertically stretched near the edge.
  const rowForLat = (lat) => Math.round((lat - wf.originY) / wf.pixelHeight);
  const topRow = clamp(rowForLat(MERCATOR_LAT_LIMIT), 0, meta.height);
  const bottomRow = clamp(rowForLat(-MERCATOR_LAT_LIMIT), 0, meta.height);
  const cropTop = Math.min(topRow, bottomRow);
  const cropHeight = Math.max(topRow, bottomRow) - cropTop;
  const north = wf.originY + wf.pixelHeight * cropTop;
  const south = wf.originY + wf.pixelHeight * (cropTop + cropHeight);

  // WebGL caps how big a single texture can be — commonly 4096px on older
  // or software-rendered GPUs, which is exactly what a headless render runs
  // on. MapLibre's image source uploads the whole raster as one texture (no
  // tiling), so anything wider than that silently fails to draw. Downscaling
  // here, once, keeps the feature working everywhere instead of only on
  // machines with a beefier GPU.
  const MAX_TEXTURE_DIM = 4096;
  console.log(`Converting ${meta.width}x${meta.height} TIFF to JPEG (a minute or so)...`);
  await sharp(tifPath)
    .extract({ left: 0, top: cropTop, width: meta.width, height: cropHeight })
    .resize({ width: MAX_TEXTURE_DIM, withoutEnlargement: true })
    .jpeg({ quality: 87, mozjpeg: true })
    .toFile(outJpg);

  fs.writeFileSync(outBounds, JSON.stringify({
    // Corner order MapLibre's `image` source wants: top-left, top-right,
    // bottom-right, bottom-left.
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
    source: "Natural Earth 10m Cross-blended Hypsometric Tints with Shaded Relief (public domain)",
    builtAt: new Date().toISOString(),
  }, null, 2) + "\n");

  [tifPath, tfwPath, zipPath].forEach((p) => { if (fs.existsSync(p)) fs.unlinkSync(p); });

  const kb = (fs.statSync(outJpg).size / 1024).toFixed(0);
  console.log(`\nDone: ${path.relative(ROOT, outJpg)} (${kb}KB)`);
  console.log("Every scene will now render with it automatically — no flag to set. Delete data/terrain/ to go back to the flat look.");
}

main().catch((err) => { console.error("\n" + err.message); process.exit(1); });

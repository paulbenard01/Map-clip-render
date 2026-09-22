#!/usr/bin/env node
/**
 * Builds the map layers the portrait explainer videos draw on.
 *
 * Inputs (all public domain, Natural Earth):
 *   data/terrain/relief.jpg        from `npm run build-terrain`
 *   data/land.geo.json             from `npm run build-basemap`
 *   ne_10m_rivers_lake_centerlines downloaded here on first run
 *
 * Outputs, in data/video/ (regenerable, so not committed):
 *   terrain-asia.jpg   South & East Asia at the relief's native 60px/degree
 *   terrain-world.jpg  whole world at 12px/degree, for the wide shots
 *   terrain.json       the lon/lat bounds of both
 *   rivers.geo.json    major rivers inside the Asia crop
 *
 * The relief is recoloured into Heritle navy (ocean flat and dark, land
 * lifted by its own shaded relief) so the map reads as part of the brand
 * rather than as an atlas page.
 *
 * Usage:  node video/tools/prepare-map.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(DATA, "video");

let sharp, shapefile;
try {
  sharp = require("sharp");
  shapefile = require("shapefile");
} catch (err) {
  console.error("Needs two extra packages:  npm install --no-save sharp shapefile");
  process.exit(1);
}
sharp.cache(false);
sharp.concurrency(2);

// Natural Earth's relief is 21600x10800 over the whole globe: 60px/degree.
const SRC_PPD = 60;

const CROPS = {
  asia: { west: 55, east: 130, north: 52, south: -12, ppd: 60 },
  world: { west: -180, east: 180, north: 85, south: -60, ppd: 12 },
};

// Ocean, land-low and land-high tones. Land is interpolated between the
// last two by the relief's luminance, so ridges read as lighter navy.
const OCEAN = [9, 15, 29];
const LAND_LO = [22, 36, 64];
const LAND_HI = [92, 118, 160];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(url + " -> HTTP " + res.statusCode));
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

// An SVG of the land polygons in the crop's pixel space, used as the land mask.
function landSvg(crop, width, height) {
  const land = JSON.parse(fs.readFileSync(path.join(DATA, "land.geo.json"), "utf8"));
  const px = (lon) => ((lon - crop.west) * crop.ppd).toFixed(1);
  const py = (lat) => ((crop.north - lat) * crop.ppd).toFixed(1);
  let d = "";
  const ring = (coords) => {
    // Break rings where they jump the antimeridian, or the fill smears a
    // band across the whole map at that latitude.
    let prev = null;
    coords.forEach(([lon, lat], i) => {
      d += (i === 0 || Math.abs(lon - prev) > 180 ? "M" : "L") + px(lon) + "," + py(lat);
      prev = lon;
    });
    d += "Z";
  };
  for (const f of land.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) poly.forEach(ring);
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<path d="${d}" fill="#fff" fill-rule="evenodd"/></svg>`
  );
}

async function buildCrop(name, crop) {
  const width = Math.round((crop.east - crop.west) * crop.ppd);
  const height = Math.round((crop.north - crop.south) * crop.ppd);
  console.log(`  ${name}: ${width}x${height}`);

  const left = Math.round((crop.west + 180) * SRC_PPD);
  const top = Math.round((90 - crop.north) * SRC_PPD);
  const srcW = Math.round((crop.east - crop.west) * SRC_PPD);
  const srcH = Math.round((crop.north - crop.south) * SRC_PPD);

  const relief = await sharp(path.join(DATA, "terrain", "relief.jpg"), { limitInputPixels: false })
    .extract({ left, top, width: srcW, height: srcH })
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer();

  const mask = await sharp(landSvg(crop, width, height), { limitInputPixels: false })
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer();

  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const m = mask[i] / 255;
    // The relief is bright overall; stretch its useful range and bias dark.
    let l = (relief[i] - 90) / 150;
    l = Math.max(0, Math.min(1, l));
    l = Math.pow(l, 1.6);
    for (let c = 0; c < 3; c++) {
      const land = LAND_LO[c] + (LAND_HI[c] - LAND_LO[c]) * l;
      out[i * 3 + c] = Math.round(OCEAN[c] + (land - OCEAN[c]) * m);
    }
  }

  await sharp(out, { raw: { width, height, channels: 3 }, limitInputPixels: false })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(OUT, `terrain-${name}.jpg`));
  return { ...crop, width, height, file: `terrain-${name}.jpg` };
}

async function buildRivers() {
  const zip = path.join(OUT, "rivers.zip");
  const dir = path.join(OUT, "rivers");
  if (!fs.existsSync(path.join(dir, "ne_10m_rivers_lake_centerlines.shp"))) {
    console.log("  downloading Natural Earth rivers...");
    await download("https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines.zip", zip);
    fs.mkdirSync(dir, { recursive: true });
    try {
      execFileSync("unzip", ["-o", "-q", zip, "-d", dir], { stdio: "inherit" });
    } catch (err) {
      // Plain Windows has no `unzip`; PowerShell does the same job.
      const ps = (p) => "'" + p.replace(/'/g, "''") + "'";
      execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${ps(zip)} -DestinationPath ${ps(dir)} -Force`], { stdio: "inherit" });
    }
    fs.rmSync(zip);
  }
  const src = await shapefile.open(path.join(dir, "ne_10m_rivers_lake_centerlines.shp"));
  const { west, east, north, south } = CROPS.asia;
  const features = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const f = r.value;
    if (f.properties.scalerank > 6 || f.properties.featurecla === "Lake Centerline") continue;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const inside = lines.some((l) => l.some(([x, y]) => x > west && x < east && y > south && y < north));
    if (!inside) continue;
    // Four decimals is ~10m: plenty at these zoom levels, a third of the size.
    const round = (l) => l.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
    features.push({
      type: "Feature",
      properties: { name: String(f.properties.name || "").replace(/\0/g, "").trim(), rank: f.properties.scalerank },
      geometry: { type: "MultiLineString", coordinates: lines.map(round) },
    });
  }
  fs.writeFileSync(path.join(OUT, "rivers.geo.json"), JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`  rivers: ${features.length} features`);
}

async function main() {
  if (!fs.existsSync(path.join(DATA, "terrain", "relief.jpg"))) {
    console.error("Run `npm run build-terrain` first (needs data/terrain/relief.jpg).");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DATA, "land.geo.json"))) {
    console.error("Run `npm run build-basemap` first (needs data/land.geo.json).");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  console.log("Building video map layers into data/video/");
  const meta = {};
  for (const [name, crop] of Object.entries(CROPS)) meta[name] = await buildCrop(name, crop);
  fs.writeFileSync(path.join(OUT, "terrain.json"), JSON.stringify(meta, null, 2));
  await buildRivers();
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });

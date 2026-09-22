#!/usr/bin/env node
/**
 * Builds the offline basemap into data/.
 *
 * Source is the `world-atlas` npm package (Natural Earth, public domain),
 * converted from TopoJSON to plain GeoJSON once, here, so that render time
 * needs no network, no API key and no tile server — and so every render of
 * the same scene is byte-for-byte reproducible.
 *
 * Outputs:
 *   data/land.geo.json       one big land mass polygon set
 *   data/countries.geo.json  per-country polygons, properties.id = ISO alpha-3
 *   data/graticule.geo.json  lat/lng grid lines
 *
 * Swap countries-50m.json for countries-10m.json below if you need more
 * coastline detail for tight close-ups (bigger file, slower first paint).
 */

const fs = require("fs");
const path = require("path");
const topojson = require("topojson-client");
const numericToAlpha3 = require("./iso-numeric-to-alpha3.js");

const RESOLUTION = "50m"; // "110m" | "50m" | "10m"

// Bump this whenever a change here alters the generated data. The stamp is
// written into data/ and checked on startup, so an existing install rebuilds
// itself instead of silently keeping stale files. (Without it, the
// antimeridian fix would only have reached people who deleted data/ by hand.)
const BASEMAP_VERSION = 3;
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data");

// Territories Natural Earth carries that have no ISO 3166-1 code of their own.
// Given user-assigned codes so they can still be targeted by a highlight.
const NAME_FALLBACKS = {
  "Kosovo": "XKX",
  "Somaliland": "XSM",
  "N. Cyprus": "XNC",
};


function graticule(stepDeg) {
  const features = [];
  for (let lng = -180; lng <= 180; lng += stepDeg) {
    const coords = [];
    for (let lat = -90; lat <= 90; lat += 2) coords.push([lng, lat]);
    features.push({ type: "Feature", properties: { kind: "meridian" }, geometry: { type: "LineString", coordinates: coords } });
  }
  for (let lat = -80; lat <= 80; lat += stepDeg) {
    const coords = [];
    for (let lng = -180; lng <= 180; lng += 2) coords.push([lng, lat]);
    features.push({ type: "Feature", properties: { kind: "parallel" }, geometry: { type: "LineString", coordinates: coords } });
  }
  return { type: "FeatureCollection", features };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const atlasPath = require.resolve(`world-atlas/countries-${RESOLUTION}.json`);
  const topo = JSON.parse(fs.readFileSync(atlasPath, "utf8"));

  // ---- countries ----
  // No antimeridian-unwrap pass here: d3-geo's own path generator clips
  // and joins dateline-crossing rings (Chukotka, Fiji) correctly on its
  // own for any projection, including Equal Earth — unlike the old
  // MapLibre/Mercator renderer, which needed a country's ring pre-unwrapped
  // into a single continuous run of longitudes to draw it as one shape.
  // Doing that here now actively breaks the current renderer's per-ring
  // bounding boxes (used to skip drawing off-screen geometry): a ring
  // that legitimately crosses the seam gets a wildly inflated bbox and
  // silently stops being drawn once it's no longer near screen centre.
  const countries = topojson.feature(topo, topo.objects.countries);
  let unmatched = 0;
  countries.features.forEach((f) => {
    const name = (f.properties && f.properties.name) || "";
    const numeric = f.id != null ? String(f.id).padStart(3, "0") : null;
    const alpha3 = (numeric && numericToAlpha3[numeric]) || NAME_FALLBACKS[name] || null;
    if (!alpha3) unmatched++;
    // The renderer's country-highlight filter reads feature *properties*,
    // not the GeoJSON top-level id, so the code has to live in properties.id.
    f.properties = { id: alpha3, name, isoNumeric: numeric };
    delete f.id;
  });
  write("countries.geo.json", countries);

  // ---- land ----
  const landTopoPath = require.resolve(`world-atlas/land-${RESOLUTION}.json`);
  const landTopo = JSON.parse(fs.readFileSync(landTopoPath, "utf8"));
  const land = topojson.feature(landTopo, landTopo.objects.land);
  write("land.geo.json", land);

  // ---- graticule ----
  write("graticule.geo.json", graticule(20));

  fs.writeFileSync(
    path.join(OUT_DIR, "version.json"),
    JSON.stringify({ version: BASEMAP_VERSION, resolution: RESOLUTION, built: new Date().toISOString() }, null, 2) + "\n"
  );

  console.log(`Basemap built from world-atlas ${RESOLUTION} into ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`  ${countries.features.length} countries (${unmatched} without an ISO code — unhighlightable, drawn as plain land)`);
}

function write(name, geojson) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(geojson));
  const kb = (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`  wrote ${name} (${kb} KB)`);
}

if (require.main === module) main();

module.exports = { BASEMAP_VERSION, RESOLUTION };

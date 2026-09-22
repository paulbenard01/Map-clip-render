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
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data");

// Territories Natural Earth carries that have no ISO 3166-1 code of their own.
// Given user-assigned codes so they can still be targeted by a highlight.
const NAME_FALLBACKS = {
  "Kosovo": "XKX",
  "Somaliland": "XSM",
  "N. Cyprus": "XNC",
};


/**
 * Makes each polygon ring's longitudes continuous.
 *
 * Natural Earth stores every coordinate inside -180..180, so a country that
 * straddles the 180° seam — Russia's Chukotka, Fiji — has rings that jump
 * from +179 to -179 mid-ring. Rendered as-is, the renderer joins those points
 * the long way round and the country becomes a slab smeared across the whole
 * map. It shows up as a hard-edged band through every wide shot.
 *
 * Walking each ring and adding or subtracting whole turns keeps it
 * continuous, so Chukotka sits at 180..191 and draws in the adjacent world
 * copy where it belongs. Rings that genuinely circle the globe (Antarctica's
 * boundary along -90) are already monotonic and pass through unchanged.
 */
function unwrapRing(ring) {
  let prev = null;
  return ring.map(([lng, lat]) => {
    let x = lng;
    if (prev !== null) {
      while (x - prev > 180) x -= 360;
      while (x - prev < -180) x += 360;
    }
    prev = x;
    return [x, lat];
  });
}

function unwrapGeometry(geom) {
  if (!geom) return;
  if (geom.type === "Polygon") {
    geom.coordinates = geom.coordinates.map(unwrapRing);
  } else if (geom.type === "MultiPolygon") {
    geom.coordinates = geom.coordinates.map((poly) => poly.map(unwrapRing));
  }
}

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
  const countries = topojson.feature(topo, topo.objects.countries);
  countries.features.forEach((f) => unwrapGeometry(f.geometry));
  let unmatched = 0;
  countries.features.forEach((f) => {
    const name = (f.properties && f.properties.name) || "";
    const numeric = f.id != null ? String(f.id).padStart(3, "0") : null;
    const alpha3 = (numeric && numericToAlpha3[numeric]) || NAME_FALLBACKS[name] || null;
    if (!alpha3) unmatched++;
    // MapLibre filter expressions read feature *properties*, not the GeoJSON
    // top-level id, so the code has to live in properties.id.
    f.properties = { id: alpha3, name, isoNumeric: numeric };
    delete f.id;
  });
  write("countries.geo.json", countries);

  // ---- land ----
  const landTopoPath = require.resolve(`world-atlas/land-${RESOLUTION}.json`);
  const landTopo = JSON.parse(fs.readFileSync(landTopoPath, "utf8"));
  const land = topojson.feature(landTopo, landTopo.objects.land);
  land.features.forEach((f) => unwrapGeometry(f.geometry));
  write("land.geo.json", land);

  // ---- graticule ----
  write("graticule.geo.json", graticule(20));

  console.log(`Basemap built from world-atlas ${RESOLUTION} into ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`  ${countries.features.length} countries (${unmatched} without an ISO code — unhighlightable, drawn as plain land)`);
}

function write(name, geojson) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, JSON.stringify(geojson));
  const kb = (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`  wrote ${name} (${kb} KB)`);
}

main();

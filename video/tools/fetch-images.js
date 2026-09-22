#!/usr/bin/env node
/**
 * Pulls openly licensed photos from Wikimedia Commons into a composition's
 * images/ folder and records attribution in images/credits.json.
 *
 *   node video/tools/fetch-images.js sarnath                  every slot still missing
 *   node video/tools/fetch-images.js sarnath --force          refetch all
 *   node video/tools/fetch-images.js sarnath --pick nehru="File:Jawaharlal Nehru 1947.jpg"
 *   node video/tools/fetch-images.js sarnath --list nalanda   show candidates, download nothing
 *
 * Only public domain, CC0, CC BY and CC BY-SA files are accepted (no NC/ND,
 * no fair use). Slots and search terms live in video/<name>/images/wanted.json.
 * Needs network access to commons.wikimedia.org and upload.wikimedia.org.
 */

const fs = require("fs");
const path = require("path");

const UA = "HeritleVideo/1.0 (https://github.com/paulbenard01/Map-clip-render)";
const API = "https://commons.wikimedia.org/w/api.php";
const OK_LICENSE = /^(public domain|pd\b|cc0|cc[- ]by(-sa)?[- ]\d)/i;

let sharp;
try { sharp = require("sharp"); } catch (err) { console.error("Needs sharp:  npm install --no-save sharp"); process.exit(1); }

const strip = (html) => String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function api(params) {
  const url = API + "?" + new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  return res.json();
}

function describe(page) {
  const ii = page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  const m = ii.extmetadata || {};
  return {
    title: page.title,
    license: strip(m.LicenseShortName && m.LicenseShortName.value),
    artist: strip(m.Artist && m.Artist.value) || "unknown",
    credit: strip(m.Credit && m.Credit.value),
    source: ii.descriptionurl,
    url: ii.thumburl || ii.url,
    original: ii.url,
    width: ii.width,
    height: ii.height,
    mime: ii.mime,
  };
}

async function candidates(query, svg) {
  const q = query.startsWith("File:")
    ? { titles: query }
    : { generator: "search", gsrnamespace: "6", gsrsearch: query + (svg ? " filetype:drawing" : " filetype:bitmap"), gsrlimit: "15" };
  const data = await api({ action: "query", prop: "imageinfo", iiprop: "url|extmetadata|size|mime", ...(svg ? {} : { iiurlwidth: "1600" }), ...q });
  const pages = Object.values((data.query && data.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map(describe).filter(Boolean);
}

const acceptable = (c, svg) =>
  OK_LICENSE.test(c.license) && (svg ? /svg/.test(c.mime) : /jpeg|png/.test(c.mime) && c.width >= 800);

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--") && !a.includes("="));
  if (!name) { console.error("usage: node video/tools/fetch-images.js <composition> [--force] [--pick id=File:...] [--list id]"); process.exit(1); }
  const dir = path.join(__dirname, "..", name, "images");
  const wanted = JSON.parse(fs.readFileSync(path.join(dir, "wanted.json"), "utf8"));
  const creditsFile = path.join(dir, "credits.json");
  const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, "utf8")) : {};
  const force = args.includes("--force");
  const listId = args.includes("--list") ? args[args.indexOf("--list") + 1] : null;
  const picks = {};
  args.forEach((a, i) => { if (a === "--pick") { const [k, ...v] = args[i + 1].split("="); picks[k] = v.join("="); } });

  for (const [id, spec] of Object.entries(wanted)) {
    if (listId && id !== listId) continue;
    const svg = !!spec.svg;
    const file = path.join(dir, id + (svg ? ".svg" : ".jpg"));
    if (!listId && !force && !picks[id] && fs.existsSync(file)) continue;
    const query = picks[id] || spec.file || spec.search;
    let list;
    try { list = await candidates(query, svg); } catch (err) { console.error(`${id}: ${err.message}`); continue; }
    if (listId) {
      list.forEach((c) => console.log(`${acceptable(c, svg) ? "ok " : "-- "} ${c.title}  [${c.license}] ${c.width}x${c.height}`));
      continue;
    }
    const pick = list.find((c) => acceptable(c, svg));
    if (!pick) { console.log(`${id}: nothing openly licensed for "${query}"`); continue; }
    const res = await fetch(svg ? pick.original : pick.url, { headers: { "User-Agent": UA } });
    if (!res.ok) { console.log(`${id}: download failed ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (svg) fs.writeFileSync(file, buf);
    else await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
    credits[id] = { title: pick.title, artist: pick.artist, license: pick.license, source: pick.source, credit: pick.credit || undefined };
    console.log(`${id}: ${pick.title}  [${pick.license}]  ${pick.artist}`);
  }
  if (!listId) fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });

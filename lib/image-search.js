/**
 * Openly-licensed image search, for finding pin photos without leaving the
 * builder.
 *
 * Two sources, neither needing an API key:
 *   Wikimedia Commons — the best source for heritage sites and landmarks,
 *                       which is most of what this tool points at
 *   Openverse        — Creative Commons search across many collections
 *
 * This is the only part of the project that talks to the internet, and it
 * only does so while you are authoring. Choosing a result downloads the file
 * into assets/ and the scene references it by local path, so rendering stays
 * offline and byte-for-byte reproducible.
 *
 * Licence and attribution for every imported file are recorded in
 * assets/credits.json — several of these licences require crediting the
 * photographer, and that information is very hard to reconstruct later.
 */

const fs = require("fs");
const path = require("path");

const USER_AGENT = "HeritleMapRenderer/2.0 (local scene builder; https://maplibre.org)";
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15000;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}

// ------------------------------------------------------ Wikimedia Commons
async function searchCommons(q, limit) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: "6",          // File:
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "400",
    format: "json",
    origin: "*",
  });
  const data = await fetchJson(url);
  const pages = (data.query && data.query.pages) || {};
  return Object.keys(pages).map((key) => {
    const page = pages[key];
    const info = (page.imageinfo && page.imageinfo[0]) || {};
    const meta = info.extmetadata || {};
    return {
      id: "commons-" + page.pageid,
      source: "Wikimedia Commons",
      title: stripHtml((meta.ObjectName && meta.ObjectName.value) || page.title.replace(/^File:/, "")),
      thumbUrl: info.thumburl || info.url,
      fullUrl: info.url,
      width: info.width,
      height: info.height,
      license: stripHtml((meta.LicenseShortName && meta.LicenseShortName.value) || "See source"),
      licenseUrl: (meta.LicenseUrl && meta.LicenseUrl.value) || null,
      creator: stripHtml((meta.Artist && meta.Artist.value) || ""),
      sourcePage: info.descriptionurl || null,
    };
  }).filter((r) => r.fullUrl);
}

// ------------------------------------------------------------- Openverse
async function searchOpenverse(q, limit) {
  const url = "https://api.openverse.org/v1/images/?" + new URLSearchParams({
    q: q,
    page_size: String(limit),
    // Only things that can actually be used in a published video.
    license_type: "commercial,modification",
    mature: "false",
  });
  const data = await fetchJson(url);
  return (data.results || []).map((r) => ({
    id: "openverse-" + r.id,
    source: "Openverse" + (r.provider ? " / " + r.provider : ""),
    title: r.title || "Untitled",
    thumbUrl: r.thumbnail || r.url,
    fullUrl: r.url,
    width: r.width,
    height: r.height,
    license: ((r.license || "") + " " + (r.license_version || "")).trim().toUpperCase(),
    licenseUrl: r.license_url || null,
    creator: r.creator || "",
    sourcePage: r.foreign_landing_url || null,
  })).filter((r) => r.fullUrl);
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Searches one or both sources. A source that fails or times out is reported
 * in the results rather than failing the whole search — one being down
 * shouldn't stop you finding a photo in the other.
 */
async function search(q, source) {
  const limit = 20;
  const wanted = [];
  if (source === "all" || source === "commons") wanted.push(["Wikimedia Commons", () => searchCommons(q, limit)]);
  if (source === "all" || source === "openverse") wanted.push(["Openverse", () => searchOpenverse(q, limit)]);

  const settled = await Promise.allSettled(wanted.map(([, fn]) => fn()));
  const out = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") out.push.apply(out, result.value);
    else out.push({ error: true, source: wanted[i][0], message: result.reason && result.reason.message });
  });
  return out;
}

/** Downloads a chosen result into assets/ and records its attribution. */
async function importToAssets(item, assetsDir, root) {
  const res = await fetch(item.url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  const ext = extensionFor(type);
  if (!ext) throw new Error("That URL returned " + (type || "an unknown type") + ", not an image");

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Image is larger than " + (MAX_BYTES / 1024 / 1024) + "MB");

  fs.mkdirSync(assetsDir, { recursive: true });
  const base = slug(item.title || "image") || "image";
  const target = uniquePath(assetsDir, base + ext);
  fs.writeFileSync(target, buf);

  const credit = {
    file: "/assets/" + path.basename(target),
    title: item.title || null,
    creator: item.creator || null,
    license: item.license || null,
    licenseUrl: item.licenseUrl || null,
    sourcePage: item.sourcePage || null,
    source: item.source || null,
    importedAt: new Date().toISOString(),
  };
  recordCredit(assetsDir, credit);

  return { path: credit.file, bytes: buf.length, credit };
}

function recordCredit(assetsDir, credit) {
  const file = path.join(assetsDir, "credits.json");
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { list = []; }
  if (!Array.isArray(list)) list = [];
  list = list.filter((c) => c.file !== credit.file);
  list.push(credit);
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
}

function extensionFor(mime) {
  return {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/gif": ".gif",
  }[mime] || null;
}

function slug(s) {
  return String(s).toLowerCase().replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 2;
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${base}-${n++}${ext}`);
  return candidate;
}

module.exports = { search, importToAssets };

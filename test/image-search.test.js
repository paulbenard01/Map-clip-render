/**
 * Exercises the image-search parsing and import paths against recorded
 * API shapes, so they can be checked without network access.
 *
 * Run: node test/image-search.test.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const images = require("../lib/image-search.js");

const COMMONS_FIXTURE = {
  query: {
    pages: {
      "12345": {
        pageid: 12345,
        title: "File:Dhamek Stupa Sarnath.jpg",
        imageinfo: [{
          url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Dhamek_Stupa_Sarnath.jpg",
          thumburl: "https://upload.wikimedia.org/thumb/400px-Dhamek.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Dhamek_Stupa_Sarnath.jpg",
          width: 3000, height: 2000,
          extmetadata: {
            ObjectName: { value: "Dhamek Stupa, <i>Sarnath</i>" },
            LicenseShortName: { value: "CC BY-SA 4.0" },
            LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
            Artist: { value: "<a href='/wiki/User:Someone'>Someone</a>" },
          },
        }],
      },
    },
  },
};

const OPENVERSE_FIXTURE = {
  results: [{
    id: "abc-def",
    title: "Hanoi street",
    url: "https://example.org/hanoi.jpg",
    thumbnail: "https://example.org/hanoi-thumb.jpg",
    width: 1600, height: 900,
    license: "by", license_version: "4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0",
    creator: "A Photographer",
    provider: "flickr",
    foreign_landing_url: "https://flickr.com/photo/1",
  }],
};

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function jsonResponse(body) {
  return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: async () => body });
}

async function testSearchParsing() {
  const restore = stubFetch((url) => {
    if (String(url).includes("commons.wikimedia.org")) return jsonResponse(COMMONS_FIXTURE);
    if (String(url).includes("api.openverse.org")) return jsonResponse(OPENVERSE_FIXTURE);
    throw new Error("unexpected host: " + url);
  });
  try {
    const results = await images.search("sarnath", "all");
    assert.strictEqual(results.filter((r) => r.error).length, 0, "no source should error");
    assert.strictEqual(results.length, 2);

    const commons = results.find((r) => r.source === "Wikimedia Commons");
    assert.strictEqual(commons.title, "Dhamek Stupa, Sarnath", "HTML stripped from title");
    assert.strictEqual(commons.creator, "Someone", "HTML stripped from creator");
    assert.strictEqual(commons.license, "CC BY-SA 4.0");

    const ov = results.find((r) => String(r.source).startsWith("Openverse"));
    assert.strictEqual(ov.source, "Openverse / flickr");
    assert.strictEqual(ov.license, "BY 4.0");
    console.log("  ok  search parses both sources");
  } finally { restore(); }
}

async function testOneSourceDownStillReturnsTheOther() {
  const restore = stubFetch((url) => {
    if (String(url).includes("commons.wikimedia.org")) return Promise.reject(new Error("network down"));
    return jsonResponse(OPENVERSE_FIXTURE);
  });
  try {
    const results = await images.search("sarnath", "all");
    const errors = results.filter((r) => r.error);
    const hits = results.filter((r) => !r.error);
    assert.strictEqual(errors.length, 1, "the failing source is reported");
    assert.strictEqual(errors[0].source, "Wikimedia Commons");
    assert.strictEqual(hits.length, 1, "the working source still returns results");
    console.log("  ok  one source failing does not fail the search");
  } finally { restore(); }
}

async function testImport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heritle-assets-"));
  const restore = stubFetch(() => Promise.resolve({
    ok: true, status: 200, statusText: "OK",
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? "image/png" : null) },
    arrayBuffer: async () => PNG_1x1,
  }));
  try {
    const saved = await images.importToAssets({
      url: "https://example.org/x.png",
      title: "Dhamek Stupa, Sarnath",
      creator: "Someone",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourcePage: "https://commons.wikimedia.org/wiki/File:x",
      source: "Wikimedia Commons",
    }, dir, dir);

    assert.strictEqual(saved.path, "/assets/dhamek-stupa-sarnath.png");
    assert.ok(fs.existsSync(path.join(dir, "dhamek-stupa-sarnath.png")), "file written");

    const credits = JSON.parse(fs.readFileSync(path.join(dir, "credits.json"), "utf8"));
    assert.strictEqual(credits.length, 1);
    assert.strictEqual(credits[0].license, "CC BY-SA 4.0");
    assert.strictEqual(credits[0].creator, "Someone");
    console.log("  ok  import writes the file and records attribution");

    // A second import of the same title must not clobber the first.
    const again = await images.importToAssets({ url: "https://example.org/x.png", title: "Dhamek Stupa, Sarnath" }, dir, dir);
    assert.strictEqual(again.path, "/assets/dhamek-stupa-sarnath-2.png");
    console.log("  ok  a repeated title does not overwrite the existing file");
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testRejectsNonImage() {
  const restore = stubFetch(() => Promise.resolve({
    ok: true, status: 200, statusText: "OK",
    headers: { get: () => "text/html" },
    arrayBuffer: async () => Buffer.from("<html>not an image</html>"),
  }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heritle-assets-"));
  try {
    await assert.rejects(
      () => images.importToAssets({ url: "https://example.org/page", title: "nope" }, dir, dir),
      /not an image/
    );
    console.log("  ok  a non-image URL is rejected");
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  console.log("image-search");
  await testSearchParsing();
  await testOneSourceDownStillReturnsTheOther();
  await testImport();
  await testRejectsNonImage();
  console.log("all image-search tests passed");
})().catch((err) => { console.error(err); process.exit(1); });

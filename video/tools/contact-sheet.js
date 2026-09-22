#!/usr/bin/env node
// Tiles review stills into one image: node video/tools/contact-sheet.js out.png a.png b.png ...
const sharp = require("sharp");
const [out, ...files] = process.argv.slice(2);
const W = 360, H = 640, COLS = Math.min(4, files.length);
(async () => {
  const tiles = await Promise.all(files.map((f) => sharp(f).resize(W, H).toBuffer()));
  const rows = Math.ceil(files.length / COLS);
  await sharp({ create: { width: COLS * W + (COLS - 1) * 8, height: rows * H + (rows - 1) * 8, channels: 3, background: "#ffffff" } })
    .composite(tiles.map((input, i) => ({ input, left: (i % COLS) * (W + 8), top: Math.floor(i / COLS) * (H + 8) })))
    .png().toFile(out);
})();

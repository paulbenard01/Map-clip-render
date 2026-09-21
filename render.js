#!/usr/bin/env node
/**
 * Heritle map-animation renderer (CLI).
 *
 * Usage:
 *   node render.js --scene scenes/example-sarnath.json --ratio 9:16 --out output/sarnath.mp4
 *
 * Flags:
 *   --scene   <path>        Scene JSON file (required)
 *   --ratio   9:16 | 16:9   Output aspect ratio (default: from scene, else 16:9)
 *   --style   <name>        dark-navy | muted-editorial | mono-contrast (default: from scene)
 *   --fps     <n>           Frames per second (default: from scene, else 30)
 *   --out     <path.mp4>    Output file (default: output/<scene-name>.mp4)
 *   --width   <px>          Override output width (height follows the ratio)
 *   --draft                 Fast low-res preview: half resolution, 12fps, rougher encode
 *   --keep-frames           Don't delete the intermediate PNG frames after encoding
 *
 * The actual pipeline lives in lib/renderer.js, shared with the builder's
 * Render button so there is only ever one capture loop.
 *
 * Fully offline: the basemap is a local file (see lib/build-basemap.js), so
 * nothing here reaches the network. Re-run `npm run build-basemap` if you
 * ever delete the data/ folder.
 */

const { renderScene } = require("./lib/renderer.js");

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

Or build scenes visually:  npm run builder
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.scene) { printHelp(); process.exit(args.help ? 0 : 1); }

  await renderScene({
    scenePath: args.scene,
    ratio: args.ratio,
    style: args.style,
    fps: args.fps,
    out: args.out,
    width: args.width,
    draft: args.draft,
    keepFrames: args.keepFrames,
    // `partial` rewrites the same line, which is what the frame counter wants.
    log: (msg, partial) => { partial ? process.stdout.write(msg) : console.log(msg); },
  });
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });

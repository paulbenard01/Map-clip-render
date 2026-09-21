# Heritle Map Renderer

A clip renderer for the Heritle Deep Dive series: describe a scene (camera
moves across a map, photo pins dropping onto locations, animated routes
between them, lower-third titles), and it renders an MP4 you can drop
straight into an edit.

It runs entirely on your own machine, once installed. There is no API key,
no account, no per-render cost, and no internet connection needed at render
time: the basemap is a small local dataset (Natural Earth country borders,
via the `world-atlas` npm package, the same public-domain source Heritle's
own game map is likely already built from), not tiles fetched from a
server. Run it as many times as you want.

## What it looks like

Three built-in color presets in `styles/presets.json`:

- **dark-navy** (default, for The Heritle Deep Dive) — navy on navy with a
  warm gold accent for pins, routes, and highlighted countries.
- **muted-editorial** — cream/grey, the desaturated Vox/Johnny Harris
  explainer look.
- **mono-contrast** — black and white with a single red accent.

Add your own by copying a block in `styles/presets.json` and giving it a
new key; `--style <your-key>` picks it up automatically.

## Setup (one time)

You need [Node.js](https://nodejs.org) 18 or newer and
[ffmpeg](https://ffmpeg.org/download.html) installed and on your PATH.
Check ffmpeg is there with `ffmpeg -version` in a terminal; if it's missing,
install it with your OS's package manager (`brew install ffmpeg` on a Mac,
`sudo apt install ffmpeg` on Ubuntu/Debian, or download a build for Windows).

```
cd heritle-map-renderer
npm install
npx playwright install chromium
```

The second command downloads a headless Chromium build for Playwright to
drive (this is a one-time ~150MB download, separate from any Chrome you
already have installed).

That's it. The first time you render, it will also automatically build the
local basemap files into `data/` (you can also do this yourself ahead of
time with `npm run build-basemap`).

## Quick start

Render the included example scene (Sarnath, India, to the Vietnam relic
tour beat from the deep-dive script) as a fast low-res preview first:

```
node render.js --scene scenes/example-sarnath.json --draft
```

Check `output/example-sarnath.draft.mp4`. Once the camera moves and timing
look right, render it at full quality:

```
node render.js --scene scenes/example-sarnath.json
```

Full 9:16 output lands at `output/example-sarnath.mp4`, 1080x1920 at 30fps.

The example scene uses two placeholder images generated for testing
(`assets/placeholder-lion-capital.jpg`, `assets/placeholder-relic-tour.jpg`,
plain solid-color squares with text). Swap in real photos before using this
scene for anything real — see "Pins" below for the image requirements.

## The actual workflow: describing a scene in plain language

You don't need to hand-write scene JSON yourself. Describe the scene the
way you'd describe a shot list, and it becomes a scene file. For example,
something like:

> "Start wide on India and China together. Push in on Sarnath over about
> 3 seconds and hold there for 5 seconds with the lion capital photo
> pinned. Then pull back out to show the whole region, arc a dashed gold
> line over to Hanoi over 2.5 seconds, drop a pin there with the relic
> tour photo, and hold on a title card reading 'Vietnam, 2025'."

turns directly into the `camera`, `pins`, `routes`, and `titles` arrays
below. Hand me a description like that for the next clip and I'll write
the scene file for you; drop it into `scenes/` and render it.

## Scene JSON reference

```jsonc
{
  "aspect": "9:16",          // or "16:9" — can also be set via --ratio
  "style": "dark-navy",      // a key from styles/presets.json
  "fps": 30,
  "focusCountry": "IND",     // ISO 3166-1 alpha-3 code, filled a lighter shade
  "duration": 22,            // optional — auto-computed from content if omitted

  "camera": [
    // Keyframes the camera eases between. `t` is seconds from the start.
    // zoom/bearing/pitch are optional (default 0 for bearing/pitch).
    { "t": 0,   "center": [79.5, 22.5], "zoom": 3.6 },
    { "t": 3.5, "center": [83.02, 25.38], "zoom": 6.4 }
  ],

  "pins": [
    {
      "id": "sarnath",           // optional, but useful if you'll reference it
      "center": [83.02, 25.38],  // [longitude, latitude]
      "at": 2.2,                 // when it fades in (seconds)
      "until": 12.5,             // when it fades out — omit/null to stay till the end
      "image": "/assets/your-photo.jpg",
      "label": "Sarnath, India", // optional caption under the pin
      "size": 120                // diameter in pixels
    }
  ],

  "routes": [
    {
      "from": [83.02, 25.38],
      "to": [105.83, 21.03],
      "startAt": 12.7,
      "drawDuration": 2.8,   // seconds for the line to draw across
      "until": null,
      "color": "#e8c14c",    // optional — defaults to the style's route color
      "width": 3,
      "dashed": true,
      "label": "Relics, 2025"  // sits at the route's midpoint
    }
  ],

  "titles": [
    {
      "text": "Sarnath, India",
      "position": "bottom-left",  // bottom-left | bottom-right | top-left | top-right | center
      "at": 0.3,
      "until": 3
    }
  ]
}
```

Coordinates are always `[longitude, latitude]` (note the order — the
opposite of how map coordinates are usually spoken aloud).

### Pins: image requirements

Any JPG or PNG works. They're rendered as circles, so the *center* of the
image is what shows; a roughly square source crops best. Put your photos in
`assets/` and reference them as `/assets/your-file.jpg` in the scene.

### A note on precision

Camera and route paths interpolate in a straight line between coordinates,
not a true great-circle path, and don't handle the antimeridian (the
180°/-180° longitude seam) specially. For anything within a single
continent or a regional hop (Sarnath to Hanoi, say), this is invisible.
For a very long east-west haul close to the date line (e.g. India to the
US West Coast), the path may look a little off — reroute the pin through an
intermediate camera keyframe if that comes up, or ask and this can be
upgraded to real great-circle math.

## CLI reference

```
node render.js --scene <scene.json> [options]

  --ratio 9:16|16:9     Output aspect ratio (default: from scene, else 16:9)
  --style <name>        Overrides the scene's style preset
  --fps <n>             Overrides the scene's fps
  --out <path.mp4>      Output file path (default: output/<scene-name>.mp4)
  --width <px>          Override output width in pixels (height follows the ratio)
  --draft               Fast low-res preview: half resolution, 12fps, rougher encode
  --keep-frames         Keep the intermediate PNG frames on disk (for debugging)
```

Default full-quality resolutions: 1080x1920 for 9:16, 1920x1080 for 16:9.

## How it actually works, briefly

`render.js` starts a small local web server for the project folder (so the
page can load its own local map data — this never touches the internet),
opens it in headless Chromium via Playwright, and steps through the scene
frame by frame. For each frame it jumps the camera straight to the
interpolated position for that exact timestamp (no relying on real-time
animation playback, which would drift depending on how fast your machine
is), takes a screenshot, then hands the full sequence of PNGs to ffmpeg to
encode into an MP4. This is the same "render frame by frame, don't rely on
real-time capture" approach real animation software uses, which is why the
output timing is exact regardless of your computer's speed.

The map itself is [MapLibre GL](https://maplibre.org/) (an open-source,
free fork of Mapbox GL), drawing flat-color country polygons rather than
photographic tiles. Pins, routes, and titles are drawn as ordinary HTML/SVG
on top of the map canvas and repositioned every frame, rather than using
MapLibre's own label/marker system — this is a deliberate choice, not a
shortcut: it means text rendering doesn't depend on a remote font-glyph
server (which is the usual reason online map tools need an internet
connection even for "static" labels), and it gives full control over the
exact look of pins and captions to match Heritle's own visual style.

**On the library version:** this pins MapLibre GL to the 4.x line rather
than the newest 6.x release. MapLibre 6 dropped the plain `<script>`-loadable
build in favor of ES modules with a separately-loaded worker file, which
adds real fragility for a tool meant to just run — npm's audit flags a
critical XSS advisory against versions ≤6.4.0, but that vulnerability is in
MapLibre's HTML popup sanitizer, a code path this renderer never
exercises (no popups, no HTML strings passed into MapLibre; all text here
is plain DOM elements this tool builds itself). Worth knowing about if you
ever extend this to use MapLibre popups directly.

## Troubleshooting

- **"Executable doesn't exist" from Playwright** — run
  `npx playwright install chromium` (see Setup above).
- **ffmpeg errors / "ffmpeg: command not found"** — install ffmpeg and make
  sure it's on your PATH.
- **A render looks wrong** — use `--draft --keep-frames` to render fast and
  inspect the individual PNG frames it leaves behind (path is printed at
  the end) before waiting on a full-quality render.
- **Text looks like a generic system font** — this is deliberate (see
  above); drop a `.ttf`/`.otf` into `assets/fonts/`, add an `@font-face`
  rule near the top of `map.html`'s `<style>` block, and set it as the
  `font-family` on `#overlay` to use a brand font instead.

## Regenerating the basemap

If you ever delete the `data/` folder, or want a higher-resolution basemap
for tighter close-up zooms (edit `lib/build-basemap.js` to use
`countries-10m.json` instead of `countries-50m.json` — bigger file, more
coastline detail, only worth it if you're zooming in past country level):

```
npm run build-basemap
```

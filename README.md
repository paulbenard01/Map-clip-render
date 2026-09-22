# Heritle Map Renderer

A clip renderer for the Heritle Deep Dive series: describe a scene (camera
moves across a map, photo pins dropping onto locations, animated routes
between them, lower-third titles), and it renders an MP4 you can drop
straight into an edit.

There are two ways in:

- **The visual builder** (`npm run builder`) — place pins and routes by
  clicking the map, drag blocks on a timeline, press Render.
- **The CLI** (`node render.js --scene ...`) — for a scene file you already
  have, or for scripting.

Both go through the same renderer, and the builder's Export produces a scene
file the CLI renders identically.

It runs entirely on your own machine. There is no API key, no account, no
per-render cost, and no internet connection needed at render time: the
basemap is a small local dataset (Natural Earth country borders, via the
`world-atlas` npm package, the same public-domain source Heritle's own game
map is likely already built from), not tiles fetched from a server. The one
feature that does use the network — searching for openly-licensed photos —
runs while you're authoring, never while rendering, and downloads what you
pick into `assets/` so renders stay reproducible.

## What it looks like

Three built-in color presets in `styles/presets.json`:

- **dark-navy** (default, for The Heritle Deep Dive) — navy on navy with a
  warm gold accent for pins, routes, and highlighted countries.
- **muted-editorial** — cream/grey, the desaturated Vox/Johnny Harris
  explainer look.
- **mono-contrast** — black and white with a single red accent.

Add your own by copying a block in `styles/presets.json` and giving it a
new key; the builder's style picker and `--style <your-key>` both pick it
up automatically.

## Keeping it up to date

Clone the repository once, rather than downloading a ZIP, and updating becomes
a single step instead of a re-download:

```
git clone https://github.com/paulbenard01/Map-clip-render.git
cd Map-clip-render
```

After that, **double-click `Update.bat`** (Windows) or run `./update.sh`
(Mac/Linux) whenever you want the latest changes. It pulls, refreshes
dependencies, and tells you when it's done.

Your own work is never touched by an update — scenes, photos and renders live
in `scenes/`, `assets/` and `output/`, which aren't part of what gets pulled.

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

## The builder

**Double-click `Start Builder.bat`** (Windows) or `start-builder.sh` (Mac/Linux).
It installs what's missing the first time, starts the builder, and opens it in
your browser. Leave the window it opens alone while you work — that window *is*
the tool; closing it stops it.

Or from a terminal, if you prefer:

```
npm run builder
```

Either way the builder is at <http://127.0.0.1:4317>, and opens there by itself.
Add `--no-open` if you'd rather it didn't.

Four regions:

- **Toolbar** — style preset, aspect ratio, fps, duration, project name,
  templates, Import / Export / Save, and the two render buttons.
- **Canvas** — the live map, letterboxed to the scene's aspect ratio so the
  framing you compose is the framing that renders. Pan and zoom freely. Toggle
  **Safe area** for a margin guide near the edges — 9:16 shows much less width
  than 16:9 at the same zoom, so this is where a pin or route endpoint is at
  real risk of running off-screen, especially near the left/right edges.
- **Timeline** — a track per element type. Drag a block to move it, drag an
  edge to resize it, click it to select. The playhead scrubs the canvas.
- **Inspector** — exact values for whatever's selected. Dragging is for
  rough placement; this is where you type the real numbers.

### Placing things

| Tool | What it does |
| --- | --- |
| **Pin** | Click the map to drop a photo pin at the playhead's time. |
| **Route** | Click a start point, then an end point. |
| **Radiate** | Click one origin, then each destination in turn. Creates one route per destination with staggered start times, so they draw on in sequence rather than all at once. |
| **Keyframe** | Frame the shot by panning and zooming, then click to place a camera keyframe. |
| **Add orbit** | Adds a second keyframe 4s later with the bearing rotated 45°. An orbit is just two keyframes — there's no separate orbit primitive. |

Drag a photo onto the map to upload it into `assets/` and drop a pin holding
it. Drag a `.json` file on to import a scene.

Select a route and you get three handles: its two endpoints, and a **bend
handle** at the curve's midpoint. Dragging the bend handle sets the route's
`via` control point, and the curve passes exactly through where you put it.

### Finding photos

The inspector's **Find…** button searches Wikimedia Commons and Openverse
for openly-licensed images. Picking one downloads it into `assets/` and
points the pin at the local path; licence and attribution are recorded in
`assets/credits.json`. Check the licence before publishing — several of
these require crediting the photographer.

There is no AI in the builder. To go from a written description to a scene,
press **Copy prompt**, paste it into a Claude conversation along with your
description, and paste the JSON that comes back into Import → Paste JSON.
That prompt lives in [`docs/scene-authoring-prompt.md`](docs/scene-authoring-prompt.md)
and is written to be handed over on its own.

### Keyboard

| Key | |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Step one frame (hold `Shift` for one second) |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo |
| `Ctrl/Cmd+S` | Save into `scenes/` |
| `Delete` | Delete the selected element |
| `Esc` | Back to the select tool |

## Quick start (CLI)

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

`scenes/sarnath/` holds a full nine-clip set built from a real script; see
[`docs/sarnath-clip-plan.md`](docs/sarnath-clip-plan.md) for what each one
does. Scenes can be grouped in subfolders like that one level deep, and the
builder's Import list groups them by folder.

`scenes/example-features.json` is a second example that exercises every
newer schema field in one clip (camera `cut` and `zoomBlast`, all four pin
styles, the three route curves, `via`, arrowheads, timed multi-country
highlights). It's the quickest way to eyeball whether a change to the engine
broke something.

## Scene JSON reference

```jsonc
{
  "schemaVersion": 2,
  "aspect": "9:16",          // or "16:9" — can also be set via --ratio
  "style": "dark-navy",      // a key from styles/presets.json
  "fps": 30,
  "duration": 22,            // optional — auto-computed from content if omitted

  "camera": [
    // Keyframes the camera moves between. `t` is seconds from the start.
    // zoom/bearing/pitch are optional (default 0 for bearing/pitch).
    { "t": 0,   "center": [79.5, 22.5], "zoom": 3.6 },
    { "t": 3.5, "center": [83.02, 25.38], "zoom": 6.4, "transition": "ease" }
  ],

  "pins": [
    {
      "id": "sarnath",           // optional, but useful if you'll reference it
      "center": [83.02, 25.38],  // [longitude, latitude]
      "at": 2.2,                 // when it fades in (seconds)
      "until": 12.5,             // when it fades out — null to stay till the end
      "image": "/assets/your-photo.jpg",
      "label": "Sarnath, India", // optional caption under the pin
      "size": 120,               // diameter in pixels
      "style": "circle",         // see the table below
      "ringColor": "#e8c14c",    // optional — defaults to the style preset
      "borderWidth": 4           // optional
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
      "curve": "arc",        // "straight" | "arc" | "greatCircle"
      "bulge": 0.15,         // "arc" only — 0..1, how pronounced the bow is
      "via": [95.0, 27.0],   // optional explicit control point, overrides `curve`
      "arrowEnd": false,     // small arrowhead at the destination
      "label": "Relics, 2025"  // sits at the route's midpoint
    }
  ],

  "countryHighlights": [
    // Fills a country a different shade for a stretch of the clip.
    { "iso": "IND", "color": "#e8c14c", "at": 2.0, "until": 8.0, "fade": 0.6 },
    { "iso": "CHN", "color": "#c0392b", "at": 8.0, "until": null, "fade": 0.6 }
  ],

  "zones": [
    // A "sphere of influence" — a region defined by a centre and radius,
    // not tied to any country's border. Drawn as a hatched fill with a
    // dashed boundary, visually distinct from a solid countryHighlights fill.
    { "center": [95.0, 22.0], "radius": 500, "color": "#e8c14c", "label": "Regional influence", "at": 2.0, "until": null, "fade": 0.6 }
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

`until: null` means "stay visible to the end of the clip" and is different
from omitting the field. Set it explicitly rather than guessing a number.

### Camera transitions

`transition` describes how the camera *arrives* at a keyframe from the one
before it.

| `transition` | Effect |
| --- | --- |
| `"ease"` (default) | Smooth eased pan and zoom. |
| `"cut"` | Instant jump: holds the previous keyframe, then snaps. This is how you cut between places. |
| `"zoomBlast"` | Pan, bearing and pitch ease normally, but zoom hangs back and then rushes in — the dramatic push onto a target. |
| `"smooth"` | A slower, more deliberate glide — holds longer at both ends than the default. |
| `"organic"` | The camera drifts slightly past the target and eases back, rather than stopping dead on arrival — a softer, more human landing. |

An **orbit** needs no special field: two keyframes with the same `center`
and `zoom` and different `bearing` values, a few seconds apart, is an orbit.

There's no 3D globe, and `pitch` has no visual effect — the map is a flat
Equal Earth projection (see "Projection" below), and a flat pseudocylindrical
projection has no tilt to give it. The field is kept in the schema so a
scene that sets it doesn't error, but it's a no-op. If a true rotating globe
shot ever becomes a hard requirement, that's a real rendering-technology
change, not something to fake.

### Pin styles

| `style` | |
| --- | --- |
| `"circle"` (default) | Round photo with a coloured ring. |
| `"square"` / `"rounded-square"` | Same, squared off. |
| `"badge"` | A small marker on the exact coordinate, with the photo in a card beside it. Use when several pins would otherwise overlap. |
| `"polaroid"` | Photo print with a thick cream border, a slight tilt and a heavy shadow. |

### Zones (sphere of influence)

Two shapes, chosen by which fields you give it:

- **Circle** — `center` + `radius` (km): a geodesic circle, for a simple
  radius of influence.
- **Polygon** — `points`, an array of three or more `[lng, lat]` pairs, in
  order: an arbitrary shape, for a region that isn't round — a contested
  border strip, a cultural corridor, a coastline. Give `points` and `center`/
  `radius` are ignored.

Unlike `countryHighlights`, neither shape is tied to a border. `label` is
optional; the fill is a diagonal hatch pattern (distinct from a country
highlight's solid fill), with a dashed boundary line, both in `color` (or
the style preset's accent colour if omitted).

In the builder: the **Zone (circle)** tool places one on a single click,
then drag its edge handle to resize. The **Zone (shape)** tool places a
vertex per click — at least 3 — then press **Enter** to finish, **Esc** to
cancel; drag any vertex afterward to reshape it.

### Country highlights

ISO 3166-1 alpha-3 codes (`IND`, `CHN`, `VNM`), matching the `id` property
in `data/countries.geo.json`.

The older `"focusCountry": "IND"` shorthand still works and is treated as a
single highlight that's on for the whole clip with no fade — so scenes
written before timed highlights existed render exactly as they did. A scene
using it round-trips through the builder unchanged. Prefer
`countryHighlights` for anything new.

### Terrain

Run one local build step, once, and every scene automatically renders with
real relief — visible mountain ranges, vegetation vs. desert tinting —
instead of a flat land colour. There's no per-scene flag and nothing to
turn on; it's purely "is the asset there or not":

```
npm install sharp     # a native dependency, only needed for this step
npm run build-terrain  # downloads ~143MB, converts it, keeps a ~600KB-2MB JPEG
```

That fetches Natural Earth's public-domain cross-blended hypsometric relief
once from their S3 bucket, converts it to `data/terrain/relief.jpg` +
`data/terrain/bounds.json`, and deletes the large intermediate files. Nothing
is fetched at render time — same rule as the country/land data already
committed to `data/`. Skip this step and every scene renders exactly as it
did before — flat land colour, no warning, no per-scene setting to remember.

Worth knowing once it's on:
- It's a single static image, not a tile pyramid, so it doesn't get sharper
  the further you zoom in — a landmark-level shot will still show it
  blurred past its native resolution.
- The image's own colours (real ocean and land tones) show through, rather
  than the active style preset's palette — every scene's overall look
  changes once the asset exists, not just the terrain texture.
- Land/country fills are drawn semi-transparent over it so borders and
  highlights stay legible.
- Delete `data/terrain/` to go back to the flat look — nothing else needs
  to change.

### Pins: image requirements

Any JPG or PNG works. In the default circle style the *center* of the image
is what shows, so a roughly square source crops best. Put your photos in
`assets/` and reference them as `/assets/your-file.jpg` in the scene — the
builder's upload and image search both do this for you.

### Drafts frame the same shot

A `--draft` render is half resolution but shows exactly the same field of view
as the full-quality one, so it can be trusted for checking framing as well as
timing. (It captures a full-size page at half device scale rather than
shrinking the viewport, which at the same zoom would show half as much map.)

### A note on precision

Fades and a route's draw-on are eased (a smooth S-curve, not a constant
rate) by default — this changed in schemaVersion 2 and applies automatically,
no field to set. The timing (`fade`, `drawDuration`) means the same thing as
before; only the shape of the ramp is smoother.

Camera interpolation moves in a straight line between coordinates and does
not handle the antimeridian (the 180°/-180° seam); a camera move across it
needs an intermediate keyframe.

Routes do handle it: endpoints are resolved to whichever way round the world
is shorter, and `greatCircle` uses real spherical interpolation (a slerp on
the coordinates as unit vectors) rather than a visual approximation, which
is what matters on long east-west hauls. For anything within a continent,
`straight` and `greatCircle` look the same.

## CLI reference

```
node render.js --scene <scene.json> [options]

  --ratio 9:16|16:9     Output aspect ratio (default: from scene, else 16:9)
  --style <name>        Overrides the scene's style preset
  --fps <n>             Overrides the scene's fps
  --out <path.mp4>      Output file path (default: output/<scene-name>.mp4)
  --width <px>          Override output width in pixels (height follows the ratio)
  --draft               Fast low-res preview: half resolution, 12fps, rougher encode
                        (frames the identical shot to a full render)
  --keep-frames         Keep the intermediate PNG frames on disk (for debugging)
```

Default full-quality resolutions: 1080x1920 for 9:16, 1920x1080 for 16:9.

## Style presets and suggestions

Every element's inspector panel opens with an **Apply a preset…** dropdown —
a one-click style bundle (a route as a dashed arced "flight path", a title as
a bold lower-third, a pin as a polaroid) to start from rather than setting
five fields by hand. A preset only ever changes *look*: position, timing,
text and id are never touched.

Two contextual suggestions appear when they're actually relevant, each with
a one-click fix, and disappear once no longer applicable:

- **A pin with others crowded close by on screen** (at the current view, not
  a fixed real-world distance — the same distance reads as huge or tiny
  depending on zoom) suggests switching to badge style.
- **A straight route over a genuinely long haul** (>3,000km) suggests
  `greatCircle`, since a flat line visibly cuts across the curvature at
  that distance.

## Label overlap

Labels that would land on top of each other — two pins close together, a
route label near a title — are nudged apart automatically, vertically,
using the browser's own real layout (not an estimate), so text stays
legible without you having to manually reposition anything. A pin's marker
itself never moves, only its label text; the geographic point it marks
has to stay exact. This runs identically in the builder preview and the
final render, since both share the same painting code.

## How it actually works, briefly

`lib/renderer.js` starts a small local web server for the project folder (so
the page can load its own local map data — this never touches the internet),
opens `map.html` in headless Chromium via Playwright, and steps through the
scene frame by frame. For each frame it jumps the camera straight to the
interpolated position for that exact timestamp (no relying on real-time
animation playback, which would drift depending on how fast your machine
is), takes a screenshot, then hands the full sequence of PNGs to ffmpeg to
encode into an MP4. This is the same "render frame by frame, don't rely on
real-time capture" approach real animation software uses, which is why the
output timing is exact regardless of your computer's speed.

The builder's Render button posts the scene to `POST /api/render`, which
calls that same function. The UI never captures video itself — a canvas or
MediaRecorder capture would be real-time and would drift.

Pins, routes, and titles are drawn as ordinary HTML/SVG on top of the map
canvas and repositioned every frame, rather than using a map library's own
label/marker system — this is a deliberate choice, not a shortcut: it means
text rendering doesn't depend on a remote font-glyph server (which is the
usual reason online map tools need an internet connection even for "static"
labels), and it gives full control over the exact look of pins and captions
to match Heritle's own visual style.

### Projection

The map draws in the **Equal Earth** projection — following the UN General
Assembly's September 2026 "Correct the Map" resolution, which endorsed
equal-area projections like Equal Earth over Mercator for representing
relative landmass size (Mercator visibly inflates land the further it is
from the equator — Greenland reads as roughly Africa-sized under it, though
Africa is about 14 times larger).

This is a real technology swap, not a setting: `lib/equal-earth-map.js` is a
from-scratch renderer built on [d3-geo](https://d3js.org/d3-geo) and a 2D
canvas, implementing just enough of a slippy-map's API (pan, zoom, sources,
layers) that `lib/scene-view.js` — the file the builder's live preview and
the CLI's frame-exact export both depend on — didn't need to change at all.
The project no longer uses MapLibre GL / WebGL for the base map.

Worth knowing about this specifically:

- **Equal Earth isn't conformal and has no tile scheme** — the reason every
  interactive slippy map (Google Maps, Mapbox, Apple Maps, MapLibre itself)
  still uses Mercator: it doesn't have a clean, distortion-free way to zoom
  in tight the way Mercator does. A landmark/city-level shot (zoom 10+)
  will look increasingly stretched compared to how it would have under
  Mercator. This is inherent to the projection, not a bug to work around.
- **`bearing`-driven orbit shots** still work — bearing rotates the canvas
  itself around its centre, the same flat 2D effect it always was.
- **Country/land geometry is simplified and viewport-culled** before
  drawing, once per source rather than per frame. A GPU (what MapLibre
  used) can re-transform already-tessellated geometry almost for free on
  every pan/zoom; a CPU walking full-resolution GeoJSON with `d3.geoPath`
  on every single animated frame cannot, so this is what keeps a 600+-frame
  render's actual wall-clock time reasonable rather than reprocessing
  a ~250-country, 100k-point dataset 600 times over.
- **Terrain reprojection is the one genuinely slow part.** Vector fills stay
  fast; per-pixel-reprojecting the terrain raster (see "Terrain" above) is
  CPU-bound and noticeably heavier — mitigated by reprojecting at a capped
  internal resolution and upscaling, but a terrain-enabled render still
  takes meaningfully longer than one without.

## Project layout

```
Start Builder.bat     double-click launcher (Windows)
start-builder.sh      the same, for Mac and Linux
Update.bat            double-click updater (Windows)
update.sh             the same, for Mac and Linux
builder.html          the editor page
builder/              its modules (store, canvas, timeline, inspector, tools)
lib/scene-engine.js   camera/fade/route/duration math — pure functions
lib/equal-earth-map.js  the Equal Earth map renderer (d3-geo + canvas)
lib/scene-view.js     paints a scene onto the map (DOM + SVG overlays)
lib/renderer.js       the frame-exact capture loop and ffmpeg encode
lib/build-basemap.js  builds data/*.geo.json from world-atlas
lib/build-terrain.js  opt-in: builds data/terrain/ from Natural Earth relief
lib/image-search.js   Wikimedia Commons + Openverse search and import
map.html              the headless page the renderer screenshots
render.js             the CLI
server.js             the builder's local backend
```

**The most important thing to know before changing any of it:** the
builder's preview and the final render share `scene-engine.js` and
`scene-view.js`. Both consume them — the builder for live playback, the
render page for frame capture. If those two ever compute positions with
different code, the preview stops telling the truth about the render, and
"what I built isn't what came out" becomes a permanent class of bug. Put
scene logic in the engine, not in either page.

Run `npm test` after touching the engine. Rendering
`scenes/example-features.json` is the visual counterpart.

## Troubleshooting

- **"Executable doesn't exist" from Playwright** — run
  `npx playwright install chromium` (see Setup above).
- **ffmpeg errors / "ffmpeg: command not found"** — install ffmpeg and make
  sure it's on your PATH.
- **A render looks wrong** — use `--draft --keep-frames` to render fast and
  inspect the individual PNG frames it leaves behind (path is printed at
  the end) before waiting on a full-quality render.
- **Update.bat says "this folder is a downloaded copy"** — you have a ZIP
  extraction rather than a clone. See "Keeping it up to date" above; cloning
  once fixes it permanently.
- **The launcher window closes instantly** — that means it failed before it
  could print anything. Open PowerShell in the project folder and run
  `node server.js` directly to see the error.
- **"Port 4317 is already in use"** — the builder is probably already running
  in another window. Either use that one, or close it and try again.
- **Image search says it failed** — that's the one part of the tool that
  needs the internet, and it's also the one part you can skip: upload a file
  instead. Rendering is unaffected.
- **Text looks like a generic system font** — this is deliberate (see
  above); drop a `.ttf`/`.otf` into `assets/fonts/`, add an `@font-face`
  rule near the top of `styles/overlay.css`, and set it as the
  `font-family` on `#overlay` to use a brand font instead.

## Regenerating the basemap

The builder and the CLI both build `data/` automatically when it's missing,
and rebuild it when a change to the project has made the existing files out
of date — so normally you never run this by hand.

If you delete the `data/` folder, or want a higher-resolution basemap
for tighter close-up zooms (edit `lib/build-basemap.js` and change
`RESOLUTION` to `"10m"` — bigger file, more coastline detail, only worth it
if you're zooming in past country level):

```
npm run build-basemap
```

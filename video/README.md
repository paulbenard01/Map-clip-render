# Portrait explainer videos

Full-length vertical (1080×1920, 30fps) explainer videos in the Heritle look:
navy and gold, shaded-relief maps, photo prints, marker annotations,
highlighted documents, and word-synced subtitles. Silent by design: the
voiceover goes on in the edit.

A video is a folder under `video/` (e.g. `video/sarnath/`) containing:

| File | What it is |
|---|---|
| `index.html` | Loads the engine and the scene. |
| `scene.js` | The whole timeline, beat by beat, with times from the voiceover. |
| `transcript.json` | Word-timed transcript of the voiceover (Deepgram format). |
| `images/` | Photos, `wanted.json` (what each slot should show) and `credits.json`. |

The engine lives in `video/engine/`: `core.js` (timing, photos, titles,
tags, counters, stamps, documents, markers), `map.js` (the relief map),
`subs.js` (subtitles and word lookup), `fx.js` (paper and grain) and
`graphics.js` (things drawn in code: passport, banknote, wheel, flag, plaque).

## One-time setup

You need Node.js 18+ and `ffmpeg` on your PATH (the same as the map clips).
Then, from the repository folder:

```
git fetch origin
git checkout claude/keen-volta-0j6f36
npm install
npm install --no-save sharp shapefile
npx playwright install chromium
npm run build-basemap
npm run build-terrain
node video/tools/prepare-map.js
```

`build-terrain` downloads about 143MB once. It all works the same from
Windows PowerShell, macOS or Linux. `prepare-map.js`
recolours Natural Earth's shaded relief into Heritle navy and writes it to
`data/video/`. It is regenerable, so it isn't committed.

## Rendering

```
node video/render.js sarnath                        # full video -> output/sarnath.mp4
node video/render.js sarnath --stills 12.5,80,200   # review frames -> output/stills/sarnath/
node video/render.js sarnath --from 60 --to 90      # just a slice
node video/render.js sarnath --draft                # half resolution, for timing checks
```

Every frame is a pure function of time, so renders are identical every run
and the frame range is split across several headless browsers in parallel.
`video/tools/contact-sheet.js out.png a.png b.png ...` tiles stills for review.

## Photos

Each photo slot in `scene.js` points at `images/<id>.jpg`. A missing file
renders as a labelled placeholder card, so the cut can be timed and reviewed
before the photos are chosen. To fill the slots from Wikimedia Commons
(public domain, CC0, CC BY and CC BY-SA only):

```
node video/tools/fetch-images.js sarnath                 # every missing slot
node video/tools/fetch-images.js sarnath --list nehru    # see the candidates
node video/tools/fetch-images.js sarnath --pick nehru="File:Some file.jpg"
```

Attribution is written to `images/credits.json`. CC BY and BY-SA photos need
that credit in the video description when you publish. You can also drop your
own files into `images/` under the same names.

## Editing the timeline

Times are seconds into the voiceover. `V.at("word", from)` returns when a word
is spoken, and a title with `sync: true` reveals each word as it's said. If
the voiceover is re-recorded, replace `transcript.json` and nudge the times in
`scene.js`. The subtitles rebuild themselves from the transcript.

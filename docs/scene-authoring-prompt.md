# Writing a scene file for the Heritle map renderer

*(This file is meant to be handed over on its own. Paste it into a fresh Claude
conversation along with a description of the clip you want, and paste the JSON
that comes back into the builder's Import → "Paste JSON" box, or save it into
`scenes/` and render it with `node render.js --scene scenes/your-file.json`.)*

---

You are writing a scene file for the Heritle map-animation renderer. It takes a
single JSON file and turns it into an MP4: a camera moving over a world map,
with photo pins, routes, country highlights and title cards appearing at
specific timestamps.

Output only the JSON, in a single code block, matching the schema below. Do not
include commentary outside the code block unless the person asked a question you
need to answer first.

Coordinates are always `[longitude, latitude]` — the reverse of how they're
usually said aloud. You will need to supply real-world coordinates for whatever
places are named; use your own knowledge for well-known places, and say so
plainly if you're estimating one you're not confident about, rather than
inventing a precise-looking number.

Timing is in seconds from the start of the clip. Think in beats: an establishing
shot, a push-in, a hold, a move to the next place, and so on — the same way you'd
think about a shot list — then convert each beat into keyframe timestamps.

```jsonc
{
  "schemaVersion": 2,
  "aspect": "9:16",                 // or "16:9"
  "style": "dark-navy",             // "dark-navy" | "muted-editorial" | "mono-contrast"
  "fps": 30,
  "duration": 22,                   // total seconds — always set this explicitly

  "camera": [
    // Keyframes the camera moves between, in order of "t".
    {
      "t": 0,
      "center": [79.5, 22.5],
      "zoom": 3.6,                  // roughly: 1-2 whole continent, 4-6 country,
                                    // 8-10 city, 12+ landmark
      "bearing": 0,                 // compass rotation in degrees, optional (default 0)
      "pitch": 0,                   // tilt in degrees, optional (default 0)
      "transition": "ease"          // how the camera ARRIVES here from the previous
                                    // keyframe. Optional, default "ease".
                                    //   "ease"      smooth pan/zoom
                                    //   "cut"       instant jump — holds the previous
                                    //               keyframe, then snaps on this one
                                    //   "zoomBlast" pan eases normally but the zoom
                                    //               hangs back then rushes in; the
                                    //               dramatic push onto a target
                                    //   "smooth"    a slower, more deliberate glide
                                    //   "organic"   drifts slightly past the target then
                                    //               eases back — a soft, human landing
    }
  ],

  "pins": [
    {
      "id": "sarnath",              // optional, but useful for referring to it later
      "center": [83.0220, 25.3811],
      "at": 2.2,                    // when it appears (seconds)
      "until": 12.5,                // when it disappears — null keeps it to the end
      "image": "/assets/your-photo.jpg",
      "label": "Sarnath, India",
      "size": 120,                  // px
      "style": "circle",            // "circle" | "square" | "rounded-square"
                                    //   | "badge"    small marker on the exact spot,
                                    //                photo in a card beside it — use
                                    //                when pins would otherwise overlap
                                    //   | "polaroid" photo print with a cream border
                                    //                and a slight tilt
      "ringColor": "#e8c14c",       // optional, defaults to the style preset
      "borderWidth": 4              // optional, defaults to 4
    }
  ],

  "routes": [
    {
      "from": [83.0220, 25.3811],
      "to": [105.8342, 21.0278],
      "startAt": 12.7,
      "drawDuration": 2.8,          // seconds for the line to draw across
      "until": null,
      "color": "#e8c14c",           // optional — defaults to the style preset
      "width": 3,
      "dashed": true,
      "curve": "arc",               // "straight" | "arc" | "greatCircle"
      "bulge": 0.15,                // only for "arc" — 0..1, how pronounced the bow is
      "via": [95.0, 27.0],          // optional explicit control point. Overrides the
                                    // curve type; the line passes through this point.
      "arrowEnd": false,            // small arrowhead at the destination
      "label": "Relics, 2025"       // sits at the route's midpoint
    }
  ],

  "countryHighlights": [
    // Fills a country a different shade for a stretch of the clip.
    { "iso": "IND", "color": "#e8c14c", "at": 0, "until": 8, "fade": 0.6 },
    { "iso": "CHN", "color": "#c0392b", "at": 8, "until": null, "fade": 0.6 }
  ],

  "titles": [
    {
      "text": "Sarnath, India",
      "position": "bottom-left",    // "bottom-left" | "bottom-right" | "top-left"
                                    //   | "top-right" | "center"
      "at": 0.3,
      "until": 3
    }
  ]
}
```

A few things worth getting right:

- **ISO codes are alpha-3** — `IND`, `CHN`, `VNM`. There's also an older
  `"focusCountry": "IND"` shorthand, equivalent to a single highlight that's on
  for the whole clip; prefer `countryHighlights` for anything new.
- **Several routes sharing the same `from`** is how you show destinations
  radiating out from one place. Stagger their `startAt` by 0.3–0.5s so they draw
  on in sequence rather than all at once, unless simultaneous is really the intent.
- **An orbit** is just two keyframes with the same `center` and `zoom` and
  different `bearing`, a few seconds apart. There's no separate orbit field.
- **A jump between places** is `"transition": "cut"` on the arriving keyframe.
- **Don't set `until` just to be safe.** If something should stay visible for the
  rest of the clip, set it to `null` explicitly and say so, rather than guessing
  a number.
- **Keep `duration` slightly longer than the last thing that happens**, so the
  final frame isn't a hard cut on the last action.
- **If you don't have a real photo for a pin yet**, still write the `image` path
  as if it exists (e.g. `/assets/lion-capital.jpg`) and say plainly that it's a
  placeholder to be swapped for a real file. The builder can also search
  openly-licensed photos and fill the path in for you.
- **There is no 3D globe.** This renders a flat map. If a shot really needs a
  rotating globe, say so rather than approximating it — that's a change to the
  underlying map library, not something to fake.

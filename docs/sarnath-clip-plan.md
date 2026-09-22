# Sarnath, Outward Facing — map clip plan

A beat-by-beat pass over the 4–5 minute script, marking every place the
renderer can carry a point, and what each clip is actually doing.

Nine clips, 165 seconds of map footage in total, all 9:16 dark-navy at 30fps
to match the rest of the series. Each is a separate scene file in `scenes/`,
so they can be re-timed independently as the edit moves.

Open any of them with **Import → From scenes/** in the builder, or render one
straight from the command line:

```
node render.js --scene scenes/sarnath-04-circuit.json --draft
```

---

## The clips

| # | Script beat | Scene file | What the map is doing |
|---|---|---|---|
| 1 | 0:12 — "This is Sarnath, just outside Varanasi" | `sarnath-01-locate` | Wide on northern India, then a hard push onto the site. Establishes where before the history starts. |
| 2 | 0:30 — Ashoka after Kalinga | `sarnath-02-kalinga` | Opens on the battlefield, pulls back, draws north to Sarnath. The arc *is* the argument: conflict in one place, revival in another. |
| 3 | 1:36 — "transcends national boundaries" | `sarnath-03-transcend` | Pulls from Sarnath out to the region while the India highlight fades. The national frame dissolving into the global one is the beat. |
| 4 | ~2:30 — the Buddhist Circuit | `sarnath-04-circuit` | The circuit graphic the shot list already calls for. Legs draw in pilgrimage order. |
| 5 | 2:50 — the relic tour | `sarnath-05-relic-tour` | India to Vietnam. The highlight hands off from one country to the other as the route lands, so focus follows the relics. |
| 6 | ~3:05 — China's World Buddhist Forum | `sarnath-06-china-forum` | Delegate routes radiating from Ningbo, drawing on one after another. The counter-strategy as a picture. |
| 7 | ~3:15 — building on India's doorstep | `sarnath-07-doorstep` | Lumbini, then a hard cut to the Nanhai Academy, then both in one frame. |
| 8 | 3:25 — the succession | `sarnath-08-succession` | Dharamshala and Beijing, two colours, one dashed line. |
| 9 | 4:08 — "roughly half a billion people" | `sarnath-09-worldwide` | Countries light up in sequence so the scale accumulates under the line. India lands last. |

## Beats deliberately left without a map

Not every beat wants one, and cutting to a map that adds nothing is worse
than staying on the footage.

- **0:00 hook** — the lion capital and the passport. Object shots. A map here
  would delay the hook.
- **1:02 the 1947 parallel** — the Constituent Assembly and the emblem. The
  argument is about symbolism, not geography.
- **2:07 the UNESCO session / soft power admission** — a quote card and
  session footage carry it. The map arrives after, for the rivalry.
- **3:47 what's next** — deliberately an absence (an unpublished plan). Hard
  to draw, and the script is better served by the stupa and the blank page.

---

## Features each clip exercises

Useful if you change one and want to know what you might break.

| Feature | Used in |
|---|---|
| `zoomBlast` push | 1 |
| `cut` between places | 7, 8 |
| Timed multi-country highlights | 3, 5, 6, 7, 8, 9 |
| Highlight fading *out* mid-clip | 3, 5, 7 |
| `arc` routes with `arrowEnd` | 2, 4, 5 |
| `greatCircle` routes | 6 |
| Staggered route start times | 4, 6 |
| `badge` pins (dense clusters) | 1, 2, 4, 5, 6, 7, 8 |
| Photo pins | 1, 5 |

## Production notes

**The photos are placeholders.** `assets/sarnath-lion-capital.jpg` and
`assets/relic-tour-vietnam.jpg` are generated colour cards. Replace the files
and the scenes pick them up — or use the builder's **Find…** button to pull
an openly-licensed photo into `assets/`. Check the licence before publishing;
attribution lands in `assets/credits.json`.

**Coordinates to verify before a final render.** Most are well-known sites I'm
confident about. These are my best estimate and worth checking against a
source:

- `kalinga` — placed at Dhauli, near Bhubaneswar, as the conventional
  battlefield site. If the edit means Kalinga the region rather than the
  battle, this should move.
- `nanhai` — the Nanhai Buddhist Academy at Nanshan, Sanya, Hainan.
- `vaishali`, `sravasti` — both approximate.

**"Nanhai... before India could revive the original nearby."** Worth a look
before this line is locked. Drawing it exposes the problem: Nalanda is in
Bihar and the Nanhai Academy is on Hainan, roughly 3,000 km apart. Clip 7
shows both in one frame, and the shot will visibly contradict "nearby" if the
word survives. Either the line wants rewording, or the clip should stay on
Lumbini — which genuinely *is* on India's doorstep, and makes the same point
honestly.

**Colour is an editorial choice.** China is a muted terracotta rather than a
flat red, because a saturated red reads as commentary. India uses the preset's
own highlight tone everywhere except the closing clip, where it takes the gold
so it lands. Every one of these is a single `color` field per highlight.

**The wider Buddhist world uses `#2f6ea8`, not the preset default.** The
default highlight is too low-contrast for small countries at world zoom —
Thailand and Cambodia simply vanish. Worth remembering for any future
world-scale clip.

**Clip 6 stands in for the full list.** Thirteen destinations represent
"over seventy countries". Add or remove entries in its `routes` array; the
staggering is 0.3s per route, so re-time `startAt` if you change the count.

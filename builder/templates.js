/**
 * Scene templates — the shapes that come up again and again, pre-built so a
 * new clip starts from something playable instead of an empty timeline.
 *
 * These are ordinary scenes made of the same primitives as anything else;
 * nothing here is special-cased by the engine. Edit them like any scene.
 */

export const TEMPLATES = [
  {
    key: "single-location",
    name: "Single location reveal",
    description: "Wide establishing shot, push in on one place, hold with a photo pin and a title.",
    build: (place) => ({
      schemaVersion: 2,
      name: "single-location-reveal",
      aspect: "9:16",
      style: "dark-navy",
      fps: 30,
      duration: 14,
      camera: [
        { t: 0, center: offset(place.center, 0, 0), zoom: 3.4 },
        { t: 4, center: place.center, zoom: 7.2 },
        { t: 11, center: place.center, zoom: 7.2 },
      ],
      countryHighlights: place.iso ? [{ iso: place.iso, at: 0, until: null, fade: 0.6 }] : [],
      pins: [
        { id: "subject", center: place.center, at: 3.2, until: null, label: place.label, size: 120, style: "circle" },
      ],
      titles: [
        { id: "t1", text: place.label, position: "bottom-left", at: 0.4, until: 4 },
      ],
      routes: [],
    }),
  },
  {
    key: "two-city",
    name: "Two-city comparison",
    description: "Cut between two places, then pull back to show both with a route between them.",
    build: (a, b) => ({
      schemaVersion: 2,
      name: "two-city-comparison",
      aspect: "9:16",
      style: "dark-navy",
      fps: 30,
      duration: 22,
      camera: [
        { t: 0, center: a.center, zoom: 6.4 },
        { t: 5, center: a.center, zoom: 6.4 },
        { t: 5.5, center: b.center, zoom: 6.4, transition: "cut" },
        { t: 10.5, center: b.center, zoom: 6.4 },
        { t: 14, center: midpoint(a.center, b.center), zoom: 3.6 },
        { t: 21, center: midpoint(a.center, b.center), zoom: 3.6 },
      ],
      pins: [
        { id: "a", center: a.center, at: 1, until: 5.5, label: a.label, size: 120 },
        { id: "b", center: b.center, at: 6.5, until: 11, label: b.label, size: 120 },
        { id: "a2", center: a.center, at: 15, until: null, label: a.label, size: 90, style: "badge" },
        { id: "b2", center: b.center, at: 15, until: null, label: b.label, size: 90, style: "badge" },
      ],
      routes: [
        { id: "link", from: a.center, to: b.center, startAt: 16, drawDuration: 2.4, until: null, curve: "arc", dashed: true },
      ],
      titles: [
        { id: "t1", text: a.label, position: "bottom-left", at: 0.4, until: 5 },
        { id: "t2", text: b.label, position: "bottom-left", at: 6, until: 10.5 },
      ],
      countryHighlights: [],
    }),
  },
  {
    key: "hub-tour",
    name: "Hub tour",
    description: "One origin, several destinations radiating out in sequence.",
    build: (hub, spokes) => ({
      schemaVersion: 2,
      name: "hub-tour",
      aspect: "9:16",
      style: "dark-navy",
      fps: 30,
      duration: 20,
      camera: [
        { t: 0, center: hub.center, zoom: 6.2 },
        { t: 3.5, center: hub.center, zoom: 6.2 },
        { t: 7, center: hub.center, zoom: 3.2 },
        { t: 19, center: hub.center, zoom: 3.2 },
      ],
      pins: [{ id: "hub", center: hub.center, at: 1, until: null, label: hub.label, size: 120 }],
      routes: spokes.map((s, i) => ({
        id: "spoke" + (i + 1),
        from: hub.center,
        to: s.center,
        // Staggered so they draw on one after another rather than all at once.
        startAt: 8 + i * 0.4,
        drawDuration: 2.2,
        until: null,
        curve: "arc",
        arrowEnd: true,
      })),
      titles: [{ id: "t1", text: hub.label, position: "bottom-left", at: 0.4, until: 4 }],
      countryHighlights: [],
    }),
  },
];

function midpoint(a, b) {
  return [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)];
}
function offset(c, dx, dy) { return [round(c[0] + dx), round(c[1] + dy)]; }
function round(n) { return Math.round(n * 10000) / 10000; }

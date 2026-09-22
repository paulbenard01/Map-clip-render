/**
 * Named style bundles — a starting point for how an element looks, applied
 * with one click from the inspector, rather than setting five fields by
 * hand every time. Purely style: none of these touch position, timing, text
 * content or id, so applying one never moves or retimes anything.
 *
 * Distinct from templates.js, which builds a whole scene; these are
 * per-element.
 */

export const PIN_PRESETS = [
  {
    key: "photo",
    name: "Photo (default)",
    apply: { style: "circle", size: 120, ringColor: null, borderWidth: null },
  },
  {
    key: "landmark",
    name: "Landmark card",
    apply: { style: "polaroid", size: 130 },
  },
  {
    key: "marker",
    name: "Location marker",
    apply: { style: "badge", size: 90 },
  },
  {
    key: "minimal",
    name: "Minimal dot",
    apply: { style: "badge", size: 44 },
  },
  {
    key: "bold-ring",
    name: "Bold ring",
    apply: { style: "circle", size: 120, borderWidth: 8 },
  },
];

export const ROUTE_PRESETS = [
  {
    key: "flight",
    name: "Flight path",
    apply: { curve: "arc", bulge: 0.18, dashed: true, arrowEnd: true, width: 3 },
  },
  {
    key: "direct",
    name: "Direct link",
    apply: { curve: "straight", dashed: false, arrowEnd: false, width: 3 },
  },
  {
    key: "historic",
    name: "Long-haul / historic route",
    apply: { curve: "greatCircle", dashed: true, arrowEnd: false, width: 2 },
  },
  {
    key: "bold",
    name: "Bold connector",
    apply: { curve: "arc", bulge: 0.12, dashed: false, arrowEnd: true, width: 5 },
  },
];

export const TITLE_PRESETS = [
  {
    key: "lower-third",
    name: "Lower third",
    apply: { position: "bottom-left", caps: true, bold: true, size: 22 },
  },
  {
    key: "subtle",
    name: "Subtle caption",
    apply: { position: "bottom-right", caps: false, bold: false, size: 16 },
  },
  {
    key: "statement",
    name: "Big statement",
    apply: { position: "center", caps: true, bold: true, size: 36 },
  },
  {
    key: "understated",
    name: "Understated label",
    apply: { position: "top-left", caps: false, bold: false, size: 14 },
  },
];

export const ZONE_PRESETS = [
  {
    key: "influence",
    name: "Sphere of influence",
    apply: { color: null, fade: 0.6 },
  },
  {
    key: "contested",
    name: "Contested zone",
    apply: { color: "#c0392b", fade: 0.4 },
  },
  {
    key: "cultural",
    name: "Cultural region",
    apply: { color: "#8a6aa8", fade: 0.8 },
  },
  {
    key: "corridor",
    name: "Strategic corridor",
    apply: { color: "#2f6ea8", fade: 0.5 },
  },
];

export const PRESETS_BY_KIND = {
  pin: PIN_PRESETS,
  route: ROUTE_PRESETS,
  title: TITLE_PRESETS,
  zone: ZONE_PRESETS,
};

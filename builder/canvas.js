/**
 * The editing canvas: an interactive EqualEarthMap (lib/equal-earth-map.js)
 * with the scene painted on top by lib/scene-view.js — the same painter the
 * render page uses, so what you see here is what gets captured.
 *
 * Editor-only furniture (drag handles, the route `via` handle, ghosts for
 * elements that aren't visible at the current time) is drawn separately, on
 * its own layer, and never reaches the render.
 */

import * as Store from "./store.js";
import { fetchJson } from "./net.js";

const Engine = window.SceneEngine;
const View = window.SceneView;

let map = null;
let stage = null;
let preset = null;
let presets = null;
let basemapData = null;
let handleLayer = null;
let elements = {};

/**
 * The preview is letterboxed to the scene's aspect ratio, so the framing you
 * compose is the framing that renders. Editing at a different shape than the
 * output is how pins end up cropped out of the final video.
 */
function applyAspect(aspect) {
  const frame = elements.frame;
  const wrap = elements.wrap;
  const ratio = aspect === "9:16" ? 9 / 16 : 16 / 9;
  const availW = wrap.clientWidth - 32;
  const availH = wrap.clientHeight - 32;
  let w = availW;
  let h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  frame.style.width = Math.round(w) + "px";
  frame.style.height = Math.round(h) + "px";
  if (map) map.resize();
}

export async function init(els, options) {
  elements = els;
  presets = options.presets;
  preset = presets[Store.getScene().style] || presets["dark-navy"];

  applyAspect(Store.getScene().aspect);
  window.addEventListener("resize", () => applyAspect(Store.getScene().aspect));

  map = new EqualEarthMap({
    container: elements.map,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: "bg", type: "background", paint: { "background-color": preset.background } }],
    },
    center: [79.5, 22.5],
    zoom: 3,
    // Unlike the render page, this one is fully interactive — panning and
    // zooming around while composing is the whole point.
    interactive: true,
    attributionControl: false,
    fadeDuration: 0,
    preserveDrawingBuffer: true,
  });

  window.__builderMap = map; // debug convenience, mirrors map.html's window.__map
  await new Promise((resolve) => map.on("load", resolve));

  basemapData = await Promise.all([
    fetchJson("/data/land.geo.json"),
    fetchJson("/data/countries.geo.json"),
    fetchJson("/data/graticule.geo.json"),
    // Used automatically whenever it's been built locally (npm run
    // build-terrain) — absent otherwise, with no per-scene flag to set.
    fetch("/data/terrain/bounds.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => (b ? { url: "/data/terrain/relief.jpg", coordinates: b.coordinates } : null))
      .catch(() => null),
  ]).then(([land, countries, graticule, terrain]) => ({ land, countries, graticule, terrain }));
  basemapData.terrainOpacity = Store.getScene().terrainOpacity;

  View.installBasemap(map, preset, basemapData);

  stage = View.createStage({
    map,
    overlay: elements.overlay,
    routeSvg: elements.routeSvg,
    preset,
    scene: Store.getScene(),
  });

  handleLayer = elements.handles;

  map.on("click", onMapClick);
  map.on("mousemove", onMapMove);
  // Keep everything glued to the map while the user pans or zooms manually:
  // the painted pins/routes/titles (via stage.setFrame — moveCamera:false so
  // this never fights the drag itself) and the selection handles. Without
  // this, only the handles used to move; the actual overlays stayed put at
  // their old screen position while the map slid out from under them.
  map.on("move", () => {
    if (stage) stage.setFrame(Store.getState().time, { moveCamera: false });
    drawHandles();
  });

  installHandleDragging();

  Store.subscribe((state, reason) => {
    if (reason === "load" || reason === "scene" || reason === "undo" || reason === "redo") {
      const scene = state.scene;
      const nextPreset = presets[scene.style] || presets["dark-navy"];
      if (nextPreset !== preset) {
        preset = nextPreset;
        elements.frame.style.background = preset.background;
        View.applyPresetToBasemap(map, preset);
        stage.setPreset(preset);
      }
      stage.setScene(scene);
      applyAspect(scene.aspect);
    }
    render();
  });

  elements.frame.style.background = preset.background;
  render();
  return { map };
}

/**
 * Paints the scene at the playhead.
 *
 * `followCamera` is off while the user is dragging the map: pinning the
 * camera to the timeline would fight them for control of the viewport.
 */
let followCamera = true;
export function setFollowCamera(on) {
  followCamera = on;
  render();
}
export function isFollowingCamera() { return followCamera; }

export function render() {
  if (!stage) return;
  const state = Store.getState();
  stage.setFrame(state.time, { moveCamera: followCamera && state.scene.camera.length > 0 });
  drawHandles();
}

export function getMap() { return map; }

/** Where the camera is looking right now — used by "add keyframe here". */
export function currentView() {
  return {
    center: [round(map.getCenter().lng, 4), round(map.getCenter().lat, 4)],
    zoom: round(map.getZoom(), 2),
    bearing: round(map.getBearing(), 1),
    pitch: round(map.getPitch(), 1),
  };
}

function round(n, p) { const m = Math.pow(10, p); return Math.round(n * m) / m; }

/** Point the map at a keyframe so it can be adjusted by eye. */
export function jumpToKeyframe(kf) {
  map.jumpTo({ center: kf.center, zoom: kf.zoom, bearing: kf.bearing, pitch: kf.pitch });
  drawHandles();
}

// ------------------------------------------------------------ click tools
const clickHandlers = [];
export function onCanvasClick(fn) { clickHandlers.push(fn); }

function onMapClick(e) {
  const lngLat = [round(e.lngLat.lng, 4), round(e.lngLat.lat, 4)];
  for (const fn of clickHandlers) {
    if (fn(lngLat, e) === true) return;   // handled by the active tool
  }
}

function onMapMove(e) {
  if (elements.readout) {
    elements.readout.textContent = `${e.lngLat.lng.toFixed(3)}, ${e.lngLat.lat.toFixed(3)}`;
  }
  const tool = Store.getState().tool;
  elements.frame.classList.toggle("tool-active", tool !== "select");
}

// --------------------------------------------------------------- handles
/**
 * Draws the editor's own handles over the preview: the selected pin, the
 * endpoints and `via` control point of the selected route, and a ghost for
 * anything selected that isn't visible at the current time (otherwise
 * selecting a pin that hasn't appeared yet looks like nothing happened).
 */
/**
 * The polygon being drawn by the "zoneShape" tool, before it's committed to
 * the scene: a dashed outline connecting the points placed so far, plus a
 * small marker at each one. Lives in the handle layer like everything else
 * editor-only, and redraws automatically — every store change (including a
 * click adding a point) already triggers render() -> drawHandles().
 */
function drawZoneShapeInProgress() {
  const state = Store.getState();
  if (state.tool !== "zoneShape" || !state.toolState || !state.toolState.points.length) return;
  const points = state.toolState.points;

  if (points.length > 1) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "zone-shape-preview");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = points.map((pt, i) => {
      const p = map.project(pt);
      return (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1);
    }).join(" ");
    path.setAttribute("d", d);
    svg.appendChild(path);
    handleLayer.appendChild(svg);
  }

  points.forEach(function (pt) {
    const p = map.project(pt);
    const dot = document.createElement("div");
    dot.className = "zone-shape-point";
    dot.style.left = p.x + "px";
    dot.style.top = p.y + "px";
    handleLayer.appendChild(dot);
  });
}

function drawHandles() {
  syncTitleSelection();
  if (!handleLayer || !map) return;
  handleLayer.innerHTML = "";
  drawZoneShapeInProgress();

  const selected = Store.getSelected();
  if (!selected) return;
  const { kind, element } = selected;

  if (kind === "pin") {
    addHandle(element.center, "pin-handle", { kind: "pin", id: element.id, role: "center" }, element.label || "pin");
  } else if (kind === "route") {
    addHandle(element.from, "route-handle", { kind: "route", id: element.id, role: "from" }, "from");
    addHandle(element.to, "route-handle", { kind: "route", id: element.id, role: "to" }, "to");

    // The via handle sits on the curve's midpoint, whether it's explicit or
    // not — grabbing the implied midpoint is how you bend a straight route.
    const path = Engine.sampleRoute(element.from, element.to, 64, element.curve, element.via, element.bulge);
    const mid = element.via || path[32];
    addHandle(mid, "via-handle" + (element.via ? " via-set" : ""), { kind: "route", id: element.id, role: "via" },
      element.via ? "via" : "bend");
  } else if (kind === "camera") {
    addHandle(element.center, "camera-handle", { kind: "camera", id: element.id, role: "center" }, "t=" + element.t);
  } else if (kind === "zone" && element.shape === "polygon") {
    // One handle per vertex — a polygon has no single "radius" to grab,
    // its shape *is* its points.
    element.points.forEach(function (pt, i) {
      addHandle(pt, "zone-handle", { kind: "zone", id: element.id, role: "point" + i }, "");
    });
  } else if (kind === "zone") {
    addHandle(element.center, "zone-handle", { kind: "zone", id: element.id, role: "center" }, element.label || "zone");
    // The radius handle sits on the circle's northernmost point — drag it
    // toward or away from the centre to resize.
    var edge = Engine.zoneCircle(element.center, element.radius, 4)[0];
    addHandle(edge, "zone-handle zone-radius-handle", { kind: "zone", id: element.id, role: "radius" }, Math.round(element.radius) + " km");
  }
}

/** Toggles the dashed outline on whichever title card is currently selected. */
function syncTitleSelection() {
  if (!elements.overlay) return;
  const selected = Store.getSelected();
  elements.overlay.querySelectorAll(".title-card").forEach((el) => {
    const isSelected = selected && selected.kind === "title" && el.dataset.elementId === selected.element.id;
    el.classList.toggle("title-selected", !!isSelected);
  });
  bringSelectedToFront(selected);
}

/**
 * Re-appends the selected pin or title as the last child of #overlay, so it
 * paints on top of anything it was stacked underneath — cycling selection
 * (see installOverlayInteraction) picks an obscured element out of a stack,
 * and this is what makes it visible and directly clickable/draggable
 * afterwards, rather than merely selected-but-still-hidden.
 *
 * Purely a builder-editing convenience: it reorders DOM nodes the editor
 * itself created, never the scene data, and has no effect on the render —
 * scene-view.js rebuilds the overlay from the scene's own array order every
 * time setScene runs.
 */
function bringSelectedToFront(selected) {
  if (!selected || (selected.kind !== "pin" && selected.kind !== "title")) return;
  const selector = selected.kind === "pin" ? ".pin" : ".title-card";
  const el = elements.overlay.querySelector(`${selector}[data-element-id="${cssEscape(selected.element.id)}"]`);
  if (el) elements.overlay.appendChild(el);
}

function cssEscape(id) {
  return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
}

function addHandle(lngLat, className, meta, label) {
  const p = map.project(lngLat);
  const el = document.createElement("div");
  el.className = "handle " + className;
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
  el.dataset.kind = meta.kind;
  el.dataset.id = meta.id;
  el.dataset.role = meta.role;
  if (label) {
    const tag = document.createElement("span");
    tag.className = "handle-label";
    tag.textContent = label;
    el.appendChild(tag);
  }
  handleLayer.appendChild(el);
}

function installHandleDragging() {
  let dragging = null;

  handleLayer.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".handle");
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    handleLayer.setPointerCapture(e.pointerId);
    dragging = { kind: handle.dataset.kind, id: handle.dataset.id, role: handle.dataset.role };
    Store.beginInteraction("drag handle");
    // Dragging a handle must not also pan the map underneath it.
    map.dragPan.disable();
  });

  handleLayer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = elements.frame.getBoundingClientRect();
    const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    const coord = [round(lngLat.lng, 4), round(lngLat.lat, 4)];

    if (dragging.kind === "pin") {
      Store.updateElement("pin", dragging.id, { center: coord });
    } else if (dragging.kind === "camera") {
      Store.updateElement("camera", dragging.id, { center: coord });
    } else if (dragging.kind === "route") {
      if (dragging.role === "from") Store.updateElement("route", dragging.id, { from: coord });
      else if (dragging.role === "to") Store.updateElement("route", dragging.id, { to: coord });
      else Store.updateElement("route", dragging.id, { via: coord });
    } else if (dragging.kind === "zone") {
      if (dragging.role === "center") {
        Store.updateElement("zone", dragging.id, { center: coord });
      } else if (dragging.role === "radius") {
        const zone = Store.findElement("zone", dragging.id);
        if (zone) {
          const radius = Math.max(5, Math.round(Engine.distanceKm(zone.center, coord)));
          Store.updateElement("zone", dragging.id, { radius });
        }
      } else if (dragging.role.startsWith("point")) {
        const zone = Store.findElement("zone", dragging.id);
        const index = Number(dragging.role.slice(5));
        if (zone && zone.points) {
          const points = zone.points.slice();
          points[index] = coord;
          Store.updateElement("zone", dragging.id, { points });
        }
      }
    }
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = null;
    Store.endInteraction();
    map.dragPan.enable();
    try { handleLayer.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };
  handleLayer.addEventListener("pointerup", finish);
  handleLayer.addEventListener("pointercancel", finish);
}

/**
 * Selecting and (for titles) dragging elements painted directly on the
 * canvas — pins and title cards.
 *
 * The tricky part is overlap: two pins placed close together, or two titles
 * both anchored "bottom-left", occupy the same screen pixels. The browser's
 * normal hit-testing only ever gives you the topmost one, which makes
 * anything underneath unreachable by clicking. `elementsFromPoint` returns
 * the whole stack at a point, so a click that lands on the same spot as the
 * previous one cycles to the next element down instead of reselecting the
 * same top one every time.
 */
export function installOverlaySelection() {
  installOverlayInteraction();
}

let lastPick = null; // { x, y, ids: [{kind,id}], picked: {kind,id} }
const PICK_TOLERANCE = 4; // px — how close a click has to land to count as "the same spot"
const pickKey = (p) => p.kind + ":" + p.id;

function installOverlayInteraction() {
  let dragging = null; // set only when the picked element is a title

  elements.overlay.addEventListener("pointerdown", (e) => {
    const stack = pickableStackAt(e.clientX, e.clientY);
    if (!stack.length) { lastPick = null; return; }

    const samePlace = lastPick
      && Math.abs(e.clientX - lastPick.x) <= PICK_TOLERANCE
      && Math.abs(e.clientY - lastPick.y) <= PICK_TOLERANCE
      && sameStack(stack, lastPick.ids);

    let picked;
    if (samePlace) {
      // Advance through a stable, paint-order-independent cycle. Selecting
      // an element brings it to the front (see bringSelectedToFront), which
      // would otherwise scramble a cycle based on the live DOM order —
      // sorting by identity keeps it deterministic and guarantees every
      // element in the stack gets reached exactly once per lap.
      const sorted = stack.slice().sort((a, b) => pickKey(a).localeCompare(pickKey(b)));
      const at = sorted.findIndex((p) => pickKey(p) === pickKey(lastPick.picked));
      picked = sorted[(at + 1) % sorted.length];
    } else {
      // A fresh click (new spot, or the same spot after clicking elsewhere)
      // takes the natural, topmost element.
      picked = stack[0];
    }
    lastPick = { x: e.clientX, y: e.clientY, ids: stack, picked };

    Store.select(picked.kind, picked.id);

    if (picked.kind === "title") {
      e.preventDefault();
      elements.overlay.setPointerCapture(e.pointerId);
      dragging = { id: picked.id };
      Store.beginInteraction("drag title");
      // Dragging text must not also pan the map underneath it.
      map.dragPan.disable();
    }
    // Pins aren't dragged directly here — their handle (in the separate
    // handle layer, unaffected by overlay stacking) does that, and it's
    // already pointed at whichever pin selection just landed on.
  });

  elements.overlay.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = elements.frame.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    Store.updateElement("title", dragging.id, {
      position: "custom",
      x: round(x, 4),
      y: round(y, 4),
    });
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = null;
    Store.endInteraction();
    map.dragPan.enable();
    try { elements.overlay.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };
  elements.overlay.addEventListener("pointerup", finish);
  elements.overlay.addEventListener("pointercancel", finish);
}

/** Every selectable overlay element at a point, topmost first. */
function pickableStackAt(x, y) {
  const stack = document.elementsFromPoint(x, y);
  const picks = [];
  stack.forEach((el) => {
    if (!elements.overlay.contains(el)) return;
    if (el.classList.contains("pin") && el.dataset.elementId) picks.push({ kind: "pin", id: el.dataset.elementId });
    else if (el.classList.contains("title-card") && el.dataset.elementId) picks.push({ kind: "title", id: el.dataset.elementId });
  });
  return picks;
}

function sameStack(a, b) {
  // Order-independent: bringSelectedToFront changes DOM paint order between
  // clicks (that's its whole job), so "is this still the same spot" has to
  // be about which elements are present, not what order they paint in.
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(pickKey));
  return b.every((p) => keys.has(pickKey(p)));
}

function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

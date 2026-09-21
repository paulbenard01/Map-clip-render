/**
 * The editing canvas: an interactive MapLibre map with the scene painted on
 * top by lib/scene-view.js — the same painter the render page uses, so what
 * you see here is what gets captured.
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

  map = new maplibregl.Map({
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

  await new Promise((resolve) => map.on("load", resolve));

  basemapData = await Promise.all([
    fetchJson("/data/land.geo.json"),
    fetchJson("/data/countries.geo.json"),
    fetchJson("/data/graticule.geo.json"),
  ]).then(([land, countries, graticule]) => ({ land, countries, graticule }));

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
  // Keep handles glued to the map while the user pans or zooms manually.
  map.on("move", () => drawHandles());

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
function drawHandles() {
  if (!handleLayer || !map) return;
  handleLayer.innerHTML = "";

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
  }
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

/** Clicking a painted pin in the preview selects it. */
export function installOverlaySelection() {
  elements.overlay.addEventListener("pointerdown", (e) => {
    const pin = e.target.closest(".pin");
    if (!pin || !pin.dataset.elementId) return;
    Store.select("pin", pin.dataset.elementId);
  });
}

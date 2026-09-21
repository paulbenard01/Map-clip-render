/**
 * Canvas tools: the click-to-place behaviours.
 *
 * Each tool takes over canvas clicks while it's active and hands control
 * back when it's done. The radiate tool is the interesting one — it's pure
 * authoring convenience, creating several ordinary route entries with
 * staggered start times rather than introducing any new scene primitive.
 */

import * as Store from "./store.js";
import * as Canvas from "./canvas.js";

const Engine = window.SceneEngine;

let statusEl = null;

export function init(elements) {
  statusEl = elements.toolStatus;
  Canvas.onCanvasClick(handleClick);
  Store.subscribe((state, reason) => { if (reason === "tool") updateStatus(); });
  updateStatus();
}

function handleClick(lngLat) {
  const state = Store.getState();
  const t = state.time;

  if (state.tool === "pin") {
    Store.addElement("pin", {
      id: Store.nextId("pin"),
      center: lngLat,
      at: round(t, 2),
      until: null,
      label: null,
      size: Engine.DEFAULTS.pinSize,
      style: "circle",
    });
    Store.setTool("select");
    return true;
  }

  if (state.tool === "camera") {
    const view = Canvas.currentView();
    Store.addElement("camera", {
      id: Store.nextId("cam"),
      t: round(t, 2),
      center: lngLat,
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
      transition: "ease",
    });
    Store.setTool("select");
    return true;
  }

  if (state.tool === "route") {
    const pending = state.toolState;
    if (!pending) {
      Store.setToolState({ from: lngLat });
      return true;
    }
    Store.addElement("route", {
      id: Store.nextId("route"),
      from: pending.from,
      to: lngLat,
      startAt: round(t, 2),
      drawDuration: 2.4,
      until: null,
      curve: "arc",
    });
    Store.setTool("select");
    return true;
  }

  if (state.tool === "radiate") {
    const pending = state.toolState;
    if (!pending) {
      // First click sets the origin every route will share.
      Store.setToolState({ from: lngLat, count: 0 });
      return true;
    }
    const index = pending.count;
    Store.addElement("route", {
      id: Store.nextId("spoke"),
      from: pending.from,
      to: lngLat,
      // Staggered so they draw on in sequence rather than all at once.
      startAt: round(t + index * 0.4, 2),
      drawDuration: 2.2,
      until: null,
      curve: "arc",
      arrowEnd: true,
    });
    Store.setToolState({ from: pending.from, count: index + 1 });
    return true;
  }

  return false;
}

function updateStatus() {
  const { tool, toolState } = Store.getState();
  const messages = {
    select: "",
    pin: "Click the map to drop a pin.",
    camera: "Frame the shot by panning and zooming, then click to place the keyframe.",
    route: toolState ? "Now click the destination." : "Click the route's starting point.",
    radiate: toolState
      ? `Click each destination in turn — ${toolState.count} added. Press Esc or pick another tool when done.`
      : "Click the origin all the routes will share.",
  };
  statusEl.textContent = messages[tool] || "";
  statusEl.classList.toggle("active", tool !== "select");
}

function round(n, p) { const m = Math.pow(10, p); return Math.round(n * m) / m; }

/** Two keyframes, same place, different bearing — that's all an orbit is. */
export function addOrbit(seconds, degrees) {
  const state = Store.getState();
  const scene = state.scene;
  const t = state.time;

  // Orbit from wherever the camera is now: an existing keyframe at the
  // playhead if there is one, otherwise the live view.
  const existing = scene.camera.find((k) => Math.abs(k.t - t) < 0.05);
  const base = existing || Object.assign({ id: Store.nextId("cam"), t: round(t, 2), transition: "ease" }, Canvas.currentView());

  Store.update((draft) => {
    if (!existing) draft.camera.push(base);
    draft.camera.push({
      id: "cam-orbit-" + Date.now().toString(36),
      t: round(base.t + seconds, 2),
      center: base.center,
      zoom: base.zoom,
      bearing: round((base.bearing || 0) + degrees, 2),
      pitch: base.pitch || 0,
      transition: "ease",
    });
  });
}

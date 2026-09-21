/**
 * The storyboard: one track per element type, blocks positioned and sized by
 * their time range, a draggable playhead.
 *
 * Dragging is for rough placement — grab a block to move its start, grab an
 * edge to resize. The inspector is for exact values. Both edit the same
 * scene, so a rough drag followed by a typed number is the normal workflow.
 */

import * as Store from "./store.js";

const Engine = window.SceneEngine;

const TRACKS = [
  { key: "camera", label: "Camera", kind: "camera" },
  { key: "pins", label: "Pins", kind: "pin" },
  { key: "routes", label: "Routes", kind: "route" },
  { key: "highlights", label: "Countries", kind: "highlight" },
  { key: "titles", label: "Titles", kind: "title" },
];

let root = null;
let lanesEl = null;
let rulerEl = null;
let playheadEl = null;
let onSeek = null;

export function init(elements, opts) {
  root = elements.timeline;
  lanesEl = elements.lanes;
  rulerEl = elements.ruler;
  playheadEl = elements.playhead;
  onSeek = opts.onSeek;

  installScrubbing();
  Store.subscribe(() => render());
  window.addEventListener("resize", () => render());
  render();
}

function duration() {
  return Math.max(1, Engine.computeDuration(Store.getScene()));
}

function pxPerSecond() {
  const width = lanesEl.clientWidth || 1;
  return width / duration();
}

function timeToX(t) { return t * pxPerSecond(); }
function xToTime(x) { return x / pxPerSecond(); }

export function render() {
  if (!root) return;
  renderRuler();
  renderLanes();
  renderPlayhead();
}

function renderRuler() {
  const dur = duration();
  // Aim for a tick roughly every 80px, snapped to a sensible interval.
  const target = 80 / pxPerSecond();
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = steps.find((s) => s >= target) || 60;

  rulerEl.innerHTML = "";
  for (let t = 0; t <= dur + 1e-9; t += step) {
    const tick = document.createElement("div");
    tick.className = "tl-tick";
    tick.style.left = timeToX(t) + "px";
    tick.textContent = formatTime(t);
    rulerEl.appendChild(tick);
  }
}

function formatTime(t) {
  if (t >= 60) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(s % 1 ? 1 : 0).padStart(s < 10 ? 2 : 0, "0")}`;
  }
  return (Math.round(t * 10) / 10) + "s";
}

function renderLanes() {
  const scene = Store.getScene();
  const blocks = Engine.timelineBlocks(scene);
  const selection = Store.getState().selection;

  lanesEl.innerHTML = "";
  TRACKS.forEach((track) => {
    const lane = document.createElement("div");
    lane.className = "tl-lane";
    lane.dataset.track = track.key;

    blocks.filter((b) => b.track === track.key).forEach((block) => {
      lane.appendChild(renderBlock(block, track, selection));
    });

    lanesEl.appendChild(lane);
  });
}

function renderBlock(block, track, selection) {
  const el = document.createElement("div");
  const selected = selection && selection.kind === block.kind && selection.id === block.id;
  el.className = "tl-block tl-" + track.key + (selected ? " selected" : "") + (block.point ? " point" : "");
  el.dataset.kind = block.kind;
  el.dataset.id = block.id;

  if (block.point) {
    // Camera keyframes are instants, not spans — drawn as diamonds.
    el.style.left = timeToX(block.start) + "px";
    el.title = `Keyframe at ${block.start}s`;
    const dot = document.createElement("span");
    dot.className = "tl-diamond";
    el.appendChild(dot);
    const label = document.createElement("span");
    label.className = "tl-point-label";
    label.textContent = block.label;
    el.appendChild(label);
    return el;
  }

  const left = timeToX(block.start);
  const width = Math.max(10, timeToX(block.end) - left);
  el.style.left = left + "px";
  el.style.width = width + "px";
  if (block.openEnded) el.classList.add("open-ended");

  // Routes show how much of their span is the draw-on, as a lighter portion.
  if (block.drawEnd != null && block.drawEnd > block.start) {
    const draw = document.createElement("div");
    draw.className = "tl-draw";
    draw.style.width = Math.min(width, timeToX(block.drawEnd) - left) + "px";
    el.appendChild(draw);
  }

  const label = document.createElement("span");
  label.className = "tl-label";
  label.textContent = block.label;
  el.appendChild(label);

  const leftHandle = document.createElement("span");
  leftHandle.className = "tl-resize tl-resize-l";
  el.appendChild(leftHandle);
  const rightHandle = document.createElement("span");
  rightHandle.className = "tl-resize tl-resize-r";
  el.appendChild(rightHandle);

  return el;
}

function renderPlayhead() {
  const t = Store.getState().time;
  playheadEl.style.left = timeToX(t) + "px";
  playheadEl.dataset.time = t.toFixed(2) + "s";
}

// ------------------------------------------------------------- interaction
function installScrubbing() {
  let scrubbing = false;

  const seekFromEvent = (e) => {
    const rect = lanesEl.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration(), xToTime(e.clientX - rect.left))));
  };

  rulerEl.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    rulerEl.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  rulerEl.addEventListener("pointermove", (e) => { if (scrubbing) seekFromEvent(e); });
  const stop = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    try { rulerEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  rulerEl.addEventListener("pointerup", stop);
  rulerEl.addEventListener("pointercancel", stop);

  installBlockDragging();
}

function installBlockDragging() {
  let drag = null;

  lanesEl.addEventListener("pointerdown", (e) => {
    const blockEl = e.target.closest(".tl-block");
    if (!blockEl) {
      // Clicking empty track space scrubs, which is what an editor does.
      const rect = lanesEl.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(duration(), xToTime(e.clientX - rect.left))));
      return;
    }

    const kind = blockEl.dataset.kind;
    const id = blockEl.dataset.id;
    Store.select(kind, id);

    const mode = e.target.classList.contains("tl-resize-l") ? "resize-start"
      : e.target.classList.contains("tl-resize-r") ? "resize-end"
      : "move";

    const element = Store.findElement(kind, id);
    if (!element) return;

    lanesEl.setPointerCapture(e.pointerId);
    drag = {
      kind, id, mode,
      startX: e.clientX,
      original: JSON.parse(JSON.stringify(element)),
      moved: false,
    };
  });

  lanesEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dt = xToTime(e.clientX - drag.startX);
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) < 3) return;   // ignore a click's jitter
      drag.moved = true;
      Store.beginInteraction("timeline drag");
    }
    applyDrag(drag, dt);
  });

  const stop = (e) => {
    if (!drag) return;
    if (drag.moved) Store.endInteraction();
    drag = null;
    try { lanesEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  lanesEl.addEventListener("pointerup", stop);
  lanesEl.addEventListener("pointercancel", stop);
}

const SNAP = 0.05;   // round drags to 50ms; the inspector is for finer than that
function snap(t) { return Math.max(0, Math.round(t / SNAP) * SNAP); }

function applyDrag(drag, dt) {
  const o = drag.original;
  const dur = duration();

  if (drag.kind === "camera") {
    Store.updateElement("camera", drag.id, { t: snap(o.t + dt) });
    return;
  }

  if (drag.kind === "route") {
    if (drag.mode === "move") {
      const changes = { startAt: snap(o.startAt + dt) };
      if (o.until != null) changes.until = snap(o.until + dt);
      Store.updateElement("route", drag.id, changes);
    } else if (drag.mode === "resize-start") {
      // Moving the start keeps the end put, so the visible span shrinks.
      const startAt = Math.min(snap(o.startAt + dt), (o.until == null ? dur : o.until) - 0.1);
      Store.updateElement("route", drag.id, { startAt: Math.max(0, startAt) });
    } else {
      // The right edge is the route's `until`; dragging it past the end of
      // the clip means "leave it up", which is what null encodes.
      const until = snap((o.until == null ? dur : o.until) + dt);
      Store.updateElement("route", drag.id, {
        until: until >= dur - 0.05 ? null : Math.max(o.startAt + 0.1, until),
      });
    }
    return;
  }

  // pins, titles, highlights all share at/until
  const at = o.at;
  const until = o.until == null ? dur : o.until;

  if (drag.mode === "move") {
    const changes = { at: snap(at + dt) };
    if (o.until != null) changes.until = snap(until + dt);
    Store.updateElement(drag.kind, drag.id, changes);
  } else if (drag.mode === "resize-start") {
    Store.updateElement(drag.kind, drag.id, { at: Math.max(0, Math.min(snap(at + dt), until - 0.1)) });
  } else {
    const nextUntil = snap(until + dt);
    Store.updateElement(drag.kind, drag.id, {
      until: nextUntil >= dur - 0.05 ? null : Math.max(at + 0.1, nextUntil),
    });
  }
}

/**
 * Wires the builder together: toolbar actions, playback, import/export,
 * keyboard shortcuts.
 */

import * as Store from "./store.js";
import * as Canvas from "./canvas.js";
import * as Timeline from "./timeline.js";
import * as Inspector from "./inspector.js";
import * as Tools from "./tools.js";
import * as RenderClient from "./render-client.js";
import { TEMPLATES } from "./templates.js";
import { uploadFile } from "./inspector.js";
import { fetchJson } from "./net.js";

const Engine = window.SceneEngine;

const $ = (sel) => document.querySelector(sel);
let presets = null;

async function boot() {
  presets = await fetchJson("/styles/presets.json");

  const elements = {
    map: $("#map"),
    frame: $("#canvasFrame"),
    wrap: $("#canvasWrap"),
    overlay: $("#overlay"),
    routeSvg: $("#routeSvg"),
    handles: $("#handles"),
    readout: $("#coordReadout"),
    timeline: $("#timeline"),
    lanes: $("#tlLanes"),
    ruler: $("#tlRuler"),
    playhead: $("#tlPlayhead"),
    trackNames: $("#tlTrackNames"),
    inspector: $("#inspector"),
    toolStatus: $("#toolStatus"),
    renderPanel: $("#renderPanel"),
    timelineResizeHandle: $("#timelineResizeHandle"),
  };

  populateStylePicker();
  Store.loadScene(startingScene());

  await Canvas.init(elements, { presets });
  Canvas.installOverlaySelection();
  Timeline.init(elements, { onSeek: (t) => { stopPlayback(); Store.setTime(t); } });
  Inspector.init(elements, { presets });
  Tools.init(elements);
  RenderClient.init(elements);

  // Tells the inline guard in builder.html that startup got this far.
  window.__builderBooted = true;

  wireToolbar();
  wirePlayback();
  wireKeyboard();
  wireDropTarget(elements.frame);
  wireTimelineResize(elements.timelineResizeHandle);
  applyLayoutMode();
  refreshMeta();
  refreshSceneList();

  Store.subscribe((state, reason) => {
    if (reason !== "time") applyLayoutMode();
  });

  Store.subscribe((state, reason) => {
    if (reason !== "time") refreshMeta();
  });
}

/** A new session opens on the example scene, so there's something to press play on. */
function startingScene() {
  return {
    schemaVersion: 2,
    name: "untitled",
    aspect: "9:16",
    style: "dark-navy",
    fps: 30,
    duration: 12,
    camera: [
      { t: 0, center: [79.5, 22.5], zoom: 3.4 },
      { t: 4, center: [79.5, 22.5], zoom: 5 },
      { t: 11, center: [79.5, 22.5], zoom: 5 },
    ],
    pins: [], routes: [], titles: [], countryHighlights: [],
  };
}

// ------------------------------------------------------------- toolbar
function populateStylePicker() {
  const sel = $("#stylePicker");
  Object.keys(presets).forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    opt.title = presets[key].description || "";
    sel.appendChild(opt);
  });
}

function wireToolbar() {
  $("#stylePicker").onchange = (e) => Store.update((d) => { d.style = e.target.value; });
  $("#aspectPicker").onchange = (e) => Store.update((d) => { d.aspect = e.target.value; });
  $("#fpsInput").onchange = (e) => Store.update((d) => { d.fps = Number(e.target.value) || 30; });
  $("#durationInput").onchange = (e) => Store.update((d) => { d.duration = Number(e.target.value) || undefined; });
  $("#projectName").onchange = (e) => Store.setProjectName(e.target.value.trim() || "untitled");

  let terrainDragging = false;
  $("#terrainOpacityInput").oninput = (e) => {
    if (!terrainDragging) { terrainDragging = true; Store.beginInteraction("terrain opacity"); }
    Store.update((d) => { d.terrainOpacity = Number(e.target.value) / 100; });
  };
  $("#terrainOpacityInput").onchange = () => {
    terrainDragging = false;
    Store.endInteraction();
  };

  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.onclick = () => {
      const tool = btn.dataset.tool;
      Store.setTool(Store.getState().tool === tool ? "select" : tool);
      syncToolButtons();
    };
  });
  Store.subscribe((s, reason) => { if (reason === "tool") syncToolButtons(); });

  $("#addTitle").onclick = () => {
    const t = Store.getState().time;
    Store.addElement("title", {
      id: Store.nextId("title"),
      text: "New text box",
      position: "bottom-left",
      at: round(t, 2),
      until: round(t + 3, 2),
    });
  };

  $("#addHighlight").onclick = () => {
    const t = Store.getState().time;
    Store.addElement("highlight", {
      id: Store.nextId("hl"),
      iso: "IND",
      at: round(t, 2),
      until: null,
      fade: 0.6,
    });
  };

  $("#addOrbit").onclick = () => Tools.addOrbit(4, 45);

  $("#undoBtn").onclick = () => Store.undo();
  $("#redoBtn").onclick = () => Store.redo();

  $("#importBtn").onclick = openImportDialog;
  $("#exportBtn").onclick = exportScene;
  $("#saveBtn").onclick = saveScene;
  $("#copyPromptBtn").onclick = copyAuthoringPrompt;

  $("#renderDraft").onclick = () => startRender(true);
  $("#renderFull").onclick = () => startRender(false);

  buildTemplateMenu();
}

function syncToolButtons() {
  const active = Store.getState().tool;
  document.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === active);
  });
}

function buildTemplateMenu() {
  const sel = $("#templatePicker");
  TEMPLATES.forEach((tpl) => {
    const opt = document.createElement("option");
    opt.value = tpl.key;
    opt.textContent = tpl.name;
    opt.title = tpl.description;
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    const tpl = TEMPLATES.find((t) => t.key === sel.value);
    sel.value = "";
    if (!tpl) return;
    if (Store.getState().dirty && !window.confirm("Replace the current scene with the " + tpl.name + " template?")) return;
    Store.loadScene(buildTemplate(tpl), { name: tpl.key, dirty: true });
    Canvas.render();
  };
}

/**
 * Templates need somewhere to point. They start on the current view so the
 * scene opens looking at wherever you'd already navigated to.
 */
function buildTemplate(tpl) {
  const here = Canvas.currentView();
  const a = { center: here.center, label: "Origin", iso: null };
  const b = { center: [here.center[0] + 12, here.center[1] - 4], label: "Destination" };
  if (tpl.key === "single-location") return tpl.build(a);
  if (tpl.key === "two-city") return tpl.build(a, b);
  return tpl.build(a, [
    { center: [here.center[0] + 14, here.center[1] + 3] },
    { center: [here.center[0] + 8, here.center[1] - 9] },
    { center: [here.center[0] - 11, here.center[1] - 2] },
  ]);
}

/**
 * 9:16 scenes are tall and narrow; centring them in the wide top row used
 * by the 16:9 layout leaves most of the window empty. Below, `body` gets
 * a class the CSS grid in styles/builder.css keys off of to rearrange
 * into a full-height preview on the left with the inspector and timeline
 * stacked in a column on the right — see the .portrait-layout rules.
 */
let lastPortrait = null;
function applyLayoutMode() {
  const isPortrait = Store.getScene().aspect === "9:16";
  if (isPortrait === lastPortrait) return;
  lastPortrait = isPortrait;
  document.body.classList.toggle("portrait-layout", isPortrait);
  // The grid track sizes just changed, which resizes the canvas's actual
  // box — let the preview re-fit to it rather than staying the old size
  // until the next window resize event.
  Canvas.handleResize();
}

function refreshMeta() {
  const scene = Store.getScene();
  const state = Store.getState();
  $("#stylePicker").value = scene.style;
  $("#aspectPicker").value = scene.aspect;
  $("#fpsInput").value = scene.fps;
  $("#durationInput").value = round(Engine.computeDuration(scene), 2);
  if ($("#terrainOpacityInput") !== document.activeElement) $("#terrainOpacityInput").value = Math.round(scene.terrainOpacity * 100);
  if ($("#projectName") !== document.activeElement) $("#projectName").value = state.projectName;
  $("#undoBtn").disabled = !Store.canUndo();
  $("#redoBtn").disabled = !Store.canRedo();
  $("#dirtyDot").classList.toggle("dirty", state.dirty);
}

// ------------------------------------------------------------- playback
let rafId = null;
let playStartedAt = 0;
let playStartedFrom = 0;

function wirePlayback() {
  $("#playBtn").onclick = togglePlayback;
  $("#stopBtn").onclick = () => { stopPlayback(); Store.setTime(0); };
  $("#followCam").onchange = (e) => Canvas.setFollowCamera(e.target.checked);
  $("#safeAreaToggle").onchange = (e) => $("#safeArea").classList.toggle("on", e.target.checked);

  Store.subscribe((state, reason) => {
    if (reason === "playing") $("#playBtn").textContent = state.playing ? "Pause" : "Play";
    if (reason === "time") $("#timeReadout").textContent = state.time.toFixed(2) + "s";
  });
}

function togglePlayback() {
  if (Store.getState().playing) return stopPlayback();

  const duration = Engine.computeDuration(Store.getScene());
  if (Store.getState().time >= duration - 0.01) Store.setTime(0);

  Store.setPlaying(true);
  playStartedAt = performance.now();
  playStartedFrom = Store.getState().time;

  // Real-time playback for scrubbing and preview. This is deliberately not
  // how the export works — the export steps frame by frame so its timing is
  // exact. Here, smooth matters more than exact.
  const tick = (now) => {
    if (!Store.getState().playing) return;
    const t = playStartedFrom + (now - playStartedAt) / 1000;
    if (t >= duration) {
      Store.setTime(duration);
      stopPlayback();
      return;
    }
    Store.setTime(t);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  Store.setPlaying(false);
}

// --------------------------------------------------------- import/export
function openImportDialog() {
  const modal = $("#importModal");
  modal.classList.add("open");
  $("#importText").value = "";
  refreshSceneList();

  $("#importClose").onclick = () => modal.classList.remove("open");
  $("#importFile").onchange = async () => {
    const file = $("#importFile").files[0];
    if (!file) return;
    applyImport(await file.text(), file.name.replace(/\.json$/, ""));
  };
  $("#importPasteBtn").onclick = () => applyImport($("#importText").value, null);
}

function applyImport(text, name) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    window.alert("That isn't valid JSON: " + err.message);
    return;
  }
  Store.loadScene(parsed, { name: name || parsed.name || "imported" });
  Canvas.render();
  Timeline.render();
  $("#importModal").classList.remove("open");
}

async function refreshSceneList() {
  const list = $("#sceneList");
  if (!list) return;
  try {
    const { scenes } = await fetch("/api/scenes").then((r) => r.json());
    list.innerHTML = "";
    if (!scenes.length) {
      list.innerHTML = '<li class="muted">No scenes in scenes/ yet.</li>';
      return;
    }
    // Grouped by subfolder, so a project's clips read as a set rather than
    // as loose files among everything else.
    const groups = new Map();
    scenes.forEach((s) => {
      const key = s.folder || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });

    Array.from(groups.keys()).sort().forEach((folder) => {
      if (folder) {
        const heading = document.createElement("li");
        heading.className = "scene-group";
        heading.textContent = folder + "/";
        list.appendChild(heading);
      }
      groups.get(folder).forEach((s) => {
        const li = document.createElement("li");
        if (folder) li.className = "scene-nested";
        const btn = document.createElement("button");
        btn.className = "btn link";
        btn.type = "button";
        btn.textContent = s.name;
        btn.onclick = async () => {
          const text = await fetch("/scenes/" + s.file).then((r) => r.text());
          // Prefer the scene's own name, so a clip in a folder still renders
          // to a clearly-named file rather than a bare "01-locate.mp4".
          applyImport(text, s.title || s.name);
        };
        li.appendChild(btn);
        li.appendChild(Object.assign(document.createElement("span"), {
          className: "muted",
          textContent: s.duration ? ` ${s.duration.toFixed(1)}s` : "",
        }));
        list.appendChild(li);
      });
    });
  } catch (err) {
    list.innerHTML = '<li class="muted">Could not list scenes.</li>';
  }
}

function exportScene() {
  const json = JSON.stringify(Engine.serializeScene(Store.getScene()), null, 2) + "\n";
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = Store.getState().projectName + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function saveScene() {
  const name = Store.getState().projectName;
  const res = await fetch("/api/scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, scene: Store.getScene() }),
  });
  const body = await res.json();
  if (!res.ok) return void window.alert("Save failed: " + (body.error || res.status));
  Store.markClean();
  flash(`Saved to ${body.saved}`);
  refreshSceneList();
}

/**
 * The scene-writing prompt, copied to the clipboard.
 *
 * There's no AI in this app on purpose. This is the bridge: paste it into a
 * Claude conversation with a description of the clip you want, then paste
 * the JSON that comes back into Import.
 */
async function copyAuthoringPrompt() {
  const text = await fetch("/docs/scene-authoring-prompt.md").then((r) => r.text());
  try {
    await navigator.clipboard.writeText(text);
    flash("Scene-writing prompt copied — paste it into a Claude chat with your description.");
  } catch (err) {
    window.prompt("Copy this prompt:", text.slice(0, 2000));
  }
}

function startRender(draft) {
  const scene = Engine.serializeScene(Store.getScene());
  RenderClient.startRender({
    scene,
    name: Store.getState().projectName,
    draft,
    ratio: scene.aspect,
    style: scene.style,
    fps: draft ? undefined : scene.fps,
  });
}

// ---------------------------------------------------- timeline resizing
const TIMELINE_H_KEY = "heritle.timelineHeight";
const TIMELINE_H_MIN = 160;
const TIMELINE_H_MAX = 640;

/**
 * Drags --timeline-h directly. Only wired up visually in the landscape
 * layout (the portrait layout hides the handle via CSS, since there the
 * timeline row is 1fr and already fills whatever's left below the
 * inspector) — dragging still works if triggered programmatically, it's
 * just not reachable there.
 */
function wireTimelineResize(handle) {
  if (!handle) return;
  const saved = Number(localStorage.getItem(TIMELINE_H_KEY));
  if (saved) setTimelineHeight(saved);

  let dragging = false;
  let startY = 0;
  let startH = 0;

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    startY = e.clientY;
    startH = currentTimelineHeight();
    handle.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // Dragging the top edge down shrinks the timeline (it's anchored to
    // the bottom of the window), so moving down is a negative delta.
    setTimelineHeight(startH - (e.clientY - startY));
  });
  ["pointerup", "pointercancel"].forEach((t) => handle.addEventListener(t, () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    localStorage.setItem(TIMELINE_H_KEY, String(currentTimelineHeight()));
  }));
}

function currentTimelineHeight() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--timeline-h")) || 300;
}

function setTimelineHeight(px) {
  const clamped = Math.max(TIMELINE_H_MIN, Math.min(TIMELINE_H_MAX, px));
  document.documentElement.style.setProperty("--timeline-h", clamped + "px");
  Canvas.handleResize();
}

// --------------------------------------------------------- drag and drop
function wireDropTarget(frame) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover"].forEach((t) => frame.addEventListener(t, (e) => {
    stop(e);
    frame.classList.add("drop-target");
  }));
  ["dragleave", "drop"].forEach((t) => frame.addEventListener(t, (e) => {
    stop(e);
    if (t === "dragleave") frame.classList.remove("drop-target");
  }));

  frame.addEventListener("drop", async (e) => {
    frame.classList.remove("drop-target");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;

    if (file.type === "application/json" || file.name.endsWith(".json")) {
      applyImport(await file.text(), file.name.replace(/\.json$/, ""));
      return;
    }
    if (!file.type.startsWith("image/")) return;

    const saved = await uploadFile(file);
    if (!saved) return;

    // Dropping a photo on the map drops a pin there holding it.
    const rect = frame.getBoundingClientRect();
    const lngLat = Canvas.getMap().unproject([e.clientX - rect.left, e.clientY - rect.top]);
    const selected = Store.getSelected();
    if (selected && selected.kind === "pin") {
      Store.updateElement("pin", selected.element.id, { image: saved.path });
    } else {
      Store.addElement("pin", {
        id: Store.nextId("pin"),
        center: [round(lngLat.lng, 4), round(lngLat.lat, 4)],
        at: round(Store.getState().time, 2),
        until: null,
        image: saved.path,
        label: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
        size: 120,
        style: "circle",
      });
    }
  });
}

// ------------------------------------------------------------- keyboard
function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? Store.redo() : Store.undo();
      Canvas.render();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveScene();
      return;
    }
    if (typing) return;

    if (e.key === " ") { e.preventDefault(); togglePlayback(); }
    else if (e.key === "Enter" && Store.getState().tool === "zoneShape") {
      e.preventDefault();
      if (Tools.finishZoneShape()) { syncToolButtons(); Canvas.render(); }
    }
    else if (e.key === "Escape") { Store.setTool("select"); syncToolButtons(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      const sel = Store.getSelected();
      if (sel) { e.preventDefault(); Store.removeElement(sel.kind, sel.element.id); }
    } else if (e.key === "ArrowLeft") { Store.setTime(Store.getState().time - (e.shiftKey ? 1 : 1 / 30)); }
    else if (e.key === "ArrowRight") { Store.setTime(Store.getState().time + (e.shiftKey ? 1 : 1 / 30)); }
  });
}

function flash(message) {
  const el = $("#flash");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
}

function round(n, p) { const m = Math.pow(10, p); return Math.round(n * m) / m; }

boot().catch((err) => {
  document.body.innerHTML =
    `<div class="boot-error">` +
    `<h1>The builder couldn't start</h1>` +
    `<pre>${String(err.message || err).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</pre>` +
    `<p>If this persists, the console window that launched the builder may have more detail.</p>` +
    `</div>`;
});

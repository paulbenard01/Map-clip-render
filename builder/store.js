/**
 * The builder's single source of truth.
 *
 * One normalised scene, one selection, one playhead time. Everything that
 * changes a scene goes through update(), which is also what makes undo work:
 * the previous scene is snapshotted before each change, so there's no
 * per-feature undo code to forget to write.
 *
 * Drags are the exception worth knowing about. Dragging a timeline block
 * fires a change per pointermove; each one shouldn't be its own undo step.
 * beginInteraction()/endInteraction() wrap a drag so the whole gesture
 * collapses into a single entry.
 */

const Engine = window.SceneEngine;

const MAX_HISTORY = 100;

const state = {
  scene: Engine.normalizeScene({ camera: [], pins: [], routes: [], titles: [], countryHighlights: [] }),
  selection: null,       // { kind: 'pin'|'route'|'camera'|'title'|'highlight', id }
  time: 0,
  playing: false,
  projectName: "untitled",
  tool: "select",        // select | pin | route | radiate | camera
  toolState: null,       // in-progress multi-click tool data
  dirty: false,
};

const listeners = new Set();
let past = [];
let future = [];
let interaction = null;  // { label, snapshot }

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function emit(reason) {
  listeners.forEach((fn) => fn(state, reason));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() { return state; }
export function getScene() { return state.scene; }

/**
 * Applies a change to the scene.
 *
 * `mutator` receives a mutable draft of the scene and either edits it in
 * place or returns a replacement. The result is re-normalised, so callers
 * can be sloppy about defaults and ids.
 */
export function update(mutator, opts) {
  opts = opts || {};
  const before = state.scene;

  const draft = clone(before);
  const returned = mutator(draft);
  const next = Engine.normalizeScene(returned === undefined ? draft : returned);

  // Inside a drag, keep only the snapshot taken when the gesture started.
  if (!interaction && !opts.skipHistory) {
    past.push(before);
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
  }

  state.scene = next;
  state.dirty = true;
  emit(opts.reason || "scene");
  return next;
}

/** Replaces the whole scene — import, template, new. Clears the history. */
export function loadScene(scene, opts) {
  opts = opts || {};
  state.scene = Engine.normalizeScene(scene);
  state.selection = null;
  state.time = 0;
  state.playing = false;
  state.projectName = opts.name || scene.name || state.projectName;
  state.dirty = !!opts.dirty;
  past = [];
  future = [];
  emit("load");
}

export function beginInteraction(label) {
  if (interaction) return;
  interaction = { label, snapshot: state.scene };
}

export function endInteraction() {
  if (!interaction) return;
  const { snapshot } = interaction;
  interaction = null;
  // Only record the gesture if it actually changed something.
  if (snapshot !== state.scene) {
    past.push(snapshot);
    if (past.length > MAX_HISTORY) past.shift();
    future = [];
    emit("history");
  }
}

export function undo() {
  if (!past.length) return false;
  future.push(state.scene);
  state.scene = past.pop();
  pruneSelection();
  emit("undo");
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(state.scene);
  state.scene = future.pop();
  pruneSelection();
  emit("redo");
  return true;
}

export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }

/** After an undo the selected element may no longer exist. */
function pruneSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (!findElement(sel.kind, sel.id)) state.selection = null;
}

export function findElement(kind, id) {
  const list = listFor(kind);
  return list ? list.find((el) => el.id === id) || null : null;
}

export function listFor(kind) {
  const s = state.scene;
  return {
    pin: s.pins,
    route: s.routes,
    camera: s.camera,
    title: s.titles,
    highlight: s.countryHighlights,
    zone: s.zones,
  }[kind] || null;
}

const PLURAL = { pin: "pins", route: "routes", camera: "camera", title: "titles", highlight: "countryHighlights", zone: "zones" };

/** Edits one element by id. Used by nearly every inspector field. */
export function updateElement(kind, id, changes, opts) {
  return update((draft) => {
    const list = draft[PLURAL[kind]];
    if (!list) return;
    const el = list.find((e) => e.id === id);
    if (el) Object.assign(el, changes);
  }, opts);
}

export function addElement(kind, element, opts) {
  update((draft) => {
    draft[PLURAL[kind]].push(element);
  }, opts);
  select(kind, element.id);
}

export function removeElement(kind, id) {
  update((draft) => {
    const list = draft[PLURAL[kind]];
    const i = list.findIndex((e) => e.id === id);
    if (i >= 0) list.splice(i, 1);
  });
  if (state.selection && state.selection.kind === kind && state.selection.id === id) {
    state.selection = null;
    emit("selection");
  }
}

export function select(kind, id) {
  const same = state.selection && state.selection.kind === kind && state.selection.id === id;
  if (same) return;
  state.selection = kind ? { kind, id } : null;
  emit("selection");
}

export function getSelected() {
  if (!state.selection) return null;
  const el = findElement(state.selection.kind, state.selection.id);
  return el ? { kind: state.selection.kind, element: el } : null;
}

export function setTime(t) {
  const duration = Engine.computeDuration(state.scene);
  const clamped = Math.max(0, Math.min(duration, t));
  if (clamped === state.time) return;
  state.time = clamped;
  emit("time");
}

export function setPlaying(playing) {
  if (state.playing === playing) return;
  state.playing = playing;
  emit("playing");
}

export function setTool(tool, toolState) {
  state.tool = tool;
  state.toolState = toolState || null;
  emit("tool");
}

export function setToolState(toolState) {
  state.toolState = toolState;
  emit("tool");
}

export function setProjectName(name) {
  state.projectName = name;
  emit("meta");
}

export function markClean() {
  state.dirty = false;
  emit("meta");
}

/** Ids only have to be unique inside a scene; readable beats random. */
export function nextId(prefix) {
  const used = new Set();
  const s = state.scene;
  [s.pins, s.routes, s.camera, s.titles, s.countryHighlights].forEach((list) => {
    list.forEach((el) => used.add(el.id));
  });
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

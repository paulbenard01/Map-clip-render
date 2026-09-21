/**
 * The inspector: precise editing for whatever's selected.
 *
 * Dragging on the canvas and the timeline is for rough placement; this panel
 * is where exact numbers get typed. Fields are built from a small descriptor
 * per element type rather than hand-written markup, so adding a schema field
 * means adding one line here.
 */

import * as Store from "./store.js";
import * as Canvas from "./canvas.js";
import { openImagePicker } from "./images.js";

const Engine = window.SceneEngine;

let root = null;
let presets = null;

export function init(elements, opts) {
  root = elements.inspector;
  presets = opts.presets;
  Store.subscribe((state, reason) => {
    // Re-rendering on every playhead tick would fight with typing.
    if (reason === "time" || reason === "playing") return;
    render();
  });
  render();
}

export function render() {
  const selected = Store.getSelected();
  root.innerHTML = "";

  if (!selected) {
    root.appendChild(el("div", { className: "insp-empty" },
      el("p", {}, "Nothing selected."),
      el("p", { className: "muted" }, "Click an element on the canvas or a block on the timeline to edit it.")
    ));
    return;
  }

  const { kind, element } = selected;
  root.appendChild(header(kind, element));

  const body = el("div", { className: "insp-body" });
  ({
    pin: pinFields,
    route: routeFields,
    camera: cameraFields,
    title: titleFields,
    highlight: highlightFields,
  })[kind](body, element);
  root.appendChild(body);

  root.appendChild(el("div", { className: "insp-actions" },
    button("Delete", () => Store.removeElement(kind, element.id), "danger")
  ));
}

function header(kind, element) {
  return el("div", { className: "insp-header" },
    el("span", { className: "insp-kind" }, kind),
    el("input", {
      className: "insp-id",
      value: element.id,
      title: "Element id — used to reference this element in the scene file",
      onchange: (e) => {
        const next = e.target.value.trim();
        if (!next || next === element.id) { e.target.value = element.id; return; }
        Store.updateElement(kind, element.id, { id: next });
        Store.select(kind, next);
      },
    })
  );
}

// ------------------------------------------------------------------ pins
function pinFields(body, pin) {
  body.appendChild(coordField("Position", pin.center, (v) => set("pin", pin, { center: v })));
  body.appendChild(timingFields("pin", pin));

  body.appendChild(textField("Label", pin.label || "", (v) => set("pin", pin, { label: v || null })));

  const imageRow = el("div", { className: "field" },
    el("label", {}, "Image"),
    el("div", { className: "image-field" },
      el("input", {
        type: "text",
        value: pin.image || "",
        placeholder: "/assets/photo.jpg",
        onchange: (e) => set("pin", pin, { image: e.target.value.trim() || null }),
      }),
      button("Find…", () => openImagePicker({
        query: pin.label || "",
        onPick: (assetPath) => set("pin", pin, { image: assetPath }),
      })),
      button("Upload…", () => uploadImage((assetPath) => set("pin", pin, { image: assetPath })))
    )
  );
  if (pin.image) {
    imageRow.appendChild(el("img", { className: "image-preview", src: pin.image, alt: "" }));
  }
  body.appendChild(imageRow);

  body.appendChild(selectField("Style", pin.style, Engine.PIN_STYLES, (v) => set("pin", pin, { style: v })));
  body.appendChild(numberField("Size (px)", pin.size, { min: 16, max: 600, step: 2 }, (v) => set("pin", pin, { size: v })));
  body.appendChild(numberField("Label size (px)", pin.labelSize, { min: 8, max: 80, step: 1 }, (v) => set("pin", pin, { labelSize: v })));

  body.appendChild(sectionLabel("Overrides", "Left blank, these follow the active style preset."));
  body.appendChild(colorField("Ring colour", pin.ringColor, presetColor("pinRing"), (v) => set("pin", pin, { ringColor: v })));
  body.appendChild(numberField("Border width (px)", pin.borderWidth == null ? "" : pin.borderWidth, { min: 0, max: 40, step: 1, allowBlank: true }, (v) => set("pin", pin, { borderWidth: v })));
}

// ---------------------------------------------------------------- routes
function routeFields(body, route) {
  body.appendChild(coordField("From", route.from, (v) => set("route", route, { from: v })));
  body.appendChild(coordField("To", route.to, (v) => set("route", route, { to: v })));

  body.appendChild(numberField("Starts at (s)", route.startAt, { min: 0, step: 0.1 }, (v) => set("route", route, { startAt: v })));
  body.appendChild(numberField("Draw duration (s)", route.drawDuration, { min: 0, step: 0.1 }, (v) => set("route", route, { drawDuration: v })));
  body.appendChild(untilField("route", route));

  body.appendChild(selectField("Curve", route.curve, Engine.ROUTE_CURVES, (v) => set("route", route, { curve: v })));
  if (route.curve === "arc") {
    body.appendChild(numberField("Bulge", route.bulge, { min: 0, max: 1, step: 0.05 }, (v) => set("route", route, { bulge: v })));
  }

  const viaRow = el("div", { className: "field" },
    el("label", {}, "Via (control point)"),
    el("div", { className: "row" },
      route.via
        ? el("span", { className: "mono" }, `${route.via[0]}, ${route.via[1]}`)
        : el("span", { className: "muted" }, "none — drag the bend handle on the canvas"),
      route.via ? button("Clear", () => set("route", route, { via: null })) : null
    )
  );
  body.appendChild(viaRow);

  body.appendChild(checkboxField("Dashed", route.dashed, (v) => set("route", route, { dashed: v })));
  body.appendChild(checkboxField("Arrowhead at destination", route.arrowEnd, (v) => set("route", route, { arrowEnd: v })));
  body.appendChild(numberField("Width (px)", route.width, { min: 1, max: 30, step: 1 }, (v) => set("route", route, { width: v })));
  body.appendChild(colorField("Colour", route.color, presetColor("routeColor"), (v) => set("route", route, { color: v })));
  body.appendChild(textField("Label", route.label || "", (v) => set("route", route, { label: v || null })));
}

// ---------------------------------------------------------------- camera
function cameraFields(body, kf) {
  body.appendChild(numberField("Time (s)", kf.t, { min: 0, step: 0.1 }, (v) => set("camera", kf, { t: v })));
  body.appendChild(coordField("Center", kf.center, (v) => set("camera", kf, { center: v })));
  body.appendChild(numberField("Zoom", kf.zoom, { min: 0, max: 22, step: 0.1 }, (v) => set("camera", kf, { zoom: v })));
  body.appendChild(numberField("Bearing (°)", kf.bearing, { min: -360, max: 360, step: 1 }, (v) => set("camera", kf, { bearing: v })));
  body.appendChild(numberField("Pitch (°)", kf.pitch, { min: 0, max: 60, step: 1 }, (v) => set("camera", kf, { pitch: v })));

  body.appendChild(selectField("Transition in", kf.transition, Engine.CAMERA_TRANSITIONS, (v) => set("camera", kf, { transition: v }),
    "How the camera arrives here from the previous keyframe."));

  body.appendChild(el("div", { className: "field" },
    el("label", {}, "From the canvas"),
    el("div", { className: "row" },
      button("Set to current view", () => set("camera", kf, Canvas.currentView())),
      button("Go to this keyframe", () => Canvas.jumpToKeyframe(kf))
    )
  ));
}

// ---------------------------------------------------------------- titles
function titleFields(body, title) {
  body.appendChild(textField("Text", title.text, (v) => set("title", title, { text: v })));
  body.appendChild(selectField("Position", title.position, Engine.TITLE_POSITIONS, (v) => set("title", title, { position: v })));
  body.appendChild(numberField("Size (px)", title.size, { min: 8, max: 120, step: 1 }, (v) => set("title", title, { size: v })));
  body.appendChild(timingFields("title", title));
}

// ------------------------------------------------------------ highlights
function highlightFields(body, hl) {
  body.appendChild(textField("Country (ISO alpha-3)", hl.iso, (v) => set("highlight", hl, { iso: v.toUpperCase() }),
    "e.g. IND, CHN, VNM — matches the id in data/countries.geo.json"));
  body.appendChild(colorField("Colour", hl.color, presetColor("landFocus"), (v) => set("highlight", hl, { color: v })));
  body.appendChild(timingFields("highlight", hl));
}

// ----------------------------------------------------------------- parts
function timingFields(kind, element) {
  const wrap = el("div", { className: "field-group" });
  wrap.appendChild(numberField("Appears at (s)", element.at, { min: 0, step: 0.1 }, (v) => set(kind, element, { at: v })));
  wrap.appendChild(untilField(kind, element));
  wrap.appendChild(numberField("Fade (s)", element.fade == null ? "" : element.fade,
    { min: 0, max: 5, step: 0.05, allowBlank: true, placeholder: "default" },
    (v) => set(kind, element, { fade: v })));
  return wrap;
}

/**
 * `until` is either a number or null, and null genuinely means "stay to the
 * end" rather than "unset" — so it gets a checkbox rather than an empty box
 * that would be ambiguous.
 */
function untilField(kind, element) {
  const open = element.until == null;
  const field = el("div", { className: "field" },
    el("label", {}, "Until (s)"),
    el("div", { className: "row" },
      el("input", {
        type: "number",
        step: "0.1",
        min: "0",
        value: open ? "" : element.until,
        disabled: open,
        onchange: (e) => set(kind, element, { until: e.target.value === "" ? null : Number(e.target.value) }),
      }),
      el("label", { className: "inline-check" },
        el("input", {
          type: "checkbox",
          checked: open,
          onchange: (e) => {
            const dur = Engine.computeDuration(Store.getScene());
            set(kind, element, { until: e.target.checked ? null : Math.min(dur, (element.at || 0) + 4) });
          },
        }),
        document.createTextNode(" to the end")
      )
    )
  );
  return field;
}

function coordField(label, value, onChange) {
  const lng = el("input", { type: "number", step: "0.0001", value: value[0], title: "longitude" });
  const lat = el("input", { type: "number", step: "0.0001", value: value[1], title: "latitude" });
  const commit = () => onChange([Number(lng.value), Number(lat.value)]);
  lng.onchange = commit;
  lat.onchange = commit;
  return el("div", { className: "field" },
    el("label", {}, label, el("span", { className: "hint" }, "lng, lat")),
    el("div", { className: "row" }, lng, lat)
  );
}

function numberField(label, value, attrs, onChange) {
  const input = el("input", {
    type: "number",
    value: value === "" ? "" : value,
    placeholder: attrs.placeholder || "",
    onchange: (e) => {
      if (attrs.allowBlank && e.target.value === "") return onChange(null);
      onChange(Number(e.target.value));
    },
  });
  if (attrs.min != null) input.min = attrs.min;
  if (attrs.max != null) input.max = attrs.max;
  if (attrs.step != null) input.step = attrs.step;
  return el("div", { className: "field" }, el("label", {}, label), input);
}

function textField(label, value, onChange, hint) {
  return el("div", { className: "field" },
    el("label", {}, label, hint ? el("span", { className: "hint" }, hint) : null),
    el("input", { type: "text", value, onchange: (e) => onChange(e.target.value) })
  );
}

function selectField(label, value, options, onChange, hint) {
  const sel = el("select", { onchange: (e) => onChange(e.target.value) });
  options.forEach((opt) => {
    const o = el("option", { value: opt }, opt);
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  });
  return el("div", { className: "field" },
    el("label", {}, label, hint ? el("span", { className: "hint" }, hint) : null),
    sel
  );
}

function checkboxField(label, checked, onChange) {
  return el("div", { className: "field field-inline" },
    el("label", { className: "inline-check" },
      el("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }),
      document.createTextNode(" " + label)
    )
  );
}

/** A colour with a "follow the preset" state, since null is meaningful. */
function colorField(label, value, fallback, onChange) {
  const picker = el("input", {
    type: "color",
    value: value || fallback || "#ffffff",
    oninput: (e) => onChange(e.target.value),
  });
  return el("div", { className: "field" },
    el("label", {}, label),
    el("div", { className: "row" },
      picker,
      value ? button("Use preset", () => onChange(null)) : el("span", { className: "muted" }, "following preset")
    )
  );
}

function sectionLabel(text, hint) {
  return el("div", { className: "insp-section" }, text, hint ? el("span", { className: "hint" }, hint) : null);
}

function presetColor(key) {
  const preset = presets[Store.getScene().style] || presets["dark-navy"];
  return preset[key];
}

function set(kind, element, changes) {
  Store.updateElement(kind, element.id, changes);
}

// --------------------------------------------------------------- uploads
export function uploadImage(onDone) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const saved = await uploadFile(file);
    if (saved) onDone(saved.path);
  };
  input.click();
}

/** Posts the raw bytes; the server writes them into assets/ and returns the path. */
export async function uploadFile(file) {
  const res = await fetch("/api/assets?filename=" + encodeURIComponent(file.name), {
    method: "POST",
    body: file,
  });
  const body = await res.json();
  if (!res.ok) {
    window.alert("Upload failed: " + (body.error || res.status));
    return null;
  }
  return body;
}

// --------------------------------------------------------- tiny DOM helper
function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v == null) return;
    if (k === "className") node.className = v;
    else if (k.startsWith("on")) node[k] = v;
    else if (k === "checked" || k === "selected" || k === "disabled") node[k] = v;
    else if (k === "value") node.value = v;
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) => {
    if (c == null) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

function button(label, onClick, className) {
  return el("button", { className: "btn " + (className || ""), onclick: onClick, type: "button" }, label);
}

export { el, button };

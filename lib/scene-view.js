/**
 * scene-view.js — turns a scene into pixels on a MapLibre map.
 *
 * Companion to scene-engine.js: the engine answers "where is everything at
 * time t", this paints that answer. Both the builder's live preview and the
 * headless page render.js screenshots use this same file, for the same reason
 * they share the engine — two implementations would drift, and the whole point
 * of the builder is that the preview tells the truth about the render.
 *
 * Deliberately DOM/SVG rather than MapLibre symbol layers: MapLibre's own text
 * rendering needs a remote font-glyph server, which would mean this tool
 * couldn't render offline. Building the text ourselves sidesteps that and
 * gives full control over the look. See README.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root.SceneEngine || (typeof require === "function" ? require("./scene-engine.js") : null));
  else root.SceneView = factory(root.SceneEngine);
})(typeof self !== "undefined" ? self : this, function (Engine) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var ROUTE_SAMPLES = 64;

  // Country/land fill fades to this opacity when the relief raster is
  // showing through underneath it — full colour would just hide the terrain.
  var TERRAIN_LAND_OPACITY = 0.35;

  /**
   * Installs the basemap sources and layers on a loaded map.
   *
   * `data` is { land, countries, graticule, terrain } as already-parsed
   * GeoJSON (plus terrain's own shape below) — the caller fetches them,
   * because the builder keeps them cached across style changes and the
   * render page loads them once at startup.
   *
   * `data.terrain`, when present, is `{ url, coordinates }` — a single
   * static relief image and its four corner coordinates (top-left,
   * top-right, bottom-right, bottom-left), built once by
   * `npm run build-terrain` and never fetched from a live tile service.
   * Optional: most scenes render without it exactly as before.
   */
  function installBasemap(map, preset, data) {
    if (data.terrain && !map.getSource("terrain")) {
      map.addSource("terrain", { type: "image", url: data.terrain.url, coordinates: data.terrain.coordinates });
      map.addLayer({ id: "terrain-raster", type: "raster", source: "terrain", paint: { "raster-opacity": 1 } });
    }
    if (!map.getSource("graticule")) {
      map.addSource("graticule", { type: "geojson", data: data.graticule });
      map.addLayer({ id: "graticule", type: "line", source: "graticule", paint: { "line-color": preset.graticule, "line-width": 1 } });
    }
    if (!map.getSource("land")) {
      map.addSource("land", { type: "geojson", data: data.land });
      map.addLayer({ id: "land-fill", type: "fill", source: "land", paint: { "fill-color": preset.land, "fill-opacity": data.terrain ? TERRAIN_LAND_OPACITY : 1 } });
    }
    if (!map.getSource("countries")) {
      map.addSource("countries", { type: "geojson", data: data.countries });
      map.addLayer({ id: "countries-fill", type: "fill", source: "countries", paint: { "fill-color": preset.land, "fill-opacity": data.terrain ? TERRAIN_LAND_OPACITY : 1 } });
      // Borders go on last so highlight fills slot in underneath them.
      map.addLayer({ id: "countries-border", type: "line", source: "countries", paint: { "line-color": preset.border, "line-width": preset.borderWidth || 0.6 } });
    }
  }

  function applyPresetToBasemap(map, preset) {
    var hasTerrain = !!map.getSource("terrain");
    if (map.getLayer("graticule")) map.setPaintProperty("graticule", "line-color", preset.graticule);
    if (map.getLayer("land-fill")) {
      map.setPaintProperty("land-fill", "fill-color", preset.land);
      map.setPaintProperty("land-fill", "fill-opacity", hasTerrain ? TERRAIN_LAND_OPACITY : 1);
    }
    if (map.getLayer("countries-fill")) {
      map.setPaintProperty("countries-fill", "fill-color", preset.land);
      map.setPaintProperty("countries-fill", "fill-opacity", hasTerrain ? TERRAIN_LAND_OPACITY : 1);
    }
    if (map.getLayer("countries-border")) {
      map.setPaintProperty("countries-border", "line-color", preset.border);
      map.setPaintProperty("countries-border", "line-width", preset.borderWidth || 0.6);
    }
  }

  /**
   * Creates the overlay stage.
   *
   *   map        a loaded maplibregl.Map
   *   overlay    the absolutely-positioned div the DOM overlays live in
   *   routeSvg   an <svg> inside that div
   *   preset     a style preset object from styles/presets.json
   */

  /** Applies (or clears) the all-caps / bold overrides on a text element. */
  function applyTextTreatment(el, def) {
    el.style.textTransform = def.caps === false ? "none" : "uppercase";
    el.style.fontWeight = def.bold === false ? "400" : "700";
  }

  /**
   * Positions a title card.
   *
   * The five named positions are CSS-anchored (a class picks a corner or the
   * centre, same as always). "custom" is free placement: x/y are normalized
   * 0..1 fractions of the frame, set by dragging the card directly on the
   * canvas. Percentages rather than pixels, so it holds up across window
   * sizes and between the editor's preview and the render page's true
   * output dimensions.
   */
  function positionTitle(el, title) {
    if (title.position === "custom") {
      el.className = "title-card pos-custom";
      el.style.left = (title.x * 100) + "%";
      el.style.top = (title.y * 100) + "%";
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.transform = "translate(-50%, -50%)";
    } else {
      el.className = "title-card pos-" + title.position;
      el.style.left = "";
      el.style.top = "";
      el.style.right = "";
      el.style.bottom = "";
      el.style.transform = "";
    }
  }

  function createStage(opts) {
    var map = opts.map;
    var overlay = opts.overlay;
    var routeSvg = opts.routeSvg;
    var preset = opts.preset;
    var scene = Engine.normalizeScene(opts.scene || {});

    var pinEls = {};       // id -> { el, def }
    var titleEls = {};     // id -> { el, def }
    var routeEls = {};     // id -> { path, arrow, labelEl, def }
    var zoneEls = {};      // id -> { labelEl, def } — labelEl only when the zone has a label
    var highlightLayers = []; // layer ids currently installed
    var zoneLayers = [];      // zone source + layer ids currently installed
    var hatchPatterns = {};   // colour -> registered MapLibre image id

    function clearOverlays() {
      Object.keys(pinEls).forEach(function (k) { pinEls[k].el.remove(); });
      Object.keys(titleEls).forEach(function (k) { titleEls[k].el.remove(); });
      Object.keys(routeEls).forEach(function (k) {
        routeEls[k].path.remove();
        if (routeEls[k].arrow) routeEls[k].arrow.remove();
        if (routeEls[k].labelEl) routeEls[k].labelEl.remove();
      });
      Object.keys(zoneEls).forEach(function (k) {
        if (zoneEls[k].labelEl) zoneEls[k].labelEl.remove();
      });
      pinEls = {}; titleEls = {}; routeEls = {}; zoneEls = {};
    }

    /**
     * A small diagonal-hatch tile in the given colour, registered with
     * MapLibre as a fill pattern. Cached per colour so switching scenes
     * (or several zones sharing a colour) doesn't regenerate or re-register
     * the same bitmap repeatedly — map.addImage throws if you add the same
     * id twice, hence the hasImage guard as well as the cache.
     */
    function ensureHatchPattern(color) {
      var id = "hatch-" + color.replace(/[^a-z0-9]/gi, "");
      if (hatchPatterns[id]) return id;
      var size = 16;
      var canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext("2d");
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "square";
      // Two parallel diagonal strokes per tile, offset so the pattern tiles
      // seamlessly — the standard "sphere of influence" cartographic hatch,
      // as distinct from a solid highlight fill.
      [-size, 0, size].forEach(function (off) {
        ctx.beginPath();
        ctx.moveTo(off, 0);
        ctx.lineTo(off + size, size);
        ctx.stroke();
      });
      var imageData = ctx.getImageData(0, 0, size, size);
      if (!map.hasImage(id)) map.addImage(id, imageData);
      hatchPatterns[id] = true;
      return id;
    }

    function rebuildZones() {
      zoneLayers.forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      zoneLayers.forEach(function (id) {
        if (map.getSource(id)) map.removeSource(id);
      });
      zoneLayers = [];

      scene.zones.forEach(function (z) {
        var color = z.color || preset.accent || preset.pinRing;
        var sourceId = "zone-src-" + z.id;
        var fillId = "zone-fill-" + z.id;
        var lineId = "zone-line-" + z.id;
        map.addSource(sourceId, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [Engine.zoneRing(z)] } },
        });
        map.addLayer({
          id: fillId, type: "fill", source: sourceId,
          paint: { "fill-pattern": ensureHatchPattern(color), "fill-opacity": 0 },
        }, map.getLayer("countries-border") ? "countries-border" : undefined);
        map.addLayer({
          id: lineId, type: "line", source: sourceId,
          paint: { "line-color": color, "line-width": 1.5, "line-dasharray": [2, 1.5], "line-opacity": 0 },
        });
        zoneLayers.push(fillId, lineId, sourceId);
      });
    }

    // ------------------------------------------------------------- pins
    function buildPin(pin) {
      var el = document.createElement("div");
      el.className = "pin pin-style-" + pin.style;
      el.dataset.elementId = pin.id;
      el.dataset.elementKind = "pin";

      var ring = pin.ringColor || preset.pinRing;
      var borderWidth = pin.borderWidth == null ? 4 : pin.borderWidth;
      var size = pin.size;

      if (pin.style === "badge") {
        // A small marker sits on the coordinate and the photo rides in a card
        // beside it — the readable option once several pins crowd together.
        var dot = document.createElement("div");
        dot.className = "pin-dot";
        dot.style.background = ring;
        dot.style.boxShadow = "0 0 0 3px " + preset.pinRingInner + ", 0 2px 10px rgba(0,0,0,0.5)";
        el.appendChild(dot);

        // The card only exists to hold a photo and/or a label — with
        // neither, appending an empty styled box just leaves a visible
        // blank rectangle floating next to the dot. A badge pin used purely
        // as an unlabelled context marker (a common way to declutter a
        // cluster of nearby sites) should render as just the dot.
        if (pin.image || pin.label) {
          var card = document.createElement("div");
          card.className = "pin-card";
          card.style.background = preset.textBacking;
          card.style.borderColor = ring;
          if (pin.image) {
            var cimg = document.createElement("img");
            cimg.className = "pin-card-photo";
            cimg.src = pin.image;
            cimg.style.width = Math.round(size * 0.55) + "px";
            cimg.style.height = Math.round(size * 0.55) + "px";
            card.appendChild(cimg);
          }
          if (pin.label) {
            var clab = document.createElement("div");
            clab.className = "pin-card-label";
            clab.textContent = pin.label;
            clab.style.color = preset.labelText;
            clab.style.fontSize = pin.labelSize + "px";
            applyTextTreatment(clab, { caps: pin.labelCaps, bold: pin.labelBold });
            card.appendChild(clab);
          }
          el.appendChild(card);
        }
        return el;
      }

      var img = document.createElement("img");
      img.className = "pin-photo";
      if (pin.image) img.src = pin.image;
      img.style.width = size + "px";
      img.style.height = size + "px";

      if (pin.style === "polaroid") {
        // Thick cream border, a couple of degrees of tilt, heavy shadow.
        img.style.border = Math.max(6, borderWidth + 4) + "px solid " + (preset.polaroidBorder || "#f2ece0");
        img.style.borderBottomWidth = Math.max(18, borderWidth + 16) + "px";
        img.style.borderRadius = "2px";
        img.style.boxShadow = "0 6px 22px rgba(0,0,0,0.6)";
        el.style.setProperty("--pin-tilt", (pin.id.charCodeAt(0) % 2 ? -2.5 : 2.5) + "deg");
      } else {
        img.style.border = borderWidth + "px solid " + ring;
        img.style.boxShadow = "0 0 0 2px " + preset.pinRingInner + ", 0 4px 18px rgba(0,0,0,0.55)";
        img.style.borderRadius =
          pin.style === "square" ? "0" :
          pin.style === "rounded-square" ? Math.round(size * 0.18) + "px" : "50%";
      }
      el.appendChild(img);

      if (pin.label) {
        var lab = document.createElement("div");
        lab.className = "pin-label";
        lab.textContent = pin.label;
        lab.style.color = preset.labelText;
        lab.style.fontSize = pin.labelSize + "px";
        applyTextTreatment(lab, { caps: pin.labelCaps, bold: pin.labelBold });
        el.appendChild(lab);
      }
      return el;
    }

    // ---------------------------------------------------------- highlights
    function rebuildHighlights() {
      highlightLayers.forEach(function (id) {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      highlightLayers = [];
      if (!map.getSource("countries")) return;

      scene.countryHighlights.forEach(function (h) {
        var layerId = "highlight-" + h.id;
        map.addLayer({
          id: layerId,
          type: "fill",
          source: "countries",
          filter: ["==", ["get", "id"], h.iso],
          paint: { "fill-color": h.color || preset.landFocus, "fill-opacity": 0 },
        }, map.getLayer("countries-border") ? "countries-border" : undefined);
        highlightLayers.push(layerId);
      });
    }

    // --------------------------------------------------------------- build
    function setScene(nextScene) {
      scene = Engine.normalizeScene(nextScene);
      clearOverlays();

      scene.pins.forEach(function (pin) {
        var el = buildPin(pin);
        overlay.appendChild(el);
        pinEls[pin.id] = { el: el, def: pin };
      });

      scene.titles.forEach(function (title) {
        var el = document.createElement("div");
        el.dataset.elementId = title.id;
        el.dataset.elementKind = "title";
        el.textContent = title.text;
        el.style.color = title.color || preset.text;
        el.style.background = preset.textBacking;
        el.style.fontSize = title.size + "px";
        applyTextTreatment(el, title);
        positionTitle(el, title);
        overlay.appendChild(el);
        titleEls[title.id] = { el: el, def: title };
      });

      scene.routes.forEach(function (route) {
        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", route.color || preset.routeColor);
        path.setAttribute("stroke-width", route.width);
        path.setAttribute("stroke-linecap", "round");
        if (route.dashed) path.setAttribute("stroke-dasharray", "10 8");
        path.dataset.elementId = route.id;
        routeSvg.appendChild(path);

        var arrow = null;
        if (route.arrowEnd) {
          arrow = document.createElementNS(SVG_NS, "path");
          arrow.setAttribute("fill", route.color || preset.routeColor);
          arrow.setAttribute("stroke", "none");
          routeSvg.appendChild(arrow);
        }

        var labelEl = null;
        if (route.label) {
          labelEl = document.createElement("div");
          labelEl.className = "route-label";
          labelEl.textContent = route.label;
          labelEl.style.color = preset.labelText;
          labelEl.style.background = preset.textBacking;
          applyTextTreatment(labelEl, { caps: route.labelCaps, bold: route.labelBold });
          overlay.appendChild(labelEl);
        }
        routeEls[route.id] = { path: path, arrow: arrow, labelEl: labelEl, def: route };
      });

      scene.zones.forEach(function (z) {
        var labelEl = null;
        if (z.label) {
          labelEl = document.createElement("div");
          labelEl.className = "zone-label";
          labelEl.textContent = z.label;
          labelEl.style.color = z.color || preset.accent || preset.labelText;
          labelEl.style.background = preset.textBacking;
          overlay.appendChild(labelEl);
        }
        zoneEls[z.id] = { labelEl: labelEl, def: z };
      });

      rebuildHighlights();
      rebuildZones();
    }

    function setPreset(nextPreset) {
      preset = nextPreset;
      applyPresetToBasemap(map, preset);
      setScene(scene);
    }

    // --------------------------------------------------------------- frame
    /**
     * Paints the scene at time t. Camera jumps straight to the interpolated
     * state — no flyTo, no animation — so a frame captured here depends only
     * on t, never on wall-clock timing or machine speed.
     */
    function setFrame(t, opts2) {
      opts2 = opts2 || {};
      if (opts2.moveCamera !== false) {
        var cam = Engine.cameraAt(scene, t);
        map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch });
      }

      // Country highlights
      Engine.countryHighlightsAt(scene, t).forEach(function (h) {
        var layerId = "highlight-" + h.id;
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, "fill-opacity", h.opacity);
      });

      // Zones (spheres of influence) — hatch fill + dashed boundary, plus
      // an optional label positioned at the zone's centre.
      Engine.zonesAt(scene, t).forEach(function (z) {
        var fillId = "zone-fill-" + z.id, lineId = "zone-line-" + z.id;
        if (map.getLayer(fillId)) map.setPaintProperty(fillId, "fill-opacity", z.opacity * Engine.DEFAULTS.zoneOpacity);
        if (map.getLayer(lineId)) map.setPaintProperty(lineId, "line-opacity", z.opacity);
        var entry = zoneEls[z.id];
        if (entry && entry.labelEl) {
          entry.labelEl.style.opacity = z.opacity;
          if (z.opacity > 0) {
            var zp = map.project(z.center);
            entry.labelEl.style.left = zp.x + "px";
            entry.labelEl.style.top = zp.y + "px";
          }
        }
      });

      // Pins
      Object.keys(pinEls).forEach(function (id) {
        var entry = pinEls[id], def = entry.def;
        var op = Engine.fadeOpacity(t, def.at, def.until, def.fade);
        entry.el.style.opacity = op;
        if (op > 0) {
          var p = map.project(def.center);
          entry.el.style.left = p.x + "px";
          entry.el.style.top = p.y + "px";
        }
      });

      // Titles
      Object.keys(titleEls).forEach(function (id) {
        var entry = titleEls[id], def = entry.def;
        entry.el.style.opacity = Engine.fadeOpacity(t, def.at, def.until, def.fade);
      });

      // Routes: reveal progressively between startAt and startAt+drawDuration.
      Object.keys(routeEls).forEach(function (id) {
        var entry = routeEls[id], def = entry.def;
        var st = Engine.routeStateAt(def, t);

        if (st.opacity <= 0) {
          entry.path.setAttribute("opacity", 0);
          if (entry.arrow) entry.arrow.setAttribute("opacity", 0);
          if (entry.labelEl) entry.labelEl.style.opacity = 0;
          return;
        }

        var full = Engine.sampleRoute(def.from, def.to, ROUTE_SAMPLES, def.curve, def.via, def.bulge);
        var upto = Math.max(1, Math.round(full.length * st.drawFrac));
        var screenPts = full.slice(0, upto).map(function (ll) { return map.project(ll); });
        entry.path.setAttribute("d", screenPts.map(function (p, i) {
          return (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1);
        }).join(" "));
        entry.path.setAttribute("opacity", st.opacity);

        if (entry.arrow) {
          // Arrowhead rides the drawing tip, so it lands exactly on the
          // destination as the line completes.
          if (screenPts.length >= 2) {
            var tip = screenPts[screenPts.length - 1];
            var prev = screenPts[screenPts.length - 2];
            entry.arrow.setAttribute("d", arrowPath(prev, tip, Math.max(7, def.width * 3)));
            entry.arrow.setAttribute("opacity", st.opacity);
          } else {
            entry.arrow.setAttribute("opacity", 0);
          }
        }

        if (entry.labelEl) {
          // Anchored to the path's fixed midpoint rather than the moving tip,
          // so it doesn't end up sitting on the destination pin.
          var mid = full[Math.floor(full.length / 2)];
          var mp = map.project(mid);
          entry.labelEl.style.left = mp.x + "px";
          entry.labelEl.style.top = (mp.y - 22) + "px";
          entry.labelEl.style.opacity = st.labelOpacity;
        }
      });

      resolveLabelOverlaps();
    }

    /**
     * Nudges overlapping text apart, vertically, so two labels never sit on
     * the same pixels and become unreadable — which nothing before this
     * prevented: a pin's own label is positioned purely by the pin's
     * coordinate, with no awareness of any other label on screen.
     *
     * Runs once per frame, after every element's natural position is set,
     * using the browser's own layout (getBoundingClientRect) rather than an
     * estimated text width, so it's exact for the actual font and string.
     * Candidates are walked in a fixed order (pins, then routes, then
     * zones, then titles, each in scene-array order) so the same scene
     * nudges the same way on every render — this has to be deterministic,
     * since it runs identically in the live preview and the frame-exact
     * capture.
     *
     * A pin's marker itself is never moved — it has to stay exactly on its
     * coordinate. Only the label text (or, for a badge pin, its card) is
     * free to drift, since that's what's actually colliding.
     */
    function resolveLabelOverlaps() {
      var placed = [];
      labelCandidates().forEach(function (c) {
        c.el.style.transform = c.base; // clear any nudge left over from a previous frame
        var r = c.el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // not actually laid out (e.g. empty text)
        var box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        var dy = 0, guard = 0;
        while (guard < 8 && placed.some(function (p) { return boxesOverlap(shiftBox(box, dy), p); })) {
          dy += (box.bottom - box.top) + 4;
          guard++;
        }
        if (dy !== 0) c.el.style.transform = (c.base ? c.base + " " : "") + "translateY(" + dy + "px)";
        placed.push(shiftBox(box, dy));
      });
    }

    function labelCandidates() {
      var visible = function (el) { return parseFloat(el.style.opacity || "0") > 0.05; };
      var out = [];
      scene.pins.forEach(function (pin) {
        var entry = pinEls[pin.id];
        if (!entry || !visible(entry.el)) return;
        var node = entry.el.querySelector(".pin-label, .pin-card");
        if (node) out.push({ el: node, base: "" });
      });
      scene.routes.forEach(function (route) {
        var entry = routeEls[route.id];
        if (!entry || !entry.labelEl || !visible(entry.labelEl)) return;
        out.push({ el: entry.labelEl, base: "translate(-50%, -50%)" });
      });
      scene.zones.forEach(function (zone) {
        var entry = zoneEls[zone.id];
        if (!entry || !entry.labelEl || !visible(entry.labelEl)) return;
        out.push({ el: entry.labelEl, base: "translate(-50%, -50%)" });
      });
      scene.titles.forEach(function (title) {
        var entry = titleEls[title.id];
        if (!entry || !visible(entry.el)) return;
        // Matches the transform each position gets from CSS/positionTitle —
        // has to be preserved under the nudge, or a centred title would
        // jump to top-left the moment it needed to move.
        var base = (title.position === "center" || title.position === "custom") ? "translate(-50%, -50%)" : "";
        out.push({ el: entry.el, base: base });
      });
      return out;
    }

    function boxesOverlap(a, b) {
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
    function shiftBox(box, dy) {
      return { top: box.top + dy, bottom: box.bottom + dy, left: box.left, right: box.right };
    }

    function arrowPath(from, to, size) {
      var dx = to.x - from.x, dy = to.y - from.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len, uy = dy / len;
      var px = -uy, py = ux;
      var baseX = to.x - ux * size, baseY = to.y - uy * size;
      var half = size * 0.5;
      return "M" + to.x.toFixed(1) + "," + to.y.toFixed(1) +
        " L" + (baseX + px * half).toFixed(1) + "," + (baseY + py * half).toFixed(1) +
        " L" + (baseX - px * half).toFixed(1) + "," + (baseY - py * half).toFixed(1) + " Z";
    }

    setScene(scene);

    return {
      setScene: setScene,
      setPreset: setPreset,
      setFrame: setFrame,
      getScene: function () { return scene; },
      pinElements: function () { return pinEls; },
      routeElements: function () { return routeEls; },
    };
  }

  return {
    installBasemap: installBasemap,
    applyPresetToBasemap: applyPresetToBasemap,
    createStage: createStage,
    ROUTE_SAMPLES: ROUTE_SAMPLES,
  };
});

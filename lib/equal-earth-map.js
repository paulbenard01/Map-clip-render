/**
 * equal-earth-map.js — a MapLibre-GL-shaped adapter backed by d3-geo and a
 * 2D canvas, instead of WebGL/Mercator.
 *
 * Implements only the slice of the maplibregl.Map API this project actually
 * calls (see lib/scene-view.js, builder/canvas.js, builder/inspector.js):
 * addSource/addLayer/removeLayer/removeSource/getLayer/getSource/
 * setPaintProperty/hasImage/addImage, project/unproject, jumpTo,
 * getCenter/getZoom/getBearing/getPitch, on('load'|'move'|'click'
 * |'mousemove'), dragPan.enable()/.disable(), resize().
 *
 * Swapping this in for `new maplibregl.Map(...)` is what lets scene-view.js
 * — the file the builder's live preview and the CLI's frame-exact export
 * both depend on — work completely unchanged under the Equal Earth
 * projection: it never touches MapLibre directly, only this method surface.
 *
 * Depends on the d3-geo + d3-array UMD builds being loaded first (both
 * attach to a global `d3`).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EqualEarthMap = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TAU = Math.PI * 2;

  function rotatePoint(x, y, cx, cy, theta) {
    var dx = x - cx, dy = y - cy;
    var cos = Math.cos(theta), sin = Math.sin(theta);
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }

  // ---------------------------------------------------- geometry simplify
  /**
   * MapLibre tessellates land/country polygons once and re-renders them
   * with cheap GPU matrix transforms on every pan/zoom/frame. This adapter
   * re-walks the raw GeoJSON with d3.geoPath on every single redraw
   * instead — so the point count of that GeoJSON, which was nearly free
   * under WebGL, becomes the dominant per-frame cost here. Simplifying
   * once when a source is added (not per frame) is what keeps a render
   * with hundreds of animated frames tractable.
   *
   * Standard Douglas-Peucker, applied per ring/line in lng/lat space.
   * Small rings (already few points) pass through untouched — this only
   * ever thins out genuinely dense coastlines/borders.
   */
  function perpendicularDistSq(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) { var ex = p[0] - a[0], ey = p[1] - a[1]; return ex * ex + ey * ey; }
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
    var cx = a[0] + t * dx, cy = a[1] + t * dy;
    var fx = p[0] - cx, fy = p[1] - cy;
    return fx * fx + fy * fy;
  }
  function douglasPeucker(points, epsilonSq) {
    if (points.length <= 2) return points;
    var maxDistSq = 0, index = 0;
    var a = points[0], b = points[points.length - 1];
    for (var i = 1; i < points.length - 1; i++) {
      var d = perpendicularDistSq(points[i], a, b);
      if (d > maxDistSq) { maxDistSq = d; index = i; }
    }
    if (maxDistSq <= epsilonSq) return [a, b];
    var left = douglasPeucker(points.slice(0, index + 1), epsilonSq);
    var right = douglasPeucker(points.slice(index), epsilonSq);
    return left.slice(0, -1).concat(right);
  }
  var SIMPLIFY_EPSILON_SQ = 0.01 * 0.01; // ~1.1km at the equator — light; viewport culling (below) does the heavy lifting
  var SIMPLIFY_MIN_POINTS = 40; // rings shorter than this pass through untouched
  function simplifyRing(ring, closed) {
    if (ring.length <= SIMPLIFY_MIN_POINTS) return ring;
    var open = closed ? ring.slice(0, -1) : ring;
    var simplified = douglasPeucker(open, SIMPLIFY_EPSILON_SQ);
    if (closed) {
      if (simplified.length < 3) return ring; // never collapse a ring below a triangle
      simplified.push(simplified[0]);
    }
    return simplified;
  }
  function simplifyGeometry(geom) {
    if (!geom) return geom;
    if (geom.type === "Polygon") {
      geom.coordinates = geom.coordinates.map(function (ring) { return simplifyRing(ring, true); });
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates = geom.coordinates.map(function (poly) { return poly.map(function (ring) { return simplifyRing(ring, true); }); });
    } else if (geom.type === "LineString") {
      geom.coordinates = simplifyRing(geom.coordinates, false);
    } else if (geom.type === "MultiLineString") {
      geom.coordinates = geom.coordinates.map(function (line) { return simplifyRing(line, false); });
    }
    return geom;
  }
  function simplifyGeoJSON(data) {
    if (!data) return data;
    if (data.type === "FeatureCollection") {
      data.features.forEach(function (f) { simplifyGeometry(f.geometry); });
    } else if (data.type === "Feature") {
      simplifyGeometry(data.geometry);
    } else {
      simplifyGeometry(data);
    }
    return data;
  }

  // ------------------------------------------------------- viewport cull
  /**
   * The other half of keeping this fast: most scenes push into a single
   * country or city (the schema's own zoom guidance goes up to 12+ for a
   * landmark), so the other ~240 countries' geometry doesn't need to be
   * walked at all most of the time. Bounding boxes are computed once per
   * feature at load; culling against the current view happens every frame,
   * but a bbox check is orders of magnitude cheaper than path generation.
   */
  function ringBounds(ring, box) {
    for (var i = 0; i < ring.length; i++) {
      var lng = ring[i][0], lat = ring[i][1];
      if (lng < box[0]) box[0] = lng;
      if (lat < box[1]) box[1] = lat;
      if (lng > box[2]) box[2] = lng;
      if (lat > box[3]) box[3] = lat;
    }
  }
  function computeBBox(geom) {
    var box = [Infinity, Infinity, -Infinity, -Infinity];
    if (!geom) return box;
    if (geom.type === "Polygon") geom.coordinates.forEach(function (r) { ringBounds(r, box); });
    else if (geom.type === "MultiPolygon") geom.coordinates.forEach(function (poly) { poly.forEach(function (r) { ringBounds(r, box); }); });
    else if (geom.type === "LineString") ringBounds(geom.coordinates, box);
    else if (geom.type === "MultiLineString") geom.coordinates.forEach(function (l) { ringBounds(l, box); });
    return box;
  }
  function bboxIntersects(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function matchesFilter(filter) {
    // Only the one shape lib/scene-view.js's rebuildHighlights() ever
    // produces: ["==", ["get", "id"], "ISO3"]. Not general expression
    // support — there's no other filter shape anywhere in this app.
    if (!Array.isArray(filter) || filter[0] !== "==") return function () { return true; };
    var key = Array.isArray(filter[1]) && filter[1][0] === "get" ? filter[1][1] : null;
    var value = filter[2];
    if (!key) return function () { return true; };
    return function (feature) { return feature && feature.properties && feature.properties[key] === value; };
  }

  function EqualEarthMap(options) {
    var opts = options || {};
    this._container = typeof opts.container === "string" ? document.getElementById(opts.container) : opts.container;
    if (!this._container) throw new Error("EqualEarthMap: container not found");

    this._listeners = Object.create(null);
    this._sources = Object.create(null);
    this._layers = [];
    this._images = Object.create(null);
    this._patterns = Object.create(null);

    this._center = opts.center ? opts.center.slice() : [0, 20];
    this._zoom = opts.zoom != null ? opts.zoom : 2;
    this._bearing = opts.bearing || 0;
    this._pitch = opts.pitch || 0; // kept for API compatibility; no visual effect (see README)

    this._background = "#000";
    if (opts.style && Array.isArray(opts.style.layers)) {
      for (var i = 0; i < opts.style.layers.length; i++) {
        if (opts.style.layers[i].type === "background") {
          this._background = (opts.style.layers[i].paint || {})["background-color"] || this._background;
        }
      }
    }

    this._canvas = document.createElement("canvas");
    this._canvas.style.width = "100%";
    this._canvas.style.height = "100%";
    this._canvas.style.display = "block";
    this._container.appendChild(this._canvas);
    this._ctx = this._canvas.getContext("2d");

    this._projection = d3.geoEqualEarth();
    this._path = d3.geoPath(this._projection, this._ctx);
    this._pendingLoads = 0;
    this._idleScheduled = false;

    this._resizeCanvas();
    this._updateProjection();

    var dragEnabled = true;
    var self = this;
    this.dragPan = {
      enable: function () { dragEnabled = true; },
      disable: function () { dragEnabled = false; },
    };

    if (opts.interactive !== false) this._installInteraction(function () { return dragEnabled; });

    this._redraw();

    // Async like a real map — nothing here depends on remote fetches, but
    // callers (map.html, builder/canvas.js) both `await new Promise(r =>
    // map.on("load", r))`, so this needs to resolve on a later tick.
    Promise.resolve().then(function () { self._fire("load"); });
  }

  // --------------------------------------------------------------- events
  EqualEarthMap.prototype.on = function (event, cb) {
    (this._listeners[event] || (this._listeners[event] = [])).push(cb);
    return this;
  };
  EqualEarthMap.prototype.off = function (event, cb) {
    if (this._listeners[event]) this._listeners[event] = this._listeners[event].filter(function (fn) { return fn !== cb; });
    return this;
  };
  EqualEarthMap.prototype.once = function (event, cb) {
    var self = this;
    function wrapper() { self.off(event, wrapper); cb(); }
    return this.on(event, wrapper);
  };
  EqualEarthMap.prototype._fire = function (event, payload) {
    (this._listeners[event] || []).forEach(function (cb) { cb(payload); });
  };
  // Fires once no raster source has an in-flight image load — mirrors
  // MapLibre's "idle" event closely enough for map.html's waitForIdle(),
  // which otherwise has no way to know the (async-loaded) terrain raster
  // has actually finished decoding before the first screenshot.
  EqualEarthMap.prototype._scheduleIdle = function () {
    var self = this;
    if (this._idleScheduled) return;
    this._idleScheduled = true;
    setTimeout(function () {
      self._idleScheduled = false;
      if (self._pendingLoads === 0) self._fire("idle");
    }, 0);
  };

  // ------------------------------------------------------------- sizing
  /**
   * clientWidth/clientHeight, not getBoundingClientRect() — the latter
   * reflects the container's post-transform, on-screen *visual* size,
   * while the former is its untransformed layout size. The builder scales
   * its whole preview frame down with a CSS transform to fit the window
   * (see canvas.js's applyAspect) while keeping the frame's own layout
   * size fixed at the real output resolution, specifically so that the
   * camera math below sees that fixed resolution rather than whatever
   * size the frame happens to be squeezed to on screen. Get this wrong
   * and the same zoom value frames differently in the builder than in
   * the actual render, which is a preview that lies about what you'll get.
   */
  EqualEarthMap.prototype._resizeCanvas = function () {
    var dpr = window.devicePixelRatio || 1;
    this._width = Math.max(1, Math.round(this._container.clientWidth));
    this._height = Math.max(1, Math.round(this._container.clientHeight));
    this._canvas.width = Math.round(this._width * dpr);
    this._canvas.height = Math.round(this._height * dpr);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /**
   * Client (viewport) coordinates -> this map's own logical pixel space.
   * Plain `clientX - rect.left` is only correct when the canvas's on-screen
   * size matches its logical width/height 1:1; once the builder scales the
   * whole frame down to fit the window, rect.width shrinks but this._width
   * doesn't, so every mouse position needs that ratio undone before it
   * means anything to project()/unproject().
   */
  EqualEarthMap.prototype._clientToLogical = function (clientX, clientY) {
    var rect = this._canvas.getBoundingClientRect();
    var sx = rect.width ? this._width / rect.width : 1;
    var sy = rect.height ? this._height / rect.height : 1;
    return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
  };

  /** unproject(), but starting from client (event.clientX/Y) coordinates
   * rather than this map's own logical pixel space — see _clientToLogical. */
  EqualEarthMap.prototype.unprojectClient = function (clientX, clientY) {
    return this.unproject(this._clientToLogical(clientX, clientY));
  };

  EqualEarthMap.prototype.resize = function () {
    this._resizeCanvas();
    this._updateProjection();
    this._redraw();
  };

  // ---------------------------------------------------------- projection
  /**
   * Longitude recentres via rotate, latitude via center — the standard d3
   * convention for recentring a pseudocylindrical projection (confirmed
   * empirically: rotate([-lng,0,0]).center([0,lat]) puts [lng,lat] exactly
   * on the translate point). Zoom follows the same "doubles the scale"
   * convention Mercator/MapLibre use, rederived from the container's own
   * width instead of a fixed 512px tile.
   */
  EqualEarthMap.prototype._updateProjection = function () {
    var scale = (this._width / TAU) * Math.pow(2, this._zoom);
    this._projection
      .rotate([-this._center[0], 0, 0])
      .center([0, this._center[1]])
      .translate([this._width / 2, this._height / 2])
      .scale(scale);
    this._bearingRad = (this._bearing || 0) * Math.PI / 180;
  };

  EqualEarthMap.prototype.jumpTo = function (opts) {
    if (opts.center) this._center = opts.center.slice();
    if (opts.zoom != null) this._zoom = opts.zoom;
    if (opts.bearing != null) this._bearing = opts.bearing;
    if (opts.pitch != null) this._pitch = opts.pitch;
    this._updateProjection();
    this._redraw();
    this._fire("move");
  };

  EqualEarthMap.prototype.getCenter = function () { return { lng: this._center[0], lat: this._center[1] }; };
  EqualEarthMap.prototype.getZoom = function () { return this._zoom; };
  EqualEarthMap.prototype.getBearing = function () { return this._bearing; };
  EqualEarthMap.prototype.getPitch = function () { return this._pitch; };

  EqualEarthMap.prototype.project = function (lngLat) {
    var p = this._projection(lngLat);
    if (!p) return { x: NaN, y: NaN };
    var r = rotatePoint(p[0], p[1], this._width / 2, this._height / 2, this._bearingRad);
    return { x: r[0], y: r[1] };
  };

  /**
   * A generous lng/lat bounding box for what's roughly on screen right now,
   * by unprojecting the canvas edges — reuses unproject() so it already
   * accounts for bearing correctly. Returns null at low zoom (most/all of
   * the world is visible anyway, so there's nothing worth culling).
   */
  EqualEarthMap.prototype._visibleBBox = function () {
    if (this._zoom < 1.5) return null;
    var w = this._width, h = this._height;
    var corners = [[0, 0], [w, 0], [w, h], [0, h], [w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]];
    var box = [Infinity, Infinity, -Infinity, -Infinity];
    var self = this;
    corners.forEach(function (c) {
      var ll = self.unproject(c);
      if (!isFinite(ll.lng) || !isFinite(ll.lat)) return;
      if (ll.lng < box[0]) box[0] = ll.lng;
      if (ll.lat < box[1]) box[1] = ll.lat;
      if (ll.lng > box[2]) box[2] = ll.lng;
      if (ll.lat > box[3]) box[3] = ll.lat;
    });
    if (!isFinite(box[0])) return null;
    // Generous padding — the true visible region is curved, not
    // rectangular, so this only needs to avoid false negatives.
    var padLng = Math.max(2, (box[2] - box[0]) * 0.3);
    var padLat = Math.max(2, (box[3] - box[1]) * 0.3);
    return [box[0] - padLng, box[1] - padLat, box[2] + padLng, box[3] + padLat];
  };

  EqualEarthMap.prototype.unproject = function (xy) {
    var r = rotatePoint(xy[0], xy[1], this._width / 2, this._height / 2, -this._bearingRad);
    var ll = this._projection.invert(r);
    return { lng: ll[0], lat: ll[1] };
  };

  // ----------------------------------------------------- sources/layers
  EqualEarthMap.prototype.addSource = function (id, source) {
    var entry = Object.assign({}, source);
    if (entry.type === "geojson" && entry.data) {
      simplifyGeoJSON(entry.data);
      var features = entry.data.type === "FeatureCollection" ? entry.data.features
        : entry.data.type === "Feature" ? [entry.data] : null;
      if (features) features.forEach(function (f) {
        f._bbox = computeBBox(f.geometry);
        // land.geo.json in particular is the whole world's landmasses as a
        // SINGLE feature/MultiPolygon — a feature-level bbox never culls
        // anything there. Per-ring bboxes let individual continents/islands
        // get culled even when they all share one feature.
        if (f.geometry && f.geometry.type === "MultiPolygon") {
          f._polyBBoxes = f.geometry.coordinates.map(function (poly) {
            var box = [Infinity, Infinity, -Infinity, -Infinity];
            ringBounds(poly[0], box);
            return box;
          });
        }
      });
    }
    this._sources[id] = entry;
    if (source.type === "image") this._loadRasterSource(id, entry);
    return this;
  };
  EqualEarthMap.prototype.getSource = function (id) { return this._sources[id] || null; };
  EqualEarthMap.prototype.removeSource = function (id) { delete this._sources[id]; return this; };

  EqualEarthMap.prototype.addLayer = function (layer, beforeId) {
    var entry = Object.assign({}, layer, { paint: Object.assign({}, layer.paint) });
    var idx = beforeId ? this._layers.findIndex(function (l) { return l.id === beforeId; }) : -1;
    if (idx === -1) this._layers.push(entry); else this._layers.splice(idx, 0, entry);
    this._redraw();
    return this;
  };
  EqualEarthMap.prototype.getLayer = function (id) { return this._layers.find(function (l) { return l.id === id; }) || null; };
  EqualEarthMap.prototype.removeLayer = function (id) {
    this._layers = this._layers.filter(function (l) { return l.id !== id; });
    this._redraw();
    return this;
  };
  EqualEarthMap.prototype.setPaintProperty = function (id, prop, value) {
    var layer = this.getLayer(id);
    if (!layer) return this;
    layer.paint[prop] = value;
    this._redraw();
    return this;
  };

  // -------------------------------------------------------------- images
  // Used for the zone hatch fill: scene-view.js draws a small canvas tile
  // itself and hands it over as ImageData, exactly like it would to
  // MapLibre's addImage.
  EqualEarthMap.prototype.hasImage = function (id) { return !!this._images[id]; };
  EqualEarthMap.prototype.addImage = function (id, imageData) {
    this._images[id] = imageData;
    delete this._patterns[id];
    return this;
  };
  EqualEarthMap.prototype._getPattern = function (id) {
    if (this._patterns[id]) return this._patterns[id];
    var imageData = this._images[id];
    if (!imageData) return "#888";
    var tile = document.createElement("canvas");
    tile.width = imageData.width;
    tile.height = imageData.height;
    tile.getContext("2d").putImageData(imageData, 0, 0);
    var pattern = this._ctx.createPattern(tile, "repeat");
    this._patterns[id] = pattern;
    return pattern;
  };

  // ------------------------------------------------------------- raster
  EqualEarthMap.prototype._loadRasterSource = function (id, source) {
    var self = this;
    this._pendingLoads++;
    var img = new Image();
    img.onload = function () {
      var off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      var octx = off.getContext("2d");
      octx.drawImage(img, 0, 0);
      source._imageData = octx.getImageData(0, 0, off.width, off.height);
      self._pendingLoads--;
      if (self._sources[id] === source) self._redraw(); else self._scheduleIdle();
    };
    img.onerror = function () {
      // Terrain asset missing/unreadable — silently render without it,
      // same as when data/terrain/ was never built at all.
      self._pendingLoads--;
      self._scheduleIdle();
    };
    img.src = source.url;
  };

  /**
   * Reprojecting the terrain raster needs an inverse-projection call (a
   * Newton iteration, not cheap) per output pixel — doing that at full
   * output resolution (millions of pixels) is too slow for a real render.
   * The earlier approach traded resolution for speed directly (compute a
   * small buffer, stretch it up) — which is exactly the blur this exists
   * to fix.
   *
   * The actual fix: the expensive part (inverse projection) only needs to
   * run on a coarse grid — the projection is smooth, so the true inverse
   * within a small cell is well approximated by bilinearly interpolating
   * the cell's four corners. Every output pixel then costs a cheap
   * interpolation plus one source-image lookup, no trig, so the *output*
   * can be full resolution while the *expensive* work stays small.
   */
  EqualEarthMap.prototype._drawRaster = function (layer) {
    var source = this._sources[layer.source];
    if (!source || !source._imageData || !source.coordinates) return;
    var opacity = layer.paint["raster-opacity"] != null ? layer.paint["raster-opacity"] : 1;
    if (opacity <= 0) return;

    var src = source._imageData;
    var coords = source.coordinates;
    var west = coords[0][0], north = coords[0][1], east = coords[1][0], south = coords[2][1];
    var sw = src.width, sh = src.height;

    var W = this._width, H = this._height;
    var cellsX = Math.max(16, Math.min(96, Math.round(W / 24)));
    var cellsY = Math.max(16, Math.min(96, Math.round(H / 24)));
    var cols = cellsX + 1, rows = cellsY + 1;

    var gridLng = new Float64Array(cols * rows);
    var gridLat = new Float64Array(cols * rows);
    var gridValid = new Uint8Array(cols * rows);
    var cx = W / 2, cy = H / 2, bearingRad = this._bearingRad, projection = this._projection;
    for (var gy = 0; gy < rows; gy++) {
      for (var gx = 0; gx < cols; gx++) {
        var fx = (gx / cellsX) * W, fy = (gy / cellsY) * H;
        var r = rotatePoint(fx, fy, cx, cy, -bearingRad);
        var ll = projection.invert(r);
        var idx = gy * cols + gx;
        if (ll && isFinite(ll[0]) && isFinite(ll[1])) {
          gridLng[idx] = ll[0]; gridLat[idx] = ll[1]; gridValid[idx] = 1;
        }
      }
    }
    // Unwrap longitude across the grid so bilinear interpolation doesn't
    // tear at the antimeridian (jumping from +180 to -180 mid-cell).
    for (var gy2 = 0; gy2 < rows; gy2++) {
      for (var gx2 = 1; gx2 < cols; gx2++) {
        var i = gy2 * cols + gx2, prev = gy2 * cols + gx2 - 1;
        while (gridLng[i] - gridLng[prev] > 180) gridLng[i] -= 360;
        while (gridLng[i] - gridLng[prev] < -180) gridLng[i] += 360;
      }
    }

    if (!this._rasterOut || this._rasterOut.width !== W || this._rasterOut.height !== H) {
      this._rasterOutCanvas = document.createElement("canvas");
      this._rasterOutCanvas.width = W;
      this._rasterOutCanvas.height = H;
      this._rasterOutCtx = this._rasterOutCanvas.getContext("2d");
      this._rasterOut = this._rasterOutCtx.createImageData(W, H);
    }
    var out = this._rasterOut;
    out.data.fill(0);

    var cellW = W / cellsX, cellH = H / cellsY;
    for (var py = 0; py < H; py++) {
      var gyF = py / cellH, gy0 = gyF | 0, v = gyF - gy0;
      if (gy0 >= cellsY) gy0 = cellsY - 1, v = 1;
      for (var px = 0; px < W; px++) {
        var gxF = px / cellW, gx0 = gxF | 0, u = gxF - gx0;
        if (gx0 >= cellsX) gx0 = cellsX - 1, u = 1;
        var i00 = gy0 * cols + gx0, i10 = i00 + 1, i01 = i00 + cols, i11 = i01 + 1;
        if (!gridValid[i00] || !gridValid[i10] || !gridValid[i01] || !gridValid[i11]) continue;

        var lng = (gridLng[i00] * (1 - u) + gridLng[i10] * u) * (1 - v) + (gridLng[i01] * (1 - u) + gridLng[i11] * u) * v;
        var lat = (gridLat[i00] * (1 - u) + gridLat[i10] * u) * (1 - v) + (gridLat[i01] * (1 - u) + gridLat[i11] * u) * v;
        if (lng > 180) lng -= 360; else if (lng < -180) lng += 360;
        if (lng < west || lng > east || lat > north || lat < south) continue;

        var col = (lng - west) / (east - west) * sw | 0;
        var row = (north - lat) / (north - south) * sh | 0;
        if (col < 0 || col >= sw || row < 0 || row >= sh) continue;
        var si = (row * sw + col) * 4;
        var di = (py * W + px) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
    this._rasterOutCtx.putImageData(out, 0, 0);

    var ctx = this._ctx;
    ctx.save();
    ctx.globalAlpha = opacity;

    // Natural Earth's relief source has no ocean colouring — sea pixels
    // are blank/white — so painting it across the whole canvas turns
    // every ocean into a white slab. Clipping to the land shape leaves
    // the sea showing the normal background colour underneath instead,
    // same as the land-fill layer already does for its own shape.
    var landSource = this._sources.land;
    if (landSource && landSource.data) {
      if (bearingRad) { ctx.translate(cx, cy); ctx.rotate(bearingRad); ctx.translate(-cx, -cy); }
      var landFeatures = landSource.data.type === "FeatureCollection" ? landSource.data.features : [landSource.data];
      var path = this._path, cull = this._cullBBox;
      ctx.beginPath();
      landFeatures.forEach(function (f) {
        var geom = f.geometry;
        if (cull && f._polyBBoxes) {
          geom = { type: "MultiPolygon", coordinates: geom.coordinates.filter(function (poly, i) { return bboxIntersects(f._polyBBoxes[i], cull); }) };
        }
        path(geom);
      });
      ctx.clip();
      // The clip region is now fixed in device space — resetting the
      // transform doesn't move it, but it does stop the already-rotated
      // raster buffer below from being rotated a second time.
      var dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.drawImage(this._rasterOutCanvas, 0, 0);
    ctx.restore();
  };

  // -------------------------------------------------------------- redraw
  EqualEarthMap.prototype._redraw = function () {
    var ctx = this._ctx;
    ctx.save();
    ctx.clearRect(0, 0, this._width, this._height);
    ctx.fillStyle = this._background;
    ctx.fillRect(0, 0, this._width, this._height);

    // Clips everything that follows to the projection's actual silhouette,
    // so nothing gets drawn (least of all a per-pixel-sampled raster) into
    // the corners outside the globe's outline in a pseudocylindrical
    // projection like Equal Earth.
    ctx.beginPath();
    this._path({ type: "Sphere" });
    ctx.clip();

    this._cullBBox = this._visibleBBox();
    var self = this;
    this._layers.forEach(function (layer) { self._drawLayer(layer); });
    ctx.restore();
    this._scheduleIdle();
  };

  EqualEarthMap.prototype._drawLayer = function (layer) {
    if (layer.type === "raster") return this._drawRaster(layer);

    var source = this._sources[layer.source];
    if (!source) return;
    var data = source.data;
    if (!data) return;
    var features = data.type === "FeatureCollection" ? data.features : [data];
    if (layer.filter) features = features.filter(matchesFilter(layer.filter));
    if (this._cullBBox) {
      var cull = this._cullBBox;
      features = features.filter(function (f) { return !f._bbox || bboxIntersects(f._bbox, cull); });
    }
    if (!features.length) return;

    var cullBox = this._cullBBox;
    function geometryOf(f) {
      // A MultiPolygon whose sub-polygons carry their own bboxes (see
      // addSource) gets culled ring-by-ring, not just feature-by-feature —
      // land.geo.json is the whole world's landmasses as one feature, so
      // feature-level culling alone would never trim it.
      if (cullBox && f._polyBBoxes) {
        var kept = f.geometry.coordinates.filter(function (poly, i) { return bboxIntersects(f._polyBBoxes[i], cullBox); });
        return { type: "MultiPolygon", coordinates: kept };
      }
      return f.geometry;
    }

    var ctx = this._ctx;
    var path = this._path;
    // Base-layer geometry is drawn in the projection's own (pre-bearing)
    // space; this rotation is what makes it agree with project()'s explicit
    // point rotation for the DOM/SVG overlays drawn on top of it.
    ctx.save();
    if (this._bearingRad) {
      ctx.translate(this._width / 2, this._height / 2);
      ctx.rotate(this._bearingRad);
      ctx.translate(-this._width / 2, -this._height / 2);
    }

    if (layer.type === "fill") {
      var fillStyle = layer.paint["fill-pattern"] ? this._getPattern(layer.paint["fill-pattern"]) : (layer.paint["fill-color"] || "#888");
      var fillOpacity = layer.paint["fill-opacity"] != null ? layer.paint["fill-opacity"] : 1;
      if (fillOpacity > 0) {
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fillStyle;
        ctx.beginPath();
        features.forEach(function (f) { path(geometryOf(f)); });
        ctx.fill();
      }
    } else if (layer.type === "line") {
      var lineOpacity = layer.paint["line-opacity"] != null ? layer.paint["line-opacity"] : 1;
      if (lineOpacity > 0) {
        var lineWidth = layer.paint["line-width"] || 1;
        ctx.globalAlpha = lineOpacity;
        ctx.strokeStyle = layer.paint["line-color"] || "#888";
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(layer.paint["line-dasharray"] ? layer.paint["line-dasharray"].map(function (d) { return d * lineWidth; }) : []);
        ctx.beginPath();
        features.forEach(function (f) { path(geometryOf(f)); });
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  function clampLat(lat) { return Math.max(-85, Math.min(85, lat)); }

  // ---------------------------------------------------------- interaction
  /**
   * MapLibre's own dragPan/scrollZoom, reimplemented directly on the
   * canvas: pointer-drag pans by keeping the point under the cursor fixed
   * (the standard "drag map" trick), wheel zooms the same way, and a
   * pointerup with no meaningful movement fires 'click' — the one thing
   * builder/canvas.js actually listens for.
   */
  EqualEarthMap.prototype._installInteraction = function (dragEnabled) {
    var self = this;
    var canvas = this._canvas;
    var dragging = false, moved = false, anchor = null, startClient = null;

    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";

    canvas.addEventListener("pointerdown", function (e) {
      if (!dragEnabled() || e.button !== 0) return;
      dragging = true;
      moved = false;
      startClient = { x: e.clientX, y: e.clientY };
      anchor = self.unprojectClient(e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });

    canvas.addEventListener("pointermove", function (e) {
      var xy = self._clientToLogical(e.clientX, e.clientY);
      if (dragging) {
        if (Math.abs(e.clientX - startClient.x) > 2 || Math.abs(e.clientY - startClient.y) > 2) moved = true;
        var under = self.unproject(xy);
        self._center = [self._center[0] - (under.lng - anchor.lng), clampLat(self._center[1] - (under.lat - anchor.lat))];
        self._updateProjection();
        self._redraw();
        self._fire("move");
      }
      self._fire("mousemove", { lngLat: self.unproject(xy) });
    });

    canvas.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "grab";
      if (!moved) {
        self._fire("click", { lngLat: self.unprojectClient(e.clientX, e.clientY) });
      }
    });

    canvas.addEventListener("wheel", function (e) {
      if (!dragEnabled()) return;
      e.preventDefault();
      var xy = self._clientToLogical(e.clientX, e.clientY);
      var x = xy[0], y = xy[1];
      var before = self.unproject([x, y]);
      self._zoom = Math.max(0, Math.min(20, self._zoom - e.deltaY * 0.0025));
      self._updateProjection();
      var after = self.unproject([x, y]);
      self._center = [self._center[0] - (after.lng - before.lng), clampLat(self._center[1] - (after.lat - before.lat))];
      self._updateProjection();
      self._redraw();
      self._fire("move");
    }, { passive: false });
  };

  return EqualEarthMap;
});

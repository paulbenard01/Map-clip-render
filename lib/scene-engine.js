/**
 * scene-engine.js — the single source of truth for scene math.
 *
 * Camera interpolation, fade timing, route geometry and duration are computed
 * here and *only* here, because two consumers need identical answers:
 *
 *   1. builder.html  — real-time preview and timeline scrubbing
 *   2. map.html      — the frame-exact page render.js screenshots
 *
 * If those ever computed positions with two different pieces of code they
 * would drift, and "what I built isn't what rendered" becomes a permanent
 * class of bug. One engine, two callers.
 *
 * Everything in here is a pure function of (scene, t). No DOM, no MapLibre,
 * no fetch — which is what lets it load as a plain <script> in the browser
 * and as a require() in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SceneEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SCHEMA_VERSION = 2;

  var DEFAULTS = {
    aspect: "16:9",
    style: "dark-navy",
    fps: 30,
    pinSize: 96,
    pinStyle: "circle",
    pinLabelSize: 15,
    titleSize: 22,
    titlePosition: "bottom-left",
    fade: 0.45,
    routeFade: 0.3,
    routeWidth: 3,
    routeDrawDuration: 1.2,
    routeCurve: "straight",
    routeBulge: 0.15,
    highlightFade: 0.6,
    cameraTransition: "ease",
    zoom: 2,
  };

  var PIN_STYLES = ["circle", "square", "rounded-square", "badge", "polaroid"];
  var ROUTE_CURVES = ["straight", "arc", "greatCircle"];
  var CAMERA_TRANSITIONS = ["ease", "cut", "zoomBlast"];
  var TITLE_POSITIONS = ["bottom-left", "bottom-right", "top-left", "top-right", "center"];

  // ------------------------------------------------------------ easing
  function easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  // Slow start, very fast finish — the "hang back, then rocket in" push.
  function easeInExpo(x) {
    return x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
  }
  function linear(x) { return x; }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, f) { return a + (b - a) * f; }
  function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }

  // ------------------------------------------------------- normalisation
  /**
   * Returns a defaults-filled, id-stamped, time-sorted copy of a scene.
   *
   * Both callers normalise on load so that every downstream function can
   * assume the shape is complete. Idempotent: normalizing twice is a no-op,
   * which matters because the builder re-normalises after every edit.
   *
   * Also migrates the v1 `focusCountry` shorthand into `countryHighlights`,
   * so scenes written before timed highlights existed keep rendering exactly
   * as they did (fade 0 = hard on from t=0, which is what v1 did).
   */
  function normalizeScene(scene) {
    var s = scene || {};
    var out = {
      schemaVersion: num(s.schemaVersion, SCHEMA_VERSION),
      name: s.name || null,
      aspect: s.aspect || DEFAULTS.aspect,
      style: s.style || DEFAULTS.style,
      fps: num(s.fps, DEFAULTS.fps),
      camera: [],
      pins: [],
      routes: [],
      countryHighlights: [],
      titles: [],
    };
    if (s._comment) out._comment = s._comment;
    if (typeof s.duration === "number") out.duration = s.duration;

    out.camera = (s.camera || []).map(function (k, i) {
      return {
        id: k.id || "cam" + i,
        t: num(k.t, 0),
        center: coord(k.center) || [0, 20],
        zoom: num(k.zoom, DEFAULTS.zoom),
        bearing: num(k.bearing, 0),
        pitch: num(k.pitch, 0),
        transition: CAMERA_TRANSITIONS.indexOf(k.transition) >= 0 ? k.transition : DEFAULTS.cameraTransition,
      };
    }).sort(function (a, b) { return a.t - b.t; });

    out.pins = (s.pins || []).map(function (p, i) {
      return {
        id: p.id || "pin" + i,
        center: coord(p.center) || coord([p.lng, p.lat]) || [0, 0],
        at: num(p.at, 0),
        until: p.until == null ? null : num(p.until, null),
        fade: p.fade == null ? null : num(p.fade, null),
        image: p.image || null,
        label: p.label || null,
        labelSize: num(p.labelSize, DEFAULTS.pinLabelSize),
        size: num(p.size, DEFAULTS.pinSize),
        style: PIN_STYLES.indexOf(p.style) >= 0 ? p.style : DEFAULTS.pinStyle,
        ringColor: p.ringColor || null,
        borderWidth: p.borderWidth == null ? null : num(p.borderWidth, null),
      };
    });

    out.routes = (s.routes || []).map(function (r, i) {
      return {
        id: r.id || "route" + i,
        from: coord(r.from) || [0, 0],
        to: coord(r.to) || [0, 0],
        startAt: num(r.startAt, 0),
        drawDuration: num(r.drawDuration, DEFAULTS.routeDrawDuration),
        until: r.until == null ? null : num(r.until, null),
        fade: r.fade == null ? null : num(r.fade, null),
        color: r.color || null,
        width: num(r.width, DEFAULTS.routeWidth),
        dashed: !!r.dashed,
        curve: ROUTE_CURVES.indexOf(r.curve) >= 0 ? r.curve : DEFAULTS.routeCurve,
        bulge: num(r.bulge, DEFAULTS.routeBulge),
        via: coord(r.via),
        arrowEnd: !!r.arrowEnd,
        label: r.label || null,
      };
    });

    out.titles = (s.titles || []).map(function (t, i) {
      return {
        id: t.id || "title" + i,
        text: t.text || "",
        position: TITLE_POSITIONS.indexOf(t.position) >= 0 ? t.position : DEFAULTS.titlePosition,
        at: num(t.at, 0),
        until: t.until == null ? null : num(t.until, null),
        fade: t.fade == null ? null : num(t.fade, null),
        size: num(t.size, DEFAULTS.titleSize),
      };
    });

    var highlights = (s.countryHighlights || []).map(function (h, i) {
      return {
        id: h.id || "hl" + i,
        iso: (h.iso || "").toUpperCase(),
        color: h.color || null,          // null => fall back to the preset's landFocus
        at: num(h.at, 0),
        until: h.until == null ? null : num(h.until, null),
        fade: num(h.fade, DEFAULTS.highlightFade),
      };
    }).filter(function (h) { return !!h.iso; });

    // v1 shorthand: one country, no colour, on for the whole clip.
    if (s.focusCountry) {
      var already = highlights.some(function (h) { return h.iso === String(s.focusCountry).toUpperCase(); });
      if (!already) {
        highlights.unshift({
          id: "focus",
          iso: String(s.focusCountry).toUpperCase(),
          color: null,
          at: 0,
          until: null,
          fade: 0,          // v1 had no fade — it was simply always on
          _fromFocusCountry: true,
        });
      }
    }
    out.countryHighlights = highlights;

    return out;
  }

  function coord(c) {
    if (!c || !c.length || c.length < 2) return null;
    var a = Number(c[0]), b = Number(c[1]);
    if (!isFinite(a) || !isFinite(b)) return null;
    return [a, b];
  }

  /**
   * The inverse of normalizeScene's tidying: drops nulls, defaults and
   * generated ids so an exported file stays a readable, hand-editable
   * document rather than a dump of every field the engine knows about.
   */
  function serializeScene(scene) {
    var s = normalizeScene(scene);
    var out = { schemaVersion: SCHEMA_VERSION };
    if (s._comment) out._comment = s._comment;
    if (s.name) out.name = s.name;
    out.aspect = s.aspect;
    out.style = s.style;
    out.fps = s.fps;

    out.camera = s.camera.map(function (k, i) {
      var o = { t: round(k.t, 3), center: roundCoord(k.center), zoom: round(k.zoom, 3) };
      if (k.bearing) o.bearing = round(k.bearing, 2);
      if (k.pitch) o.pitch = round(k.pitch, 2);
      if (k.transition !== DEFAULTS.cameraTransition) o.transition = k.transition;
      if (k.id && k.id !== "cam" + i) o.id = k.id;
      return o;
    });

    out.pins = s.pins.map(function (p, i) {
      var o = {};
      if (p.id && p.id !== "pin" + i) o.id = p.id;
      o.center = roundCoord(p.center);
      o.at = round(p.at, 3);
      o.until = p.until == null ? null : round(p.until, 3);
      if (p.image) o.image = p.image;
      if (p.label) o.label = p.label;
      if (p.size !== DEFAULTS.pinSize) o.size = p.size;
      if (p.labelSize !== DEFAULTS.pinLabelSize) o.labelSize = p.labelSize;
      if (p.style !== DEFAULTS.pinStyle) o.style = p.style;
      if (p.ringColor) o.ringColor = p.ringColor;
      if (p.borderWidth != null) o.borderWidth = p.borderWidth;
      if (p.fade != null) o.fade = p.fade;
      return o;
    });

    out.routes = s.routes.map(function (r, i) {
      var o = {};
      if (r.id && r.id !== "route" + i) o.id = r.id;
      o.from = roundCoord(r.from);
      o.to = roundCoord(r.to);
      o.startAt = round(r.startAt, 3);
      o.drawDuration = round(r.drawDuration, 3);
      o.until = r.until == null ? null : round(r.until, 3);
      if (r.color) o.color = r.color;
      if (r.width !== DEFAULTS.routeWidth) o.width = r.width;
      if (r.dashed) o.dashed = true;
      if (r.curve !== DEFAULTS.routeCurve) o.curve = r.curve;
      if (r.curve === "arc" && r.bulge !== DEFAULTS.routeBulge) o.bulge = round(r.bulge, 3);
      if (r.via) o.via = roundCoord(r.via);
      if (r.arrowEnd) o.arrowEnd = true;
      if (r.label) o.label = r.label;
      if (r.fade != null) o.fade = r.fade;
      return o;
    });

    // A lone migrated focusCountry round-trips back to focusCountry, so
    // importing and re-exporting a v1 scene doesn't silently rewrite it.
    var hls = s.countryHighlights;
    if (hls.length === 1 && hls[0]._fromFocusCountry) {
      out.focusCountry = hls[0].iso;
    } else if (hls.length) {
      out.countryHighlights = hls.map(function (h, i) {
        var o = { iso: h.iso };
        if (h.id && h.id !== "hl" + i) o.id = h.id;
        if (h.color) o.color = h.color;
        o.at = round(h.at, 3);
        o.until = h.until == null ? null : round(h.until, 3);
        if (h.fade !== DEFAULTS.highlightFade) o.fade = round(h.fade, 3);
        return o;
      });
    }

    out.titles = s.titles.map(function (t, i) {
      var o = {};
      if (t.id && t.id !== "title" + i) o.id = t.id;
      o.text = t.text;
      o.position = t.position;
      o.at = round(t.at, 3);
      o.until = t.until == null ? null : round(t.until, 3);
      if (t.size !== DEFAULTS.titleSize) o.size = t.size;
      if (t.fade != null) o.fade = t.fade;
      return o;
    });

    out.duration = round(computeDuration(s), 3);
    return out;
  }

  function round(n, places) {
    var m = Math.pow(10, places);
    return Math.round(n * m) / m;
  }
  function roundCoord(c) { return [round(c[0], 6), round(c[1], 6)]; }

  // ------------------------------------------------------------- camera
  /**
   * Camera state at time t.
   *
   * Straight lerp on lng/lat/zoom/bearing/pitch between the two surrounding
   * keyframes, eased. `transition` on the *arriving* keyframe describes how
   * the camera gets there from the one before it:
   *
   *   ease       eased pan/zoom (v1 behaviour, the default)
   *   cut        hold the previous keyframe, then snap — no interpolation
   *   zoomBlast  pan/bearing/pitch ease normally, zoom uses easeInExpo
   *
   * Does not special-case the antimeridian; a route crossing the 180° seam
   * needs an intermediate keyframe. (Routes *do* take the short way — see
   * sampleRoute.)
   */
  function cameraAt(scene, t) {
    var kfs = (scene && scene.camera) || [];
    if (!kfs.length) return { center: [0, 20], zoom: DEFAULTS.zoom, bearing: 0, pitch: 0 };
    if (t <= kfs[0].t) return normKf(kfs[0]);
    if (t >= kfs[kfs.length - 1].t) return normKf(kfs[kfs.length - 1]);

    for (var i = 0; i < kfs.length - 1; i++) {
      var a = kfs[i], b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        var A = normKf(a), B = normKf(b);
        var transition = b.transition || DEFAULTS.cameraTransition;
        if (transition === "cut") return t < b.t ? A : B;

        var span = b.t - a.t || 1;
        var raw = clamp01((t - a.t) / span);
        var f = easeInOutCubic(raw);
        var fz = transition === "zoomBlast" ? easeInExpo(raw) : f;
        return {
          center: [lerp(A.center[0], B.center[0], f), lerp(A.center[1], B.center[1], f)],
          zoom: lerp(A.zoom, B.zoom, fz),
          bearing: lerp(A.bearing, B.bearing, f),
          pitch: lerp(A.pitch, B.pitch, f),
        };
      }
    }
    return normKf(kfs[kfs.length - 1]);
  }

  function normKf(k) {
    return {
      center: k.center,
      zoom: num(k.zoom, DEFAULTS.zoom),
      bearing: num(k.bearing, 0),
      pitch: num(k.pitch, 0),
    };
  }

  // -------------------------------------------------------------- fades
  /**
   * 0..1 opacity for something active between `at` and `until`, with a short
   * automatic fade at each end. `until: null` means "to the end of the clip".
   */
  function fadeOpacity(t, at, until, fadeSec) {
    if (fadeSec == null) fadeSec = DEFAULTS.fade;
    if (until == null) until = Infinity;
    if (t < at || t > until) return 0;
    if (fadeSec <= 0) return 1;
    var inT = Math.min(1, (t - at) / fadeSec);
    var outT = until === Infinity ? 1 : Math.min(1, (until - t) / fadeSec);
    return Math.max(0, Math.min(inT, outT));
  }

  // ------------------------------------------------------------- routes
  /**
   * The route's path as [lng, lat] samples.
   *
   *   straight     flat lerp (v1 behaviour)
   *   arc          quadratic bezier bulged perpendicular to the line — the
   *                familiar flight-path look. `bulge` (0..1) sets how much.
   *   greatCircle  true spherical interpolation (slerp on unit vectors),
   *                which is what actually matters on long east-west hauls.
   *
   * `via` overrides the curve type with an explicit control point. The curve
   * is fitted so it passes *through* via at the halfway mark rather than
   * merely being pulled toward it, because in the builder `via` is a handle
   * you drag — it should end up where you put it.
   *
   * Endpoints are unwrapped to the shorter way round before sampling, so a
   * route from Tokyo to San Francisco crosses the Pacific instead of taking
   * the scenic route back across Asia and Europe.
   */
  function sampleRoute(from, to, n, curve, via, bulge) {
    n = n || 64;
    var A = [from[0], from[1]];
    var B = [unwrapLng(to[0], A[0]), to[1]];
    var pts = [];
    var i, f;

    if (via) {
      var V = [unwrapLng(via[0], A[0]), via[1]];
      // Quadratic bezier control point chosen so that P(0.5) === V exactly.
      var C = [2 * V[0] - (A[0] + B[0]) / 2, 2 * V[1] - (A[1] + B[1]) / 2];
      for (i = 0; i <= n; i++) { f = i / n; pts.push(quadBezier(A, C, B, f)); }
      return pts;
    }

    if (curve === "greatCircle") return sampleGreatCircle(A, B, n);

    if (curve === "arc") {
      var bu = bulge == null ? DEFAULTS.routeBulge : bulge;
      var dx = B[0] - A[0], dy = B[1] - A[1];
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Left-hand normal: an eastbound route bulges north, which is the
      // direction people expect a flight path to bow.
      var px = -dy / len, py = dx / len;
      var mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      var ctrl = [mid[0] + px * len * bu, mid[1] + py * len * bu];
      // Bezier control point is twice the offset of the curve's apex, so
      // halve nothing here: `bulge` is defined against the control point.
      for (i = 0; i <= n; i++) { f = i / n; pts.push(quadBezier(A, ctrl, B, f)); }
      return pts;
    }

    for (i = 0; i <= n; i++) {
      f = i / n;
      pts.push([lerp(A[0], B[0], f), lerp(A[1], B[1], f)]);
    }
    return pts;
  }

  function quadBezier(A, C, B, f) {
    var u = 1 - f;
    return [
      u * u * A[0] + 2 * u * f * C[0] + f * f * B[0],
      u * u * A[1] + 2 * u * f * C[1] + f * f * B[1],
    ];
  }

  // Shift `lng` by whole turns so it lands within 180° of `ref` — i.e. pick
  // whichever way round the world is actually shorter.
  function unwrapLng(lng, ref) {
    var out = lng;
    while (out - ref > 180) out -= 360;
    while (out - ref < -180) out += 360;
    return out;
  }

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function sampleGreatCircle(A, B, n) {
    var lon1 = A[0] * D2R, lat1 = A[1] * D2R;
    var lon2 = B[0] * D2R, lat2 = B[1] * D2R;
    var v1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)];
    var v2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)];
    var dot = Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
    var omega = Math.acos(dot);
    var pts = [];
    var prevLng = A[0];
    for (var i = 0; i <= n; i++) {
      var f = i / n;
      var p;
      if (omega < 1e-9) {
        p = v1; // same point (or close enough that slerp is unstable)
      } else {
        var s1 = Math.sin((1 - f) * omega) / Math.sin(omega);
        var s2 = Math.sin(f * omega) / Math.sin(omega);
        p = [v1[0] * s1 + v2[0] * s2, v1[1] * s1 + v2[1] * s2, v1[2] * s1 + v2[2] * s2];
      }
      var lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) * R2D;
      var lng = Math.atan2(p[1], p[0]) * R2D;
      // atan2 wraps at ±180; keep the sampled line continuous so the SVG
      // path doesn't shoot back across the map at the seam.
      lng = unwrapLng(lng, prevLng);
      prevLng = lng;
      pts.push([lng, lat]);
    }
    return pts;
  }

  /** Opacity + draw progress for a route at time t. */
  function routeStateAt(route, t) {
    var start = num(route.startAt, 0);
    var drawDur = num(route.drawDuration, DEFAULTS.routeDrawDuration);
    var fade = route.fade == null ? DEFAULTS.routeFade : route.fade;
    var opacity = fadeOpacity(t, start, route.until, fade);
    var drawFrac = drawDur > 0 ? clamp01((t - start) / drawDur) : 1;
    // Label holds off until the line is under way, so it doesn't pop in on
    // top of the origin pin.
    var labelOpacity = fadeOpacity(t, start + drawDur * 0.3, route.until, fade);
    return { opacity: opacity, drawFrac: drawFrac, labelOpacity: labelOpacity };
  }

  // -------------------------------------------------------- highlights
  /** Active country highlights at time t, with their current opacity. */
  function countryHighlightsAt(scene, t) {
    return ((scene && scene.countryHighlights) || []).map(function (h) {
      return { id: h.id, iso: h.iso, color: h.color, opacity: fadeOpacity(t, h.at, h.until, h.fade) };
    });
  }

  // ---------------------------------------------------------- duration
  /**
   * Total clip length. An explicit `duration` always wins; otherwise it's
   * derived from whatever happens last, plus a beat of air so the clip
   * doesn't hard-cut on the final action.
   */
  function computeDuration(scene) {
    if (scene && typeof scene.duration === "number") return scene.duration;
    var ends = [3]; // floor
    var cams = (scene && scene.camera) || [];
    if (cams.length) ends.push(cams[cams.length - 1].t + 1.5);
    ((scene && scene.pins) || []).forEach(function (p) {
      ends.push(typeof p.until === "number" ? p.until + 0.5 : num(p.at, 0) + 2);
    });
    ((scene && scene.titles) || []).forEach(function (t) {
      ends.push(typeof t.until === "number" ? t.until + 0.5 : num(t.at, 0) + 2);
    });
    ((scene && scene.countryHighlights) || []).forEach(function (h) {
      if (typeof h.until === "number") ends.push(h.until + 0.5);
    });
    ((scene && scene.routes) || []).forEach(function (r) {
      var start = num(r.startAt, 0), dur = num(r.drawDuration, DEFAULTS.routeDrawDuration);
      ends.push(start + dur + (typeof r.until === "number" ? (r.until - start - dur) + 1.5 : 1.5));
    });
    return Math.max.apply(null, ends);
  }

  /** Every timed element, flattened into timeline blocks. Builder-facing. */
  function timelineBlocks(scene) {
    var duration = computeDuration(scene);
    var blocks = [];
    (scene.camera || []).forEach(function (k, i) {
      blocks.push({ track: "camera", kind: "camera", id: k.id, index: i, start: k.t, end: k.t, point: true, label: "z" + round(k.zoom, 1) });
    });
    (scene.pins || []).forEach(function (p, i) {
      blocks.push({ track: "pins", kind: "pin", id: p.id, index: i, start: p.at, end: p.until == null ? duration : p.until, openEnded: p.until == null, label: p.label || p.id });
    });
    (scene.routes || []).forEach(function (r, i) {
      blocks.push({ track: "routes", kind: "route", id: r.id, index: i, start: r.startAt, end: r.until == null ? duration : r.until, openEnded: r.until == null, drawEnd: r.startAt + r.drawDuration, label: r.label || r.id });
    });
    (scene.countryHighlights || []).forEach(function (h, i) {
      blocks.push({ track: "highlights", kind: "highlight", id: h.id, index: i, start: h.at, end: h.until == null ? duration : h.until, openEnded: h.until == null, label: h.iso });
    });
    (scene.titles || []).forEach(function (t, i) {
      blocks.push({ track: "titles", kind: "title", id: t.id, index: i, start: t.at, end: t.until == null ? duration : t.until, openEnded: t.until == null, label: t.text || t.id });
    });
    return blocks;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULTS: DEFAULTS,
    PIN_STYLES: PIN_STYLES,
    ROUTE_CURVES: ROUTE_CURVES,
    CAMERA_TRANSITIONS: CAMERA_TRANSITIONS,
    TITLE_POSITIONS: TITLE_POSITIONS,
    easeInOutCubic: easeInOutCubic,
    easeInExpo: easeInExpo,
    linear: linear,
    normalizeScene: normalizeScene,
    serializeScene: serializeScene,
    cameraAt: cameraAt,
    fadeOpacity: fadeOpacity,
    sampleRoute: sampleRoute,
    routeStateAt: routeStateAt,
    countryHighlightsAt: countryHighlightsAt,
    computeDuration: computeDuration,
    timelineBlocks: timelineBlocks,
    unwrapLng: unwrapLng,
  };
});

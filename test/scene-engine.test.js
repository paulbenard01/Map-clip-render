/**
 * The engine is the one piece of code both the builder preview and the
 * frame-exact export depend on, so it's the piece worth pinning down.
 *
 * Run: node test/scene-engine.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const E = require("../lib/scene-engine.js");

function close(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= (tol || 1e-6), (msg || "") + ` expected ${b}, got ${a}`);
}

// ----------------------------------------------------------------- camera
function testCameraEase() {
  const s = E.normalizeScene({ camera: [
    { t: 0, center: [0, 0], zoom: 2 },
    { t: 10, center: [10, 20], zoom: 6 },
  ] });

  assert.deepStrictEqual(E.cameraAt(s, 0).center, [0, 0], "starts on the first keyframe");
  close(E.cameraAt(s, 10).zoom, 6, 1e-9, "lands exactly on the last keyframe:");
  // easeInOutCubic(0.5) === 0.5, so the midpoint is the true midpoint.
  close(E.cameraAt(s, 5).zoom, 4, 1e-9, "midpoint:");
  // Before/after the span, hold the end keyframes rather than extrapolating.
  close(E.cameraAt(s, -5).zoom, 2, 1e-9, "before the first keyframe:");
  close(E.cameraAt(s, 99).zoom, 6, 1e-9, "after the last keyframe:");
  console.log("  ok  ease interpolates and clamps at both ends");
}

function testCameraCut() {
  const s = E.normalizeScene({ camera: [
    { t: 0, center: [0, 0], zoom: 3 },
    { t: 5, center: [50, 10], zoom: 8, transition: "cut" },
  ] });

  // The whole segment holds the previous state...
  assert.deepStrictEqual(E.cameraAt(s, 0).center, [0, 0]);
  assert.deepStrictEqual(E.cameraAt(s, 4.99).center, [0, 0], "holds right up to the cut");
  close(E.cameraAt(s, 4.99).zoom, 3, 1e-9, "no zoom drift before the cut:");
  // ...then snaps exactly on the keyframe.
  assert.deepStrictEqual(E.cameraAt(s, 5).center, [50, 10], "snaps on the cut");
  close(E.cameraAt(s, 5).zoom, 8, 1e-9, "snaps zoom too:");
  console.log("  ok  cut holds then snaps, with no interpolation");
}

function testCameraZoomBlast() {
  const s = E.normalizeScene({ camera: [
    { t: 0, center: [0, 0], zoom: 2 },
    { t: 10, center: [10, 0], zoom: 12, transition: "zoomBlast" },
  ] });

  const mid = E.cameraAt(s, 5);
  // Pan is eased normally: halfway across at the halfway point.
  close(mid.center[0], 5, 1e-9, "pan still eases normally:");
  // Zoom hangs back — easeInExpo(0.5) ≈ 0.031, so barely moved.
  assert.ok(mid.zoom < 3, `zoom should hang back, got ${mid.zoom}`);
  // And still arrives exactly.
  close(E.cameraAt(s, 10).zoom, 12, 1e-9, "arrives on target:");
  console.log("  ok  zoomBlast delays the zoom but still lands on target");
}

// ------------------------------------------------------------------ fades
function testFades() {
  close(E.fadeOpacity(0, 1, 5, 0.5), 0, 1e-9, "before `at`:");
  close(E.fadeOpacity(1.25, 1, 5, 0.5), 0.5, 1e-9, "half faded in:");
  close(E.fadeOpacity(3, 1, 5, 0.5), 1, 1e-9, "fully on:");
  close(E.fadeOpacity(4.75, 1, 5, 0.5), 0.5, 1e-9, "half faded out:");
  close(E.fadeOpacity(6, 1, 5, 0.5), 0, 1e-9, "after `until`:");
  // until:null means "to the end" — never fades out.
  close(E.fadeOpacity(9999, 1, null, 0.5), 1, 1e-9, "open-ended stays on:");
  // fade:0 is a hard cut, which is what migrated focusCountry relies on.
  close(E.fadeOpacity(1, 1, null, 0), 1, 1e-9, "fade 0 is instant:");
  console.log("  ok  fades ramp in, hold, ramp out, and honour null/0");
}

// ----------------------------------------------------------------- routes
function testRouteStraight() {
  const pts = E.sampleRoute([0, 0], [10, 0], 10, "straight");
  assert.strictEqual(pts.length, 11);
  close(pts[5][0], 5, 1e-9, "midpoint lng:");
  close(pts[5][1], 0, 1e-9, "stays on the parallel:");
  console.log("  ok  straight is a plain lerp");
}

function testRouteArcBulges() {
  const straight = E.sampleRoute([0, 0], [10, 0], 10, "straight");
  const arc = E.sampleRoute([0, 0], [10, 0], 10, "arc", null, 0.3);
  close(arc[0][0], 0, 1e-9, "starts at the origin:");
  close(arc[10][0], 10, 1e-9, "ends at the destination:");
  assert.ok(arc[5][1] > straight[5][1], "an eastbound arc bows north");
  // A bigger bulge bows further.
  const bigger = E.sampleRoute([0, 0], [10, 0], 10, "arc", null, 0.6);
  assert.ok(bigger[5][1] > arc[5][1], "bulge scales the bow");
  console.log("  ok  arc bows perpendicular, scaled by bulge");
}

function testRouteViaPassesThroughTheHandle() {
  // This is the point of `via`: in the builder it's a handle you drag, so
  // the curve has to actually go where you put it.
  const via = [5, 8];
  const pts = E.sampleRoute([0, 0], [10, 0], 64, "straight", via);
  const mid = pts[32];
  close(mid[0], via[0], 1e-6, "via lng:");
  close(mid[1], via[1], 1e-6, "via lat:");
  console.log("  ok  via passes exactly through the handle");
}

function testGreatCircleIsSpherical() {
  // Tokyo -> San Francisco: a great circle rides well north of the rhumb line.
  const gc = E.sampleRoute([139.7, 35.7], [-122.4, 37.8], 32, "greatCircle");
  const straight = E.sampleRoute([139.7, 35.7], [-122.4, 37.8], 32, "straight");
  const gcMax = Math.max.apply(null, gc.map((p) => p[1]));
  const stMax = Math.max.apply(null, straight.map((p) => p[1]));
  assert.ok(gcMax > stMax + 5, `great circle should arc north, got ${gcMax} vs ${stMax}`);

  // Endpoints land where they were asked to (modulo the 360° unwrap).
  close(gc[0][0], 139.7, 1e-6, "start lng:");
  close(((gc[32][0] % 360) + 540) % 360 - 180, -122.4, 1e-6, "end lng:");

  // And the sampled line never jumps the seam, which would draw a stripe
  // straight across the map.
  for (let i = 1; i < gc.length; i++) {
    assert.ok(Math.abs(gc[i][0] - gc[i - 1][0]) < 180, "no antimeridian jump between samples");
  }
  console.log("  ok  greatCircle arcs north and stays continuous across the seam");
}

function testShortWayRound() {
  // 170E -> 170W is 20° apart across the Pacific, not 340° the other way.
  const pts = E.sampleRoute([170, 0], [-170, 0], 8, "straight");
  const span = Math.abs(pts[8][0] - pts[0][0]);
  close(span, 20, 1e-9, "takes the short way:");
  console.log("  ok  routes cross the antimeridian the short way");
}

function testRouteDrawState() {
  const r = E.normalizeScene({ routes: [{ from: [0, 0], to: [1, 1], startAt: 2, drawDuration: 4, until: null }] }).routes[0];
  close(E.routeStateAt(r, 2).drawFrac, 0, 1e-9, "not drawn yet:");
  close(E.routeStateAt(r, 4).drawFrac, 0.5, 1e-9, "halfway:");
  close(E.routeStateAt(r, 6).drawFrac, 1, 1e-9, "fully drawn:");
  close(E.routeStateAt(r, 99).drawFrac, 1, 1e-9, "stays drawn:");
  console.log("  ok  routes draw across their drawDuration");
}

// ------------------------------------------------------------- highlights
function testFocusCountryMigration() {
  const s = E.normalizeScene({ focusCountry: "IND", camera: [{ t: 0, center: [0, 0] }] });
  assert.strictEqual(s.countryHighlights.length, 1);
  assert.strictEqual(s.countryHighlights[0].iso, "IND");
  // v1 had no fade and was on for the whole clip — that has to be preserved
  // exactly or old scenes render differently than they used to.
  close(E.countryHighlightsAt(s, 0)[0].opacity, 1, 1e-9, "on from t=0:");
  close(E.countryHighlightsAt(s, 999)[0].opacity, 1, 1e-9, "still on at the end:");
  console.log("  ok  focusCountry becomes an always-on highlight");
}

function testTimedHighlights() {
  const s = E.normalizeScene({ countryHighlights: [
    { iso: "IND", at: 2, until: 8, fade: 0.5 },
    { iso: "chn", at: 8, until: null, fade: 0.5 },
  ] });
  assert.strictEqual(s.countryHighlights[1].iso, "CHN", "iso is upper-cased");
  const at0 = E.countryHighlightsAt(s, 0);
  close(at0[0].opacity, 0, 1e-9, "IND not yet:");
  const at5 = E.countryHighlightsAt(s, 5);
  close(at5[0].opacity, 1, 1e-9, "IND on:");
  close(at5[1].opacity, 0, 1e-9, "CHN not yet:");
  close(E.countryHighlightsAt(s, 20)[1].opacity, 1, 1e-9, "CHN open-ended:");
  console.log("  ok  timed multi-country highlights turn on and off");
}

// -------------------------------------------------------------- duration
function testDuration() {
  close(E.computeDuration(E.normalizeScene({ duration: 22 })), 22, 1e-9, "explicit wins:");
  const derived = E.computeDuration(E.normalizeScene({
    camera: [{ t: 0, center: [0, 0] }, { t: 10, center: [1, 1] }],
  }));
  close(derived, 11.5, 1e-9, "derived from the last keyframe plus a beat:");
  console.log("  ok  duration is explicit or derived");
}

// ------------------------------------------------------------ round-trip
function testRoundTrip() {
  const file = path.join(__dirname, "..", "scenes", "example-sarnath.json");
  const original = JSON.parse(fs.readFileSync(file, "utf8"));

  const once = E.serializeScene(original);
  const twice = E.serializeScene(once);
  assert.deepStrictEqual(twice, once, "serialize is idempotent");

  // The v1 shorthand survives a round trip rather than being rewritten.
  assert.strictEqual(once.focusCountry, "IND");
  assert.ok(!once.countryHighlights, "a lone focusCountry stays shorthand");

  // Timings and coordinates come back unchanged.
  assert.strictEqual(once.duration, 22);
  assert.strictEqual(once.camera.length, original.camera.length);
  assert.deepStrictEqual(once.camera[1].center, [83.022, 25.3811]);
  assert.strictEqual(once.pins[0].id, "sarnath");
  assert.strictEqual(once.pins[0].until, 12.5);
  assert.strictEqual(once.pins[1].until, null, "an open-ended pin stays null, not a guessed number");
  assert.strictEqual(once.routes[0].dashed, true);
  assert.strictEqual(once.titles[2].text, "Hanoi, Vietnam — 2025");

  // And the camera behaves identically before and after the trip.
  const a = E.normalizeScene(original), b = E.normalizeScene(once);
  for (let t = 0; t <= 22; t += 0.25) {
    const ca = E.cameraAt(a, t), cb = E.cameraAt(b, t);
    close(ca.center[0], cb.center[0], 1e-6, `lng at t=${t}:`);
    close(ca.zoom, cb.zoom, 1e-6, `zoom at t=${t}:`);
  }
  console.log("  ok  example scene round-trips unchanged");
}

function testNormalizeIsIdempotent() {
  const file = path.join(__dirname, "..", "scenes", "example-sarnath.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const once = E.normalizeScene(raw);
  const twice = E.normalizeScene(once);
  assert.deepStrictEqual(twice, once, "normalize twice === normalize once");
  console.log("  ok  normalize is idempotent");
}

console.log("scene-engine");
testCameraEase();
testCameraCut();
testCameraZoomBlast();
testFades();
testRouteStraight();
testRouteArcBulges();
testRouteViaPassesThroughTheHandle();
testGreatCircleIsSpherical();
testShortWayRound();
testRouteDrawState();
testFocusCountryMigration();
testTimedHighlights();
testDuration();
testRoundTrip();
function testTitleTextStyleDefaults() {
  const s = E.normalizeScene({ titles: [{ text: "Plain" }, { text: "Styled", caps: false, bold: false, color: "#ff0000" }] });
  assert.strictEqual(s.titles[0].caps, true, "caps defaults on:");
  assert.strictEqual(s.titles[0].bold, true, "bold defaults on:");
  assert.strictEqual(s.titles[0].color, null, "no colour override by default:");
  assert.strictEqual(s.titles[1].caps, false);
  assert.strictEqual(s.titles[1].bold, false);
  assert.strictEqual(s.titles[1].color, "#ff0000");

  const once = E.serializeScene(s);
  assert.strictEqual(once.titles[0].caps, undefined, "default caps is not written out:");
  assert.strictEqual(once.titles[1].caps, false, "an override is written out:");
  assert.strictEqual(once.titles[1].bold, false);
  assert.strictEqual(once.titles[1].color, "#ff0000");
  console.log("  ok  title caps/bold/colour default to the current look and round-trip");
}

function testTitleCustomPosition() {
  const s = E.normalizeScene({ titles: [{ text: "Dragged", position: "custom", x: 0.2, y: 0.85 }] });
  assert.strictEqual(s.titles[0].position, "custom");
  close(s.titles[0].x, 0.2, 1e-9, "x:");
  close(s.titles[0].y, 0.85, 1e-9, "y:");

  const serialized = E.serializeScene(s);
  assert.strictEqual(serialized.titles[0].x, 0.2);
  assert.strictEqual(serialized.titles[0].y, 0.85);

  // A non-custom title carries no x/y at all — nothing to serialize, and
  // normalizeScene ignores stray x/y on a positioned title rather than
  // treating their presence as meaningful.
  const anchored = E.normalizeScene({ titles: [{ text: "Anchored", position: "bottom-left", x: 0.9, y: 0.9 }] });
  assert.strictEqual(anchored.titles[0].x, null, "x is ignored outside custom position:");
  assert.strictEqual(E.serializeScene(anchored).titles[0].x, undefined);

  const twice = E.normalizeScene(E.normalizeScene(s));
  assert.deepStrictEqual(twice, E.normalizeScene(s), "normalize is idempotent with a custom position");
  console.log("  ok  custom title position round-trips and is idempotent");
}

function testPinAndRouteLabelStyle() {
  const s = E.normalizeScene({
    pins: [{ center: [0, 0], label: "Loud", labelCaps: false, labelBold: false }],
    routes: [{ from: [0, 0], to: [1, 1], label: "Quiet", labelCaps: false }],
  });
  assert.strictEqual(s.pins[0].labelCaps, false);
  assert.strictEqual(s.pins[0].labelBold, false);
  assert.strictEqual(s.routes[0].labelCaps, false);
  assert.strictEqual(s.routes[0].labelBold, true, "unset field still defaults on:");

  const out = E.serializeScene(s);
  assert.strictEqual(out.pins[0].labelCaps, false);
  assert.strictEqual(out.routes[0].labelCaps, false);
  assert.strictEqual(out.routes[0].labelBold, undefined, "default is not written out:");
  console.log("  ok  pin and route label style overrides round-trip");
}

testTitleTextStyleDefaults();
testTitleCustomPosition();
testPinAndRouteLabelStyle();
function testNewEasingCurves() {
  // Endpoints anchor at 0/1 for all of them — that's what keeps duration
  // and "is this visible yet" boundaries unaffected by which curve is used.
  [E.smoothstep, E.easeInOutQuint, E.easeOutBack].forEach((fn) => {
    close(fn(0), 0, 1e-9, fn.name + "(0):");
    close(fn(1), 1, 1e-9, fn.name + "(1):");
  });

  // smoothstep has zero slope at both ends — a fade should ease in rather
  // than jump at a constant rate the instant it starts.
  assert.ok(E.smoothstep(0.05) < 0.05 * 3, "smoothstep starts slower than linear");

  // easeInOutQuint holds longer at the ends than easeInOutCubic — a
  // genuinely slower glide, not just a relabelled cubic.
  assert.ok(E.easeInOutQuint(0.25) < E.easeInOutCubic(0.25), "quint lags cubic near the start");

  // easeOutBack is the whole point of "organic": it actually overshoots
  // past the target before settling, unlike every other curve here.
  const overshoots = Array.from({ length: 20 }, (_, i) => E.easeOutBack(i / 19)).some((v) => v > 1.001);
  assert.ok(overshoots, "easeOutBack should overshoot past 1 somewhere in its range");
  console.log("  ok  smoothstep/easeInOutQuint/easeOutBack behave as advertised");
}

function testCameraSmoothAndOrganicTransitions() {
  const smooth = E.normalizeScene({ camera: [
    { t: 0, center: [0, 0], zoom: 2 },
    { t: 10, center: [10, 0], zoom: 12, transition: "smooth" },
  ] });
  // A slower glide: further behind at the 25% mark than the default ease.
  const smoothAt25 = E.cameraAt(smooth, 2.5).center[0];
  const easeScene = E.normalizeScene({ camera: [
    { t: 0, center: [0, 0], zoom: 2 }, { t: 10, center: [10, 0], zoom: 12 },
  ] });
  const easeAt25 = E.cameraAt(easeScene, 2.5).center[0];
  assert.ok(smoothAt25 < easeAt25, "smooth lags the default ease early in the move");
  close(E.cameraAt(smooth, 10).center[0], 10, 1e-9, "smooth still lands exactly on target:");

  const organic = E.normalizeScene({ camera: [
    { t: 0, center: [0, 0], zoom: 2 },
    { t: 10, center: [10, 0], zoom: 2, transition: "organic" },
  ] });
  // Somewhere before arrival, the camera should actually pass the target
  // and come back — that's the overshoot-and-settle "organic" is for.
  const overshootsPastTarget = Array.from({ length: 40 }, (_, i) => E.cameraAt(organic, i / 39 * 10).center[0])
    .some((lng) => lng > 10.001);
  assert.ok(overshootsPastTarget, "organic transition should drift past the target before settling");
  close(E.cameraAt(organic, 10).center[0], 10, 1e-9, "organic still lands exactly on target:");
  console.log("  ok  smooth glides slower, organic overshoots then settles, both land exactly");
}

function testEasedFadeAndRouteDrawStillAnchorCorrectly() {
  // The shape changed; the boundaries — invisible before `at`, fully
  // resolved once settled, gone after `until` — must not have moved.
  close(E.fadeOpacity(0.999, 1, 5, 0.5), 0, 1e-6, "still invisible right before `at`:");
  close(E.fadeOpacity(1.5, 1, 5, 0.5), 1, 1e-9, "fully faded in once settled:");
  close(E.fadeOpacity(5.001, 1, 5, 0.5), 0, 1e-6, "gone right after `until`:");

  const r = E.normalizeScene({ routes: [{ from: [0, 0], to: [1, 1], startAt: 2, drawDuration: 4 }] }).routes[0];
  close(E.routeStateAt(r, 2).drawFrac, 0, 1e-9, "route not drawn yet:");
  close(E.routeStateAt(r, 6).drawFrac, 1, 1e-9, "route fully drawn once its duration elapses:");
  // The curve is what changed — the 25% mark should now be further behind
  // than a constant-speed draw would have it.
  assert.ok(E.routeStateAt(r, 3).drawFrac < 0.25, "eased draw lags a constant-speed draw early on");
  console.log("  ok  eased fade/route-draw curves keep their timing boundaries, only the shape changed");
}

testNewEasingCurves();
testCameraSmoothAndOrganicTransitions();
testEasedFadeAndRouteDrawStillAnchorCorrectly();
testNormalizeIsIdempotent();
console.log("all scene-engine tests passed");

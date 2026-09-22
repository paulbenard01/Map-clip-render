/**
 * Explainer engine (portrait, or landscape with ?format=landscape): the core.
 *
 * Every visual is a pure function of time. A scene file calls the builders
 * below (V.photo, V.title, V.tag, ...) once to describe the whole video, and
 * the renderer then calls window.__setFrame(t) for each frame and takes a
 * screenshot. No CSS animations, no timers, no requestAnimationFrame: the
 * same t always produces the same picture, so any frame can be rendered in
 * any order (which is what lets several browsers render slices in parallel).
 */
(function () {
  const V = (window.V = {});
  // Portrait (1080x1920, Shorts) by default; ?format=landscape gives 1920x1080.
  V.landscape = new URLSearchParams(location.search).get("format") === "landscape";
  V.W = V.landscape ? 1920 : 1080;
  V.H = V.landscape ? 1080 : 1920;
  document.documentElement.classList.toggle("landscape", V.landscape);
  document.documentElement.style.setProperty("--W", V.W + "px");
  document.documentElement.style.setProperty("--H", V.H + "px");

  // ---------- maths ----------
  V.clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  V.lerp = (a, b, t) => a + (b - a) * t;
  V.prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : V.clamp((t - a) / (b - a)));
  V.ease = {
    linear: (x) => x,
    inCubic: (x) => x * x * x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuart: (x) => 1 - Math.pow(1 - x, 4),
    inOutQuart: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    outBack: (x) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  // Deterministic pseudo-random, so "random" wobble is identical every render.
  V.rand = (seed) => { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

  /** Keyframes: [[t, value], ...] where value is a number or an array of numbers. */
  V.kf = (t, frames, ease = V.ease.inOutCubic) => {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1, e1] = frames[i];
      if (t <= t1) {
        const [t0, v0] = frames[i - 1];
        const p = (e1 || ease)(V.prog(t, t0, t1));
        return Array.isArray(v0) ? v0.map((a, k) => V.lerp(a, v1[k], p)) : V.lerp(v0, v1, p);
      }
    }
    return frames[frames.length - 1][1];
  };

  /**
   * In/out envelope for an element living from t0 to t1.
   * a: entrance progress (eased), b: exit progress (eased), on: visible at all.
   */
  V.env = (t, t0, t1, inDur = 0.4, outDur = 0.3, inEase = V.ease.outCubic, outEase = V.ease.inCubic) => ({
    a: inEase(V.prog(t, t0, t0 + inDur)),
    b: outEase(V.prog(t, t1 - outDur, t1)),
    on: t >= t0 && t <= t1,
  });

  // ---------- stage and registry ----------
  V.items = [];
  V.pending = [];
  V.layers = {};

  V.setup = () => {
    const stage = document.getElementById("stage");
    const mk = (id, tag = "div") => {
      const el = tag === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement(tag);
      el.id = id;
      el.setAttribute("class", "layer");
      if (tag === "canvas") { el.width = V.W; el.height = V.H; }
      stage.appendChild(el);
      return el;
    };
    V.layers.bg = mk("bg", "canvas");
    V.layers.map = mk("map", "canvas");
    V.layers.back = mk("back");      // full-bleed photos above the map
    V.layers.media = mk("media");
    V.layers.ink = mk("ink", "svg");  // marker annotations
    V.layers.ink.setAttribute("viewBox", `0 0 ${V.W} ${V.H}`);
    V.layers.text = mk("text");
    V.layers.subs = mk("subs");
    V.layers.vignette = mk("vignette");
    V.layers.fx = mk("fx", "canvas");
    V.layers.end = mk("end");
    V.stage = stage;
  };

  V.add = (item) => { V.items.push(item); return item; };

  V.setFrame = (t) => {
    V.t = t;
    for (const it of V.items) {
      const on = t >= it.t0 && t <= it.t1;
      if (it.el) {
        if (on !== it._on) it.el.style.display = on ? "" : "none";
      }
      it._on = on;
      if (on || it.always) it.update(t);
    }
    if (V.map) V.map.draw(t);
    if (V.fx) V.fx.draw(t);
  };

  V.loadImage = (src) => {
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    V.pending.push(p);
    return p;
  };

  V.ready = async () => {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load("800 40px Playfair"), document.fonts.load("900 40px Playfair"),
      document.fonts.load("italic 700 40px Playfair"), document.fonts.load("800 40px Inter"),
      document.fonts.load("900 40px Inter"), document.fonts.load("700 40px Mono"),
    ]);
    await Promise.all(V.pending);
  };

  // ---------- helpers for DOM items ----------
  const el = (cls, parent, html) => {
    const d = document.createElement("div");
    d.className = cls;
    if (html != null) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  };
  V.el = el;

  // ---------- landscape layout ----------
  /**
   * Scenes are written in portrait coordinates. In landscape every item is
   * mapped by one affine transform: the portrait content column (y 140..1400)
   * is scaled by LS and centred in the 16:9 frame, and the item is drawn at
   * LS of its size, so relative placements (a circle on a photo) hold.
   * `land: { x, y, k, ... }` overrides the result per item, in landscape px
   * (k is the drawing scale). Text-led items (titles, counters, documents)
   * default to a slightly larger k than LS so they stay readable.
   */
  const LS = 0.65;
  V.LS = LS;
  V.lx = (x) => (V.landscape ? 960 + (x - 540) * LS : x);
  V.ly = (y) => (V.landscape ? 60 + (y - 140) * LS : y);
  V.adapt = (o, k = LS) => {
    if (!V.landscape) return o;
    const r = { ...o };
    if (o.frame !== "full") {
      if (o.x != null) r.x = V.lx(o.x);
      if (o.y != null) r.y = V.ly(o.y);
      if (o.x2 != null) r.x2 = V.lx(o.x2);
      if (o.y2 != null) r.y2 = V.ly(o.y2);
      if (o.rx != null) r.rx = o.rx * LS;
      if (o.ry != null) r.ry = o.ry * LS;
      if (o.dist != null) r.dist = o.dist * LS;
      if (o.move) r.move = o.move.map(([t, v, e]) => [t, [V.lx(v[0]), V.ly(v[1]), ...v.slice(2)], e]);
      r.k = k;
    }
    if (o.land) Object.assign(r, o.land);
    return r;
  };

  // Entrance/exit offsets by direction name.
  const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

  /**
   * Shared motion for anything positioned by its centre: entrance and exit
   * moves, a slow "handheld" drift, optional scale keyframes.
   */
  function motion(t, o, env) {
    let x = o.x, y = o.y, s = o.scale || 1, r = o.rot || 0, alpha = 1;
    const dist = o.dist || 260;
    const enter = o.enter || "fade", exit = o.exit || "fade";
    if (enter === "pop") { s *= V.lerp(0.55, 1, V.ease.outBack(V.prog(t, o.t0, o.t0 + (o.inDur || 0.4)))); alpha *= V.prog(t, o.t0, o.t0 + 0.12); }
    else if (enter === "zoom") { s *= V.lerp(1.25, 1, env.a); alpha *= env.a; }
    else if (enter === "slam") { s *= V.lerp(1.7, 1, V.ease.outQuart(V.prog(t, o.t0, o.t0 + 0.2))); alpha *= V.prog(t, o.t0, o.t0 + 0.08); }
    else if (DIRS[enter]) { x += DIRS[enter][0] * dist * (1 - env.a); y += DIRS[enter][1] * dist * (1 - env.a); r += (o.spin || 0) * (1 - env.a); alpha *= Math.min(1, env.a * 3); }
    else if (enter !== "cut") alpha *= env.a;

    if (exit === "zoom") { s *= V.lerp(1, 1.3, env.b); alpha *= 1 - env.b; }
    else if (exit === "shrink") { s *= V.lerp(1, 0.6, env.b); alpha *= 1 - env.b; }
    else if (DIRS[exit]) { x += DIRS[exit][0] * (dist + 400) * env.b; y += DIRS[exit][1] * (dist + 400) * env.b; alpha *= 1 - env.b * 0.3; }
    else if (exit !== "cut") alpha *= 1 - env.b;

    if (o.move) { const m = V.kf(t, o.move); x = m[0] + (x - o.x); y = m[1] + (y - o.y); if (m.length > 2) s *= m[2] / (o.scale || 1); if (m.length > 3) r += m[3] - (o.rot || 0); }
    if (o.drift !== false) {
      const seed = o.seed || 1;
      x += Math.sin(t * 0.37 + seed) * 5;
      y += Math.cos(t * 0.29 + seed * 2) * 5;
      r += Math.sin(t * 0.23 + seed * 3) * 0.35;
    }
    if (o.opacity) alpha *= V.kf(t, o.opacity);
    s *= o.k || 1;
    return { x, y, s, r, alpha };
  }
  V.motion = motion;

  function place(node, m, w, h) {
    node.style.transform = `translate(${(m.x - w / 2).toFixed(2)}px, ${(m.y - h / 2).toFixed(2)}px) rotate(${m.r.toFixed(3)}deg) scale(${m.s.toFixed(4)})`;
    node.style.opacity = V.clamp(m.alpha).toFixed(3);
  }
  V.place = place;

  let seedCounter = 1;

  // ---------- photo ----------
  /**
   * o: { src, label, t0, t1, x, y, w, h, rot, frame: print|plain|full|circle,
   *      enter, exit, inDur, outDur, kb: [scaleFrom, scaleTo], pan: [dx0, dy0, dx1, dy1] (px),
   *      focus: "50% 50%", dim: 0..1 (full frames), layer }
   */
  V.photo = (o) => {
    o = V.adapt(o);
    o.seed = o.seed || seedCounter++;
    const frame = o.frame || "print";
    if (frame === "full") { o.x = o.x ?? V.W / 2; o.y = o.y ?? V.H / 2; o.w = o.w ?? V.W + 40; o.h = o.h ?? V.H + 40; o.drift = false; }
    const parent = o.layer ? V.layers[o.layer] : frame === "full" ? V.layers.back : V.layers.media;
    const node = el("photo " + frame, parent);
    node.style.width = o.w + "px";
    node.style.height = o.h + "px";
    node.style.transformOrigin = "50% 50%";
    const inner = el("inner", node);
    let img = null;
    const ph = () => {
      inner.innerHTML = `<div class="ph">${ICON_PHOTO}<b>${o.label || "photo"}</b>${o.note ? `<i>${o.note}</i>` : ""}</div>`;
    };
    if (o.src) {
      img = document.createElement("img");
      img.style.objectPosition = o.focus || "50% 50%";
      V.loadImage(o.src).then((loaded) => { if (loaded) inner.appendChild(img); else ph(); });
      img.src = o.src;
    } else ph();
    let dim = null;
    if (frame === "full" || o.dim) { dim = el("dim", inner); }
    V.add({
      t0: o.t0, t1: o.t1, el: node,
      update(t) {
        const env = V.env(t, o.t0, o.t1, o.inDur || 0.45, o.outDur || 0.35, V.ease.outCubic, V.ease.inCubic);
        const m = motion(t, o, env);
        place(node, m, o.w, o.h);
        if (img) {
          const p = V.prog(t, o.t0, o.t1);
          const kb = o.kb || [1.04, 1.14];
          const s = V.lerp(kb[0], kb[1], V.ease.inOutSine(p));
          const pan = o.pan || [0, 0, 0, 0];
          const dx = V.lerp(pan[0], pan[2], V.ease.inOutSine(p));
          const dy = V.lerp(pan[1], pan[3], V.ease.inOutSine(p));
          img.style.transform = `translate(-50%, -50%) translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${s.toFixed(4)})`;
        }
        if (dim) dim.style.opacity = (o.dimKf ? V.kf(t, o.dimKf) : o.dim ?? 1).toFixed(3);
      },
    });
    return o;
  };

  const ICON_PHOTO = `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A24B" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="2"/><path d="M3 17l5-5 4 4 3-3 6 6"/></svg>`;

  // ---------- generic positioned DOM box ----------
  /** Any HTML (or SVG) positioned by centre with the shared motion. */
  V.box = (o) => {
    o = V.adapt(o);
    o.seed = o.seed || seedCounter++;
    const node = el(o.cls || "", V.layers[o.layer || "media"], o.html);
    node.style.position = "absolute";
    node.style.left = "0"; node.style.top = "0";
    node.style.width = o.w + "px";
    if (o.h) node.style.height = o.h + "px";
    V.add({
      t0: o.t0, t1: o.t1, el: node,
      update(t) {
        const env = V.env(t, o.t0, o.t1, o.inDur || 0.4, o.outDur || 0.3);
        const m = motion(t, o, env);
        place(node, m, o.w, o.h || node.offsetHeight);
        if (o.tick) o.tick(t, node, env);
      },
    });
    return node;
  };

  // ---------- tag ----------
  /** Mono label chip. Wipes in from the left. o: { text, sub, t0, t1, x, y, align: left|center|right, color } */
  V.tag = (o) => {
    o = V.adapt(o);
    const k = o.k || 1;
    const node = el("tag " + (o.color || "gold"), V.layers[o.layer || "text"], o.text + (o.sub ? `<small>${o.sub}</small>` : ""));
    if (o.size) node.style.fontSize = o.size + "px";
    o.seed = o.seed || seedCounter++;
    V.add({
      t0: o.t0, t1: o.t1, el: node,
      update(t) {
        const w = node.offsetWidth, h = node.offsetHeight;
        const a = V.ease.outQuart(V.prog(t, o.t0, o.t0 + 0.35));
        const b = V.ease.inCubic(V.prog(t, o.t1 - 0.25, o.t1));
        const align = o.align || "center";
        // Scaled about its centre, so shift left/right-aligned tags to keep their edge.
        const x = align === "left" ? o.x - (w * (1 - k)) / 2 : align === "right" ? o.x - w + (w * (1 - k)) / 2 : o.x - w / 2;
        const y = o.y - h / 2 + (o.drift === false ? 0 : Math.sin(t * 0.4 + o.seed) * 3);
        node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(o.rot || 0)}deg) scale(${k})`;
        const inset = align === "right" ? `inset(0 0 0 ${(1 - a) * 100}%)` : `inset(0 ${(1 - a) * 100}% 0 0)`;
        node.style.clipPath = inset;
        node.style.opacity = (1 - b).toFixed(3);
      },
    });
    return node;
  };

  // ---------- kinetic title ----------
  /**
   * Words pop in one by one. o: { text, t0, t1, x, y, w, size, style: serif|serif-i|sans,
   *   at: [times per word] | stagger: s, hl: [word indices], rd: [...], anim: rise|slam|fade, align }
   * Use `sync: true` to take each word's time from the voiceover transcript.
   */
  V.title = (o) => {
    o = V.adapt(o, 0.8);
    const k = o.k || 1;
    const node = el("title " + (o.style || "serif"), V.layers[o.layer || "text"]);
    node.style.fontSize = (o.size || 96) + "px";
    node.style.width = (o.w || 960) + "px";
    if (o.align) node.style.textAlign = o.align;
    if (o.color) node.style.color = o.color;
    if (o.lh) node.style.lineHeight = o.lh;
    const words = o.text.split(" ");
    const spans = words.map((wd, i) => {
      if (wd === "\\n") { node.appendChild(document.createElement("br")); return null; }
      const s = document.createElement("span");
      s.className = "w" + ((o.hl || []).includes(i) ? " hl" : "") + ((o.rd || []).includes(i) ? " rd" : "");
      s.textContent = wd;
      node.appendChild(s);
      if (i < words.length - 1 && words[i + 1] !== "\\n") node.appendChild(document.createTextNode(" "));
      return s;
    });
    let times = o.at;
    if (!times && o.sync) times = V.syncTimes(words.filter((w) => w !== "\\n"), o.t0);
    const real = spans.filter(Boolean);
    const at = real.map((_, i) => (times ? times[i] : o.t0 + i * (o.stagger ?? 0.07)));
    o.seed = o.seed || seedCounter++;
    V.add({
      t0: Math.min(o.t0, at[0]), t1: o.t1, el: node,
      update(t) {
        const w = node.offsetWidth, h = node.offsetHeight;
        const b = V.ease.inCubic(V.prog(t, o.t1 - (o.outDur || 0.3), o.t1));
        const align = o.align || "center";
        const x = align === "left" ? o.x - (w * (1 - k)) / 2 : align === "right" ? o.x - w + (w * (1 - k)) / 2 : o.x - w / 2;
        let y = o.y - h / 2;
        if (o.drift !== false) y += Math.sin(t * 0.35 + o.seed) * 3;
        const exitY = o.exit === "up" ? -120 * k * b : 0;
        node.style.transform = `translate(${x.toFixed(1)}px, ${(y + exitY).toFixed(1)}px) scale(${((o.exit === "shrink" ? V.lerp(1, 0.7, b) : 1) * k).toFixed(4)})`;
        node.style.opacity = (1 - b).toFixed(3);
        real.forEach((s, i) => {
          const p = V.prog(t, at[i], at[i] + (o.anim === "slam" ? 0.16 : 0.26));
          if (o.anim === "slam") {
            s.style.transform = `scale(${V.lerp(1.5, 1, V.ease.outQuart(p)).toFixed(3)})`;
            s.style.opacity = V.clamp(p * 3).toFixed(3);
          } else if (o.anim === "fade") {
            s.style.opacity = p.toFixed(3);
          } else {
            const e = V.ease.outBack(p);
            s.style.transform = `translateY(${((1 - e) * 0.45).toFixed(3)}em)`;
            s.style.opacity = V.clamp(p * 2.5).toFixed(3);
          }
        });
      },
    });
    return node;
  };

  // ---------- counter ----------
  /** o: { t0, t1, x, y, from, to, dur, size, label, fmt(v), prefix, suffix } */
  V.counter = (o) => {
    o = V.adapt(o, 0.75);
    const node = el("counter", V.layers[o.layer || "text"]);
    node.style.fontSize = (o.size || 180) + "px";
    const num = el("n", node);
    if (o.label) { const l = el("lbl", node, o.label); l.style.fontSize = (o.labelSize || 34) + "px"; }
    const fmt = o.fmt || ((v) => Math.round(v).toLocaleString("en-US"));
    o.seed = o.seed || seedCounter++;
    V.add({
      t0: o.t0, t1: o.t1, el: node,
      update(t) {
        const p = V.ease.outExpo(V.prog(t, o.t0 + (o.delay || 0), o.t0 + (o.delay || 0) + (o.dur || 1)));
        num.textContent = (o.prefix || "") + fmt(V.lerp(o.from || 0, o.to, p)) + (o.suffix || "");
        const env = V.env(t, o.t0, o.t1, 0.25, 0.3);
        const m = motion(t, { ...o, enter: o.enter || "pop" }, env);
        place(node, m, node.offsetWidth, node.offsetHeight);
      },
    });
    return node;
  };

  // ---------- stamp ----------
  V.stamp = (o) => {
    o = V.adapt(o);
    const node = el("stamp" + (o.red ? " red" : ""), V.layers[o.layer || "text"], o.text);
    node.style.fontSize = (o.size || 44) + "px";
    V.add({
      t0: o.t0, t1: o.t1, el: node,
      update(t) {
        const p = V.prog(t, o.t0, o.t0 + 0.18);
        const s = V.lerp(2.1, 1, V.ease.outQuart(p));
        // A small settle after the hit, so it lands rather than floats in.
        const shake = p >= 1 ? Math.sin((t - o.t0) * 60) * 4 * Math.exp(-(t - o.t0 - 0.18) * 14) : 0;
        const b = V.prog(t, o.t1 - 0.25, o.t1);
        const w = node.offsetWidth, h = node.offsetHeight;
        node.style.transform = `translate(${(o.x - w / 2 + shake).toFixed(1)}px, ${(o.y - h / 2).toFixed(1)}px) rotate(${o.rot || -6}deg) scale(${(s * (o.k || 1)).toFixed(3)})`;
        node.style.opacity = (V.clamp(p * 4) * (1 - b)).toFixed(3);
      },
    });
    return node;
  };

  // ---------- document card ----------
  /**
   * Paper card with highlighter sweeps.
   * o: { t0, t1, x, y, w, rot, head, title, body (HTML with <m data-at="t" data-dur="d">...</m>), source, sans }
   */
  V.doc = (o) => {
    o = V.adapt(o, 0.8);
    const marks = (h) => h.replace(/<m /g, '<span class="mark" ').replace(/<\/m>/g, "</span>");
    const html =
      (o.head ? `<div class="dh">${o.head}</div>` : "") +
      (o.title ? `<div class="dt">${marks(o.title)}</div>` : "") +
      (o.body ? `<div class="db${o.sans ? " sans" : ""}">${marks(o.body)}</div>` : "") +
      (o.bars ? Array.from({ length: o.bars }, () => '<div class="bar"></div>').join("") : "") +
      (o.source ? `<div class="ds">${o.source}</div>` : "");
    const node = el("doc", V.layers[o.layer || "media"], html);
    node.style.width = o.w + "px";
    const hls = [...node.querySelectorAll(".mark")].map((m) => {
      if (m.dataset.kind === "strike") m.classList.add("strike-m");
      return { m, at: +m.dataset.at, dur: +(m.dataset.dur || 0.6), strike: m.dataset.kind === "strike" };
    });
    o.seed = o.seed || seedCounter++;
    V.add({
      t0: o.t0, t1: o.t1, el: node,
      update(t) {
        const env = V.env(t, o.t0, o.t1, 0.5, 0.35);
        const m = motion(t, { ...o, enter: o.enter || "up", dist: 500 * (o.k || 1) }, env);
        place(node, m, o.w, node.offsetHeight);
        for (const k of hls) k.m.style.backgroundSize = `${(V.ease.inOutCubic(V.prog(t, k.at, k.at + k.dur)) * 100).toFixed(1)}% ${k.strike ? "7px" : "78%"}`;
        if (o.tick) o.tick(t, node);
      },
    });
    return node;
  };

  // ---------- marker annotations ----------
  const SVGNS = "http://www.w3.org/2000/svg";
  /** Hand-drawn ellipse path around (cx, cy) with radii rx, ry, overshooting its start. */
  function wobblyEllipse(cx, cy, rx, ry, seed) {
    const pts = [];
    const n = 48, start = -2.2 + V.rand(seed) * 0.6, sweep = Math.PI * 2 + 0.55;
    for (let i = 0; i <= n; i++) {
      const a = start + (sweep * i) / n;
      const wob = 1 + (V.rand(seed + i * 0.37) - 0.5) * 0.035 + (i / n) * 0.07;
      pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
    }
    return "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L");
  }
  function wobblyLine(x1, y1, x2, y2, seed) {
    const n = 16, pts = [];
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      pts.push([V.lerp(x1, x2, p), V.lerp(y1, y2, p) + Math.sin(p * Math.PI) * (V.rand(seed) - 0.5) * 18 + (V.rand(seed + i) - 0.5) * 3]);
    }
    return "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L");
  }
  function arrowPath(x1, y1, x2, y2, bend) {
    const mx = (x1 + x2) / 2 - (y2 - y1) * bend, my = (y1 + y2) / 2 + (x2 - x1) * bend;
    return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
  }

  /**
   * o: { kind: circle|underline|strike|arrow|x, t0, t1, dur, x, y, rx, ry, x2, y2, bend, color, width }
   */
  V.marker = (o) => {
    o = V.adapt(o);
    const g = document.createElementNS(SVGNS, "g");
    V.layers.ink.appendChild(g);
    const seed = o.seed || seedCounter++;
    const mkPath = (d) => {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", o.color || "#E2BE6A");
      p.setAttribute("stroke-width", (o.width || 9) * (o.k || 1));
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
      p.style.filter = "drop-shadow(0 3px 6px rgba(0,0,0,.55))";
      g.appendChild(p);
      return p;
    };
    const paths = [];
    if (o.kind === "circle") paths.push(mkPath(wobblyEllipse(o.x, o.y, o.rx, o.ry || o.rx, seed)));
    else if (o.kind === "underline" || o.kind === "strike") paths.push(mkPath(wobblyLine(o.x, o.y, o.x2, o.y2 ?? o.y, seed)));
    else if (o.kind === "x") {
      paths.push(mkPath(wobblyLine(o.x - o.rx, o.y - o.rx, o.x + o.rx, o.y + o.rx, seed)));
      paths.push(mkPath(wobblyLine(o.x + o.rx, o.y - o.rx, o.x - o.rx, o.y + o.rx, seed + 3)));
    } else if (o.kind === "arrow") {
      paths.push(mkPath(arrowPath(o.x, o.y, o.x2, o.y2, o.bend ?? 0.2)));
      // Head: two short strokes back along the end tangent.
      const bend = o.bend ?? 0.2;
      const mx = (o.x + o.x2) / 2 - (o.y2 - o.y) * bend, my = (o.y + o.y2) / 2 + (o.x2 - o.x) * bend;
      const ang = Math.atan2(o.y2 - my, o.x2 - mx);
      const L = 34 * (o.k || 1);
      paths.push(mkPath(`M${o.x2 - Math.cos(ang - 0.5) * L},${o.y2 - Math.sin(ang - 0.5) * L} L${o.x2},${o.y2} L${o.x2 - Math.cos(ang + 0.5) * L},${o.y2 - Math.sin(ang + 0.5) * L}`));
    }
    const lens = paths.map((p) => p.getTotalLength());
    paths.forEach((p, i) => { p.style.strokeDasharray = lens[i] + " " + lens[i]; });
    const dur = o.dur || 0.45;
    V.add({
      t0: o.t0, t1: o.t1, el: null,
      update(t) {
        g.style.display = "";
        // Several strokes draw one after the other within `dur`.
        paths.forEach((p, i) => {
          const a = o.t0 + (dur * i) / paths.length, b = o.t0 + (dur * (i + 1)) / paths.length;
          const pr = V.ease.inOutCubic(V.prog(t, a, b));
          p.style.strokeDashoffset = (lens[i] * (1 - pr)).toFixed(1);
        });
        g.style.opacity = (1 - V.prog(t, o.t1 - 0.25, o.t1)).toFixed(3);
      },
    });
    // Hide outside the window (markers have no wrapper element in the registry).
    V.add({ t0: -1, t1: 1e9, always: true, update(t) { if (t < o.t0 || t > o.t1) g.style.display = "none"; } });
    return g;
  };

  // ---------- full-frame colour wash (for hard section breaks) ----------
  V.wash = (o) => {
    const node = el("", V.layers[o.layer || "back"]);
    node.style.cssText = `position:absolute;inset:0;background:${o.color || "var(--navy)"}`;
    V.add({ t0: o.t0, t1: o.t1, el: node, update(t) { node.style.opacity = V.kf(t, o.opacity).toFixed(3); } });
    return node;
  };
})();

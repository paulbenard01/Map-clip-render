/**
 * The map layer: shaded-relief terrain in Heritle navy, country borders and
 * highlights, rivers, pins, arcs and labels, all on one canvas and all driven
 * by keyframes on the same clock as everything else.
 *
 * Projection: equidistant cylindrical with a 20 degree standard parallel.
 * It is plate carree with longitude squeezed by cos(20), which keeps the
 * Natural Earth relief (itself plate carree) an affine image: the terrain is
 * just drawImage under the same canvas transform as the vector layers.
 */
(function () {
  const V = window.V;
  const K = Math.cos((20 * Math.PI) / 180);
  const COLORS = {
    gold: [226, 190, 106],
    red: [224, 104, 91],
    cream: [243, 235, 218],
    blue: [120, 160, 220],
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function ringsOf(geom) {
    if (!geom) return [];
    if (geom.type === "Polygon") return [geom.coordinates];
    if (geom.type === "MultiPolygon") return geom.coordinates;
    return [];
  }
  function ringArea(r) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return a / 2;
  }
  function ringCentroid(r) {
    let x = 0, y = 0, a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      x += (r[j][0] + r[i][0]) * f;
      y += (r[j][1] + r[i][1]) * f;
      a += f;
    }
    return [x / (3 * a), y / (3 * a)];
  }

  function feather(img, f) {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = "destination-out";
    const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.fillRect(rx, ry, rw, rh);
    };
    const W = c.width, H = c.height;
    edge(0, 0, f, 0, 0, 0, f, H);
    edge(W, 0, W - f, 0, W - f, 0, f, H);
    edge(0, 0, 0, f, 0, 0, W, f);
    edge(0, H, 0, H - f, 0, H - f, W, f);
    return c;
  }

  V.makeMap = async (cfg) => {
    const base = cfg.dataUrl || "/data/";
    const [meta, countries, rivers] = await Promise.all([
      fetch(base + "video/terrain.json").then((r) => r.json()),
      fetch(base + "countries.geo.json").then((r) => r.json()),
      fetch(base + "video/rivers.geo.json").then((r) => r.json()).catch(() => ({ features: [] })),
    ]);
    const terr = [];
    for (const key of ["world", "asia"]) {
      const m = meta[key];
      let img = await V.loadImage(base + "video/" + m.file);
      if (!img) continue;
      // Feather the regional crop so its edges melt into the world layer.
      if (key !== "world") img = feather(img, 3 * m.ppd);
      terr.push({ ...m, img, key });
    }

    // Country paths in degree space ([lon*K, -lat]), built once.
    const byIso = {};
    const all = [];
    for (const f of countries.features) {
      const p = new Path2D();
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, best = null, bestA = 0;
      for (const poly of ringsOf(f.geometry)) {
        poly.forEach((ring, ri) => {
          let prev = null;
          ring.forEach(([lon, lat], i) => {
            const x = lon * K, y = -lat;
            // Rings that wrap the antimeridian (Russia, Fiji) would otherwise
            // draw a line straight across the world.
            if (i === 0 || Math.abs(lon - prev) > 180) p.moveTo(x, y); else p.lineTo(x, y);
            prev = lon;
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          });
          p.closePath();
          if (ri === 0) { const a = Math.abs(ringArea(ring)); if (a > bestA) { bestA = a; best = ring; } }
        });
      }
      const c = { id: f.properties.id, name: f.properties.name, path: p, bbox: [minX, minY, maxX, maxY], centroid: best ? ringCentroid(best) : [0, 0] };
      all.push(c);
      if (c.id) byIso[c.id] = c;
    }

    const riverPaths = rivers.features.map((f) => {
      const p = new Path2D();
      for (const line of f.geometry.coordinates) line.forEach(([lon, lat], i) => (i ? p.lineTo(lon * K, -lat) : p.moveTo(lon * K, -lat)));
      return { name: f.properties.name, rank: f.properties.rank, path: p };
    });

    const canvas = V.layers.map;
    const ctx = canvas.getContext("2d");

    const map = {
      cfg, byIso, K,
      cam: { lon: 80, lat: 25, z: 10 },
      centroid: (iso) => byIso[iso].centroid,
      /** Geo -> screen for the current camera. */
      xy(lon, lat) {
        const c = this.cam;
        return [c.cx + (lon - c.lon) * K * c.z, c.cy - (lat - c.lat) * c.z];
      },
      draw(t) { draw(t); },
    };

    function camAt(t) {
      const cams = cfg.cams;
      let c = cams[0];
      if (t <= cams[0][0]) c = cams[0];
      else if (t >= cams[cams.length - 1][0]) c = cams[cams.length - 1];
      else {
        for (let i = 1; i < cams.length; i++) {
          if (t <= cams[i][0]) {
            const a = cams[i - 1], b = cams[i];
            const e = (b[5] && V.ease[b[5]]) || V.ease.inOutCubic;
            const p = e(V.prog(t, a[0], b[0]));
            // Zoom interpolates in log space so a big push feels even.
            const z = Math.exp(V.lerp(Math.log(a[3]), Math.log(b[3]), p));
            // Pan speed follows zoom: move the centre in screen-space units
            // at the geometric-mean scale, which avoids the "swoop" of a
            // linear pan during a deep zoom.
            const za = a[3], zb = b[3];
            const w = za === zb ? p : (1 / za - 1 / z) / (1 / za - 1 / zb);
            const q = za === zb ? p : V.clamp(w);
            return { lon: V.lerp(a[1], b[1], q), lat: V.lerp(a[2], b[2], q), z, cy: V.lerp(a[4] ?? cfg.cy ?? 860, b[4] ?? cfg.cy ?? 860, p) };
          }
        }
      }
      return { lon: c[1], lat: c[2], z: c[3], cy: c[4] ?? cfg.cy ?? 860 };
    }

    // Fade helper for anything with t0/t1 and optional fin/fout.
    const fade = (t, o, fin = 0.5, fout = 0.5) =>
      Math.min(V.ease.outCubic(V.prog(t, o.t0, o.t0 + (o.fin ?? fin))), 1 - V.ease.inCubic(V.prog(t, o.t1 - (o.fout ?? fout), o.t1)));

    function draw(t) {
      const alpha = cfg.alpha ? V.kf(t, cfg.alpha, V.ease.linear) : 1;
      canvas.style.opacity = alpha.toFixed(3);
      if (alpha <= 0.001) { canvas.style.display = "none"; return; }
      canvas.style.display = "";

      const cam = camAt(t);
      cam.cx = V.W / 2;
      map.cam = cam;
      const z = cam.z;
      const tx = cam.cx - cam.lon * K * z, ty = cam.cy + cam.lat * z;
      // Visible degree-space box.
      const X0 = -tx / z, X1 = (V.W - tx) / z, Y0 = -ty / z, Y1 = (V.H - ty) / z;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#09101f";
      ctx.fillRect(0, 0, V.W, V.H);
      ctx.setTransform(z, 0, 0, z, tx, ty);

      // Terrain: world underneath, the sharper Asia crop on top when it helps.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (const tr of terr) {
        if (tr.key === "asia" && z < 9) continue;
        const lonA = Math.max(tr.west, X0 / K), lonB = Math.min(tr.east, X1 / K);
        const latA = Math.min(tr.north, -Y0), latB = Math.max(tr.south, -Y1);
        if (lonB <= lonA || latA <= latB) continue;
        const sx = (lonA - tr.west) * tr.ppd, sy = (tr.north - latA) * tr.ppd;
        const sw = (lonB - lonA) * tr.ppd, sh = (latA - latB) * tr.ppd;
        ctx.drawImage(tr.img, sx, sy, sw, sh, lonA * K, -latA, (lonB - lonA) * K, latA - latB);
      }

      const inView = (c) => !(c.bbox[2] < X0 || c.bbox[0] > X1 || c.bbox[3] < Y0 || c.bbox[1] > Y1);
      const px = 1 / z;

      // Rivers.
      const rA = cfg.rivers ? V.kf(t, cfg.rivers, V.ease.linear) : 0.5;
      if (rA > 0.01) {
        ctx.lineJoin = ctx.lineCap = "round";
        for (const r of riverPaths) {
          const hot = (cfg.hotRivers || []).find((h) => h.name === r.name && t >= h.t0 && t <= h.t1);
          if (hot) continue;
          if (r.rank > (z > 40 ? 6 : z > 15 ? 5 : 4)) continue;
          ctx.strokeStyle = `rgba(110,150,210,${(rA * 0.55).toFixed(3)})`;
          ctx.lineWidth = (z > 40 ? 2.2 : 1.4) * px;
          ctx.stroke(r.path);
        }
        for (const h of cfg.hotRivers || []) {
          if (t < h.t0 || t > h.t1) continue;
          const a = fade(t, h);
          const r = riverPaths.filter((rp) => rp.name === h.name);
          for (const rp of r) {
            ctx.strokeStyle = `rgba(140,185,245,${(a * 0.95).toFixed(3)})`;
            ctx.lineWidth = (h.width || 4) * px;
            ctx.shadowColor = "rgba(140,185,245,.7)";
            ctx.shadowBlur = 10;
            ctx.stroke(rp.path);
            ctx.shadowBlur = 0;
          }
        }
      }

      // Borders.
      const bA = cfg.borders ? V.kf(t, cfg.borders, V.ease.linear) : 1;
      if (bA > 0.01) {
        ctx.strokeStyle = `rgba(4,8,18,${(0.55 * bA).toFixed(3)})`;
        ctx.lineWidth = 4 * px;
        for (const c of all) if (inView(c)) ctx.stroke(c.path);
        ctx.strokeStyle = `rgba(150,178,222,${(0.55 * bA).toFixed(3)})`;
        ctx.lineWidth = 1.5 * px;
        for (const c of all) if (inView(c)) ctx.stroke(c.path);
      }

      // Focus: darken everything except the listed countries.
      for (const f of cfg.focus || []) {
        if (t < f.t0 || t > f.t1) continue;
        const a = fade(t, f, 0.6, 0.6) * (f.amount ?? 0.55);
        const p = new Path2D();
        p.rect(X0 - 1, Y0 - 1, X1 - X0 + 2, Y1 - Y0 + 2);
        for (const iso of f.iso) if (byIso[iso]) p.addPath(byIso[iso].path);
        ctx.fillStyle = `rgba(5,9,20,${a.toFixed(3)})`;
        ctx.fill(p, "evenodd");
      }

      // Highlights.
      for (const h of cfg.highlights || []) {
        if (t < h.t0 || t > h.t1) continue;
        const c = byIso[h.iso];
        if (!c) continue;
        let a = fade(t, h, 0.45, 0.5);
        if (h.pulse) a *= 0.8 + 0.2 * Math.sin((t - h.t0) * 4);
        const col = COLORS[h.color || "gold"];
        const f = h.fill ?? 0.38;
        // Tint the relief itself (keeps its shading), then lift it: plain
        // alpha over navy mixes gold down to khaki.
        ctx.globalCompositeOperation = "color";
        ctx.fillStyle = rgba(col, V.clamp(a * f * 2.4).toFixed(3));
        ctx.fill(c.path);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = rgba(col, (a * f * 0.7).toFixed(3));
        ctx.fill(c.path);
        ctx.strokeStyle = rgba(col, (a * 0.95).toFixed(3));
        ctx.lineWidth = (h.stroke || 3.2) * px;
        ctx.shadowColor = rgba(col, 0.8);
        ctx.shadowBlur = 14;
        ctx.stroke(c.path);
        ctx.shadowBlur = 0;
      }

      // Screen-space overlays from here on.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (cfg.shade) {
        const s = V.kf(t, cfg.shade, V.ease.linear);
        if (s > 0) { ctx.fillStyle = `rgba(5,9,20,${s})`; ctx.fillRect(0, 0, V.W, V.H); }
      }
      // Top and bottom falloff so titles and subtitles sit on calm ground.
      const g = ctx.createLinearGradient(0, 0, 0, V.H);
      g.addColorStop(0, "rgba(9,14,28,0.72)");
      g.addColorStop(0.16, "rgba(9,14,28,0)");
      g.addColorStop(0.66, "rgba(9,14,28,0)");
      g.addColorStop(0.8, "rgba(9,14,28,0.7)");
      g.addColorStop(1, "rgba(9,14,28,0.9)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, V.W, V.H);

      for (const l of cfg.labels || []) if (t >= l.t0 && t <= l.t1) drawLabel(l, t);
      for (const a of cfg.arcs || []) if (t >= a.t0 && t <= a.t1) drawArc(a, t);
      for (const ic of cfg.icons || []) if (t >= ic.t0 && t <= ic.t1) drawIcon(ic, t);
      for (const p of cfg.pins || []) if (t >= p.t0 && t <= p.t1) drawPin(p, t);
    }

    function geo(p) {
      if (typeof p !== "string") return p;
      if (cfg.places[p]) return cfg.places[p];
      if (byIso[p]) return byIso[p].centroid;
      throw new Error("map: unknown place or country " + p);
    }

    function drawLabel(l, t) {
      const [lon, lat] = geo(l.at);
      const [x, y] = map.xy(lon, lat);
      const a = fade(t, l, 0.5, 0.4);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `${l.italic ? "italic 700" : "800"} ${l.size || 64}px Playfair`;
      ctx.letterSpacing = (l.spacing ?? 14) + "px";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,.8)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = rgba(COLORS[l.color || "cream"], 0.95);
      ctx.fillText(l.text, x + (l.dx || 0), y + (l.dy || 0) + (1 - a) * 16);
      ctx.restore();
    }

    function drawPin(p, t) {
      const [lon, lat] = geo(p.at);
      const [x, y] = map.xy(lon, lat);
      const col = COLORS[p.color || "gold"];
      const pa = V.prog(t, p.t0, p.t0 + 0.4);
      const s = V.ease.outBack(pa);
      const out = 1 - V.ease.inCubic(V.prog(t, p.t1 - 0.35, p.t1));
      ctx.save();
      ctx.globalAlpha = out;
      // Pulse ring.
      const ph = ((t - p.t0) % 1.8) / 1.8;
      ctx.strokeStyle = rgba(col, (0.7 * (1 - ph)).toFixed(3));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 16 + ph * 46, 0, Math.PI * 2);
      ctx.stroke();
      // Dot.
      const r = (p.r || 13) * s;
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 18;
      ctx.fillStyle = rgba(col, 1);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#0d1528";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, r * 0.42), 0, Math.PI * 2);
      ctx.fill();

      if (p.label) {
        const la = V.ease.outCubic(V.prog(t, p.t0 + 0.12, p.t0 + 0.5));
        const side = p.side || "right";
        const size = p.size || 46;
        ctx.font = `900 ${size}px Inter`;
        ctx.letterSpacing = "1px";
        const tw = ctx.measureText(p.label).width;
        ctx.font = `700 ${Math.round(size * 0.56)}px Mono`;
        ctx.letterSpacing = "2px";
        const sw = p.sub ? ctx.measureText(p.sub).width : 0;
        const bw = Math.max(tw, sw);
        let lx, ly, align;
        if (side === "right") { lx = x + 32; ly = y; align = "left"; }
        else if (side === "left") { lx = x - 32; ly = y; align = "right"; }
        else if (side === "top") { lx = x; ly = y - 58 - (p.sub ? size * 0.6 : 0); align = "center"; }
        else { lx = x; ly = y + 62; align = "center"; }
        ctx.globalAlpha = out * la;
        const slide = (1 - la) * 14 * (side === "left" ? 1 : side === "right" ? -1 : 0);
        ctx.textAlign = align;
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,.85)";
        ctx.shadowBlur = 14;
        ctx.font = `900 ${size}px Inter`;
        ctx.letterSpacing = "1px";
        ctx.fillStyle = "#F7F3EA";
        ctx.fillText(p.label, lx + slide, ly - (p.sub ? size * 0.32 : 0));
        if (p.sub) {
          ctx.font = `700 ${Math.round(size * 0.56)}px Mono`;
          ctx.letterSpacing = "2px";
          ctx.fillStyle = rgba(COLORS[p.subColor || p.color || "gold"], 1);
          ctx.fillText(p.sub, lx + slide, ly + size * 0.52);
        }
        ctx.shadowBlur = 0;
        void bw;
      }
      ctx.restore();
    }

    function drawArc(a, t) {
      const [x1, y1] = map.xy(...geo(a.from));
      const [x2, y2] = map.xy(...geo(a.to));
      const p = (a.ease ? V.ease[a.ease] : V.ease.inOutCubic)(V.prog(t, a.t0, a.t0 + (a.dur || 1)));
      if (p <= 0) return;
      const out = 1 - V.ease.inCubic(V.prog(t, a.t1 - 0.4, a.t1));
      const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
      const bend = a.bend ?? 0.22;
      // Bow to the left of travel (upward for west-to-east).
      const mx = (x1 + x2) / 2 + (dy / d) * d * bend, my = (y1 + y2) / 2 - (dx / d) * d * bend;
      const pt = (u) => [(1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2, (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2];
      const col = COLORS[a.color || "gold"];
      ctx.save();
      ctx.globalAlpha = out * (a.alpha ?? 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (a.dashed) ctx.setLineDash([22, 16]);
      ctx.beginPath();
      const N = 72;
      for (let i = 0; i <= N; i++) {
        const u = (p * i) / N;
        const [x, y] = pt(u);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = "rgba(5,9,20,.6)";
      ctx.lineWidth = (a.width || 6) + 5;
      ctx.stroke();
      ctx.shadowColor = rgba(col, 0.9);
      ctx.shadowBlur = 16;
      ctx.strokeStyle = rgba(col, 1);
      ctx.lineWidth = a.width || 6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const [hx, hy] = pt(p);
      if (a.arrow !== false && p > 0.02) {
        const [bx, by] = pt(Math.max(0, p - 0.02));
        const ang = Math.atan2(hy - by, hx - bx);
        const L = (a.width || 6) * 4.2;
        ctx.fillStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(ang) * L * 0.5, hy + Math.sin(ang) * L * 0.5);
        ctx.lineTo(hx + Math.cos(ang + 2.5) * L, hy + Math.sin(ang + 2.5) * L);
        ctx.lineTo(hx + Math.cos(ang - 2.5) * L, hy + Math.sin(ang - 2.5) * L);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Small pictograms that sit on the map at a place.
    function drawIcon(ic, t) {
      const [lon, lat] = geo(ic.at);
      let [x, y] = map.xy(lon, lat);
      x += ic.dx || 0; y += ic.dy || 0;
      const a = V.prog(t, ic.t0, ic.t0 + 0.35);
      const drop = ic.drop ? (1 - V.ease.outBack(a)) * -160 : 0;
      const out = 1 - V.ease.inCubic(V.prog(t, ic.t1 - 0.3, ic.t1));
      const col = COLORS[ic.color || "gold"];
      const s = (ic.size || 1) * (ic.drop ? 1 : V.ease.outBack(a));
      ctx.save();
      ctx.globalAlpha = out * V.clamp(a * 3);
      ctx.translate(x, y + drop);
      ctx.scale(s, s);
      ctx.shadowColor = "rgba(0,0,0,.7)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = rgba(col, 1);
      if (ic.kind === "pawn") {
        // Base at the origin, pawn standing on the place.
        ctx.beginPath();
        ctx.ellipse(0, -8, 44, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-36, -26, 72, 18);
        ctx.beginPath();
        ctx.moveTo(-30, -26);
        ctx.quadraticCurveTo(-14, -60, -16, -92);
        ctx.lineTo(16, -92);
        ctx.quadraticCurveTo(14, -60, 30, -26);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, -96, 26, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -124, 26, 0, Math.PI * 2);
        ctx.fill();
      } else if (ic.kind === "burst") {
        const ph = (t - ic.t0) * 2.2;
        ctx.shadowBlur = 20;
        ctx.shadowColor = rgba(col, 0.9);
        ctx.strokeStyle = rgba(col, 1);
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        for (let i = 0; i < 10; i++) {
          const an = (i / 10) * Math.PI * 2 + 0.2;
          const r0 = 26 + Math.sin(ph + i) * 4, r1 = 58 + (i % 2) * 18 + Math.sin(ph * 1.3 + i) * 6;
          ctx.beginPath();
          ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0);
          ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1);
          ctx.stroke();
        }
      } else if (ic.kind === "temple") {
        // A tiered roof, readable at small sizes.
        ctx.fillRect(-26, -34, 52, 34);
        for (let k = 0; k < 3; k++) {
          const w = 60 - k * 14, yy = -34 - k * 22;
          ctx.beginPath();
          ctx.moveTo(-w, yy);
          ctx.quadraticCurveTo(-w * 0.5, yy - 8, -w * 0.35, yy - 16);
          ctx.lineTo(w * 0.35, yy - 16);
          ctx.quadraticCurveTo(w * 0.5, yy - 8, w, yy);
          ctx.closePath();
          ctx.fill();
          if (k < 2) ctx.fillRect(-w * 0.3, yy - 22, w * 0.6, 8);
        }
        ctx.fillRect(-3, -120, 6, 26);
      } else if (ic.kind === "question") {
        ctx.font = "900 150px Playfair";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", 0, 0);
      }
      ctx.restore();
    }

    V.map = map;
    return map;
  };
})();

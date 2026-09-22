/**
 * Vector graphics drawn in code: stylised objects (passport, banknote, wheel,
 * flag, plaque) and small diagrams. Returned as SVG/HTML strings for V.box.
 */
(function () {
  const V = window.V;
  const G = (V.gfx = {});

  // Wheel with n spokes. The dharmachakra has 8; the Ashoka Chakra on the flag has 24.
  G.wheel = (n, color, opts = {}) => {
    const R = 100, hub = opts.hub ?? 16, rim = opts.rim ?? 9;
    let spokes = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a), y = Math.sin(a);
      spokes += `<line x1="${x * hub}" y1="${y * hub}" x2="${x * (R - rim)}" y2="${y * (R - rim)}" stroke="${color}" stroke-width="${n > 12 ? 3.2 : 8}" stroke-linecap="round"/>`;
      if (n <= 12) spokes += `<circle cx="${x * (R + 12)}" cy="${y * (R + 12)}" r="9" fill="${color}"/>`;
      else spokes += `<circle cx="${Math.cos(a + Math.PI / n) * (R - rim - 3)}" cy="${Math.sin(a + Math.PI / n) * (R - rim - 3)}" r="3.4" fill="${color}"/>`;
    }
    return `<svg viewBox="-125 -125 250 250" width="100%" height="100%" style="overflow:visible">
      <g class="spin">
        <circle r="${R - rim / 2}" fill="none" stroke="${color}" stroke-width="${rim}"/>
        ${spokes}
        <circle r="${hub}" fill="${color}"/>
        ${opts.innerRing ? `<circle r="${hub + 16}" fill="none" stroke="${color}" stroke-width="4"/>` : ""}
      </g></svg>`;
  };

  G.indiaFlag = () => `<svg viewBox="0 0 900 600" width="100%" height="100%" preserveAspectRatio="none">
      <rect width="900" height="200" fill="#FF9933"/><rect y="200" width="900" height="200" fill="#FFFFFF"/><rect y="400" width="900" height="200" fill="#138808"/>
      <g transform="translate(450 300) scale(0.84)">${G.wheel(24, "#000080").replace(/<svg[^>]*>|<\/svg>/g, "")}</g></svg>`;


  // The Lion Capital as seen on the State Emblem: three lions (the fourth is
  // hidden behind), on an abacus with the wheel between a horse and a bull.
  // A stylised silhouette in one colour; the real artwork replaces it when
  // images/emblem-of-india.svg is present.
  G.lionCapital = (color = "#E2BE6A", cut = "#141e38") => {
    const mane = (cx, cy, rx, ry, n, bump) => {
      let d = "";
      for (let i = 0; i <= n * 8; i++) {
        const a = (i / (n * 8)) * Math.PI * 2 - Math.PI / 2;
        const w = 1 + bump * Math.pow(Math.abs(Math.sin((i / 8) * Math.PI)), 0.6);
        d += (i ? "L" : "M") + (cx + Math.cos(a) * rx * w).toFixed(1) + "," + (cy + Math.sin(a) * ry * w).toFixed(1);
      }
      return d + "Z";
    };
    const curls = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return `<path d="M${(cx + Math.cos(a) * r * 0.55).toFixed(1)},${(cy + Math.sin(a) * r * 0.55).toFixed(1)} Q${(cx + Math.cos(a + 0.25) * r * 0.8).toFixed(1)},${(cy + Math.sin(a + 0.25) * r * 0.8).toFixed(1)} ${(cx + Math.cos(a) * r * 0.95).toFixed(1)},${(cy + Math.sin(a) * r * 0.95).toFixed(1)}" stroke="${cut}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }).join("");
    // A side lion in profile, facing `dir` (-1 left, 1 right).
    const side = (cx, dir) => `
      <path d="${mane(cx, 92, 34, 44, 11, 0.14)}" fill="${color}"/>
      ${curls(cx, 92, 38, 11)}
      <path d="M${cx + dir * 22},70 q${dir * 30},2 ${dir * 36},18 q${dir * 4},10 ${-dir * 4},16 l${-dir * 10},2 q${dir * 6},8 ${-dir * 4},12 q${-dir * 16},2 ${-dir * 28},-6 z" fill="${color}"/>
      <circle cx="${cx + dir * 30}" cy="80" r="3" fill="${cut}"/>
      <path d="M${cx + dir * 52},100 l${-dir * 14},2" stroke="${cut}" stroke-width="2.4"/>
      <rect x="${cx - 20}" y="128" width="40" height="52" rx="6" fill="${color}"/>
      <path d="M${cx + dir * 20},150 q${dir * 10},14 ${dir * 6},30" stroke="${color}" stroke-width="12" fill="none" stroke-linecap="round"/>`;
    const front = `
      <path d="${mane(100, 88, 40, 48, 13, 0.16)}" fill="${color}"/>
      ${curls(100, 88, 44, 13)}
      <ellipse cx="100" cy="86" rx="21" ry="25" fill="${color}" stroke="${cut}" stroke-width="3"/>
      <circle cx="92" cy="80" r="3.2" fill="${cut}"/><circle cx="108" cy="80" r="3.2" fill="${cut}"/>
      <path d="M94,92 q6,5 12,0 M100,94 v7 M91,103 q9,8 18,0" stroke="${cut}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M78,128 h44 v56 h-44 z" fill="${color}"/>
      <path d="M86,136 v46 M114,136 v46 M100,132 v50" stroke="${cut}" stroke-width="2.6"/>
      <path d="M80,178 h18 v8 h-18z M102,178 h18 v8 h-18z" fill="${color}"/>`;
    const chakra = (cx, cy, r) => {
      let sp = "";
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; sp += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${cut}" stroke-width="1.4"/>`; }
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cut}" stroke-width="2.6"/>${sp}`;
    };
    const horse = `<path d="M26,204 q4,-12 18,-12 h14 q6,-10 14,-12 l4,6 q-6,4 -8,10 q2,6 -2,8 l-2,10 h-4 l1,-8 h-18 l-3,8 h-4 l0,-8 q-6,0 -10,-2 z" fill="${cut}"/>`;
    const bull = `<path d="M174,204 q-2,-12 -18,-12 h-16 q-6,-6 -12,-6 l-2,-6 -3,5 q-4,2 -2,8 q4,6 8,6 l2,10 h4 l0,-8 h16 l2,8 h4 l0,-8 q6,-2 7,-6 z" fill="${cut}"/>`;
    return `<svg viewBox="0 0 200 240" width="100%" height="100%" style="overflow:visible">
      ${side(48, -1)}${side(152, 1)}${front}
      <rect x="14" y="186" width="172" height="34" rx="3" fill="${color}"/>
      <rect x="14" y="186" width="172" height="5" fill="${cut}" opacity=".35"/>
      ${horse}${bull}${chakra(100, 204, 12)}
      <path d="M22,226 h156 l-10,12 h-136 z" fill="${color}"/>
    </svg>`;
  };

  /** The emblem: the real masked artwork if we have it, the drawn lion capital otherwise. */
  G.emblem = (src, color = "var(--gold-bright)") =>
    src
      ? `<div style="width:100%;height:100%;background:${color};-webkit-mask:url(${src}) center/contain no-repeat;mask:url(${src}) center/contain no-repeat"></div>`
      : `<div style="width:100%;height:100%">${G.lionCapital(color.startsWith("var") ? "#E2BE6A" : color)}</div>`;

  // Stylised passport cover: navy board, gold foil. Not a replica.
  G.passport = (emblemSrc) => `
    <div style="width:100%;height:100%;border-radius:18px 26px 26px 18px;position:relative;overflow:hidden;
      background:radial-gradient(120% 90% at 30% 20%, #26375f, #141e38 70%);box-shadow:0 30px 70px rgba(0,0,0,.6), inset 8px 0 0 rgba(0,0,0,.25);
      display:flex;flex-direction:column;align-items:center;color:#D9B563;font-family:Playfair;text-align:center">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.018) 0 2px,rgba(0,0,0,0) 2px 5px)"></div>
      <div style="margin-top:70px;font-weight:800;font-size:40px;letter-spacing:.12em">REPUBLIC OF INDIA</div>
      <div style="width:230px;height:300px;margin-top:62px">${G.emblem(emblemSrc, "#D9B563")}</div>
      <div style="margin-top:64px;font-weight:800;font-size:56px;letter-spacing:.18em">PASSPORT</div>
      <svg viewBox="0 0 60 40" width="64" style="margin-top:34px"><rect x="2" y="2" width="56" height="36" rx="4" fill="none" stroke="#D9B563" stroke-width="3"/><circle cx="30" cy="20" r="8" fill="none" stroke="#D9B563" stroke-width="3"/><path d="M2 20h14M44 20h14" stroke="#D9B563" stroke-width="3"/></svg>
    </div>`;

  // Stylised banknote: generic, no denomination, clearly an illustration.
  G.banknote = (emblemSrc) => `
    <div style="width:100%;height:100%;border-radius:10px;position:relative;overflow:hidden;
      background:linear-gradient(115deg,#d9cfae,#efe6cc 40%,#d6c8a0);box-shadow:0 26px 60px rgba(0,0,0,.55);color:#4a3d22;font-family:Playfair">
      <div style="position:absolute;inset:18px;border:3px solid rgba(74,61,34,.45);border-radius:6px"></div>
      <div style="position:absolute;inset:30px;border:1px solid rgba(74,61,34,.35);border-radius:4px;
        background:repeating-radial-gradient(circle at 78% 50%, rgba(74,61,34,.08) 0 2px, rgba(0,0,0,0) 2px 9px)"></div>
      <div style="position:absolute;left:46px;top:36px;width:140px;height:196px">${G.emblem(emblemSrc, "#6b5528")}</div>
      <div style="position:absolute;left:210px;top:74px;font-weight:800;font-size:46px;letter-spacing:.08em">&#8377;</div>
      <div style="position:absolute;left:210px;top:150px;font-family:Mono;font-weight:700;font-size:22px;letter-spacing:.2em">INDIAN CURRENCY</div>
      <div style="position:absolute;right:54px;top:52px;width:190px;height:190px;border-radius:50%;
        background:radial-gradient(circle,rgba(255,255,255,.35),rgba(255,255,255,0) 70%)"></div>
    </div>`;

  /** Row of labelled chips: [{text, cls}] */
  G.chip = (text, color = "cream") => `<div class="tag ${color}" style="position:static;display:inline-block">${text}</div>`;

  // 21 seats in a hemicycle; returns {html, seats} so a tick can light them.
  G.hemicycle = (n = 21) => {
    const rows = [5, 7, 9];
    let k = 0, dots = "";
    rows.forEach((count, r) => {
      const R = 160 + r * 90;
      for (let i = 0; i < count && k < n; i++, k++) {
        const a = Math.PI + (Math.PI * (i + 0.5)) / count;
        dots += `<circle class="seat" data-i="${k}" cx="${(Math.cos(a) * R).toFixed(1)}" cy="${(Math.sin(a) * R).toFixed(1)}" r="30" fill="#2b4270" stroke="#6f8fc0" stroke-width="3"/>`;
      }
    });
    return `<svg viewBox="-420 -430 840 470" width="100%" height="100%" style="overflow:visible">${dots}</svg>`;
  };

  // A person glyph for crowds.
  G.person = (fill) => `<svg viewBox="0 0 40 70" width="100%" height="100%"><circle cx="20" cy="12" r="10" fill="${fill}"/><path d="M4 70 V38 Q4 25 20 25 Q36 25 36 38 V70 Z" fill="${fill}"/></svg>`;

  // Engraved heritage plaque.
  G.plaque = (lines) => `
    <div style="width:100%;height:100%;border-radius:10px;padding:46px 40px;text-align:center;
      background:linear-gradient(160deg,#b8924a,#8a6a2e 55%,#a9853f);box-shadow:0 26px 60px rgba(0,0,0,.6), inset 0 0 0 6px rgba(60,42,12,.55), inset 0 0 0 12px rgba(230,200,130,.35);
      color:#3a2a0c;font-family:Playfair;display:flex;flex-direction:column;justify-content:center;gap:18px;
      text-shadow:0 1px 0 rgba(255,235,180,.45)">${lines}</div>`;
})();

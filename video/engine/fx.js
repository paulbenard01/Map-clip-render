/**
 * Texture: the navy paper background, film grain, and the paper texture the
 * document cards use. All procedural and seeded, so every render matches.
 */
(function () {
  const V = window.V;

  function noiseCanvas(w, h, seed, amount = 1) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    // mulberry32: a short-period generator here shows up as diagonal stripes.
    let a = seed >>> 0;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < w * h; i++) {
      const v = 128 + (rnd() - 0.5) * 255 * amount;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // Soft blotches plus fibres: reads as paper at a glance, not as noise.
  function paper(w, h, seed, base, spots, fibre) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = V.rand(seed + i) * w, y = V.rand(seed + i * 1.7) * h, r = 30 + V.rand(seed + i * 2.3) * 160;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.02 + V.rand(seed + i * 3.1) * 0.05;
      g.addColorStop(0, spots.replace("A", a));
      g.addColorStop(1, spots.replace("A", 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = fibre;
    ctx.lineWidth = 1;
    for (let i = 0; i < 900; i++) {
      const x = V.rand(seed + i * 5.3) * w, y = V.rand(seed + i * 7.1) * h, a = V.rand(seed + i * 1.1) * Math.PI;
      const l = 4 + V.rand(seed + i * 2.9) * 16;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.12;
    ctx.drawImage(noiseCanvas(w, h, seed + 5), 0, 0);
    return c;
  }

  V.fxSetup = () => {
    // Background: navy paper with a lifted centre.
    const bg = V.layers.bg.getContext("2d");
    const tex = paper(V.W, V.H, 11, "#131D34", "rgba(60,90,140,A)", "rgba(120,150,200,0.05)");
    bg.drawImage(tex, 0, 0);
    const g = bg.createRadialGradient(V.W / 2, V.H * 0.42, 100, V.W / 2, V.H * 0.45, V.H * 0.75);
    g.addColorStop(0, "rgba(40,62,104,0.55)");
    g.addColorStop(1, "rgba(6,10,22,0.6)");
    bg.fillStyle = g;
    bg.fillRect(0, 0, V.W, V.H);

    // Paper for the document cards, as a CSS variable they all share.
    const pc = paper(540, 540, 3, "#ffffff", "rgba(120,90,40,A)", "rgba(90,70,40,0.07)");
    document.documentElement.style.setProperty("--paper-tex", `url(${pc.toDataURL("image/png")})`);

    // Grain: a handful of frames cycled every other video frame.
    const grains = [0, 1, 2, 3, 4, 5].map((i) => noiseCanvas(540, 960, 100 + i, 1));
    const fx = V.layers.fx.getContext("2d");
    V.fx = {
      draw(t) {
        const i = Math.floor(t * 15) % grains.length;
        fx.clearRect(0, 0, V.W, V.H);
        fx.imageSmoothingEnabled = false;
        fx.drawImage(grains[i], 0, 0, V.W, V.H);
      },
    };
  };
})();

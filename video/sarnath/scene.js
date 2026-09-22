/**
 * "Sarnath" (Heritle, portrait short).
 *
 * Every time below is in seconds of the voiceover (transcript.json). Beats
 * are laid out in script order; each block names the line it illustrates.
 * Photos live in images/ (see images/credits.json); any that are missing
 * render as labelled placeholder cards so the cut can be reviewed early.
 */
(async function () {
  const { photo, title, tag, counter, stamp, doc, marker, box, gfx } = V;
  V.setup();
  V.fxSetup();

  const transcript = await fetch("transcript.json").then((r) => r.json());
  const VO_END = 257.67;
  const END = 262.0;
  V.useTranscript(transcript, {
    endAt: VO_END + 0.1,
    fixes: { "Sana.": "Sarnath.", Sarnat: "Sarnath" },
    merges: [
      { match: ["nineteen", "forty", "seven"], text: "1947" },
      { match: ["twenty", "eight"], text: "28" },
      { match: ["six", "hundred"], text: "600" },
      { match: ["15,000,000"], text: "15 million" },
    ],
  });

  // ---------- photos ----------
  const IMG = (id) => `images/${id}.jpg`;
  const P = {
    lion: { src: IMG("lion-capital"), label: "Lion Capital of Ashoka", note: "Sarnath Museum" },
    dhamek: { src: IMG("dhamek-stupa"), label: "Dhamek Stupa", note: "Sarnath" },
    buddha: { src: IMG("sarnath-buddha"), label: "Buddha preaching", note: "Sarnath Museum, Gupta period" },
    pillar: { src: IMG("ashoka-pillar"), label: "Ashokan pillar", note: "Vaishali" },
    ruins: { src: IMG("sarnath-ruins"), label: "Sarnath ruins", note: "monastery foundations" },
    dharmarajika: { src: IMG("dharmarajika"), label: "Dharmarajika Stupa", note: "brick base, Sarnath" },
    cunningham: { src: IMG("cunningham"), label: "Alexander Cunningham", note: "portrait" },
    nehru: { src: IMG("nehru"), label: "Jawaharlal Nehru", note: "c. 1947" },
    dashavatara: { src: IMG("dashavatara"), label: "Dashavatara", note: "the ten avatars of Vishnu" },
    partition: { src: IMG("partition"), label: "Partition, 1947", note: "refugees" },
    nalanda: { src: IMG("nalanda"), label: "Nalanda", note: "ruins, Bihar" },
    nanhai: { src: IMG("nanhai"), label: "Nanhai Buddhist Academy", note: "Sanya, Hainan" },
    dalai: { src: IMG("dalai-lama"), label: "The 14th Dalai Lama", note: "portrait" },
  };
  const ph = (key, o) => photo({ ...P[key], ...o });
  const emblemImg = await V.loadImage("images/emblem-of-india.svg");
  const EMBLEM = emblemImg ? "images/emblem-of-india.svg" : null;

  // ---------- map ----------
  const places = {
    sarnath: [83.024, 25.381],
    varanasi: [82.99, 25.3],
    dhauli: [85.84, 20.19],
    lumbini: [83.276, 27.469],
    bodhgaya: [84.991, 24.695],
    kushinagar: [83.888, 26.741],
    newdelhi: [77.209, 28.614],
    hcmc: [106.66, 10.76],
    ningbo: [121.55, 29.87],
    beijing: [116.4, 39.9],
    dharamshala: [76.32, 32.22],
  };
  const M = { places, cams: [], highlights: [], pins: [], arcs: [], labels: [], icons: [], hotRivers: [], focus: [], alpha: [[0, 0]] };
  // A map segment: visible from t0 to t1 with its own camera moves.
  const seg = (t0, t1, cams, fin = 0.4, fout = 0.4) => {
    M.alpha.push([t0, 0], [t0 + fin, 1], [t1 - fout, 1], [t1, 0]);
    M.cams.push(...cams);
  };
  const hl = (iso, t0, t1, o = {}) => M.highlights.push({ iso, t0, t1, ...o });
  const pin = (at, t0, t1, o = {}) => M.pins.push({ at, t0, t1, ...o });
  const arc = (from, to, t0, t1, o = {}) => M.arcs.push({ from, to, t0, t1, ...o });
  const lbl = (text, at, t0, t1, o = {}) => M.labels.push({ text, at, t0, t1, ...o });

  // =====================================================================
  // 0:00  "On every Indian passport and printed currency, there is a
  //        representation of this, a sculpture of lions from a Buddhist monument."
  // =====================================================================
  box({
    html: gfx.passport(EMBLEM), w: 520, h: 740, x: 400, y: 700, rot: -6,
    t0: 0.3, t1: 4.98, enter: "up", dist: 1100, inDur: 0.7, exit: "cut",
    move: [[3.9, [400, 700, 1]], [4.98, [420, 820, 2.7], V.ease.inCubic]],
  });
  tag({ text: "Indian passport", x: 400, y: 250, t0: 1.6, t1: 3.9, color: "navy" });
  box({
    html: gfx.banknote(EMBLEM), w: 700, h: 330, x: 650, y: 1150, rot: 7,
    t0: 2.3, t1: 4.4, enter: "right", dist: 900, inDur: 0.5, exit: "right", outDur: 0.4,
  });
  marker({ kind: "circle", x: 410, y: 650, rx: 175, ry: 205, t0: 4.0, t1: 4.9, dur: 0.5 });

  ph("lion", { frame: "full", t0: 4.96, t1: 13.0, enter: "zoom", inDur: 0.35, kb: [1.16, 1.03], dimKf: [[4.96, 0.55], [9.6, 0.55], [10.2, 0.95]] });
  tag({ text: "Lion Capital of Ashoka", sub: "Sarnath · c. 250 BCE", x: 80, y: 1200, align: "left", t0: 6.2, t1: 9.7 });
  marker({ kind: "circle", x: 540, y: 690, rx: 360, ry: 330, t0: 6.72, t1: 9.6, dur: 0.55 });

  // "And this sculpture and this place have been brought into a wider
  //  conversation about the geopolitics of Buddhism, thanks to the UNESCO
  //  and India facing its biggest rival."
  ph("dhamek", { x: 620, y: 760, w: 700, h: 880, rot: 4, t0: 9.84, t1: 12.9, enter: "right", dist: 800, exit: "left" });
  tag({ text: "Dhamek Stupa · Sarnath", x: 620, y: 1260, t0: 10.3, t1: 12.6, color: "cream" });

  title({ text: "The geopolitics \\n of Buddhism", t0: 12.8, t1: 15.95, x: 540, y: 560, size: 124, style: "serif", sync: true, hl: [4], exit: "up" });
  stamp({ text: "UNESCO<br>World Heritage", x: 540, y: 930, rot: -7, size: 50, t0: 15.18, t1: 16.4 });

  seg(12.6, 24.45, [
    [12.6, 92, 26, 9.2, 820],
    [18.45, 88, 27, 11.5, 800],
    [20.3, 83.022, 25.345, 165, 760, "inOutQuart"],
    [24.45, 83.022, 25.345, 185, 760, "linear"],
  ]);
  hl("IND", 16.0, 19.6, { fout: 0.9 });
  hl("CHN", 17.0, 19.2, { color: "red", fout: 0.8 });
  lbl("INDIA", "IND", 16.1, 18.8, { size: 66, dy: 10 });
  lbl("CHINA", "CHN", 17.0, 18.8, { size: 66 });
  lbl("the rival", "CHN", 17.34, 18.8, { size: 44, italic: true, dy: 78, spacing: 2 });

  // 0:18  "This is Sarnath, just outside Varanasi, one of the most sacred places in India."
  M.hotRivers.push({ name: "Ganges", t0: 18.8, t1: 24.45, width: 5 });
  pin("sarnath", 19.05, 24.4, { label: "SARNATH", size: 60 });
  lbl("Varanasi", "varanasi", 20.4, 24.3, { size: 44, italic: true, spacing: 2, dx: -150, dy: 70 });
  ph("dhamek", { x: 540, y: 1110, w: 600, h: 390, rot: -3, t0: 21.65, t1: 24.3, enter: "pop", focus: "50% 40%" });

  // =====================================================================
  // 0:24  "Around the sixth century BCE, having just reached enlightenment,
  //        the Buddha taught his first sermon here, an event called the first
  //        turning of the wheel of dharma."
  // =====================================================================
  title({ text: "c. 6th century BCE", at: [24.77, 24.77, 25.02, 25.34], t0: 24.7, t1: 30.3, x: 540, y: 300, size: 96, style: "serif", anim: "slam", hl: [1, 2, 3] });
  ph("buddha", { x: 540, y: 860, w: 640, h: 800, rot: 2, t0: 26.2, t1: 31.2, enter: "up", dist: 900, exit: "left", kb: [1.0, 1.1] });
  tag({ text: "The first sermon", x: 540, y: 1300, t0: 29.25, t1: 31.0 });
  box({
    html: gfx.wheel(8, "#E2BE6A", { innerRing: true }), w: 560, h: 560, x: 540, y: 880,
    t0: 31.3, t1: 34.1, enter: "pop", inDur: 0.5,
    tick(t, node) {
      const a = (t - 31.3) * 10 + 300 * V.ease.outCubic(V.prog(t, 31.95, 33.9));
      node.querySelector(".spin").setAttribute("transform", `rotate(${a.toFixed(2)})`);
      node.style.filter = "drop-shadow(0 0 30px rgba(226,190,106,.45))";
    },
  });
  title({ text: "The first turning of the \\n wheel of dharma", t0: 31.39, t1: 34.0, x: 540, y: 310, size: 76, style: "serif", sync: true, hl: [6, 7, 8] });

  // =====================================================================
  // 0:34  "Centuries later, after a brutal conflict in Kalinga left him in
  //        need of spiritual guidance, emperor Ashoka led a Buddhist revival
  //        and built a space for worship in Sarnath."
  // =====================================================================
  tag({ text: "Centuries later", x: 540, y: 250, t0: 34.03, t1: 36.4, color: "navy" });
  seg(34.0, 44.5, [
    [34.0, 84.5, 23.0, 36, 820],
    [36.6, 85.3, 21.2, 56, 820],
    [40.7, 85.3, 21.2, 60, 820, "linear"],
    [42.4, 84.2, 23.2, 40, 820],
    [44.5, 84.1, 23.3, 42, 820, "linear"],
  ]);
  M.icons.push({ kind: "burst", at: "dhauli", t0: 36.4, t1: 40.9, color: "red" });
  pin("dhauli", 36.67, 44.4, { label: "KALINGA", sub: "WAR · c. 261 BCE", color: "red", side: "right" });
  ph("pillar", { x: 800, y: 470, w: 400, h: 540, rot: 5, t0: 39.4, t1: 43.3, enter: "right", dist: 600, exit: "right" });
  tag({ text: "Emperor Ashoka", sub: "his pillar at Vaishali", x: 800, y: 790, t0: 39.8, t1: 43.1 });
  arc("dhauli", "sarnath", 40.75, 44.4, { dur: 1.4, bend: 0.28 });
  pin("sarnath", 42.1, 44.4, { label: "SARNATH", sub: "A PLACE OF WORSHIP", side: "left" });

  // =====================================================================
  // 0:44  "This site was lost for roughly six hundred years, buried until
  //        workers quarrying for bricks stumbled onto it."
  // =====================================================================
  ph("ruins", { frame: "full", t0: 44.4, t1: 51.4, enter: "fade", inDur: 0.5, kb: [1.12, 1.0], dimKf: [[44.4, 0.6], [47.4, 0.6], [48.2, 1]] });
  counter({ t0: 45.9, t1: 48.3, x: 540, y: 560, from: 0, to: 600, dur: 0.9, size: 240, prefix: "~", label: "years lost" });
  box({
    // Earth rising over the ruins on "buried".
    html: `<div style="width:100%;height:100%;background:
      linear-gradient(180deg, rgba(20,16,12,0) 0, #1b1712 4%, #2a2117 18%, #1a1611 40%, #0e0c0a 100%)"></div>`,
    w: 1200, h: 1500, x: 540, y: 1700, drift: false, layer: "back",
    t0: 47.4, t1: 51.4, enter: "cut", exit: "fade",
    move: [[47.4, [540, 2700]], [48.4, [540, 1650], V.ease.outCubic]],
  });
  ph("dharmarajika", { x: 540, y: 700, w: 720, h: 520, rot: -3, t0: 48.45, t1: 51.35, enter: "up", dist: 900, exit: "left" });
  tag({ text: "Dharmarajika Stupa", sub: "taken apart for its bricks · 1794", x: 540, y: 1060, t0: 49.6, t1: 51.3 });

  // "A British army engineer did the formal excavation afterwards and got
  //  credit for the discovery for well over a century."
  ph("cunningham", { x: 540, y: 760, w: 560, h: 720, rot: -3, t0: 51.35, t1: 58.3, enter: "left", dist: 800, exit: "left" });
  tag({ text: "Alexander Cunningham", sub: "British army engineer", x: 540, y: 1215, t0: 52.0, t1: 58.1 });
  tag({ text: "Excavated 1835–36", x: 540, y: 290, t0: 53.67, t1: 56.6, color: "navy" });
  stamp({ text: "Credited", x: 700, y: 930, rot: -10, size: 64, t0: 55.52, t1: 58.2 });
  counter({ t0: 56.8, t1: 58.3, x: 540, y: 300, to: 100, dur: 0.7, size: 130, suffix: "+", label: "years of credit", labelSize: 28 });

  // =====================================================================
  // 0:58  "This year, India's archaeological survey moved to reinstate that
  //        credit back towards the local official whose workers actually found it first."
  // =====================================================================
  tag({ text: "Archaeological Survey of India", x: 540, y: 290, t0: 59.73, t1: 66.9, color: "navy" });
  doc({
    t0: 58.4, t1: 67.0, x: 540, y: 800, w: 900, rot: -1.5,
    head: "The credit, reassigned",
    title: "Who found Sarnath?",
    body:
      `<div style="font-size:54px;margin:18px 0 14px"><m data-kind="strike" data-at="61.57" data-dur="0.5">Alexander Cunningham, 1835</m></div>` +
      `<div style="font-size:54px"><m data-at="63.65" data-dur="0.7">Jagat Singh, 1794</m></div>` +
      `<div class="small" style="margin-top:14px">dewan (official) of the Raja of Benares, whose workers found the site</div>`,
  });
  tag({ text: "Found it first", x: 540, y: 1215, t0: 65.73, t1: 66.9 });

  // "This plays into who gets credit for Buddhism's legacy. And as it turns
  //  out, it's a very old and politically consequential battlefield."
  title({ text: "Who gets credit \\n for Buddhism's \\n legacy?", t0: 67.9, t1: 70.3, x: 540, y: 680, size: 112, style: "serif", sync: true, hl: [2], exit: "up" });
  seg(70.2, 74.9, [[70.2, 100, 22, 7.2, 860], [74.9, 100, 22, 8.6, 860, "linear"]]);
  ["LKA", "MMR", "THA", "LAO", "KHM", "VNM", "BTN", "NPL", "MNG", "KOR", "JPN"].forEach((iso, i) =>
    hl(iso, 71.0 + i * 0.16, 74.9, { fill: 0.3, fout: 0.4 }));
  hl("CHN", 72.6, 74.9, { color: "red", fill: 0.3, fout: 0.4 });
  hl("IND", 72.8, 74.9, { fill: 0.45, fout: 0.4 });
  title({ text: "A politically consequential \\n battlefield", t0: 72.3, t1: 74.9, x: 540, y: 300, size: 74, style: "serif", sync: true, hl: [4] });

  // =====================================================================
  // 1:15  "This isn't the first time this sculpture was pulled into national politics."
  // =====================================================================
  ph("lion", { x: 540, y: 820, w: 660, h: 820, rot: -2, t0: 74.9, t1: 78.8, enter: "up", dist: 900, exit: "up", kb: [1.2, 1.08], pan: [0, 40, 0, -20] });
  title({ text: "Not the first time.", at: [75.27, 75.51, 75.67, 75.83], t0: 75.2, t1: 78.7, x: 540, y: 250, size: 84, style: "serif-i" });
  tag({ text: "National politics", x: 540, y: 1290, t0: 77.42, t1: 78.7 });

  // 1:19  "Right after independence in 1947, Nehru needed a symbol no religious community could object to."
  tag({ text: "Independence", x: 540, y: 190, t0: 79.42, t1: 85.9, color: "navy" });
  title({ text: "1947", at: [80.31], t0: 80.3, t1: 85.95, x: 540, y: 360, size: 210, style: "serif", anim: "slam", hl: [0] });
  ph("nehru", { x: 540, y: 930, w: 580, h: 680, rot: 3, t0: 81.67, t1: 86.0, enter: "up", dist: 900, exit: "left" });
  tag({ text: "Jawaharlal Nehru", sub: "first prime minister", x: 540, y: 1290, t0: 82.2, t1: 85.9 });

  // 1:26  "Buddhism predated the divide between Hindus, Muslims, and Sikhs by
  //        centuries, so it didn't belong to any one side of it."
  title({ text: "Buddhism", at: [86.05], t0: 86.0, t1: 92.6, x: 540, y: 520, size: 140, style: "serif", hl: [0] });
  tag({ text: "from c. 5th century BCE", x: 540, y: 400, t0: 86.53, t1: 92.5, color: "navy" });
  tag({ text: "Hindus", x: 250, y: 1020, t0: 87.89, t1: 92.5, color: "cream", size: 38 });
  tag({ text: "Muslims", x: 540, y: 1020, t0: 88.45, t1: 92.5, color: "cream", size: 38 });
  tag({ text: "Sikhs", x: 830, y: 1020, t0: 89.09, t1: 92.5, color: "cream", size: 38 });
  marker({ kind: "strike", x: 398, y: 950, x2: 392, y2: 1095, t0: 89.3, t1: 92.5, color: "#E0685B", dur: 0.25 });
  marker({ kind: "strike", x: 688, y: 950, x2: 694, y2: 1095, t0: 89.45, t1: 92.5, color: "#E0685B", dur: 0.25 });
  tag({ text: "Centuries older than the divide", x: 540, y: 760, t0: 89.65, t1: 92.5, color: "ghost" });
  tag({ text: "Belongs to no side", x: 540, y: 1200, t0: 91.3, t1: 92.5 });

  // 1:32  "Even Hindus, the country's largest community, already counted the
  //        Buddha as one of their own, as an avatar of Vishnu."
  tag({ text: "Hindu tradition", x: 540, y: 290, t0: 92.93, t1: 99.2, color: "navy" });
  ph("dashavatara", { x: 540, y: 780, w: 940, h: 700, rot: -1, t0: 92.6, t1: 99.3, enter: "up", dist: 900, exit: "zoom", kb: [1.0, 1.08] });
  marker({ kind: "circle", x: 540, y: 780, rx: 150, ry: 170, t0: 96.05, t1: 99.2 });
  tag({ text: "The avatars of Vishnu", x: 540, y: 1210, t0: 97.73, t1: 99.2 });

  // =====================================================================
  // 1:39  "That's why the lion became India's national emblem. It could sit
  //        above the religious politics of the moment as a unifying symbol for
  //        a young nation dealing with the catastrophic aftermath of the British Empire."
  // =====================================================================
  box({
    html: gfx.emblem(EMBLEM), w: 460, h: 580, x: 540, y: 770, t0: 100.0, t1: 107.3, enter: "pop", inDur: 0.5,
    move: [[102.9, [540, 770, 1]], [104.0, [540, 640, 0.86]]],
    tick(t, node) { node.style.filter = `drop-shadow(0 0 ${(20 + 14 * Math.sin(t * 2)).toFixed(1)}px rgba(226,190,106,.5))`; },
  });
  title({ text: "India's national emblem", t0: 100.73, t1: 103.0, x: 540, y: 270, size: 84, style: "serif", sync: true, hl: [1, 2], exit: "up" });
  tag({ text: "Adopted 26 January 1950", x: 540, y: 1150, t0: 101.8, t1: 103.0, color: "navy" });
  tag({ text: "Religious politics", x: 540, y: 1020, t0: 104.0, t1: 107.2, color: "ghost" });
  ["Hindus", "Muslims", "Sikhs"].forEach((txt, i) =>
    tag({ text: txt, x: 250 + i * 290, y: 1110, t0: 103.6 + i * 0.12, t1: 107.2, color: "cream", size: 36 }));
  tag({ text: "A unifying symbol", x: 540, y: 250, t0: 105.53, t1: 107.2 });

  ph("partition", { frame: "full", t0: 107.3, t1: 111.0, enter: "fade", inDur: 0.4, kb: [1.12, 1.02], dim: 0.9 });
  tag({ text: "Partition · 1947", sub: "~15 million displaced", x: 540, y: 300, t0: 107.9, t1: 110.9, color: "red" });

  // =====================================================================
  // 1:51  "This July, the same method is being reused, but on the international stage."
  // =====================================================================
  seg(110.9, 115.8, [[110.9, 80, 23, 30, 820], [111.9, 80, 23, 30, 820], [115.8, 92, 26, 4.6, 860, "inOutCubic"]]);
  hl("IND", 110.9, 115.8, { fout: 0.4 });
  pin("sarnath", 111.0, 115.6, { r: 11 });
  title({ text: "July 2026", at: [111.22, 111.3], t0: 111.2, t1: 113.7, x: 540, y: 300, size: 124, style: "sans", anim: "slam", hl: [1] });
  title({ text: "The international stage", t0: 114.17, t1: 115.8, x: 540, y: 300, size: 80, style: "serif-i", sync: true });

  // 1:55  "UNESCO's listing isn't based on national importance. Its legal
  //        standard is based on outstanding universal value, meaning significance
  //        so exceptional, it transcends national boundaries entirely."
  tag({ text: "UNESCO World Heritage listing", x: 540, y: 250, t0: 115.77, t1: 127.0, color: "navy" });
  title({ text: "National importance", at: [117.53, 117.93], t0: 117.5, t1: 118.8, x: 540, y: 620, size: 76, style: "sans" });
  marker({ kind: "strike", x: 150, y: 625, x2: 930, t0: 118.0, t1: 118.8, color: "#E0685B", dur: 0.3, width: 12 });
  doc({
    t0: 118.6, t1: 127.1, x: 540, y: 830, w: 920, rot: 1,
    head: "World Heritage Convention · Operational Guidelines, §49",
    title: `<m data-at="120.33" data-dur="1.4">Outstanding Universal Value</m>`,
    body: `“…cultural and/or natural significance which is <m data-at="123.61" data-dur="0.6">so exceptional</m> as to <m data-at="124.97" data-dur="1.2">transcend national boundaries</m> and to be of common importance for present and future generations of all humanity.”`,
  });

  // 2:07  "The 1947 symbol was built to rise above India's internal politics.
  //        And in 2026, it rises above the idea of national ownership altogether,
  //        going for a more international vision."
  const panel = (year, line, gold) => `
    <div style="width:100%;height:100%;background:rgba(13,21,40,.82);border:3px solid ${gold ? "var(--gold)" : "rgba(226,190,106,.35)"};
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;box-shadow:0 24px 60px rgba(0,0,0,.5)">
      <div style="font-family:Playfair;font-weight:900;font-size:130px;line-height:1;color:var(--gold-bright)">${year}</div>
      <div style="font-family:Mono;font-weight:700;font-size:34px;letter-spacing:.08em;text-transform:uppercase;color:var(--white)">${line}</div>
    </div>`;
  box({ html: panel("1947", "Above India's internal politics"), w: 920, h: 330, x: 540, y: 520, t0: 127.19, t1: 135.9, enter: "left", dist: 900, exit: "up" });
  box({ html: panel("2026", "Above national ownership", true), w: 920, h: 330, x: 540, y: 930, t0: 131.75, t1: 135.9, enter: "right", dist: 900, exit: "down" });

  seg(135.8, 141.6, [[135.8, 80, 23, 26, 820], [136.2, 80, 23, 26, 820], [139.6, 88, 24, 4.2, 860], [141.6, 88, 24, 4.0, 860, "linear"]]);
  M.borders = [[0, 1], [137.2, 1], [138.8, 0.04], [141.2, 0.04], [141.7, 1]];
  hl("IND", 135.8, 139.2, { fout: 1.4 });
  lbl("INDIA", "IND", 135.9, 137.6, { size: 70 });
  title({ text: "A more international vision", t0: 136.54, t1: 138.6, x: 540, y: 300, size: 76, style: "serif-i", sync: true, hl: [3] });

  // 2:18  "The verdict on universal value doesn't arrive on its own."
  title({ text: "The verdict doesn't \\n arrive on its own", t0: 138.62, t1: 141.5, x: 540, y: 330, size: 80, style: "serif", sync: true, hl: [1] });

  // =====================================================================
  // 2:21  "India sat on UNESCO's World Heritage Committee through 2025 and
  //        hosted the session itself in New Delhi in 2024, with its own culture
  //        minister admitting outright that it would strengthen India's soft power in the world."
  // =====================================================================
  const INDIA_SEAT = 16;
  box({
    html: gfx.hemicycle(21), w: 840, h: 470, x: 540, y: 820, t0: 141.5, t1: 145.8, enter: "fade", inDur: 0.3, exit: "shrink",
    tick(t, node) {
      node.querySelectorAll(".seat").forEach((s) => {
        const i = +s.dataset.i;
        const a = V.prog(t, 141.5 + i * 0.025, 141.8 + i * 0.025);
        s.setAttribute("opacity", a.toFixed(3));
        if (i === INDIA_SEAT && t >= 142.07) {
          const p = V.ease.outBack(V.prog(t, 142.07, 142.4));
          s.setAttribute("fill", "#E2BE6A");
          s.setAttribute("stroke", "#fff");
          s.setAttribute("r", (30 + 10 * p).toFixed(1));
        }
      });
    },
  });
  tag({ text: "India", x: 540, y: 560, t0: 142.2, t1: 145.6 });
  tag({ text: "World Heritage Committee", sub: "21 elected member states", x: 540, y: 300, t0: 143.11, t1: 145.6, color: "navy" });
  tag({ text: "Member until 2025", x: 540, y: 1150, t0: 144.39, t1: 145.6, color: "cream" });

  seg(145.5, 148.9, [[145.5, 79, 25.5, 24, 820], [148.9, 77.8, 27.6, 38, 820, "linear"]]);
  hl("IND", 145.5, 148.9, { fill: 0.22 });
  pin("newdelhi", 147.19, 148.8, { label: "NEW DELHI", sub: "HOSTS THE SESSION · 2024", side: "right", size: 50 });
  tag({ text: "The host", x: 540, y: 300, t0: 145.67, t1: 148.8, color: "navy" });

  doc({
    t0: 148.8, t1: 154.45, x: 540, y: 790, w: 900, rot: -1,
    head: "India's culture minister, 2024 · paraphrased",
    body: `Hosting the World Heritage Committee will strengthen India's <m data-at="152.63" data-dur="0.6">soft power</m> in the world.`,
  });

  // 2:34  "Sarnath waited twenty eight years for that verdict, and it finally
  //        enters as another pawn into the bigger regional contest."
  counter({ t0: 155.43, t1: 157.7, x: 540, y: 520, to: 28, dur: 0.9, size: 260, label: "years waiting" });
  box({
    html: `<div style="position:relative;width:100%;height:100%">
      <div style="position:absolute;left:0;right:0;top:44px;height:10px;background:rgba(247,243,234,.18)"></div>
      <div class="fill" style="position:absolute;left:0;top:44px;height:10px;width:0;background:var(--gold-bright);box-shadow:0 0 20px rgba(226,190,106,.6)"></div>
      <div style="position:absolute;left:0;top:80px;font-family:Mono;font-weight:700;font-size:30px;color:var(--white)">1998<br><span style="color:var(--gold);font-size:24px">TENTATIVE LIST</span></div>
      <div style="position:absolute;right:0;top:80px;text-align:right;font-family:Mono;font-weight:700;font-size:30px;color:var(--white)">2026<br><span style="color:var(--gold);font-size:24px">INSCRIBED</span></div>
    </div>`,
    w: 860, h: 200, x: 540, y: 860, t0: 154.47, t1: 157.7, enter: "up", dist: 200,
    tick(t, node) { node.querySelector(".fill").style.width = (V.ease.inOutCubic(V.prog(t, 155.3, 156.4)) * 100).toFixed(1) + "%"; },
  });

  // =====================================================================
  // 2:37  pawn, then India's strategy, the circuit, the relic tour
  // =====================================================================
  seg(157.6, 187.2, [
    [157.6, 95, 27, 9, 900],
    [162.0, 95, 27, 10.2, 900, "linear"],
    [163.7, 84.3, 26.0, 150, 1000],
    [169.0, 84.3, 26.0, 158, 1000, "linear"],
    [170.8, 96, 18, 13, 860],
    [175.2, 96, 18, 13.8, 860, "linear"],
    // China: one continuous segment, so no dip between the two stories.
    [176.5, 106, 32, 11, 860],
    [178.4, 115, 31, 14, 860, "linear"],
    [180.1, 95, 25, 3.5, 860],
    [182.0, 95, 25, 3.7, 860, "linear"],
    [183.5, 84.2, 27.6, 60, 860],
    [187.2, 84.1, 27.7, 64, 860, "linear"],
  ]);
  M.icons.push({ kind: "pawn", at: "sarnath", t0: 159.26, t1: 162.0, drop: true });
  M.icons.push({ kind: "pawn", at: [104, 34], t0: 160.31, t1: 162.0, drop: true, color: "red" });
  hl("IND", 158.4, 162.2, { fill: 0.22 });
  hl("CHN", 160.3, 162.2, { fill: 0.22, color: "red" });
  title({ text: "The bigger \\n regional contest", t0: 159.91, t1: 162.0, x: 540, y: 300, size: 84, style: "serif-i", sync: true, hl: [3, 4] });

  tag({ text: "India's strategy", x: 540, y: 190, t0: 162.06, t1: 169.0, color: "navy" });
  [["✓ Birthplace", 163.82], ["✓ Authenticity", 164.62], ["✓ Relic tours", 165.75], ["✓ Pilgrimage routes", 166.62]].forEach(([txt, t0], i) =>
    tag({ text: txt, x: 70, y: 300 + i * 88, t0, t1: 169.0, align: "left", color: "cream", size: 34 }));
  M.hotRivers.push({ name: "Ganges", t0: 163.0, t1: 169.2, width: 4 });
  pin("lumbini", 163.82, 169.3, { label: "LUMBINI", sub: "BIRTHPLACE · NEPAL", side: "right", size: 44 });
  pin("bodhgaya", 166.9, 169.3, { label: "BODH GAYA", sub: "ENLIGHTENMENT", side: "right", size: 40 });
  pin("sarnath", 167.25, 169.3, { label: "SARNATH", sub: "FIRST SERMON", side: "left", size: 40 });
  pin("kushinagar", 167.6, 169.3, { label: "KUSHINAGAR", side: "right", size: 40 });
  arc("lumbini", "bodhgaya", 166.8, 169.3, { dur: 0.55, bend: 0.18, width: 5 });
  arc("bodhgaya", "sarnath", 167.25, 169.3, { dur: 0.45, bend: 0.18, width: 5 });
  arc("sarnath", "kushinagar", 167.6, 169.3, { dur: 0.45, bend: 0.18, width: 5 });

  tag({ text: "Buddha relic tour · 2025", x: 540, y: 300, t0: 170.3, t1: 175.2 });
  pin("sarnath", 169.6, 175.2, { r: 11 });
  arc("sarnath", "hcmc", 170.3, 175.2, { dur: 1.1, bend: 0.3 });
  hl("VNM", 171.0, 175.3, { fill: 0.45 });
  lbl("VIETNAM", "VNM", 171.1, 175.2, { size: 54, dx: 190, dy: 30 });
  counter({ t0: 172.62, t1: 175.2, x: 540, y: 1150, to: 15000000, dur: 1.2, size: 120, suffix: "+", label: "visitors (est.)", labelSize: 28 });

  // =====================================================================
  // 2:55  "China is running the counter strategy. Its World Buddhist Forum
  //        drew delegates from over 70 countries this year, and China is building
  //        temples and academies right next to India's own turf in Nepal..."
  // =====================================================================
  hl("CHN", 175.4, 182.6, { color: "red" });
  lbl("CHINA", "CHN", 175.6, 178.1, { size: 72 });
  title({ text: "The counter-strategy", at: [176.3, 176.46], t0: 176.3, t1: 178.3, x: 540, y: 300, size: 92, style: "sans", hl: [1] });
  pin("ningbo", 178.06, 180.4, { label: "NINGBO", sub: "WORLD BUDDHIST FORUM", color: "red", subColor: "cream", side: "left", size: 46 });
  ["USA", "CAN", "MEX", "BRA", "ARG", "GBR", "FRA", "DEU", "ITA", "ESP", "RUS", "ZAF", "KEN", "EGY", "AUS", "NZL", "JPN", "KOR", "MNG", "THA", "LKA", "MMR", "KHM", "LAO", "VNM", "NPL", "IDN", "MYS", "KAZ", "PAK"].forEach((iso, i) =>
    arc(iso, "ningbo", 179.3 + (i % 15) * 0.09 + Math.floor(i / 15) * 0.05, 182.4, { dur: 0.9, bend: 0.18, width: 3, arrow: false, color: "red", alpha: 0.8 }));
  counter({ t0: 180.54, t1: 182.4, x: 540, y: 330, to: 70, dur: 0.8, size: 220, suffix: "+", label: "countries" });

  hl("IND", 183.0, 187.2, { fill: 0.16 });
  hl("NPL", 183.0, 187.2, { color: "cream", fill: 0.22 });
  lbl("NEPAL", "NPL", 183.2, 187.1, { size: 58, dy: -150 });
  lbl("INDIA", [82.6, 25.9], 185.19, 187.1, { size: 58 });
  pin("lumbini", 183.35, 187.1, { label: "LUMBINI", sub: "BUDDHA'S BIRTHPLACE", side: "left", size: 44 });
  M.icons.push({ kind: "temple", at: "lumbini", dx: 150, dy: 10, t0: 183.34, t1: 187.1, color: "red", size: 1.1 });
  tag({ text: "China, building in Nepal", x: 540, y: 300, t0: 183.1, t1: 187.1, color: "red" });

  // 3:07  "...finishing its own version of Nalanda, the Nanhai Academy, before
  //        India could revive the original nearby."
  ph("nalanda", { x: 540, y: 520, w: 780, h: 520, rot: -2, t0: 188.3, t1: 194.0, enter: "left", dist: 900, exit: "left" });
  tag({ text: "Nalanda · India", sub: "the original", x: 540, y: 800, t0: 188.8, t1: 193.9, color: "cream" });
  ph("nanhai", { x: 540, y: 1030, w: 780, h: 480, rot: 2, t0: 189.4, t1: 194.0, enter: "right", dist: 900, exit: "right" });
  tag({ text: "Nanhai Buddhist Academy", sub: "Hainan, China", x: 540, y: 1290, t0: 189.9, t1: 193.9, color: "red" });
  marker({ kind: "circle", x: 540, y: 520, rx: 440, ry: 300, t0: 192.54, t1: 193.9 });

  // =====================================================================
  // 3:14  "The sharpest edge of all this is the succession of the Dalai Lama.
  //        In 2025, he said only his own office could name his successor.
  //        India backed this position publicly."
  // =====================================================================
  title({ text: "The succession", at: [196.11, 196.27], t0: 196.1, t1: 202.4, x: 540, y: 230, size: 104, style: "sans", hl: [1] });
  ph("dalai", { x: 540, y: 830, w: 620, h: 760, rot: -2, t0: 196.9, t1: 202.5, enter: "up", dist: 900, exit: "left" });
  tag({ text: "The 14th Dalai Lama", x: 540, y: 1250, t0: 197.4, t1: 200.2 });
  tag({ text: "July 2025", x: 540, y: 360, t0: 198.35, t1: 202.4, color: "navy" });
  tag({ text: "Only his office names the next", x: 540, y: 1250, t0: 200.35, t1: 202.4 });

  seg(202.45, 215.0, [[202.45, 91, 34, 12.5, 860], [215.0, 92, 34, 13.2, 860, "linear"]]);
  hl("IND", 202.6, 215.0, { fill: 0.3 });
  pin("dharamshala", 202.8, 214.9, { label: "DHARAMSHALA", sub: "SEAT OF THE DALAI LAMA", side: "bottom", size: 44 });
  tag({ text: "India publicly backs him", x: 540, y: 300, t0: 202.99, t1: 205.1 });

  // 3:25  "And yet China insists it must approve of that choice instead,
  //        calling the dispute, in its own words, a thorn in the relationship.
  //        And no one yet knows how this will play out."
  hl("CHN", 205.5, 215.0, { color: "red", fill: 0.3 });
  pin("beijing", 205.55, 214.9, { label: "BEIJING", color: "red", side: "top", size: 48 });
  arc("beijing", "dharamshala", 206.1, 214.9, { dur: 1.2, dashed: true, color: "red", bend: -0.2 });
  tag({ text: "China: it must approve", x: 540, y: 300, t0: 206.11, t1: 208.4, color: "red" });
  doc({
    t0: 208.49, t1: 212.3, x: 540, y: 620, w: 880, rot: 1.5,
    head: "China, on the dispute",
    body: `“…a <m data-at="210.65" data-dur="0.5">thorn</m> in China–India relations.”`,
  });
  M.icons.push({ kind: "question", at: [97, 33], t0: 212.41, t1: 214.9, size: 1.3 });

  // =====================================================================
  // 3:35  "Sarnath's test is still in its future. The plan meant to protect
  //        these fragile ruins from a tourism boom caused by the UNESCO listing
  //        still hadn't been published as of late July. And how well the site
  //        can actually handle such crowds is yet to be seen."
  // =====================================================================
  ph("dhamek", { frame: "full", t0: 215.0, t1: 228.9, enter: "fade", inDur: 0.4, kb: [1.02, 1.14], dimKf: [[215, 0.6], [217.5, 0.6], [218.1, 0.95]] });
  title({ text: "Sarnath's test", t0: 215.12, t1: 217.6, x: 540, y: 560, size: 120, style: "serif", sync: true, hl: [1] });
  doc({ t0: 217.76, t1: 224.7, x: 540, y: 820, w: 820, rot: -2, head: "Site management plan · Sarnath", title: "Protecting the ruins from a tourism boom", bars: 5 });
  stamp({ text: "Not published", x: 560, y: 900, rot: -12, size: 62, red: true, t0: 222.56, t1: 224.7 });
  tag({ text: "As of late July", x: 540, y: 300, t0: 223.69, t1: 224.7, color: "navy" });
  box({
    html: `<div style="display:grid;grid-template-columns:repeat(12,1fr);gap:14px 18px;width:100%">${Array.from({ length: 84 }, (_, i) =>
      `<div class="p" style="height:92px;opacity:0">${gfx.person(i % 7 === 3 ? "#E2BE6A" : "#F3EBDA")}</div>`).join("")}</div>`,
    w: 980, h: 800, x: 540, y: 900, t0: 224.8, t1: 228.9, enter: "fade", inDur: 0.2,
    tick(t, node) {
      node.querySelectorAll(".p").forEach((p, i) => {
        const at = 225.0 + V.rand(i + 7) * 2.6;
        p.style.opacity = (V.prog(t, at, at + 0.2) * 0.9).toFixed(3);
      });
    },
  });
  tag({ text: "Can the site cope?", x: 540, y: 300, t0: 226.3, t1: 228.8 });

  // =====================================================================
  // 3:48  "This lion has been a political tool for almost eighty years now.
  //        First as a binder to hold India together, now to help place India as
  //        a leader for a Buddhist community of roughly half a billion people worldwide."
  // =====================================================================
  ph("lion", { x: 540, y: 880, w: 600, h: 760, rot: 2, t0: 228.86, t1: 232.95, enter: "up", dist: 900, exit: "down", kb: [1.05, 1.15] });
  counter({ t0: 231.42, t1: 235.7, x: 540, y: 330, to: 80, dur: 0.8, size: 200, prefix: "~", label: "years as a political tool", labelSize: 30 });
  seg(232.85, 251.7, [
    [232.85, 81, 22, 11, 860],
    [235.7, 81, 22, 12, 860, "linear"],
    [238.2, 98, 24, 4.4, 860],
    [242.7, 98, 24, 4.6, 860, "linear"],
    [251.7, 70, 22, 3.3, 860, "inOutSine"],
  ]);
  hl("IND", 233.2, 251.7, { fill: 0.4, pulse: true });
  tag({ text: "1947: hold India together", x: 540, y: 1230, t0: 233.58, t1: 235.6 });
  tag({ text: "2026: lead the Buddhist world", x: 540, y: 300, t0: 236.38, t1: 242.6 });
  ["LKA", "MMR", "THA", "LAO", "KHM", "VNM", "BTN", "NPL", "MNG", "CHN", "KOR", "JPN", "TWN", "SGP", "MYS"].forEach((iso, i) =>
    hl(iso, 237.4 + i * 0.22, 251.7, { fill: 0.3, color: iso === "CHN" ? "cream" : "gold" }));
  counter({ t0: 240.13, t1: 242.6, x: 540, y: 1150, to: 500000000, dur: 1.0, size: 110, prefix: "~", label: "Buddhists worldwide", labelSize: 28 });

  // 4:02  "This example in our heritage is used for geopolitical maneuvers is
  //        exactly why we should look more closely at how it happens everywhere else too."
  title({ text: "Heritage → geopolitics", at: [243.81, 244.61, 245.01], t0: 243.8, t1: 247.3, x: 540, y: 300, size: 84, style: "sans", hl: [2] });
  const montage = ["lion", "dhamek", "buddha", "cunningham", "nehru", "dashavatara", "nalanda", "nanhai", "dalai", "ruins"];
  montage.forEach((key, i) => {
    const x = 230 + V.rand(i * 3.3) * 620, y = 560 + V.rand(i * 5.1 + 1) * 640;
    ph(key, { x, y, w: 360, h: 280, rot: (V.rand(i * 7.7) - 0.5) * 22, t0: 247.4 + i * 0.28, t1: 251.6, enter: "pop", inDur: 0.35, exit: "fade" });
  });
  title({ text: "Everywhere else", t0: 249.5, t1: 251.6, x: 540, y: 300, size: 92, style: "serif-i", sync: true, hl: [0] });

  // 4:11  "Every flag, every ruin, and every plaque carries a deeper message
  //        that goes beyond the veneer of heritage."
  box({ html: gfx.indiaFlag(), cls: "photo print", w: 460, h: 320, x: 310, y: 560, rot: -6, t0: 251.97, t1: 255.6, enter: "pop", exit: "shrink" });
  ph("ruins", { x: 760, y: 820, w: 460, h: 340, rot: 5, t0: 252.85, t1: 255.6, enter: "pop", exit: "shrink" });
  box({
    html: gfx.plaque(`<div style="font-family:Mono;font-weight:700;font-size:20px;letter-spacing:.18em">WORLD HERITAGE SITE</div>
      <div style="font-weight:900;font-size:50px;line-height:1">SARNATH</div>
      <div style="font-weight:700;font-style:italic;font-size:26px">Ancient Buddhist site</div>`),
    w: 480, h: 300, x: 360, y: 1090, rot: -3, t0: 253.66, t1: 255.6, enter: "pop", exit: "shrink",
  });
  title({ text: "Beyond the \\n veneer of heritage", t0: 255.83, t1: 257.95, x: 540, y: 760, size: 110, style: "serif", sync: true, hl: [5], outDur: 0.5 });

  // ---------- end card: fade to the Heritle logo ----------
  const end = V.layers.end;
  end.innerHTML = `<img src="../brand/heritle-logo-white.svg" alt="Heritle"><div class="word">HERITLE</div>`;
  V.loadImage("../brand/heritle-logo-white.svg");
  const logo = end.querySelector("img"), word = end.querySelector(".word");
  V.add({
    t0: 0, t1: 1e9, always: true, el: null,
    update(t) {
      end.style.opacity = V.ease.inOutSine(V.prog(t, VO_END - 0.1, VO_END + 0.9)).toFixed(3);
      const p = V.ease.outCubic(V.prog(t, VO_END + 0.3, VO_END + 2.2));
      logo.style.opacity = p.toFixed(3);
      logo.style.transform = `scale(${V.lerp(0.9, 1, p).toFixed(4)})`;
      logo.style.filter = `drop-shadow(0 0 ${(40 * p).toFixed(1)}px rgba(201,162,75,.35))`;
      const q = V.ease.outCubic(V.prog(t, VO_END + 1.0, VO_END + 2.2));
      word.style.opacity = q.toFixed(3);
      word.style.transform = `translateY(${((1 - q) * 20).toFixed(1)}px)`;
    },
  });

  // ---------- go ----------
  M.cams.sort((a, b) => a[0] - b[0]);
  M.alpha.push([END, 0]);
  await V.makeMap(M);
  await V.ready();
  window.__duration = END;
  window.__setFrame = (t) => V.setFrame(t);
  V.setFrame(0);
  window.__ready = true;
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  window.__error = String(err && err.stack ? err.stack : err);
});

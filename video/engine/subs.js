/**
 * Voiceover transcript: word-synced subtitles, and word lookups for the
 * scene file (V.syncTimes, V.at) so animations land on the spoken word.
 *
 * Expects a Deepgram-style transcript: { words: [{ word, start, end, punctuated_word }] }.
 */
(function () {
  const V = window.V;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, "");

  V.useTranscript = (json, opts = {}) => {
    V.words = json.words.map((w) => ({ w: norm(w.word), text: w.punctuated_word, start: w.start, end: w.end }));
    if (opts.subtitles !== false) buildSubs(opts);
  };

  /** Start time of the first spoken `word` at or after time `from`. */
  V.at = (word, from = 0) => {
    const n = norm(word);
    const hit = V.words.find((w) => w.start >= from - 0.05 && w.w === n);
    if (!hit) throw new Error(`V.at: "${word}" not spoken after ${from}s`);
    return hit.start;
  };

  /** Per-word times for a phrase spoken at or after `from` (unmatched words follow the previous). */
  V.syncTimes = (words, from) => {
    let cursor = V.words.findIndex((w) => w.start >= from - 0.3);
    if (cursor < 0) cursor = V.words.length;
    let last = from;
    return words.map((wd) => {
      const n = norm(wd);
      for (let k = cursor; k < Math.min(cursor + 8, V.words.length); k++) {
        if (V.words[k].w === n || (n.length > 3 && V.words[k].w.startsWith(n.slice(0, 4)))) {
          cursor = k + 1;
          last = V.words[k].start;
          return last;
        }
      }
      last += 0.06;
      return last;
    });
  };

  // ---------- subtitles ----------
  function buildSubs(opts) {
    // Fix transcription slips and write spoken numbers as numerals.
    const merges = opts.merges || [];
    const fixes = opts.fixes || {};
    const words = [];
    for (let i = 0; i < V.words.length; i++) {
      const merge = merges.find((m) => m.match.every((mw, k) => V.words[i + k] && V.words[i + k].w === mw));
      if (merge) {
        const lastW = V.words[i + merge.match.length - 1];
        const trail = (lastW.text.match(/[.,!?]+$/) || [""])[0];
        words.push({ text: merge.text + trail, start: V.words[i].start, end: lastW.end });
        i += merge.match.length - 1;
        continue;
      }
      const w = V.words[i];
      words.push({ text: fixes[w.text] || w.text, start: w.start, end: w.end });
    }

    // Chunk into short lines: break on sentence ends, long pauses, commas
    // once a line is long enough, and a hard character cap.
    const MAX = opts.maxChars || 30;
    const chunks = [];
    let cur = [];
    const len = (c) => c.reduce((n, w) => n + w.text.length + 1, 0);
    for (let i = 0; i < words.length; i++) {
      const w = words[i], next = words[i + 1];
      if (cur.length && len(cur) + w.text.length > MAX) { chunks.push(cur); cur = []; }
      cur.push(w);
      const endSentence = /[.!?]$/.test(w.text);
      const pause = next ? next.start - w.end > 0.32 : true;
      const comma = /,$/.test(w.text) && len(cur) > 14;
      if (endSentence || pause || comma || !next) { chunks.push(cur); cur = []; }
    }
    if (cur.length) chunks.push(cur);

    const layer = V.layers.subs;
    const endAt = opts.endAt ?? 1e9;
    chunks.forEach((c, idx) => {
      const node = document.createElement("div");
      node.className = "chunk";
      const spans = c.map((w, k) => {
        const s = document.createElement("span");
        s.textContent = w.text + (k < c.length - 1 ? " " : "");
        node.appendChild(s);
        return s;
      });
      layer.appendChild(node);
      const next = chunks[idx + 1];
      const t0 = c[0].start - 0.05;
      const t1 = Math.min(next ? next[0].start - 0.05 : c[c.length - 1].end + 0.6, c[c.length - 1].end + 0.9, endAt);
      V.add({
        t0, t1, el: node,
        update(t) {
          const p = V.ease.outCubic(V.prog(t, t0, t0 + 0.12));
          node.style.opacity = p.toFixed(3);
          node.style.transform = `translateY(${((1 - p) * 14).toFixed(1)}px)`;
          c.forEach((w, k) => {
            const on = t >= w.start - 0.02 && (k === c.length - 1 ? true : t < c[k + 1].start - 0.02);
            spans[k].className = on ? "on" : "";
          });
        },
      });
    });
  }
})();

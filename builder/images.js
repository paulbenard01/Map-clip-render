/**
 * Image finder: searches openly-licensed photos and imports the chosen one
 * into assets/.
 *
 * The scene always references a local file path, never a remote URL — so a
 * render never depends on someone else's server still being up, and stays
 * reproducible offline. Attribution travels with the file (the server writes
 * it into assets/credits.json), because these licences generally require
 * crediting the photographer and that's painful to reconstruct later.
 */

let modal = null;
let onPickCallback = null;

export function openImagePicker(opts) {
  onPickCallback = opts.onPick;
  if (!modal) modal = buildModal();
  modal.classList.add("open");
  const input = modal.querySelector(".img-query");
  input.value = opts.query || "";
  input.focus();
  input.select();
  if (opts.query) runSearch(opts.query);
}

function closeModal() {
  if (modal) modal.classList.remove("open");
  onPickCallback = null;
}

function buildModal() {
  const node = document.createElement("div");
  node.className = "modal image-modal";
  node.innerHTML = `
    <div class="modal-panel">
      <div class="modal-head">
        <h2>Find a photo</h2>
        <button class="btn modal-close" type="button">Close</button>
      </div>
      <div class="modal-search">
        <input class="img-query" type="search" placeholder="e.g. Dhamek Stupa Sarnath" />
        <select class="img-source">
          <option value="all">Commons + Openverse</option>
          <option value="commons">Wikimedia Commons</option>
          <option value="openverse">Openverse</option>
        </select>
        <button class="btn primary img-go" type="button">Search</button>
      </div>
      <p class="modal-note muted">
        Openly-licensed results only. The photo is copied into <code>assets/</code> and
        credited in <code>assets/credits.json</code> — check the licence before publishing.
      </p>
      <div class="img-results"></div>
    </div>`;
  document.body.appendChild(node);

  node.querySelector(".modal-close").onclick = closeModal;
  node.addEventListener("click", (e) => { if (e.target === node) closeModal(); });
  node.querySelector(".img-go").onclick = () => runSearch(node.querySelector(".img-query").value);
  node.querySelector(".img-query").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(e.target.value);
    if (e.key === "Escape") closeModal();
  });
  return node;
}

async function runSearch(query) {
  if (!query.trim()) return;
  const results = modal.querySelector(".img-results");
  const source = modal.querySelector(".img-source").value;
  results.innerHTML = '<p class="muted">Searching…</p>';

  let data;
  try {
    const res = await fetch(`/api/images/search?q=${encodeURIComponent(query)}&source=${source}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
  } catch (err) {
    results.innerHTML = `<p class="error">Search failed: ${escapeHtml(err.message)}</p>
      <p class="muted">This is the one part of the tool that needs the internet. Rendering doesn't —
      you can always drop a file in with Upload instead.</p>`;
    return;
  }

  const items = (data.results || []).filter((r) => !r.error);
  const errors = (data.results || []).filter((r) => r.error);
  results.innerHTML = "";

  errors.forEach((e) => {
    results.appendChild(node(`<p class="error">${escapeHtml(e.source)} unavailable: ${escapeHtml(e.message || "unknown error")}</p>`));
  });

  if (!items.length) {
    results.appendChild(node('<p class="muted">No results. Try a different wording, or the place name in the local language.</p>'));
    return;
  }

  const grid = document.createElement("div");
  grid.className = "img-grid";
  items.forEach((item) => grid.appendChild(resultCard(item)));
  results.appendChild(grid);
}

function resultCard(item) {
  const card = document.createElement("figure");
  card.className = "img-card";
  card.innerHTML = `
    <img src="${escapeHtml(item.thumbUrl || item.fullUrl)}" alt="" loading="lazy" />
    <figcaption>
      <strong>${escapeHtml(truncate(item.title, 60))}</strong>
      <span class="muted">${escapeHtml(item.license || "")}${item.creator ? " · " + escapeHtml(truncate(item.creator, 30)) : ""}</span>
      <span class="muted">${escapeHtml(item.source)}</span>
    </figcaption>`;

  card.onclick = async () => {
    card.classList.add("importing");
    const caption = card.querySelector("figcaption");
    const previous = caption.innerHTML;
    caption.innerHTML = "<strong>Importing…</strong>";
    try {
      const res = await fetch("/api/images/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: item.fullUrl,
          title: item.title,
          creator: item.creator,
          license: item.license,
          licenseUrl: item.licenseUrl,
          sourcePage: item.sourcePage,
          source: item.source,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      if (onPickCallback) onPickCallback(body.path);
      closeModal();
    } catch (err) {
      caption.innerHTML = previous;
      card.classList.remove("importing");
      window.alert("Could not import that image: " + err.message);
    }
  };
  return card;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function node(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

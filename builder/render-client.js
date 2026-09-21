/**
 * Drives /api/render and reports progress.
 *
 * The page never captures video itself. It posts the scene and the server
 * runs the same frame-exact pipeline the CLI does — stepping the camera one
 * frame at a time and screenshotting — which is what makes the output's
 * timing exact regardless of machine speed. A canvas/MediaRecorder capture
 * would be real-time and would drift.
 */

let panel = null;
let currentJob = null;
let eventSource = null;

export function init(elements) {
  panel = elements.renderPanel;
}

export async function startRender(opts) {
  if (currentJob) {
    window.alert("A render is already running.");
    return;
  }

  showPanel({ status: "running", phase: "starting", message: "Starting…", frame: 0, totalFrames: 0 });

  let res, body;
  try {
    res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
  } catch (err) {
    showPanel({ status: "error", error: "Could not start the render: " + err.message });
    return;
  }

  currentJob = body.jobId;
  follow(body.jobId);
}

/**
 * Server-sent events for progress, with polling as a fallback — a dropped
 * SSE connection shouldn't leave the UI stuck on "rendering" while the file
 * is quietly finished on disk.
 */
function follow(jobId) {
  eventSource = new EventSource(`/api/render/${jobId}/events`);
  let sawEvent = false;

  eventSource.onmessage = (e) => {
    sawEvent = true;
    const job = JSON.parse(e.data);
    showPanel(job);
    if (job.status !== "running") finish();
  };

  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    poll(jobId, sawEvent);
  };
}

async function poll(jobId, hadEvents) {
  try {
    const res = await fetch(`/api/render/${jobId}`);
    if (!res.ok) throw new Error("job gone");
    const job = await res.json();
    showPanel(job);
    if (job.status === "running") return void setTimeout(() => poll(jobId, hadEvents), 1000);
    finish();
  } catch (err) {
    if (!hadEvents) showPanel({ status: "error", error: "Lost contact with the render job." });
    finish();
  }
}

function finish() {
  if (eventSource) { eventSource.close(); eventSource = null; }
  currentJob = null;
}

export async function cancelRender() {
  if (!currentJob) return;
  await fetch(`/api/render/${currentJob}/cancel`, { method: "POST" });
}

function showPanel(job) {
  panel.classList.add("open");
  const pct = job.totalFrames ? Math.round((job.frame / job.totalFrames) * 100) : 0;

  if (job.status === "done" && job.output) {
    panel.innerHTML = `
      <div class="render-head"><strong>Render complete</strong>
        <button class="btn render-close" type="button">Close</button></div>
      <video src="${job.output.url}" controls autoplay loop muted playsinline></video>
      <p class="muted">${job.output.width}×${job.output.height} · ${job.output.fps}fps · ${job.output.duration.toFixed(1)}s</p>
      <p><a class="btn primary" href="${job.output.url}" download>Download MP4</a>
         <code class="muted">${escapeHtml(job.output.file)}</code></p>`;
  } else if (job.status === "error") {
    panel.innerHTML = `
      <div class="render-head"><strong>Render failed</strong>
        <button class="btn render-close" type="button">Close</button></div>
      <p class="error">${escapeHtml(job.error || "Unknown error")}</p>`;
  } else if (job.status === "cancelled") {
    panel.innerHTML = `
      <div class="render-head"><strong>Render cancelled</strong>
        <button class="btn render-close" type="button">Close</button></div>`;
  } else {
    const label = job.phase === "encoding" ? "Encoding with ffmpeg…"
      : job.phase === "frames" ? `Rendering frame ${job.frame} / ${job.totalFrames}`
      : (job.message || "Starting…");
    panel.innerHTML = `
      <div class="render-head"><strong>Rendering</strong>
        <button class="btn render-cancel" type="button">Cancel</button></div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      <p class="muted">${escapeHtml(label)}</p>`;
  }

  const close = panel.querySelector(".render-close");
  if (close) close.onclick = () => panel.classList.remove("open");
  const cancel = panel.querySelector(".render-cancel");
  if (cancel) cancel.onclick = cancelRender;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

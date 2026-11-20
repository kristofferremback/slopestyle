import type { SnapshotResponse } from "../lib/actions/server.ts";
import type { GroupView, JobView, PipelineView, RunView, State } from "../lib/actions/view.ts";

const labels: Record<State, string> = {
  queued: "Queued",
  running: "Running",
  failing: "Running, with failed jobs",
  waiting: "Waiting",
  success: "Succeeded",
  failure: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

const icons: Record<State, string> = {
  queued: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>',
  running: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"/><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  failing: '<path d="M8 1.5 15 14H1z" fill="currentColor"/><path d="M8 6v4M8 11.5v.5" stroke="var(--surface-1)" stroke-width="1.6" stroke-linecap="round"/>',
  waiting: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/><path d="M6.3 5v6M9.7 5v6" stroke="var(--surface-1)" stroke-width="1.6" stroke-linecap="round"/>',
  success: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/><path d="m5 8.2 2 2 4-4.2" fill="none" stroke="var(--surface-1)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  failure: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/><path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="var(--surface-1)" stroke-width="1.7" stroke-linecap="round"/>',
  cancelled: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m4 12 8-8" stroke="currentColor" stroke-width="1.5"/>',
  skipped: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.5"/>',
};

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const lanes = $("#lanes");
const banner = $("#banner");
const updated = $("#updated");
const repoLink = $<HTMLAnchorElement>("#repo");

// The user's expand/collapse choices, keyed by run id and group name. Anything absent follows the default.
const choices = new Map<string, boolean>();
let snapshot: SnapshotResponse | null = null;
let renderedKey = "";

const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ms = (value: string | null): number => (value === null ? NaN : Date.parse(value));

const isActive = (run: RunView): boolean => run.status !== "completed";

function icon(state: State): string {
  return `<svg class="icon ${state}" viewBox="0 0 16 16" role="img" aria-label="${labels[state]}">${icons[state]}</svg>`;
}

function duration(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 10) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Elements that keep moving carry their own timestamps; tick() rewrites them without re-rendering.
const durationText = (start: string | null, end: string | null): string => {
  const from = ms(start);
  return Number.isNaN(from) ? "" : duration(from, end ? ms(end) : Date.now());
};

const durSpan = (start: string | null, end: string | null): string => `<span class="dur num" data-s="${start ?? ""}" data-e="${end ?? ""}">${durationText(start, end)}</span>`;

function bar(state: State, start: string | null, end: string | null): string {
  if (start === null) return '<span class="track"></span>';
  return `<span class="track"><span class="bar ${state}" data-s="${start}" data-e="${end ?? ""}"></span></span>`;
}

function expanded(key: string, byDefault: boolean): boolean {
  return choices.get(key) ?? byDefault;
}

function jobRow(job: JobView): string {
  const state = job.state;
  const name = job.url ? `<a href="${esc(job.url)}" target="_blank" rel="noreferrer">${esc(job.name)}</a>` : esc(job.name);
  return `<div class="row job ${state}">${icon(state)}<span class="name" title="${esc(job.name)}">${name}</span>${durSpan(job.startedAt, job.completedAt)}${bar(state, job.startedAt, job.completedAt)}</div>`;
}

function groupRow(run: RunView, group: GroupView): string {
  const state = group.state;
  const key = `g:${run.id}:${group.name}`;
  const open = expanded(key, false);
  const single = group.jobs.length === 1 && group.jobs[0]!.url;
  const name = single ? `<a href="${esc(single)}" target="_blank" rel="noreferrer">${esc(group.name)}</a>` : esc(group.name);
  const chev = group.jobs.length > 1 ? `<button type="button" class="chev" aria-expanded="${open}" aria-label="Toggle ${esc(group.name)} jobs"></button>` : "<span></span>";
  const row = `<div class="row group ${state}" data-toggle="${esc(key)}">${chev}${icon(state)}<span class="name" title="${esc(group.name)}">${name}</span>${durSpan(group.startedAt, group.completedAt)}${bar(state, group.startedAt, group.completedAt)}</div>`;
  return open && group.jobs.length > 1 ? `<div class="open">${row}${group.jobs.map(jobRow).join("")}</div>` : row;
}

function timeline(run: RunView): string {
  const shown = run.groups.filter((group) => group.state !== "skipped");
  const skipped = run.groups.length - shown.length;
  const t0 = ms(run.startedAt);
  const ends = [ms(run.updatedAt), ...run.groups.map((group) => ms(group.completedAt))].filter((value) => !Number.isNaN(value));
  const t1 = isActive(run) ? "" : String(Math.max(...ends));
  const skippedLine = skipped > 0 ? `<div class="row skipped-line" title="${esc(run.groups.filter((group) => group.state === "skipped").map((group) => group.name).join(", "))}">${icon("skipped")}<span>${skipped} skipped</span></div>` : "";
  return `<div class="timeline" data-t0="${t0}" data-t1="${t1}">${shown.map((group) => groupRow(run, group)).join("")}${skippedLine}</div>`;
}

function card(run: RunView, newest: boolean): string {
  const state = run.state;
  const open = expanded(`r:${run.id}`, newest) && run.groups.length > 0;
  const started = ms(run.startedAt);
  const end = isActive(run) ? null : run.updatedAt;
  const meta = [
    `<span>#${run.number}${run.attempt > 1 ? ` (attempt ${run.attempt})` : ""}</span>`,
    run.event !== "push" ? `<span>${esc(run.event)}</span>` : "",
    run.branch && !run.title.includes(run.branch) ? `<span>${esc(run.branch)}</span>` : "",
    `<span class="sha">${esc(run.sha.slice(0, 7))}</span>`,
    run.actor ? `<span>${esc(run.actor)}</span>` : "",
    `<span class="rel" data-ts="${started}" title="${esc(new Date(started).toLocaleString())}">${ago(started)}</span>`,
  ].join("");
  const failing = state === "failing" ? '<span class="tag failing">failing</span>' : "";
  const chips = [
    ...run.failedJobs.map((job) => `<a class="chip fail" ${job.url ? `href="${esc(job.url)}" target="_blank" rel="noreferrer"` : ""} title="${esc(job.name)}">${esc(job.name)}</a>`),
    ...(run.jobsError ? [`<span class="chip" title="${esc(run.jobsError)}">Jobs unavailable: ${esc(run.jobsError)}</span>`] : []),
    ...run.sameCommit.map((match) => `<a class="chip" href="#run-${match.id}" title="Same commit">${esc(match.pipeline)} #${match.number}</a>`),
  ];
  const chev = run.groups.length > 0 ? `<button type="button" class="chev" aria-expanded="${open}" aria-label="Toggle jobs"></button>` : "<span></span>";
  return `<article class="card ${state}${open ? " open" : ""}" id="run-${run.id}">
    <div class="card-head" data-toggle="r:${run.id}">${chev}${icon(state)}
      <span class="title"><a href="${esc(run.url)}" target="_blank" rel="noreferrer" title="${esc(run.title)}">${esc(run.title)}</a> ${failing}</span>
      ${durSpan(run.startedAt, end)}
      <span class="meta">${meta}</span>
    </div>
    ${chips.length > 0 ? `<div class="chips">${chips.join("")}</div>` : ""}
    ${open ? timeline(run) : ""}
  </article>`;
}

function lane(pipeline: PipelineView): string {
  const active = pipeline.runs.filter(isActive);
  const failing = active.filter((run) => run.state === "failing").length;
  const counts = [active.length > 0 ? `${active.length} active` : "", failing > 0 ? `${failing} failing` : ""].filter(Boolean).join(" · ");
  const newest = pipeline.runs.reduce<RunView | null>((best, run) => (!best || ms(run.createdAt) > ms(best.createdAt) ? run : best), null);
  const pips = [...pipeline.runs]
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
    .map((run) => `<a class="pip ${run.state}" href="#run-${run.id}" title="#${run.number} ${esc(run.title)} · ${labels[run.state]}"></a>`)
    .join("");
  const body = pipeline.runs.length === 0 ? '<p class="hint empty">No runs yet.</p>' : pipeline.runs.map((run) => card(run, run === newest)).join("");
  return `<section aria-label="${esc(pipeline.name)}"><div class="lane-head"><h2><a href="${esc(pipeline.url)}" target="_blank" rel="noreferrer">${esc(pipeline.name)}</a></h2><span class="counts hint">${counts}</span><span class="pips" aria-hidden="true">${pips}</span></div>${body}</section>`;
}

function render(force = false): void {
  if (!snapshot) return;
  repoLink.textContent = snapshot.repo;
  repoLink.href = `https://github.com/${snapshot.repo}/actions`;
  document.title = `Actions · ${snapshot.repo}`;
  banner.hidden = !snapshot.error;
  if (snapshot.error) banner.textContent = `GitHub poll failed at ${new Date(snapshot.error.at).toLocaleTimeString()}: ${snapshot.error.message}.${snapshot.polledAt ? " Showing the last good data." : ""}`;
  // Live durations differ on every render, so compare the data: unchanged polls never touch the DOM.
  const key = JSON.stringify([snapshot.pipelines, snapshot.loading]);
  if (!force && key === renderedKey) return;
  renderedKey = key;
  const { scrollX, scrollY } = window;
  lanes.innerHTML = snapshot.loading ? '<p class="hint">Waiting for the first poll…</p>' : snapshot.pipelines.map(lane).join("");
  tick();
  window.scrollTo(scrollX, scrollY);
}

// Rewrites everything that moves with the clock: live durations, bars on the run axis, relative times.
function tick(): void {
  const now = Date.now();
  for (const el of lanes.querySelectorAll<HTMLElement>(".dur[data-e='']")) el.textContent = durationText(el.dataset.s ?? null, null);
  for (const el of lanes.querySelectorAll<HTMLElement>(".rel")) el.textContent = ago(Number(el.dataset.ts));
  for (const track of lanes.querySelectorAll<HTMLElement>(".timeline")) {
    const t0 = Number(track.dataset.t0);
    const span = Math.max(1000, (track.dataset.t1 ? Number(track.dataset.t1) : now) - t0);
    for (const el of track.querySelectorAll<HTMLElement>(".bar")) {
      const start = (ms(el.dataset.s ?? null) - t0) / span;
      const end = (el.dataset.e ? ms(el.dataset.e) - t0 : now - t0) / span;
      el.style.left = `${Math.min(99, Math.max(0, start * 100))}%`;
      el.style.width = `${Math.max(0, Math.min(100, end * 100) - Math.max(0, start * 100))}%`;
    }
  }
  if (snapshot?.polledAt) updated.textContent = `updated ${duration(ms(snapshot.polledAt), now)} ago`;
}

async function load(refresh: boolean): Promise<void> {
  try {
    const response = await fetch(refresh ? "/api/refresh" : "/api/snapshot", { method: refresh ? "POST" : "GET" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot = (await response.json()) as SnapshotResponse;
    render();
  } catch (error) {
    banner.hidden = false;
    banner.textContent = `Cannot reach the local server: ${error instanceof Error ? error.message : String(error)}`;
  }
}

lanes.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("a")) return;
  const toggle = target.closest<HTMLElement>("[data-toggle]");
  const chev = toggle?.querySelector("[aria-expanded]");
  if (!toggle?.dataset.toggle || !chev) return;
  choices.set(toggle.dataset.toggle, chev.getAttribute("aria-expanded") !== "true");
  render(true);
});

$("#refresh").addEventListener("click", () => void load(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void load(false);
});
setInterval(() => {
  if (document.visibilityState === "visible") void load(false);
}, 5000);
setInterval(tick, 1000);
void load(false);

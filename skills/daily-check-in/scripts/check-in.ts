import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const defaultRoot = join(homedir(), ".local", "share", "galdera-check-in");
const sources = ["calendar", "t3", "vault", "linear", "github", "slack", "email", "todos"] as const;
type SourceName = typeof sources[number];
type Link = { label: string; url?: string };
type Item = { id: string; title: string; status: "open" | "blocked" | "done" | "dropped"; plan: "must" | "aim" | "later"; rationale: string; timing: string; you: string; others: string; sources: Link[]; effort: "XS" | "S" | "M" | "L" | "XL" | "unknown"; quickWin?: boolean; attention?: "work" | "background" | "unassigned"; closureReason?: string; closureEvidence?: string; notRevalidated?: boolean };
type Decision = { id: string; itemId?: string; text: string; recordedAt: string; expiresOn?: string; state: "active" | "retired" };
type Coverage = { source: SourceName; status: "checked" | "partial" | "unavailable" | "not-configured"; window: string; detail: string; nextStep: string };
export type Report = { version: 1; date: string; capturedAt: string; headline: string; summary: string; dayContext: { windows: string; constraints: string }; items: Item[]; decisions: Decision[]; coverage: Coverage[]; suggestions: string[]; questions: string[] };
export type Snapshot = { revision: number; report: Report };

function object(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${where} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(`${where}.${key} is unknown`);
}
function string(value: unknown, where: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw Error(`${where} must be a nonempty string`);
  return value;
}
function choice<T extends string>(value: unknown, options: readonly T[], where: string): T {
  if (!options.includes(value as T)) throw Error(`${where} must be one of ${options.join(", ")}`);
  return value as T;
}
function array<T>(value: unknown, where: string, parse: (entry: unknown, where: string) => T): T[] {
  if (!Array.isArray(value)) throw Error(`${where} must be an array`);
  return value.map((entry, index) => parse(entry, `${where}[${index}]`));
}
function date(value: unknown, where: string): string {
  const result = string(value, where);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T12:00:00Z`)) || new Date(`${result}T12:00:00Z`).toISOString().slice(0, 10) !== result) throw Error(`${where} must be a valid YYYY-MM-DD date`);
  return result;
}
function instant(value: unknown, where: string): string {
  const result = string(value, where);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || Number.isNaN(Date.parse(result))) throw Error(`${where} must be an ISO timestamp with offset`);
  return result;
}
function unique(ids: string[], where: string): void {
  if (new Set(ids).size !== ids.length) throw Error(`${where} IDs must be unique`);
}
function link(value: unknown, where: string): Link {
  const v = object(value, where); keys(v, ["label", "url"], where);
  const label = string(v.label, `${where}.label`);
  if (v.url === undefined) return { label };
  const url = string(v.url, `${where}.url`);
  try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw Error(); }
  catch { throw Error(`${where}.url must be an HTTP(S) URL`); }
  return { label, url };
}
function item(value: unknown, where: string, stored = false): Item {
  const v = object(value, where); keys(v, ["id", "title", "status", "plan", "rationale", "timing", "you", "others", "sources", "effort", "quickWin", "attention", ...(stored ? ["quickWinMinutes"] : []), "closureReason", "closureEvidence", "notRevalidated"], where);
  const result: Item = {
    id: string(v.id, `${where}.id`), title: string(v.title, `${where}.title`),
    status: choice(v.status, ["open", "blocked", "done", "dropped"], `${where}.status`),
    plan: choice(v.plan, ["must", "aim", "later"], `${where}.plan`),
    rationale: string(v.rationale, `${where}.rationale`), timing: string(v.timing, `${where}.timing`),
    you: string(v.you, `${where}.you`, true), others: string(v.others, `${where}.others`, true),
    sources: array(v.sources, `${where}.sources`, link),
    effort: choice(stored && v.effort === undefined ? "unknown" : v.effort, ["XS", "S", "M", "L", "XL", "unknown"], `${where}.effort`),
  };
  if (v.attention !== undefined) result.attention = choice(v.attention, ["work", "background", "unassigned"] as const, `${where}.attention`);
  if (v.quickWin !== undefined) {
    if (typeof v.quickWin !== "boolean") throw Error(`${where}.quickWin must be a boolean`);
    result.quickWin = v.quickWin;
  } else if (stored && v.quickWinMinutes !== undefined) {
    if (!Number.isInteger(v.quickWinMinutes) || (v.quickWinMinutes as number) < 1 || (v.quickWinMinutes as number) > 15) throw Error(`${where}.quickWinMinutes is invalid`);
    result.quickWin = true; // Read early snapshots without retaining their time estimates.
  }
  if (v.closureReason !== undefined) result.closureReason = string(v.closureReason, `${where}.closureReason`);
  if (v.closureEvidence !== undefined) result.closureEvidence = string(v.closureEvidence, `${where}.closureEvidence`);
  if (v.notRevalidated !== undefined) {
    if (!stored || v.notRevalidated !== true) throw Error(`${where}.notRevalidated is helper-owned and cannot be supplied`);
    result.notRevalidated = true;
  }
  if (["done", "dropped"].includes(result.status) && (!result.closureReason || !result.closureEvidence)) throw Error(`${where} needs closureReason and closureEvidence`);
  if (!["done", "dropped"].includes(result.status) && (result.closureReason || result.closureEvidence)) throw Error(`${where} is not closed`);
  return result;
}
function decision(value: unknown, where: string): Decision {
  const v = object(value, where); keys(v, ["id", "itemId", "text", "recordedAt", "expiresOn", "state"], where);
  const result: Decision = { id: string(v.id, `${where}.id`), text: string(v.text, `${where}.text`), recordedAt: instant(v.recordedAt, `${where}.recordedAt`), state: choice(v.state, ["active", "retired"], `${where}.state`) };
  if (v.itemId !== undefined) result.itemId = string(v.itemId, `${where}.itemId`);
  if (v.expiresOn !== undefined) result.expiresOn = date(v.expiresOn, `${where}.expiresOn`);
  return result;
}
function coverage(value: unknown, where: string): Coverage {
  const v = object(value, where); keys(v, ["source", "status", "window", "detail", "nextStep"], where);
  return { source: choice(v.source, sources, `${where}.source`), status: choice(v.status, ["checked", "partial", "unavailable", "not-configured"], `${where}.status`), window: string(v.window, `${where}.window`), detail: string(v.detail, `${where}.detail`), nextStep: string(v.nextStep, `${where}.nextStep`, true) };
}
function parseReport(value: unknown, stored: boolean): Report {
  const v = object(value, "report"); keys(v, ["version", "date", "capturedAt", "headline", "summary", "dayContext", "items", "decisions", "coverage", "suggestions", "questions"], "report");
  if (v.version !== 1) throw Error("Unsupported report version; expected 1");
  const context = object(v.dayContext, "dayContext"); keys(context, ["windows", "constraints"], "dayContext");
  const result: Report = {
    version: 1, date: date(v.date, "date"), capturedAt: instant(v.capturedAt, "capturedAt"), headline: string(v.headline, "headline"), summary: string(v.summary, "summary"),
    dayContext: { windows: string(context.windows, "dayContext.windows"), constraints: string(context.constraints, "dayContext.constraints") },
    items: array(v.items, "items", (x, w) => item(x, w, stored)), decisions: array(v.decisions, "decisions", decision), coverage: array(v.coverage, "coverage", coverage),
    suggestions: array(v.suggestions, "suggestions", (x, w) => string(x, w)), questions: array(v.questions, "questions", (x, w) => string(x, w)),
  };
  const stockholmDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(result.capturedAt));
  if (stockholmDate !== result.date) throw Error("date must match capturedAt in Stockholm");
  unique(result.items.map(x => x.id), "Item"); unique(result.decisions.map(x => x.id), "Decision"); unique(result.coverage.map(x => x.source), "Coverage");
  if (result.coverage.length !== sources.length) throw Error(`coverage must include ${sources.join(", ")}`);
  return result;
}
export function validateReport(value: unknown): Report { return parseReport(value, false); }
function validateStoredReport(value: unknown): Report { return parseReport(value, true); }

const esc = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
// Deliberately only inline links, not Markdown or raw HTML. Encode URL parentheses.
const inlineLinks = /\[([^\]\n]+)\]\(([^\s()]+)\)/g;
function safeUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}
function prose(value: string): string {
  let result = "", offset = 0;
  for (const match of value.matchAll(inlineLinks)) {
    result += esc(value.slice(offset, match.index));
    result += safeUrl(match[2]) ? sourceHtml({ label: match[1], url: match[2] }) : esc(match[0]);
    offset = match.index! + match[0].length;
  }
  return (result + esc(value.slice(offset))).replace(/\n/g, "<br>");
}
function sourceHtml(link: Link): string { return link.url ? `<a href="${esc(link.url)}" rel="noopener noreferrer">${esc(link.label)}</a>` : `<span>${esc(link.label)} · link unavailable</span>`; }
function itemHtml(item: Item, anchor = true): string {
  const closure = item.closureReason ? `<p class="muted">Closure: ${prose(item.closureReason)} · ${prose(item.closureEvidence!)}</p>` : "";
  return `<details class="item"${anchor ? ` id="item-${encodeURIComponent(item.id)}"` : ""}>
    <summary><span class="item-heading"><strong>${item.sources[0]?.url ? sourceHtml({ label: item.title, url: item.sources[0].url }) : esc(item.title)}</strong><span class="meta"><span class="badge">${esc(item.plan === "must" ? "Must" : item.plan === "aim" ? "Aim" : "Later")}</span>${item.status !== "open" ? `<span class="badge state">${esc(item.status)}</span>` : ""}<span class="timing" title="Estimated effort">${item.effort === "unknown" ? "Effort ?" : item.effort}</span></span></span><span class="preview">${prose(item.you || item.rationale)}</span><span class="provenance">${item.sources[0] ? sourceHtml(item.sources[0]) : "Source missing"}</span></summary>
    <div class="item-body"><p>${prose(item.rationale)}</p>${item.notRevalidated ? '<p class="notice">Carried forward · not revalidated · no current action assumed</p>' : ""}<dl><div><dt>When</dt><dd>${prose(item.timing)}</dd></div><div><dt>You</dt><dd>${prose(item.you)}</dd></div><div><dt>Others</dt><dd>${prose(item.others)}</dd></div></dl>${closure}<div class="sources">Sources · ${item.sources.map(sourceHtml).join(" · ")}</div></div>
  </details>`;
}
function listHtml(values: string[]): string { return values.length ? `<ul>${values.map(x => `<li>${prose(x)}</li>`).join("")}</ul>` : '<p class="muted">None recorded.</p>'; }
export function changes(report: Report, previous?: Report): Link[] {
  if (!previous) return [{ label: "First recorded check-in." }];
  const prior = new Map(previous.items.map(x => [x.id, x]));
  const result: Link[] = [];
  for (const item of report.items) {
    const old = prior.get(item.id);
    let label: string | undefined;
    if (!old) label = `New: ${item.title}`;
    else if (item.notRevalidated) label = `Carried forward without revalidation: ${item.title}`;
    else if (item.status !== old.status || item.plan !== old.plan) label = `${item.title}: ${old.status}/${old.plan} → ${item.status}/${item.plan}`;
    else if (JSON.stringify(item) !== JSON.stringify(old)) label = `Updated: ${item.title}`;
    if (label) result.push({ label, url: item.sources[0]?.url });
  }
  return result.length ? result : [{ label: "No item changes recorded." }];
}
export function renderReport(report: Report, revision: number, archive: { revision: number; date: string }[] = [], previous?: Report): string {
  const active = report.decisions.filter(x => x.state === "active" && (!x.expiresOn || x.expiresOn >= report.date));
  const inactive = report.decisions.filter(x => !active.includes(x));
  const gaps = report.coverage.filter(source => source.status !== "checked");
  const open = report.items.filter(x => x.status === "open" || x.status === "blocked");
  const work = open.filter(x => !x.attention || x.attention === "work");
  const today = work.filter(x => x.plan !== "later" && !(x.quickWin && !x.notRevalidated && x.status === "open"));
  const later = work.filter(x => x.plan === "later" && !(x.quickWin && !x.notRevalidated && x.status === "open"));
  const background = open.filter(x => x.attention === "background");
  const unassigned = open.filter(x => x.attention === "unassigned");
  const closed = report.items.filter(x => x.status === "done" || x.status === "dropped");
  const quickWins = work.filter(x => x.quickWin && !x.notRevalidated && x.status === "open");
  const waiting = work.filter(x => x.status === "blocked");
  const changed = changes(report, previous);
  const capturedTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(report.capturedAt));
  const archiveDates = [...new Set(archive.map(x => x.date))].sort().reverse();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(report.headline)} · Galdera check-in</title><style>
:root{--bg:#f3f0e8;--panel:#eae6da;--ink:#1e221f;--muted:#5b625b;--rule:#d8d3c5;--accent:#9a3a1c;--warn-bg:#f6e6c3;--warn-ink:#5a3b06;--focus:#1b5cc8;--serif:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;background:var(--bg);color:var(--ink)}
*{box-sizing:border-box}
body{margin:0;line-height:1.5;font-size:16px;-webkit-text-size-adjust:100%}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:.2em}
a:hover{text-decoration-thickness:2px}
a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:3px}
p{margin:.5rem 0}
ul{margin:.45rem 0;padding-left:1.2rem}
li+li{margin-top:.35rem}
.muted{color:var(--muted)}
header{max-width:880px;margin:0 auto;padding:2rem 1rem 1.4rem}
.eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.02em;color:var(--muted)}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(1.75rem,4.4vw,2.6rem);line-height:1.1;letter-spacing:-.015em;margin:.6rem 0 .5rem;max-width:22ch;text-wrap:balance}
.headline-note{font-size:.95rem;color:var(--muted);margin:0;max-width:68ch;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.coverage-link{font-size:.85rem;margin:.6rem 0 0}
main{max-width:880px;margin:0 auto;padding:0 1rem 3.5rem}
.overview{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(240px,1fr);gap:2rem;align-items:start;border-top:2px solid var(--ink);padding-top:1rem}
.card h2{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 .35rem}
.side{background:var(--panel);border-radius:8px;padding:.9rem 1rem}
.priority-heading{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin:1rem 0 0}
.priority-heading:first-of-type{margin-top:.25rem}
summary{cursor:pointer;min-height:44px;list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:"";flex:none;width:.42rem;height:.42rem;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);transition:transform .15s}
details[open]>summary::after{transform:rotate(-135deg)}
@media(prefers-reduced-motion:reduce){summary::after{transition:none}}
.item{border-top:1px solid var(--rule)}
.focus .item:first-of-type{border-top:0}
.side .item:first-of-type{border-top:0}
.item>summary{position:relative;display:grid;gap:.15rem;padding:.7rem 1.6rem .7rem 0}
.item>summary::after{position:absolute;right:.35rem;top:1.15rem}
.item-heading{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem}
.item-heading strong{font-size:1.02rem;font-weight:600;line-height:1.3}
.item-heading strong a{color:inherit;text-decoration-color:var(--rule);text-decoration-thickness:1.5px}
.item-heading strong a:hover{text-decoration-color:var(--accent)}
.focus .item:first-of-type .item-heading strong{font-family:var(--serif);font-size:1.3rem;font-weight:600;letter-spacing:-.005em}
.meta{display:flex;align-items:center;gap:.5rem;flex-shrink:0}
.badge{font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.badge.state{color:var(--warn-ink);background:var(--warn-bg);padding:.05rem .4rem;border-radius:3px}
.timing{font-family:var(--mono);font-size:.68rem;color:var(--ink);border:1px solid var(--muted);border-radius:3px;padding:0 .3rem;line-height:1.5}
.preview{font-size:.88rem;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.provenance{font-size:.72rem;color:var(--muted)}
.side .item-heading{align-items:center}
.item-body{padding:.1rem 1.6rem .9rem 0;font-size:.9rem}
.item-body p{margin:.45rem 0}
.notice{background:var(--warn-bg);border-left:3px solid var(--accent);padding:.4rem .6rem;color:var(--warn-ink)}
dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:.8rem 0}
dt{font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.1rem}
dd{margin:0;overflow-wrap:anywhere}
.sources{font-size:.78rem;color:var(--muted);padding-top:.5rem;border-top:1px dotted var(--rule)}
.sources a{overflow-wrap:anywhere}
.waiting{border-top:1px solid var(--rule);margin-top:.9rem;padding-top:.8rem}
.waiting h2{margin-bottom:.15rem}
.waiting-row{padding:.5rem 0;border-top:1px solid var(--rule);font-size:.85rem}
.waiting-row:first-of-type{border-top:0}
.waiting-row strong{display:block;font-weight:600;font-size:.92rem}
.waiting-row strong a{color:inherit;text-decoration-color:var(--rule);text-decoration-thickness:1.5px}
.waiting-row p{margin:.1rem 0 0;color:var(--muted);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.section-note{font-size:.8rem;color:var(--muted);margin:.15rem 0 .45rem}
.stack{margin-top:2.25rem}
.fold{border-top:1px solid var(--rule)}
.fold>summary{display:flex;align-items:center;gap:.75rem;padding:.6rem 0;font-weight:600;font-size:.95rem}
.fold>summary .count{margin-left:auto;font-size:.76rem;font-weight:400;color:var(--muted)}
.fold>summary:hover{color:var(--accent)}
.fold-body{padding:.1rem 0 1rem}
.fold-body>p:first-child{margin-top:.25rem}
.fold .fold{margin-left:.25rem;padding-left:.9rem;border-top:0;border-left:2px solid var(--rule)}
.coverage-row{border-top:1px solid var(--rule);padding:.6rem 0}
.coverage-row:first-child{border:0}
.coverage-row strong{display:inline-block;min-width:6rem;text-transform:capitalize}
.coverage-row span{font-family:var(--mono);font-size:.72rem;color:var(--muted)}
.coverage-row p{margin:.25rem 0}
.coverage-row small{color:var(--muted)}
.archive-date{margin:.7rem 0 .1rem}
.archive-links a{display:inline-block;margin:.15rem .8rem .15rem 0}
@media(max-width:680px){
header{padding:1.4rem 1rem 1.1rem}
.overview{grid-template-columns:1fr;gap:1.5rem}
dl{grid-template-columns:1fr;gap:.6rem}
.item-heading{align-items:start;flex-wrap:wrap;gap:.3rem .75rem}
.focus .item:first-of-type .item-heading strong{font-size:1.2rem}
}
@media(prefers-color-scheme:dark){
:root{--bg:#161815;--panel:#1f221d;--ink:#ebe7dc;--muted:#a3a89d;--rule:#33372f;--accent:#f0956f;--warn-bg:#40320f;--warn-ink:#f7dc9f;--focus:#8db4ff}
}
</style></head><body><header><div class="eyebrow">Galdera · ${esc(report.date)} · captured ${esc(capturedTime)} Stockholm · revision ${revision}</div><h1>${esc(report.headline)}</h1><p class="headline-note">${prose(report.summary)}</p>${gaps.length ? `<p class="coverage-link"><a href="#coverage">${gaps.length} source ${gaps.length === 1 ? "gap" : "gaps"} in this overview</a></p>` : ""}</header><main>
  <div class="overview"><section class="card focus" id="must" aria-labelledby="today-title"><h2 id="today-title">Your work today · ${today.length} ${today.length === 1 ? "item" : "items"}</h2>${today.map((x, index) => `${index === 0 ? '<h3 class="priority-heading">Do first</h3>' : index === 1 ? '<h3 class="priority-heading">Up next</h3>' : ""}${itemHtml(x)}`).join("") || '<p class="muted">Nothing planned for today.</p>'}</section>
  <aside class="card side" id="quick-wins"><h2>Quick wins · ${quickWins.length}</h2>${quickWins.map(x => itemHtml(x)).join("") || '<p class="muted">None listed.</p>'}${waiting.length ? `<section class="waiting" aria-labelledby="waiting-title"><h2 id="waiting-title">Waiting on others · ${waiting.length}</h2>${waiting.slice(0, 3).map(x => `<div class="waiting-row"><strong>${x.sources[0]?.url ? sourceHtml({ label: x.title, url: x.sources[0].url }) : esc(x.title)}</strong><p>${prose(x.others)}</p></div>`).join("")}${waiting.length > 3 ? `<p class="section-note">+${waiting.length - 3} more on your plate</p>` : ""}</section>` : ""}</aside></div>
  <section class="stack" id="later" aria-labelledby="plate-title"><h2 id="plate-title">Also on your plate · ${later.length}</h2>${later.map(x => itemHtml(x)).join("") || '<p class="muted">Nothing else listed.</p>'}</section>
  <div class="stack"><details class="fold" id="background"><summary>Background reviews &amp; agents <span class="count">${background.length}</span></summary><div class="fold-body">${background.map(x => itemHtml(x)).join("") || '<p class="muted">None listed.</p>'}</div></details>
  <details class="fold" id="unassigned"><summary>Ownership unclear <span class="count">${unassigned.length}</span></summary><div class="fold-body">${unassigned.map(x => itemHtml(x)).join("") || '<p class="muted">None listed.</p>'}</div></details>
  <details class="fold" id="all-work"><summary>Evidence &amp; history</summary><div class="fold-body">
  <details class="fold" id="day"><summary>Schedule &amp; constraints</summary><div class="fold-body"><p><strong>Summary:</strong> ${prose(report.summary)}</p><p><strong>Windows:</strong> ${prose(report.dayContext.windows)}</p><p><strong>Constraints:</strong> ${prose(report.dayContext.constraints)}</p></div></details>
  <details class="fold" id="decisions"><summary>Decisions <span class="count">${active.length} in force${inactive.length ? ` · ${inactive.length} earlier` : ""}</span></summary><div class="fold-body">${active.map(x => `<p>${prose(x.text)}${x.expiresOn ? ` <span class="muted">(through ${esc(x.expiresOn)})</span>` : ""}</p>`).join("") || '<p class="muted">None in force.</p>'}${inactive.length ? `<details class="fold"><summary>Earlier decisions <span class="count">${inactive.length}</span></summary><div class="fold-body">${inactive.map(x => `<p>${prose(x.text)} <span class="muted">(${x.state === "retired" ? "retired" : "expired"})</span></p>`).join("")}</div></details>` : ""}</div></details>
  <details class="fold" id="suggestions"><summary>Suggestions <span class="count">${report.suggestions.length}</span></summary><div class="fold-body">${listHtml(report.suggestions)}</div></details>
  <details class="fold" id="questions"><summary>Questions <span class="count">${report.questions.length}</span></summary><div class="fold-body">${listHtml(report.questions)}</div></details>
  <details class="fold" id="changes"><summary>Since the previous check-in <span class="count">${changed.length} ${changed.length === 1 ? "change" : "changes"}${closed.length ? ` · ${closed.length} closed` : ""}</span></summary><div class="fold-body">${`<ul>${changed.map(x => `<li>${x.url ? sourceHtml(x) : esc(x.label)}</li>`).join("")}</ul>`}${closed.length ? `<p><strong>Closed items</strong></p>${closed.map(x => itemHtml(x)).join("")}` : ""}</div></details>
  <details class="fold" id="coverage"><summary>Source coverage <span class="count">${report.coverage.length} sources · ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}</span></summary><div class="fold-body">${report.coverage.map(x => `<div class="coverage-row"><strong>${esc(x.source)}</strong><span>${esc(x.status)}</span><p>${prose(x.detail)}</p><small>Window: ${prose(x.window)}${x.nextStep ? ` · Next: ${prose(x.nextStep)}` : ""}</small></div>`).join("")}</div></details>
  <details class="fold" id="archive"><summary>Archive <span class="count">${archive.length} ${archive.length === 1 ? "revision" : "revisions"}</span></summary><div class="fold-body">${archiveDates.map(d => `<div class="archive-date"><strong>${esc(d)}</strong></div><nav class="archive-links" aria-label="Revisions for ${esc(d)}">${archive.filter(x => x.date === d).map(x => `<a href="/snapshots/${x.revision}/">Revision ${x.revision}</a>`).join("")}</nav>`).join("") || '<p class="muted">No earlier revisions.</p>'}<p><a href="/archive#archive">Open archive page</a></p></div></details></div></details></div>
</main><script>
function revealTarget(){const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(!target)return;for(let node=target;node;node=node.parentElement){if(node.tagName==='DETAILS')node.open=true;}target.scrollIntoView();}
addEventListener('hashchange',revealTarget);revealTarget();
</script></body></html>`;
}

const dirname = (revision: number) => String(revision).padStart(8, "0");
async function revisions(root: string): Promise<number[]> {
  let names: string[];
  try { names = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const result: number[] = [];
  for (const name of names) {
    if (!/^\d{8}$/.test(name)) continue;
    const revision = Number(name);
    await readFile(join(root, name, "report.json"));
    await readFile(join(root, name, "index.html"));
    result.push(revision);
  }
  return result.sort((a, b) => a - b);
}
export async function latest(root = defaultRoot): Promise<Snapshot | null> {
  const found = await revisions(root); if (!found.length) return null;
  const revision = found.at(-1)!;
  return { revision, report: validateStoredReport(JSON.parse(await readFile(join(root, dirname(revision), "report.json"), "utf8"))) };
}
function carryForward(input: Report, previous: Report | undefined): Report {
  if (!previous) return input;
  if (input.date < previous.date) throw Error("date cannot move backwards");
  const ids = new Set(input.items.map(x => x.id));
  const omitted = previous.items.filter(x => !ids.has(x.id) && (x.status === "open" || x.status === "blocked")).map(x => ({ ...x, plan: "later" as const, notRevalidated: true, quickWin: false, effort: "unknown" as const, timing: "Not revalidated", you: "Current action unknown; needs revalidation.", others: "Current dependencies unknown; needs revalidation." }));
  const decisionIds = new Set(input.decisions.map(x => x.id));
  return { ...input, items: [...input.items, ...omitted], decisions: [...input.decisions, ...previous.decisions.filter(x => !decisionIds.has(x.id))] };
}
export async function publish(root: string, raw: unknown, expected: number): Promise<Snapshot> {
  if (!Number.isSafeInteger(expected) || expected < 0) throw Error("expected must be a nonnegative integer");
  const input = validateReport(raw);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const previous = await latest(root);
  if ((previous?.revision ?? 0) !== expected) throw Error(`stale expected revision ${expected}; latest is ${previous?.revision ?? 0}`);
  const report = carryForward(input, previous?.report);
  const revision = expected + 1;
  const stage = join(root, `.stage-${crypto.randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    const history = await archive(root);
    const html = renderReport(report, revision, [...history, { revision, date: report.date }], previous?.report);
    await writeFile(join(stage, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    await writeFile(join(stage, "index.html"), html, { flag: "wx" });
    // Directory rename is atomic. A competing writer cannot replace a populated destination.
    await rename(stage, join(root, dirname(revision)));
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  return { revision, report };
}
export async function archive(root = defaultRoot): Promise<{ revision: number; date: string }[]> {
  const found = await revisions(root);
  return Promise.all(found.map(async revision => ({ revision, date: validateStoredReport(JSON.parse(await readFile(join(root, dirname(revision), "report.json"), "utf8"))).date })));
}
function response(body: string, status = 200, method = "GET", type = "text/html; charset=utf-8"): Response {
  return new Response(method === "HEAD" ? null : body, { status, headers: { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export async function handleRequest(request: Request, root = defaultRoot): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return response("Method not allowed", 405, request.method, "text/plain; charset=utf-8");
  const path = new URL(request.url).pathname;
  const history = await archive(root);
  if (path === "/" || path === "/archive") {
    const current = await latest(root);
    if (!current) return response("No check-in published yet", 404, request.method, "text/plain; charset=utf-8");
    const priorRevision = history.filter(x => x.revision < current.revision).at(-1)?.revision;
    const prior = priorRevision === undefined ? undefined : validateStoredReport(JSON.parse(await readFile(join(root, dirname(priorRevision), "report.json"), "utf8")));
    return response(renderReport(current.report, current.revision, history, prior), 200, request.method);
  }
  const match = /^\/snapshots\/(\d{1,8})\/?$/.exec(path);
  if (!match) return response("Not found", 404, request.method, "text/plain; charset=utf-8");
  const revision = Number(match[1]);
  if (!history.some(x => x.revision === revision)) return response("Not found", 404, request.method, "text/plain; charset=utf-8");
  const html = await readFile(join(root, dirname(revision), "index.html"), "utf8");
  return response(html, 200, request.method);
}
export function serve(root: string, port: number): ReturnType<typeof Bun.serve> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("port must be an integer from 0 to 65535");
  return Bun.serve({ hostname: "127.0.0.1", port, fetch: request => handleRequest(request, root) });
}
const help = `Galdera daily check-in (version 1)\n\nUsage: bun skills/daily-check-in/scripts/check-in.ts COMMAND [options]\n\nCommands:\n  init [--output FILE]                Write a synthetic example report\n  validate --input FILE               Validate a report without publishing\n  publish --input FILE --expected N   Publish immutable revision N+1\n  latest [--root DIR]                  Print latest revision and report JSON (null if empty)\n  serve --port N [--root DIR]          Serve read-only HTML on 127.0.0.1\n\nDefaults: --root ${defaultRoot}\nThe expected revision is required: use 0 for first publication.\n`;
function options(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; if (!key?.startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw Error(`Expected --option value near ${key}`);
    if (result[key]) throw Error(`Duplicate option ${key}`);
    result[key] = args[i + 1];
  }
  for (const key of Object.keys(result)) if (!["--root", "--input", "--expected", "--output", "--port"].includes(key)) throw Error(`Unknown option ${key}`);
  return result;
}
export async function cli(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help") { console.log(help); return; }
  const opt = options(rest); const root = opt["--root"] ?? defaultRoot;
  if (command === "init") {
    if (opt["--input"] || opt["--expected"] || opt["--port"] || opt["--root"]) throw Error("init accepts only --output");
    const example = new URL("../examples/report.v1.json", import.meta.url);
    const content = await readFile(example, "utf8");
    if (opt["--output"]) { await writeFile(opt["--output"], content, { flag: "wx" }); console.log(opt["--output"]); }
    else process.stdout.write(content);
  } else if (command === "validate") {
    if (!opt["--input"] || opt["--expected"] || opt["--output"] || opt["--port"]) throw Error("validate requires --input");
    validateReport(JSON.parse(await readFile(opt["--input"], "utf8"))); console.log("Valid version 1 report");
  } else if (command === "publish") {
    if (!opt["--input"] || opt["--expected"] === undefined || opt["--output"] || opt["--port"]) throw Error("publish requires --input and --expected");
    const result = await publish(root, JSON.parse(await readFile(opt["--input"], "utf8")), Number(opt["--expected"]));
    console.log(JSON.stringify({ revision: result.revision, date: result.report.date, path: join(root, dirname(result.revision), "index.html") }));
  } else if (command === "latest") {
    if (opt["--input"] || opt["--expected"] || opt["--output"] || opt["--port"]) throw Error("latest accepts only --root");
    console.log(JSON.stringify(await latest(root), null, 2));
  } else if (command === "serve") {
    if (!opt["--port"] || opt["--input"] || opt["--expected"] || opt["--output"]) throw Error("serve requires --port");
    const port = Number(opt["--port"]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("--port must be an integer from 1 to 65535");
    const server = serve(root, port); console.log(`Serving http://127.0.0.1:${server.port}/`);
  } else throw Error(`Unknown command ${command}\n${help}`);
}
if (import.meta.main) cli(Bun.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

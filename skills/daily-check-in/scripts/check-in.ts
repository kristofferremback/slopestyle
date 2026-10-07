import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const defaultRoot = join(homedir(), ".local", "share", "galdera-check-in");
const sources = ["calendar", "t3", "vault", "linear", "github", "slack", "email", "todos"] as const;
type SourceName = typeof sources[number];
type Link = { label: string; url?: string };
type Step = { title: string; state: "done" | "active" | "waiting" | "unknown"; owner: string; detail: string; sources: Link[] };
type Item = { id: string; title: string; status: "open" | "blocked" | "done" | "dropped"; plan: "must" | "aim" | "later"; rationale: string; timing: string; you: string; others: string; sources: Link[]; effort: "XS" | "S" | "M" | "L" | "XL" | "unknown"; quickWin?: boolean; steps?: Step[]; attention?: "work" | "background" | "unassigned"; closureReason?: string; closureEvidence?: string; notRevalidated?: boolean };
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
function step(value: unknown, where: string): Step {
  const v = object(value, where); keys(v, ["title", "state", "owner", "detail", "sources"], where);
  const evidence = array(v.sources, `${where}.sources`, link);
  if (!evidence.length) throw Error(`${where}.sources needs evidence`);
  return { title: string(v.title, `${where}.title`), state: choice(v.state, ["done", "active", "waiting", "unknown"], `${where}.state`), owner: string(v.owner, `${where}.owner`), detail: string(v.detail, `${where}.detail`), sources: evidence };
}
function item(value: unknown, where: string, stored = false): Item {
  const v = object(value, where); keys(v, ["id", "title", "status", "plan", "rationale", "timing", "you", "others", "sources", "effort", "quickWin", "attention", "steps", ...(stored ? ["quickWinMinutes"] : []), "closureReason", "closureEvidence", "notRevalidated"], where);
  const result: Item = {
    id: string(v.id, `${where}.id`), title: string(v.title, `${where}.title`),
    status: choice(v.status, ["open", "blocked", "done", "dropped"], `${where}.status`),
    plan: choice(v.plan, ["must", "aim", "later"], `${where}.plan`),
    rationale: string(v.rationale, `${where}.rationale`), timing: string(v.timing, `${where}.timing`),
    you: string(v.you, `${where}.you`, true), others: string(v.others, `${where}.others`, true),
    sources: array(v.sources, `${where}.sources`, link),
    effort: choice(stored && v.effort === undefined ? "unknown" : v.effort, ["XS", "S", "M", "L", "XL", "unknown"], `${where}.effort`),
  };
  if (v.steps !== undefined) result.steps = array(v.steps, `${where}.steps`, step);
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
type IconName = "target" | "bolt" | "layers" | "review" | "users" | "calendar" | "link" | "alert" | "arrow" | "check" | "refresh";
const favicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#202b40"/><path d="m16 7 9 5-9 5-9-5zM7 16l9 5 9-5M7 20l9 5 9-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const faviconLink = '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg">';
function icon(name: IconName): string {
  const paths: Record<IconName, string> = {
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
    review: '<path d="M7 3v12a4 4 0 0 0 4 4h6M7 7h7a3 3 0 0 1 3 3v9"/><circle cx="7" cy="3" r="2"/><circle cx="17" cy="19" r="2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18"/>',
    link: '<path d="m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0M13 11a3 3 0 0 1 0-4l4-4a3 3 0 0 1 4 4l-1 1"/>',
    alert: '<path d="m12 3 10 18H2zM12 9v5M12 17v1"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-4M4 5v4h4M4 13a8 8 0 0 0 14.9 4M20 19v-4h-4"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function sectionHeading(name: string, count: number, glyph: IconName, id?: string): string {
  return `<div class="section-heading"><span class="section-icon">${icon(glyph)}</span><h2${id ? ` id="${id}"` : ""}>${name}</h2><span class="count">${count}</span></div>`;
}
function itemRow(item: Item, rank?: number): string {
  const primary = item.sources[0];
  const done = item.status === "done";
  const plain = (value: string) => esc(value.replace(inlineLinks, "$1"));
  return `<div class="task-row${done ? " completed" : ""}"><a class="task-link" href="#item-${encodeURIComponent(item.id)}"><span class="task-mark">${done ? icon("check") : rank ?? icon(item.status === "blocked" ? "users" : item.quickWin ? "bolt" : "layers")}</span><span class="task-content"><span class="item-heading"><strong>${esc(item.title)}</strong>${done ? '<span class="badge">Done</span>' : `<span class="timing" title="Estimated effort: ${item.effort}">${item.effort === "unknown" ? "?" : item.effort}</span>`}</span>${done ? "" : `<span class="preview">${plain(item.you || item.rationale)}</span>${item.plan === "must" || item.status !== "open" ? `<span class="badge">${item.status === "open" ? "Must today" : esc(item.status)}</span>` : ""}`}</span></a><div class="provenance">${icon("link")}${primary ? sourceHtml(primary) : "Source missing"}</div></div>`;
}
function itemHtml(item: Item): string {
  const closure = item.closureReason ? `<p class="muted">Closure: ${prose(item.closureReason)} · ${prose(item.closureEvidence!)}</p>` : "";
  const primary = item.sources[0];
  return `<article class="detail-panel item" id="item-${encodeURIComponent(item.id)}" aria-labelledby="title-${encodeURIComponent(item.id)}"><div class="detail-heading"><div class="eyebrow">${item.status === "open" ? item.plan === "must" ? "Must today" : item.plan === "aim" ? "Aim today" : "On your plate" : esc(item.status)} · Effort ${item.effort === "unknown" ? "unknown" : item.effort}</div><h2 tabindex="-1" id="title-${encodeURIComponent(item.id)}">${esc(item.title)}</h2><div class="provenance">${icon("link")}${primary ? sourceHtml(primary) : "Source missing"}</div></div>
    <div class="item-body"><p>${prose(item.rationale)}</p>${item.notRevalidated ? '<p class="notice">Carried forward · not revalidated · no current action assumed</p>' : ""}<dl><div><dt>${icon("calendar")}When</dt><dd>${prose(item.timing)}</dd></div><div><dt>${icon("target")}You</dt><dd>${prose(item.you)}</dd></div><div><dt>${icon("users")}Others</dt><dd>${prose(item.others)}</dd></div></dl>${item.steps?.length ? `<ol class="steps" aria-label="Dependencies and next actions">${item.steps.map(x => `<li class="step ${x.state}"><span class="step-marker">${icon(x.state === "done" ? "check" : x.state === "active" ? "arrow" : x.state === "waiting" ? "layers" : "alert")}</span><div><div class="step-heading"><strong>${esc(x.title)}</strong><span class="step-state">${x.state}</span></div><div class="step-owner">${icon("users")}${prose(x.owner)}</div><p>${prose(x.detail)}</p><div class="step-sources">${x.sources.map(sourceHtml).join(" · ")}</div></div></li>`).join("")}</ol>` : ""}${closure}<div class="sources">Sources · ${item.sources.map(sourceHtml).join(" · ")}</div></div>
  </article>`;
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
type ArchiveEntry = { revision: number; date: string; capturedAt?: string };
function utcCalendarDate(year: number, monthIndex: number, day: number): Date {
  const result = new Date(0);
  result.setUTCHours(12, 0, 0, 0);
  result.setUTCFullYear(year, monthIndex, day);
  return result;
}
function calendarHtml(month: string, archive: ArchiveEntry[], selectedDate: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(`${month}-01T12:00:00Z`);
  const days = utcCalendarDate(year, monthNumber, 0).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const cells = Math.ceil((offset + days) / 7) * 7;
  const recorded = new Set(archive.map(x => x.date));
  const shiftMonth = (delta: number) => {
    const shifted = utcCalendarDate(year, monthNumber - 1 + delta, 1);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const route = `/days/${selectedDate}/`;
  const grid = Array.from({ length: cells }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > days) return '<span class="calendar-empty" aria-hidden="true"></span>';
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (recorded.has(date)) return `<a class="calendar-day recorded${date === selectedDate ? " selected" : ""}" href="/days/${date}/" aria-label="${date}"${date === selectedDate ? ' aria-current="date"' : ""}><time datetime="${date}">${day}</time></a>`;
    return `<span class="calendar-day${date === selectedDate ? " selected missing" : ""}" aria-disabled="true"><time datetime="${date}">${day}</time></span>`;
  }).join("");
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `<span>${day}</span>`).join("");
  return `<section class="calendar" aria-label="Check-in calendar"><nav class="calendar-nav" aria-label="Calendar month"><a href="${route}?month=${shiftMonth(-1)}#archive" aria-label="Previous month">‹</a><strong>${esc(new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(first))}</strong><a href="${route}?month=${shiftMonth(1)}#archive" aria-label="Next month">›</a></nav><div class="calendar-grid calendar-weekdays" aria-hidden="true">${weekdays}</div><div class="calendar-grid">${grid}</div><p class="calendar-help">Recorded days are links. Reload loads saved progress; invoke daily-check-in to recheck sources.</p><p class="calendar-selected">Selected: <time datetime="${selectedDate}">${selectedDate}</time></p></section>`;
}
export function renderReport(report: Report, revision: number, archive: ArchiveEntry[] = [], previous?: Report, month = report.date.slice(0, 7)): string {
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
  const completed = closed.filter(x => x.status === "done");
  const dropped = closed.filter(x => x.status === "dropped");
  const quickWins = work.filter(x => x.quickWin && !x.notRevalidated && x.status === "open");
  const changed = changes(report, previous);
  const capturedTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(report.capturedAt));
  const archiveDates = [...new Set(archive.map(x => x.date))].sort().reverse();
  const dateUrl = `/days/${report.date}/?month=${month}#archive`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">${faviconLink}<title>${esc(report.headline)} · Galdera check-in</title><style>
:root{--bg:#f4f6fa;--panel:#fff;--ink:#202b40;--muted:#607089;--rule:#e1e6ef;--accent:#365ed4;--accent-bg:#eaf0ff;--green:#18735a;--green-bg:#e9f5ef;--warn-bg:#fff3de;--warn-ink:#87570a;--focus:#4164d9;--shadow:0 2px 5px #18304c05,0 8px 24px #18304c04;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light dark;background:var(--bg);color:var(--ink)}
*{box-sizing:border-box}body{margin:0;font-size:14px;line-height:1.5;-webkit-text-size-adjust:100%}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:5px}
p{margin:.5rem 0}ul{padding-left:1.2rem}li+li{margin-top:.4rem}.muted{color:var(--muted)}.icon{width:19px;height:19px;flex:none;vertical-align:middle}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
header{padding:18px 24px;display:flex;align-items:center;gap:14px;flex:none}.brand{width:40px;height:40px;background:var(--ink);color:var(--panel);border-radius:12px;display:grid;place-items:center}h1{font-size:19px;margin:0;font-weight:650}.eyebrow{font-size:12px;color:var(--muted)}.toolbar{margin-left:auto;display:flex;gap:8px}.toolbar a{display:flex;align-items:center;gap:7px;min-height:44px;padding:8px 11px;border:1px solid var(--rule);border-radius:9px;background:var(--panel);font-size:12px;color:var(--muted)}.toolbar .coverage-link{color:var(--warn-ink);background:var(--warn-bg);border-color:transparent}.toolbar .icon{width:16px;height:16px}
main{margin:0 20px 20px;display:grid;grid-template-columns:minmax(300px,34%) minmax(0,1fr);border:1px solid var(--rule);border-radius:14px;overflow:hidden;background:var(--panel)}.inbox-ready{height:100dvh;display:flex;flex-direction:column;overflow:hidden}.inbox-ready main{flex:1;min-height:0}.task-list{min-width:0;background:var(--bg);border-right:1px solid var(--rule);overflow:auto;overscroll-behavior:contain;padding:12px}.task-list>section+section{margin-top:18px}.section-heading{display:flex;align-items:center;gap:9px;padding:7px 10px;margin-bottom:5px}.section-heading h2{font-size:12px;font-weight:650;margin:0}.section-icon{display:grid;place-items:center;color:var(--accent)}.section-icon .icon{width:16px;height:16px}.count{font-size:11px;color:var(--muted);margin-left:auto}.side .section-icon{color:var(--green)}
.task-row{border:1px solid transparent;border-bottom-color:var(--rule);border-radius:8px;padding-bottom:9px}.task-row:has([aria-current]){background:var(--panel);border-color:var(--accent);box-shadow:inset 3px 0 var(--accent)}.task-row:hover{background:var(--panel)}.task-link{display:flex;gap:10px;padding:12px 10px 6px;color:var(--ink)}.task-link:hover{text-decoration:none}.task-mark{flex:none;width:22px;height:24px;display:grid;place-items:center;color:var(--muted);font-size:12px}.task-mark .icon{width:16px;height:16px}.task-link[aria-current] .task-mark{color:var(--accent)}.task-content{min-width:0;display:grid;gap:5px;flex:1}.item-heading{display:flex;align-items:flex-start;gap:8px}.item-heading strong{font-size:13px;line-height:1.4;font-weight:620;flex:1;min-width:0}.timing{font-size:10px;color:var(--muted);border:1px solid var(--rule);border-radius:4px;min-width:22px;text-align:center;flex:none}.preview{font-size:12px;color:var(--muted);line-height:1.5}.provenance{display:flex;align-items:flex-start;gap:5px;min-width:0;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.provenance .icon{width:12px;height:16px}.provenance a{color:var(--muted)}.task-row>.provenance{margin:0 10px 0 42px}.badge{font-size:10px;justify-self:start;padding:2px 6px;border-radius:5px;background:var(--warn-bg);color:var(--warn-ink)}
.completed .task-link{min-height:44px}.completed .task-mark,.completed .badge{color:var(--green);background:var(--green-bg)}.completed .task-mark{border-radius:50%}.completed .item-heading{align-items:center}.completed .badge{margin:0}
.reading-pane{min-width:0;overflow:auto;overscroll-behavior:contain}.reading-toolbar{display:none;position:sticky;top:0;z-index:1;align-items:center;justify-content:space-between;gap:12px;background:var(--panel);border-bottom:1px solid var(--rule);padding:6px 20px;font-size:11px}.inbox-ready .reading-toolbar{display:flex}button{font:inherit;color:var(--muted);cursor:pointer;background:none;border:0;min-height:44px;padding:8px;display:flex;align-items:center;gap:8px}button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.reading-toolbar button .icon{transform:rotate(180deg);width:16px;height:16px}.detail-panel{max-width:980px;margin:0 auto}.detail-heading{padding:28px 30px 20px}.detail-heading h2{font-size:25px;line-height:1.25;letter-spacing:-.5px;margin:9px 0 16px;overflow-wrap:anywhere}.detail-heading h2:focus{outline:none}.empty{padding:8px 12px;font-size:12px}.evidence-link{display:flex;align-items:center;gap:10px;padding:14px 10px;font-size:12px}.evidence-link .icon{width:16px;height:16px}.evidence-link .icon:last-child{margin-left:auto}
summary{cursor:pointer;min-height:44px;list-style:none}summary::-webkit-details-marker{display:none}summary::after{content:"";width:6px;height:6px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);flex:none}details[open]>summary::after{transform:rotate(225deg)}
.item-body{padding:0 30px 30px;font-size:13px;background:var(--panel)}.item-body>p:first-child{margin-top:0}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}dl>div{background:var(--bg);border-radius:9px;padding:12px}dt{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:650;color:var(--muted);margin-bottom:7px}dt .icon{width:14px;height:14px}dd{margin:0;overflow-wrap:anywhere}.sources{font-size:11px;border-top:1px solid var(--rule);padding-top:12px;overflow-wrap:anywhere}.notice{background:var(--warn-bg);color:var(--warn-ink);border-radius:8px;padding:10px}
.steps{list-style:none;padding:0;margin:20px 0}.step{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;position:relative;padding:0 0 20px}.step+.step{margin-top:0}.step:not(:last-child)::before{content:"";position:absolute;left:13px;top:30px;bottom:4px;border-left:2px solid var(--rule)}.step-marker{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--bg);color:var(--muted)}.step-marker .icon{width:15px;height:15px}.step.done .step-marker{background:var(--green-bg);color:var(--green)}.step.active .step-marker{background:var(--accent-bg);color:var(--accent)}.step-heading{display:flex;gap:8px;align-items:baseline;justify-content:space-between}.step-state{font-size:10px;color:var(--muted);text-transform:capitalize}.step-owner{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px;margin-top:4px}.step-owner .icon{width:13px;height:13px}.step-sources{font-size:11px;overflow-wrap:anywhere}.step p{font-size:12px;margin:6px 0}.utilities{padding:0 20px 24px}.task-list>.fold{border-top:1px solid var(--rule);margin-top:12px}.fold+.fold{border-top:1px solid var(--rule)}.fold>summary{display:flex;align-items:center;gap:12px;padding:14px 18px;font-size:13px;font-weight:550}.fold>summary>.icon{color:var(--muted);width:17px;height:17px}.fold>summary::after{margin-left:auto}.fold>summary .count{font-size:11px;background:var(--bg);height:22px;white-space:normal}.fold-body{padding:0 18px 16px}.fold .fold{border:1px solid var(--rule);border-radius:8px;margin-top:8px}.fold .fold>summary{font-size:12px}.coverage-row{padding:10px 0;border-bottom:1px solid var(--rule)}.coverage-row strong{text-transform:capitalize;margin-right:12px}.coverage-row span,.coverage-row small{color:var(--muted);font-size:11px}.archive-links{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 16px}.archive-links a{border:1px solid var(--rule);padding:9px 12px;border-radius:7px}.archive-date{font-size:12px}.detail-panel,.fold{scroll-margin-top:72px}.calendar{max-width:390px;margin:8px 0 18px;border:1px solid var(--rule);border-radius:10px;padding:12px}.calendar-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.calendar-nav a{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--rule);border-radius:7px;font-size:20px}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center}.calendar-weekdays{font-size:10px;color:var(--muted);margin-bottom:4px}.calendar-day{display:grid;place-items:center;min-height:40px;border-radius:7px}.calendar-day.recorded{border:1px solid var(--accent);font-weight:650}.calendar-day.selected{box-shadow:inset 0 0 0 2px var(--accent);background:var(--accent-bg)}.calendar-day[aria-disabled="true"]{color:var(--muted);opacity:.65}.calendar-help,.calendar-selected{font-size:11px;color:var(--muted);margin:10px 0 0}
@media(max-width:1000px){main{grid-template-columns:minmax(290px,38%) minmax(0,1fr);margin:0 12px 12px}.detail-heading{padding:22px}.item-body{padding:0 22px 24px}dl{grid-template-columns:1fr}.detail-heading h2{font-size:22px}}
@media(max-width:700px){header{padding:12px;flex-wrap:wrap;gap:10px}.toolbar{width:100%;margin:0}.toolbar a{flex:1;justify-content:center;padding:7px;font-size:11px}main{display:block;margin:0 8px 8px}.task-list{border:0;height:100%;padding:8px}.inbox-ready .reading-pane{display:none;height:100%}.inbox-ready.show-detail .task-list{display:none}.inbox-ready.show-detail .reading-pane{display:block}.reading-toolbar{padding:4px 12px}.detail-heading{padding:20px 16px 16px}.item-body{padding:0 16px 24px}.step{gap:9px}.step-heading{flex-wrap:wrap}.utilities{padding:0 12px 20px}}
@media(max-width:400px){.toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar a{min-width:0}.fold#archive>.fold-body{padding-left:8px;padding-right:8px}.calendar{max-width:none}.calendar-grid{gap:2px}}
@media(prefers-color-scheme:dark){:root{--bg:#111722;--panel:#1b2331;--ink:#e8edf6;--muted:#a4b0c5;--rule:#303c50;--accent:#9bb3ff;--accent-bg:#263757;--green:#8bd6b6;--green-bg:#182e2b;--warn-bg:#382e1d;--warn-ink:#edc881;--focus:#b6c7ff;--shadow:none}.brand{background:var(--accent);color:var(--bg)}}
</style></head><body><header><div class="brand">${icon("layers")}</div><div><h1>Galdera</h1><a class="eyebrow date-link" href="${dateUrl}" title="Captured ${esc(report.capturedAt)}"><time datetime="${report.date}">${report.date}</time> · Captured ${esc(capturedTime)}</a></div><nav class="toolbar" aria-label="Report tools"><a href="#day">${icon("calendar")}Schedule</a><a class="coverage-link" href="#coverage">${icon(gaps.length ? "alert" : "check")}${gaps.length ? `${gaps.length} source gaps` : "Sources checked"}</a><a href="/days/${report.date}/" title="Loads the latest published progress for this day. Invoke daily-check-in to recheck sources.">${icon("refresh")}Reload</a><a href="#archive">${icon("layers")}r${revision}</a></nav></header><main>
  <nav class="task-list" aria-label="Work items"><section class="card focus" id="must" aria-labelledby="today-title">${sectionHeading("Today", today.length, "target", "today-title")}${today.map((x, index) => itemRow(x, index + 1)).join("") || '<p class="muted empty">Nothing planned for today.</p>'}</section>
  <section class="card side" id="quick-wins" aria-labelledby="quick-title">${sectionHeading("Quick wins", quickWins.length, "bolt", "quick-title")}${quickWins.map(x => itemRow(x)).join("") || '<p class="muted empty">None listed.</p>'}</section>
  ${completed.length ? `<section class="stack" id="done" aria-labelledby="done-title">${sectionHeading("Done", completed.length, "check", "done-title")}${completed.map(x => itemRow(x)).join("")}</section>` : ""}
  <section class="stack" id="later" aria-labelledby="plate-title">${sectionHeading("Your plate", later.length, "layers", "plate-title")}${later.map(x => itemRow(x)).join("") || '<p class="muted empty">Nothing else listed.</p>'}</section>
  <details class="fold" id="background"><summary>${icon("review")}Background reviews &amp; agents <span class="count">${background.length}</span></summary>${background.map(x => itemRow(x)).join("") || '<p class="muted empty">None listed.</p>'}</details>
  <details class="fold" id="unassigned"><summary>${icon("users")}Ownership unclear <span class="count">${unassigned.length}</span></summary>${unassigned.map(x => itemRow(x)).join("") || '<p class="muted empty">None listed.</p>'}</details>
  ${dropped.length ? `<details class="fold" id="dropped"><summary>${icon("layers")}Dropped <span class="count">${dropped.length}</span></summary>${dropped.map(x => itemRow(x)).join("")}</details>` : ""}
  <a class="evidence-link" href="#all-work">${icon("link")}Evidence &amp; history${icon("arrow")}</a></nav>
  <section class="reading-pane" aria-label="Task details"><div class="reading-toolbar"><button type="button" id="back-to-list">${icon("arrow")}<span>Back to list</span></button><a href="#all-work">Evidence &amp; history</a></div>${[...today, ...quickWins, ...completed, ...later, ...background, ...unassigned, ...dropped].map(x => itemHtml(x)).join("")}
  <section class="detail-panel" id="all-work" aria-labelledby="evidence-title"><div class="detail-heading"><h2 id="evidence-title" tabindex="-1">Evidence &amp; history</h2></div><div class="utilities">
  <details class="fold" id="day"><summary>Schedule &amp; constraints</summary><div class="fold-body"><p><strong>${esc(report.headline)}</strong></p><p>${prose(report.summary)}</p><p><strong>Windows:</strong> ${prose(report.dayContext.windows)}</p><p><strong>Constraints:</strong> ${prose(report.dayContext.constraints)}</p></div></details>
  <details class="fold" id="decisions"><summary>Decisions <span class="count">${active.length} in force${inactive.length ? ` · ${inactive.length} earlier` : ""}</span></summary><div class="fold-body">${active.map(x => `<p>${prose(x.text)}${x.expiresOn ? ` <span class="muted">(through ${esc(x.expiresOn)})</span>` : ""}</p>`).join("") || '<p class="muted">None in force.</p>'}${inactive.length ? `<details class="fold"><summary>Earlier decisions <span class="count">${inactive.length}</span></summary><div class="fold-body">${inactive.map(x => `<p>${prose(x.text)} <span class="muted">(${x.state === "retired" ? "retired" : "expired"})</span></p>`).join("")}</div></details>` : ""}</div></details>
  <details class="fold" id="suggestions"><summary>Suggestions <span class="count">${report.suggestions.length}</span></summary><div class="fold-body">${listHtml(report.suggestions)}</div></details>
  <details class="fold" id="questions"><summary>Questions <span class="count">${report.questions.length}</span></summary><div class="fold-body">${listHtml(report.questions)}</div></details>
  <details class="fold" id="changes"><summary>Since the previous check-in <span class="count">${changed.length} ${changed.length === 1 ? "change" : "changes"}${closed.length ? ` · ${closed.length} closed` : ""}</span></summary><div class="fold-body">${`<ul>${changed.map(x => `<li>${x.url ? sourceHtml(x) : esc(x.label)}</li>`).join("")}</ul>`}${closed.length ? `<p><strong>Closed items</strong></p><ul>${closed.map(x => `<li><a href="#item-${encodeURIComponent(x.id)}">${esc(x.title)}</a></li>`).join("")}</ul>` : ""}</div></details>
  <details class="fold" id="coverage"><summary>Source coverage <span class="count">${report.coverage.length} sources · ${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}</span></summary><div class="fold-body">${report.coverage.map(x => `<div class="coverage-row"><strong>${esc(x.source)}</strong><span>${esc(x.status)}</span><p>${prose(x.detail)}</p><small>Window: ${prose(x.window)}${x.nextStep ? ` · Next: ${prose(x.nextStep)}` : ""}</small></div>`).join("")}</div></details>
  <details class="fold" id="archive"><summary>${icon("calendar")}Calendar &amp; archive <span class="count">${archiveDates.length} ${archiveDates.length === 1 ? "day" : "days"} · ${archive.length} revisions</span></summary><div class="fold-body">${calendarHtml(month, archive, report.date)}${archiveDates.map(d => `<div class="archive-date"><strong>${esc(d)}</strong></div><nav class="archive-links" aria-label="Revisions for ${esc(d)}">${archive.filter(x => x.date === d).map(x => `<a href="/snapshots/${x.revision}/" title="${x.capturedAt ? `Captured ${esc(x.capturedAt)}` : `Revision ${x.revision}`}">Revision ${x.revision}${x.capturedAt ? ` · ${esc(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(new Date(x.capturedAt)))}` : ""}</a>`).join("")}</nav>`).join("") || '<p class="muted">No earlier revisions.</p>'}</div></details></div></section></section>
</main><script>
const panes = [...document.querySelectorAll('.detail-panel')];
const rows = [...document.querySelectorAll('.task-link')];
const mobile = matchMedia('(max-width: 700px)');
let selectedRow;
function targetForHash(hash) {
  // Item IDs are already URI-encoded in the DOM; evidence anchors are plain IDs.
  return document.getElementById(hash.slice(1));
}
function renderSelection(focus = false) {
  const target = targetForHash(location.hash);
  if (target?.closest('.detail-panel') && !history.state?.checkinSelection) {
    const hash = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    history.pushState({checkinSelection: true}, '', hash);
  }
  const panel = target?.closest('.detail-panel') || (!mobile.matches ? panes[0] : null);
  panes.forEach(p => { p.hidden = p !== panel; });
  document.body.classList.toggle('show-detail', !!panel && !!target);
  rows.forEach(row => {
    const current = panel?.id === row.hash.slice(1);
    if (current) { row.setAttribute('aria-current', 'true'); selectedRow = row; }
    else row.removeAttribute('aria-current');
  });
  if (target) {
    for (let node = target; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
    if (!panel) target.scrollIntoView({block: 'nearest'});
  }
  if (panel) {
    const row = rows.find(r => r.hash.slice(1) === panel.id);
    for (let node = row?.parentElement; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
    if (focus && target) {
      panel.querySelector('h2').focus({preventScroll: true});
      document.querySelector('.reading-pane').scrollTop = 0;
      if (target !== panel) target?.scrollIntoView({block: 'start'});
    }
  }
  if (focus && !target) selectedRow?.focus({preventScroll: true});
}
function closeDetail() {
  if (history.state?.checkinSelection) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); renderSelection(false); selectedRow?.focus({preventScroll: true}); }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = targetForHash(link.hash);
  if (!target) return;
  event.preventDefault();
  // Selection changes share one history entry, so Back returns to the list.
  const method = history.state?.checkinSelection ? 'replaceState' : 'pushState';
  history[method]({checkinSelection: true}, '', link.hash);
  renderSelection(true);
});
document.getElementById('back-to-list').addEventListener('click', closeDetail);
addEventListener('keydown', event => { if (event.key === 'Escape' && location.hash) closeDetail(); });
addEventListener('popstate', () => renderSelection(true));
addEventListener('hashchange', () => renderSelection(true));
mobile.addEventListener('change', () => renderSelection());
document.body.classList.add('inbox-ready');
renderSelection();
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
  const omitted = previous.items.filter(x => !ids.has(x.id) && (x.status === "open" || x.status === "blocked" || (input.date === previous.date && (x.status === "done" || x.status === "dropped")))).map(x => x.status === "done" || x.status === "dropped" ? x : ({ ...x, plan: "later" as const, notRevalidated: true, steps: undefined, quickWin: false, effort: "unknown" as const, timing: "Not revalidated", you: "Current action unknown; needs revalidation.", others: "Current dependencies unknown; needs revalidation." }));
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
    const html = renderReport(report, revision, [...history, { revision, date: report.date, capturedAt: report.capturedAt }], previous?.report);
    await writeFile(join(stage, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    await writeFile(join(stage, "index.html"), html, { flag: "wx" });
    // Directory rename is atomic. A competing writer cannot replace a populated destination.
    await rename(stage, join(root, dirname(revision)));
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  return { revision, report };
}
export async function archive(root = defaultRoot): Promise<ArchiveEntry[]> {
  const found = await revisions(root);
  return Promise.all(found.map(async revision => {
    const report = validateStoredReport(JSON.parse(await readFile(join(root, dirname(revision), "report.json"), "utf8")));
    return { revision, date: report.date, capturedAt: report.capturedAt };
  }));
}
function response(body: string, status = 200, method = "GET", type = "text/html; charset=utf-8", extraHeaders: Record<string, string> = {}): Response {
  return new Response(method === "HEAD" ? null : body, { status, headers: { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders } });
}
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !Number.isNaN(Date.parse(`${value}-01T12:00:00Z`));
}
function missingDatePage(date: string, month: string, history: ArchiveEntry[]): string {
  const available = [...new Set(history.map(x => x.date))].sort().reverse();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">${faviconLink}<title>No check-in for ${date}</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#f4f6fa;color:#202b40}body{max-width:680px;margin:32px auto;padding:0 16px}a{color:#365ed4}.calendar{max-width:390px;margin:16px 0;border:1px solid #ccd3df;border-radius:10px;padding:12px}.calendar-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.calendar-nav a{display:grid;place-items:center;width:40px;height:40px;border:1px solid #ccd3df;border-radius:7px;font-size:20px}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center}.calendar-weekdays,.muted{font-size:11px;opacity:.7}.calendar-day{display:grid;place-items:center;min-height:40px;border-radius:7px}.calendar-day.recorded{border:1px solid #365ed4;font-weight:650}.calendar-day.selected{outline:2px solid #365ed4}.calendar-day[aria-disabled=true]{opacity:.5}.calendar-help{font-size:11px;opacity:.7}@media(prefers-color-scheme:dark){:root{background:#111722;color:#e8edf6}a{color:#9bb3ff}.calendar,.calendar-nav a{border-color:#303c50}.calendar-day.recorded{border-color:#9bb3ff}}</style></head><body><h1>No check-in for <time datetime="${date}">${date}</time></h1><p>There is no published report for this date. Choose a recorded day below.</p>${calendarHtml(month, history, date)}<h2>Available dates</h2>${available.length ? `<ul>${available.map(day => `<li><a href="/days/${day}/">${day}</a></li>`).join("")}</ul>` : '<p class="muted">No check-ins have been published yet.</p>'}</body></html>`;
}
export async function handleRequest(request: Request, root = defaultRoot): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return response("Method not allowed", 405, request.method, "text/plain; charset=utf-8");
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/favicon.svg") return response(favicon, 200, request.method, "image/svg+xml");
  const monthValues = url.searchParams.getAll("month");
  if (monthValues.length > 1 || (monthValues.length === 1 && !validMonth(monthValues[0]!))) return response("Invalid month; expected YYYY-MM", 400, request.method, "text/plain; charset=utf-8");
  const requestedMonth = monthValues[0];
  const history = await archive(root);
  const currentEntry = history.at(-1);
  if (path === "/" || path === "/archive") {
    if (!currentEntry) return response("No check-in published yet", 404, request.method, "text/plain; charset=utf-8");
    const destination = `/days/${currentEntry.date}/${requestedMonth ? `?month=${requestedMonth}` : ""}${path === "/archive" ? "#archive" : ""}`;
    return response("", 302, request.method, "text/plain; charset=utf-8", { location: destination });
  }
  const dayMatch = /^\/days\/([^/]+)\/?$/.exec(path);
  if (dayMatch) {
    const requestedDate = dayMatch[1]!;
    if (!validDate(requestedDate)) return response("Not found", 404, request.method, "text/plain; charset=utf-8");
    const month = requestedMonth ?? requestedDate.slice(0, 7);
    const matching = history.filter(x => x.date === requestedDate);
    if (!matching.length) return response(missingDatePage(requestedDate, month, history), 404, request.method);
    const entry = matching.at(-1)!;
    const report = validateStoredReport(JSON.parse(await readFile(join(root, dirname(entry.revision), "report.json"), "utf8")));
    const priorRevision = history.filter(x => x.revision < entry.revision).at(-1)?.revision;
    const prior = priorRevision === undefined ? undefined : validateStoredReport(JSON.parse(await readFile(join(root, dirname(priorRevision), "report.json"), "utf8")));
    return response(renderReport(report, entry.revision, history, prior, month), 200, request.method);
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

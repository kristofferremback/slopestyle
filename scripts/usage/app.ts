import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { cachedShare, tokenCount } from "../lib/usage/format.ts";
import { usageUsdEquivalent } from "../lib/usage/pricing.ts";
import { groupResets, placeResetLabels, type ResetLabel } from "../lib/usage/resets.ts";

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

type Bucket = "15m" | "hour" | "day";
type Provider = "claude" | "codex";
type Scope = Provider | "all";
type UsageUnit = "usd" | "credits";

interface Timeline {
  bucket: Bucket;
  buckets: number[];
  series: { session_id: string; provider: Provider; title: string; values: number[] }[];
  other: number[];
  scope: Scope;
  unit: UsageUnit;
  total_value: number;
  total_usd_equivalent: number;
  total_input_tokens: number;
  total_output_tokens: number;
  unpriced_models: string[];
}

interface SessionSummary {
  id: string;
  provider: Provider;
  title: string;
  project: string;
  cwd: string | null;
  git_branch: string | null;
  started_ms: number | null;
  ended_ms: number | null;
  value: number;
  usd_equivalent: number;
  sub_value: number;
  input_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  requests: number;
  requests_sub: number;
  peak_context: number;
  models: Record<string, number>;
  efforts: Record<string, number>;
  agents: number;
  compactions: number;
}

interface RequestPoint {
  ts_ms: number;
  agent_id: string;
  model: string;
  context: number;
  input: number;
  cache_5m: number;
  cache_1h: number;
  cache_read: number;
  output: number;
  effort: string | null;
  value: number | null;
  usd_equivalent: number;
}

interface SessionDetail {
  session: SessionSummary;
  requests: RequestPoint[];
  agents: { id: string; subagent_type: string | null; model_requested: string | null; description: string | null; prompt_head: string | null; requests: number; value: number; usd_equivalent: number; input_tokens: number; cache_read_tokens: number; output_tokens: number; peak_context: number; models: Record<string, number>; efforts: Record<string, number> }[];
  events: { ts_ms: number; agent_id: string; kind: string; data: Record<string, unknown> }[];
}

interface LimitsView {
  polling: { claude?: boolean; codex?: boolean };
  status: { provider: Provider; status: { polled_ms: number; ok: boolean; error?: string } }[];
  latest: { provider: Provider; ts_ms: number; kind: string; label: string; percent: number; resets_ms: number | null }[];
  samples: { provider: Provider; ts_ms: number; kind: string; percent: number }[];
  windows: { provider: Provider; kind: string; label: string; start_ms: number; end_ms: number; current: boolean; value: number }[];
}

interface QuotaWindow {
  provider: Provider;
  kind: string;
  label: string;
  percent: number;
  start_ms: number;
  end_ms: number;
  resets_ms: number | null;
  local_value: number;
  local_usd_equivalent: number;
  sessions: { session_id: string; provider: Provider; key: string; title: string; value: number; usd_equivalent: number; percent_points: number }[];
}

interface QuotaView {
  scope: Scope;
  windows: QuotaWindow[];
}

interface InsightsView {
  scope: Scope;
  unit: UsageUnit;
  total_value: number;
  total_usd_equivalent: number;
  insights: { kind: string; severity: "info" | "warn"; text: string }[];
}

interface SessionRef {
  provider: Provider;
  id: string;
}

interface State {
  scope: Scope;
  fromMs: number;
  toMs: number;
  bucket: Bucket | "";
  session: SessionRef | null;
  // The toolbar preset the range came from, so a refresh rolls a relative
  // range like "Last 24h" forward and the button stays highlighted.
  preset: string | null;
}

const hour = 3_600_000;
const day = 24 * hour;
const bucketMs: Record<Bucket, number> = { "15m": 15 * 60_000, hour, day };
const tz = -new Date().getTimezoneOffset();
// A drag shorter than this is a click on a bar, not a range selection.
const dragThresholdPx = 8;
// Selecting a sliver of a chart should still leave something to read.
const minSelectionMs = 60_000;

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
};

const fromInput = $<HTMLInputElement>("#from");
const toInput = $<HTMLInputElement>("#to");
const providerSelect = $<HTMLSelectElement>("#provider");
const bucketSelect = $<HTMLSelectElement>("#bucket");
const totalEl = $("#total");
const totalTokensEl = $("#total-tokens");
const totalUnitEl = $("#total-unit");
const noticeEl = $("#notice");
const emptyEl = $("#empty");
const tableBody = $<HTMLTableSectionElement>("#sessions tbody");
const detailEl = $<HTMLElement>("#detail");
const agentsBody = $<HTMLTableSectionElement>("#agents tbody");
const tilesEl = $("#limits");
const limitsNoticeEl = $("#limits-notice");
const limitsChartEl = $("#limits-chart");
const insightsEl = $<HTMLUListElement>("#insights");
const customEl = $<HTMLDetailsElement>("#custom");
const sortSelect = $<HTMLSelectElement>("#sort");
const refreshButton = $<HTMLButtonElement>("#refresh");
const zoomOutButton = $<HTMLButtonElement>("#zoom-out");
const quotaHeadEl = $("#quota-head");
const updatedEl = $("#updated");
const narrow = matchMedia("(max-width: 640px)");

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function palette(): string[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => css(`--series-${slot}`));
}

function localMidnight(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function presetRange(preset: string): { fromMs: number; toMs: number } | undefined {
  const now = Date.now();
  const today = localMidnight(now);
  switch (preset) {
    case "today":
      return { fromMs: today, toMs: today + day };
    case "yesterday":
      return { fromMs: today - day, toMs: today };
    case "24h":
      return { fromMs: now - day, toMs: now };
    case "week": {
      const date = new Date(today);
      const shift = (date.getDay() + 6) % 7;
      return { fromMs: today - shift * day, toMs: today - shift * day + 7 * day };
    }
    case "7d":
      return { fromMs: now - 7 * day, toMs: now };
    default:
      return undefined;
  }
}

// The current range for a preset. The active limit window comes from the server, the
// rest are clock arithmetic.
async function currentPresetRange(preset: string): Promise<{ fromMs: number; toMs: number } | undefined> {
  return preset === "window" ? currentWindowRange() : presetRange(preset);
}

// Links from before presets were in the URL still highlight the fixed preset
// they match.
function matchingPreset(fromMs: number, toMs: number): string | null {
  for (const preset of ["today", "yesterday", "week"]) {
    const range = presetRange(preset)!;
    if (range.fromMs === fromMs && range.toMs === toMs) return preset;
  }
  return null;
}

function sessionKey(ref: SessionRef): string {
  return `${ref.provider}:${ref.id}`;
}

// "claude:1a2b" in the URL. A bare id is a link from before both providers
// shared the page, and means Claude.
function parseSessionRef(value: string | null): SessionRef | null {
  if (!value) return null;
  const split = value.indexOf(":");
  if (split < 0) return { provider: "claude", id: value };
  const provider = value.slice(0, split);
  return { provider: provider === "codex" ? "codex" : "claude", id: value.slice(split + 1) };
}

function readState(): State {
  const params = new URLSearchParams(location.search);
  const parse = (name: string): number | undefined => {
    const value = params.get(name);
    if (!value) return undefined;
    const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  };
  const bucket = params.get("bucket");
  const preset = params.get("preset") ?? (params.has("from") || params.has("to") ? null : "today");
  // A relative preset is recomputed on load; the window preset keeps the
  // stored range until the next refresh asks the server.
  const range = preset ? presetRange(preset) : undefined;
  const fromMs = range?.fromMs ?? parse("from") ?? presetRange("today")!.fromMs;
  const toMs = range?.toMs ?? parse("to") ?? presetRange("today")!.toMs;
  const provider = params.get("provider");
  return {
    scope: provider === "codex" || provider === "all" ? provider : "claude",
    fromMs,
    toMs,
    bucket: bucket === "15m" || bucket === "hour" || bucket === "day" ? bucket : "",
    session: parseSessionRef(params.get("session")),
    preset: range || preset === "window" ? preset : matchingPreset(fromMs, toMs),
  };
}

function writeState(state: State, push: boolean): void {
  const params = new URLSearchParams();
  params.set("provider", state.scope);
  params.set("from", String(state.fromMs));
  params.set("to", String(state.toMs));
  if (state.bucket) params.set("bucket", state.bucket);
  if (state.preset) params.set("preset", state.preset);
  if (state.session) params.set("session", sessionKey(state.session));
  const url = `${location.pathname}?${params}`;
  if (push) history.pushState(state, "", url);
  else history.replaceState(state, "", url);
}

function toLocalInput(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usdFine = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const credits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const tokens = tokenCount;

function tokensCell(input: number, cacheRead: number): string {
  const cached = cachedShare(input, cacheRead);
  return `${tokens(input)}${cached ? `<span class="sub">${cached}</span>` : ""}`;
}

interface TooltipParam {
  seriesIndex: number;
  dataIndex: number;
  marker: string;
  seriesName: string;
  value: [number, number];
}

// Every value the server sends is already in the scope's unit: dollars for
// Claude, credits for Codex, API-equivalent dollars when both share the page.
// Money always reads in dollars, so only a Codex-only view converts.
function formatValue(value: number, fine = false): string {
  return (fine ? usdFine : usd).format(usageUsdEquivalent(state.scope === "codex" ? "codex" : "claude", value));
}

function providerLabel(provider: Provider): string {
  return provider === "claude" ? "Claude Code" : "Codex";
}

function providerTag(provider: Provider): string {
  return provider === "claude" ? "Claude" : "Codex";
}

// Per-request cost with the tokens behind it. Each series is one request
// group, so the hovered params index straight into it.
function costTooltip(params: TooltipParam[], groups: RequestPoint[][]): string {
  const first = params[0];
  if (!first) return "";
  const lines = params.flatMap((param) => {
    const request = groups[param.seriesIndex]?.[param.dataIndex];
    if (!request) return [];
    const input = request.input + request.cache_5m + request.cache_1h + request.cache_read;
    const cached = cachedShare(input, request.cache_read);
    return [`${param.marker} ${escape(param.seriesName)} ${formatValue(request.value ?? 0, true)} · ${tokens(input)} in${cached ? `, ${cached}` : ""} · ${tokens(request.output)} out`];
  });
  return [clockFormat.format(first.value[0]), ...lines].join("<br>");
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function modelsLabel(models: Record<string, number>): string {
  return Object.entries(models)
    .sort((a, b) => b[1] - a[1])
    .map(([model, n]) => `${shortModel(model)} ×${n}`)
    .join(", ");
}

function effortsLabel(efforts: Record<string, number>): string {
  return Object.entries(efforts)
    .sort((a, b) => b[1] - a[1])
    .map(([effort, n]) => `${effort} ×${n}`)
    .join(", ");
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function legendName(name: string): string {
  const max = narrow.matches ? 26 : 48;
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function untilLabel(ms: number): string {
  const minutes = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${Math.round(minutes / 60 / 24)} days`;
}

function spanLabel(ms: number): string {
  if (ms < 90 * 60_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * hour) return `${Math.round(ms / hour)} h`;
  return `${Math.round(ms / day)} days`;
}

type SortKey = keyof SessionSummary | "quota";

let state = readState();
let colorByKey = new Map<string, string>();
let currentSessions: SessionSummary[] = [];
let currentWindows: LimitsView["windows"] = [];
let currentQuota: QuotaWindow[] = [];
// The timeline's x axis is one category per bucket, so turning a selected
// index back into a time needs the bucket starts that were drawn.
let timelineBuckets: { starts: number[]; size: number } | null = null;
// Set while a session detail is open, so its charts only answer for the span
// they are actually drawing.
let detailOpen = false;
let sortKey: SortKey = "value";
let sortDesc = true;
let pushedDetail = false;
let loading: Promise<void> | null = null;
let loadSeq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const refreshEveryMs = 10_000;

const chartEl = $("#chart");
const contextChartEl = $("#context-chart");
const costChartEl = $("#cost-chart");
const chart = echarts.init(chartEl);
const limitsChart = echarts.init(limitsChartEl);
const contextChart = echarts.init(contextChartEl);
const costChart = echarts.init(costChartEl);

function query(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ provider: state.scope, from: String(state.fromMs), to: String(state.toMs), tz: String(tz), ...extra });
  if (state.bucket) params.set("bucket", state.bucket);
  return params.toString();
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${response.status} from ${path}`);
  return body;
}

function theme() {
  return {
    text: css("--text-secondary"),
    border: css("--border"),
    surface: css("--surface-1"),
    tooltip: { backgroundColor: css("--surface-2"), borderColor: css("--border"), textStyle: { color: css("--text-primary") } },
  };
}

// Refreshes update the chart in place. Rebuilding it from scratch every ten
// seconds used to leave the previous render's components subscribed to the same
// canvas, so one drag fired once per render and each one zoomed the result of
// the last.
function draw(instance: echarts.ECharts, option: Record<string, unknown>): void {
  instance.setOption(option, { replaceMerge: ["series"] });
}

// Dragging across a chart picks a time range for the whole page, so the totals,
// the session table and the insights all describe exactly what was selected.
// No chart zooms on its own.
function enableRangeSelect(instance: echarts.ECharts, host: HTMLElement, resolve: () => ((value: number) => { fromMs: number; toMs: number }) | null, keepSession = false): void {
  const band = document.createElement("div");
  band.className = "select-band";
  band.hidden = true;
  host.appendChild(band);
  let anchor: number | null = null;
  const xOf = (event: PointerEvent) => event.clientX - host.getBoundingClientRect().left;
  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !resolve()) return;
    anchor = xOf(event);
    host.setPointerCapture(event.pointerId);
  });
  host.addEventListener("pointermove", (event) => {
    if (anchor === null) return;
    const now = xOf(event);
    band.hidden = Math.abs(now - anchor) < dragThresholdPx;
    band.style.left = `${Math.min(anchor, now)}px`;
    band.style.width = `${Math.abs(now - anchor)}px`;
  });
  const cancel = () => {
    anchor = null;
    band.hidden = true;
  };
  host.addEventListener("pointercancel", cancel);
  host.addEventListener("pointerup", (event) => {
    const start = anchor;
    cancel();
    if (start === null) return;
    const end = xOf(event);
    // Anything shorter than a deliberate drag is a click, and the chart's own
    // click handler owns it.
    if (Math.abs(end - start) < dragThresholdPx) return;
    const toRange = resolve();
    if (!toRange) return;
    const low = instance.convertFromPixel({ xAxisIndex: 0 }, Math.min(start, end));
    const high = instance.convertFromPixel({ xAxisIndex: 0 }, Math.max(start, end));
    if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return;
    const fromMs = Math.max(state.fromMs, toRange(low).fromMs);
    const toMs = Math.min(state.toMs, toRange(high).toMs);
    if (toMs - fromMs < minSelectionMs) return;
    setRange(fromMs, toMs, "", null, true, keepSession);
  });
}

// A tick at local midnight shows the date, so a range that crosses days reads
// "22:00, 23:00, Sep 4, 01:00" instead of a row of 12:00 AMs.
function axisTime(ms: number): string {
  return ms === localMidnight(ms) ? dateFormat.format(ms) : timeFormat.format(ms);
}

function bucketLabel(ms: number, bucket: Bucket, span: number): string {
  if (bucket === "day") return dateFormat.format(ms);
  return span > day ? dateTimeFormat.format(ms) : axisTime(ms);
}

// Reset labels use the chart's default 12px sans-serif text.
const labelMeasure = document.createElement("canvas").getContext("2d")!;
function labelWidth(text: string): number {
  labelMeasure.font = "12px sans-serif";
  return labelMeasure.measureText(text).width + 8;
}

// Weekly resets closer than this share of the range read as one moment and
// share a label on the first line, clearer than two labels fighting for room.
const mergeShare = 0.04;
const hiddenLabel: ResetLabel = { show: false, align: "left" };

function resetName(window: LimitsView["windows"][number]): string {
  return state.scope === "all" ? `${providerTag(window.provider)} ${window.label.toLowerCase()}` : window.label;
}

// One dashed line per reset. Weekly resets minutes apart share one label
// naming them both, 5-hour resets keep their own so a run of them never
// swallows a weekly label, their labels go quiet past a day so a week view is
// not a wall of "5-hour reset", and labels that would still overprint hide.
function resetLines(windows: LimitsView["windows"], chartPx: number, gridLeft: number, gridRight: number): { xAxis: number; name: string; label: ResetLabel }[] {
  const span = state.toMs - state.fromMs;
  const plotPx = chartPx - gridLeft - gridRight;
  const visible = windows.filter((window) => window.end_ms > state.fromMs && window.end_ms < state.toMs);
  const weekly = visible.filter((window) => window.kind !== "five_hour");
  const fiveHour = visible.filter((window) => window.kind === "five_hour").map((window) => [window]);
  const groups = [...groupResets(weekly, span * mergeShare), ...fiveHour].map((group) => {
    const name = `${group.map((window) => resetName(window)).join(" and ")} reset`;
    const important = group.some((window) => window.kind !== "five_hour");
    return { group, name, mark: { x: gridLeft + ((group[0]!.end_ms - state.fromMs) / span) * plotPx, width: labelWidth(name), important, wanted: important || span <= day } };
  });
  const labels = placeResetLabels(groups.map((entry) => entry.mark), chartPx);
  return groups.flatMap(({ group, name }, groupIndex) =>
    group.map((window, index) => ({ xAxis: window.end_ms, name: index === 0 ? name : "", label: index === 0 ? labels[groupIndex]! : hiddenLabel })),
  );
}

function renderLimits(view: LimitsView): void {
  currentWindows = view.windows;
  const t = theme();
  tilesEl.replaceChildren(
    ...view.latest.map((sample) => {
      const tile = document.createElement("div");
      tile.className = `tile${sample.percent >= 80 ? " hot" : ""}`;
      const window = view.windows.find((entry) => entry.provider === sample.provider && entry.kind === sample.kind && entry.current);
      const parts = [
        sample.resets_ms ? `resets in ${untilLabel(sample.resets_ms)} at ${sample.resets_ms - Date.now() < day ? timeFormat.format(sample.resets_ms) : dateTimeFormat.format(sample.resets_ms)}` : "",
        window ? `${usd.format(usageUsdEquivalent(sample.provider, window.value))}${sample.provider === "codex" ? " API-equivalent" : ""} attributed locally` : "",
      ].filter(Boolean);
      const name = state.scope === "all" ? `${providerLabel(sample.provider)} · ${sample.label}` : sample.label;
      tile.innerHTML = `<span class="hint">${escape(name)}</span><strong>${Math.round(sample.percent)}%</strong><div class="bar" role="meter" aria-valuenow="${Math.round(sample.percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escape(name)} used"><span style="width:${Math.min(100, sample.percent)}%"></span></div><span class="sub">${escape(parts.join(" · "))}</span>`;
      return tile;
    }),
  );
  const notices: string[] = [];
  if (view.polling.claude === false) notices.push("Claude limit polling is off for this server (--no-limits).");
  if (view.polling.codex === false) notices.push("Codex transcript indexing is off for this server.");
  for (const entry of view.status) if (!entry.status.ok) notices.push(`${providerLabel(entry.provider)} limits not updated: ${entry.status.error}`);
  if (view.latest.length === 0 && notices.length === 0) notices.push("No limit samples yet.");
  limitsNoticeEl.hidden = notices.length === 0;
  limitsNoticeEl.textContent = notices.join(" ");
  const kinds = [...new Set(view.samples.map((sample) => `${sample.provider}:${sample.kind}`))];
  limitsChartEl.hidden = kinds.length === 0;
  if (kinds.length === 0) return;
  const colors = palette();
  const labels = new Map(view.latest.map((sample) => [`${sample.provider}:${sample.kind}`, state.scope === "all" ? `${providerTag(sample.provider)} ${sample.label.toLowerCase()}` : sample.label]));
  // A step line holds its last value until the next poll, so extend each
  // series to now (or the end of the range) instead of ending at the sample.
  const edge = Math.min(Date.now(), state.toMs);
  const points = (key: string): [number, number][] => {
    const own = view.samples.filter((sample) => `${sample.provider}:${sample.kind}` === key).map((sample): [number, number] => [sample.ts_ms, sample.percent]);
    const last = own[own.length - 1];
    if (last && last[0] < edge) own.push([edge, last[1]]);
    return own;
  };
  draw(limitsChart, {
    backgroundColor: "transparent",
    grid: { left: 48, right: 16, top: 48, bottom: 52 },
    legend: { bottom: 0, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
    tooltip: { trigger: "axis", ...t.tooltip, valueFormatter: (value: unknown) => (typeof value === "number" ? `${Math.round(value)}%` : "") },
    xAxis: { type: "time", min: state.fromMs, max: state.toMs, axisLabel: { color: t.text, formatter: axisTime, hideOverlap: true }, axisLine: { lineStyle: { color: t.border } } },
    yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: t.text, formatter: (value: number) => `${value}%` }, splitLine: { lineStyle: { color: t.border } } },
    series: kinds.map((key, index) => ({
      name: labels.get(key) ?? key,
      type: "line",
      step: "end",
      showSymbol: false,
      lineStyle: { width: 2, color: colors[index % colors.length] },
      itemStyle: { color: colors[index % colors.length] },
      data: points(key),
      markLine:
        index === 0
          ? {
              symbol: "none",
              label: { color: t.text, position: "end", formatter: (params: { data: { name: string } }) => params.data.name },
              lineStyle: { color: css("--critical"), type: "dashed" },
              data: resetLines(view.windows, limitsChart.getWidth(), 48, 16),
            }
          : { data: [] },
    })),
  });
  limitsChart.resize();
}

function renderInsights(view: InsightsView): void {
  insightsEl.replaceChildren(
    ...view.insights.map((insight) => {
      const li = document.createElement("li");
      li.className = insight.severity;
      li.textContent = insight.text;
      return li;
    }),
  );
}

function renderTimeline(view: Timeline): void {
  state.scope = view.scope;
  const colors = palette();
  const t = theme();
  colorByKey = new Map(view.series.map((series, index) => [sessionKey({ provider: series.provider, id: series.session_id }), colors[index]!]));
  const span = state.toMs - state.fromMs;
  const series = view.series.map((entry, index) => ({
    name: state.scope === "all" ? `${entry.title} · ${providerTag(entry.provider)}` : entry.title,
    type: "bar" as const,
    stack: "spend",
    data: entry.values.map((value) => Math.round(value * 10000) / 10000),
    itemStyle: { color: colors[index], borderColor: t.surface, borderWidth: 1 },
    emphasis: { focus: "series" as const },
    barMaxWidth: 28,
    markLine: undefined as unknown,
  }));
  if (view.other.some((value) => value > 0)) {
    series.push({
      name: "Other sessions",
      type: "bar",
      stack: "spend",
      data: view.other.map((value) => Math.round(value * 10000) / 10000),
      itemStyle: { color: css("--series-other"), borderColor: t.surface, borderWidth: 1 },
      emphasis: { focus: "series" },
      barMaxWidth: 28,
      markLine: undefined,
    });
  }
  const size = bucketMs[view.bucket];
  const first = view.buckets[0] ?? state.fromMs;
  // A day bucket cannot place a 5-hour line, so day views carry none. Past a
  // day the labels go quiet, and labels that would overprint hide.
  const gridLeft = narrow.matches ? 48 : 56;
  const plotPx = chart.getWidth() - gridLeft - 16;
  const resets = currentWindows
    .filter((window) => view.bucket !== "day" && window.kind === "five_hour" && window.end_ms > first && window.end_ms < state.toMs)
    .map((window) => ({ index: Math.min(view.buckets.length - 1, Math.round((window.end_ms - first) / size)), name: `${state.scope === "all" ? `${providerTag(window.provider)} ` : ""}5h reset ${timeFormat.format(window.end_ms)}` }));
  const resetLabels = placeResetLabels(
    resets.map(({ index, name }) => ({ x: gridLeft + ((index + 0.5) / view.buckets.length) * plotPx, width: labelWidth(name), important: false, wanted: span <= day })),
    chart.getWidth(),
  );
  const resetMarks = resets.map(({ index, name }, position) => ({ xAxis: index, name, label: resetLabels[position]! }));
  if (series[0] && resetMarks.length > 0) {
    series[0].markLine = {
      symbol: "none",
      label: { color: t.text, position: "end", formatter: (params: { data: { name: string } }) => params.data.name },
      lineStyle: { color: css("--critical"), type: "dashed" },
      data: resetMarks,
    };
  }
  draw(chart, {
    backgroundColor: "transparent",
    textStyle: { color: t.text },
    grid: { left: gridLeft, right: 16, top: 48, bottom: series.length > 0 ? 64 : 40, containLabel: false },
    legend: { bottom: 0, type: "scroll", formatter: legendName, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: unknown) => (typeof value === "number" ? formatValue(value) : ""), ...t.tooltip },
    xAxis: {
      type: "category",
      data: view.buckets.map((ms) => bucketLabel(ms, view.bucket, span)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: t.border } },
      axisLabel: { color: t.text },
    },
    yAxis: { type: "value", axisLabel: { color: t.text, formatter: (value: number) => formatValue(value) }, splitLine: { lineStyle: { color: t.border } } },
    series,
  });
  timelineBuckets = { starts: view.buckets, size };
  chart.off("click");
  chart.on("click", (event) => {
    const entry = view.series[event.seriesIndex ?? -1];
    if (entry) void openSession({ provider: entry.provider, id: entry.session_id }, true);
  });
  totalEl.textContent = formatValue(view.total_value);
  totalUnitEl.textContent = view.unit === "credits" ? `API-equivalent · ${credits.format(view.total_value)} credits` : view.scope === "all" ? "API-equivalent across both" : "API list prices";
  totalTokensEl.textContent = `${tokens(view.total_input_tokens)} in · ${tokens(view.total_output_tokens)} out`;
  const unpriced = view.unpriced_models;
  noticeEl.hidden = unpriced.length === 0;
  noticeEl.textContent = unpriced.length ? `No price or credit rate, so counted as zero: ${unpriced.join(", ")}` : "";
}

// The longest running window is the one that decides how much room is left, so
// that is what a session is measured against.
function quotaFor(row: { id: string; provider: Provider }): { points: number; window: QuotaWindow } | undefined {
  const windows = currentQuota.filter((window) => window.provider === row.provider).sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms));
  for (const window of windows) {
    const share = window.sessions.find((session) => session.session_id === row.id);
    if (share) return { points: share.percent_points, window };
  }
  return undefined;
}

function renderQuota(view: QuotaView): void {
  currentQuota = view.windows;
  const longest = [...view.windows].sort((a, b) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms))[0];
  quotaHeadEl.title = longest
    ? `Share of the ${longest.label.toLowerCase()} limit this session accounts for, taken from its share of what local transcripts spent inside that window. Usage on the same allowance without a local transcript inflates every share.`
    : "No limit window with reported usage yet.";
}

function sortSessions(rows: SessionSummary[]): SessionSummary[] {
  const value = (row: SessionSummary): number | string => {
    if (sortKey === "quota") return quotaFor(row)?.points ?? -1;
    if (sortKey === "models") return modelsLabel(row.models);
    const field = row[sortKey];
    return typeof field === "number" ? field : String(field ?? "");
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sortDesc ? -order : order;
  });
}

function renderSessions(rows: SessionSummary[]): void {
  currentSessions = rows;
  emptyEl.hidden = rows.length > 0;
  const selected = state.session ? sessionKey(state.session) : null;
  // A refresh rebuilds the rows, so keyboard focus follows the focused session.
  const focused = document.activeElement?.closest<HTMLTableRowElement>("#sessions tr")?.dataset.session;
  tableBody.replaceChildren(
    ...sortSessions(rows).map((row) => {
      const key = sessionKey(row);
      const tr = document.createElement("tr");
      tr.dataset.session = key;
      tr.setAttribute("aria-selected", String(key === selected));
      const color = colorByKey.get(key) ?? css("--series-other");
      const share = quotaFor(row);
      const tag = state.scope === "all" ? `<span class="tag">${providerTag(row.provider)}</span>` : "";
      tr.innerHTML = `
        <td><span class="swatch" style="background:${color}"></span></td>
        <td class="title"><button type="button">${escape(row.title)}<span class="sub">${tag}${escape(row.project.replace(/^-/, "").replace(/-/g, "/"))}${row.git_branch ? ` · ${escape(row.git_branch)}` : ""}</span></button></td>
        <td class="num">${formatValue(row.value)}</td>
        <td class="num" data-label="quota">${share && share.points >= 0.05 ? `${share.points.toFixed(1)}%<span class="sub">of ${Math.round(share.window.percent)}% used</span>` : ""}</td>
        <td class="num">${row.sub_value > 0 ? `${formatValue(row.sub_value)}<span class="sub">in ${row.agents} agent${row.agents === 1 ? "" : "s"}</span>` : ""}</td>
        <td class="num" data-label="requests">${row.requests}${row.requests_sub ? `<span class="sub">${row.requests_sub} in agents</span>` : ""}</td>
        <td class="num" data-label="in">${tokensCell(row.input_tokens, row.cache_read_tokens)}</td>
        <td class="num" data-label="out">${tokens(row.output_tokens)}</td>
        <td class="num" data-label="peak">${tokens(row.peak_context)}${row.compactions ? `<span class="sub">${row.compactions} compaction${row.compactions === 1 ? "" : "s"}</span>` : ""}</td>
        <td>${escape(modelsLabel(row.models))}${Object.keys(row.efforts).length ? `<span class="sub">${escape(effortsLabel(row.efforts))}</span>` : ""}</td>
        <td>${row.started_ms ? dateTimeFormat.format(row.started_ms) : ""}</td>`;
      tr.querySelector("button")!.addEventListener("click", () => void openSession(row, true));
      tr.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        void openSession(row, true);
      });
      return tr;
    }),
  );
  if (focused) tableBody.querySelector<HTMLButtonElement>(`tr[data-session="${CSS.escape(focused)}"] button`)?.focus();
  for (const button of document.querySelectorAll<HTMLButtonElement>("th button[data-sort]")) {
    if (button.dataset.sort === sortKey) button.setAttribute("aria-sort", sortDesc ? "descending" : "ascending");
    else button.removeAttribute("aria-sort");
  }
  sortSelect.value = sortKey;
}

// A session's own span, so a four-minute thread is not one pixel wide inside a
// day. Clamped to the page range, which is what the rest of the page describes.
function detailBounds(detail: SessionDetail): { min: number; max: number } {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const stamp of [...detail.requests.map((request) => request.ts_ms), ...detail.events.map((event) => event.ts_ms)]) {
    first = Math.min(first, stamp);
    last = Math.max(last, stamp);
  }
  if (!Number.isFinite(first)) return { min: state.fromMs, max: state.toMs };
  const pad = Math.max(minSelectionMs, (last - first) * 0.05);
  return { min: Math.max(state.fromMs, first - pad), max: Math.min(state.toMs, last + pad) };
}

function renderDetail(detail: SessionDetail, focus: boolean): void {
  const { session } = detail;
  detailEl.hidden = false;
  detailOpen = true;
  $("#detail-title").textContent = session.title;
  const share = quotaFor(session);
  $("#detail-meta").textContent = [
    state.scope === "all" ? providerLabel(session.provider) : null,
    session.cwd ?? session.project,
    session.git_branch,
    session.started_ms ? `${dateTimeFormat.format(session.started_ms)}${session.ended_ms ? ` to ${timeFormat.format(session.ended_ms)}` : ""}` : null,
    `${formatValue(session.value)}${session.provider === "codex" ? " API-equivalent" : ""} in range`,
    share && share.points >= 0.05 ? `about ${share.points.toFixed(1)} of the ${Math.round(share.window.percent)}% ${share.window.label.toLowerCase()} limit used so far` : null,
    `${tokens(session.input_tokens)} in${session.cache_read_tokens ? `, ${cachedShare(session.input_tokens, session.cache_read_tokens)}` : ""}`,
    `${tokens(session.output_tokens)} out`,
    `${session.requests} requests`,
    `peak ${tokens(session.peak_context)} context`,
  ]
    .filter(Boolean)
    .join(" · ");
  const t = theme();
  const bounds = detailBounds(detail);
  const span = bounds.max - bounds.min;
  const main = detail.requests.filter((request) => request.agent_id === "");
  const agentRequests = detail.requests.filter((request) => request.agent_id !== "");
  const compactions = detail.events.filter((event) => event.kind === "compact" && event.agent_id === "");
  const compactionGroups = groupResets(
    compactions.map((event) => ({ ...event, end_ms: event.ts_ms })),
    span * mergeShare,
  );
  const compactionLabels = placeResetLabels(
    compactionGroups.map((group) => {
      const name = group.length > 1 ? `${group.length} compactions` : "compacted";
      const x = 56 + ((group[0]!.ts_ms - bounds.min) / span) * (contextChart.getWidth() - 72);
      return { x, width: labelWidth(name), important: false, wanted: true };
    }),
    contextChart.getWidth(),
  );
  const compactionMarks = compactionGroups.flatMap((group, groupIndex) =>
    group.map((event, index) => {
      const before = Number(event.data.preTokens ?? 0);
      const after = Number(event.data.postTokens ?? 0);
      const name = group.length > 1 ? `${group.length} compactions` : before || after ? `compacted ${tokens(before)} → ${tokens(after)}` : "compacted";
      return { xAxis: event.ts_ms, name: index === 0 ? name : "", label: index === 0 ? compactionLabels[groupIndex]! : hiddenLabel };
    }),
  );
  const axis = {
    type: "time" as const,
    axisLabel: { color: t.text, formatter: axisTime, hideOverlap: true },
    axisLine: { lineStyle: { color: t.border } },
    min: bounds.min,
    max: bounds.max,
  };
  $("#detail-scale").textContent =
    span < state.toMs - state.fromMs
      ? `Both charts cover this session's own ${spanLabel(span)} rather than the whole range. Drag across either one to narrow the page to that slice.`
      : "Drag across either chart to narrow the page to that slice.";
  draw(contextChart, {
    backgroundColor: "transparent",
    // Legend at the bottom keeps the top clear for mark line labels.
    grid: { left: 56, right: 16, top: 48, bottom: 56 },
    legend: { bottom: 0, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
    tooltip: { trigger: "axis", ...t.tooltip, valueFormatter: (value: unknown) => (typeof value === "number" ? `${tokens(value)} tokens` : "") },
    xAxis: axis,
    yAxis: { type: "value", axisLabel: { color: t.text, formatter: (value: number) => tokens(value) }, splitLine: { lineStyle: { color: t.border } } },
    series: [
      {
        name: "Main thread",
        type: "line",
        showSymbol: main.length < 60,
        symbolSize: 8,
        lineStyle: { width: 2, color: css("--series-1") },
        itemStyle: { color: css("--series-1") },
        data: main.map((request) => [request.ts_ms, request.context]),
        markLine: {
          symbol: "none",
          label: { color: t.text, formatter: (params: { data: { name: string } }) => params.data.name },
          lineStyle: { color: css("--critical"), type: "dashed" },
          data: compactionMarks,
        },
      },
      {
        name: "Subagents",
        type: "line",
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 0 },
        itemStyle: { color: css("--series-2") },
        data: agentRequests.map((request) => [request.ts_ms, request.context]),
      },
    ],
  });
  draw(costChart, {
    backgroundColor: "transparent",
    grid: { left: 56, right: 16, top: 48, bottom: 56 },
    legend: { bottom: 0, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
    tooltip: { trigger: "axis", ...t.tooltip, formatter: (params: unknown) => costTooltip(params as TooltipParam[], [main, agentRequests]) },
    xAxis: axis,
    yAxis: { type: "value", axisLabel: { color: t.text, formatter: (value: number) => formatValue(value) }, splitLine: { lineStyle: { color: t.border } } },
    series: [
      { name: "Main thread", type: "bar", barMaxWidth: 6, itemStyle: { color: css("--series-1") }, data: main.map((request) => [request.ts_ms, request.value ?? 0]) },
      { name: "Subagents", type: "bar", barMaxWidth: 6, itemStyle: { color: css("--series-2") }, data: agentRequests.map((request) => [request.ts_ms, request.value ?? 0]) },
    ],
  });
  $("#agents-empty").hidden = detail.agents.length > 0;
  agentsBody.replaceChildren(
    ...detail.agents.map((agent) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escape(agent.description ?? agent.prompt_head ?? agent.id)}<span class="sub">${escape(agent.subagent_type ?? "subagent")}${agent.model_requested ? ` · asked for ${escape(agent.model_requested)}` : ""}</span></td>
        <td class="num">${formatValue(agent.value)}</td>
        <td class="num">${tokensCell(agent.input_tokens, agent.cache_read_tokens)}</td>
        <td class="num">${tokens(agent.output_tokens)}</td>
        <td class="num">${agent.requests}</td>
        <td class="num">${tokens(agent.peak_context)}</td>
        <td>${escape(modelsLabel(agent.models))}${Object.keys(agent.efforts).length ? `<span class="sub">${escape(effortsLabel(agent.efforts))}</span>` : ""}</td>`;
      return tr;
    }),
  );
  contextChart.resize();
  costChart.resize();
  if (focus) $<HTMLButtonElement>("#detail-close").focus();
}

async function openSession(ref: SessionRef, push: boolean): Promise<void> {
  // Switching sessions replaces the detail entry so Escape closes instead of
  // stepping back to the previous session.
  const switching = state.session !== null && pushedDetail;
  state = { ...state, session: { provider: ref.provider, id: ref.id } };
  if (push) {
    writeState(state, !switching);
    pushedDetail = true;
  }
  const key = sessionKey(state.session!);
  for (const row of tableBody.querySelectorAll("tr")) row.setAttribute("aria-selected", String(row.dataset.session === key));
  try {
    renderDetail(await getJson<SessionDetail>(`/api/sessions/${encodeURIComponent(ref.id)}?${query({ session_provider: ref.provider })}`), push);
  } catch (error) {
    closeDetail(false);
    noticeEl.hidden = false;
    noticeEl.textContent = (error as Error).message;
  }
}

function closeDetail(viaHistory: boolean): void {
  detailEl.hidden = true;
  detailOpen = false;
  state = { ...state, session: null };
  for (const row of tableBody.querySelectorAll("tr")) row.setAttribute("aria-selected", "false");
  if (viaHistory && pushedDetail) {
    pushedDetail = false;
    history.back();
  } else {
    writeState(state, false);
  }
}

async function load(): Promise<void> {
  // A newer load owns the page: an older one that finishes later must not
  // paint over it.
  const seq = ++loadSeq;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.preset));
  }
  loading = (async () => {
    try {
      // A preset range moves with the clock, and the 5h window with the server.
      const range = state.preset ? await currentPresetRange(state.preset) : undefined;
      if (seq !== loadSeq) return;
      if (range && (range.fromMs !== state.fromMs || range.toMs !== state.toMs)) {
        state = { ...state, ...range };
        writeState(state, false);
      }
      fromInput.value = toLocalInput(state.fromMs);
      toInput.value = toLocalInput(state.toMs);
      bucketSelect.value = state.bucket;
      providerSelect.value = state.scope;
      zoomOutButton.textContent = `Zoom out to ${spanLabel((state.toMs - state.fromMs) * 2)}`;
      const [view, rows, limits, quota, insightsView] = await Promise.all([
        getJson<Timeline>(`/api/timeline?${query()}`),
        getJson<SessionSummary[]>(`/api/sessions?${query()}`),
        getJson<LimitsView>(`/api/limits?${query()}`),
        getJson<QuotaView>(`/api/quota?${query()}`),
        getJson<InsightsView>(`/api/insights?${query()}`),
      ]);
      if (seq !== loadSeq) return;
      renderLimits(limits);
      renderInsights(insightsView);
      renderQuota(quota);
      renderTimeline(view);
      renderSessions(rows);
      if (state.session) await openSession(state.session, false);
      else {
        detailEl.hidden = true;
        detailOpen = false;
      }
      updatedEl.textContent = `Updated ${clockFormat.format(Date.now())}`;
    } catch (error) {
      if (seq !== loadSeq) return;
      noticeEl.hidden = false;
      noticeEl.textContent = (error as Error).message;
    } finally {
      if (seq === loadSeq) {
        loading = null;
        scheduleRefresh();
      }
    }
  })();
  return loading;
}

function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  if (document.hidden) return;
  refreshTimer = setTimeout(() => void refresh(false), refreshEveryMs);
}

// Reloads the range in place. Forced refreshes also make the server ingest
// and poll limits right now instead of on its own schedule.
async function refresh(force: boolean): Promise<void> {
  if (loading) {
    if (!force) return;
    await loading;
  }
  // A half-typed custom range must not be overwritten under the cursor.
  if (!force && (document.activeElement === fromInput || document.activeElement === toInput)) {
    scheduleRefresh();
    return;
  }
  refreshButton.disabled = force;
  try {
    if (force) await getJson("/api/refresh", { method: "POST" });
    await load();
  } catch (error) {
    noticeEl.hidden = false;
    noticeEl.textContent = (error as Error).message;
  } finally {
    refreshButton.disabled = false;
  }
}

// A time axis converts pixels to fractional milliseconds, and the server only
// accepts whole ones.
function setRange(fromMs: number, toMs: number, bucket = state.bucket, preset: string | null = null, push = false, keepSession = false): void {
  const from = Math.floor(fromMs);
  const to = Math.ceil(toMs);
  if (to <= from) return;
  state = { scope: state.scope, fromMs: from, toMs: to, bucket, session: keepSession ? state.session : null, preset };
  writeState(state, push);
  pushedDetail = false;
  void load();
}

async function currentWindowRange(): Promise<{ fromMs: number; toMs: number } | undefined> {
  const now = Date.now();
  const params = new URLSearchParams({ provider: state.scope, from: String(now - 5 * hour), to: String(now + 5 * hour), tz: String(tz) });
  const limits = await getJson<LimitsView>(`/api/limits?${params}`);
  const window = limits.windows.filter((entry) => entry.current).sort((a, b) => a.end_ms - a.start_ms - (b.end_ms - b.start_ms))[0];
  return window ? { fromMs: window.start_ms, toMs: window.end_ms } : undefined;
}

// A selected bucket covers the span it was drawn for, not the instant its bar
// starts, so selecting the last bar of an hour view selects that whole hour.
enableRangeSelect(chart, chartEl, () => {
  const buckets = timelineBuckets;
  if (!buckets) return null;
  return (index: number) => {
    const clamped = Math.min(buckets.starts.length - 1, Math.max(0, Math.round(index)));
    const start = buckets.starts[clamped]!;
    return { fromMs: start, toMs: start + buckets.size };
  };
});
const instant = (ms: number) => ({ fromMs: ms, toMs: ms });
enableRangeSelect(limitsChart, limitsChartEl, () => instant);
// Narrowing from a session's own chart is about that session, so it stays open.
enableRangeSelect(contextChart, contextChartEl, () => (detailOpen ? instant : null), true);
enableRangeSelect(costChart, costChartEl, () => (detailOpen ? instant : null), true);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", async () => {
    const preset = button.dataset.preset!;
    let range: { fromMs: number; toMs: number } | undefined;
    try {
      range = await currentPresetRange(preset);
    } catch (error) {
      limitsNoticeEl.hidden = false;
      limitsNoticeEl.textContent = (error as Error).message;
      return;
    }
    if (!range) {
      limitsNoticeEl.hidden = false;
      limitsNoticeEl.textContent = "No current limit window is known yet.";
      return;
    }
    // The window preset leaves the bucket to the server, which picks 15m for spans this short.
    setRange(range.fromMs, range.toMs, preset === "window" ? "" : state.bucket, preset);
  });
}
// Widening keeps the middle of what is on screen, so whatever is being read
// stays in view. Back steps through earlier selections instead.
zoomOutButton.addEventListener("click", () => {
  const span = state.toMs - state.fromMs;
  const middle = state.fromMs + span / 2;
  setRange(Math.round(middle - span), Math.round(middle + span), "", null, true);
});
function syncCustomRange(): void {
  if (!narrow.matches) customEl.open = true;
}
syncCustomRange();
narrow.addEventListener("change", () => {
  syncCustomRange();
  void load();
});
sortSelect.addEventListener("change", () => {
  sortKey = sortSelect.value as SortKey;
  sortDesc = sortKey !== "title";
  renderSessions(currentSessions);
});
providerSelect.addEventListener("change", () => {
  const scope = providerSelect.value as Scope;
  const today = state.preset === "window" ? presetRange("today") : undefined;
  state = { ...state, ...today, scope, session: null, preset: today ? "today" : state.preset };
  writeState(state, true);
  void load();
});
fromInput.addEventListener("change", () => setRange(new Date(fromInput.value).getTime(), state.toMs));
toInput.addEventListener("change", () => setRange(state.fromMs, new Date(toInput.value).getTime()));
bucketSelect.addEventListener("change", () => setRange(state.fromMs, state.toMs, bucketSelect.value as Bucket | "", state.preset));
for (const button of document.querySelectorAll<HTMLButtonElement>("th button[data-sort]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort as SortKey;
    if (sortKey === key) sortDesc = !sortDesc;
    else {
      sortKey = key;
      sortDesc = key !== "title" && key !== "models";
    }
    renderSessions(currentSessions);
  });
}
$("#detail-close").addEventListener("click", () => closeDetail(true));
refreshButton.addEventListener("click", () => void refresh(true));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(refreshTimer);
  else void refresh(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !detailEl.hidden) closeDetail(true);
});
window.addEventListener("popstate", () => {
  const next = readState();
  const rangeChanged = next.scope !== state.scope || next.fromMs !== state.fromMs || next.toMs !== state.toMs || next.bucket !== state.bucket || next.preset !== state.preset;
  state = next;
  pushedDetail = false;
  if (rangeChanged) void load();
  else if (state.session) void openSession(state.session, false);
  else closeDetail(false);
});
window.addEventListener("resize", () => {
  for (const instance of [chart, limitsChart, contextChart, costChart]) instance.resize();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => void load());

writeState(state, false);
void load();

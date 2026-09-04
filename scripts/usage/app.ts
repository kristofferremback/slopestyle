import { BarChart, LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, ToolboxComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, ToolboxComponent, TooltipComponent, CanvasRenderer]);

type Bucket = "15m" | "hour" | "day";

interface Timeline {
  bucket: Bucket;
  buckets: number[];
  series: { session_id: string; title: string; values: number[] }[];
  other: number[];
  total_usd: number;
  unpriced_models: string[];
}

interface SessionSummary {
  id: string;
  title: string;
  project: string;
  cwd: string | null;
  git_branch: string | null;
  started_ms: number | null;
  ended_ms: number | null;
  cost_usd: number;
  cost_sub_usd: number;
  requests: number;
  requests_sub: number;
  peak_context: number;
  models: Record<string, number>;
  agents: number;
  compactions: number;
}

interface SessionDetail {
  session: SessionSummary;
  requests: { ts_ms: number; agent_id: string; model: string; context: number; cost_usd: number | null; output: number }[];
  agents: { id: string; subagent_type: string | null; model_requested: string | null; description: string | null; prompt_head: string | null; requests: number; cost_usd: number; peak_context: number; models: Record<string, number> }[];
  events: { ts_ms: number; agent_id: string; kind: string; data: Record<string, unknown> }[];
}

interface LimitsView {
  polling: boolean;
  status: { polled_ms: number; ok: boolean; error?: string } | null;
  latest: { ts_ms: number; kind: string; label: string; percent: number; resets_ms: number | null }[];
  samples: { ts_ms: number; kind: string; percent: number }[];
  windows: { kind: string; label: string; start_ms: number; end_ms: number; current: boolean; spend_usd: number }[];
}

interface InsightsView {
  total_usd: number;
  insights: { kind: string; severity: "info" | "warn"; text: string }[];
}

interface State {
  fromMs: number;
  toMs: number;
  bucket: Bucket | "";
  session: string | null;
}

const hour = 3_600_000;
const day = 24 * hour;
const bucketMs: Record<Bucket, number> = { "15m": 15 * 60_000, hour, day };
const tz = -new Date().getTimezoneOffset();

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
};

const fromInput = $<HTMLInputElement>("#from");
const toInput = $<HTMLInputElement>("#to");
const bucketSelect = $<HTMLSelectElement>("#bucket");
const totalEl = $("#total");
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

function readState(): State {
  const params = new URLSearchParams(location.search);
  const parse = (name: string): number | undefined => {
    const value = params.get(name);
    if (!value) return undefined;
    const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  };
  const today = presetRange("today")!;
  const bucket = params.get("bucket");
  return {
    fromMs: parse("from") ?? today.fromMs,
    toMs: parse("to") ?? today.toMs,
    bucket: bucket === "15m" || bucket === "hour" || bucket === "day" ? bucket : "",
    session: params.get("session"),
  };
}

function writeState(state: State, push: boolean): void {
  const params = new URLSearchParams();
  params.set("from", String(state.fromMs));
  params.set("to", String(state.toMs));
  if (state.bucket) params.set("bucket", state.bucket);
  if (state.session) params.set("session", state.session);
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
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
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

let state = readState();
let colorBySession = new Map<string, string>();
let currentSessions: SessionSummary[] = [];
let currentWindows: LimitsView["windows"] = [];
let sortKey: keyof SessionSummary = "cost_usd";
let sortDesc = true;
let pushedDetail = false;
// The preset whose range the page currently shows, so a refresh can roll a
// relative range like "Last 24h" forward instead of freezing it at the click.
let activePreset: string | null = null;
let loading: Promise<void> | null = null;
let loadSeq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const refreshEveryMs = 10_000;

const chart = echarts.init($("#chart"));
const limitsChart = echarts.init(limitsChartEl);
const contextChart = echarts.init($("#context-chart"));
const costChart = echarts.init($("#cost-chart"));

function query(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ from: String(state.fromMs), to: String(state.toMs), tz: String(tz), ...extra });
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

interface ZoomRange {
  start: number;
  end: number;
}

// Charts zoom by dragging out a span, never by scrolling, so a page scroll
// that crosses a chart cannot get caught in it. The toolbox arrow steps back
// out. The first dataZoom holds the range so a refresh can redraw in place.
function zoomOptions(t: ReturnType<typeof theme>, filterMode: "filter" | "none", zoom: ZoomRange | undefined, slider: boolean) {
  const range = { start: zoom?.start ?? 0, end: zoom?.end ?? 100 };
  return {
    toolbox: {
      right: 16,
      top: 0,
      itemSize: 18,
      itemGap: 12,
      iconStyle: { borderColor: t.text },
      emphasis: { iconStyle: { borderColor: css("--text-primary") } },
      feature: { dataZoom: { yAxisIndex: "none", filterMode, title: { zoom: "Drag across a span to zoom", back: "Zoom out" } } },
    },
    dataZoom: [slider ? { type: "slider", bottom: 8, height: 20, borderColor: t.border, textStyle: { color: t.text }, ...range } : { type: "inside", disabled: true, filterMode, ...range }],
  };
}

function currentZoom(instance: echarts.ECharts): ZoomRange | undefined {
  const zoom = (instance.getOption()?.dataZoom as Partial<ZoomRange>[] | undefined)?.[0];
  return zoom?.start !== undefined && zoom.end !== undefined ? { start: zoom.start, end: zoom.end } : undefined;
}

function armZoom(instance: echarts.ECharts): void {
  instance.dispatchAction({ type: "takeGlobalCursor", key: "dataZoomSelect", dataZoomSelectActive: true });
}

function bucketLabel(ms: number, bucket: Bucket, span: number): string {
  if (bucket === "day") return dateFormat.format(ms);
  return span > day ? dateTimeFormat.format(ms) : timeFormat.format(ms);
}

function renderLimits(view: LimitsView, keepZoom: boolean): void {
  currentWindows = view.windows;
  const t = theme();
  tilesEl.replaceChildren(
    ...view.latest.map((sample) => {
      const tile = document.createElement("div");
      tile.className = `tile${sample.percent >= 80 ? " hot" : ""}`;
      const window = view.windows.find((entry) => entry.kind === sample.kind && entry.current);
      const parts = [sample.resets_ms ? `resets in ${untilLabel(sample.resets_ms)} at ${sample.resets_ms - Date.now() < day ? timeFormat.format(sample.resets_ms) : dateTimeFormat.format(sample.resets_ms)}` : "", window ? `${usd.format(window.spend_usd)} this window` : ""].filter(Boolean);
      tile.innerHTML = `<span class="hint">${escape(sample.label)}</span><strong>${Math.round(sample.percent)}%</strong><div class="bar" role="meter" aria-valuenow="${Math.round(sample.percent)}" aria-valuemin="0" aria-valuemax="100" aria-label="${escape(sample.label)} used"><span style="width:${Math.min(100, sample.percent)}%"></span></div><span class="sub">${escape(parts.join(" · "))}</span>`;
      return tile;
    }),
  );
  const notice = !view.polling ? "Limit polling is off for this server (--no-limits)." : view.status && !view.status.ok ? `Limits not updated: ${view.status.error}` : view.latest.length === 0 ? "No limit samples yet." : "";
  limitsNoticeEl.hidden = notice === "";
  limitsNoticeEl.textContent = notice;
  const kinds = [...new Set(view.samples.map((sample) => sample.kind))];
  limitsChartEl.hidden = kinds.length === 0;
  if (kinds.length === 0) return;
  const colors = palette();
  const labels = new Map(view.latest.map((sample) => [sample.kind, sample.label]));
  // A step line holds its last value until the next poll, so extend each
  // series to now (or the end of the range) instead of ending at the sample.
  const edge = Math.min(Date.now(), state.toMs);
  const points = (kind: string): [number, number][] => {
    const own = view.samples.filter((sample) => sample.kind === kind).map((sample): [number, number] => [sample.ts_ms, sample.percent]);
    const last = own[own.length - 1];
    if (last && last[0] < edge) own.push([edge, last[1]]);
    return own;
  };
  limitsChart.setOption(
    {
      backgroundColor: "transparent",
      grid: { left: 48, right: 16, top: 30, bottom: 52 },
      ...zoomOptions(t, "none", keepZoom ? currentZoom(limitsChart) : undefined, false),
      legend: { bottom: 0, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
      tooltip: { trigger: "axis", ...t.tooltip, valueFormatter: (value: unknown) => (typeof value === "number" ? `${Math.round(value)}%` : "") },
      xAxis: { type: "time", min: state.fromMs, max: state.toMs, axisLabel: { color: t.text, formatter: (value: number) => timeFormat.format(value) }, axisLine: { lineStyle: { color: t.border } } },
      yAxis: { type: "value", min: 0, max: 100, axisLabel: { color: t.text, formatter: (value: number) => `${value}%` }, splitLine: { lineStyle: { color: t.border } } },
      series: kinds.map((kind, index) => ({
        name: labels.get(kind) ?? kind,
        type: "line",
        step: "end",
        showSymbol: false,
        lineStyle: { width: 2, color: colors[index % colors.length] },
        itemStyle: { color: colors[index % colors.length] },
        data: points(kind),
        markLine:
          index === 0
            ? {
                symbol: "none",
                label: { color: t.text, position: "end", formatter: (params: { data: { name: string } }) => params.data.name },
                lineStyle: { color: css("--critical"), type: "dashed" },
                data: view.windows.filter((window) => window.end_ms > state.fromMs && window.end_ms < state.toMs).map((window) => ({ xAxis: window.end_ms, name: `${window.label} reset` })),
              }
            : undefined,
      })),
    },
    true,
  );
  armZoom(limitsChart);
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

function renderTimeline(view: Timeline, keepZoom: boolean): void {
  const colors = palette();
  const t = theme();
  const zoom = keepZoom ? currentZoom(chart) : undefined;
  colorBySession = new Map(view.series.map((series, index) => [series.session_id, colors[index]!]));
  const span = state.toMs - state.fromMs;
  const series = view.series.map((entry, index) => ({
    name: entry.title,
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
  const resets = currentWindows
    .filter((window) => window.kind === "five_hour" && window.end_ms > first && window.end_ms < state.toMs)
    .map((window) => ({ xAxis: Math.min(view.buckets.length - 1, Math.round((window.end_ms - first) / size)), name: `5h reset ${timeFormat.format(window.end_ms)}` }));
  if (series[0] && resets.length > 0) {
    series[0].markLine = {
      symbol: "none",
      label: { color: t.text, position: "end", formatter: (params: { data: { name: string } }) => params.data.name },
      lineStyle: { color: css("--critical"), type: "dashed" },
      data: resets,
    };
  }
  chart.setOption(
    {
      backgroundColor: "transparent",
      textStyle: { color: t.text },
      grid: { left: narrow.matches ? 48 : 56, right: 16, top: 30, bottom: series.length > 0 ? 96 : 56, containLabel: false },
      ...zoomOptions(t, "filter", zoom, true),
      legend: { bottom: 40, type: "scroll", formatter: legendName, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value: unknown) => (typeof value === "number" ? usd.format(value) : ""), ...t.tooltip },
      xAxis: {
        type: "category",
        data: view.buckets.map((ms) => bucketLabel(ms, view.bucket, span)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.text },
      },
      yAxis: { type: "value", axisLabel: { color: t.text, formatter: (value: number) => usd.format(value) }, splitLine: { lineStyle: { color: t.border } } },
      series,
    },
    true,
  );
  armZoom(chart);
  chart.off("click");
  chart.on("click", (event) => {
    const entry = view.series[event.seriesIndex ?? -1];
    if (entry) void openSession(entry.session_id, true);
  });
  totalEl.textContent = usd.format(view.total_usd);
  const unpriced = view.unpriced_models;
  noticeEl.hidden = unpriced.length === 0;
  noticeEl.textContent = unpriced.length ? `Not priced, so counted as $0: ${unpriced.join(", ")}` : "";
}

function sortSessions(rows: SessionSummary[]): SessionSummary[] {
  const value = (row: SessionSummary): number | string => {
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
  // A refresh rebuilds the rows, so keyboard focus follows the focused session.
  const focused = document.activeElement?.closest<HTMLTableRowElement>("#sessions tr")?.dataset.session;
  tableBody.replaceChildren(
    ...sortSessions(rows).map((row) => {
      const tr = document.createElement("tr");
      tr.dataset.session = row.id;
      tr.setAttribute("aria-selected", String(row.id === state.session));
      const color = colorBySession.get(row.id) ?? css("--series-other");
      tr.innerHTML = `
        <td><span class="swatch" style="background:${color}"></span></td>
        <td class="title"><button type="button">${escape(row.title)}<span class="sub">${escape(row.project.replace(/^-/, "").replace(/-/g, "/"))}${row.git_branch ? ` · ${escape(row.git_branch)}` : ""}</span></button></td>
        <td class="num">${usd.format(row.cost_usd)}</td>
        <td class="num">${row.cost_sub_usd > 0 ? `${usd.format(row.cost_sub_usd)}<span class="sub">in ${row.agents} agent${row.agents === 1 ? "" : "s"}</span>` : ""}</td>
        <td class="num" data-label="requests">${row.requests}${row.requests_sub ? `<span class="sub">${row.requests_sub} in agents</span>` : ""}</td>
        <td class="num" data-label="peak">${tokens(row.peak_context)}${row.compactions ? `<span class="sub">${row.compactions} compaction${row.compactions === 1 ? "" : "s"}</span>` : ""}</td>
        <td>${escape(modelsLabel(row.models))}</td>
        <td>${row.started_ms ? dateTimeFormat.format(row.started_ms) : ""}</td>`;
      tr.querySelector("button")!.addEventListener("click", () => void openSession(row.id, true));
      tr.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        void openSession(row.id, true);
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

function renderDetail(detail: SessionDetail, focus: boolean, keepZoom: boolean): void {
  const { session } = detail;
  $("#detail-title").textContent = session.title;
  $("#detail-meta").textContent = [
    session.cwd ?? session.project,
    session.git_branch,
    session.started_ms ? `${dateTimeFormat.format(session.started_ms)}${session.ended_ms ? ` to ${timeFormat.format(session.ended_ms)}` : ""}` : null,
    `${usd.format(session.cost_usd)} in range`,
    `${session.requests} requests`,
    `peak ${tokens(session.peak_context)} context`,
  ]
    .filter(Boolean)
    .join(" · ");
  const t = theme();
  const main = detail.requests.filter((request) => request.agent_id === "");
  const agentRequests = detail.requests.filter((request) => request.agent_id !== "");
  const compactions = detail.events.filter((event) => event.kind === "compact" && event.agent_id === "");
  const axis = {
    type: "time" as const,
    axisLabel: { color: t.text, formatter: (value: number) => timeFormat.format(value) },
    axisLine: { lineStyle: { color: t.border } },
    min: state.fromMs,
    max: state.toMs,
  };
  contextChart.setOption(
    {
      backgroundColor: "transparent",
      // Legend at the bottom keeps the top clear for mark line labels.
      grid: { left: 56, right: 16, top: 30, bottom: 56 },
      ...zoomOptions(t, "none", keepZoom ? currentZoom(contextChart) : undefined, false),
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
            data: compactions.map((event) => ({ xAxis: event.ts_ms, name: `compacted ${tokens(Number(event.data.preTokens ?? 0))} → ${tokens(Number(event.data.postTokens ?? 0))}` })),
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
    },
    true,
  );
  costChart.setOption(
    {
      backgroundColor: "transparent",
      grid: { left: 56, right: 16, top: 30, bottom: 56 },
      ...zoomOptions(t, "none", keepZoom ? currentZoom(costChart) : undefined, false),
      legend: { bottom: 0, textStyle: { color: t.text }, itemWidth: 12, itemHeight: 12 },
      tooltip: { trigger: "axis", ...t.tooltip, valueFormatter: (value: unknown) => (typeof value === "number" ? usdFine.format(value) : "") },
      xAxis: axis,
      yAxis: { type: "value", axisLabel: { color: t.text, formatter: (value: number) => usd.format(value) }, splitLine: { lineStyle: { color: t.border } } },
      series: [
        { name: "Main thread", type: "bar", barMaxWidth: 6, itemStyle: { color: css("--series-1") }, data: main.map((request) => [request.ts_ms, request.cost_usd ?? 0]) },
        { name: "Subagents", type: "bar", barMaxWidth: 6, itemStyle: { color: css("--series-2") }, data: agentRequests.map((request) => [request.ts_ms, request.cost_usd ?? 0]) },
      ],
    },
    true,
  );
  $("#agents-empty").hidden = detail.agents.length > 0;
  agentsBody.replaceChildren(
    ...detail.agents.map((agent) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escape(agent.description ?? agent.prompt_head ?? agent.id)}<span class="sub">${escape(agent.subagent_type ?? "subagent")}${agent.model_requested ? ` · asked for ${escape(agent.model_requested)}` : ""}</span></td>
        <td class="num">${usd.format(agent.cost_usd)}</td>
        <td class="num">${agent.requests}</td>
        <td class="num">${tokens(agent.peak_context)}</td>
        <td>${escape(modelsLabel(agent.models))}</td>`;
      return tr;
    }),
  );
  detailEl.hidden = false;
  armZoom(contextChart);
  armZoom(costChart);
  contextChart.resize();
  costChart.resize();
  if (focus) $<HTMLButtonElement>("#detail-close").focus();
}

async function openSession(id: string, push: boolean, keepZoom = false): Promise<void> {
  // Switching sessions replaces the detail entry so Escape closes instead of
  // stepping back to the previous session.
  const switching = state.session !== null && pushedDetail;
  state = { ...state, session: id };
  if (push) {
    writeState(state, !switching);
    pushedDetail = true;
  }
  for (const row of tableBody.querySelectorAll("tr")) row.setAttribute("aria-selected", String(row.dataset.session === id));
  try {
    renderDetail(await getJson<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}?${query()}`), push, keepZoom);
  } catch (error) {
    closeDetail(false);
    noticeEl.hidden = false;
    noticeEl.textContent = (error as Error).message;
  }
}

function closeDetail(viaHistory: boolean): void {
  detailEl.hidden = true;
  state = { ...state, session: null };
  for (const row of tableBody.querySelectorAll("tr")) row.setAttribute("aria-selected", "false");
  if (viaHistory && pushedDetail) {
    pushedDetail = false;
    history.back();
  } else {
    writeState(state, false);
  }
}

async function load(refreshing = false): Promise<void> {
  // A newer load owns the page: an older one that finishes later must not
  // paint over it.
  const seq = ++loadSeq;
  fromInput.value = toLocalInput(state.fromMs);
  toInput.value = toLocalInput(state.toMs);
  bucketSelect.value = state.bucket;
  activePreset = null;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    const range = presetRange(button.dataset.preset!);
    const pressed = range !== undefined && range.fromMs === state.fromMs && range.toMs === state.toMs;
    button.setAttribute("aria-pressed", String(pressed));
    if (pressed) activePreset = button.dataset.preset!;
  }
  loading = (async () => {
    try {
      const [view, rows, limits, insights] = await Promise.all([
        getJson<Timeline>(`/api/timeline?${query()}`),
        getJson<SessionSummary[]>(`/api/sessions?${query()}`),
        getJson<LimitsView>(`/api/limits?${query()}`),
        getJson<InsightsView>(`/api/insights?${query()}`),
      ]);
      if (seq !== loadSeq) return;
      renderLimits(limits, refreshing);
      renderInsights(insights);
      renderTimeline(view, refreshing);
      renderSessions(rows);
      if (state.session) await openSession(state.session, false, refreshing);
      else detailEl.hidden = true;
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
  const range = activePreset ? presetRange(activePreset) : undefined;
  if (range && (range.fromMs !== state.fromMs || range.toMs !== state.toMs)) {
    state = { ...state, ...range };
    writeState(state, false);
  }
  refreshButton.disabled = force;
  try {
    if (force) await getJson("/api/refresh", { method: "POST" });
    await load(true);
  } catch (error) {
    noticeEl.hidden = false;
    noticeEl.textContent = (error as Error).message;
  } finally {
    refreshButton.disabled = false;
  }
}

function setRange(fromMs: number, toMs: number, bucket = state.bucket): void {
  if (toMs <= fromMs) return;
  state = { fromMs, toMs, bucket, session: null };
  writeState(state, false);
  void load();
}

async function currentWindowRange(): Promise<{ fromMs: number; toMs: number } | undefined> {
  const now = Date.now();
  const params = new URLSearchParams({ from: String(now - 5 * hour), to: String(now + 5 * hour), tz: String(tz) });
  const limits = await getJson<LimitsView>(`/api/limits?${params}`);
  const window = limits.windows.find((entry) => entry.kind === "five_hour" && entry.current);
  return window ? { fromMs: window.start_ms, toMs: window.end_ms } : undefined;
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", async () => {
    let range: { fromMs: number; toMs: number } | undefined;
    try {
      range = button.dataset.preset === "window" ? await currentWindowRange() : presetRange(button.dataset.preset!);
    } catch (error) {
      limitsNoticeEl.hidden = false;
      limitsNoticeEl.textContent = (error as Error).message;
      return;
    }
    if (!range) {
      limitsNoticeEl.hidden = false;
      limitsNoticeEl.textContent = "No current 5-hour window is known yet.";
      return;
    }
    // The window preset leaves the bucket to the server, which picks 15m for spans this short.
    setRange(range.fromMs, range.toMs, button.dataset.preset === "window" ? "" : state.bucket);
  });
}
function syncCustomRange(): void {
  if (!narrow.matches) customEl.open = true;
}
syncCustomRange();
narrow.addEventListener("change", () => {
  syncCustomRange();
  void load();
});
sortSelect.addEventListener("change", () => {
  sortKey = sortSelect.value as keyof SessionSummary;
  sortDesc = sortKey !== "title";
  renderSessions(currentSessions);
});
fromInput.addEventListener("change", () => setRange(new Date(fromInput.value).getTime(), state.toMs));
toInput.addEventListener("change", () => setRange(state.fromMs, new Date(toInput.value).getTime()));
bucketSelect.addEventListener("change", () => setRange(state.fromMs, state.toMs, bucketSelect.value as Bucket | ""));
for (const button of document.querySelectorAll<HTMLButtonElement>("th button[data-sort]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.sort as keyof SessionSummary;
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
  const rangeChanged = next.fromMs !== state.fromMs || next.toMs !== state.toMs || next.bucket !== state.bucket;
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

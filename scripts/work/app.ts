import { visiblePRs, githubHealthCurrent, actionSections, projectPRs, type PRAction, type PRView } from "../lib/work/pr-actions.ts";
import type { SlackMessage, SlackThread } from "../lib/work/slack.ts";
import type { PRSnooze, SourceHealth, WorkRecord } from "../lib/work/types.ts";

type Status = {
  records: { github: WorkRecord[]; slack: WorkRecord[] };
  health: { github: SourceHealth; slack: SourceHealth };
  snoozes: PRSnooze[];
  followed: { channel: string; rootTs: string }[];
  runtime: { dispatchGap?: string | null } | null;
};
const content = document.querySelector<HTMLElement>("#content")!;
const facts = document.createElement("div");
const notice = document.querySelector<HTMLElement>("#notice")!;
const dispatch = document.querySelector<HTMLButtonElement>("#dispatch")!;
const dispatchText = document.querySelector<HTMLElement>("#dispatch-text")!;
const freshness = document.querySelector<HTMLElement>("#source")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const refreshLabel = document.querySelector<HTMLElement>("#refresh-label")!;
const views = ["mine", "reviews", "slack", "prompts"];
const requestedView = new URL(location.href).searchParams.get("view") ?? "mine";
const view = views.includes(requestedView) ? requestedView : "mine";
let status: Status | undefined;
let busy = false;
let reading = false;
let mutations = 0;
let revision = 0;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// Short local time for scanning; the full timestamp stays available on hover and to assistive tech.
function time(value: string | number): HTMLTimeElement {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return element("time", "Time unavailable");
  const today = date.toDateString() === new Date().toDateString();
  const node = element("time", date.toLocaleString(undefined, today ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  node.dateTime = date.toISOString();
  node.title = date.toLocaleString();
  return node;
}
const slackTime = (ts: string) => time(Number(ts) * 1000);
function link(label: string, href: string): HTMLAnchorElement {
  const node = element("a", label);
  try {
    const url = new URL(href);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) node.href = url.href;
  } catch { /* Invalid source URLs remain readable text. */ }
  return node;
}
// Shape and color both carry the state, so it reads without color too.
function state(label: string, tone: string, shape: string): HTMLElement {
  const node = element("span", label, `state tone-${tone}`);
  node.dataset.shape = shape;
  return node;
}
async function request<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(path, input === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Request failed");
  return response.json() as Promise<T>;
}
function coverage(health: SourceHealth): { tone: string; text: string | null } {
  if (!health.succeededAt) return { tone: "quiet", text: "Not checked yet" };
  if (!health.gap) return { tone: "good", text: null };
  return health.succeededAt === health.attemptedAt
    ? { tone: "info", text: "Bounded coverage" }
    : { tone: "warn", text: "Collection gap; showing last available data" };
}
// The freshness line lives outside the re-rendered facts, so its disclosure keeps state and focus.
function renderSource(health: SourceHealth): void {
  const cover = coverage(health);
  freshness.className = `source-line tone-${cover.tone}`;
  freshness.hidden = false;
  freshness.querySelector("#source-time")!.replaceChildren(health.succeededAt ? time(health.succeededAt) : health.gap ? "" : cover.text ?? "");
  const gap = freshness.querySelector<HTMLDetailsElement>("#gap")!;
  gap.hidden = !health.gap || !cover.text;
  gap.querySelector("summary")!.textContent = cover.text;
  gap.querySelector("p")!.textContent = health.gap;
}
function empty(health: SourceHealth, message: string): HTMLElement {
  return element("p", health.gap && health.succeededAt !== health.attemptedAt ? "Collection incomplete or unavailable. Refresh to try again." : health.succeededAt ? message : "Waiting for the first source check.", "empty");
}
function excerpt(text: string): HTMLElement {
  const preview = element("p", text.slice(0, 140) + (text.length > 140 ? "…" : ""), "excerpt");
  if (text.length <= 140) return preview;
  const container = element("div");
  const details = element("details", undefined, "more");
  details.append(element("summary", "Full message"), element("p", text, "excerpt"));
  container.append(preview, details);
  return container;
}
function section(title: string, count?: number, note?: string): HTMLElement {
  const header = element("div", undefined, "section-head");
  const heading = element("h2", title);
  if (count !== undefined) heading.append(element("span", String(count), "count"));
  header.append(heading);
  if (note) header.append(element("p", note, "muted"));
  return header;
}
const repositoryFilter = new URL(location.href).searchParams.get("repo");
const showSnoozed = new URL(location.href).searchParams.get("snoozed") === "show";
const prRows = (data: Status, which: string) => visiblePRs(projectPRs(data.records.github, data.health.github, which as PRView, repositoryFilter), data.snoozes).rows;
function renderPRRow(row: PRAction): HTMLLIElement {
  const record = row.record;
  const item = element("li", undefined, "pr");
  item.dataset.key = row.key;
  const title = element("h3");
  title.append(link(record.title, record.url));
  const tone = row.section === "Ready to merge" || row.section === "Reviewed" ? "good" : row.section === "Needs attention" ? "warn" : row.section === "Status unavailable" || row.section === "Drafts" ? "quiet" : "info";
  item.append(element("span", `#${record.number}`, "num"), state(row.reason, tone, row.section === "Drafts" ? "draft" : "pending"), title);
  const meta = element("p", undefined, "meta");
  const repoURL = new URL(location.href);
  repoURL.searchParams.set("repo", record.repository);
  const repo = element("a", record.repository);
  repo.href = repoURL.href;
  repo.setAttribute("aria-label", `Filter repository ${record.repository}`);
  meta.append(repo);
  if (row.parent) meta.append(link(`Parent #${row.parent.number}`, row.parent.url));
  if (record.threadUrl) meta.append(link("T3 review", record.threadUrl));
  item.append(meta);
  const snooze = status?.snoozes.find(s => s.key === row.key);
  const controls = element("details", undefined, "snooze");
  controls.dataset.key = `${row.key}:snooze`;
  const summary = element("summary", "Snooze");
  summary.setAttribute("aria-label", `Snooze PR #${record.number}`);
  controls.append(summary);
  const act = (label: string, durationHours: 1 | 24 | null) => {
    const button = element("button", label, "quiet");
    button.type = "button";
    button.addEventListener("click", async () => {
      if (mutations || busy) { notice.textContent = "Wait for the current update, then try again."; return; }
      mutations++;
      revision++;
      // Keep keyboard focus until render can transfer it if this row disappears.
      button.setAttribute("aria-disabled", "true");
      try {
        const next = await request<Status>(durationHours === null ? "/api/restore" : "/api/snooze", { key: row.key, expected: snooze?.version ?? 0, durationHours });
        status = next;
        notice.textContent = "";
        render();
      } catch { notice.textContent = "Could not update snooze. Refresh to get the latest decision, then try again."; }
      finally { mutations--; button.removeAttribute("aria-disabled"); }
    });
    controls.append(button);
  };
  act("1 hour", 1);
  act("24 hours", 24);
  if (showSnoozed && snooze?.until !== null && snooze?.until !== undefined) {
    act("Restore", null);
    const until = element("p", `${snooze.until > Date.now() ? "Snoozed" : "Expired"} · ${snooze.durationHours}h · until `, "muted");
    until.append(time(snooze.until));
    controls.append(until);
  }
  item.append(controls);
  return item;
}
function renderPRs(data: Status): void {
  const health = data.health.github;
  renderSource(!health.gap && health.succeededAt && !githubHealthCurrent(health) ? { ...health, gap: "GitHub status expired; refresh to verify current actions" } : health);
  const all = projectPRs(data.records.github, health, view as PRView, repositoryFilter);
  const projection = visiblePRs(all, data.snoozes, showSnoozed);
  const activeCount = all.rows.length - visiblePRs(all, data.snoozes).rows.length;
  const toggle = element("a", showSnoozed ? `Hide snoozed (${activeCount})` : `Show snoozed (${activeCount})`);
  const toggleURL = new URL(location.href);
  if (showSnoozed) toggleURL.searchParams.delete("snoozed");
  else toggleURL.searchParams.set("snoozed", "show");
  toggle.href = toggleURL.href;
  toggle.id = "snooze-visibility";
  toggle.className = "snooze-visibility";
  facts.append(toggle);
  if (repositoryFilter) {
    const filter = element("p", undefined, "meta repo-filter");
    const url = new URL(location.href);
    url.searchParams.delete("repo");
    const clear = element("a", "All repositories");
    clear.href = url.href;
    filter.append(element("span", repositoryFilter), clear);
    facts.append(filter);
  }
  if (!projection.rows.length) {
    facts.append(activeCount
      ? element("p", "All matching PRs are snoozed. Show snoozed to restore them.", "empty")
      : empty(health, view === "mine" ? "No open PRs." : "No reviews requested."));
    return;
  }
  for (const sectionName of actionSections) {
    const groups = projection.groups.filter(group => group.section === sectionName);
    if (!groups.length) continue;
    const group = element("section", undefined, "group");
    group.dataset.key = sectionName;
    group.append(section(sectionName, groups.length));
    const list = element("ul", undefined, "ledger");
    for (const stack of groups) {
      if (stack.members.length === 1) { list.append(renderPRRow(stack.primary)); continue; }
      const container = element("li", undefined, "stack");
      container.dataset.key = stack.key;
      const primary = element("ul", undefined, "ledger");
      primary.append(renderPRRow(stack.primary));
      const details = element("details", undefined, "stack-members");
      details.dataset.key = `${stack.key}:disclosure`;
      details.append(element("summary", `Stack · ${stack.members.length} PRs`));
      const members = element("ul", undefined, "ledger");
      for (const member of stack.members) if (member.key !== stack.primary.key) members.append(renderPRRow(member));
      details.append(members);
      container.append(primary, details);
      list.append(container);
    }
    group.append(list);
    facts.append(group);
  }
}
function parsePermalink(value: string): { channel: string; rootTs: string } {
  const url = new URL(value);
  const match = /^\/archives\/([CGD][A-Z0-9]+)\/p(\d{16})$/.exec(url.pathname);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) || url.username || url.password || url.port || !match) throw new Error();
  const rootTs = url.searchParams.get("thread_ts") ?? `${match[2].slice(0, 10)}.${match[2].slice(10)}`;
  if (!/^\d{10}\.\d{1,6}$/.test(rootTs)) throw new Error();
  return { channel: match[1], rootTs };
}
function followForm(): HTMLFormElement {
  const form = element("form", undefined, "follow");
  const label = element("label", "Parent Slack message permalink");
  label.htmlFor = "permalink";
  const input = element("input");
  input.id = "permalink";
  input.type = "url";
  input.required = true;
  input.placeholder = "https://….slack.com/archives/…";
  input.setAttribute("aria-describedby", "follow-help");
  const help = element("p", "Paste the parent message link, or a permalink with thread_ts. Reply links without thread_ts cannot identify the parent.", "muted");
  help.id = "follow-help";
  const button = element("button", "Follow thread", "primary");
  button.type = "submit";
  const row = element("div", undefined, "form-row");
  row.append(input, button);
  const result = element("p", undefined, "form-result");
  result.setAttribute("role", "status");
  form.append(label, row, help, result);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (mutations) { result.textContent = "Wait for the current thread update, then try again."; return; }
    let thread: { channel: string; rootTs: string };
    try { thread = parsePermalink(input.value.trim()); }
    catch { result.textContent = "Enter a valid parent Slack permalink."; return; }
    button.disabled = true;
    mutations++;
    revision++;
    try {
      const response = await request<Pick<Status, "followed">>("/api/follow", thread);
      result.textContent = "Followed · pending source check. Refresh to collect.";
      input.value = "";
      if (status) { status.followed = response.followed; render(); }
    } catch { result.textContent = "Could not follow this thread. Try again."; }
    finally { mutations--; button.disabled = false; }
  });
  return form;
}
function renderSlack(data: Status): void {
  renderSource(data.health.slack);
  facts.append(section("Followed threads", data.followed.length));
  const list = element("ul", undefined, "ledger");
  for (const subscription of data.followed) {
    const record = data.records.slack.find((row) => row.key === `thread:${subscription.channel}:${subscription.rootTs}`);
    const thread = record?.data as unknown as SlackThread | undefined;
    const item = element("li", undefined, "thread");
    item.dataset.key = `thread:${subscription.channel}:${subscription.rootTs}`;
    const origin = thread ? link("", thread.url) : element("span");
    origin.append(element("span", subscription.channel, "channel"), " ", slackTime(subscription.rootTs));
    origin.title = subscription.rootTs;
    const heading = element("h3", undefined, "origin");
    heading.append(origin);
    const unfollow = element("button", "Unfollow", "quiet");
    unfollow.type = "button";
    unfollow.addEventListener("click", async () => {
      if (mutations) { notice.textContent = "Wait for the current thread update, then try again."; return; }
      unfollow.disabled = true;
      mutations++;
      revision++;
      try {
        const response = await request<Pick<Status, "followed">>("/api/unfollow", subscription);
        if (status) { status.followed = response.followed; render(); }
      } catch { notice.textContent = "Could not unfollow. Try again."; }
      finally { mutations--; unfollow.disabled = false; }
    });
    const mark = thread ? thread.complete ? state("Complete", "good", "complete") : state("Incomplete", "warn", "incomplete") : state("Pending", "quiet", "pending");
    item.append(heading, mark, unfollow);
    if (thread) item.append(excerpt(thread.text));
    const checked = element("p", record ? "Checked " : "Refresh to collect", "checked");
    if (record) checked.append(time(record.observedAt));
    item.append(checked);
    list.append(item);
  }
  if (data.followed.length) facts.append(list);
  else facts.append(element("p", "No followed threads.", "empty"));
  const candidates = data.records.slack.filter((row) => (row.data as unknown as SlackMessage).kind === "message").slice(0, 20);
  facts.append(section("Recent candidates", candidates.length, "Discovery only. Open a message to find its parent before following."));
  const recent = element("ul", undefined, "ledger");
  for (const row of candidates) {
    const message = row.data as unknown as SlackMessage;
    const item = element("li", undefined, "message");
    item.dataset.key = row.key;
    const origin = link("", message.url);
    origin.append(element("span", message.author, "author"), " ", element("span", message.channel, "channel"));
    const heading = element("h3", undefined, "origin");
    heading.append(origin, slackTime(message.messageTs));
    item.append(heading, excerpt(message.text));
    recent.append(item);
  }
  if (candidates.length) facts.append(recent);
  else facts.append(empty(data.health.slack, "No recent candidates."));
}
function render(): void {
  if (!status) return;
  const gap = status.runtime?.dispatchGap;
  dispatch.hidden = !gap;
  dispatchText.textContent = gap ? `Morning delivery: ${gap}` : "";
  if (!gap) showDispatch(false);
  for (const count of document.querySelectorAll<HTMLElement>("[data-count]")) {
    count.textContent = String(prRows(status, count.dataset.count!).length);
    count.title = `${count.textContent} unsnoozed PRs`;
    count.setAttribute("aria-label", count.title);
  }
  if (view === "prompts") return;
  // Factual panels refresh independently of the persistent follow form.
  const identity = (node: Element) => {
    const owner = node.closest<HTMLElement>("[data-key]") ?? facts;
    const peers = [...owner.querySelectorAll(node.tagName)];
    return JSON.stringify([owner.dataset.key ?? "health", node.tagName, node instanceof HTMLAnchorElement ? node.href : peers.indexOf(node)]);
  };
  const focused = facts.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused ? identity(focused) : null;
  const opened = new Set([...facts.querySelectorAll("details[open]")].map(identity));
  facts.replaceChildren();
  if (view === "slack") renderSlack(status);
  else renderPRs(status);
  for (const details of facts.querySelectorAll("details")) details.open = opened.has(identity(details));
  if (focusKey) {
    const replacement = [...facts.querySelectorAll<HTMLElement>("a, button, summary")].find((node) => identity(node) === focusKey);
    (replacement ?? facts.querySelector<HTMLElement>("#snooze-visibility") ?? refresh).focus({ preventScroll: true });
  }
}
function showDispatch(open: boolean): void {
  dispatch.ariaExpanded = String(open);
  dispatchText.hidden = !open;
}
function renderPrompts(): void {
  facts.append(element("p", "Edit the Markdown source files in your editor or ask in chat. Each new run loads the current prompt and workflow files.", "muted lede"));
  const list = element("ul", undefined, "ledger");
  for (const [type, name] of [["morning", "Morning check-in"], ["pr-triage", "PR triage"], ["slack-follow-up", "Slack follow-up"]]) {
    const item = element("li", undefined, "prompt");
    const details = element("details");
    details.append(element("summary", name));
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      details.querySelector("div")?.remove();
      const result = element("div", "Loading…", "prompt-body");
      details.append(result);
      try {
        const prompt = await request<{ text: string; hash: string }>(`/api/prompts/${type}`);
        const sources = prompt.text.split("\n").filter((line) => /^(Prompt|Workflow) source: /.test(line));
        const paths = element("ul", undefined, "paths");
        for (const source of sources) {
          const path = source.replace(/^(Prompt|Workflow) source: /, "");
          const parts = path.split("/");
          const short = parts.slice(-3).join("/");
          const item = element("li");
          const fullPath = element("details");
          fullPath.append(element("summary", short), element("code", path));
          item.append(fullPath);
          paths.append(item);
        }
        const bundle = element("details", undefined, "bundle");
        bundle.append(element("summary", "Full prompt and workflow bundle"), element("p", `SHA-256 ${prompt.hash}`, "meta hash"), element("pre", prompt.text));
        result.replaceChildren(paths, bundle);
      } catch { loaded = false; result.textContent = "Could not load this prompt. Close and reopen to retry."; }
    });
    item.append(details);
    list.append(item);
  }
  facts.append(list);
}
async function readStatus(collect = false): Promise<void> {
  if (reading || busy || mutations) return;
  const startedAtRevision = revision;
  reading = true;
  if (collect) { busy = true; refresh.disabled = true; refresh.setAttribute("aria-busy", "true"); refreshLabel.textContent = "Refreshing…"; }
  try {
    const next = await request<Status>(collect ? "/api/refresh" : "/api/status", collect ? {} : undefined);
    if (startedAtRevision !== revision) return;
    status = next;
    notice.textContent = "";
    render();
  } catch {
    notice.textContent = status ? "Unable to refresh. Showing last available data." : "Unable to load work. Refresh to try again.";
    if (!status && view !== "prompts") facts.replaceChildren();
  }
  finally { notice.classList.remove("loading"); reading = false; busy = false; refresh.disabled = false; refresh.removeAttribute("aria-busy"); refreshLabel.textContent = "Refresh"; }
}
for (const anchor of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
  if (repositoryFilter || showSnoozed) {
    const url = new URL(anchor.href);
    if (showSnoozed) url.searchParams.set("snoozed", "show");
    if (repositoryFilter) url.searchParams.set("repo", repositoryFilter);
    anchor.href = url.href;
  }
  if (new URL(anchor.href).searchParams.get("view") === view) anchor.setAttribute("aria-current", "page");
}
freshness.querySelector("#source-name")!.textContent = view === "slack" ? "Slack" : "GitHub";
if (view === "slack") content.append(followForm());
content.append(facts);
if (view === "prompts") renderPrompts();
else {
  const skeleton = element("ul", undefined, "ledger skeleton");
  skeleton.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 4; index++) skeleton.append(element("li"));
  facts.append(skeleton);
}
refresh.addEventListener("click", () => void readStatus(true));
dispatch.addEventListener("click", () => showDispatch(dispatch.ariaExpanded !== "true"));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") showDispatch(false); });
window.addEventListener("focus", () => void readStatus());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void readStatus(); });
setInterval(() => { if (!document.hidden) void readStatus(); }, 30_000);
void readStatus();

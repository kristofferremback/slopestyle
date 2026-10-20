import type { GithubRecord } from "../lib/work/github.ts";
import type { SlackMessage, SlackThread } from "../lib/work/slack.ts";
import type { SourceHealth, WorkRecord } from "../lib/work/types.ts";

type Status = {
  records: { github: WorkRecord[]; slack: WorkRecord[] };
  health: { github: SourceHealth; slack: SourceHealth };
  followed: { channel: string; rootTs: string }[];
  runtime: { dispatchGap?: string | null } | null;
};
const content = document.querySelector<HTMLElement>("#content")!;
const facts = document.createElement("div");
const notice = document.querySelector<HTMLElement>("#notice")!;
const dispatch = document.querySelector<HTMLElement>("#dispatch")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const views = ["mine", "reviews", "slack", "prompts"];
const requestedView = new URL(location.href).searchParams.get("view") ?? "mine";
const view = views.includes(requestedView) ? requestedView : "mine";
let status: Status | undefined;
let busy = false;
let reading = false;
let mutations = 0;
let revision = 0;
const time = (value: string) => new Date(value).toLocaleString();
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(label: string, href: string): HTMLAnchorElement {
  const node = element("a", label);
  try {
    const url = new URL(href);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) node.href = url.href;
  } catch { /* Invalid source URLs remain readable text. */ }
  return node;
}
async function request<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(path, input === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Request failed");
  return response.json() as Promise<T>;
}
function healthText(health: SourceHealth): string {
  const checked = health.succeededAt ? `Checked ${time(health.succeededAt)}` : "Not checked yet";
  return health.gap ? `${checked} · ${health.succeededAt === health.attemptedAt ? "Bounded coverage" : "Collection gap; showing last available data"}` : checked;
}
function empty(health: SourceHealth, message: string): HTMLElement {
  return element("p", health.gap && health.succeededAt !== health.attemptedAt ? "Collection incomplete or unavailable. Refresh to try again." : health.succeededAt ? message : "Waiting for the first source check.", "muted");
}
function renderHealth(health: SourceHealth): void {
  facts.append(element("p", healthText(health), "muted"));
  if (health.gap) {
    const details = element("details", undefined, "help muted");
    details.append(element("summary", "Source coverage"), element("p", health.gap));
    facts.append(details);
  }
}
function excerpt(text: string): HTMLElement {
  const preview = element("p", text.slice(0, 140) + (text.length > 140 ? "…" : ""), "excerpt");
  if (text.length <= 140) return preview;
  const container = element("div");
  const details = element("details");
  details.append(element("summary", "Full message"), element("p", text, "excerpt"));
  container.append(preview, details);
  return container;
}
function renderPRs(data: Status): void {
  const health = data.health.github;
  renderHealth(health);
  const rows = data.records.github.map((row) => row.data as unknown as GithubRecord)
    .filter((row) => view === "mine" ? row.owned : row.requested && !row.owned && !row.hidden);
  if (!rows.length) facts.append(empty(health, view === "mine" ? "No open PRs." : "No reviews requested."));
  const list = element("ul");
  for (const row of rows) {
    const item = element("li");
    item.dataset.key = row.url;
    const title = element("h3");
    title.append(link(row.title, row.url));
    item.append(title, link(`${row.repository}#${row.number}`, row.url));
    item.append(element("p", `${row.status}${row.draft ? " · Draft" : ""}`, "meta"));
    if (row.threadUrl) item.append(link("T3 review", row.threadUrl));
    list.append(item);
  }
  facts.append(list);
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
  const form = element("form");
  const label = element("label", "Parent Slack message permalink");
  label.htmlFor = "permalink";
  const input = element("input");
  input.id = "permalink";
  input.type = "url";
  input.required = true;
  input.setAttribute("aria-describedby", "follow-help");
  const help = element("p", "Paste the parent message link, or a permalink with thread_ts. Reply links without thread_ts cannot identify the parent.", "help muted");
  help.id = "follow-help";
  const button = element("button", "Follow thread");
  button.type = "submit";
  const row = element("div", undefined, "form-row");
  row.append(input, button);
  const result = element("p");
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
  renderHealth(data.health.slack);
  facts.append(element("h2", "Followed threads"));
  const list = element("ul");
  for (const subscription of data.followed) {
    const record = data.records.slack.find((row) => row.key === `thread:${subscription.channel}:${subscription.rootTs}`);
    const thread = record?.data as unknown as SlackThread | undefined;
    const item = element("li");
    item.dataset.key = `thread:${subscription.channel}:${subscription.rootTs}`;
    const title = `${subscription.channel} · ${subscription.rootTs}`;
    item.append(thread ? link(title, thread.url) : element("h3", title));
    item.append(element("p", thread ? `${thread.complete ? "Complete" : "Gap: incomplete thread"} · Checked ${time(record!.observedAt)}` : "Pending first check · Refresh to collect", "meta"));
    if (thread) item.append(excerpt(thread.text));
    const unfollow = element("button", "Unfollow");
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
    item.append(unfollow);
    list.append(item);
  }
  facts.append(list);
  if (!data.followed.length) facts.append(element("p", "No followed threads.", "muted"));
  facts.append(element("h2", "Recent candidates"), element("p", "Discovery only. Open a message to find its parent before following.", "muted"));
  const candidates = data.records.slack.filter((row) => (row.data as unknown as SlackMessage).kind === "message").slice(0, 20);
  const recent = element("ul");
  for (const row of candidates) {
    const message = row.data as unknown as SlackMessage;
    const item = element("li");
    item.dataset.key = row.key;
    item.append(link(`${message.channel} · ${message.author}`, message.url), excerpt(message.text));
    recent.append(item);
  }
  facts.append(recent);
  if (!candidates.length) facts.append(empty(data.health.slack, "No recent candidates."));
}
function render(): void {
  if (!status) return;
  dispatch.hidden = !status.runtime?.dispatchGap;
  dispatch.textContent = status.runtime?.dispatchGap ? `Morning delivery: ${status.runtime.dispatchGap}` : "";
  if (view === "prompts") return;
  // Factual panels refresh independently of the persistent follow form.
  const identity = (node: Element) => {
    const owner = node.closest<HTMLElement>("[data-key]") ?? facts;
    const peers = [...owner.querySelectorAll(node.tagName)];
    return JSON.stringify([owner.dataset.key ?? "health", node.tagName, peers.indexOf(node)]);
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
    replacement?.focus({ preventScroll: true });
  }
}
function renderPrompts(): void {
  facts.append(element("p", "Edit the Markdown source files in your editor or ask in chat. Each new run loads the current prompt and workflow files.", "help"));
  for (const [type, name] of [["morning", "Morning check-in"], ["pr-triage", "PR triage"], ["slack-follow-up", "Slack follow-up"]]) {
    const details = element("details", undefined, "prompt");
    details.append(element("summary", name));
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded) return;
      loaded = true;
      details.querySelector("div")?.remove();
      const result = element("div", "Loading…");
      details.append(result);
      try {
        const prompt = await request<{ text: string; hash: string }>(`/api/prompts/${type}`);
        const sources = prompt.text.split("\n").filter((line) => /^(Prompt|Workflow) source: /.test(line));
        const paths = element("ul", undefined, "sources");
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
        const bundle = element("details");
        bundle.append(element("summary", "Full prompt and workflow bundle"), element("p", `SHA-256 ${prompt.hash}`, "meta"), element("pre", prompt.text));
        result.replaceChildren(paths, bundle);
      } catch { loaded = false; result.textContent = "Could not load this prompt. Close and reopen to retry."; }
    });
    facts.append(details);
  }
}
async function readStatus(collect = false): Promise<void> {
  if (reading || busy || mutations) return;
  const startedAtRevision = revision;
  reading = true;
  if (collect) { busy = true; refresh.disabled = true; refresh.textContent = "Refreshing…"; }
  try {
    const next = await request<Status>(collect ? "/api/refresh" : "/api/status", collect ? {} : undefined);
    if (startedAtRevision !== revision) return;
    status = next;
    notice.textContent = "";
    render();
  } catch { notice.textContent = status ? "Unable to refresh. Showing last available data." : "Unable to load work. Refresh to try again."; }
  finally { reading = false; busy = false; refresh.disabled = false; refresh.textContent = "Refresh"; }
}
for (const anchor of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
  if (new URL(anchor.href).searchParams.get("view") === view) anchor.setAttribute("aria-current", "page");
}
if (view === "slack") content.append(followForm());
content.append(facts);
if (view === "prompts") renderPrompts();
refresh.addEventListener("click", () => void readStatus(true));
window.addEventListener("focus", () => void readStatus());
document.addEventListener("visibilitychange", () => { if (!document.hidden) void readStatus(); });
setInterval(() => { if (!document.hidden) void readStatus(); }, 30_000);
void readStatus();

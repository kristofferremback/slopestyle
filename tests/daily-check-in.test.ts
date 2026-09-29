import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { latest, publish, renderReport, serve, validateReport, type Report } from "../skills/daily-check-in/scripts/check-in";

const script = fileURLToPath(new URL("../skills/daily-check-in/scripts/check-in.ts", import.meta.url));
const examplePath = fileURLToPath(new URL("../skills/daily-check-in/examples/report.v1.json", import.meta.url));
const roots: string[] = [];
async function root(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "check-in-test-")); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function example(): Promise<Report> { return validateReport(JSON.parse(await readFile(examplePath, "utf8"))); }
async function command(...args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { exit, stdout, stderr };
}

test("should validate synthetic example and reject unsafe or incomplete input", async () => {
  const report = await example();
  expect(report.coverage).toHaveLength(8);
  expect(() => validateReport({ ...report, version: 2 })).toThrow("Unsupported report version");
  expect(() => validateReport({ ...report, date: "2026-09-28" })).toThrow("Stockholm");
  expect(() => validateReport({ ...report, coverage: report.coverage.slice(1) })).toThrow("coverage must include");
  expect(() => validateReport({ ...report, items: [{ ...report.items[0], effort: "XXXL" }] })).toThrow("effort");
  expect(() => validateReport({ ...report, items: [{ ...report.items[0], status: "done" }] })).toThrow("closureReason");
  expect(() => validateReport({ ...report, items: [{ ...report.items[0], notRevalidated: true }] })).toThrow("helper-owned");
  expect(() => validateReport({ ...report, items: [{ ...report.items[0], sources: [{ label: "bad", url: "javascript:alert(1)" }] }] })).toThrow("HTTP(S)");
});

test("should publish immutable revisions, carry open work and decisions, and reject stale updates", async () => {
  const path = await root();
  expect(await latest(path)).toBeNull();
  const first = await example();
  expect((await publish(path, first, 0)).revision).toBe(1);
  const firstHtml = await readFile(join(path, "00000001", "index.html"), "utf8");
  expect(firstHtml).toContain('href="/snapshots/1/" title="Captured 2026-09-29T09:30:00+02:00">Revision 1 · 09:30</a>');
  expect(firstHtml).toContain('href="/days/2026-09-29/" aria-label="2026-09-29"');
  const second: Report = { ...first, date: "2026-09-30", capturedAt: "2026-09-30T09:00:00+02:00", headline: "Synthetic second day", items: [first.items[0]], decisions: [], questions: [] };
  const result = await publish(path, second, 1);
  expect(result.revision).toBe(2);
  expect(result.report.items.find(x => x.id === "sample-data")).toMatchObject({ plan: "later", notRevalidated: true, timing: "Not revalidated" });
  expect(result.report.items.find(x => x.id === "sample-data")?.quickWin).toBe(false);
  expect(result.report.decisions).toEqual(first.decisions);
  const persisted = await latest(path);
  expect(persisted?.report.items.find(x => x.id === "sample-data")?.notRevalidated).toBe(true);
  expect(await readFile(join(path, "00000001", "report.json"), "utf8")).toContain("2026-09-29");
  await expect(publish(path, second, 1)).rejects.toThrow("stale expected");
  await expect(publish(path, { ...second, version: 2 }, 2)).rejects.toThrow("Unsupported report version");
  expect((await readdir(path)).sort()).toEqual(["00000001", "00000002"]);
  expect((await readFile(join(path, "00000002", "index.html"), "utf8"))).toContain("Carried forward without revalidation");
});

test("should allow same-day revision, closure, and explicit decision retirement", async () => {
  const path = await root(); const first = await example(); await publish(path, first, 0);
  const second: Report = { ...first, items: first.items.map(x => x.id === "acme-export" ? { ...x, status: "done", plan: "later", closureReason: "Fixed", closureEvidence: "Synthetic verification" } : x), decisions: first.decisions.map(x => ({ ...x, state: "retired" })) };
  const result = await publish(path, second, 1);
  const html = renderReport(result.report, 2, [], first);
  expect(html).toContain("Closure: Fixed");
  expect(html).toContain("Since the previous check-in");
  expect(html).not.toContain("Prioritize the demo export through Wednesday; reassess after the demo.</p>");
  await expect(publish(path, { ...first, date: "2026-09-28", capturedAt: "2026-09-28T09:30:00+02:00" }, 2)).rejects.toThrow("date cannot move backwards");
});

test("should report revised item details even when status and plan are unchanged", async () => {
  const first = await example();
  const second = { ...first, items: first.items.map((item, index) => index === 0 ? { ...item, timing: "Before lunch" } : item) };
  expect(renderReport(validateReport(second), 2, [], first)).toContain('<a href="https://example.com/issues/GAL-17" rel="noopener noreferrer">Updated: Fix the Acme export</a>');
});

test("should keep calendar navigation Monday-first across the year boundary", async () => {
  const report = await example();
  const html = renderReport(report, 1, [{ revision: 1, date: "2026-12-31" }, { revision: 2, date: "2027-01-01" }], undefined, "2026-12");
  expect(html).toContain('<div class="calendar-grid calendar-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>');
  expect(html).toContain('href="/days/2026-09-29/?month=2027-01#archive"');
  expect(html).toContain('href="/days/2026-12-31/"');
  expect(html).toContain("December 2026");
});

test("should escape source text and use safe links", async () => {
  const first = await example();
  first.headline = `<img src=x onerror="alert(1)">`;
  first.items[0].sources = [{ label: `<script>bad</script>`, url: "https://example.com/?q=%22%3E" }];
  const html = renderReport(validateReport(first), 1);
  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
  expect(html).not.toContain("<script>bad</script>");
  expect(html).toContain('href="https://example.com/?q=%22%3E"');
});

test("should keep personal work visible and separate background reviews from focus", async () => {
  const first = await example();
  first.items[2].attention = "background";
  first.items.unshift({ ...first.items[2], id: "second-review", title: "Second review", plan: "must" });
  first.items.push({ ...first.items[0], id: "unassigned", title: "Unknown owner", attention: "unassigned" });
  const html = renderReport(validateReport(first), 1);
  const focus = html.slice(html.indexOf('class="card focus"'), html.indexOf('<section class="card side"'));
  expect(focus).toContain("Fix the Acme export");
  expect(focus).not.toContain("Second review");
  expect(focus).not.toContain("Unknown owner");
  expect(html).toContain('<section class="stack" id="later"');
  expect(html.indexOf('id="item-old-cleanup"')).toBeLessThan(html.indexOf('id="all-work"'));
  expect(html).toContain('<details class="fold" id="background">');
  expect(html).toContain('class="detail-panel item" id="item-second-review"');
  expect(html).toContain('href="#item-second-review"');
  expect(html).toContain('aria-label="Work items"');
  expect(html).toContain('aria-label="Task details"');
  expect(html).toContain('<details class="fold" id="coverage">');
  expect(html).toContain("Mira validates the <a href=");
  expect(html.match(/id="item-sample-data"/g)).toHaveLength(1);
  expect(() => validateReport({ ...first, items: [{ ...first.items[0], attention: "unknown" }] })).toThrow("attention");
});

test("should expose only read-only allowlisted HTTP pages with working navigation", async () => {
  const path = await root(); const first = await example(); await publish(path, first, 0);
  await publish(path, { ...first, headline: "Second revision" }, 1);
  const server = serve(path, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const current = await fetch(base + "/"); const html = await current.text();
    expect(current.status).toBe(200);
    expect(html).toContain("Second revision");
    expect(html).toContain('href="/snapshots/1/"');
    expect(html).toContain('href="#archive"');
    expect(html).toContain('id="archive"');
    expect((await fetch(base + "/archive", { redirect: "manual" })).headers.get("location")).toBe(`/days/${first.date}/#archive`);
    expect((await fetch(base + "/snapshots/1/")).status).toBe(200);
    expect((await fetch(base + "/snapshots/1/").then(x => x.text()))).toContain(first.headline);
    expect((await fetch(base + "/days/2026-09-29/")).status).toBe(200);
    expect((await fetch(base + "/snapshots/1/report.json")).status).toBe(404);
    expect((await fetch(base + "/../report.json")).status).toBe(404);
    expect((await fetch(base + "/", { method: "POST" })).status).toBe(405);
    const head = await fetch(base + "/", { method: "HEAD" });
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
  } finally { server.stop(true); }
});

test("should serve latest dated progress and a usable calendar without changing snapshots", async () => {
  const path = await root();
  const dayOne = await example();
  await publish(path, dayOne, 0);
  const firstBytes = await readFile(join(path, "00000001", "index.html"));
  const closed: Report = { ...dayOne, capturedAt: "2026-09-29T11:30:00+02:00", items: dayOne.items.map(x => x.id === "acme-export" ? { ...x, status: "done", plan: "later", closureReason: "Fixed", closureEvidence: "Verified in staging" } : x) };
  await publish(path, closed, 1);
  const sameDayOmission: Report = { ...closed, capturedAt: "2026-09-29T13:00:00+02:00", items: closed.items.filter(x => x.id !== "acme-export") };
  const retained = await publish(path, sameDayOmission, 2);
  expect(retained.report.items.find(x => x.id === "acme-export")).toMatchObject({ status: "done", closureReason: "Fixed", closureEvidence: "Verified in staging" });
  const dayTwo: Report = { ...sameDayOmission, date: "2026-09-30", capturedAt: "2026-09-30T09:00:00+02:00" };
  const nextDay = await publish(path, dayTwo, 3);
  expect(nextDay.report.items.some(x => x.id === "acme-export")).toBe(false);
  expect(await readFile(join(path, "00000001", "index.html"))).toEqual(firstBytes);

  const server = serve(path, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const redirect = await fetch(`${base}/#item-acme-export`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/days/2026-09-30/");
    const day = await fetch(`${base}/days/2026-09-29/`).then(x => x.text());
    expect(day).toContain('href="/days/2026-09-29/" title="Loads the latest published progress for this day. Invoke daily-check-in to recheck sources."');
    expect(day).toContain("Closure: Fixed");
    expect(day).toContain("Captured 13:00");
    expect(day).toContain('href="/days/2026-09-29/?month=2026-08#archive"');
    expect(day).toContain('href="/days/2026-09-29/?month=2026-10#archive"');
    expect(day).toContain('href="/days/2026-09-29/"');
    expect(day).toContain("Revision 3 · 13:00");
    expect(day).toContain("Selected: <time datetime=\"2026-09-29\">2026-09-29</time>");
    expect(day).toContain("Reload loads saved progress; invoke daily-check-in to recheck sources.");
    expect((await fetch(`${base}/days/2026-09-29/?month=2026-10`)).status).toBe(200);
    expect((await fetch(`${base}/days/2026-09-31/`)).status).toBe(404);
    expect((await fetch(`${base}/days/nope/`)).status).toBe(404);
    const missing = await fetch(`${base}/days/2026-10-03/`).then(x => x.text());
    expect(missing).toContain("No check-in for");
    expect(missing).toContain('href="/days/2026-09-29/"');
    expect((await fetch(`${base}/days/2026-09-29/?month=2026-13`)).status).toBe(400);
    const head = await fetch(`${base}/days/2026-09-29/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await fetch(`${base}/days/2026-09-29/`, { method: "POST" })).status).toBe(405);
  } finally { server.stop(true); }
});

test("should return honest empty-root and missing-date responses", async () => {
  const path = await root();
  const server = serve(path, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/`)).status).toBe(404);
    const missing = await fetch(`${base}/days/2026-01-02/`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("No check-ins have been published yet.");
  } finally { server.stop(true); }
});

test("should execute the documented CLI and leave invalid publishes invisible", async () => {
  const path = await root(); const input = join(path, "draft.json");
  expect((await command("init", "--output", input)).exit).toBe(0);
  expect((await command("validate", "--input", input)).stdout).toContain("Valid version 1 report");
  expect((await command("publish", "--input", input, "--root", path)).exit).toBe(1);
  const published = await command("publish", "--input", input, "--expected", "0", "--root", path);
  expect(published.exit).toBe(0); expect(JSON.parse(published.stdout).revision).toBe(1);
  expect(JSON.parse((await command("latest", "--root", path)).stdout).revision).toBe(1);
  const invalid = { ...await example(), version: 7 }; await writeFile(input, JSON.stringify(invalid));
  expect((await command("publish", "--input", input, "--expected", "1", "--root", path)).exit).toBe(1);
  expect((await readdir(path)).filter(x => /^\d{8}$/.test(x))).toEqual(["00000001"]);
});

test("should fail visibly when a numbered snapshot is incomplete", async () => {
  const path = await root();
  await publish(path, await example(), 0);
  await mkdir(join(path, "00000002"));
  await expect(latest(path)).rejects.toThrow();
  await expect(publish(path, await example(), 1)).rejects.toThrow();
  expect((await readdir(path)).sort()).toEqual(["00000001", "00000002"]);
});

test("should permit one concurrent writer and keep the losing writer invisible", async () => {
  const path = await root();
  const report = await example();
  const outcomes = await Promise.allSettled([publish(path, report, 0), publish(path, report, 0)]);
  expect(outcomes.map(x => x.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect((await readdir(path)).filter(x => /^\d{8}$/.test(x))).toEqual(["00000001"]);
  expect((await latest(path))?.revision).toBe(1);
});


test("should link claims to their precise evidence while keeping unsafe markup inert", async () => {
  const report = await example();
  report.items[2].others = 'Jules drafted [wording · Vault, Sep 29](https://example.com/draft?q=a&b=%22) <img src=x onerror=alert(1)> [unsafe](javascript:evil)';
  report.items[2].sources.push({ label: "T3 thread 123" });
  const path = await root(); await publish(path, report, 0);
  const server = serve(path, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then(x => x.text());
    expect(html).toContain('Jules drafted <a href="https://example.com/draft?q=a&amp;b=%22" rel="noopener noreferrer">wording · Vault, Sep 29</a>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('T3 thread 123 · link unavailable');
    expect(html).toMatch(/class="provenance">[\s\S]*?<a href="https:\/\/example.com\/notes\/onboarding-copy#draft"/);
  } finally { server.stop(true); }
});


test("should preserve the verified source when a change title contains link syntax", async () => {
  const report = await example();
  report.items[0].title = "Fix](https://unverified.example/)[export";
  const html = renderReport(report, 2, [], { ...report, items: [] });
  expect(html).not.toContain('href="https://unverified.example/"');
  expect(html).toContain('href="https://example.com/issues/GAL-17" rel="noopener noreferrer">New: Fix](https://unverified.example/)[export</a>');
});


test("should read early snapshots without carrying minute estimates into the current view", async () => {
  const path = await root(); const report = await example(); await publish(path, report, 0);
  const legacy = JSON.parse(await readFile(join(path, "00000001", "report.json"), "utf8"));
  for (const item of legacy.items) { delete item.effort; if (item.quickWin) item.quickWinMinutes = 8; delete item.quickWin; }
  await writeFile(join(path, "00000001", "report.json"), JSON.stringify(legacy));
  const restored = (await latest(path))!.report;
  expect(restored.items[1]).toMatchObject({ effort: "unknown", quickWin: true });
  expect(renderReport(restored, 1)).not.toContain("8 min");
  expect(() => validateReport(legacy)).toThrow();
});

test("should preserve sourced dependency steps and clear them when work is not revalidated", async () => {
  const report = await example();
  report.items[0].steps = [{ title: "Deploy <consumer>", state: "waiting", owner: "You & release agent", detail: "After [runtime](https://example.com/runtime) is live.", sources: [{ label: "Release", url: "https://example.com/release" }] }];
  const path = await root();
  await publish(path, report, 0);
  expect((await latest(path))?.report.items[0].steps).toEqual(report.items[0].steps);
  const html = renderReport(report, 1);
  expect(html).toContain('aria-label="Dependencies and next actions"');
  expect(html).toContain("Deploy &lt;consumer&gt;");
  expect(html).toContain("You &amp; release agent");
  expect(html).toContain('href="https://example.com/runtime"');
  expect(() => validateReport({ ...report, items: [{ ...report.items[0], steps: [{ ...report.items[0].steps![0], sources: [] }] }] })).toThrow("needs evidence");
  await publish(path, { ...report, items: [] }, 1);
  expect((await latest(path))?.report.items[0]).toMatchObject({ notRevalidated: true });
  expect((await latest(path))?.report.items[0].steps).toBeUndefined();
});

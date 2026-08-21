import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const sourceRoot = resolve(import.meta.dir, "..");
const heavyCheck = resolve(sourceRoot, "scripts/heavy-check.ts");
const scratch = mkdtempSync(resolve(tmpdir(), "slopestyle-heavy-check-test."));
const helper = resolve(scratch, "helper.ts");

writeFileSync(helper, `
import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [mode, first, second] = process.argv.slice(2);
if (mode === "hold") {
  appendFileSync(second, "first:start\\n");
  while (!existsSync(first)) await Bun.sleep(20);
  appendFileSync(second, "first:end\\n");
} else if (mode === "mark") {
  appendFileSync(first, second + "\\n");
} else if (mode === "lock") {
  mkdirSync(dirname(first), { recursive: true });
  const lock = new Database(first, { create: true });
  lock.exec("BEGIN EXCLUSIVE;");
  writeFileSync(second, "ready\\n");
  await new Promise(() => {});
} else if (mode === "signal") {
  writeFileSync(first, String(process.pid));
  await new Promise(() => {});
}
`);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function waitFor(path: string, content?: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path) || (content !== undefined && !readFileSync(path, "utf8").includes(content))) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await Bun.sleep(20);
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for PID ${pid} to exit`);
    await Bun.sleep(20);
  }
}

function run(home: string, label: string, command: string[], wait?: number) {
  const waitArgs = wait === undefined ? [] : ["--wait", String(wait)];
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  delete env.SLOPESTYLE_HEAVY_CHECK;
  return Bun.spawn([process.execPath, heavyCheck, "--label", label, ...waitArgs, "--", ...command], {
    detached: true,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function terminate(subprocess: { pid: number; exitCode: number | null }): void {
  if (subprocess.exitCode !== null) return;
  try {
    process.kill(-subprocess.pid, "SIGKILL");
  } catch {
    // The process may have exited between the status check and the signal.
  }
}

async function release(subprocesses: Array<ReturnType<typeof run>>, releasePath?: string): Promise<void> {
  if (releasePath) writeFileSync(releasePath, "go\n");
  const exits = subprocesses.map((subprocess) => subprocess.exited);
  await Promise.race([Promise.allSettled(exits), Bun.sleep(1_000)]);
  for (const subprocess of subprocesses) terminate(subprocess);
  await Promise.allSettled(exits);
}

test("serializes heavy checks across processes", async () => {
  const home = resolve(scratch, "serial-home");
  const releasePath = resolve(scratch, "release-first");
  const log = resolve(scratch, "serial.log");
  mkdirSync(home, { recursive: true });
  writeFileSync(log, "");

  const first = run(home, "first", [process.execPath, helper, "hold", releasePath, log]);
  const subprocesses = [first];
  try {
    await waitFor(log, "first:start");
    const second = run(home, "second", [process.execPath, helper, "mark", log, "second:start"]);
    subprocesses.push(second);

    await Bun.sleep(500);
    expect(second.exitCode).toBeNull();
    expect(readFileSync(log, "utf8")).toBe("first:start\n");

    writeFileSync(releasePath, "go\n");
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("first:start\nfirst:end\nsecond:start\n");
    expect(await new Response(second.stderr).text()).toContain("Waiting for heavy check \"first\" held by PID");
    expect(existsSync(resolve(home, ".local/state/slopestyle/heavy-check-owner.json"))).toBe(false);
  } finally {
    await release(subprocesses, releasePath);
  }
}, 10_000);

test("allows nested guarded commands without reacquiring the lock", async () => {
  const home = resolve(scratch, "nested-home");
  const log = resolve(scratch, "nested.log");
  writeFileSync(log, "");

  const nested = run(home, "outer", [
    process.execPath,
    heavyCheck,
    "--label",
    "inner",
    "--",
    process.execPath,
    helper,
    "mark",
    log,
    "nested",
  ]);
  try {
    expect(await nested.exited).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("nested\n");
  } finally {
    await release([nested]);
  }
}, 10_000);

test("forwards termination signals and reports the signal exit code", async () => {
  const home = resolve(scratch, "signal-home");
  const childPidPath = resolve(scratch, "signal-child.pid");
  const wrapper = run(home, "signal", [process.execPath, helper, "signal", childPidPath, "unused"]);
  try {
    await waitFor(childPidPath);
    const childPid = Number.parseInt(readFileSync(childPidPath, "utf8"), 10);
    wrapper.kill("SIGTERM");
    expect(await wrapper.exited).toBe(143);
    await waitForExit(childPid);

    const recovered = run(home, "after signal", [process.execPath, "-e", "process.exit(0)"]);
    try {
      expect(await recovered.exited).toBe(0);
    } finally {
      await release([recovered]);
    }
  } finally {
    await release([wrapper]);
  }
}, 10_000);

test("bounds lock waits and identifies the owner", async () => {
  const home = resolve(scratch, "timeout-home");
  const releasePath = resolve(scratch, "release-timeout");
  const log = resolve(scratch, "timeout.log");
  writeFileSync(log, "");

  const first = run(home, "long check", [process.execPath, helper, "hold", releasePath, log]);
  try {
    await waitFor(log, "first:start");
    const timedOut = run(home, "timed out", [process.execPath, "-e", "process.exit(0)"], 0);
    try {
      expect(await timedOut.exited).toBe(75);
      expect(await new Response(timedOut.stderr).text()).toContain("Timed out waiting for heavy check \"long check\" held by PID");
    } finally {
      await release([timedOut]);
    }
  } finally {
    await release([first], releasePath);
  }
}, 10_000);

test("recovers the lock after its owner is killed", async () => {
  const home = resolve(scratch, "crash-home");
  const lock = resolve(home, ".local/state/slopestyle/heavy-check-lock.sqlite");
  const ready = resolve(scratch, "crash-ready");
  const log = resolve(scratch, "crash.log");
  writeFileSync(log, "");

  const holder = Bun.spawn([process.execPath, helper, "lock", lock, ready], { detached: true, stdout: "ignore", stderr: "ignore" });
  try {
    await waitFor(ready);
  } finally {
    terminate(holder);
    await holder.exited;
  }

  const recovered = run(home, "after crash", [process.execPath, helper, "mark", log, "recovered"]);
  try {
    expect(await recovered.exited).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("recovered\n");
  } finally {
    await release([recovered]);
  }
}, 10_000);

test("returns the wrapped command exit code", async () => {
  const home = resolve(scratch, "exit-home");
  const result = run(home, "failure", [process.execPath, "-e", "process.exit(23)"]);
  try {
    expect(await result.exited).toBe(23);
  } finally {
    await release([result]);
  }
}, 10_000);

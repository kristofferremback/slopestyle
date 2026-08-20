#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assert,
  commandExists,
  repoRoot,
  resolvedPath,
  run,
  runOrThrow,
  stableRoot,
  stateRoot,
} from "./lib/core.ts";

if (process.argv.length > 2) {
  if (process.argv.length === 3 && ["-h", "--help"].includes(process.argv[2])) {
    console.log(`Usage: ${process.argv[1]}`);
    process.exit(0);
  }
  console.error(`Usage: ${process.argv[1]}`);
  process.exit(2);
}

const home = process.env.HOME;
if (!home) throw new Error("HOME is required.");
const runtimeRoot = stableRoot(home);
const state = stateRoot(home);
const statusFile = resolve(state, "status");
const fetchFailuresFile = resolve(state, "fetch-failures");
const logFile = resolve(state, "sync.log");
mkdirSync(state, { recursive: true });
if (existsSync(logFile) && statSync(logFile).size > 1_048_576) renameSync(logFile, resolve(state, "sync.previous.log"));
const launchedByMacOs = process.env.SLOPESTYLE_LAUNCHD === "1";
const log = (text: string, error = false): void => {
  appendFileSync(logFile, text);
  if (!launchedByMacOs) (error ? process.stderr : process.stdout).write(text);
};
const commandOptions = { output: (text: string) => log(text) };

const lock = new Database(resolve(state, "sync-lock.sqlite"), { create: true });
try {
  lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "SQLITE_BUSY") {
    console.error("Another Slop(e)style sync is already running.");
    lock.close();
    process.exit(75);
  }
  const message = error instanceof Error ? error.message : String(error);
  log(`Could not acquire synchronization lock: ${message}\n`, true);
  writeFileSync(statusFile, `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} failure phase=acquiring lock\n`);
  lock.close();
  process.exit(1);
}

let phase = "checking runtime checkout";
let validationDirectory: string | undefined;
for (const name of readdirSync(state)) {
  if (name.startsWith("validate.")) rmSync(resolve(state, name), { recursive: true, force: true });
}

function writeStatus(value: string): void {
  writeFileSync(statusFile, `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} ${value}\n`);
}

function notifyFailure(): void {
  const message = `Slop(e)style sync failed during ${phase}. See ${logFile}`;
  if (process.platform === "darwin" && commandExists("osascript")) {
    const script = 'on run arguments\n  display notification (item 1 of arguments) with title "Slop(e)style"\nend run\n';
    Bun.spawnSync(["osascript", "-", message], { stdin: Buffer.from(script), stdout: "ignore", stderr: "ignore" });
  } else if (process.platform === "linux" && commandExists("notify-send")) {
    Bun.spawnSync(["notify-send", "Slop(e)style", message], { stdout: "ignore", stderr: "ignore" });
  }
}

function recordFailure(): void {
  const signature = `failure phase=${phase}`;
  const repeated = existsSync(statusFile) && readFileSync(statusFile, "utf8").includes(signature);
  writeStatus(signature);
  if (phase === "fetching origin/main") {
    const previous = existsSync(fetchFailuresFile) ? Number.parseInt(readFileSync(fetchFailuresFile, "utf8"), 10) : 0;
    const failures = Number.isFinite(previous) ? previous + 1 : 1;
    writeFileSync(fetchFailuresFile, `${failures}\n`);
    if (failures === 4) notifyFailure();
  } else {
    rmSync(fetchFailuresFile, { force: true });
    if (!repeated) notifyFailure();
  }
}

function git(args: string[], quiet = false): string {
  return runOrThrow(["git", "-C", runtimeRoot, ...args], { ...commandOptions, quiet }).stdout.trim();
}

function script(path: string, args: string[] = [], quiet = false) {
  return run([process.execPath, path, ...args], { ...commandOptions, env: process.env, quiet });
}

function scriptOrThrow(path: string, args: string[] = []): void {
  const result = script(path, args);
  if (result.exitCode !== 0) throw new Error(`Script failed (${result.exitCode}): ${path}`);
}

try {
  assert(existsSync(resolve(runtimeRoot, ".git")) && resolvedPath(runtimeRoot) === repoRoot, `Sync must run from the stable runtime checkout at ${runtimeRoot}.`);
  assert(git(["rev-parse", "--show-toplevel"], true) === repoRoot, "Sync must run from the root of its Slop(e)style checkout.");
  git(["worktree", "prune"], true);
  assert(git(["symbolic-ref", "--quiet", "--short", "HEAD"], true) === "main", `Runtime checkout must be on main: ${runtimeRoot}`);
  assert(git(["status", "--porcelain"], true) === "", `Runtime checkout is dirty; refusing to update: ${runtimeRoot}`);
  assert(run(["git", "-C", runtimeRoot, "remote", "get-url", "origin"], { quiet: true }).exitCode === 0, `Runtime checkout has no origin remote: ${runtimeRoot}`);

  phase = "fetching origin/main";
  git(["fetch", "--prune", "origin", "main"]);
  assert(run(["git", "-C", runtimeRoot, "show-ref", "--verify", "--quiet", "refs/remotes/origin/main"], { quiet: true }).exitCode === 0, "origin/main is unavailable after fetch.");

  const current = git(["rev-parse", "HEAD"], true);
  const target = git(["rev-parse", "origin/main"], true);
  if (current !== target) {
    phase = "checking fast-forward";
    assert(run(["git", "-C", runtimeRoot, "merge-base", "--is-ancestor", current, target], { quiet: true }).exitCode === 0, "Runtime checkout has diverged from origin/main; refusing to update.");

    phase = "validating fetched main";
    validationDirectory = mkdtempSync(resolve(state, "validate."));
    const validationRepo = resolve(validationDirectory, "repo");
    git(["worktree", "add", "--detach", validationRepo, target]);
    scriptOrThrow(resolve(validationRepo, "scripts/check.ts"));
    scriptOrThrow(resolve(validationRepo, "scripts/install.ts"), ["--preflight-for", runtimeRoot]);
    git(["worktree", "remove", "--force", validationRepo], true);
    rmSync(validationDirectory, { recursive: true, force: true });
    validationDirectory = undefined;

    phase = "fast-forwarding runtime checkout";
    git(["merge", "--ff-only", target]);
    phase = "installing fetched main";
    scriptOrThrow(resolve(runtimeRoot, "scripts/install.ts"));
  } else {
    phase = "checking installed state";
    phase = "validating runtime";
    scriptOrThrow(resolve(runtimeRoot, "scripts/check.ts"));
    phase = "checking installed state";
    const check = script(resolve(runtimeRoot, "scripts/check.ts"), ["--installed"]);
    if (check.exitCode !== 0) {
      log("Installed state needs repair; rerunning the installer.\n");
      phase = "repairing installed state";
      scriptOrThrow(resolve(runtimeRoot, "scripts/install.ts"));
    } else {
      rmSync(fetchFailuresFile, { force: true });
      writeStatus(`success commit=${current}`);
      log(`Slop(e)style is already current at ${current}.\n`);
      process.exitCode = 0;
    }
  }

  if (process.exitCode !== 0) {
    phase = "checking installed state";
    scriptOrThrow(resolve(runtimeRoot, "scripts/check.ts"), ["--installed"]);
    const revision = git(["rev-parse", "HEAD"], true);
    rmSync(fetchFailuresFile, { force: true });
    writeStatus(`success commit=${revision}`);
    log(`Slop(e)style synced to ${revision}. Start fresh agent sessions to load it.\n`);
    process.exitCode = 0;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`${message}\n`, true);
  recordFailure();
  process.exitCode = 1;
} finally {
  if (validationDirectory) {
    const validationRepo = resolve(validationDirectory, "repo");
    run(["git", "-C", runtimeRoot, "worktree", "remove", "--force", validationRepo], { quiet: true });
    rmSync(validationDirectory, { recursive: true, force: true });
  }
  try {
    lock.exec("ROLLBACK;");
  } finally {
    lock.close();
  }
}

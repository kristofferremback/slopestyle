#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { constants } from "node:os";
import { basename, resolve } from "node:path";
import { stateRoot, writeAtomic } from "./lib/core.ts";

const args = process.argv.slice(2);
let label: string | undefined;
let waitSeconds = 1_800;
const separator = args.indexOf("--");
if (separator === -1) usage(2, "Separate the command with --.");

for (let index = 0; index < separator; index += 1) {
  switch (args[index]) {
    case "--label": {
      const value = args[++index];
      if (!value || value.startsWith("--")) usage(2, "--label requires a value.");
      label = value;
      break;
    }
    case "--wait": {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value)) usage(2, "--wait requires a non-negative number of seconds.");
      waitSeconds = Number.parseInt(value, 10);
      break;
    }
    case "-h":
    case "--help":
      usage(0);
      break;
    default:
      usage(2, `Unknown argument: ${args[index]}`);
  }
}

const command = args.slice(separator + 1);
if (command.length === 0) usage(2, "A command is required after --.");
label ??= basename(command[0]);

function usage(exitCode: number, message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: ${process.argv[1]} [--label TEXT] [--wait SECONDS] -- COMMAND [ARG ...]`);
  process.exit(exitCode);
}

const home = process.env.HOME;
if (!home) throw new Error("HOME is required.");
const state = stateRoot(home);
const lockPath = resolve(state, "heavy-check-lock.sqlite");
const ownerPath = resolve(state, "heavy-check-owner.json");
mkdirSync(state, { recursive: true });

interface Owner {
  token: string;
  pid: number;
  label: string;
  startedAt: string;
  workloadPid?: number;
  processGroupId?: number;
}

function currentOwner(): Owner | undefined {
  if (!existsSync(ownerPath)) return undefined;
  try {
    return JSON.parse(readFileSync(ownerPath, "utf8")) as Owner;
  } catch {
    return undefined;
  }
}

function targetAlive(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EPERM";
  }
}

function workloadAlive(owner: Owner): boolean {
  if (owner.processGroupId !== undefined) return targetAlive(-owner.processGroupId);
  if (owner.workloadPid !== undefined) return targetAlive(owner.workloadPid);
  return false;
}

function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + constants.signals[signal];
}

async function stopDetachedGroup(processGroupId: number): Promise<void> {
  if (!targetAlive(-processGroupId)) return;
  try {
    process.kill(-processGroupId, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 5_000;
  while (targetAlive(-processGroupId) && Date.now() < deadline) await Bun.sleep(50);
  if (!targetAlive(-processGroupId)) return;
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch {
    return;
  }
  while (targetAlive(-processGroupId) && Date.now() < deadline + 1_000) await Bun.sleep(50);
}

async function runCommand(
  env: Record<string, string | undefined>,
  detached: boolean,
  onSpawn?: (child: Bun.Subprocess) => void,
): Promise<number> {
  const child = Bun.spawn(command, {
    detached,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  onSpawn?.(child);

  const signals: NodeJS.Signals[] = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  let forwardedSignals = 0;
  for (const signal of signals) {
    const handler = (): void => {
      forwardedSignals += 1;
      const forwarded = forwardedSignals > 1 ? "SIGKILL" : signal;
      try {
        process.kill(detached ? -child.pid : child.pid, forwarded);
      } catch {
        // The child or process group may already have exited.
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    const exitCode = await child.exited;
    if (detached) await stopDetachedGroup(child.pid);
    return child.signalCode ? signalExitCode(child.signalCode) : exitCode;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

const inheritedToken = process.env.SLOPESTYLE_HEAVY_CHECK;
const inheritedOwner = inheritedToken ? currentOwner() : undefined;
if (inheritedToken && inheritedOwner?.token === inheritedToken && targetAlive(inheritedOwner.pid)) {
  process.exitCode = await runCommand(process.env, false);
} else {
  const busyCode = (error: unknown): boolean => {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    const code = (error as { code?: unknown }).code;
    return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
  };

  const describeOwner = (owner = currentOwner()): string => owner
    ? `heavy check ${JSON.stringify(owner.label)} held by PID ${owner.pid} since ${owner.startedAt}`
    : "another heavy check";

  const lock = new Database(lockPath, { create: true });
  lock.exec("PRAGMA busy_timeout = 0;");
  const waitStarted = Date.now();
  const waitDeadline = waitStarted + waitSeconds * 1_000;
  let nextNotice = waitStarted;
  let waiting = false;

  const waitOrExit = async (description: string): Promise<void> => {
    const now = Date.now();
    if (now >= waitDeadline) {
      console.error(`Timed out waiting for ${description}.`);
      try {
        lock.exec("ROLLBACK;");
      } catch {
        // A transaction is absent while waiting to acquire the SQLite lock.
      }
      lock.close();
      process.exit(75);
    }
    if (now >= nextNotice) {
      console.error(`Waiting for ${description}.`);
      nextNotice = now + 60_000;
    }
    waiting = true;
    await Bun.sleep(Math.min(250, waitDeadline - now));
  };

  while (true) {
    try {
      lock.exec("BEGIN EXCLUSIVE;");
      break;
    } catch (error) {
      if (!busyCode(error)) {
        lock.close();
        throw error;
      }
      await waitOrExit(describeOwner());
    }
  }

  const previousOwner = currentOwner();
  if (previousOwner && workloadAlive(previousOwner)) nextNotice = Date.now();
  while (previousOwner && workloadAlive(previousOwner)) {
    await waitOrExit(`orphaned ${describeOwner(previousOwner)}`);
  }

  const owner: Owner = {
    token: randomUUID(),
    pid: process.pid,
    label,
    startedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  writeAtomic(ownerPath, `${JSON.stringify(owner)}\n`, 0o600);
  if (waiting) console.error(`Heavy-check slot acquired for ${JSON.stringify(label)}.`);

  try {
    process.exitCode = await runCommand(
      { ...process.env, SLOPESTYLE_HEAVY_CHECK: owner.token },
      !process.stdin.isTTY,
      (child) => {
        owner.workloadPid = child.pid;
        if (!process.stdin.isTTY) owner.processGroupId = child.pid;
        writeAtomic(ownerPath, `${JSON.stringify(owner)}\n`, 0o600);
      },
    );
  } finally {
    const recorded = currentOwner();
    if (recorded?.token === owner.token) rmSync(ownerPath, { force: true });
    try {
      lock.exec("ROLLBACK;");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not release the heavy-check transaction cleanly: ${message}`);
    } finally {
      lock.close();
    }
  }
}

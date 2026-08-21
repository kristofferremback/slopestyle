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

for (let index = 0; index < (separator === -1 ? args.length : separator); index += 1) {
  switch (args[index]) {
    case "--label":
      label = args[++index];
      if (!label || label === "--") usage(2, "--label requires a value.");
      break;
    case "--wait": {
      const value = args[++index];
      if (!value || value === "--" || !/^\d+$/.test(value)) usage(2, "--wait requires a non-negative number of seconds.");
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

if (separator === -1) usage(2, "Separate the command with --.");
const command = args.slice(separator + 1);
if (command.length === 0) usage(2, "A command is required after --.");
label ??= basename(command[0]);

function usage(exitCode: number, message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: ${process.argv[1]} [--label TEXT] [--wait SECONDS] -- COMMAND [ARG ...]`);
  process.exit(exitCode);
}

function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + constants.signals[signal];
}

async function runCommand(env: Record<string, string | undefined>): Promise<number> {
  const detached = !process.stdin.isTTY;
  const child = Bun.spawn(command, {
    detached,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const signals: NodeJS.Signals[] = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = (): void => {
      try {
        process.kill(detached ? -child.pid : child.pid, signal);
      } catch {
        // The child group may already have exited.
      }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    const exitCode = await child.exited;
    return child.signalCode ? signalExitCode(child.signalCode) : exitCode;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

if (process.env.SLOPESTYLE_HEAVY_CHECK === "1") {
  process.exitCode = await runCommand(process.env);
} else {
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
  }

  const currentOwner = (): Owner | undefined => {
    if (!existsSync(ownerPath)) return undefined;
    try {
      return JSON.parse(readFileSync(ownerPath, "utf8")) as Owner;
    } catch {
      return undefined;
    }
  };

  const busyCode = (error: unknown): boolean => {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    const code = (error as { code?: unknown }).code;
    return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
  };

  const describeWait = (): string => {
    const owner = currentOwner();
    return owner
      ? `heavy check ${JSON.stringify(owner.label)} held by PID ${owner.pid} since ${owner.startedAt}`
      : "another heavy check";
  };

  const lock = new Database(lockPath, { create: true });
  lock.exec("PRAGMA busy_timeout = 0;");
  const waitStarted = Date.now();
  const waitDeadline = waitStarted + waitSeconds * 1_000;
  let nextNotice = waitStarted;
  let waiting = false;
  while (true) {
    try {
      lock.exec("BEGIN EXCLUSIVE;");
      break;
    } catch (error) {
      if (!busyCode(error)) {
        lock.close();
        throw error;
      }
      const now = Date.now();
      if (now >= waitDeadline) {
        console.error(`Timed out waiting for ${describeWait()}.`);
        lock.close();
        process.exit(75);
      }
      if (now >= nextNotice) {
        console.error(`Waiting for ${describeWait()}.`);
        nextNotice = now + 60_000;
      }
      waiting = true;
      await Bun.sleep(Math.min(250, waitDeadline - now));
    }
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
    process.exitCode = await runCommand({ ...process.env, SLOPESTYLE_HEAVY_CHECK: "1" });
  } finally {
    const recorded = currentOwner();
    if (recorded?.token === owner.token) rmSync(ownerPath, { force: true });
    try {
      lock.exec("ROLLBACK;");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not release the heavy-check transaction cleanly: ${message}`);
      if (!process.exitCode) process.exitCode = 1;
    } finally {
      lock.close();
    }
  }
}

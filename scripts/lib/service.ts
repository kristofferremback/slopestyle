import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assert, resolvedPath, run, runOrThrow } from "./core.ts";

// The Bun that launchd or systemd should run: the one on PATH when it is this
// process, else this process itself.
export function bunExecutable(home: string): string {
  const candidates = [Bun.which("bun"), resolve(home, ".bun/bin/bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun", process.execPath];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate) && resolvedPath(candidate) === resolvedPath(process.execPath))) ?? process.execPath;
}

// PATH for a background job: the Bun directory first, then this shell's PATH.
export function servicePath(bun: string): string {
  const entries = [dirname(bun), ...(process.env.PATH ?? "").split(":")].filter(Boolean);
  return entries.filter((entry, index) => entries.indexOf(entry) === index).join(":");
}

export function systemdQuote(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
}

export function systemdPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(" ", "\\x20").replaceAll("\t", "\\x09").replaceAll("%", "%%");
}

export function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function launchdDomain(): string {
  return `gui/${process.getuid!()}`;
}

export function launchdLoaded(label: string): boolean {
  return run(["launchctl", "print", `${launchdDomain()}/${label}`], { quiet: true }).exitCode === 0;
}

export function launchdUnload(label: string): void {
  const service = `${launchdDomain()}/${label}`;
  if (!launchdLoaded(label)) return;
  runOrThrow(["launchctl", "bootout", service]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!launchdLoaded(label)) break;
    Bun.sleepSync(200);
  }
  assert(!launchdLoaded(label), `macOS LaunchAgent did not finish unloading: ${label}`);
}

// Loads a plist, replacing any loaded copy. launchd can refuse a bootstrap for
// a moment after a bootout, so it retries.
export function launchdLoad(label: string, plist: string): void {
  launchdUnload(label);
  let bootstrapped = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (run(["launchctl", "bootstrap", launchdDomain(), plist]).exitCode === 0) {
      bootstrapped = true;
      break;
    }
    Bun.sleepSync(1000);
  }
  assert(bootstrapped, `Could not load macOS LaunchAgent after three attempts: ${plist}`);
}

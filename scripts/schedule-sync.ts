#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
  writeAtomic,
} from "./lib/core.ts";
import { bunExecutable, launchdLoad, launchdUnload, servicePath, systemdPath, systemdQuote, xml } from "./lib/service.ts";

const action = process.argv[2];
if (process.argv.length !== 3 || !["install", "refresh", "status", "uninstall"].includes(action)) {
  console.error(`Usage: ${process.argv[1]} install|refresh|status|uninstall`);
  process.exit(2);
}
if (!(["linux", "darwin"] as NodeJS.Platform[]).includes(process.platform)) throw new Error(`Unsupported scheduler platform: ${process.platform}`);

const home = process.env.HOME;
if (!home) throw new Error("HOME is required.");
const runtimeRoot = stableRoot(home);
const state = stateRoot(home);
const label = "dev.slopestyle.sync";
const bun = bunExecutable(home);
const schedulerPath = servicePath(bun);
mkdirSync(state, { recursive: true });

if (action === "install" || action === "refresh") {
  assert(commandExists("git"), "git is required for scheduled synchronization.");
  assert(existsSync(resolve(runtimeRoot, ".git")), `Clone the runtime checkout at ${runtimeRoot} before installing its scheduler.`);
  assert(resolvedPath(runtimeRoot) === repoRoot, `Install the scheduler from the stable runtime checkout, not a development checkout.\nExpected: ${runtimeRoot}\nActual:   ${repoRoot}`);
  const branch = runOrThrow(["git", "-C", runtimeRoot, "symbolic-ref", "--quiet", "--short", "HEAD"], { quiet: true }).stdout.trim();
  assert(branch === "main", "Stable runtime checkout must be on main.");
}

function printLastStatus(): void {
  const path = resolve(state, "status");
  console.log(existsSync(path) ? `Last sync: ${readFileSync(path, "utf8").trim()}` : "Last sync: no status recorded");
}

if (process.platform === "linux") {
  assert(commandExists("systemctl"), "systemctl is required to manage the Linux user timer.");
  const unitRoot = resolve(home, ".config/systemd/user");
  const service = resolve(unitRoot, "slopestyle-sync.service");
  const timer = resolve(unitRoot, "slopestyle-sync.timer");

  if (action === "install" || action === "refresh") {
    if (action === "refresh" && !existsSync(service) && !existsSync(timer)) process.exit(0);
    const path = systemdQuote(schedulerPath);
    const root = systemdQuote(runtimeRoot);
    writeAtomic(service, `[Unit]\nDescription=Synchronize Slop(e)style agent guidance\n\n[Service]\nType=oneshot\nWorkingDirectory=${systemdPath(runtimeRoot)}\nExecStart="${systemdQuote(bun)}" "${root}/scripts/sync.ts"\nEnvironment="PATH=${path}"\nStandardOutput=journal\nStandardError=journal\n`);
    writeAtomic(timer, `[Unit]\nDescription=Periodically synchronize Slop(e)style agent guidance\n\n[Timer]\nOnBootSec=2m\nOnUnitActiveSec=30m\nRandomizedDelaySec=5m\nUnit=slopestyle-sync.service\n\n[Install]\nWantedBy=timers.target\n`);
    runOrThrow(["systemctl", "--user", "daemon-reload"]);
    if (action === "install") {
      runOrThrow(["systemctl", "--user", "enable", "--now", "slopestyle-sync.timer"]);
      runOrThrow(["systemctl", "--user", "start", "slopestyle-sync.service"]);
      console.log(`Installed Linux user timer: ${timer}`);
    } else {
      console.log(`Refreshed Linux user timer: ${timer}`);
    }
  } else if (action === "status") {
    printLastStatus();
    runOrThrow(["systemctl", "--user", "status", "slopestyle-sync.timer", "--no-pager"]);
    runOrThrow(["systemctl", "--user", "show", "slopestyle-sync.service", "--property=Result", "--property=ExecMainStatus", "--no-pager"]);
  } else {
    run(["systemctl", "--user", "disable", "--now", "slopestyle-sync.timer"], { quiet: true });
    rmSync(service, { force: true });
    rmSync(timer, { force: true });
    runOrThrow(["systemctl", "--user", "daemon-reload"]);
    console.log("Removed Linux Slop(e)style user timer.");
  }
} else {
  assert(commandExists("launchctl"), "launchctl is required to manage the macOS LaunchAgent.");
  const agentRoot = resolve(home, "Library/LaunchAgents");
  const plist = resolve(agentRoot, `${label}.plist`);
  const service = `gui/${process.getuid!()}/${label}`;

  if (action === "install" || action === "refresh") {
    if (action === "refresh" && !existsSync(plist)) process.exit(0);
    const sync = resolve(runtimeRoot, "scripts/sync.ts");
    const log = resolve(state, "sync.log");
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${xml(label)}</string>\n  <key>ProgramArguments</key><array><string>${xml(bun)}</string><string>${xml(sync)}</string></array>\n  <key>WorkingDirectory</key><string>${xml(runtimeRoot)}</string>\n  <key>RunAtLoad</key><true/>\n  <key>StartInterval</key><integer>1800</integer>\n  <key>EnvironmentVariables</key><dict>\n    <key>PATH</key><string>${xml(schedulerPath)}</string>\n    <key>SLOPESTYLE_LAUNCHD</key><string>1</string>\n  </dict>\n  <key>StandardOutPath</key><string>${xml(log)}</string>\n  <key>StandardErrorPath</key><string>${xml(log)}</string>\n</dict>\n</plist>\n`;
    const unchanged = existsSync(plist) && readFileSync(plist, "utf8") === plistContent;
    if (action === "refresh" && unchanged) {
      console.log(`macOS LaunchAgent is already current: ${plist}`);
      process.exit(0);
    }
    writeAtomic(plist, plistContent);
    if (action === "refresh" && process.env.SLOPESTYLE_LAUNCHD === "1") {
      console.log(`Updated macOS LaunchAgent on disk; the loaded job will refresh at next login: ${plist}`);
      process.exit(0);
    }

    launchdLoad(label, plist);
    console.log(`${action === "install" ? "Installed" : "Refreshed"} macOS LaunchAgent: ${plist}`);
  } else if (action === "status") {
    printLastStatus();
    runOrThrow(["launchctl", "print", service]);
  } else {
    launchdUnload(label);
    rmSync(plist, { force: true });
    console.log("Removed macOS Slop(e)style LaunchAgent.");
  }
}

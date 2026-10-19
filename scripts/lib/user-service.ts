import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { assert, commandExists, repoRoot, resolvedPath, run, runOrThrow, stableRoot, stateRoot, writeAtomic } from "./core.ts";
import { bunExecutable, launchdDomain, launchdLoad, launchdLoaded, launchdUnload, servicePath, systemdArgument, systemdPath, systemdQuote, xml } from "./service.ts";

export const serviceActions = ["install", "refresh", "status", "uninstall"] as const;
export type ServiceAction = (typeof serviceActions)[number];

export type UserService = "usage" | "work";
function definition(name: UserService) {
  return { label: `dev.slopestyle.${name}`, unitName: `slopestyle-${name}.service`, description: name === "usage" ? "usage dashboard" : "work service" };
}

export function servicePaths(name: UserService, home: string): { plist: string; unit: string; log: string } {
  const { label, unitName } = definition(name);
  return {
    plist: resolve(home, "Library/LaunchAgents", `${label}.plist`),
    unit: resolve(home, ".config/systemd/user", unitName),
    log: resolve(stateRoot(home), `${name}.log`),
  };
}

export function serviceInstalled(name: UserService, home: string): boolean {
  const paths = servicePaths(name, home);
  return process.platform === "linux" ? existsSync(paths.unit) : process.platform === "darwin" && existsSync(paths.plist);
}

// Keeps the usage dashboard and work collector running in the login session as a systemd
// user service or a macOS LaunchAgent. Refresh rewrites the unit for the
// current checkout and restarts the server so it runs the current code.
export function manageUserService(name: UserService, action: ServiceAction, home: string, args: string[] = ["serve"]): void {
  const { label, unitName, description } = definition(name);
  assert((["linux", "darwin"] as NodeJS.Platform[]).includes(process.platform), `Unsupported service platform: ${process.platform}`);
  const runtimeRoot = stableRoot(home);
  const paths = servicePaths(name, home);
  const bun = bunExecutable(home);
  const path = servicePath(bun);
  const entry = resolve(runtimeRoot, `scripts/${name}.ts`);
  for (const value of [runtimeRoot, bun, path, entry, ...args]) {
    assert(!/[\x00-\x1f\x7f]/.test(value), "Service paths and arguments must not contain control characters.");
  }
  const artifact = process.platform === "linux" ? paths.unit : paths.plist;
  if (existsSync(artifact) && action !== "status") {
    const existing = readFileSync(artifact, "utf8");
    const owned = process.platform === "linux"
      ? existing.includes(`WorkingDirectory=${systemdPath(runtimeRoot)}\n`) && existing.includes(`"${systemdArgument(entry)}" serve`)
      : existing.includes(`<string>${xml(entry)}</string><string>serve</string>`) && existing.includes(`<key>Label</key><string>${xml(label)}</string>`);
    assert(owned, `Refusing to replace or remove an unrelated service: ${artifact}`);
  }

  if (action === "install" || action === "refresh") {
    assert(resolvedPath(runtimeRoot) === repoRoot, `Install the ${name} service from the stable runtime checkout, not a development checkout.\nExpected: ${runtimeRoot}\nActual:   ${repoRoot}`);
    mkdirSync(stateRoot(home), { recursive: true, mode: 0o700 });
  }

  if (process.platform === "linux") {
    assert(commandExists("systemctl"), "systemctl is required to manage the Linux user service.");
    if (action === "install" || action === "refresh") {
      if (action === "refresh" && !existsSync(paths.unit)) return;
      const unit = `[Unit]\nDescription=Slop(e)style ${description}\n\n[Service]\nType=simple\nWorkingDirectory=${systemdPath(runtimeRoot)}\nExecStart="${systemdArgument(bun)}" "${systemdArgument(entry)}" ${args.map((arg) => arg === "serve" ? "serve" : `"${systemdArgument(arg)}"`).join(" ")}\nEnvironment="PATH=${systemdQuote(path)}"\nRestart=on-failure\nRestartSec=5\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=default.target\n`;
      writeAtomic(paths.unit, unit);
      runOrThrow(["systemctl", "--user", "daemon-reload"]);
      if (action === "install") {
        runOrThrow(["systemctl", "--user", "enable", "--now", unitName]);
        runOrThrow(["systemctl", "--user", "restart", unitName]);
        console.log(`Installed Linux user service: ${paths.unit}`);
      } else {
        runOrThrow(["systemctl", "--user", "try-restart", unitName]);
        console.log(`Refreshed Linux user service: ${paths.unit}`);
      }
    } else if (action === "status") {
      runOrThrow(["systemctl", "--user", "status", unitName, "--no-pager"]);
    } else {
      run(["systemctl", "--user", "disable", "--now", unitName], { quiet: true });
      rmSync(paths.unit, { force: true });
      runOrThrow(["systemctl", "--user", "daemon-reload"]);
      console.log(`Removed Linux Slop(e)style ${name} service.`);
    }
    return;
  }

  assert(commandExists("launchctl"), "launchctl is required to manage the macOS LaunchAgent.");
  if (action === "install" || action === "refresh") {
    if (action === "refresh" && !existsSync(paths.plist)) return;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>${xml(label)}</string>\n  <key>ProgramArguments</key><array><string>${xml(bun)}</string><string>${xml(entry)}</string>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>\n  <key>WorkingDirectory</key><string>${xml(runtimeRoot)}</string>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>10</integer>\n  <key>EnvironmentVariables</key><dict>\n    <key>PATH</key><string>${xml(path)}</string>\n  </dict>\n  <key>StandardOutPath</key><string>${xml(paths.log)}</string>\n  <key>StandardErrorPath</key><string>${xml(paths.log)}</string>\n</dict>\n</plist>\n`;
    const unchanged = existsSync(paths.plist) && readFileSync(paths.plist, "utf8") === plist;
    if (!unchanged) writeAtomic(paths.plist, plist);
    if (unchanged && launchdLoaded(label)) {
      runOrThrow(["launchctl", "kickstart", "-k", `${launchdDomain()}/${label}`]);
    } else {
      launchdLoad(label, paths.plist);
    }
    console.log(`${action === "install" ? "Installed" : "Refreshed"} macOS LaunchAgent: ${paths.plist}`);
  } else if (action === "status") {
    runOrThrow(["launchctl", "print", `${launchdDomain()}/${label}`]);
  } else {
    launchdUnload(label);
    rmSync(paths.plist, { force: true });
    console.log(`Removed macOS Slop(e)style ${name} LaunchAgent.`);
  }
}

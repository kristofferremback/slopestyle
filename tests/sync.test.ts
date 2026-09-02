import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const sourceRoot = resolve(import.meta.dir, "..");
const scratch = realpathSync(mkdtempSync(resolve(tmpdir(), "slopestyle-sync-test.")));
const home = resolve(scratch, "home");
const publisher = resolve(scratch, "publisher");
const remote = resolve(scratch, "remote.git");
const runtime = resolve(home, ".local/share/slopestyle");
const state = resolve(home, ".local/state/slopestyle");
const commandLog = resolve(scratch, "commands.log");
const notificationLog = resolve(scratch, "notifications.log");
const fakeBin = resolve(scratch, "fake-bin");

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function execute(command: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Result {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SLOPESTYLE_TEST_COMMAND_LOG: commandLog,
      SLOPESTYLE_TEST_NOTIFY_LOG: notificationLog,
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function succeeds(command: string[], options?: Parameters<typeof execute>[1]): Result {
  const result = execute(command, options);
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stdout}${result.stderr}`);
  return result;
}

function git(directory: string, ...args: string[]): Result {
  return succeeds(["git", "-C", directory, ...args]);
}

function commitAll(directory: string, message: string): void {
  git(directory, "add", "-A");
  succeeds(["git", "-C", directory, "-c", "user.name=Slopestyle Test", "-c", "user.email=test@example.com", "commit", "-q", "-m", message]);
}

function sync(): Result {
  return execute([resolve(runtime, "scripts/sync.ts")]);
}

function writeStub(name: string): void {
  const path = resolve(fakeBin, name);
  writeFileSync(path, `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nimport { basename } from "node:path";\nconst name = basename(process.argv[1]);\nconst log = name === "notify-send" || name === "osascript" ? process.env.SLOPESTYLE_TEST_NOTIFY_LOG : process.env.SLOPESTYLE_TEST_COMMAND_LOG;\nappendFileSync(log!, name + " " + process.argv.slice(2).join(" ") + "\\n");\nif (name === "launchctl" && process.argv[2] === "print") process.exit(1);\n`);
  chmodSync(path, 0o755);
}

function copySource(destination: string): void {
  cpSync(sourceRoot, destination, {
    recursive: true,
    filter: (path) => {
      const local = relative(sourceRoot, path);
      return local !== ".git" && !local.startsWith(".git/") && local !== "node_modules" && !local.startsWith("node_modules/");
    },
  });
}

mkdirSync(fakeBin, { recursive: true });
writeFileSync(commandLog, "");
writeFileSync(notificationLog, "");
for (const name of ["systemctl", "launchctl", "notify-send", "osascript"]) writeStub(name);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("synchronizes a stable runtime safely", () => {
  mkdirSync(home, { recursive: true });

  succeeds(["git", "init", "-q", "--bare", remote]);
  succeeds(["git", "-C", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  mkdirSync(publisher);
  succeeds(["git", "init", "-q", publisher]);
  succeeds(["git", "-C", publisher, "checkout", "-q", "-b", "main"]);
  copySource(publisher);
  commitAll(publisher, "Seed runtime");
  git(publisher, "remote", "add", "origin", remote);
  git(publisher, "push", "-q", "-u", "origin", "main");
  succeeds(["git", "clone", "-q", remote, runtime]);

  succeeds([resolve(runtime, "scripts/install.sh")]);
  succeeds([resolve(runtime, "scripts/check.sh"), "--installed"]);
  expect(execute([resolve(runtime, "scripts/sync.sh")]).exitCode).toBe(0);

  const upstream = readFileSync(resolve(runtime, "skills/unslop/SKILL.md"), "utf8").split("\n").slice(0, -2).join("\n") + "\n";
  mkdirSync(resolve(home, ".agents/skills/unslop"), { recursive: true });
  writeFileSync(resolve(home, ".agents/skills/unslop/SKILL.md"), upstream);
  rmSync(resolve(home, ".pi/agent/skills/unslop"));
  symlinkSync("../../../.agents/skills/unslop", resolve(home, ".pi/agent/skills/unslop"));
  succeeds([resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime]);
  succeeds([resolve(runtime, "scripts/install.ts")]);
  succeeds([resolve(runtime, "scripts/check.ts"), "--installed"]);

  symlinkSync(resolve(runtime, "skills/retired"), resolve(home, ".pi/agent/skills/retired"));
  expect(execute([resolve(runtime, "scripts/check.ts"), "--installed"]).exitCode).not.toBe(0);
  succeeds([resolve(runtime, "scripts/install.ts")]);
  expect(existsSync(resolve(home, ".pi/agent/skills/retired"))).toBe(false);

  rmSync(resolve(home, ".pi/agent/skills/why"));
  symlinkSync(resolve(runtime, "skills/old-why"), resolve(home, ".pi/agent/skills/why"));
  succeeds([resolve(runtime, "scripts/install.ts")]);
  expect(readlinkSync(resolve(home, ".pi/agent/skills/why"))).toBe(resolve(runtime, "skills/why"));
  expect(sync().exitCode).toBe(0);
  expect(readFileSync(resolve(state, "status"), "utf8")).toContain("success commit=");

  const runtimeOrigin = git(runtime, "remote", "get-url", "origin").stdout.trim();
  git(runtime, "remote", "set-url", "origin", resolve(scratch, "missing.git"));
  for (let expected = 1; expected <= 4; expected += 1) {
    expect(sync().exitCode).not.toBe(0);
    expect(readFileSync(resolve(state, "fetch-failures"), "utf8").trim()).toBe(String(expected));
    expect(readFileSync(notificationLog, "utf8").trim().split("\n").filter(Boolean)).toHaveLength(expected === 4 ? 1 : 0);
  }
  git(runtime, "remote", "set-url", "origin", runtimeOrigin);
  expect(sync().exitCode).toBe(0);
  expect(existsSync(resolve(state, "fetch-failures"))).toBe(false);

  expect(execute([resolve(sourceRoot, "scripts/install.ts")]).exitCode).not.toBe(0);
  expect(execute([resolve(sourceRoot, "scripts/sync.ts")]).exitCode).not.toBe(0);
  expect(execute([resolve(sourceRoot, "scripts/schedule-sync.ts"), "install"]).exitCode).not.toBe(0);

  succeeds([resolve(runtime, "scripts/schedule-sync.ts"), "install"]);
  if (process.platform === "linux") {
    const servicePath = resolve(home, ".config/systemd/user/slopestyle-sync.service");
    const service = readFileSync(servicePath, "utf8");
    expect(service).toContain(`ExecStart=\"${Bun.which("bun") ?? process.execPath}\" \"${runtime}/scripts/sync.ts\"`);
    if (Bun.which("systemd-analyze")) succeeds(["systemd-analyze", "verify", servicePath]);
  } else {
    const plistPath = resolve(home, "Library/LaunchAgents/dev.slopestyle.sync.plist");
    succeeds(["plutil", "-lint", plistPath]);
    const plist = readFileSync(plistPath, "utf8");
    expect(plist).toContain(`${runtime}/scripts/sync.ts`);
    expect(plist).toContain(Bun.which("bun") ?? process.execPath);
    expect(plist).toContain("SLOPESTYLE_LAUNCHD");
    expect(plist).toContain("sync.log");
    const commandsBeforeRefresh = readFileSync(commandLog, "utf8");
    const changedPath = `${resolve(scratch, "launchd-refresh-bin")}:${fakeBin}:${process.env.PATH}`;
    succeeds([resolve(runtime, "scripts/schedule-sync.ts"), "refresh"], { env: { PATH: changedPath, SLOPESTYLE_LAUNCHD: "1" } });
    expect(readFileSync(plistPath, "utf8")).toContain(resolve(scratch, "launchd-refresh-bin"));
    expect(readFileSync(commandLog, "utf8")).toBe(commandsBeforeRefresh);
  }
  succeeds([resolve(runtime, "scripts/schedule-sync.ts"), "uninstall"]);

  expect(execute([resolve(sourceRoot, "scripts/usage.ts"), "service", "install"]).exitCode).not.toBe(0);
  succeeds([resolve(runtime, "scripts/usage.ts"), "service", "install"]);
  const commandsBeforeServiceRefresh = readFileSync(commandLog, "utf8");
  succeeds([resolve(runtime, "scripts/install.ts")]);
  const serviceRefreshCommands = readFileSync(commandLog, "utf8").slice(commandsBeforeServiceRefresh.length);
  if (process.platform === "linux") {
    const unitPath = resolve(home, ".config/systemd/user/slopestyle-usage.service");
    const unit = readFileSync(unitPath, "utf8");
    expect(unit).toContain(`ExecStart=\"${Bun.which("bun") ?? process.execPath}\" \"${runtime}/scripts/usage.ts\" serve`);
    expect(unit).toContain("Restart=on-failure");
    if (Bun.which("systemd-analyze")) succeeds(["systemd-analyze", "verify", unitPath]);
    expect(commandsBeforeServiceRefresh).toContain("systemctl --user enable --now slopestyle-usage.service");
    expect(serviceRefreshCommands).toContain("systemctl --user try-restart slopestyle-usage.service");
    succeeds([resolve(runtime, "scripts/usage.ts"), "service", "uninstall"]);
    expect(existsSync(unitPath)).toBe(false);
  } else {
    const plistPath = resolve(home, "Library/LaunchAgents/dev.slopestyle.usage.plist");
    succeeds(["plutil", "-lint", plistPath]);
    const plist = readFileSync(plistPath, "utf8");
    expect(plist).toContain(`${runtime}/scripts/usage.ts`);
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("usage.log");
    expect(commandsBeforeServiceRefresh).toContain(`launchctl bootstrap gui/${process.getuid!()} ${plistPath}`);
    expect(serviceRefreshCommands).toContain("launchctl bootstrap");
    succeeds([resolve(runtime, "scripts/usage.ts"), "service", "uninstall"]);
    expect(existsSync(plistPath)).toBe(false);
  }

  expect(sync().exitCode).toBe(0);
  const notificationsBeforePersistentFailure = readFileSync(notificationLog, "utf8").trim().split("\n").filter(Boolean).length;
  git(runtime, "checkout", "-q", "-b", "non-main");
  expect(sync().exitCode).not.toBe(0);
  expect(sync().exitCode).not.toBe(0);
  expect(readFileSync(resolve(state, "status"), "utf8")).toContain("failure phase=checking runtime checkout");
  expect(readFileSync(notificationLog, "utf8").trim().split("\n").filter(Boolean)).toHaveLength(notificationsBeforePersistentFailure + 1);
  git(runtime, "checkout", "-q", "main");
  git(runtime, "branch", "-q", "-D", "non-main");

  const staleWorktree = resolve(state, "validate.stale/repo");
  git(runtime, "worktree", "add", "--detach", staleWorktree, "HEAD");
  rmSync(resolve(state, "validate.stale"), { recursive: true, force: true });
  mkdirSync(resolve(state, "validate.orphan"));
  expect(sync().exitCode).toBe(0);
  expect(readdirSync(state).filter((name) => name.startsWith("validate."))).toHaveLength(0);
  expect(git(runtime, "worktree", "list", "--porcelain").stdout.match(/^worktree /gm)).toHaveLength(1);

  const lock = new Database(resolve(state, "sync-lock.sqlite"));
  lock.exec("BEGIN EXCLUSIVE;");
  const statusBeforeContention = readFileSync(resolve(state, "status"), "utf8");
  expect(sync().exitCode).toBe(75);
  expect(readFileSync(resolve(state, "status"), "utf8")).toBe(statusBeforeContention);
  lock.exec("ROLLBACK;");
  lock.close();
  expect(sync().exitCode).toBe(0);

  writeFileSync(resolve(publisher, "sync-test-marker"), "first update\n");
  commitAll(publisher, "Add first update");
  git(publisher, "push", "-q");
  const firstTarget = git(publisher, "rev-parse", "HEAD").stdout.trim();
  const beforeConflict = git(runtime, "rev-parse", "HEAD").stdout.trim();
  rmSync(resolve(home, ".pi/agent/AGENTS.md"));
  writeFileSync(resolve(home, ".pi/agent/AGENTS.md"), "local conflict\n");
  expect(sync().exitCode).not.toBe(0);
  expect(git(runtime, "rev-parse", "HEAD").stdout.trim()).toBe(beforeConflict);
  succeeds([resolve(runtime, "scripts/install.ts"), "--replace"]);
  const firstSync = sync();
  if (firstSync.exitCode !== 0) throw new Error(`sync failed after resolving installation conflict:\n${firstSync.stdout}${firstSync.stderr}`);
  expect(git(runtime, "rev-parse", "HEAD").stdout.trim()).toBe(firstTarget);
  expect(readFileSync(resolve(runtime, "sync-test-marker"), "utf8")).toBe("first update\n");
  succeeds([resolve(runtime, "scripts/check.ts"), "--installed"]);

  const manifest = readFileSync(resolve(publisher, "skills/manifest.json"));
  writeFileSync(resolve(publisher, "skills/manifest.json"), "{}\n");
  commitAll(publisher, "Break fetched validation");
  git(publisher, "push", "-q");
  const beforeInvalid = git(runtime, "rev-parse", "HEAD").stdout.trim();
  expect(sync().exitCode).not.toBe(0);
  expect(git(runtime, "rev-parse", "HEAD").stdout.trim()).toBe(beforeInvalid);
  expect(readdirSync(state).filter((name) => name.startsWith("validate."))).toHaveLength(0);
  expect(git(runtime, "worktree", "list", "--porcelain").stdout.match(/^worktree /gm)).toHaveLength(1);

  writeFileSync(resolve(publisher, "skills/manifest.json"), manifest);
  commitAll(publisher, "Restore fetched validation");
  git(publisher, "push", "-q");
  expect(sync().exitCode).toBe(0);

  appendFileSync(resolve(runtime, "README.md"), "local change\n");
  writeFileSync(resolve(publisher, "sync-test-marker"), "second update\n");
  commitAll(publisher, "Add second update");
  git(publisher, "push", "-q");
  const beforeDirty = git(runtime, "rev-parse", "HEAD").stdout.trim();
  expect(sync().exitCode).not.toBe(0);
  expect(git(runtime, "rev-parse", "HEAD").stdout.trim()).toBe(beforeDirty);
  git(runtime, "checkout", "-q", "--", "README.md");
  expect(sync().exitCode).toBe(0);

  writeFileSync(resolve(runtime, "runtime-only"), "runtime divergence\n");
  commitAll(runtime, "Create runtime divergence");
  writeFileSync(resolve(publisher, "remote-only"), "remote divergence\n");
  commitAll(publisher, "Create remote divergence");
  git(publisher, "push", "-q");
  const beforeDivergence = git(runtime, "rev-parse", "HEAD").stdout.trim();
  expect(sync().exitCode).not.toBe(0);
  expect(git(runtime, "rev-parse", "HEAD").stdout.trim()).toBe(beforeDivergence);
}, 120_000);

test("migrates the merged shell synchronizer and scheduler", () => {
  const migrationHome = resolve(scratch, "migration-home");
  const migrationPublisher = resolve(scratch, "migration-publisher");
  const migrationRemote = resolve(scratch, "migration-remote.git");
  const migrationRuntime = resolve(migrationHome, ".local/share/slopestyle");
  mkdirSync(resolve(migrationHome, ".bun/bin"), { recursive: true });
  symlinkSync(process.execPath, resolve(migrationHome, ".bun/bin/bun"));
  const migrationEnv = { HOME: migrationHome, PATH: `${fakeBin}:/usr/bin:/bin` };

  const revisions = succeeds(["git", "-C", sourceRoot, "rev-list", "HEAD", "--", "scripts/sync.sh"]).stdout.trim().split("\n");
  const shellRevision = revisions.find((revision) => {
    const source = succeeds(["git", "-C", sourceRoot, "show", `${revision}:scripts/sync.sh`]).stdout;
    return source.includes("python3 is required to synchronize Slop(e)style");
  });
  if (!shellRevision) throw new Error("Could not find the merged shell synchronizer revision.");

  succeeds(["git", "init", "-q", "--bare", migrationRemote]);
  succeeds(["git", "-C", migrationRemote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  succeeds(["git", "clone", "-q", sourceRoot, migrationPublisher]);
  git(migrationPublisher, "checkout", "-q", "-B", "main", shellRevision);
  git(migrationPublisher, "remote", "remove", "origin");
  git(migrationPublisher, "remote", "add", "origin", migrationRemote);
  git(migrationPublisher, "push", "-q", "-u", "origin", "HEAD:refs/heads/main");
  succeeds(["git", "clone", "-q", migrationRemote, migrationRuntime]);

  succeeds([resolve(migrationRuntime, "scripts/install.sh")], { env: migrationEnv });
  succeeds([resolve(migrationRuntime, "scripts/schedule-sync.sh"), "install"], { env: migrationEnv });

  for (const name of readdirSync(migrationPublisher)) {
    if (name !== ".git") rmSync(resolve(migrationPublisher, name), { recursive: true, force: true });
  }
  copySource(migrationPublisher);
  commitAll(migrationPublisher, "Rewrite automation in Bun TypeScript");
  git(migrationPublisher, "push", "-q");
  const target = git(migrationPublisher, "rev-parse", "HEAD").stdout.trim();

  const migrated = execute([resolve(migrationRuntime, "scripts/sync.sh")], { env: migrationEnv });
  if (migrated.exitCode !== 0) throw new Error(`shell-to-Bun migration failed:\n${migrated.stdout}${migrated.stderr}`);
  expect(git(migrationRuntime, "rev-parse", "HEAD").stdout.trim()).toBe(target);
  succeeds([process.execPath, resolve(migrationRuntime, "scripts/check.ts"), "--installed"], { env: migrationEnv });

  if (process.platform === "linux") {
    const service = readFileSync(resolve(migrationHome, ".config/systemd/user/slopestyle-sync.service"), "utf8");
    expect(service).toContain(resolve(migrationHome, ".bun/bin/bun"));
    expect(service).toContain(`Environment=\"PATH=${resolve(migrationHome, ".bun/bin")}:`);
    expect(service).toContain("scripts/sync.ts");
  } else {
    const plist = readFileSync(resolve(migrationHome, "Library/LaunchAgents/dev.slopestyle.sync.plist"), "utf8");
    expect(plist).toContain(resolve(migrationHome, ".bun/bin/bun"));
    expect(plist).toContain(resolve(migrationHome, ".bun/bin"));
    expect(plist).toContain("scripts/sync.ts");
  }
}, 120_000);

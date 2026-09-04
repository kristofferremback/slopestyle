import { afterAll, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { isLoopback, parseLsof, parseServeStatus, parseSs } from "../scripts/lib/ports.ts";
import { usagePort } from "../scripts/lib/usage/port.ts";

const sourceRoot = resolve(import.meta.dir, "..");
const portsCli = resolve(sourceRoot, "scripts/ports.ts");
const root = realpathSync(mkdtempSync(resolve(tmpdir(), "slopestyle-ports-test.")));

afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Listening {
  port: number;
  address?: string;
}

const listenerStub = `#!${process.execPath}
import { readFileSync } from "node:fs";
const listening = JSON.parse(readFileSync(process.env.SLOPESTYLE_TEST_LISTENERS, "utf8"));
const entries = listening.map((entry) => (typeof entry === "number" ? { port: entry, address: "127.0.0.1" } : entry));
const name = process.argv[1].split("/").pop();
if (name === "ss") {
  process.stdout.write(entries.map((entry) => \`LISTEN 0 511 \${entry.address}:\${entry.port} 0.0.0.0:* users:(("stub",pid=1,fd=3))\`).join("\\n") + "\\n");
} else {
  process.stdout.write(entries.map((entry) => \`p1\\ncstub\\nn\${entry.address}:\${entry.port}\`).join("\\n") + "\\n");
}
`;

const tailscaleStub = `#!${process.execPath}
import { readFileSync, writeFileSync } from "node:fs";
const path = process.env.SLOPESTYLE_TEST_SERVE;
const args = process.argv.slice(2);
const config = JSON.parse(readFileSync(path, "utf8"));
if (args[0] === "status" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({ Self: { DNSName: "stub-machine.tail1234.ts.net." } }));
} else if (args[0] === "serve" && args[1] === "status") {
  process.stdout.write(JSON.stringify(config));
} else if (args[0] === "serve" && args[args.length - 1] === "off") {
  const port = args.find((argument) => argument.startsWith("--https=")).slice(8);
  delete config.TCP[port];
  delete config.Web[\`stub-machine.tail1234.ts.net:\${port}\`];
  writeFileSync(path, JSON.stringify(config));
} else if (args[0] === "serve") {
  const port = args.find((argument) => argument.startsWith("--https=")).slice(8);
  config.TCP[port] = { HTTPS: true };
  config.Web[\`stub-machine.tail1234.ts.net:\${port}\`] = { Handlers: { "/": { Proxy: args[args.length - 1] } } };
  writeFileSync(path, JSON.stringify(config));
} else {
  process.stderr.write("unexpected tailscale invocation: " + args.join(" ") + "\\n");
  process.exit(1);
}
`;

interface Sandbox {
  path: string;
  home: string;
  environment(): Record<string, string>;
  directory(name: string): string;
  repository(name: string): string;
  worktree(repository: string, name: string): string;
  setListeners(entries: (number | Listening)[]): void;
  setServe(config: unknown): void;
  serveConfig(): { TCP: Record<string, unknown>; Web: Record<string, { Handlers: Record<string, { Proxy: string }> }> };
  ports(cwd: string, ...args: string[]): Result;
  ok(cwd: string, ...args: string[]): Result;
  claimJson(cwd: string, ...args: string[]): ClaimOutput;
}

interface ClaimOutput {
  block: { start: number; size: number };
  services: { name: string; envName: string; offset: number; port: number; tailscaleUrl: string | null }[];
  reused: boolean;
}

let sandboxes = 0;

function git(directory: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", directory, "-c", "user.name=Ports Test", "-c", "user.email=test@example.com", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr.toString()}`);
  return result.stdout.toString();
}

function sandbox(): Sandbox {
  sandboxes += 1;
  const path = resolve(root, `sandbox-${sandboxes}`);
  const home = resolve(path, "home");
  const fakeBin = resolve(path, "fake-bin");
  const listenerState = resolve(path, "listeners.json");
  const serveState = resolve(path, "serve.json");
  mkdirSync(home, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  for (const name of ["ss", "lsof"]) {
    writeFileSync(resolve(fakeBin, name), listenerStub);
    chmodSync(resolve(fakeBin, name), 0o755);
  }
  writeFileSync(resolve(fakeBin, "tailscale"), tailscaleStub);
  chmodSync(resolve(fakeBin, "tailscale"), 0o755);
  writeFileSync(listenerState, "[]");
  writeFileSync(serveState, JSON.stringify({ TCP: {}, Web: {} }));

  const environment = (): Record<string, string> => ({
    ...(process.env as Record<string, string>),
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH}`,
    SLOPESTYLE_TEST_LISTENERS: listenerState,
    SLOPESTYLE_TEST_SERVE: serveState,
  });

  const ports = (cwd: string, ...args: string[]): Result => {
    const result = Bun.spawnSync([process.execPath, portsCli, ...args], { cwd, env: environment(), stdout: "pipe", stderr: "pipe" });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  const ok = (cwd: string, ...args: string[]): Result => {
    const result = ports(cwd, ...args);
    if (result.exitCode !== 0) throw new Error(`slopestyle-ports ${args.join(" ")} failed in ${cwd}:\n${result.stdout}${result.stderr}`);
    return result;
  };
  const directory = (name: string): string => {
    const target = resolve(path, name);
    mkdirSync(target, { recursive: true });
    return target;
  };

  return {
    path,
    home,
    environment,
    directory,
    repository(name) {
      const target = directory(name);
      git(target, "init", "-q", "-b", "main");
      writeFileSync(resolve(target, "README.md"), `${name}\n`);
      git(target, "add", "-A");
      git(target, "commit", "-q", "-m", "seed");
      return target;
    },
    worktree(repository, name) {
      const target = resolve(path, name);
      git(repository, "worktree", "add", "-q", "-b", name, target);
      return target;
    },
    setListeners(entries) {
      writeFileSync(listenerState, JSON.stringify(entries));
    },
    setServe(config) {
      writeFileSync(serveState, JSON.stringify(config));
    },
    serveConfig() {
      return JSON.parse(readFileSync(serveState, "utf8"));
    },
    ports,
    ok,
    claimJson(cwd, ...args) {
      return JSON.parse(ok(cwd, "claim", "--format=json", ...args).stdout) as ClaimOutput;
    },
  };
}

function route(port: number, target: string): { TCP: Record<string, unknown>; Web: Record<string, unknown> } {
  return {
    TCP: { [String(port)]: { HTTPS: true } },
    Web: { [`stub-machine.tail1234.ts.net:${port}`]: { Handlers: { "/": { Proxy: target } } } },
  };
}

test("parses listener output from both supported platforms", () => {
  const ss = parseSs('LISTEN 0 511 127.0.0.1:20003 0.0.0.0:* users:(("node",pid=42,fd=23))\nLISTEN 0 4096 [::1]:20004 [::]:*\nLISTEN 0 511 0.0.0.0:20005 0.0.0.0:*\n');
  expect(ss.map((listener) => listener.port)).toEqual([20003, 20004, 20005]);
  expect(ss[0].address).toBe("127.0.0.1");
  expect(ss[1].address).toBe("[::1]");
  expect(ss[2].address).toBe("0.0.0.0");
  expect(ss[0].detail).toContain("pid=42");
  expect(ss[1].detail).toContain("process unknown");

  const lsof = parseLsof("p42\ncnode\nn127.0.0.1:20003\nn*:20005\np43\ncbun\nn[::1]:20004\n");
  expect(lsof.map((listener) => listener.port)).toEqual([20003, 20005, 20004]);
  expect(lsof[1].address).toBe("*");
  expect(lsof[0].detail).toBe("lsof node pid=42");
  expect(lsof[2].detail).toBe("lsof bun pid=43");
});

test("gives linked worktrees distinct blocks with shared service offsets", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  const second = box.worktree(repository, "repo-wt2");

  const first = box.claimJson(repository, "frontend", "api");
  expect(first.block.start).toBe(20_000);
  expect(first.services.map((service) => [service.name, service.port])).toEqual([["frontend", 20_000], ["api", 20_001]]);

  const other = box.claimJson(second, "api", "frontend");
  expect(other.block.start).toBe(20_010);
  expect(other.services.map((service) => [service.name, service.offset])).toEqual([["api", 1], ["frontend", 0]]);

  const worker = box.claimJson(second, "worker");
  expect(worker.services).toEqual([{ name: "worker", envName: "WORKER", offset: 2, port: 20_012, tailscaleUrl: "https://stub-machine.tail1234.ts.net:20012" }]);
  expect(worker.reused).toBe(true);
});

test("serializes concurrent claims onto different blocks", async () => {
  const box = sandbox();
  const repository = box.repository("repo");
  const left = box.worktree(repository, "repo-wt2");
  const right = box.worktree(repository, "repo-wt3");
  const spawn = (cwd: string) => Bun.spawn([process.execPath, portsCli, "claim", "--format=json", "frontend"], { cwd, env: box.environment(), stdout: "pipe", stderr: "pipe" });
  const outputs = await Promise.all([spawn(left), spawn(right)].map(async (child) => {
    const text = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    await child.exited;
    if (child.exitCode !== 0) throw new Error(`concurrent claim failed:\n${text}${errors}`);
    return JSON.parse(text) as ClaimOutput;
  }));
  expect(outputs.map((output) => output.block.start).sort()).toEqual([20_000, 20_010]);
});

test("serializes concurrent first-ever claims through one migration", async () => {
  const box = sandbox();
  const directories = [1, 2, 3, 4].map((index) => box.directory(`app-${index}`));
  const children = directories.map((cwd, index) => Bun.spawn(
    [process.execPath, portsCli, "claim", "--app", `first-use-${index}`, "--format=json", "frontend"],
    { cwd, env: box.environment(), stdout: "pipe", stderr: "pipe" },
  ));
  const outputs = await Promise.all(children.map(async (child) => {
    const text = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    await child.exited;
    if (child.exitCode !== 0) throw new Error(`first-use claim failed (${child.exitCode}):\n${text}${errors}`);
    return JSON.parse(text) as ClaimOutput;
  }));
  const starts = outputs.map((output) => output.block.start).sort((left, right) => left - right);
  expect(starts).toEqual([20_000, 20_010, 20_020, 20_030]);
});

test("keeps released blocks owned by their app", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  expect(box.claimJson(repository, "frontend").block.start).toBe(20_000);
  box.ok(repository, "release");

  const other = box.repository("other");
  expect(box.claimJson(other, "frontend").block.start).toBe(20_010);
  expect(box.claimJson(repository, "frontend").block.start).toBe(20_000);
});

test("reuses a block whose worktree was deleted", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  box.claimJson(repository, "frontend");
  const deleted = box.worktree(repository, "repo-wt2");
  const deletedBlock = box.claimJson(deleted, "frontend").block.start;
  rmSync(deleted, { recursive: true, force: true });
  const successor = box.worktree(repository, "repo-wt3");
  expect(box.claimJson(successor, "frontend").block.start).toBe(deletedBlock);
});

test("keeps a missing checkout's lease while its block is still active", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  const doomed = box.worktree(repository, "repo-wt2");
  const block = box.claimJson(doomed, "frontend", "api").block.start;
  rmSync(doomed, { recursive: true, force: true });

  box.setListeners([{ port: block + 5, address: "127.0.0.1" }]);
  const successor = box.worktree(repository, "repo-wt3");
  expect(box.claimJson(successor, "frontend").block.start).not.toBe(block);

  const shown = JSON.parse(box.ok(repository, "show", "--all", "--format=json").stdout) as {
    entries: { block: { start: number }; checkout: { path: string; exists: boolean } | null; active: string[] }[];
  };
  const preserved = shown.entries.find((entry) => entry.block.start === block)!;
  expect(preserved.checkout).not.toBeNull();
  expect(preserved.checkout!.exists).toBe(false);
  expect(preserved.active.join("\n")).toContain(`${block + 5} has a local listener`);
  expect(box.ok(repository, "show", "--all").stdout).toContain("(missing)");

  box.setListeners([]);
  const reclaimed = box.worktree(repository, "repo-wt4");
  expect(box.claimJson(reclaimed, "frontend").block.start).toBe(block);
});

test("keeps the usage server's port across restarts while its own route is live", () => {
  const box = sandbox();
  const checkout = box.directory("usage-runtime");
  const options = { cwd: checkout, env: box.environment() };
  expect(usagePort(options)).toBe(20_000);

  box.setServe(route(20_000, "http://127.0.0.1:20000"));
  expect(box.ports(checkout, "claim", "--app", "slopestyle-usage", "usage").stderr).toContain("20000 has a Tailscale route");
  expect(usagePort(options)).toBe(20_000);
});

test("treats local listeners and Tailscale routes as active blocks", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  box.setListeners([20_007]);
  expect(box.claimJson(repository, "frontend").block.start).toBe(20_010);

  box.setListeners([20_010]);
  const active = box.ports(repository, "claim", "frontend");
  expect(active.exitCode).not.toBe(0);
  expect(active.stderr).toContain("already leased to this checkout and in use");
  expect(active.stderr).toContain("20010 has a local listener");

  const blocked = box.ports(repository, "release");
  expect(blocked.exitCode).not.toBe(0);
  expect(blocked.stderr).toContain("Refusing to release block 20010");

  box.setListeners([]);
  box.setServe(route(20_013, "http://127.0.0.1:20013"));
  expect(box.ports(repository, "claim", "frontend").stderr).toContain("20013 has a Tailscale route");
  expect(box.ports(repository, "release").exitCode).not.toBe(0);

  const routed = box.repository("routed");
  box.setServe(route(20_025, "http://127.0.0.1:20025"));
  expect(box.claimJson(routed, "frontend").block.start).toBe(20_000);

  box.setServe({ TCP: {}, Web: {} });
  box.ok(repository, "release");
});

test("serves only a loopback listener and removes only the exact route", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  box.claimJson(repository, "frontend", "api");

  const withoutListener = box.ports(repository, "serve", "api");
  expect(withoutListener.exitCode).not.toBe(0);
  expect(withoutListener.stderr).toContain("Nothing is listening on 127.0.0.1:20001");

  for (const address of ["0.0.0.0", "*", "[::]", "[::1]", "127.0.0.2"]) {
    box.setListeners([{ port: 20_001, address }]);
    const refused = box.ports(repository, "serve", "api");
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("not on 127.0.0.1");
    expect(refused.stderr).toContain("bind api to 127.0.0.1");
  }

  // A wildcard entry must not hide a valid loopback bind on the same port.
  box.setListeners([{ port: 20_001, address: "0.0.0.0" }, { port: 20_001, address: "127.0.0.1" }]);
  expect(box.ok(repository, "serve", "api").stdout).toContain("Serving https://stub-machine.tail1234.ts.net:20001 -> http://127.0.0.1:20001");
  expect(box.serveConfig().Web["stub-machine.tail1234.ts.net:20001"].Handlers["/"].Proxy).toBe("http://127.0.0.1:20001");
  expect(box.ok(repository, "serve", "api").stdout).toContain("Already served");

  const foreign = box.serveConfig();
  foreign.Web["stub-machine.tail1234.ts.net:20000"] = { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } };
  foreign.TCP["20000"] = { HTTPS: true };
  box.setServe(foreign);
  box.setListeners([20_000, 20_001]);
  expect(box.ports(repository, "serve", "frontend").stderr).toContain("not the exact route for frontend");
  expect(box.ports(repository, "unserve", "frontend").stderr).toContain("Leaving it untouched");
  expect(box.serveConfig().Web["stub-machine.tail1234.ts.net:20000"].Handlers["/"].Proxy).toBe("http://127.0.0.1:9999");

  box.ok(repository, "unserve", "api");
  expect(box.serveConfig().Web["stub-machine.tail1234.ts.net:20001"]).toBeUndefined();
  expect(box.serveConfig().Web["stub-machine.tail1234.ts.net:20000"]).toBeDefined();
  expect(box.ok(repository, "unserve", "api").stdout).toContain("serves nothing on port 20001");
});

test("wildcard listeners still make a candidate block unavailable", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  box.setListeners([{ port: 20_004, address: "0.0.0.0" }, { port: 20_011, address: "[::1]" }]);
  expect(box.claimJson(repository, "frontend").block.start).toBe(20_020);
});

test("requires --app outside Git and groups manual checkouts", () => {
  const box = sandbox();
  const plain = box.directory("plain-app");
  const rejected = box.ports(plain, "claim", "frontend");
  expect(rejected.exitCode).toBe(2);
  expect(rejected.stderr).toContain("Pass --app NAME");

  const first = box.claimJson(plain, "--app", "notes", "frontend");
  const secondary = box.directory("plain-app-2");
  const second = box.claimJson(secondary, "--app", "notes", "api", "frontend");
  expect(second.block.start).not.toBe(first.block.start);
  expect(second.services.map((service) => service.offset)).toEqual([1, 0]);
  expect(box.ports(plain, "claim", "--app", "notes", "--size", "7", "--format=sh", "frontend").stdout.trim().split("\n")).toEqual([
    `SLOPESTYLE_PORT_BASE='${first.block.start}'`,
    `SLOPESTYLE_PORT_FRONTEND='${first.block.start}'`,
  ]);
  const shown = JSON.parse(box.ok(secondary, "show", "--app", "notes", "--format=json").stdout);
  expect(shown.entries).toHaveLength(1);
  expect(shown.entries[0].block.start).toBe(second.block.start);
  expect(JSON.parse(box.ok(secondary, "show", "--app", "notes", "--all", "--format=json").stdout).entries.length).toBeGreaterThan(1);
  expect(box.ok(secondary, "show", "--app", "notes").stdout).toContain("notes (manual:notes)");
});

test("validates arguments before touching the registry", () => {
  const box = sandbox();
  const repository = box.repository("repo");

  const badFormat = box.ports(repository, "claim", "--format=yaml", "frontend");
  expect(badFormat.exitCode).toBe(2);
  expect(badFormat.stderr).toContain("Unknown --format: yaml");
  const empty = JSON.parse(box.ok(repository, "show", "--all", "--format=json").stdout);
  expect(empty.entries).toEqual([]);

  expect(box.ports(repository, "claim").exitCode).toBe(2);
  expect(box.ports(repository, "claim", "1frontend").exitCode).toBe(2);
  expect(box.ports(repository, "claim", "--size", "abc", "frontend").exitCode).toBe(2);
  expect(box.ports(repository, "claim", "--all", "frontend").stderr).toContain("claim does not accept --all");

  box.claimJson(repository, "frontend", "api");
  expect(box.ports(repository, "release", "frontend").stderr).toContain("release takes no positional arguments");
  expect(box.ports(repository, "release", "--format=json").stderr).toContain("release does not accept --format");
  expect(box.ports(repository, "show", "frontend").stderr).toContain("show takes no positional arguments");
  expect(box.ports(repository, "show", "--format=sh").stderr).toContain("Unknown --format: sh");
  expect(box.ports(repository, "serve", "frontend", "api").stderr).toContain("serve takes exactly one service name");
  expect(box.ports(repository, "serve").stderr).toContain("serve requires exactly one service name");
  expect(box.ports(repository, "unserve", "--size", "10", "frontend").stderr).toContain("unserve does not accept --size");
  expect(box.ports(repository, "release", "--nope").stderr).toContain("Unknown option: --nope");

  // The lease survived every rejected invocation.
  expect(box.claimJson(repository, "frontend").reused).toBe(true);
});

test("shows the machine registry outside Git and answers --help without HOME", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  box.claimJson(repository, "frontend");

  const outside = box.directory("not-a-repo");
  const all = box.ports(outside, "show", "--all", "--format=json");
  expect(all.exitCode).toBe(0);
  const parsed = JSON.parse(all.stdout) as { checkout: unknown; entries: { block: { start: number } }[] };
  expect(parsed.checkout).toBeNull();
  expect(parsed.entries.map((entry) => entry.block.start)).toEqual([20_000]);
  expect(box.ports(outside, "show").exitCode).toBe(2);

  const homeless = { ...box.environment() };
  delete homeless.HOME;
  const helped = Bun.spawnSync([process.execPath, portsCli, "--help"], { cwd: outside, env: homeless, stdout: "pipe", stderr: "pipe" });
  expect(helped.exitCode).toBe(0);
  expect(helped.stdout.toString()).toContain("Usage: slopestyle-ports");

  const homeless2 = { ...box.environment() };
  delete homeless2.HOME;
  const noHome = Bun.spawnSync([process.execPath, portsCli, "show", "--all"], { cwd: outside, env: homeless2, stdout: "pipe", stderr: "pipe" });
  expect(noHome.exitCode).not.toBe(0);
  expect(noHome.stderr.toString()).toContain("HOME is required");
});

test("installs the CLI as a linked executable", () => {
  const box = sandbox();
  const installHome = box.directory("install-home");
  const runtime = resolve(installHome, ".local/share/slopestyle");
  mkdirSync(runtime, { recursive: true });
  cpSync(sourceRoot, runtime, {
    recursive: true,
    filter: (path) => {
      const local = relative(sourceRoot, path);
      return local !== ".git" && !local.startsWith(".git/") && local !== "node_modules" && !local.startsWith("node_modules/");
    },
  });
  git(runtime, "init", "-q", "-b", "main");
  git(runtime, "add", "-A");
  git(runtime, "commit", "-q", "-m", "runtime");
  const environmentForInstall = { ...box.environment(), HOME: installHome };
  const install = Bun.spawnSync([process.execPath, resolve(runtime, "scripts/install.ts")], { env: environmentForInstall, stdout: "pipe", stderr: "pipe" });
  if (install.exitCode !== 0) throw new Error(`install failed:\n${install.stdout.toString()}${install.stderr.toString()}`);

  const link = resolve(installHome, ".local/bin/slopestyle-ports");
  expect(readlinkSync(link)).toBe(resolve(runtime, "scripts/ports.ts"));
  expect(existsSync(link)).toBe(true);
  const help = Bun.spawnSync([link, "--help"], { env: environmentForInstall, stdout: "pipe", stderr: "pipe" });
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).toContain("Usage: slopestyle-ports");

  const check = Bun.spawnSync([process.execPath, resolve(runtime, "scripts/check.ts"), "--installed"], { env: environmentForInstall, stdout: "pipe", stderr: "pipe" });
  if (check.exitCode !== 0) throw new Error(`check --installed failed:\n${check.stdout.toString()}${check.stderr.toString()}`);

  rmSync(link);
  const missing = Bun.spawnSync([process.execPath, resolve(runtime, "scripts/check.ts"), "--installed"], { env: environmentForInstall, stdout: "pipe", stderr: "pipe" });
  expect(missing.exitCode).not.toBe(0);
}, 120_000);

test("labels the Tailscale URL as reserved until serve runs", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  const text = box.ok(repository, "claim", "frontend").stdout;
  expect(text).toContain("frontend: 20000 (reserved https://stub-machine.tail1234.ts.net:20000, live after serve)");
  expect(box.ok(repository, "show").stdout).toContain("(reserved https://stub-machine.tail1234.ts.net:20000, live after serve)");
  expect(box.claimJson(repository, "frontend").services[0].tailscaleUrl).toBe("https://stub-machine.tail1234.ts.net:20000");
});

test("accepts only the exact loopback target Tailscale proxies to", () => {
  expect(isLoopback("127.0.0.1")).toBe(true);
  expect(isLoopback("localhost")).toBe(true);
  expect(isLoopback("127.0.0.2")).toBe(false);
  expect(isLoopback("127.1.2.3")).toBe(false);
  expect(isLoopback("0.0.0.0")).toBe(false);
  expect(isLoopback("[::1]")).toBe(false);
});

test("reads Tailscale route shape, not just the root proxy", () => {
  const exclusive = parseServeStatus(route(20_000, "http://127.0.0.1:20000")).get(20_000)!;
  expect(exclusive.exclusive).toBe(true);
  expect(exclusive.target).toBe("http://127.0.0.1:20000");

  const compound = parseServeStatus({
    TCP: { "20000": { HTTPS: true } },
    Web: { "host:20000": { Handlers: { "/": { Proxy: "http://127.0.0.1:20000" }, "/other": { Proxy: "http://127.0.0.1:9999" } } } },
  }).get(20_000)!;
  expect(compound.exclusive).toBe(false);
  expect(compound.target).toBeNull();
  expect(compound.description).toContain("/other");

  const shared = parseServeStatus({
    TCP: { "20000": { HTTPS: true } },
    Web: {
      "a:20000": { Handlers: { "/": { Proxy: "http://127.0.0.1:20000" } } },
      "b:20000": { Handlers: { "/": { Proxy: "http://127.0.0.1:20000" } } },
    },
  }).get(20_000)!;
  expect(shared.exclusive).toBe(false);
  expect(shared.description).toContain("host entries sharing the port");

  const rawTcp = parseServeStatus({ TCP: { "20000": { TCPForward: "127.0.0.1:20000" } }, Web: {} }).get(20_000)!;
  expect(rawTcp.exclusive).toBe(false);
  expect(rawTcp.description).toBe("a raw TCP route");
});

test("leaves a compound Tailscale port untouched on serve and unserve", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  box.claimJson(repository, "frontend");
  box.setListeners([20_000]);

  // The root handler is exactly what this CLI would create, but another path shares
  // the HTTPS port, so "--https=20000 off" would delete more than this service's route.
  const compound = {
    TCP: { "20000": { HTTPS: true } },
    Web: {
      "stub-machine.tail1234.ts.net:20000": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:20000" }, "/docs": { Proxy: "http://127.0.0.1:9999" } },
      },
    },
  };
  box.setServe(compound);

  const served = box.ports(repository, "serve", "frontend");
  expect(served.exitCode).not.toBe(0);
  expect(served.stderr).toContain("not the exact route for frontend");
  expect(box.serveConfig()).toEqual(compound);

  const removed = box.ports(repository, "unserve", "frontend");
  expect(removed.exitCode).not.toBe(0);
  expect(removed.stderr).toContain("share it");
  expect(box.serveConfig()).toEqual(compound);
});

test("keeps activation owner-scoped while cleanup follows the checkout lease", () => {
  const box = sandbox();
  const shared = box.directory("shared-checkout");
  const elsewhere = box.directory("other-checkout");

  const mine = box.claimJson(shared, "--app", "mine", "frontend");
  // A second app really exists on this machine, so failures cannot come from a missing app.
  box.claimJson(elsewhere, "--app", "theirs", "frontend");

  const port = mine.services[0].port;
  box.setListeners([port]);
  box.ok(shared, "serve", "--app", "mine", "frontend");
  expect(box.serveConfig().Web[`stub-machine.tail1234.ts.net:${port}`]).toBeDefined();

  // Activation remains app-scoped: another app cannot expose this checkout's lease.
  const wrongServe = box.ports(shared, "serve", "--app", "theirs", "frontend");
  expect(wrongServe.exitCode).not.toBe(0);
  expect(wrongServe.stderr).toContain("not for theirs (manual:theirs)");
  expect(box.serveConfig().Web[`stub-machine.tail1234.ts.net:${port}`]).toBeDefined();

  // show and release are checkout-scoped, so the wrong app sees the same lease and is
  // told which app actually owns the block.
  const seenByTheirs = JSON.parse(box.ok(shared, "show", "--app", "theirs", "--format=json").stdout);
  expect(seenByTheirs.entries).toHaveLength(1);
  expect(seenByTheirs.entries[0].block.start).toBe(mine.block.start);
  expect(seenByTheirs.entries[0].app).toEqual({ identity: "manual:mine", name: "mine" });
  expect(box.ok(shared, "show", "--app", "theirs").stdout).toContain("mine (manual:mine)");

  // Checkout scope does not weaken the activity refusal.
  const busy = box.ports(shared, "release", "--app", "theirs");
  expect(busy.exitCode).not.toBe(0);
  expect(busy.stderr).toContain(`Refusing to release block ${mine.block.start}`);

  const stillMine = JSON.parse(box.ok(shared, "show", "--app", "mine", "--format=json").stdout);
  expect(stillMine.entries).toHaveLength(1);
  expect(stillMine.entries[0].block.start).toBe(mine.block.start);

  // Exact teardown follows the checkout lease and its stored owner, so an identity
  // change cannot strand an active route. The block owner does not change.
  box.ok(shared, "unserve", "--app", "theirs", "frontend");
  expect(box.serveConfig().Web[`stub-machine.tail1234.ts.net:${port}`]).toBeUndefined();
  box.setListeners([]);
  // A quiet lease releases under the wrong app, and the block keeps its real owner.
  expect(box.ok(shared, "release", "--app", "theirs").stdout).toContain("It stays owned by mine (manual:mine)");
  expect(box.ok(shared, "show", "--app", "mine").stdout).toContain("holds no port lease");
  // Releasing changed no ownership: the block comes straight back to mine.
  expect(box.claimJson(shared, "--app", "mine", "frontend").block.start).toBe(mine.block.start);
});

test("removes a route and releases after the repository identity changes", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  const worktree = box.worktree(repository, "repo-wt2");
  const leased = box.claimJson(worktree, "frontend").block.start;
  box.setListeners([leased]);
  box.ok(worktree, "serve", "frontend");
  box.setListeners([]); // The backend stopped, but its background Tailscale route remains.

  // Moving the repository changes the common dir, so the worktree now derives a
  // different app identity while its own path, lease, and route stay put.
  const moved = resolve(box.path, "repo-moved");
  renameSync(repository, moved);
  git(moved, "worktree", "repair", worktree);

  const blocked = box.ports(worktree, "claim", "frontend");
  expect(blocked.exitCode).not.toBe(0);
  expect(blocked.stderr).toContain(`already holds block ${leased} for repo`);
  expect(blocked.stderr).toContain('Run "slopestyle-ports release" from this checkout');

  expect(box.ok(worktree, "show").stdout).toContain(`${leased}-${leased + 9}`);
  expect(box.ports(worktree, "release").stderr).toContain("has a Tailscale route");
  expect(box.ok(worktree, "unserve", "frontend").stdout).toContain(`Removed the Tailscale route for port ${leased}`);
  expect(box.ok(worktree, "release").stdout).toContain(`Released block ${leased}`);
  expect(box.claimJson(worktree, "frontend").block.start).not.toBe(leased);
});

test("counts foreground Tailscale sessions as active and never exclusive", () => {
  const foregroundOnly = parseServeStatus({
    TCP: {},
    Web: {},
    Foreground: {
      "sess-abc": {
        TCP: { "20003": { HTTPS: true } },
        Web: { "host:20003": { Handlers: { "/": { Proxy: "http://127.0.0.1:20003" } } } },
      },
    },
  }).get(20_003)!;
  expect(foregroundOnly.exclusive).toBe(false);
  expect(foregroundOnly.target).toBeNull();
  expect(foregroundOnly.description).toBe("a foreground serve session");

  // A port that also looks like this CLI's own exclusive shape is still not removable.
  const overlapping = parseServeStatus({
    ...route(20_000, "http://127.0.0.1:20000"),
    Foreground: { "sess-1": { TCP: { "20000": { HTTPS: true } }, Web: {} } },
  }).get(20_000)!;
  expect(overlapping.exclusive).toBe(false);
  expect(overlapping.target).toBeNull();
  expect(overlapping.description).toContain("background route");

  // A foreground Web entry alone is enough, even with no foreground TCP entry.
  const webOnly = parseServeStatus({
    Foreground: { "sess-2": { Web: { "host:20007": { Handlers: { "/": { Proxy: "http://127.0.0.1:20007" } } } } } },
  });
  expect(webOnly.get(20_007)!.exclusive).toBe(false);
});

test("skips a block carrying a foreground Tailscale session and leaves it untouched", () => {
  const box = sandbox();
  const repository = box.repository("repo");
  const foreground = {
    TCP: {},
    Web: {},
    Foreground: {
      "sess-abc": {
        TCP: { "20003": { HTTPS: true } },
        Web: { "stub-machine.tail1234.ts.net:20003": { Handlers: { "/": { Proxy: "http://127.0.0.1:20003" } } } },
      },
    },
  };
  box.setServe(foreground);
  // 20000-20009 is otherwise free, but the foreground session makes it active.
  expect(box.claimJson(repository, "frontend", "api", "worker", "docs").block.start).toBe(20_010);

  // The foreground session sits on this lease's own docs port, which is the exact
  // target shape this CLI creates, and must still never be torn down.
  const onLease = {
    TCP: {},
    Web: {},
    Foreground: {
      "sess-abc": {
        TCP: { "20013": { HTTPS: true } },
        Web: { "stub-machine.tail1234.ts.net:20013": { Handlers: { "/": { Proxy: "http://127.0.0.1:20013" } } } },
      },
    },
  };
  box.setServe(onLease);
  box.setListeners([20_013]);

  const served = box.ports(repository, "serve", "docs");
  expect(served.exitCode).not.toBe(0);
  expect(served.stderr).toContain("a foreground serve session");
  expect(served.stderr).toContain("not the exact route for docs");
  expect(box.serveConfig()).toEqual(onLease);

  const removed = box.ports(repository, "unserve", "docs");
  expect(removed.exitCode).not.toBe(0);
  expect(removed.stderr).toContain("share it");
  expect(box.serveConfig()).toEqual(onLease);

  // claim and release both refuse while the foreground session is live.
  expect(box.ports(repository, "claim", "docs").stderr).toContain("20013 has a Tailscale route (a foreground serve session)");
  expect(box.ports(repository, "release").stderr).toContain("Refusing to release block 20010");
});

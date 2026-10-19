import { afterAll, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const scratch = mkdtempSync(resolve(tmpdir(), "slopestyle-work-service-"));
const home = resolve(scratch, "home");
const runtime = resolve(home, ".local/share/slopestyle");
const fakeBin = resolve(scratch, "bin");
const log = resolve(scratch, "commands");
const runner = resolve(runtime, "service-test.ts");
const config = resolve(scratch, "private config % $ literal.json");
const pointer = resolve(home, ".local/state/slopestyle/work-service-config-path");
const artifact = process.platform === "darwin"
  ? resolve(home, "Library/LaunchAgents/dev.slopestyle.work.plist")
  : resolve(home, ".config/systemd/user/slopestyle-work.service");
mkdirSync(fakeBin, { recursive: true });
for (const name of ["systemctl", "launchctl"]) {
  const stub = resolve(fakeBin, name);
  writeFileSync(stub, `#!${process.execPath}\nimport {appendFileSync} from "node:fs"; appendFileSync(process.env.SERVICE_TEST_LOG!, JSON.stringify(process.argv.slice(2))+"\\n"); if(process.argv[2]==="print") process.exit(1);\n`);
  chmodSync(stub, 0o755);
}
for (const file of ["core.ts", "service.ts", "user-service.ts", "work/service.ts", "work/config.ts"]) {
  const destination = resolve(runtime, "scripts/lib", file);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(resolve(import.meta.dir, "../scripts/lib", file), destination);
}
writeFileSync(runner, `import {manageService} from "./scripts/lib/work/service.ts"; await manageService(process.argv[2] as any, process.env.HOME!, process.argv[3]);`);
function run(action: string, path?: string) {
  return Bun.spawnSync([process.execPath, runner, action, ...(path ? [path] : [])], {
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, SERVICE_TEST_LOG: log }, stdout: "pipe", stderr: "pipe",
  });
}
function succeeds(action: string, path?: string) {
  const result = run(action, path);
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
}
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("should retain a custom config on refresh and uninstall after the config disappears", () => {
  succeeds("refresh");
  expect(existsSync(artifact)).toBe(false);
  expect(run("install").exitCode).not.toBe(0);
  expect(existsSync(artifact)).toBe(false);
  writeFileSync(config, JSON.stringify({ statePath: resolve(scratch, "state.sqlite"), watcherUrl: "http://127.0.0.1:1234", promptRoot: resolve(scratch, "prompts"), skillRoot: resolve(scratch, "skills") }));
  succeeds("install", config);
  expect(readFileSync(pointer, "utf8")).toBe(config);
  expect(statSync(pointer).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(pointer)).mode & 0o777).toBe(0o700);
  const original = readFileSync(artifact, "utf8");
  expect(original).toContain(process.platform === "darwin" ? config : config.replaceAll("%", "%%").replaceAll("$", () => "$$"));
  succeeds("refresh");
  expect(readFileSync(artifact, "utf8")).toBe(original);
  expect(readFileSync(pointer, "utf8")).toBe(config);
  expect(run("refresh", resolve(scratch, "missing.json")).exitCode).not.toBe(0);
  expect(readFileSync(pointer, "utf8")).toBe(config);
  rmSync(config);
  expect(run("refresh").exitCode).not.toBe(0);
  // The stub deliberately reports unloaded on macOS, but config is never read.
  const beforeStatus = readFileSync(log, "utf8");
  const status = run("status");
  expect(readFileSync(log, "utf8").slice(beforeStatus.length)).toContain(process.platform === "darwin" ? '["print",' : '"status"');
  expect(status.exitCode).toBe(process.platform === "darwin" ? 1 : 0);
  succeeds("uninstall");
  expect(existsSync(artifact)).toBe(false);
  expect(existsSync(pointer)).toBe(false);
  expect(readFileSync(log, "utf8")).toContain(process.platform === "darwin" ? "bootstrap" : "try-restart");
});

test("should refuse to replace an unrelated service file", () => {
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, "unrelated service\n");
  expect(run("uninstall").exitCode).not.toBe(0);
  expect(readFileSync(artifact, "utf8")).toBe("unrelated service\n");
});

test("should keep work and usage port leases distinct and reusable in the same installation", async () => {
  const { workPort } = await import("../scripts/lib/work/port.ts");
  const { usagePort } = await import("../scripts/lib/usage/port.ts");
  const { repoRoot } = await import("../scripts/lib/core.ts");
  const portHome = resolve(scratch, "port-home");
  const portBin = resolve(scratch, "port-bin");
  mkdirSync(portHome, { recursive: true });
  mkdirSync(portBin);
  const routes = resolve(portHome, "routes.json");
  writeFileSync(routes, JSON.stringify({ TCP: {}, Web: {} }));
  for (const name of ["ss", "lsof", "tailscale"]) {
    const stub = resolve(portBin, name);
    writeFileSync(stub, `#!${process.execPath}\nimport { readFileSync } from "node:fs"; if (process.argv[1].endsWith("tailscale")) process.stdout.write(readFileSync(process.env.SLOPESTYLE_WORK_TEST_ROUTES!, "utf8"));\n`);
    chmodSync(stub, 0o755);
  }
  const env = { ...process.env, HOME: portHome, SLOPESTYLE_WORK_TEST_ROUTES: routes, PATH: `${portBin}:${process.env.PATH}` };
  const usage = usagePort({ env });
  const work = workPort({ env });
  expect(work).not.toBe(usage);
  writeFileSync(routes, JSON.stringify({
    TCP: { [usage]: { HTTPS: true }, [work]: { HTTPS: true } },
    Web: Object.fromEntries([usage, work].map((port) => [`service-test.example:${port}`, { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } }])),
  }));
  expect(usagePort({ env })).toBe(usage);
  expect(workPort({ env })).toBe(work);
  const privateDirectory = resolve(portHome, ".local/state/slopestyle/work-port");
  expect(statSync(privateDirectory).mode & 0o777).toBe(0o700);
  const shown = Bun.spawnSync([process.execPath, resolve(repoRoot, "scripts/ports.ts"), "show", "--all", "--format", "json"], {
    cwd: repoRoot, env, stdout: "pipe", stderr: "pipe",
  });
  expect(shown.exitCode).toBe(0);
  const entries = JSON.parse(shown.stdout.toString()).entries as { checkout: { path: string }; services: { name: string; port: number }[] }[];
  expect(entries.find((entry) => entry.services.some((service) => service.name === "usage"))?.checkout.path).toBe(repoRoot);
  expect(entries.find((entry) => entry.services.some((service) => service.name === "work"))?.checkout.path).toBe(realpathSync(privateDirectory));
  const explicit = resolve(portHome, "explicit");
  mkdirSync(explicit);
  expect(workPort({ cwd: explicit, env })).not.toBe(work);
});

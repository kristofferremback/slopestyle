import { afterAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadHosts, resolveHost, selected } from "../scripts/lib/hosts.ts";

const sourceRoot = resolve(import.meta.dir, "..");
const scratch = realpathSync(mkdtempSync(resolve(tmpdir(), "slopestyle-hosts-test.")));
interface Result { exitCode: number; stdout: string; stderr: string }

function execute(command: string[], home: string): Result {
  const result = Bun.spawnSync(command, { env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function succeeds(command: string[], home: string): Result {
  const result = execute(command, home);
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stdout}${result.stderr}`);
  return result;
}

function pin(home: string, host: string): void {
  mkdirSync(resolve(home, ".config/slopestyle"), { recursive: true });
  writeFileSync(resolve(home, ".config/slopestyle/host"), `${host}\n`);
}

function fixture(name: string, host = "kristoffers-macbook-pro"): { home: string; runtime: string } {
  const home = resolve(scratch, name);
  const runtime = resolve(home, ".local/share/slopestyle");
  mkdirSync(runtime, { recursive: true });
  cpSync(sourceRoot, runtime, { recursive: true, filter: (path) => {
    const local = relative(sourceRoot, path);
    return local !== ".git" && !local.startsWith(".git/") && local !== "node_modules" && !local.startsWith("node_modules/");
  } });
  mkdirSync(resolve(runtime, ".git"));
  symlinkSync(resolve(sourceRoot, "node_modules"), resolve(runtime, "node_modules"));
  pin(home, host);
  return { home, runtime };
}

type Registry = { schemaVersion: number; hosts: Record<string, { aliases: string[] }>; skills: Record<string, string[]>; subagents: Record<string, string[]> };
const registry = (root: string): Registry => JSON.parse(readFileSync(resolve(root, "hosts.json"), "utf8"));
const writeRegistry = (runtime: string, value: Registry): void => writeFileSync(resolve(runtime, "hosts.json"), `${JSON.stringify(value, null, 2)}\n`);

function originalDatadog(runtime: string, destination: string): void {
  cpSync(resolve(runtime, "skills/datadog"), destination, { recursive: true });
  rmSync(resolve(destination, "legacy-codex.json"));
  const skill = readFileSync(resolve(destination, "SKILL.md"), "utf8")
    .replace(" Run the example from this skill's directory.", "")
    .replace("python3 scripts/spans.py", "python3 /Users/kristofferremback/.codex/skills/datadog/scripts/spans.py");
  writeFileSync(resolve(destination, "SKILL.md"), skill);
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("should resolve canonical pins and normalized hostnames", () => {
  const home = resolve(scratch, "resolver");
  const config = loadHosts(resolve(sourceRoot, "hosts.json"));
  pin(home, "kristoffers-macbook-pro");
  expect(resolveHost(home, config)).toBe("kristoffers-macbook-pro");
  rmSync(resolve(home, ".config/slopestyle/host"));
  expect(resolveHost(home, config, "Kristoffers-MacBook-Pro.local.")).toBe("kristoffers-macbook-pro");
  expect(resolveHost(home, config, "HOMELAB.")).toBe("homelab");
  expect(selected("datadog", "homelab", config.skills)).toBe(false);
});

test("should install each host and reconcile managed links after a pin change", () => {
  const { home, runtime } = fixture("pin-switch");
  expect(succeeds([resolve(runtime, "scripts/install.ts")], home).stdout).toContain("Selected host: kristoffers-macbook-pro");
  expect(readlinkSync(resolve(home, ".agents/skills/datadog"))).toBe(resolve(runtime, "skills/datadog"));
  expect(succeeds([resolve(runtime, "scripts/check.ts"), "--installed"], home).stdout).toContain("Selected host: kristoffers-macbook-pro");

  writeFileSync(resolve(home, ".agents/skills/unrelated"), "keep\n");
  writeFileSync(resolve(home, ".claude/agents/unrelated.md"), "keep\n");
  pin(home, "homelab");
  expect(succeeds([resolve(runtime, "scripts/install.ts")], home).stdout).toContain("Selected host: homelab");
  for (const root of [".pi/agent/skills", ".claude/skills", ".agents/skills"]) expect(existsSync(resolve(home, root, "datadog"))).toBe(false);
  expect(readFileSync(resolve(home, ".agents/skills/unrelated"), "utf8")).toBe("keep\n");
  expect(readFileSync(resolve(home, ".claude/agents/unrelated.md"), "utf8")).toBe("keep\n");
  succeeds([resolve(runtime, "scripts/check.ts"), "--installed"], home);
});

test("should install and check a fresh host when every subagent is disabled", () => {
  const { home, runtime } = fixture("disabled-subagents", "homelab");
  const config = registry(runtime);
  for (const name of ["fable-high", "fable-medium", "fable-low", "opus-high", "opus-medium", "opus-low"]) config.subagents[name] = [];
  writeRegistry(runtime, config);
  succeeds([resolve(runtime, "scripts/install.ts")], home);
  expect(readdirSync(resolve(home, ".claude/agents"))).toEqual([]);
  succeeds([resolve(runtime, "scripts/check.ts"), "--installed"], home);
});

test("should reject invalid pins and registries before changing links", () => {
  const { home, runtime } = fixture("invalid-input");
  const marker = resolve(home, ".pi/agent/AGENTS.md");
  mkdirSync(resolve(home, ".pi/agent"), { recursive: true });
  writeFileSync(marker, "unchanged\n");
  for (const value of ["", "unknown", "Kristoffers-MacBook-Pro.local"]) {
    pin(home, value);
    const result = execute([resolve(runtime, "scripts/install.ts"), "--replace"], home);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/host pin|Unknown host/);
    expect(readFileSync(marker, "utf8")).toBe("unchanged\n");
  }
  pin(home, "homelab");
  for (const mutate of [
    (value: Registry) => { value.skills.datadog = ["missing-host"]; },
    (value: Registry) => { value.skills["missing-skill"] = ["homelab"]; },
    (value: Registry) => { value.subagents["missing-subagent"] = []; },
    (value: Registry) => { value.hosts.homelab.aliases = ["KRISTOFFERS-MACBOOK-PRO."]; },
  ]) {
    const value = registry(sourceRoot);
    mutate(value);
    writeRegistry(runtime, value);
    expect(execute([resolve(runtime, "scripts/install.ts"), "--replace"], home).exitCode).not.toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("unchanged\n");
  }
  const valid = registry(sourceRoot);
  for (const malformed of [
    { ...valid, skills: [] },
    { ...valid, subagents: [] },
    { ...valid, hosts: [] },
    { ...valid, extra: true },
    { ...valid, hosts: { ...valid.hosts, homelab: { aliases: [], extra: true } } },
  ]) {
    writeFileSync(resolve(runtime, "hosts.json"), JSON.stringify(malformed));
    expect(execute([resolve(runtime, "scripts/install.ts"), "--replace"], home).exitCode).not.toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("unchanged\n");
  }
  const unknownHostRegistry: Registry = {
    schemaVersion: 1,
    hosts: { "unregistered-fixture-node": { aliases: [] } },
    skills: { datadog: [] },
    subagents: {},
  };
  writeRegistry(runtime, unknownHostRegistry);
  rmSync(resolve(home, ".config/slopestyle/host"));
  expect(succeeds([resolve(runtime, "scripts/check.ts")], home).stdout).toContain("Slop(e)style checks passed.");
  expect(execute([resolve(runtime, "scripts/install.ts"), "--replace"], home).stderr).toContain("Unknown host");
  expect(readFileSync(marker, "utf8")).toBe("unchanged\n");
});

test("should scope preflight conflicts to entries enabled for the host", () => {
  const { home, runtime } = fixture("preflight", "homelab");
  mkdirSync(resolve(home, ".agents/skills/datadog"), { recursive: true });
  writeFileSync(resolve(home, ".agents/skills/datadog/local"), "foreign\n");
  succeeds([resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime], home);
  pin(home, "kristoffers-macbook-pro");
  expect(execute([resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime], home).exitCode).not.toBe(0);
  rmSync(resolve(home, ".agents/skills/datadog"), { recursive: true });
  mkdirSync(resolve(home, ".agents/skills/why"), { recursive: true });
  writeFileSync(resolve(home, ".agents/skills/why/local"), "foreign\n");
  pin(home, "homelab");
  expect(execute([resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime], home).exitCode).not.toBe(0);
});

test("should migrate only the exact legacy Datadog inventory", () => {
  const exact = fixture("legacy-exact");
  originalDatadog(exact.runtime, resolve(exact.home, ".codex/skills/datadog"));
  expect(execute([resolve(exact.runtime, "scripts/check.ts"), "--installed"], exact.home).stderr).toContain("Legacy Datadog skill remains");
  succeeds([resolve(exact.runtime, "scripts/install.ts"), "--preflight-for", exact.runtime], exact.home);
  const conflict = resolve(exact.home, ".agents/skills/datadog");
  mkdirSync(conflict, { recursive: true });
  writeFileSync(resolve(conflict, "local"), "foreign\n");
  expect(execute([resolve(exact.runtime, "scripts/install.ts")], exact.home).exitCode).not.toBe(0);
  expect(existsSync(resolve(exact.home, ".codex/skills/datadog/SKILL.md"))).toBe(true);
  expect(existsSync(resolve(exact.home, ".slopestyle/backups"))).toBe(false);
  rmSync(conflict, { recursive: true });
  expect(succeeds([resolve(exact.runtime, "scripts/install.ts")], exact.home).stdout).toContain("Backed up the exact legacy Datadog skill");
  expect(readlinkSync(resolve(exact.home, ".agents/skills/datadog"))).toBe(resolve(exact.runtime, "skills/datadog"));
  const backups = readdirSync(resolve(exact.home, ".slopestyle/backups"), { recursive: true }).filter((path) => typeof path === "string" && path.endsWith(".codex/skills/datadog/SKILL.md"));
  expect(backups).toHaveLength(1);
  succeeds([resolve(exact.runtime, "scripts/check.ts"), "--installed"], exact.home);

  const excluded = fixture("legacy-excluded", "homelab");
  originalDatadog(excluded.runtime, resolve(excluded.home, ".codex/skills/datadog"));
  succeeds([resolve(excluded.runtime, "scripts/install.ts")], excluded.home);
  expect(existsSync(resolve(excluded.home, ".codex/skills/datadog"))).toBe(false);
  expect(existsSync(resolve(excluded.home, ".agents/skills/datadog"))).toBe(false);
  succeeds([resolve(excluded.runtime, "scripts/check.ts"), "--installed"], excluded.home);

  for (const variant of ["changed", "extra", "empty-directory", "symlink"] as const) {
    const current = fixture(`legacy-${variant}`, variant === "extra" ? "homelab" : "kristoffers-macbook-pro");
    const legacy = resolve(current.home, ".codex/skills/datadog");
    originalDatadog(current.runtime, legacy);
    if (variant === "changed") writeFileSync(resolve(legacy, "SKILL.md"), "changed\n");
    if (variant === "extra") writeFileSync(resolve(legacy, "extra"), "unexpected\n");
    if (variant === "empty-directory") mkdirSync(resolve(legacy, "extra"));
    if (variant === "symlink") symlinkSync("SKILL.md", resolve(legacy, "extra-link"));
    const marker = resolve(current.home, ".pi/agent/AGENTS.md");
    mkdirSync(resolve(current.home, ".pi/agent"), { recursive: true });
    writeFileSync(marker, "unchanged\n");
    const rejected = execute([resolve(current.runtime, "scripts/install.ts"), "--replace"], current.home);
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr).toContain("changed or contains unexpected entries");
    expect(readFileSync(marker, "utf8")).toBe("unchanged\n");
    expect(existsSync(resolve(current.home, ".slopestyle/backups"))).toBe(false);
  }
}, 120_000);

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { HostRegistry } from "../scripts/lib/hosts.ts";
import { copySource, sourceRoot, stripEncryptedSlots } from "./lib/source.ts";

const scratch = realpathSync(mkdtempSync(resolve(tmpdir(), "slopestyle-guidance-test.")));
interface Result { exitCode: number; stdout: string; stderr: string }

// Only the key a test passes reaches sops; HOME isolates its default key location.
function execute(command: string[], home: string, env: Record<string, string> = {}, options: { cwd?: string; stdin?: string } = {}): Result {
  const inherited = Object.entries(process.env).filter(([name]) => !name.startsWith("SOPS_") && name !== "XDG_CONFIG_HOME" && name !== "HERMES_HOME");
  const environment = { ...Object.fromEntries(inherited), HOME: home, ...env };
  const stdin = options.stdin === undefined ? "ignore" : Buffer.from(options.stdin);
  const result = Bun.spawnSync(command, { env: environment, cwd: options.cwd, stdin, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function succeeds(command: string[], home: string, env: Record<string, string> = {}, options: { cwd?: string; stdin?: string } = {}): Result {
  const result = execute(command, home, env, options);
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stdout}${result.stderr}`);
  return result;
}

function pin(home: string, host: string): void {
  mkdirSync(resolve(home, ".config/slopestyle"), { recursive: true });
  writeFileSync(resolve(home, ".config/slopestyle/host"), `${host}\n`);
}

function checkout(root: string): string {
  mkdirSync(root, { recursive: true });
  copySource(root);
  mkdirSync(resolve(root, ".git"));
  symlinkSync(resolve(sourceRoot, "node_modules"), resolve(root, "node_modules"));
  return root;
}

function fixture(name: string, host = "kristoffer-mbp-galdera"): { home: string; runtime: string } {
  const home = resolve(scratch, name);
  const runtime = checkout(resolve(home, ".local/share/slopestyle"));
  pin(home, host);
  return { home, runtime };
}

const guidance = (home: string): string => resolve(home, ".local/state/slopestyle/guidance");
const installed = (home: string): string => readFileSync(resolve(home, ".claude/AGENTS.md"), "utf8");
const install = (runtime: string, home: string): Result => succeeds([resolve(runtime, "scripts/install.ts")], home);
const check = (runtime: string, home: string): Result => execute([resolve(runtime, "scripts/check.ts"), "--installed"], home);
const appendMarker = (root: string, name: string): void => writeFileSync(resolve(root, "agents/AGENTS.md"), `${readFileSync(resolve(root, "agents/AGENTS.md"), "utf8")}\n<!-- slot: ${name} -->\n`);

function editHosts(root: string, change: (value: HostRegistry) => void): void {
  const value = JSON.parse(readFileSync(resolve(root, "hosts.json"), "utf8")) as HostRegistry;
  change(value);
  writeFileSync(resolve(root, "hosts.json"), `${JSON.stringify(value, null, 2)}\n`);
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("should render host-selected slots into the installed guidance", () => {
  const { home, runtime } = fixture("render");
  // An existing install links straight into the runtime's agents/ and migrates without --replace.
  mkdirSync(resolve(home, ".claude"), { recursive: true });
  symlinkSync(resolve(runtime, "agents/AGENTS.md"), resolve(home, ".claude/AGENTS.md"));
  symlinkSync(resolve(runtime, "agents/CLAUDE.md"), resolve(home, ".claude/CLAUDE.md"));
  succeeds([resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime], home);

  install(runtime, home);
  for (const target of [".pi/agent/AGENTS.md", ".claude/AGENTS.md", ".codex/AGENTS.md"]) {
    expect(readlinkSync(resolve(home, target))).toBe(resolve(guidance(home), "AGENTS.md"));
  }
  expect(readlinkSync(resolve(home, ".claude/CLAUDE.md"))).toBe(resolve(guidance(home), "CLAUDE.md"));
  expect(readFileSync(resolve(guidance(home), "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  expect(statSync(guidance(home)).mode & 0o777).toBe(0o700);
  expect(statSync(resolve(guidance(home), "AGENTS.md")).mode & 0o777).toBe(0o600);
  const source = readFileSync(resolve(runtime, "agents/AGENTS.md"), "utf8");
  const threa = readFileSync(resolve(runtime, "agents/slots/threa-access.md"), "utf8").trim();
  const marker = "<!-- slot: threa-access -->";
  expect(installed(home)).toBe(`${source.replace(marker, "").trimEnd()}\n`);
  expect(check(runtime, home).exitCode).toBe(0);

  pin(home, "homelab");
  expect(check(runtime, home).stderr).toContain("Stale rendered guidance");
  install(runtime, home);
  expect(readFileSync(resolve(home, ".codex/AGENTS.md"), "utf8")).toBe(`${source.replace(marker, threa).trimEnd()}\n`);
  expect(check(runtime, home).exitCode).toBe(0);

  writeFileSync(resolve(guidance(home), "AGENTS.md"), "stale\n");
  expect(check(runtime, home).stderr).toContain("Stale rendered guidance");
  install(runtime, home);
  expect(check(runtime, home).exitCode).toBe(0);
});

test("should place mid-document slots and drop omitted ones with their spacing", () => {
  const { home, runtime } = fixture("placement");
  writeFileSync(resolve(runtime, "agents/AGENTS.md"), "# Top\n\n<!-- slot: kept -->\n\n<!-- slot: dropped -->\n\n<!-- slot: disabled -->\n\n## Bottom\n");
  writeFileSync(resolve(runtime, "agents/slots/kept.md"), "## Kept\n\nShared.\n\n");
  writeFileSync(resolve(runtime, "agents/slots/dropped.md"), "## Dropped\n");
  writeFileSync(resolve(runtime, "agents/slots/disabled.md"), "## Disabled\n");
  writeFileSync(resolve(runtime, "agents/slots/.DS_Store"), "ignored");
  rmSync(resolve(runtime, "agents/slots/threa-access.md"));
  editHosts(runtime, (value) => { value.slots = { dropped: ["homelab"], disabled: [] }; });
  install(runtime, home);
  expect(installed(home)).toBe("# Top\n\n## Kept\n\nShared.\n\n## Bottom\n");
  pin(home, "homelab");
  install(runtime, home);
  expect(installed(home)).toBe("# Top\n\n## Kept\n\nShared.\n\n## Dropped\n\n## Bottom\n");
});

test("should reject slots that markers, files, and hosts.json disagree on", () => {
  const home = resolve(scratch, "mismatch");
  const runtime = resolve(home, ".local/share/slopestyle");
  pin(home, "homelab");
  const agents = resolve(runtime, "agents/AGENTS.md");
  const original = readFileSync(resolve(sourceRoot, "agents/AGENTS.md"), "utf8");
  const mutations: Array<[() => void, string]> = [
    [() => writeFileSync(agents, `${original}\n<!-- slot: missing -->\n`), "Slot marker missing has no file"],
    [() => writeFileSync(agents, `${original}\n<!-- slot: threa-access -->\n`), "repeats a slot marker"],
    [() => writeFileSync(agents, `${original}\n<!-- slot: Threa -->\n`), "Malformed slot marker"],
    [() => writeFileSync(agents, original.replace("<!-- slot: threa-access -->", "Text\n<!-- slot: threa-access -->")), "needs a blank line above and below"],
    [() => writeFileSync(resolve(runtime, "agents/slots/orphan.md"), "## Orphan\n"), "orphan has no marker"],
    [() => writeFileSync(resolve(runtime, "agents/slots/threa-access.sops.md"), "x"), "both a plaintext and an encrypted file"],
    [() => writeFileSync(resolve(runtime, "agents/slots/Bad_Name.md"), "x"), "Invalid slot file name"],
    [() => editHosts(runtime, (value) => { value.slots.unknown = []; }), "Unknown slot in hosts.json"],
    [() => {
      appendMarker(runtime, "secret");
      writeFileSync(resolve(runtime, "agents/slots/secret.sops.md"), "## Plaintext under an encrypted name\n");
    }, "secret.sops.md is not SOPS-encrypted"],
  ];
  for (const [mutate, message] of mutations) {
    rmSync(runtime, { recursive: true, force: true });
    checkout(runtime);
    mutate();
    for (const command of [[resolve(runtime, "scripts/check.ts")], [resolve(runtime, "scripts/install.ts")]]) {
      const result = execute(command, home);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(message);
    }
    expect(existsSync(resolve(home, ".claude/AGENTS.md"))).toBe(false);
  }
});

test("should decrypt encrypted slots with sops only on selected hosts", () => {
  const { home, runtime } = fixture("encrypted");
  for (const tool of ["sops", "age-keygen"]) expect(Bun.which(tool), `${tool} must be installed to test encrypted slots`).not.toBeNull();
  const key = resolve(scratch, "shared-age-key.txt");
  succeeds(["age-keygen", "-o", key], scratch);
  const recipient = succeeds(["age-keygen", "-y", key], scratch).stdout.trim();
  writeFileSync(resolve(runtime, ".sops.yaml"), `creation_rules:\n  - path_regex: ^agents/slots/[^/]+\\.sops\\.md$\n    age: ${recipient}\n`);
  const withKey = { SOPS_AGE_KEY_FILE: key };

  // The documented commands: plaintext only ever travels through stdin and stdout.
  const slot = "agents/slots/work.sops.md";
  const encrypt = (plaintext: string): void => {
    succeeds(["sops", "encrypt", "--filename-override", slot, "--output", slot, "/dev/stdin"], home, {}, { cwd: runtime, stdin: plaintext });
  };
  encrypt("## Work\n\nSecret work guidance.\n");
  appendMarker(runtime, "work");
  editHosts(runtime, (value) => { value.slots.work = ["homelab"]; });
  expect(readFileSync(resolve(runtime, slot), "utf8")).not.toContain("Secret");
  // Validation needs no key, so CI catches committed plaintext.
  succeeds([resolve(runtime, "scripts/check.ts")], home);

  // The unselected laptop renders without the key and never sees the slot.
  install(runtime, home);
  const laptop = installed(home);
  expect(laptop).not.toContain("Secret work guidance");
  expect(check(runtime, home).exitCode).toBe(0);

  // A selected host without the key fails install and preflight before its guidance changes.
  pin(home, "homelab");
  for (const command of [[resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime], [resolve(runtime, "scripts/install.ts")]]) {
    expect(execute(command, home).stderr).toContain("sops could not decrypt slot work");
  }
  expect(installed(home)).toBe(laptop);

  // Without sops on PATH the failure names the missing tool.
  const bunOnly = resolve(scratch, "bun-only");
  mkdirSync(bunOnly);
  symlinkSync(process.execPath, resolve(bunOnly, "bun"));
  expect(execute([resolve(runtime, "scripts/install.ts")], home, { ...withKey, PATH: bunOnly }).stderr).toContain("Install sops to render encrypted slot work");

  succeeds([resolve(runtime, "scripts/install.ts")], home, withKey);
  expect(installed(home)).toContain("## Work\n\nSecret work guidance.\n");
  expect(execute([resolve(runtime, "scripts/check.ts"), "--installed"], home, withKey).exitCode).toBe(0);

  // Editing is a decrypt, change, and encrypt round trip; check --installed then flags the stale render.
  const current = succeeds(["sops", "decrypt", slot], home, withKey, { cwd: runtime }).stdout;
  encrypt(current.replace("Secret work guidance.", "Edited work guidance."));
  expect(execute([resolve(runtime, "scripts/check.ts"), "--installed"], home, withKey).stderr).toContain("Stale rendered guidance");
  succeeds([resolve(runtime, "scripts/install.ts")], home, withKey);
  expect(installed(home)).toContain("Edited work guidance.");

  // Test fixtures copied from a source with encrypted slots drop them with their markers and registry entries.
  stripEncryptedSlots(runtime);
  expect(existsSync(resolve(runtime, slot))).toBe(false);
  expect(readFileSync(resolve(runtime, "agents/AGENTS.md"), "utf8")).not.toContain("<!-- slot: work -->");
  expect(JSON.parse(readFileSync(resolve(runtime, "hosts.json"), "utf8")).slots.work).toBeUndefined();
  succeeds([resolve(runtime, "scripts/check.ts")], home);
});

import { afterAll, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { HostRegistry } from "../scripts/lib/hosts.ts";
import { copySource, sourceRoot, stripEncryptedSlots } from "./lib/source.ts";

const scratch = realpathSync(mkdtempSync(resolve(tmpdir(), "slopestyle-guidance-test.")));
interface Result { exitCode: number; stdout: string; stderr: string }

function execute(command: string[], home: string, env: Record<string, string> = {}): Result {
  const environment: Record<string, string | undefined> = { ...process.env, HOME: home, VISUAL: "", ...env };
  delete environment.HERMES_HOME;
  const result = Bun.spawnSync(command, { env: environment, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function succeeds(command: string[], home: string, env: Record<string, string> = {}): Result {
  const result = execute(command, home, env);
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

function writeEditor(name: string, content: string, exitCode = 0): string {
  const path = resolve(scratch, `${name}.sh`);
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${content}' > "$1"\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

function keygen(slots: string, home: string): string {
  const recipient = succeeds([slots, "keygen"], home).stdout.match(/"ageRecipient": "(age1[0-9a-z]+)"/)?.[1];
  expect(recipient).toBeDefined();
  return recipient!;
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
  const laptop = installed(home);
  expect(laptop).toContain("## Guidance ownership");
  expect(laptop).not.toContain("Threa access");
  expect(laptop).not.toContain("<!-- slot:");
  expect(laptop.endsWith("same level.\n")).toBe(true);
  expect(check(runtime, home).exitCode).toBe(0);

  pin(home, "homelab");
  expect(check(runtime, home).exitCode).not.toBe(0);
  install(runtime, home);
  const homelab = readFileSync(resolve(home, ".codex/AGENTS.md"), "utf8");
  expect(homelab).toContain("## Threa access\n\nRead-only Threa credentials");
  expect(homelab).not.toContain("<!-- slot:");
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
  const encryptedSecret = (content: string): void => {
    appendMarker(runtime, "secret");
    writeFileSync(resolve(runtime, "agents/slots/secret.md.age"), content);
  };
  const mutations: Array<[() => void, string]> = [
    [() => writeFileSync(agents, `${original}\n<!-- slot: missing -->\n`), "Slot marker missing has no file"],
    [() => writeFileSync(agents, `${original}\n<!-- slot: threa-access -->\n`), "repeats a slot marker"],
    [() => writeFileSync(agents, `${original}\n<!-- slot: Threa -->\n`), "Malformed slot marker"],
    [() => writeFileSync(resolve(runtime, "agents/slots/orphan.md"), "## Orphan\n"), "orphan has no marker"],
    [() => writeFileSync(resolve(runtime, "agents/slots/threa-access.md.age"), "x"), "both a plaintext and an encrypted file"],
    [() => writeFileSync(resolve(runtime, "agents/slots/Bad_Name.md"), "x"), "Invalid slot file name"],
    [() => editHosts(runtime, (value) => { value.slots.unknown = []; }), "Unknown slot in hosts.json"],
    [() => encryptedSecret("-----BEGIN AGE ENCRYPTED FILE-----\n"), "has no ageRecipient"],
    [() => {
      encryptedSecret("not armored");
      editHosts(runtime, (value) => { value.slots.secret = ["homelab"]; value.hosts.homelab!.ageRecipient = "age1example"; });
    }, "not an armored age file"],
    [() => editHosts(runtime, (value) => { value.hosts.homelab!.ageRecipient = "AGE1X"; }), "Invalid ageRecipient"],
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

test("should edit encrypted slots without leaking plaintext or losing input", () => {
  const home = resolve(scratch, "editing");
  const developer = checkout(resolve(scratch, "editing-dev"));
  const slots = resolve(developer, "scripts/slots.ts");
  const recipient = keygen(slots, home);
  expect(statSync(resolve(home, ".config/slopestyle/age.key")).mode & 0o777).toBe(0o600);
  expect(execute([slots, "keygen"], home).exitCode).not.toBe(0);
  expect(succeeds([slots, "recipient"], home).stdout.trim()).toBe(recipient);

  // Recipients resolve before the editor opens, so nothing typed is lost.
  editHosts(developer, (value) => { value.slots.work = ["homelab"]; });
  const opened = resolve(scratch, "editor-opened");
  const probe = resolve(scratch, "probe.sh");
  writeFileSync(probe, `#!/bin/sh\ntouch ${opened}\n`);
  chmodSync(probe, 0o755);
  expect(execute([slots, "edit", "work"], home, { EDITOR: probe }).stderr).toContain("has no ageRecipient");
  expect(existsSync(opened)).toBe(false);

  // A failing editor leaves neither a slot nor its plaintext behind.
  editHosts(developer, (value) => { value.hosts.homelab!.ageRecipient = recipient; });
  const temporary = resolve(scratch, "editing-tmp");
  mkdirSync(temporary);
  const failed = execute([slots, "edit", "work"], home, { EDITOR: writeEditor("failing", "Typed then aborted", 1), TMPDIR: temporary });
  expect(failed.exitCode).not.toBe(0);
  expect(failed.stderr).toContain("slot unchanged");
  expect(readdirSync(temporary)).toEqual([]);
  expect(existsSync(resolve(developer, "agents/slots/work.md.age"))).toBe(false);

  expect(succeeds([slots, "edit", "work"], home, { EDITOR: writeEditor("writing", "## Work\n\nSecret work guidance.\n") }).stdout).toContain("<!-- slot: work -->");
  const ciphertext = readFileSync(resolve(developer, "agents/slots/work.md.age"), "utf8");
  expect(ciphertext).toStartWith("-----BEGIN AGE ENCRYPTED FILE-----");
  expect(ciphertext).not.toContain("Secret");
  expect(succeeds([slots, "edit", "work"], home, { EDITOR: "true" }).stdout).toContain("No changes.");
  expect(readFileSync(resolve(developer, "agents/slots/work.md.age"), "utf8")).toBe(ciphertext);

  succeeds([slots, "encrypt", "threa-access"], home);
  expect(existsSync(resolve(developer, "agents/slots/threa-access.md"))).toBe(false);
  expect(readFileSync(resolve(developer, "agents/slots/threa-access.md.age"), "utf8")).toStartWith("-----BEGIN AGE ENCRYPTED FILE-----");

  const { home: runtimeHome, runtime } = fixture("editing-runtime");
  expect(execute([resolve(runtime, "scripts/slots.ts"), "reencrypt", "work"], runtimeHome).stderr).toContain("development checkout");
});

test("should decrypt slots only on selected hosts holding their identity", () => {
  const { home: laptopHome, runtime } = fixture("decrypt-laptop");
  const homelabHome = resolve(scratch, "decrypt-homelab");
  pin(homelabHome, "homelab");
  const developer = checkout(resolve(scratch, "decrypt-dev"));
  const slots = resolve(developer, "scripts/slots.ts");
  const homelab = keygen(slots, homelabHome);
  const laptop = keygen(slots, laptopHome);
  editHosts(developer, (value) => {
    value.hosts.homelab!.ageRecipient = homelab;
    value.hosts["kristoffer-mbp-galdera"]!.ageRecipient = laptop;
    value.slots.work = ["homelab"];
  });
  appendMarker(developer, "work");
  succeeds([slots, "edit", "work"], homelabHome, { EDITOR: writeEditor("decrypt", "## Work\n\nSecret work guidance.\n") });
  const publish = (): void => {
    for (const file of ["hosts.json", "agents/AGENTS.md", "agents/slots/work.md.age"]) cpSync(resolve(developer, file), resolve(runtime, file));
  };
  publish();

  // The unselected laptop never decrypts, although its identity could not read the slot.
  install(runtime, laptopHome);
  expect(installed(laptopHome)).not.toContain("Secret work guidance");

  // Selecting the laptop without re-encrypting fails before its guidance changes.
  editHosts(runtime, (value) => { value.slots.work = ["homelab", "kristoffer-mbp-galdera"]; });
  const before = installed(laptopHome);
  const stale = execute([resolve(runtime, "scripts/install.ts")], laptopHome);
  expect(stale.stderr).toContain("Cannot decrypt slot work");
  expect(stale.stderr).toContain("reencrypt work");
  expect(installed(laptopHome)).toBe(before);

  editHosts(developer, (value) => { value.slots.work = ["homelab", "kristoffer-mbp-galdera"]; });
  succeeds([slots, "reencrypt", "work"], homelabHome);
  publish();
  install(runtime, laptopHome);
  expect(installed(laptopHome)).toContain("## Work\n\nSecret work guidance.");
  expect(check(runtime, laptopHome).exitCode).toBe(0);

  // A selected host without its identity fails install and preflight before guidance changes.
  rmSync(resolve(laptopHome, ".config/slopestyle/age.key"));
  const rendered = installed(laptopHome);
  expect(execute([resolve(runtime, "scripts/install.ts")], laptopHome).stderr).toContain("Missing age identity");
  expect(execute([resolve(runtime, "scripts/install.ts"), "--preflight-for", runtime], laptopHome).stderr).toContain("Missing age identity");
  expect(installed(laptopHome)).toBe(rendered);

  // Test fixtures copied from a source with encrypted slots drop them with their markers and registry entries.
  stripEncryptedSlots(developer);
  expect(existsSync(resolve(developer, "agents/slots/work.md.age"))).toBe(false);
  expect(readFileSync(resolve(developer, "agents/AGENTS.md"), "utf8")).not.toContain("<!-- slot: work -->");
  succeeds([resolve(developer, "scripts/check.ts")], laptopHome);
});

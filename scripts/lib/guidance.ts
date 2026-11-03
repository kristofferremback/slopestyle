import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assert, repoRoot, stateRoot, writeAtomic } from "./core.ts";
import { selected, type HostRegistry } from "./hosts.ts";

const slotName = "[a-z0-9]+(?:-[a-z0-9]+)*";
// A slot marker is a whole line in agents/AGENTS.md naming one file in agents/slots/.
const markerPattern = new RegExp(`^<!-- slot: (${slotName}) -->$`);
const slotFilePattern = new RegExp(`^(${slotName})(\\.sops)?\\.md$`);

interface Slot {
  name: string;
  path: string;
  encrypted: boolean;
}

export interface GuidanceFiles {
  agents: string;
  claude: string;
}

type GuidanceLine = { text: string } | { slot: string };

export function guidanceRoot(home: string): string {
  return resolve(stateRoot(home), "guidance");
}

export function guidanceFiles(home: string): GuidanceFiles {
  const root = guidanceRoot(home);
  return { agents: resolve(root, "AGENTS.md"), claude: resolve(root, "CLAUDE.md") };
}

function parseGuidance(): GuidanceLine[] {
  return readFileSync(resolve(repoRoot, "agents/AGENTS.md"), "utf8").split("\n").map((text) => {
    const slot = text.match(markerPattern)?.[1];
    if (slot !== undefined) return { slot };
    assert(!text.includes("<!-- slot:"), `Malformed slot marker in agents/AGENTS.md: ${JSON.stringify(text)}`);
    return { text };
  });
}

function loadSlots(): Map<string, Slot> {
  const directory = resolve(repoRoot, "agents/slots");
  const slots = new Map<string, Slot>();
  if (!existsSync(directory)) return slots;
  for (const file of readdirSync(directory)) {
    if (file.startsWith(".")) continue;
    const match = file.match(slotFilePattern);
    assert(match, `Invalid slot file name: agents/slots/${file}`);
    const name = match[1]!;
    assert(!slots.has(name), `Slot ${name} has both a plaintext and an encrypted file`);
    slots.set(name, { name, path: resolve(directory, file), encrypted: match[2] !== undefined });
  }
  return slots;
}

// SOPS stores Markdown as a JSON envelope, so plaintext committed under a .sops.md name fails without the key.
function isSopsEnvelope(content: string): boolean {
  try {
    const envelope = JSON.parse(content) as { data?: unknown; sops?: unknown } | null;
    return typeof envelope?.data === "string" && envelope.data.startsWith("ENC[") && typeof envelope.sops === "object" && envelope.sops !== null;
  } catch {
    return false;
  }
}

function validateSlots(registry: HostRegistry, lines: GuidanceLine[]): Map<string, Slot> {
  const slots = loadSlots();
  const markers = lines.flatMap((line) => ("slot" in line ? [line.slot] : []));
  for (const [index, line] of lines.entries()) {
    if (!("slot" in line)) continue;
    const isolated = [lines[index - 1], lines[index + 1]].every((neighbor) => neighbor === undefined || ("text" in neighbor && neighbor.text === ""));
    assert(isolated, `Slot marker ${line.slot} needs a blank line above and below it in agents/AGENTS.md`);
  }
  const marked = new Set(markers);
  assert(marked.size === markers.length, "agents/AGENTS.md repeats a slot marker");
  for (const name of markers) assert(slots.has(name), `Slot marker ${name} has no file in agents/slots/`);
  for (const name of slots.keys()) assert(marked.has(name), `agents/slots/ file for ${name} has no marker in agents/AGENTS.md`);
  for (const name of Object.keys(registry.slots)) assert(slots.has(name), `Unknown slot in hosts.json: ${name}`);
  for (const slot of slots.values()) {
    if (slot.encrypted) assert(isSopsEnvelope(readFileSync(slot.path, "utf8")), `agents/slots/${slot.name}.sops.md is not SOPS-encrypted`);
  }
  return slots;
}

export function checkSlots(registry: HostRegistry): void {
  validateSlots(registry, parseGuidance());
}

// sops finds the shared age key through SOPS_AGE_KEY_FILE or its own default location.
function readSlot(slot: Slot): string {
  if (!slot.encrypted) return readFileSync(slot.path, "utf8");
  assert(Bun.which("sops"), `Install sops to render encrypted slot ${slot.name}.`);
  const result = Bun.spawnSync(["sops", "decrypt", slot.path], { stdout: "pipe", stderr: "pipe" });
  assert(result.exitCode === 0, `sops could not decrypt slot ${slot.name}:\n${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

export function renderGuidance(host: string, registry: HostRegistry): GuidanceFiles {
  const lines = parseGuidance();
  const slots = validateSlots(registry, lines);
  const output: string[] = [];
  // An omitted slot takes its following blank line with it.
  let omitted = false;
  for (const line of lines) {
    if ("slot" in line) {
      omitted = !selected(line.slot, host, registry.slots);
      if (!omitted) output.push(readSlot(slots.get(line.slot)!).trim());
      continue;
    }
    if (!(omitted && line.text === "")) output.push(line.text);
    omitted = false;
  }
  return {
    agents: `${output.join("\n").trimEnd()}\n`,
    claude: readFileSync(resolve(repoRoot, "agents/CLAUDE.md"), "utf8"),
  };
}

export function assertGuidanceCurrent(host: string, registry: HostRegistry, home: string): void {
  const rendered = renderGuidance(host, registry);
  const files = guidanceFiles(home);
  for (const file of ["agents", "claude"] as const) {
    assert(existsSync(files[file]) && readFileSync(files[file], "utf8") === rendered[file], `Stale rendered guidance: ${files[file]}`);
  }
}

export function writeGuidance(home: string, rendered: GuidanceFiles): void {
  const root = guidanceRoot(home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const files = guidanceFiles(home);
  writeAtomic(files.agents, rendered.agents, 0o600);
  writeAtomic(files.claude, rendered.claude, 0o600);
}

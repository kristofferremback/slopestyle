import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { assert, repoRoot, stateRoot, writeAtomic } from "./core.ts";
import { selected, type HostRegistry } from "./hosts.ts";

const slotName = "[a-z0-9]+(?:-[a-z0-9]+)*";
// A slot marker is a whole line in agents/AGENTS.md naming one file in agents/slots/.
const markerPattern = new RegExp(`^<!-- slot: (${slotName}) -->$`);
const slotFilePattern = new RegExp(`^(${slotName})\\.md(\\.age)?$`);
const armorHeader = "-----BEGIN AGE ENCRYPTED FILE-----";

export const isSlotName = (value: string): boolean => new RegExp(`^${slotName}$`).test(value);

export interface Slot {
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

export function slotFile(name: string, encrypted: boolean, root = repoRoot): string {
  return resolve(root, "agents/slots", `${name}.md${encrypted ? ".age" : ""}`);
}

function parseGuidance(root: string): GuidanceLine[] {
  return readFileSync(resolve(root, "agents/AGENTS.md"), "utf8").split("\n").map((text) => {
    const slot = text.match(markerPattern)?.[1];
    if (slot !== undefined) return { slot };
    assert(!text.includes("<!-- slot:"), `Malformed slot marker in agents/AGENTS.md: ${JSON.stringify(text)}`);
    return { text };
  });
}

export function loadSlots(root = repoRoot): Map<string, Slot> {
  const directory = resolve(root, "agents/slots");
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

// An encrypted slot is readable by the hosts hosts.json selects for it and by every backup recipient.
export function slotRecipients(name: string, registry: HostRegistry): string[] {
  const recipients = Object.entries(registry.hosts)
    .filter(([id]) => selected(name, id, registry.slots))
    .map(([id, host]) => {
      assert(host.ageRecipient, `Host ${id} receives slot ${name} but has no ageRecipient in hosts.json`);
      return host.ageRecipient;
    });
  assert(recipients.length > 0, `Slot ${name} is disabled on every host; nothing would render it`);
  return [...recipients, ...registry.backupRecipients];
}

function validateSlots(registry: HostRegistry, root: string, lines: GuidanceLine[]): Map<string, Slot> {
  const slots = loadSlots(root);
  const markers = lines.flatMap((line) => ("slot" in line ? [line.slot] : []));
  const marked = new Set(markers);
  assert(marked.size === markers.length, "agents/AGENTS.md repeats a slot marker");
  for (const name of markers) assert(slots.has(name), `Slot marker ${name} has no file in agents/slots/`);
  for (const name of slots.keys()) assert(marked.has(name), `agents/slots/ file for ${name} has no marker in agents/AGENTS.md`);
  for (const name of Object.keys(registry.slots)) assert(slots.has(name), `Unknown slot in hosts.json: ${name}`);
  for (const slot of slots.values()) {
    if (!slot.encrypted) continue;
    slotRecipients(slot.name, registry);
    assert(readFileSync(slot.path, "utf8").startsWith(armorHeader), `Encrypted slot ${slot.name} is not an armored age file`);
  }
  return slots;
}

export function checkSlots(registry: HostRegistry, root = repoRoot): void {
  validateSlots(registry, root, parseGuidance(root));
}

export function identityPath(home: string): string {
  return resolve(home, ".config/slopestyle/age.key");
}

// The file uses the age CLI identity format, so `age -d -i` reads it too.
export function readIdentity(path: string): string {
  assert(existsSync(path), `Missing age identity ${path}. Each host creates its own with scripts/slots.ts keygen.`);
  const identity = readFileSync(path, "utf8").split("\n").find((line) => line.startsWith("AGE-SECRET-KEY-"));
  assert(identity, `No age identity in ${path}`);
  return identity;
}

// Imported lazily so plaintext-only renders work before dependencies are installed.
const loadAge = () => import("age-encryption");

export async function decryptSlot(slot: Slot, identity: string): Promise<string> {
  const age = await loadAge();
  const decrypter = new age.Decrypter();
  decrypter.addIdentity(identity);
  try {
    return await decrypter.decrypt(age.armor.decode(readFileSync(slot.path, "utf8")), "text");
  } catch (error) {
    throw new Error(`Cannot decrypt slot ${slot.name} with this host's age identity. If this host was added to the slot, run scripts/slots.ts reencrypt ${slot.name} on a host that can read it.`, { cause: error });
  }
}

export async function encryptSlot(plaintext: string, recipients: string[]): Promise<string> {
  const age = await loadAge();
  const encrypter = new age.Encrypter();
  for (const recipient of recipients) encrypter.addRecipient(recipient);
  return age.armor.encode(await encrypter.encrypt(plaintext));
}

async function readSlot(slot: Slot, home: string): Promise<string> {
  return slot.encrypted ? decryptSlot(slot, readIdentity(identityPath(home))) : readFileSync(slot.path, "utf8");
}

export async function renderGuidance(host: string, registry: HostRegistry, home: string, root = repoRoot): Promise<GuidanceFiles> {
  const lines = parseGuidance(root);
  const slots = validateSlots(registry, root, lines);
  const output: string[] = [];
  for (const [index, line] of lines.entries()) {
    if ("text" in line) {
      // An omitted slot takes its following blank line with it.
      const previous = lines[index - 1];
      if (line.text === "" && previous && "slot" in previous && !selected(previous.slot, host, registry.slots)) continue;
      output.push(line.text);
    } else if (selected(line.slot, host, registry.slots)) {
      output.push((await readSlot(slots.get(line.slot)!, home)).trimEnd());
    }
  }
  return {
    agents: `${output.join("\n").trimEnd()}\n`,
    claude: readFileSync(resolve(root, "agents/CLAUDE.md"), "utf8"),
  };
}

export function writeGuidance(home: string, rendered: GuidanceFiles): void {
  const root = guidanceRoot(home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const files = guidanceFiles(home);
  writeAtomic(files.agents, rendered.agents, 0o600);
  writeAtomic(files.claude, rendered.claude, 0o600);
}

#!/usr/bin/env bun

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { assert, repoRoot, resolvedPath, stableRoot, writeAtomic } from "./lib/core.ts";
import { loadHosts } from "./lib/hosts.ts";
import { decryptSlot, encryptSlot, identityPath, isSlotName, loadSlots, readIdentity, slotFile, slotRecipients, type Slot } from "./lib/guidance.ts";

const usage = `Usage: scripts/slots.ts COMMAND

  keygen           Create this host's age identity and print its recipient
  recipient        Print this host's age recipient for hosts.json
  edit NAME        Decrypt agents/slots/NAME.md.age into $VISUAL or $EDITOR, then re-encrypt (creates it when missing)
  encrypt NAME     Replace plaintext agents/slots/NAME.md with NAME.md.age
  reencrypt NAME   Re-encrypt NAME.md.age to the hosts hosts.json currently selects

Encrypted slots are readable by the hosts selected for them in hosts.json "slots",
using each host's "ageRecipient". Run edit and reencrypt on a host that can decrypt the slot.`;

function fail(message: string, exitCode = 2): never {
  console.error(message);
  process.exit(exitCode);
}

// Opens the editor on a private copy and removes it however the editor exits.
function editInEditor(initial: string): string | undefined {
  const directory = mkdtempSync(resolve(tmpdir(), "slopestyle-slot."));
  try {
    const file = resolve(directory, "slot.md");
    writeFileSync(file, initial, { mode: 0o600 });
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    const result = Bun.spawnSync(["sh", "-c", `${editor} "$1"`, "sh", file], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    return result.exitCode === 0 ? readFileSync(file, "utf8") : undefined;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

interface SlotCommand {
  name: string;
  current: Slot | undefined;
  recipients: string[];
  write: (plaintext: string) => Promise<void>;
}

// Validates the name, refuses the stable runtime (sync discards its edits), and resolves recipients up front.
function slotCommand(home: string, name: string | undefined): SlotCommand {
  if (!name || !isSlotName(name)) fail(usage);
  const runtime = stableRoot(home);
  assert(!existsSync(runtime) || resolvedPath(runtime) !== repoRoot, "Edit slots in a development checkout, not the stable runtime.");
  const recipients = slotRecipients(name, loadHosts());
  return {
    name,
    current: loadSlots().get(name),
    recipients,
    write: async (plaintext) => {
      writeAtomic(slotFile(name, true), await encryptSlot(plaintext, recipients));
      console.log(`Encrypted agents/slots/${name}.md.age to ${recipients.length} host(s).`);
    },
  };
}

async function main(args: string[]): Promise<void> {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is required.");
  const [command, name, ...extra] = args;
  if (extra.length > 0) fail(usage);
  switch (command) {
    case "keygen": {
      if (name) fail(usage);
      const path = identityPath(home);
      const identity = await generateX25519Identity();
      const recipient = await identityToRecipient(identity);
      mkdirSync(dirname(path), { recursive: true });
      // "wx" refuses an existing identity; replacing one would lock this host out of its slots.
      writeFileSync(path, `# created: ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`, { mode: 0o600, flag: "wx" });
      console.log(`Wrote ${path}. Add this to the host's entry in hosts.json:\n"ageRecipient": "${recipient}"`);
      return;
    }
    case "recipient":
      if (name) fail(usage);
      console.log(await identityToRecipient(readIdentity(home)));
      return;
    case "edit": {
      const slot = slotCommand(home, name);
      assert(!slot.current || slot.current.encrypted, `agents/slots/${slot.name}.md is plaintext; run encrypt first.`);
      const before = slot.current ? await decryptSlot(slot.current, readIdentity(home)) : "";
      const after = editInEditor(before);
      if (after === undefined) fail("Editor failed; slot unchanged.", 1);
      if (after === before) {
        console.log("No changes.");
        return;
      }
      await slot.write(after);
      if (!slot.current) console.log(`Add "<!-- slot: ${slot.name} -->" to agents/AGENTS.md where the section belongs.`);
      return;
    }
    case "encrypt": {
      const slot = slotCommand(home, name);
      assert(slot.current && !slot.current.encrypted, `No plaintext slot agents/slots/${slot.name}.md.`);
      await slot.write(readFileSync(slot.current.path, "utf8"));
      rmSync(slot.current.path);
      return;
    }
    case "reencrypt": {
      const slot = slotCommand(home, name);
      assert(slot.current?.encrypted, `No encrypted slot agents/slots/${slot.name}.md.age.`);
      await slot.write(await decryptSlot(slot.current, readIdentity(home)));
      return;
    }
    case "-h":
    case "--help":
      console.log(usage);
      return;
    default:
      fail(usage);
  }
}

await main(process.argv.slice(2));

import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

export const sourceRoot = resolve(import.meta.dir, "../..");

// Copies the working tree without Git state, dependencies, or real encrypted slots.
export function copySource(destination: string): void {
  cpSync(sourceRoot, destination, {
    recursive: true,
    filter: (path) => {
      const local = relative(sourceRoot, path);
      return local !== ".git" && !local.startsWith(".git/") && local !== "node_modules" && !local.startsWith("node_modules/");
    },
  });
  stripEncryptedSlots(destination);
}

// Test hosts hold no production age identity, so they cannot render real encrypted slots.
export function stripEncryptedSlots(destination: string): void {
  const slots = resolve(destination, "agents/slots");
  const encrypted = readdirSync(slots).filter((file) => file.endsWith(".md.age")).map((file) => file.slice(0, -".md.age".length));
  if (encrypted.length === 0) return;
  for (const name of encrypted) rmSync(resolve(slots, `${name}.md.age`));
  const agents = resolve(destination, "agents/AGENTS.md");
  const markers = new Set(encrypted.map((name) => `<!-- slot: ${name} -->`));
  writeFileSync(agents, readFileSync(agents, "utf8").split("\n").filter((line) => !markers.has(line)).join("\n"));
  const hostsPath = resolve(destination, "hosts.json");
  const hosts = JSON.parse(readFileSync(hostsPath, "utf8"));
  for (const name of encrypted) delete hosts.slots[name];
  writeFileSync(hostsPath, `${JSON.stringify(hosts, null, 2)}\n`);
}

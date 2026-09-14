import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { assert, pathExists, repoRoot } from "./core.ts";

export interface HostConfig {
  aliases: string[];
}

export interface HostRegistry {
  schemaVersion: number;
  hosts: Record<string, HostConfig>;
  skills: Record<string, string[]>;
  subagents: Record<string, string[]>;
}

const hostName = (value: string): string => value.replace(/\.$/, "").toLowerCase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadHosts(path = resolve(repoRoot, "hosts.json")): HostRegistry {
  const config: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert(isRecord(config) && config.schemaVersion === 1 && Object.keys(config).sort().join(",") === "hosts,schemaVersion,skills,subagents", "hosts.json must use schemaVersion 1 and contain only hosts, skills, and subagents");
  assert(isRecord(config.hosts), "Invalid hosts map in hosts.json");
  const ids = Object.keys(config.hosts);
  assert(ids.length > 0 && ids.every((id) => hostName(id) === id && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)), "hosts.json contains invalid host IDs");
  const seen = new Map<string, string>();
  for (const id of ids) {
    const host = config.hosts[id];
    assert(isRecord(host) && Object.keys(host).join(",") === "aliases", `Invalid fields for host ${id}`);
    const aliases = host.aliases;
    assert(Array.isArray(aliases) && aliases.every((alias) => typeof alias === "string" && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(alias)), `Invalid aliases for host ${id}`);
    for (const value of [id, ...aliases]) {
      const normalized = hostName(value);
      assert(!seen.has(normalized), `Ambiguous normalized host alias ${value}`);
      seen.set(normalized, id);
    }
  }
  const validateMap = (map: unknown, label: string): void => {
    assert(isRecord(map), `Invalid ${label} map`);
    for (const [name, allowed] of Object.entries(map)) {
      assert(Array.isArray(allowed) && allowed.every((id) => typeof id === "string" && ids.includes(id)), `Invalid host reference for ${label} ${name}`);
      assert(new Set(allowed).size === allowed.length, `Duplicate host reference for ${label} ${name}`);
    }
  };
  validateMap(config.skills, "skill");
  validateMap(config.subagents, "subagent");
  return config as unknown as HostRegistry;
}

export function resolveHost(home: string, registry = loadHosts(), localHostname = hostname()): string {
  const pinPath = resolve(home, ".config/slopestyle/host");
  if (pathExists(pinPath)) {
    const pin = readFileSync(pinPath, "utf8").trim();
    assert(Object.hasOwn(registry.hosts, pin), `Invalid host pin ${JSON.stringify(pin)}. Pin a canonical host ID in ${pinPath}.`);
    return pin;
  }
  const normalized = hostName(localHostname);
  const match = Object.entries(registry.hosts).find(([id, config]) => [id, ...config.aliases].some((candidate) => hostName(candidate) === normalized))?.[0];
  if (!match) throw new Error(`Unknown host ${JSON.stringify(localHostname)}. Register this host in hosts.json or pin a canonical ID in ${pinPath}.`);
  return match;
}

export function validateManagedNames(registry: HostRegistry, skills: Iterable<string>, subagents: Iterable<string>): void {
  const knownSkills = new Set(skills);
  const knownSubagents = new Set(subagents);
  for (const name of Object.keys(registry.skills)) assert(knownSkills.has(name), `Unknown managed skill in hosts.json: ${name}`);
  for (const name of Object.keys(registry.subagents)) assert(knownSubagents.has(name), `Unknown managed subagent in hosts.json: ${name}`);
}

export function selected(name: string, host: string, map: Record<string, string[]>): boolean {
  return !Object.hasOwn(map, name) || map[name]!.includes(host);
}

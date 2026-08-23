import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { commandExists, run, stateRoot } from "./core.ts";

export const rangeStart = 20_000;
export const rangeEnd = 30_000;
export const blockAlignment = 10;

export function registryPath(home: string): string {
  return resolve(stateRoot(home), "ports.sqlite");
}

export function openRegistry(home: string): Database {
  const path = registryPath(home);
  mkdirSync(stateRoot(home), { recursive: true, mode: 0o700 });
  const database = new Database(path, { create: true, readwrite: true });
  try {
    chmodSync(path, 0o600);
    // busy_timeout first: the very first open performs the WAL switch, which itself
    // needs the bounded wait when several processes start at once.
    database.exec("PRAGMA busy_timeout = 10000;");
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA foreign_keys = ON;");
    migrate(database);
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

const schemaVersion = 1;

const schema = `
  CREATE TABLE apps (
    id INTEGER PRIMARY KEY,
    identity TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE services (
    id INTEGER PRIMARY KEY,
    app_id INTEGER NOT NULL REFERENCES apps(id),
    name TEXT NOT NULL,
    env_name TEXT NOT NULL,
    offset INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(app_id, name),
    UNIQUE(app_id, offset),
    UNIQUE(app_id, env_name)
  );
  CREATE TABLE blocks (
    id INTEGER PRIMARY KEY,
    app_id INTEGER NOT NULL REFERENCES apps(id),
    start INTEGER NOT NULL UNIQUE,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE leases (
    block_id INTEGER NOT NULL UNIQUE REFERENCES blocks(id),
    checkout_identity TEXT NOT NULL UNIQUE,
    checkout_path TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  );
  PRAGMA user_version = ${schemaVersion};
`;

function migrate(database: Database): void {
  begin(database, "EXCLUSIVE");
  try {
    const version = database.query<{ user_version: number }, []>("PRAGMA user_version;").get()!.user_version;
    if (version > schemaVersion) {
      throw new Error(`Port registry schema version ${version} is newer than this CLI understands. Update Slop(e)style.`);
    }
    if (version === 0) database.exec(schema);
    database.exec("COMMIT;");
  } catch (error) {
    rollback(database);
    throw error;
  }
}

export class BusyError extends Error {}

function begin(database: Database, mode: "IMMEDIATE" | "EXCLUSIVE"): void {
  try {
    database.exec(`BEGIN ${mode};`);
  } catch (error) {
    throw new BusyError(`Another Slop(e)style port allocation is in progress. Retry shortly. (${message(error)})`);
  }
}

function rollback(database: Database): void {
  try {
    database.exec("ROLLBACK;");
  } catch {
    // The transaction already ended; the original error is the one worth reporting.
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function withImmediateTransaction<T>(database: Database, work: () => T): T {
  begin(database, "IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    rollback(database);
    throw error;
  }
}

export interface Listener {
  port: number;
  address: string;
  detail: string;
}

export function parseSs(output: string): Listener[] {
  const listeners: Listener[] = [];
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;
    const local = fields[3];
    const separator = local.lastIndexOf(":");
    if (separator < 0) continue;
    const port = Number(local.slice(separator + 1));
    if (!Number.isInteger(port)) continue;
    const users = line.match(/users:\(\((.*)\)\)$/)?.[1];
    listeners.push({ port, address: local.slice(0, separator), detail: users ? `ss ${users}` : "ss (process unknown)" });
  }
  return listeners;
}

export function parseLsof(output: string): Listener[] {
  const listeners: Listener[] = [];
  let pid = "";
  let command = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      pid = line.slice(1);
      command = "";
    } else if (line.startsWith("c")) {
      command = line.slice(1);
    } else if (line.startsWith("n")) {
      const local = line.slice(1);
      const separator = local.lastIndexOf(":");
      if (separator < 0) continue;
      const port = Number(local.slice(separator + 1));
      if (!Number.isInteger(port)) continue;
      listeners.push({ port, address: local.slice(0, separator), detail: `lsof ${command || "unknown"} pid=${pid || "unknown"}` });
    }
  }
  return listeners;
}

export type Listeners = Map<number, Listener[]>;

export function probeListeners(): Listeners {
  const byPort: Listeners = new Map();
  for (const listener of process.platform === "darwin" ? probeWithLsof() : probeWithSs()) {
    const existing = byPort.get(listener.port);
    if (existing) existing.push(listener);
    else byPort.set(listener.port, [listener]);
  }
  return byPort;
}

// Tailscale Serve forwards to 127.0.0.1 exactly. A wildcard bind, an IPv6 bind, or
// another loopback address such as 127.0.0.2 does not answer that target.
export function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "localhost";
}

export function loopbackListener(listeners: Listeners, port: number): Listener | undefined {
  return listeners.get(port)?.find((listener) => isLoopback(listener.address));
}

function probeWithSs(): Listener[] {
  if (!commandExists("ss")) throw new Error("ss is required to detect local listeners. Install iproute2.");
  let result = run(["ss", "-H", "-ltnp"], { quiet: true });
  if (result.exitCode !== 0) result = run(["ss", "-H", "-ltn"], { quiet: true });
  if (result.exitCode !== 0) throw new Error(`ss failed, so local listeners are unknown: ${result.stderr.trim()}`);
  return parseSs(result.stdout);
}

function probeWithLsof(): Listener[] {
  if (!commandExists("lsof")) throw new Error("lsof is required to detect local listeners on macOS.");
  const result = run(["lsof", "-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], { quiet: true });
  // lsof conventionally exits 1 with no output when nothing matches the filter.
  const nothingMatched = result.exitCode === 1 && result.stdout === "" && result.stderr === "";
  if (result.exitCode !== 0 && !nothingMatched) {
    throw new Error(`lsof failed, so local listeners are unknown: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  return parseLsof(result.stdout);
}

export interface ServeRoute {
  port: number;
  // The proxy target of the sole "/" handler, and only when this port has the
  // exclusive shape this CLI creates. Compound configurations report null.
  target: string | null;
  exclusive: boolean;
  description: string;
}

export function tailscaleAvailable(): boolean {
  return commandExists("tailscale");
}

interface WebEntry {
  host: string;
  handlers: string[];
  proxy: string | null;
}

function portOfHost(host: string): number | null {
  const port = Number(host.slice(host.lastIndexOf(":") + 1));
  return Number.isInteger(port) ? port : null;
}

// Foreground sessions ("tailscale serve" without --bg) live under Foreground.<session>,
// each with its own TCP and Web maps that may name ports the top level never mentions.
function foregroundPorts(config: { Foreground?: Record<string, { TCP?: Record<string, unknown>; Web?: Record<string, unknown> }> }): Set<number> {
  const ports = new Set<number>();
  for (const session of Object.values(config.Foreground ?? {})) {
    for (const key of Object.keys(session?.TCP ?? {})) {
      const port = Number(key);
      if (Number.isInteger(port)) ports.add(port);
    }
    for (const host of Object.keys(session?.Web ?? {})) {
      const port = portOfHost(host);
      if (port !== null) ports.add(port);
    }
  }
  return ports;
}

// "tailscale serve --https=PORT off" deletes the whole HTTPS port, so removal is only
// safe when the port carries exactly the shape this CLI creates: one HTTPS TCP entry,
// one Web host entry, and a single "/" handler proxying somewhere. A foreground session
// on the port is never safe to remove, so any such port is reported as non-exclusive.
export function parseServeStatus(status: unknown): Map<number, ServeRoute> {
  const config = (status ?? {}) as {
    TCP?: Record<string, { HTTPS?: boolean }>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
    Foreground?: Record<string, { TCP?: Record<string, unknown>; Web?: Record<string, unknown> }>;
  };
  const foreground = foregroundPorts(config);
  const web = new Map<number, WebEntry[]>();
  for (const [host, value] of Object.entries(config.Web ?? {})) {
    const port = portOfHost(host);
    if (port === null) continue;
    const entries = web.get(port) ?? [];
    entries.push({ host, handlers: Object.keys(value?.Handlers ?? {}), proxy: value?.Handlers?.["/"]?.Proxy ?? null });
    web.set(port, entries);
  }

  const ports = new Set<number>(web.keys());
  for (const key of Object.keys(config.TCP ?? {})) {
    const port = Number(key);
    if (Number.isInteger(port)) ports.add(port);
  }
  for (const port of foreground) ports.add(port);

  const routes = new Map<number, ServeRoute>();
  for (const port of ports) {
    if (foreground.has(port)) {
      const entries = web.get(port) ?? [];
      const alsoBackground = entries.length > 0 || config.TCP?.[String(port)] !== undefined;
      routes.set(port, {
        port,
        target: null,
        exclusive: false,
        description: alsoBackground
          ? "a foreground serve session sharing the port with a background route"
          : "a foreground serve session",
      });
      continue;
    }
    const entries = web.get(port) ?? [];
    const https = config.TCP?.[String(port)]?.HTTPS === true;
    if (entries.length === 0) {
      routes.set(port, { port, target: null, exclusive: false, description: "a raw TCP route" });
      continue;
    }
    if (entries.length > 1) {
      routes.set(port, {
        port,
        target: null,
        exclusive: false,
        description: `${entries.length} host entries sharing the port (${entries.map((entry) => entry.host).join(", ")})`,
      });
      continue;
    }
    const entry = entries[0];
    const exclusive = https && entry.handlers.length === 1 && entry.handlers[0] === "/" && entry.proxy !== null;
    routes.set(port, {
      port,
      target: exclusive ? entry.proxy : null,
      exclusive,
      description: exclusive
        ? `a proxy to ${entry.proxy}`
        : entry.handlers.length === 1 && entry.handlers[0] === "/"
          ? `a non-HTTPS route on ${entry.host}`
          : `the handlers ${entry.handlers.join(", ")} on ${entry.host}`,
    });
  }
  return routes;
}

export function serveRoutes(): Map<number, ServeRoute> {
  if (!tailscaleAvailable()) return new Map();
  const result = run(["tailscale", "serve", "status", "--json"], { quiet: true });
  if (result.exitCode !== 0) {
    throw new Error(`tailscale serve status failed, so existing Tailscale routes are unknown: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  let status: unknown;
  try {
    status = JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error("tailscale serve status returned output that is not JSON, so existing Tailscale routes are unknown.");
  }
  return parseServeStatus(status);
}

export function tailscaleHost(): string {
  const result = run(["tailscale", "status", "--json"], { quiet: true });
  if (result.exitCode !== 0) throw new Error(`tailscale status failed, so the MagicDNS host is unknown: ${result.stderr.trim() || result.stdout.trim()}`);
  const dnsName = (JSON.parse(result.stdout || "{}") as { Self?: { DNSName?: string } }).Self?.DNSName;
  if (!dnsName) throw new Error("tailscale status did not report this machine's MagicDNS name.");
  return dnsName.replace(/\.$/, "");
}

export function serviceEnvName(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

export function validateServiceName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)) {
    throw new Error(`Invalid service name ${JSON.stringify(name)}. Use 1-32 characters starting with a letter, containing letters, digits, "-", or "_".`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(serviceEnvName(name))) {
    throw new Error(`Service name ${JSON.stringify(name)} does not normalize to a usable shell variable name.`);
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function gitIdentity(cwd: string): { app: string; checkout: string } | null {
  const common = run(["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { quiet: true });
  const top = run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], { quiet: true });
  if (common.exitCode !== 0 || top.exitCode !== 0) return null;
  const app = common.stdout.trim();
  const checkout = top.stdout.trim();
  if (!app || !checkout) return null;
  return { app: realOrSelf(app), checkout: realOrSelf(checkout) };
}

export function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

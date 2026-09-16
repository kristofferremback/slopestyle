#!/usr/bin/env bun

import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  BusyError,
  blockAlignment,
  gitIdentity,
  loopbackListener,
  openRegistry,
  probeListeners,
  realOrSelf,
  rangeEnd,
  rangeStart,
  serveRoutes,
  serviceEnvName,
  shellQuote,
  tailscaleAvailable,
  tailscaleHost,
  validateServiceName,
  withImmediateTransaction,
  type Listeners,
  type ServeRoute,
} from "./lib/ports.ts";

const help = `Usage: slopestyle-ports <command> [options] [SERVICE...]

Commands:
  claim [--app NAME] [--size N] [--format text|json|sh] SERVICE...
      Lease an aligned block of ${blockAlignment} or more ports for this checkout and
      map each service name to a stable offset inside the app's block.
  show [--app NAME] [--all] [--format text|json]
      Show this checkout's lease, or the whole machine registry with --all.
  release [--app NAME]
      Release this checkout's lease. Refuses while any block port is in use.
  serve [--app NAME] SERVICE
      Expose the service over Tailscale HTTPS on the same port number.
  unserve [--app NAME] SERVICE
      Remove this service's Tailscale route when it exclusively owns the port.

Contract:
  Managed ports are ${rangeStart}-${rangeEnd - 1}, allocated in aligned blocks of ${blockAlignment}.
  Without --app the current directory must be inside a Git worktree. All linked
  worktrees of one repository share an app identity and its service offsets; each
  worktree gets its own block. With --app NAME the app is "manual:NAME" and the
  checkout is the current directory.
  A block ever assigned to an app stays owned by that app on this machine, so a
  released block is never handed to another application and browser origins stay
  stable. A block is active while any of its ports has a local listener or a
  Tailscale Serve route; claim and release refuse to act on an active block.
  show, release, and unserve are checkout-scoped: they act on whatever lease this
  checkout holds and use the stored block owner. serve additionally requires the
  block to be owned by the app currently derived from this checkout.
  Servers must bind 127.0.0.1 exactly. A wildcard, IPv6-only, or other loopback
  address is not enough for serve. The Tailscale HTTPS port equals the local port.
`;

type Flag = "app" | "size" | "format" | "all";

interface CommandSpec {
  flags: Flag[];
  formats: string[];
  minimumServices: number;
  maximumServices: number;
  usage: string;
}

const commands: Record<string, CommandSpec> = {
  claim: { flags: ["app", "size", "format"], formats: ["text", "json", "sh"], minimumServices: 1, maximumServices: Infinity, usage: "claim [--app NAME] [--size N] [--format text|json|sh] SERVICE..." },
  show: { flags: ["app", "all", "format"], formats: ["text", "json"], minimumServices: 0, maximumServices: 0, usage: "show [--app NAME] [--all] [--format text|json]" },
  release: { flags: ["app"], formats: ["text"], minimumServices: 0, maximumServices: 0, usage: "release [--app NAME]" },
  serve: { flags: ["app"], formats: ["text"], minimumServices: 1, maximumServices: 1, usage: "serve [--app NAME] SERVICE" },
  unserve: { flags: ["app"], formats: ["text"], minimumServices: 1, maximumServices: 1, usage: "unserve [--app NAME] SERVICE" },
};

interface Options {
  app?: string;
  size?: number;
  format: string;
  all: boolean;
  services: string[];
}

function fail(message: string, exitCode = 1): never {
  console.error(message);
  process.exit(exitCode);
}

function parseArguments(argv: string[]): { command: string; spec: CommandSpec; options: Options } {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(help);
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const command = argv[0];
  const spec = commands[command];
  if (!spec) fail(`Unknown command: ${command}\n${help}`, 2);

  const options: Options = { format: "text", all: false, services: [] };
  const allows = (flag: Flag): boolean => spec.flags.includes(flag);
  const reject = (flag: string): never => fail(`${command} does not accept ${flag}.\nUsage: slopestyle-ports ${spec.usage}`, 2);
  let sizeText: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      console.log(help);
      process.exit(0);
    }
    const [name, inline] = argument.startsWith("--") && argument.includes("=")
      ? [argument.slice(0, argument.indexOf("=")), argument.slice(argument.indexOf("=") + 1)]
      : [argument, undefined];
    const value = (): string => inline ?? argv[++index] ?? fail(`${name} requires a value.`, 2);
    if (name === "--app") {
      if (!allows("app")) reject(name);
      options.app = value();
    } else if (name === "--size") {
      if (!allows("size")) reject(name);
      sizeText = value();
    } else if (name === "--format") {
      if (!allows("format")) reject(name);
      options.format = value();
    } else if (name === "--all") {
      if (!allows("all")) reject(name);
      if (inline !== undefined) fail("--all does not take a value.", 2);
      options.all = true;
    } else if (name.startsWith("-") && name !== "-") {
      fail(`Unknown option: ${name}\nUsage: slopestyle-ports ${spec.usage}`, 2);
    } else {
      options.services.push(argument);
    }
  }

  if (!spec.formats.includes(options.format)) {
    fail(`Unknown --format: ${options.format}. ${command} supports ${spec.formats.join(", ")}.`, 2);
  }
  if (options.services.length < spec.minimumServices) {
    fail(spec.minimumServices === 1 && spec.maximumServices === 1
      ? `${command} requires exactly one service name.\nUsage: slopestyle-ports ${spec.usage}`
      : `${command} requires at least one service name, for example: slopestyle-ports claim frontend api`, 2);
  }
  if (options.services.length > spec.maximumServices) {
    fail(spec.maximumServices === 0
      ? `${command} takes no positional arguments, but received ${options.services.map((argument) => JSON.stringify(argument)).join(", ")}.\nUsage: slopestyle-ports ${spec.usage}`
      : `${command} takes exactly one service name, but received ${options.services.length}.\nUsage: slopestyle-ports ${spec.usage}`, 2);
  }
  for (const name of options.services) {
    try {
      validateServiceName(name);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 2);
    }
  }
  const duplicate = options.services.find((name, index) => options.services.indexOf(name) !== index);
  if (duplicate) fail(`Service ${JSON.stringify(duplicate)} is listed more than once.`, 2);
  if (sizeText !== undefined) {
    const size = Number(sizeText);
    if (!/^\d+$/.test(sizeText.trim()) || !Number.isInteger(size) || size < 1 || size > rangeEnd - rangeStart) {
      fail(`--size must be a whole number of ports between 1 and ${rangeEnd - rangeStart}.`, 2);
    }
    options.size = size;
  }
  if (options.app !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.app)) {
    fail(`Invalid --app name: ${JSON.stringify(options.app)}`, 2);
  }
  return { command, spec, options };
}

interface Identity {
  appIdentity: string;
  appName: string;
  checkoutIdentity: string;
  checkoutPath: string;
  // release is checkout-scoped, so this is the command that works from this
  // directory no matter which app currently owns the leased block.
  releaseCommand: string;
}

function resolveIdentity(options: Options, required: boolean): Identity | null {
  // Git identities are real paths, so a manual checkout must resolve the same way.
  const cwd = realOrSelf(process.cwd());
  if (options.app !== undefined) {
    return { appIdentity: `manual:${options.app}`, appName: options.app, checkoutIdentity: cwd, checkoutPath: cwd, releaseCommand: `slopestyle-ports release --app ${options.app}` };
  }
  const git = gitIdentity(cwd);
  if (!git) {
    if (!required) return null;
    fail(`${cwd} is not inside a Git worktree. Pass --app NAME to allocate ports for a non-Git application.`, 2);
  }
  const appName = basename(git.app) === ".git" ? basename(dirname(git.app)) : basename(git.app).replace(/\.git$/, "");
  return { appIdentity: git.app, appName, checkoutIdentity: git.checkout, checkoutPath: git.checkout, releaseCommand: "slopestyle-ports release" };
}

interface AppRow { id: number; identity: string; display_name: string }
interface ServiceRow { name: string; env_name: string; offset: number }
interface BlockRow { id: number; app_id: number; start: number; size: number }
interface LeaseRow { block_id: number; checkout_identity: string; checkout_path: string }

const now = (): string => new Date().toISOString();

function findApp(database: Database, identity: string): AppRow | null {
  return database.query<AppRow, [string]>("SELECT id, identity, display_name FROM apps WHERE identity = ?").get(identity);
}

function ensureApp(database: Database, identity: string, displayName: string): AppRow {
  const existing = findApp(database, identity);
  if (existing) return existing;
  database.query("INSERT INTO apps (identity, display_name, created_at) VALUES (?, ?, ?)").run(identity, displayName, now());
  return findApp(database, identity)!;
}

function appServices(database: Database, appId: number): ServiceRow[] {
  return database.query<ServiceRow, [number]>('SELECT name, env_name, "offset" FROM services WHERE app_id = ? ORDER BY "offset"').all(appId);
}

interface Activity {
  listeners: Listeners;
  routes: Map<number, ServeRoute>;
}

function probe(): Activity {
  return { listeners: probeListeners(), routes: serveRoutes() };
}

function blockActivity(activity: Activity, start: number, size: number): string[] {
  const found: string[] = [];
  for (let port = start; port < start + size; port += 1) {
    for (const listener of activity.listeners.get(port) ?? []) {
      found.push(`${port} has a local listener on ${listener.address} (${listener.detail})`);
    }
    const route = activity.routes.get(port);
    if (route) found.push(`${port} has a Tailscale route (${route.description})`);
  }
  return found;
}

function roundUp(value: number): number {
  return Math.ceil(value / blockAlignment) * blockAlignment;
}

function leaseFor(database: Database, checkoutIdentity: string): LeaseRow | null {
  return database.query<LeaseRow, [string]>("SELECT block_id, checkout_identity, checkout_path FROM leases WHERE checkout_identity = ?").get(checkoutIdentity);
}

function blockById(database: Database, id: number): BlockRow {
  return database.query<BlockRow, [number]>("SELECT id, app_id, start, size FROM blocks WHERE id = ?").get(id)!;
}

function appById(database: Database, id: number): AppRow {
  return database.query<AppRow, [number]>("SELECT id, identity, display_name FROM apps WHERE id = ?").get(id)!;
}

// Cleanup and discovery are checkout-scoped: a lease belongs to the directory that took
// it, and an app identity derived from cwd can change under a checkout (a repository move,
// "git worktree repair", or switching between Git identity and --app). Refusing on the
// block's app owner would strand the lease and its Tailscale route.
function checkoutLease(database: Database, identity: Identity): { owner: AppRow; block: BlockRow } | null {
  const lease = leaseFor(database, identity.checkoutIdentity);
  if (!lease) return null;
  const block = blockById(database, lease.block_id);
  return { owner: appById(database, block.app_id), block };
}

// Starting a route requires the current app to own the block. Checkout identity alone is
// not ownership: the same directory can name a different app via --app.
function ownedLease(database: Database, identity: Identity, hint: string): { app: AppRow; block: BlockRow } {
  const app = findApp(database, identity.appIdentity);
  if (!app) throw new Error(`No ports are allocated for ${identity.appIdentity}. Run "slopestyle-ports claim ${hint}" first.`);
  const lease = leaseFor(database, identity.checkoutIdentity);
  if (!lease) throw new Error(`${identity.checkoutPath} holds no port lease. Run "slopestyle-ports claim ${hint}" first.`);
  const block = blockById(database, lease.block_id);
  if (block.app_id !== app.id) {
    const owner = appById(database, block.app_id);
    throw new Error(`${identity.checkoutPath} holds block ${block.start} for ${owner.display_name} (${owner.identity}), not for ${identity.appName} (${identity.appIdentity}). Run this command with the owning app identity.`);
  }
  return { app, block };
}

// A lease outlives its checkout directory only until the block goes quiet. Dropping
// it while something still listens or is routed would let the block be handed out twice.
function dropDeadLeases(database: Database, activity: Activity): void {
  for (const lease of database.query<LeaseRow, []>("SELECT block_id, checkout_identity, checkout_path FROM leases").all()) {
    if (existsSync(lease.checkout_path)) continue;
    const block = blockById(database, lease.block_id);
    if (blockActivity(activity, block.start, block.size).length > 0) continue;
    database.query("DELETE FROM leases WHERE block_id = ?").run(lease.block_id);
  }
}

function allocateBlock(database: Database, app: AppRow, size: number, activity: Activity): BlockRow {
  const blocks = database.query<BlockRow, []>("SELECT id, app_id, start, size FROM blocks ORDER BY start").all();
  const leased = new Set(database.query<{ block_id: number }, []>("SELECT block_id FROM leases").all().map((row) => row.block_id));
  for (let start = rangeStart; start + size <= rangeEnd; start += blockAlignment) {
    const reusable = blocks.find((block) => block.start === start && block.app_id === app.id && block.size >= size && !leased.has(block.id));
    if (reusable) {
      const active = blockActivity(activity, reusable.start, reusable.size);
      if (active.length > 0) continue;
      return reusable;
    }
    if (blocks.some((block) => block.start < start + size && start < block.start + block.size)) continue;
    if (blockActivity(activity, start, size).length > 0) continue;
    database.query("INSERT INTO blocks (app_id, start, size, created_at) VALUES (?, ?, ?, ?)").run(app.id, start, size, now());
    return database.query<BlockRow, [number]>("SELECT id, app_id, start, size FROM blocks WHERE start = ?").get(start)!;
  }
  throw new Error(`No free aligned block of ${size} ports is available in the managed range ${rangeStart}-${rangeEnd - 1}.`);
}

function serviceUrl(host: string | null, port: number): string | null {
  return host ? `https://${host}:${port}` : null;
}

function hostOrNull(): string | null {
  if (!tailscaleAvailable()) return null;
  try {
    return tailscaleHost();
  } catch {
    return null;
  }
}

interface ClaimResult {
  reused: boolean;
  block: BlockRow;
  services: ServiceRow[];
}

function commandClaim(database: Database, identity: Identity, options: Options): void {
  const result = withImmediateTransaction(database, (): ClaimResult => {
    const app = ensureApp(database, identity.appIdentity, identity.appName);
    const existing = appServices(database, app.id);
    const byName = new Map(existing.map((service) => [service.name, service]));
    const usedOffsets = new Set(existing.map((service) => service.offset));
    const usedEnvNames = new Map(existing.map((service) => [service.env_name, service.name]));
    for (const name of options.services) {
      if (byName.has(name)) continue;
      const envName = serviceEnvName(name);
      const collision = usedEnvNames.get(envName);
      if (collision) throw new Error(`Service ${JSON.stringify(name)} normalizes to ${envName}, which service ${JSON.stringify(collision)} already uses in this app.`);
      let offset = 0;
      while (usedOffsets.has(offset)) offset += 1;
      usedOffsets.add(offset);
      usedEnvNames.set(envName, name);
      database.query('INSERT INTO services (app_id, name, env_name, "offset", created_at) VALUES (?, ?, ?, ?, ?)').run(app.id, name, envName, offset, now());
      byName.set(name, { name, env_name: envName, offset });
    }

    const highestOffset = Math.max(...appServices(database, app.id).map((service) => service.offset));
    const size = Math.max(roundUp(options.size ?? blockAlignment), roundUp(highestOffset + 1));
    const requested = options.services.map((name) => byName.get(name)!);

    const activity = probe();
    dropDeadLeases(database, activity);
    const lease = leaseFor(database, identity.checkoutIdentity);
    if (lease) {
      const block = blockById(database, lease.block_id);
      if (block.app_id !== app.id) {
        const owner = appById(database, block.app_id);
        throw new Error(`${identity.checkoutPath} already holds block ${block.start} for ${owner.display_name} (${owner.identity}), not for ${identity.appName} (${identity.appIdentity}). Run "${identity.releaseCommand}" from this checkout to release it, then claim again.`);
      }
      const active = blockActivity(activity, block.start, block.size);
      if (active.length > 0) {
        throw new Error(`Block ${block.start}-${block.start + block.size - 1} is already leased to this checkout and in use:\n  ${active.join("\n  ")}\nStop those services or keep using the ports above; this CLI will not allocate a second block.`);
      }
      if (block.size < size) {
        throw new Error(`This checkout holds block ${block.start} with ${block.size} ports, which is smaller than the ${size} ports now required. Run "${identity.releaseCommand}" first; the new block will use different port numbers.`);
      }
      return { reused: true, block, services: requested };
    }

    const block = allocateBlock(database, app, size, activity);
    database.query("INSERT INTO leases (block_id, checkout_identity, checkout_path, claimed_at) VALUES (?, ?, ?, ?)").run(block.id, identity.checkoutIdentity, identity.checkoutPath, now());
    return { reused: false, block, services: requested };
  });

  const host = hostOrNull();
  const ports = result.services.map((service) => ({
    name: service.name,
    envName: service.env_name,
    offset: service.offset,
    port: result.block.start + service.offset,
    tailscaleUrl: serviceUrl(host, result.block.start + service.offset),
  }));

  if (options.format === "json") {
    console.log(JSON.stringify({
      app: { identity: identity.appIdentity, name: identity.appName },
      checkout: { identity: identity.checkoutIdentity, path: identity.checkoutPath },
      block: { start: result.block.start, size: result.block.size },
      reused: result.reused,
      tailscaleHost: host,
      services: ports,
    }));
    return;
  }
  if (options.format === "sh") {
    console.log(`SLOPESTYLE_PORT_BASE=${shellQuote(String(result.block.start))}`);
    for (const service of ports) console.log(`SLOPESTYLE_PORT_${service.envName}=${shellQuote(String(service.port))}`);
    return;
  }
  console.log(`App:      ${identity.appName} (${identity.appIdentity})`);
  console.log(`Checkout: ${identity.checkoutPath}`);
  console.log(`Block:    ${result.block.start}-${result.block.start + result.block.size - 1}${result.reused ? " (existing lease)" : ""}`);
  for (const service of ports) console.log(`  ${service.name}: ${service.port}${service.tailscaleUrl ? ` (reserved ${service.tailscaleUrl}, live after serve)` : ""}`);
  console.log("Bind servers to 127.0.0.1, then run \"slopestyle-ports serve SERVICE\" to expose one over Tailscale HTTPS.");
}

function commandRelease(database: Database, identity: Identity): void {
  const released = withImmediateTransaction(database, () => {
    const held = checkoutLease(database, identity);
    if (!held) throw new Error(`${identity.checkoutPath} holds no port lease. Run "slopestyle-ports claim SERVICE..." first.`);
    const { owner, block } = held;
    const active = blockActivity(probe(), block.start, block.size);
    if (active.length > 0) {
      throw new Error(`Refusing to release block ${block.start}-${block.start + block.size - 1} while it is in use:\n  ${active.join("\n  ")}`);
    }
    // Releasing only deletes the lease. The block keeps its permanent app owner.
    database.query("DELETE FROM leases WHERE checkout_identity = ?").run(identity.checkoutIdentity);
    return { start: block.start, owner };
  });
  console.log(`Released block ${released.start}. It stays owned by ${released.owner.display_name} (${released.owner.identity}) and can be claimed again by that app only.`);
}

function commandShow(database: Database, identity: Identity | null, options: Options): void {
  const activity = probe();
  const host = hostOrNull();
  const apps = database.query<AppRow, []>("SELECT id, identity, display_name FROM apps ORDER BY identity").all();
  const entries = [];
  for (const app of apps) {
    const services = appServices(database, app.id);
    for (const block of database.query<BlockRow, [number]>("SELECT id, app_id, start, size FROM blocks WHERE app_id = ? ORDER BY start").all(app.id)) {
      const lease = database.query<LeaseRow, [number]>("SELECT block_id, checkout_identity, checkout_path FROM leases WHERE block_id = ?").get(block.id);
      // Checkout-scoped like release: the lease shows even when cwd now derives a
      // different app identity, and the entry names the app that actually owns it.
      const mine = identity !== null && lease?.checkout_identity === identity.checkoutIdentity;
      if (!options.all && !mine) continue;
      entries.push({
        app: { identity: app.identity, name: app.display_name },
        block: { start: block.start, size: block.size },
        checkout: lease ? { identity: lease.checkout_identity, path: lease.checkout_path, exists: existsSync(lease.checkout_path) } : null,
        active: blockActivity(activity, block.start, block.size),
        services: services
          .filter((service) => service.offset < block.size)
          .map((service) => ({ name: service.name, envName: service.env_name, offset: service.offset, port: block.start + service.offset, tailscaleUrl: serviceUrl(host, block.start + service.offset) })),
      });
    }
  }
  if (options.format === "json") {
    console.log(JSON.stringify({
      checkout: identity ? { identity: identity.checkoutIdentity, path: identity.checkoutPath } : null,
      tailscaleHost: host,
      entries,
    }));
    return;
  }
  if (entries.length === 0) {
    console.log(options.all ? "No ports are allocated on this machine." : `${identity!.checkoutPath} holds no port lease. Run "slopestyle-ports claim SERVICE..." to get one.`);
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.app.name} (${entry.app.identity})`);
    console.log(`  Block:    ${entry.block.start}-${entry.block.start + entry.block.size - 1}`);
    console.log(`  Checkout: ${entry.checkout ? `${entry.checkout.path}${entry.checkout.exists ? "" : " (missing)"}` : "unleased"}`);
    for (const service of entry.services) console.log(`  ${service.name}: ${service.port}${service.tailscaleUrl ? ` (reserved ${service.tailscaleUrl}, live after serve)` : ""}`);
    for (const active of entry.active) console.log(`  active: ${active}`);
  }
}

function servicePort(database: Database, app: AppRow, block: BlockRow, name: string): { port: number; name: string } {
  const service = appServices(database, app.id).find((candidate) => candidate.name === name);
  if (!service || service.offset >= block.size) fail(`Service ${JSON.stringify(name)} is not part of this lease. Claim it first.`);
  return { port: block.start + service.offset, name };
}

function resolveOwnedServicePort(database: Database, identity: Identity, options: Options): { port: number; name: string } {
  const name = options.services[0];
  const { app, block } = ownedLease(database, identity, name);
  return servicePort(database, app, block, name);
}

function resolveCheckoutServicePort(database: Database, identity: Identity, options: Options): { port: number; name: string } {
  const name = options.services[0];
  const held = checkoutLease(database, identity);
  if (!held) fail(`${identity.checkoutPath} holds no port lease. Run "slopestyle-ports claim ${name}" first.`);
  return servicePort(database, held.owner, held.block, name);
}

function requireTailscale(): void {
  if (!tailscaleAvailable()) fail("The tailscale CLI is not installed, so Tailscale HTTPS is unavailable. Install Tailscale from https://tailscale.com/download.");
}

function requireLoopbackListener(port: number, name: string): void {
  const listeners = probeListeners();
  if (loopbackListener(listeners, port)) return;
  const others = listeners.get(port) ?? [];
  if (others.length === 0) fail(`Nothing is listening on 127.0.0.1:${port}. Start ${name} on that port before serving it.`);
  fail(`Port ${port} is listening on ${others.map((listener) => listener.address).join(", ")}, not on 127.0.0.1. Tailscale forwards to http://127.0.0.1:${port}, so bind ${name} to 127.0.0.1.`);
}

function commandServe(database: Database, identity: Identity, options: Options): void {
  requireTailscale();
  const { port, name } = resolveOwnedServicePort(database, identity, options);
  const target = `http://127.0.0.1:${port}`;
  requireLoopbackListener(port, name);
  const existing = serveRoutes().get(port);
  const host = tailscaleHost();
  if (existing) {
    if (!existing.exclusive || existing.target !== target) {
      fail(`Tailscale already serves port ${port} with ${existing.description}, which is not the exact route for ${name}. Refusing to replace it.`);
    }
    console.log(`Already served: https://${host}:${port} -> ${target}`);
    return;
  }
  const result = Bun.spawnSync(["tailscale", "serve", "--bg", `--https=${port}`, target], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) fail(`tailscale serve failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
  console.log(`Serving https://${host}:${port} -> ${target}`);
}

function commandUnserve(database: Database, identity: Identity, options: Options): void {
  requireTailscale();
  const { port, name } = resolveCheckoutServicePort(database, identity, options);
  const target = `http://127.0.0.1:${port}`;
  const existing = serveRoutes().get(port);
  if (!existing) {
    console.log(`Tailscale serves nothing on port ${port}.`);
    return;
  }
  if (existing.exclusive && existing.target !== target) {
    fail(`Tailscale serves port ${port} with ${existing.description}, which is not the exact route for ${name}. Leaving it untouched.`);
  }
  if (!existing.exclusive) {
    fail(`Tailscale serves port ${port} with ${existing.description}. Removing the HTTPS port would delete the other handlers or routes that share it, so ${name} is left untouched.`);
  }
  const result = Bun.spawnSync(["tailscale", "serve", `--https=${port}`, "off"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) fail(`tailscale serve off failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`);
  console.log(`Removed the Tailscale route for port ${port}.`);
}

const { command, options } = parseArguments(process.argv.slice(2));
const home = process.env.HOME;
if (!home) fail("HOME is required.");
// show --all reads the machine registry, so it needs no checkout of its own.
const identity = resolveIdentity(options, !(command === "show" && options.all));

let database: Database;
try {
  database = openRegistry(home);
} catch (error) {
  if (error instanceof BusyError) fail(error.message, 75);
  fail(error instanceof Error ? error.message : String(error));
}
try {
  switch (command) {
    case "claim":
      commandClaim(database, identity!, options);
      break;
    case "show":
      commandShow(database, identity, options);
      break;
    case "release":
      commandRelease(database, identity!);
      break;
    case "serve":
      commandServe(database, identity!, options);
      break;
    case "unserve":
      commandUnserve(database, identity!, options);
      break;
  }
} catch (error) {
  if (error instanceof BusyError) fail(error.message, 75);
  fail(error instanceof Error ? error.message : String(error));
} finally {
  database.close();
}

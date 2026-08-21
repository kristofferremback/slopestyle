#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
  assert,
  isSymlink,
  linkAtomic,
  loadManifest,
  pathExists,
  repoRoot,
  resolvedPath,
  runOrThrow,
  sha256File,
  stableRoot,
  targetRoot,
  type Target,
} from "./lib/core.ts";

const args = process.argv.slice(2);
let replace = false;
let preflightRoot: string | undefined;
for (let index = 0; index < args.length; index += 1) {
  switch (args[index]) {
    case "--replace":
      replace = true;
      break;
    case "--preflight-for":
      preflightRoot = args[++index];
      if (!preflightRoot) usage(2);
      break;
    case "-h":
    case "--help":
      usage(0);
      break;
    default:
      usage(2, `Unknown argument: ${args[index]}`);
  }
}
if (replace && preflightRoot) throw new Error("--replace cannot be combined with --preflight-for.");

function usage(exitCode: number, message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: ${process.argv[1]} [--replace] [--preflight-for PATH]`);
  process.exit(exitCode);
}

const configuredHome = process.env.HOME;
if (!configuredHome) throw new Error("HOME is required.");
const home: string = configuredHome;
const runtimeRoot = stableRoot(home);
const mode = preflightRoot ? "preflight" : "install";
if (mode === "install") {
  assert(existsSync(resolve(runtimeRoot, ".git")) && resolvedPath(runtimeRoot) === repoRoot, `Install from the stable runtime checkout at ${runtimeRoot}, not a development checkout.`);
} else {
  assert(existsSync(resolve(preflightRoot!, ".git")) && resolvedPath(preflightRoot!) === resolvedPath(runtimeRoot), `Preflight target must be the stable runtime checkout at ${runtimeRoot}.`);
  preflightRoot = resolvedPath(preflightRoot!);
}

const manifest = loadManifest();
const heavyCheckTarget = resolve(home, ".local/bin/slopestyle-heavy");
const legacyThrea = [resolve(home, ".pi/agent/skills/threa-cli"), resolve(home, ".claude/skills/threa-cli")];
for (const path of legacyThrea) {
  if (pathExists(path) && (mode === "preflight" || !replace)) {
    throw new Error(`Legacy skill ${path} conflicts with canonical threa. Review it before using --replace.`);
  }
}

const unslopPatch = readFileSync(resolve(repoRoot, "skills/unslop/PATCH.md"), "utf8");
const legacyUnslopHash = unslopPatch.match(/Unmodified `SKILL\.md` SHA-256: `([0-9a-f]{64})`/)?.[1];
assert(legacyUnslopHash, "unslop PATCH.md is missing its upstream hash");

function isExactLegacyUnslop(target: string): boolean {
  const skillFile = resolve(target, "SKILL.md");
  if (!existsSync(skillFile)) return false;
  const directory = resolvedPath(target);
  return readdirSync(directory).sort().join("\n") === "SKILL.md" && sha256File(skillFile) === legacyUnslopHash;
}

function canLink(source: string, target: string): void {
  if (isSymlink(target) && readlinkSync(target) === source) return;
  if (isSymlink(target) && resolvedPath(target).startsWith(`${resolve(preflightRoot!, "skills")}/`)) return;
  if (source === resolve(preflightRoot!, "skills/unslop") && isExactLegacyUnslop(target)) return;
  if (!pathExists(target)) return;
  if (existsSync(source) && existsSync(target) && statSync(source).isFile() && statSync(target).isFile() && readFileSync(source).equals(readFileSync(target))) return;
  throw new Error(`Refusing to replace ${target}. Review it before using --replace.`);
}

if (mode === "preflight") {
  canLink(resolve(preflightRoot!, "agents/AGENTS.md"), resolve(home, ".pi/agent/AGENTS.md"));
  canLink(resolve(preflightRoot!, "agents/AGENTS.md"), resolve(home, ".claude/AGENTS.md"));
  canLink(resolve(preflightRoot!, "agents/CLAUDE.md"), resolve(home, ".claude/CLAUDE.md"));
  canLink(resolve(preflightRoot!, "scripts/heavy-check.ts"), heavyCheckTarget);
  for (const skill of manifest.skills) {
    for (const target of skill.targets) canLink(resolve(preflightRoot!, skill.path), resolve(targetRoot(home, target), skill.name));
  }
  console.log("Slop(e)style installation preflight passed.");
  process.exit(0);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function backupTarget(target: string): void {
  const relativeTarget = relative(home, target);
  let backup = resolve(home, ".slopestyle/backups", timestamp(), relativeTarget);
  let suffix = 1;
  while (pathExists(backup)) backup = `${backup}-${suffix++}`;
  mkdirSync(dirname(backup), { recursive: true });
  renameSync(target, backup);
  console.log(`Backed up ${target} to ${backup}`);
}

function linkOwned(source: string, target: string): void {
  if (isSymlink(target) && readlinkSync(target) === source) {
    console.log(`Already linked: ${target}`);
    return;
  }
  if (pathExists(target)) {
    const identicalFiles = existsSync(source) && existsSync(target) && statSync(source).isFile() && statSync(target).isFile() && readFileSync(source).equals(readFileSync(target));
    const ownedSkill = isSymlink(target) && resolvedPath(target).startsWith(`${resolve(repoRoot, "skills")}/`);
    if (!identicalFiles && !ownedSkill) {
      if (!replace) throw new Error(`Refusing to replace ${target}. Re-run with --replace after reviewing it.`);
      backupTarget(target);
    }
  }
  linkAtomic(source, target);
  console.log(`Linked ${target} -> ${source}`);
}

for (const path of legacyThrea) if (pathExists(path)) backupTarget(path);

for (const target of [resolve(home, ".pi/agent/skills/unslop"), resolve(home, ".claude/skills/unslop")]) {
  const source = resolve(repoRoot, "skills/unslop");
  if (isSymlink(target) && readlinkSync(target) === source) continue;
  if (isExactLegacyUnslop(target)) {
    backupTarget(target);
    console.log("Migrating unmodified external unslop to the managed local fork.");
    continue;
  }
  if (pathExists(target)) {
    if (!replace) throw new Error(`Installed unslop differs from the pinned upstream base. Review it before using --replace: ${target}`);
    backupTarget(target);
  }
}

linkOwned(resolve(repoRoot, "agents/AGENTS.md"), resolve(home, ".pi/agent/AGENTS.md"));
linkOwned(resolve(repoRoot, "agents/AGENTS.md"), resolve(home, ".claude/AGENTS.md"));
linkOwned(resolve(repoRoot, "agents/CLAUDE.md"), resolve(home, ".claude/CLAUDE.md"));
linkOwned(resolve(repoRoot, "scripts/heavy-check.ts"), heavyCheckTarget);

const expected = new Map<Target, Set<string>>([
  ["pi", new Set()],
  ["claude-code", new Set()],
]);
for (const skill of manifest.skills) {
  for (const target of skill.targets) {
    expected.get(target)!.add(skill.name);
    linkOwned(resolve(repoRoot, skill.path), resolve(targetRoot(home, target), skill.name));
  }
}

for (const [target, names] of expected) {
  const root = targetRoot(home, target);
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root)) {
    const candidate = resolve(root, name);
    if (!isSymlink(candidate)) continue;
    const source = resolvedPath(candidate);
    if (source.startsWith(`${resolve(repoRoot, "skills")}/`) && !names.has(basename(candidate))) {
      rmSync(candidate);
      console.log(`Removed retired Slop(e)style skill link: ${candidate}`);
    }
  }
}

const schedulerInstalled = process.platform === "linux"
  ? existsSync(resolve(home, ".config/systemd/user/slopestyle-sync.service")) || existsSync(resolve(home, ".config/systemd/user/slopestyle-sync.timer"))
  : process.platform === "darwin" && existsSync(resolve(home, "Library/LaunchAgents/dev.slopestyle.sync.plist"));
if (schedulerInstalled) {
  runOrThrow([process.execPath, resolve(repoRoot, "scripts/schedule-sync.ts"), "refresh"]);
}

console.log("Slop(e)style installation complete. Start fresh Pi and Claude Code sessions to load it.");

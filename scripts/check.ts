#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  assert,
  binRoot,
  isSymlink,
  loadManifest,
  pathExists,
  repoRoot,
  resolvedPath,
  sha256File,
  targetRoot,
  type Provenance,
  type Target,
} from "./lib/core.ts";

const args = process.argv.slice(2);
const installed = args.length === 1 && args[0] === "--installed";
if (args.length > (installed ? 1 : 0)) {
  console.error(`Usage: ${process.argv[1]} [--installed]`);
  process.exit(2);
}

const home = process.env.HOME;
if (!home) throw new Error("HOME is required.");
const minimumBunVersion = readFileSync(resolve(repoRoot, ".bun-version"), "utf8").trim();
assert(Bun.semver.satisfies(Bun.version, `>=${minimumBunVersion}`), `Slop(e)style requires Bun ${minimumBunVersion} or newer; found ${Bun.version}`);

const transpiler = new Bun.Transpiler({ loader: "ts" });
for (const pattern of ["scripts/**/*.ts", "tests/**/*.ts"]) {
  for (const path of new Bun.Glob(pattern).scanSync({ cwd: repoRoot, absolute: true, onlyFiles: true })) {
    transpiler.transformSync(readFileSync(path, "utf8"));
  }
}

const entryPoints = [
  "scripts/check.ts",
  "scripts/install.ts",
  "scripts/ports.ts",
  "scripts/schedule-sync.ts",
  "scripts/sync.ts",
  "scripts/usage.ts",
];
for (const relative of entryPoints) {
  const path = resolve(repoRoot, relative);
  assert(existsSync(path), `Missing script entry point: ${path}`);
  assert((statSync(path).mode & 0o111) !== 0, `Script entry point is not executable: ${path}`);
  assert(readFileSync(path, "utf8").startsWith("#!/usr/bin/env bun\n"), `Script entry point has the wrong shebang: ${path}`);
}
for (const relative of ["scripts/check.sh", "scripts/install.sh", "scripts/schedule-sync.sh", "scripts/sync.sh"]) {
  const path = resolve(repoRoot, relative);
  assert((statSync(path).mode & 0o111) !== 0, `Compatibility wrapper is not executable: ${path}`);
  assert(readFileSync(path, "utf8").startsWith("#!/bin/sh\n"), `Compatibility wrapper has the wrong shebang: ${path}`);
  assert(Bun.spawnSync(["sh", "-n", path], { stdout: "ignore", stderr: "ignore" }).success, `Compatibility wrapper has invalid shell syntax: ${path}`);
}

const manifest = loadManifest();
assert(manifest.schemaVersion === 1, "skills/manifest.json must use schemaVersion 1");

const allowedProvenance = new Set<Provenance>(["original", "adapted", "forked", "pointer", "synchronized"]);
const allowedTargets = new Set<Target>(["pi", "claude-code"]);
const names = new Set<string>();
const expectedDirectories = new Set<string>();

for (const skill of manifest.skills) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name), `Invalid skill name: ${JSON.stringify(skill.name)}`);
  assert(!names.has(skill.name), `Duplicate skill name: ${skill.name}`);
  names.add(skill.name);
  assert(skill.targets.length > 0 && skill.targets.every((target) => allowedTargets.has(target)), `Invalid targets for ${skill.name}`);
  assert(allowedProvenance.has(skill.provenance), `Invalid provenance for ${skill.name}: ${skill.provenance}`);

  const directory = realpathSync(resolve(repoRoot, skill.path));
  expectedDirectories.add(directory);
  const skillFile = resolve(directory, "SKILL.md");
  assert(existsSync(skillFile), `Missing SKILL.md for ${skill.name}: ${skillFile}`);
  const text = readFileSync(skillFile, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert(frontmatter, `Missing YAML frontmatter: ${skillFile}`);
  const foundName = frontmatter[1].match(/^name:\s*['"]?([^'"\n]+)/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  assert(foundName === skill.name, `Frontmatter name does not match directory for ${skill.name}`);
  assert(description, `Missing description for ${skill.name}`);
  assert(description.length <= 1024, `Description exceeds 1024 characters for ${skill.name}`);

  if (skill.provenance === "adapted") {
    for (const file of ["LICENSE", "NOTICE.md"]) assert(existsSync(resolve(directory, file)), `Adapted skill ${skill.name} is missing ${file}`);
  }

  if (skill.provenance === "forked") {
    for (const file of ["LICENSE", "NOTICE.md", "PATCH.md"]) assert(existsSync(resolve(directory, file)), `Forked skill ${skill.name} is missing ${file}`);
    assert(skill.source.startsWith("https://"), `Forked skill ${skill.name} needs a resolvable source URL`);
    assert(/^[0-9a-f]{40}$/.test(skill.upstreamCommit ?? ""), `Forked skill ${skill.name} needs a pinned upstreamCommit`);
    const notice = readFileSync(resolve(directory, "NOTICE.md"), "utf8");
    const patch = readFileSync(resolve(directory, "PATCH.md"), "utf8");
    assert(notice.includes(skill.upstreamCommit!), `Forked skill ${skill.name} NOTICE.md does not match upstreamCommit`);
    assert(patch.includes(skill.upstreamCommit!), `Forked skill ${skill.name} PATCH.md does not match upstreamCommit`);
    assert(/Unmodified `SKILL\.md` SHA-256: `[0-9a-f]{64}`/.test(patch), `Forked skill ${skill.name} PATCH.md needs its unmodified upstream hash`);
    const forkHash = patch.match(/Current fork `SKILL\.md` SHA-256: `([0-9a-f]{64})`/)?.[1];
    assert(forkHash === sha256File(skillFile), `Forked skill ${skill.name} PATCH.md does not match its current SKILL.md`);
  }

  if (skill.provenance === "synchronized") {
    assert(existsSync(resolve(directory, "NOTICE.md")), `Synchronized skill ${skill.name} is missing NOTICE.md`);
    assert(skill.source.startsWith("https://"), `Synchronized skill ${skill.name} needs a resolvable source URL`);
    assert(/^[0-9a-f]{40}$/.test(skill.upstreamCommit ?? ""), `Synchronized skill ${skill.name} needs a pinned upstreamCommit`);
  }
}

const actualDirectories = new Set(
  readdirSync(resolve(repoRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(repoRoot, "skills", entry.name, "SKILL.md")))
    .map((entry) => realpathSync(resolve(repoRoot, "skills", entry.name))),
);
const missing = [...expectedDirectories].filter((path) => !actualDirectories.has(path));
const extra = [...actualDirectories].filter((path) => !expectedDirectories.has(path));
assert(missing.length === 0 && extra.length === 0, `Manifest mismatch. Missing directories: ${missing.join(", ")}; unlisted directories: ${extra.join(", ")}`);

const externalNames = new Set<string>();
for (const external of manifest.external) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(external.name), `Invalid external skill name: ${external.name}`);
  assert(!names.has(external.name) && !externalNames.has(external.name), `Duplicate local or external skill: ${external.name}`);
  externalNames.add(external.name);
  assert(external.package && external.targets.length > 0 && external.targets.every((target) => allowedTargets.has(target)), `Incomplete external skill entry: ${external.name}`);
}

const writingDirectory = resolve(repoRoot, "skills/writing-for-agents");
const expectedWritingHash = readFileSync(resolve(writingDirectory, "UPSTREAM.sha256"), "utf8").trim();
assert(sha256File(resolve(writingDirectory, "SKILL.md")) === expectedWritingHash, "writing-for-agents/SKILL.md checksum mismatch");
console.log(`Validated ${expectedDirectories.size} local skills and ${manifest.external.length} external skills.`);
console.log("SKILL.md: OK");

if (installed) {
  const checkLink = (target: string, source: string): void => {
    assert(isSymlink(target), `Expected installed symlink: ${target}`);
    assert(resolvedPath(target) === resolvedPath(source), `Wrong installed target: ${target}`);
  };

  checkLink(resolve(home, ".pi/agent/AGENTS.md"), resolve(repoRoot, "agents/AGENTS.md"));
  checkLink(resolve(home, ".claude/AGENTS.md"), resolve(repoRoot, "agents/AGENTS.md"));
  checkLink(resolve(home, ".claude/CLAUDE.md"), resolve(repoRoot, "agents/CLAUDE.md"));
  checkLink(resolve(binRoot(home), "slopestyle-ports"), resolve(repoRoot, "scripts/ports.ts"));
  checkLink(resolve(binRoot(home), "slopestyle-usage"), resolve(repoRoot, "scripts/usage.ts"));
  assert(existsSync(resolve(repoRoot, "node_modules/echarts/package.json")), "Missing installed dependencies; run bun install --frozen-lockfile in the runtime checkout.");

  const expected = new Map<Target, Set<string>>([
    ["pi", new Set()],
    ["claude-code", new Set()],
  ]);
  for (const skill of manifest.skills) {
    for (const target of skill.targets) {
      expected.get(target)!.add(skill.name);
      checkLink(resolve(targetRoot(home, target), skill.name), resolve(repoRoot, skill.path));
    }
  }

  for (const target of allowedTargets) {
    const root = targetRoot(home, target);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const candidate = resolve(root, name);
      if (!isSymlink(candidate)) continue;
      const source = resolvedPath(candidate);
      if (source.startsWith(`${resolve(repoRoot, "skills")}/`) && !expected.get(target)!.has(name)) {
        throw new Error(`Retired Slop(e)style skill link remains installed: ${candidate}`);
      }
    }
  }

  for (const external of manifest.external) {
    for (const target of external.targets) {
      const path = resolve(targetRoot(home, target), external.name, "SKILL.md");
      assert(pathExists(path), `Missing required upstream skill: ${dirname(path)}`);
    }
  }
}

console.log("Slop(e)style checks passed.");

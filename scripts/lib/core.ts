import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export const repoRoot = realpathSync(resolve(import.meta.dir, "../.."));
export const manifestPath = resolve(repoRoot, "skills/manifest.json");

export type Target = "pi" | "claude-code";
export type Provenance = "original" | "adapted" | "forked" | "pointer" | "synchronized";

export interface SkillEntry {
  name: string;
  path: string;
  targets: Target[];
  requires: string[];
  source: string;
  provenance: Provenance;
  upstreamCommit?: string;
}

export interface ExternalSkillEntry {
  name: string;
  package: string;
  targets: Target[];
  requires: string[];
  source: string;
}

export interface Manifest {
  schemaVersion: number;
  skills: SkillEntry[];
  external: ExternalSkillEntry[];
}

export function loadManifest(path = manifestPath): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export function homePath(home: string, ...parts: string[]): string {
  return resolve(home, ...parts);
}

export function stableRoot(home: string): string {
  return homePath(home, ".local/share/slopestyle");
}

export function stateRoot(home: string): string {
  return homePath(home, ".local/state/slopestyle");
}

export function targetRoot(home: string, target: Target): string {
  return target === "pi" ? homePath(home, ".pi/agent/skills") : homePath(home, ".claude/skills");
}

export function pathExists(path: string): boolean {
  return existsSync(path) || isSymlink(path);
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolvedPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(realpathSync(dirname(path)), readlinkSync(path));
  }
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  quiet?: boolean;
  output?: (text: string) => void;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function run(command: string[], options: RunOptions = {}): RunResult {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (!options.quiet) {
    const write = options.output ?? ((text: string) => process.stdout.write(text));
    if (stdout) write(stdout);
    if (stderr) write(stderr);
  }
  return { exitCode: result.exitCode, stdout, stderr };
}

export function runOrThrow(command: string[], options: RunOptions = {}): RunResult {
  const result = run(command, options);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
  }
  return result;
}

export function commandExists(command: string): boolean {
  return Bun.which(command) !== null;
}

export function writeAtomic(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.slopestyle.${process.pid}`;
  writeFileSync(temporary, content, mode === undefined ? undefined : { mode });
  renameSync(temporary, path);
}

export function linkAtomic(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.slopestyle.${process.pid}`;
  rmSync(temporary, { force: true });
  symlinkSync(source, temporary);
  renameSync(temporary, target);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

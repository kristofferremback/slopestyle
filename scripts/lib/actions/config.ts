import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stateRoot } from "../core.ts";

export interface Pipeline {
  name: string;
  workflow: string;
}

export interface ActionsConfig {
  repo: string;
  pipelines: Pipeline[];
}

const exampleConfig: ActionsConfig = {
  repo: "example/app",
  pipelines: [
    { name: "Dev", workflow: "deploy.yaml" },
    { name: "Prod", workflow: "promote.yaml" },
  ],
};

export function defaultConfigPath(home: string): string {
  return resolve(stateRoot(home), "actions.json");
}

function record(value: unknown, allowed: string[], what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`Unknown ${what} field: ${unknown.join(", ")}`);
  return value as Record<string, unknown>;
}

export function parseActionsConfig(value: unknown): ActionsConfig {
  const config = record(value, ["repo", "pipelines"], "config");
  const repo = config.repo;
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('repo must look like "owner/name"');
  if (!Array.isArray(config.pipelines) || config.pipelines.length === 0) throw new Error("pipelines must be a non-empty array");
  const names = new Set<string>();
  const pipelines = config.pipelines.map((entry: unknown): Pipeline => {
    const pipeline = record(entry, ["name", "workflow"], "pipeline");
    const { name, workflow } = pipeline;
    if (typeof name !== "string" || name.trim() === "") throw new Error("pipeline name must be a non-empty string");
    if (typeof workflow !== "string" || !/^(\d+|[\w.-]+\.ya?ml)$/.test(workflow)) throw new Error(`pipeline ${name}: workflow must be a .yml/.yaml file name or a numeric id`);
    if (names.has(name)) throw new Error(`Duplicate pipeline name: ${name}`);
    names.add(name);
    return { name, workflow };
  });
  return { repo, pipelines };
}

export function loadActionsConfig(path: string): ActionsConfig {
  if (!existsSync(path)) throw new Error(`No Actions config at ${path}. Create it, for example:\n${JSON.stringify(exampleConfig, null, 2)}`);
  try {
    return parseActionsConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`Invalid Actions config ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

import { resolve } from "node:path";
import { homePath, repoRoot } from "./core.ts";

// Claude Code ignores effort asked for in an Agent call; only the agent type's
// definition carries model and effort. This matrix renders one blank-slate
// definition per model and effort so a brief can pick `opus-low` by name.
export const subagentModels = ["fable", "opus"] as const;
export const subagentEfforts = ["high", "medium", "low"] as const;
export type SubagentModel = (typeof subagentModels)[number];
export type SubagentEffort = (typeof subagentEfforts)[number];

const modelLabels: Record<SubagentModel, string> = { fable: "Fable", opus: "Opus" };

export const subagentsRoot = resolve(repoRoot, "subagents/claude-code");

export function subagentsTargetRoot(home: string): string {
  return homePath(home, ".claude/agents");
}

export interface Subagent {
  name: string;
  file: string;
  content: string;
}

export function renderSubagent(model: SubagentModel, effort: SubagentEffort): Subagent {
  const name = `${model}-${effort}`;
  const label = modelLabels[model];
  const content = `---
name: ${name}
description: Blank-slate subagent on ${label} at ${effort} effort. Use when the brief asks for ${label} on ${effort} or names ${name}.
model: ${model}
effort: ${effort}
---

Do the work in the brief. Report the outcome, the evidence behind it, and any caveats.
`;
  return { name, file: `${name}.md`, content };
}

export function subagentMatrix(): Subagent[] {
  return subagentModels.flatMap((model) => subagentEfforts.map((effort) => renderSubagent(model, effort)));
}

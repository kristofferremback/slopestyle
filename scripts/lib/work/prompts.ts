import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { PromptSnapshot, RunType } from "./types.ts";
export function digest(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
async function readSource(root: string, relativePath: string, kind: string) {
  const path = resolve(root, relativePath);
  if (!(await realpath(path)).startsWith((await realpath(root)) + sep))
    throw new Error(`Invalid ${kind} path`);
  return { path, text: await readFile(path, "utf8") };
}
export async function loadPrompt(
  promptRoot: string,
  skillRoot: string,
  type: RunType,
): Promise<PromptSnapshot> {
  if (!["morning", "pr-triage", "slack-follow-up"].includes(type))
    throw new Error("Unknown prompt type");
  const { path: file, text: prompt } = await readSource(
    promptRoot,
    `${type}.md`,
    "prompt",
  );
  const header = /^---\nworkflows:\n((?:  - [a-z0-9-]+\n)+)---\n/.exec(prompt);
  if (!header) throw new Error("Prompt requires workflows list frontmatter");
  const names = header[1]
    .trim()
    .split("\n")
    .map((line) => line.trim().slice(2));
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate workflow");
  let text = `Prompt source: ${file}\n\n${prompt.slice(header[0].length)}`;
  for (const name of names) {
    const workflow = await readSource(
      skillRoot,
      `${name}/SKILL.md`,
      "workflow",
    );
    text += `\n\nWorkflow source: ${workflow.path}\nResolve relative references from this source directory.\n\n${workflow.text}`;
  }
  if (text.length > 500_000) throw new Error("Prompt bundle too large");
  return { text, hash: digest(text) };
}

#!/usr/bin/env bun

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { writeAtomic } from "./lib/core.ts";
import { subagentMatrix, subagentsRoot } from "./lib/subagents.ts";

if (process.argv.length > 2) {
  console.error(`Usage: ${process.argv[1]}`);
  process.exit(2);
}

mkdirSync(subagentsRoot, { recursive: true });
const expected = new Set<string>();
for (const subagent of subagentMatrix()) {
  expected.add(subagent.file);
  writeAtomic(resolve(subagentsRoot, subagent.file), subagent.content);
  console.log(`Wrote ${subagent.file}`);
}
for (const file of readdirSync(subagentsRoot)) {
  if (file.endsWith(".md") && !expected.has(file)) {
    rmSync(resolve(subagentsRoot, file));
    console.log(`Removed retired ${file}`);
  }
}

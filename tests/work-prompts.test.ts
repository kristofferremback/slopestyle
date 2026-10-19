import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPrompt } from "../scripts/lib/work/prompts.ts";
import { parseWorkConfig } from "../scripts/lib/work/config.ts";

test("should reload workflow edits and preserve original path context in prompt snapshots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "work-prompts-"));
  try {
    await mkdir(join(dir, "workflow"));
    await writeFile(
      join(dir, "morning.md"),
      "---\nworkflows:\n  - workflow\n---\nPrepare overview.",
    );
    await writeFile(join(dir, "workflow/SKILL.md"), "first");

    const first = await loadPrompt(dir, dir, "morning");
    expect(first.text).toContain(join(dir, "workflow/SKILL.md"));

    await writeFile(join(dir, "workflow/SKILL.md"), "second");
    expect((await loadPrompt(dir, dir, "morning")).hash).not.toBe(first.hash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each(["../secret", "absent"])("should reject invalid or missing workflow %s", async (workflow) => {
  const dir = await mkdtemp(join(tmpdir(), "work-prompts-"));
  try {
    await writeFile(join(dir, "morning.md"), `---\nworkflows:\n  - ${workflow}\n---\ntext`);
    await expect(loadPrompt(dir, dir, "morning")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("should validate private configuration and allow standalone collection", () => {
  const config = {
    statePath: "/tmp/work/state.sqlite",
    watcherUrl: "http://127.0.0.1:1234",
    promptRoot: "/tmp/work/prompts",
    skillRoot: "/tmp/work/skills",
  };
  expect(parseWorkConfig(config).schedule).toEqual({
    time: "08:00",
    timezone: "Europe/Stockholm",
    weekdays: [1, 2, 3, 4, 5],
  });
  expect(parseWorkConfig(config).t3).toBeUndefined();
  expect(() =>
    parseWorkConfig({ ...config, watcherUrl: "https://external.example" }),
  ).toThrow();
  expect(() => parseWorkConfig({ ...config, unexpected: true })).toThrow();
  expect(() => parseWorkConfig({ ...config, poll: { slackMs: 0 } })).toThrow();
  expect(() => parseWorkConfig({ ...config, poll: null })).toThrow();
  expect(() => parseWorkConfig({ ...config, schedule: null })).toThrow();
  expect(() =>
    parseWorkConfig({ ...config, schedule: { weekdays: null } }),
  ).toThrow();
});

test("should reject prompt files that escape the configured root through symlinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "work-prompts-"));
  try {
    await mkdir(join(dir, "prompts"));
    await writeFile(
      join(dir, "outside.md"),
      "---\nworkflows:\n  - workflow\n---\nOutside",
    );
    await symlink(join(dir, "outside.md"), join(dir, "prompts/morning.md"));
    await expect(
      loadPrompt(join(dir, "prompts"), dir, "morning"),
    ).rejects.toThrow("Invalid prompt path");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

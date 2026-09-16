import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { AGENT_MAIL_COMMIT, loadMachinePolicy, planAgentMail, type CommandRunner, type RunOptions } from "../scripts/lib/agent-mail-install.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "agent-mail-install-"));
  roots.push(root);
  const home = resolve(root, "home");
  const runtimeRoot = resolve(root, "runtime");
  mkdirSync(resolve(runtimeRoot, "scripts"), { recursive: true });
  writeFileSync(resolve(runtimeRoot, "scripts/agent-mail.ts"), "");
  const upstreamRoot = resolve(home, ".local/share/agent-mail-trial");
  mkdirSync(resolve(upstreamRoot, "dist"), { recursive: true });
  writeFileSync(resolve(upstreamRoot, "dist/cli.js"), "");
  writeFileSync(resolve(upstreamRoot, "dist/unread.js"), "");
  const bunPath = resolve(home, ".bun/bin/bun");
  mkdirSync(dirname(bunPath), { recursive: true });
  writeFileSync(bunPath, "#!/bin/sh\n");
  chmodSync(bunPath, 0o755);
  const wrapper = resolve(runtimeRoot, "scripts/agent-mail.ts");
  const upstream = resolve(upstreamRoot, "dist/cli.js");
  const args = [wrapper, "--upstream", upstream];
  return { root, home, runtimeRoot, upstreamRoot, bunPath, args };
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function json(path: string, value: unknown): void { write(path, `${JSON.stringify(value, null, 2)}\n`); }

function installState(f: ReturnType<typeof fixture>, extras: { codex?: string; claude?: Record<string, unknown> } = {}): void {
  write(resolve(f.home, ".codex/config.toml"), extras.codex ?? `[mcp_servers.agent-mail]\ncommand = "${f.bunPath}"\nargs = ["${f.args.join('\", \"')}"]\n[mcp_servers.agent-mail.env]\nAGENT_MAIL_PORT = "20020"\n`);
  json(resolve(f.home, ".claude.json"), extras.claude ?? { mcpServers: { "agent-mail": { env: { AGENT_MAIL_PORT: "20020" }, args: f.args, command: f.bunPath, type: "stdio" } } });
  const handler = { type: "mcp_tool", server: "agent-mail", tool: "session_hook", input: { hook_event_name: "${hook_event_name}", session_id: "${session_id}" }, timeout: 15 };
  const hooks = {
    UserPromptSubmit: [{ hooks: [handler] }],
    PreToolUse: [{ hooks: [handler], matcher: "^mcp__agent-mail__(send_mail|list_sessions|check_inbox|mark_read)$" }],
    PostToolUse: [{ hooks: [handler] }],
  };
  json(resolve(f.home, ".codex/hooks.json"), { hooks });
  json(resolve(f.home, ".claude/settings.json"), { hooks });
}

function runner(f: ReturnType<typeof fixture>, calls: { command: string; args: string[]; options: RunOptions }[], fail?: string): CommandRunner {
  return (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "git") return { exitCode: 0, stdout: `${AGENT_MAIL_COMMIT}\n` };
    if (fail === command) return { exitCode: 1, stderr: "private failure" };
    if (command === "codex") {
      if (args[1] === "add") write(resolve(f.home, ".codex/config.toml"), `[mcp_servers.agent-mail]\ncommand = "${f.bunPath}"\nargs = ["${f.args.join('\", \"')}"]\n[mcp_servers.agent-mail.env]\nAGENT_MAIL_PORT = "20020"\n`);
      else write(resolve(f.home, ".codex/config.toml"), "theme = \"dark\"\n");
    }
    if (command === "claude") {
      const currentPath = resolve(f.home, ".claude.json");
      const current = existsSync(currentPath) ? JSON.parse(readFileSync(currentPath, "utf8")) : {};
      current.mcpServers ??= {};
      if (args[1] === "add") current.mcpServers["agent-mail"] = { type: "stdio", command: f.bunPath, args: f.args, env: { AGENT_MAIL_PORT: "20020" } };
      else delete current.mcpServers["agent-mail"];
      json(currentPath, current);
    }
    return { exitCode: 0 };
  };
}

describe("machine policy", () => {
  test("should reject missing, unknown, invalid, and duplicate policy entries", () => {
    const f = fixture();
    expect(() => loadMachinePolicy(f.root)).toThrow("Missing machine policy");
    for (const value of [{ agentMail: [], extra: true }, { agentMail: ["windows:pc"] }, { agentMail: ["linux:a", "linux:a"] }]) {
      json(resolve(f.root, "machines.json"), value);
      expect(() => loadMachinePolicy(f.root)).toThrow();
    }
    write(resolve(f.root, "machines.json"), "{");
    expect(() => loadMachinePolicy(f.root)).toThrow("Invalid JSON");
  });
});

describe("agent-mail install plan", () => {
  test("should adopt the stable home Bun registration regardless of the ambient Bun executable", async () => {
    const f = fixture(); installState(f);
    const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    const plan = planAgentMail({ home: f.home, runtimeRoot: f.runtimeRoot, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await plan.check();
  });

  test("should do nothing when policy is off and no owned state exists", async () => {
    const f = fixture(); const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    rmSync(f.bunPath);
    const plan = planAgentMail({ ...f, policy: { agentMail: [] }, machineId: "linux:other", run: runner(f, calls) });
    await plan.preflight(); await plan.check(); await plan.apply();
    expect(plan.enabled).toBe(false); expect(calls).toEqual([]);
    expect(existsSync(resolve(f.home, ".codex"))).toBe(false);
  });

  test("should adopt exact registrations and hooks without rewriting order-independent JSON", async () => {
    const f = fixture(); installState(f);
    json(resolve(f.home, ".claude/settings.json"), { unrelated: true, hooks: JSON.parse(readFileSync(resolve(f.home, ".claude/settings.json"), "utf8")).hooks });
    const before = readFileSync(resolve(f.home, ".claude/settings.json"));
    const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    const plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await plan.preflight(); await plan.check(); await plan.apply();
    expect(readFileSync(resolve(f.home, ".claude/settings.json"))).toEqual(before);
    expect(calls.some(({ command }) => command === "codex" || command === "claude")).toBe(false);
  });

  test("should add missing native registrations with HOME and env flags while preserving hook settings", async () => {
    const f = fixture(); const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    json(resolve(f.home, ".codex/hooks.json"), { theme: "dark", hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "ok" }] }] } });
    const plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await plan.preflight(); await expect(plan.check()).rejects.toThrow("registration is missing"); await plan.apply();
    const native = calls.filter(({ command }) => command !== "git");
    expect(native).toHaveLength(2);
    for (const call of native) { expect(call.args).toContain("--env"); expect(call.args).toContain("AGENT_MAIL_PORT=20020"); expect(call.options.env?.HOME).toBe(f.home); }
    expect(native[1]?.args).toContain("--scope"); expect(native[1]?.args).toContain("user");
    expect(native[1]?.args.indexOf("agent-mail")).toBeLessThan(native[1]?.args.indexOf("--env") ?? -1);
    const hooks = JSON.parse(readFileSync(resolve(f.home, ".codex/hooks.json"), "utf8"));
    expect(hooks.theme).toBe("dark"); expect(hooks.hooks.PreToolUse).toHaveLength(2);
    expect(statSync(resolve(f.home, ".claude/settings.json")).mode & 0o777).toBe(0o600);
  });

  test("should fail preflight on missing or unpinned enabled dependency before writes", async () => {
    const f = fixture(); const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    rmSync(resolve(f.runtimeRoot, "scripts/agent-mail.ts"));
    let plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await expect(plan.preflight()).rejects.toThrow("Missing agent-mail wrapper"); expect(calls).toEqual([]);
    write(resolve(f.runtimeRoot, "scripts/agent-mail.ts"), "");
    rmSync(resolve(f.upstreamRoot, "dist/unread.js"));
    plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await expect(plan.preflight()).rejects.toThrow("Missing built"); expect(calls).toEqual([]);
    write(resolve(f.upstreamRoot, "dist/unread.js"), "");
    plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: () => ({ exitCode: 0, stdout: "wrong\n" }) });
    await expect(plan.preflight()).rejects.toThrow("not pinned");
  });

  test("should require executable home Bun on enabled machines before mutations", async () => {
    const f = fixture(); const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    rmSync(f.bunPath);
    let plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await expect(plan.apply()).rejects.toThrow(`Agent-mail requires executable Bun at ${f.bunPath}. Install Bun there.`);
    expect(calls).toEqual([]);

    write(f.bunPath, "#!/bin/sh\n");
    chmodSync(f.bunPath, 0o644);
    plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: runner(f, calls) });
    await expect(plan.apply()).rejects.toThrow(`Agent-mail requires executable Bun at ${f.bunPath}. Install Bun there.`);
    expect(calls).toEqual([]);
  });

  test("should reject invalid registrations and hook conflicts before writes", async () => {
    const f = fixture(); const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    json(resolve(f.home, ".claude.json"), { mcpServers: { "agent-mail": { command: "other" } } });
    const plan = planAgentMail({ ...f, policy: { agentMail: [] }, machineId: "linux:test", run: runner(f, calls) });
    await expect(plan.apply()).rejects.toThrow("Conflicting Claude"); expect(calls).toEqual([]);
    rmSync(resolve(f.home, ".claude.json"));
    json(resolve(f.home, ".codex/hooks.json"), { hooks: { PreToolUse: [{ hooks: [{ server: "agent-mail", tool: "other" }] }] } });
    await expect(plan.apply()).rejects.toThrow("Conflicting agent-mail hook"); expect(calls).toEqual([]);
  });

  test("should remove only exact owned state and preserve unrelated settings", async () => {
    const f = fixture(); installState(f, { claude: { theme: "dark", mcpServers: { other: { command: "other" }, "agent-mail": { type: "stdio", command: f.bunPath, args: f.args, env: { AGENT_MAIL_PORT: "20020" } } } } });
    const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    const plan = planAgentMail({ ...f, policy: { agentMail: [] }, machineId: "linux:test", run: runner(f, calls) });
    await plan.apply(); await plan.check();
    expect(calls.map(({ command }) => command)).toEqual(["codex", "claude"]);
    const claude = JSON.parse(readFileSync(resolve(f.home, ".claude.json"), "utf8"));
    expect(claude).toEqual({ theme: "dark", mcpServers: { other: { command: "other" } } });
  });

  test("should not report success when native removal fails", async () => {
    const f = fixture(); installState(f); const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    const plan = planAgentMail({ ...f, policy: { agentMail: [] }, machineId: "linux:test", run: runner(f, calls, "codex") });
    await expect(plan.apply()).rejects.toThrow("codex agent-mail MCP update failed");
    expect(existsSync(resolve(f.home, ".codex/hooks.json"))).toBe(true);
  });

  test("should refuse a concurrent hook edit without overwriting it", async () => {
    const f = fixture(); const path = resolve(f.home, ".codex/hooks.json"); json(path, { before: true });
    const calls: { command: string; args: string[]; options: RunOptions }[] = [];
    const base = runner(f, calls);
    const mutate: CommandRunner = async (command, args, options) => {
      const result = await base(command, args, options);
      if (command === "claude") json(path, { concurrent: true });
      return result;
    };
    const plan = planAgentMail({ ...f, policy: { agentMail: ["darwin:test"] }, machineId: "darwin:test", run: mutate });
    await expect(plan.apply()).rejects.toThrow("Changed during agent-mail apply");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ concurrent: true });
  });
});

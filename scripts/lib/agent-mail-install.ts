import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const AGENT_MAIL_COMMIT = "397a010355d3fabdab26bf8c6545dd8092e83f38";
const AGENT_MAIL_PORT = "20020";
const HOOK_EVENTS = ["UserPromptSubmit", "PreToolUse", "PostToolUse"] as const;
type JsonObject = Record<string, unknown>;
type HookEvent = (typeof HOOK_EVENTS)[number];

const hookHandler = (): JsonObject => ({ type: "mcp_tool", server: "agent-mail", tool: "session_hook", input: { session_id: "${session_id}", hook_event_name: "${hook_event_name}" }, timeout: 15 });
const MANAGED_HOOKS: Record<HookEvent, JsonObject> = {
  UserPromptSubmit: { hooks: [hookHandler()] },
  PreToolUse: { matcher: "^mcp__agent-mail__(send_mail|list_sessions|check_inbox|mark_read)$", hooks: [hookHandler()] },
  PostToolUse: { hooks: [hookHandler()] },
};

export type MachinePolicy = { agentMail: string[] };
export type CommandResult = { exitCode: number; stdout?: string; stderr?: string };
export type RunOptions = { cwd?: string; env?: Record<string, string | undefined> };
export type CommandRunner = (command: string, args: string[], options: RunOptions) => CommandResult | Promise<CommandResult>;
export type AgentMailPlan = { enabled: boolean; preflight(): Promise<void>; check(): Promise<void>; apply(): Promise<void> };

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPolicy(value: unknown): asserts value is MachinePolicy {
  if (!isObject(value)) throw new Error("machines.json must contain an object");
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "agentMail") throw new Error("machines.json must contain only the agentMail key");
  const entries = value.agentMail;
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !/^(darwin|linux):[A-Za-z0-9._-]+$/.test(entry))) {
    throw new Error("machines.json agentMail must contain valid darwin:hostname or linux:hostname entries");
  }
  if (new Set(entries).size !== entries.length) throw new Error("machines.json agentMail contains duplicate entries");
}

export function loadMachinePolicy(root: string): MachinePolicy {
  const path = resolve(root, "machines.json");
  if (!existsSync(path)) throw new Error(`Missing machine policy: ${path}`);
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`Invalid JSON in machine policy: ${path}`); }
  assertPolicy(parsed);
  return { agentMail: [...parsed.agentMail] };
}

export function currentMachineId(): string {
  if (process.platform === "darwin") {
    const result = Bun.spawnSync(["/usr/sbin/scutil", "--get", "LocalHostName"], { stdout: "pipe", stderr: "pipe" });
    if (!result.success) throw new Error("Unable to read macOS LocalHostName");
    const name = result.stdout.toString().trim();
    if (!name) throw new Error("macOS LocalHostName is empty");
    return `darwin:${name}`;
  }
  if (process.platform === "linux") return `linux:${osHostname()}`;
  return `${process.platform}:${osHostname()}`;
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`Invalid JSON: ${path}`); }
  if (!isObject(parsed)) throw new Error(`Expected a JSON object: ${path}`);
  return parsed;
}

function readCodexRegistration(path: string): unknown {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try { parsed = Bun.TOML.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`Invalid TOML: ${path}`); }
  if (!isObject(parsed)) throw new Error(`Expected a TOML object: ${path}`);
  if (parsed.mcp_servers === undefined) return undefined;
  if (!isObject(parsed.mcp_servers)) throw new Error(`Invalid mcp_servers table: ${path}`);
  return parsed.mcp_servers["agent-mail"];
}

function readClaudeRegistration(path: string): unknown {
  const config = readJsonObject(path);
  if (config.mcpServers === undefined) return undefined;
  if (!isObject(config.mcpServers)) throw new Error(`Invalid mcpServers object: ${path}`);
  return config.mcpServers["agent-mail"];
}

function containsAgentMailHandler(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAgentMailHandler);
  if (!isObject(value)) return false;
  if (value.server === "agent-mail") return true;
  return Object.values(value).some(containsAgentMailHandler);
}

type HookFileState = { path: string; data: JsonObject; snapshot?: Buffer; managed: Map<HookEvent, number> };

function inspectHookFile(path: string): HookFileState {
  const snapshot = existsSync(path) ? readFileSync(path) : undefined;
  const data = readJsonObject(path);
  if (data.hooks !== undefined && !isObject(data.hooks)) throw new Error(`Invalid hooks object: ${path}`);
  const hooks = data.hooks ?? {};
  const managed = new Map<HookEvent, number>();
  for (const [event, groupsValue] of Object.entries(hooks)) {
    if (!Array.isArray(groupsValue)) throw new Error(`Invalid hook list for ${event}: ${path}`);
    for (let index = 0; index < groupsValue.length; index += 1) {
      const group = groupsValue[index];
      if (!containsAgentMailHandler(group)) continue;
      if (HOOK_EVENTS.includes(event as HookEvent) && isDeepStrictEqual(group, MANAGED_HOOKS[event as HookEvent]) && !managed.has(event as HookEvent)) {
        managed.set(event as HookEvent, index);
      } else {
        throw new Error(`Conflicting agent-mail hook in ${path}`);
      }
    }
  }
  return { path, data, snapshot, managed };
}

function atomicWrite(path: string, value: JsonObject, snapshot?: Buffer): void {
  const current = existsSync(path) ? readFileSync(path) : undefined;
  const unchanged = snapshot === undefined ? current === undefined : current?.equals(snapshot) === true;
  if (!unchanged) throw new Error(`Changed during agent-mail apply: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
}

function updatedHooks(state: HookFileState, enabled: boolean): JsonObject | undefined {
  const result = structuredClone(state.data);
  let hooks = result.hooks as JsonObject | undefined;
  let changed = false;
  if (enabled && hooks === undefined) { hooks = {}; result.hooks = hooks; }
  if (hooks === undefined) return undefined;
  for (const event of HOOK_EVENTS) {
    const groups = (hooks[event] as unknown[] | undefined) ?? [];
    const managedIndex = groups.findIndex((group) => isDeepStrictEqual(group, MANAGED_HOOKS[event]));
    if (enabled && managedIndex < 0) { hooks[event] = [...groups, structuredClone(MANAGED_HOOKS[event])]; changed = true; }
    else if (!enabled && managedIndex >= 0) { hooks[event] = groups.filter((_, index) => index !== managedIndex); changed = true; }
  }
  return changed ? result : undefined;
}

function registrationState(actual: unknown, expected: JsonObject, provider: string): "missing" | "owned" {
  if (actual === undefined) return "missing";
  if (isDeepStrictEqual(actual, expected)) return "owned";
  throw new Error(`Conflicting ${provider} agent-mail definition`);
}

export function planAgentMail({ home, runtimeRoot, policy, machineId, run }: {
  home: string; runtimeRoot: string; policy: MachinePolicy; machineId: string; run?: CommandRunner;
}): AgentMailPlan {
  assertPolicy(policy);
  const enabled = policy.agentMail.includes(machineId);
  const agentMailRoot = resolve(home, ".local/share/agent-mail-trial");
  const upstream = resolve(agentMailRoot, "dist/cli.js");
  const wrapper = resolve(runtimeRoot, "scripts/agent-mail.ts");
  const bunPath = resolve(home, ".bun/bin/bun");
  const commandArgs = [wrapper, "--upstream", upstream];
  const environment = { AGENT_MAIL_PORT };
  const codexConfig = resolve(home, ".codex/config.toml");
  const claudeConfig = resolve(home, ".claude.json");
  const hookPaths = [resolve(home, ".codex/hooks.json"), resolve(home, ".claude/settings.json")];
  const expectedCodex = { command: bunPath, args: commandArgs, env: environment };
  const expectedClaude = { type: "stdio", command: bunPath, args: commandArgs, env: environment };
  const usesDefaultRunner = run === undefined;
  const runner: CommandRunner = run ?? ((command, args, options) => {
    const processResult = Bun.spawnSync([command, ...args], { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" });
    return { exitCode: processResult.exitCode, stdout: processResult.stdout.toString(), stderr: processResult.stderr.toString() };
  });
  const runOptions = (cwd?: string): RunOptions => ({ cwd, env: { ...process.env, HOME: home } });

  const inspect = () => ({
    codex: registrationState(readCodexRegistration(codexConfig), expectedCodex, "Codex"),
    claude: registrationState(readClaudeRegistration(claudeConfig), expectedClaude, "Claude"),
    hooks: hookPaths.map(inspectHookFile),
  });
  const validateDependency = async (): Promise<void> => {
    if (!enabled) return;
    try { accessSync(bunPath, constants.X_OK); }
    catch { throw new Error(`Agent-mail requires executable Bun at ${bunPath}. Install Bun there.`); }
    if (!existsSync(wrapper)) throw new Error(`Missing agent-mail wrapper: ${wrapper}`);
    if (!existsSync(upstream) || !existsSync(resolve(agentMailRoot, "dist/unread.js"))) throw new Error(`Missing built agent-mail checkout: ${agentMailRoot}`);
    const revision = await runner("git", ["rev-parse", "HEAD"], runOptions(agentMailRoot));
    if (revision.exitCode !== 0 || revision.stdout?.trim() !== AGENT_MAIL_COMMIT) throw new Error(`Agent-mail checkout is not pinned to ${AGENT_MAIL_COMMIT}: ${agentMailRoot}`);
  };
  const preflight = async (): Promise<void> => {
    const state = inspect();
    await validateDependency();
    if (usesDefaultRunner) {
      const needsCodex = enabled ? state.codex === "missing" : state.codex === "owned";
      const needsClaude = enabled ? state.claude === "missing" : state.claude === "owned";
      if (needsCodex && !Bun.which("codex")) throw new Error("Missing codex executable for agent-mail MCP update");
      if (needsClaude && !Bun.which("claude")) throw new Error("Missing claude executable for agent-mail MCP update");
    }
  };
  const check = async (): Promise<void> => {
    const state = inspect();
    await validateDependency();
    const wanted = enabled ? "owned" : "missing";
    if (state.codex !== wanted) throw new Error(`Codex agent-mail registration is ${state.codex}`);
    if (state.claude !== wanted) throw new Error(`Claude agent-mail registration is ${state.claude}`);
    for (const hooks of state.hooks) for (const event of HOOK_EVENTS) {
      if (hooks.managed.has(event) !== enabled) throw new Error(`Agent-mail ${event} hook has unexpected state: ${hooks.path}`);
    }
  };
  const execute = async (command: string, args: string[]): Promise<void> => {
    const result = await runner(command, args, runOptions());
    if (result.exitCode !== 0) throw new Error(`${command} agent-mail MCP update failed`);
  };
  const apply = async (): Promise<void> => {
    await preflight();
    const state = inspect();
    if (enabled && state.codex === "missing") await execute("codex", ["mcp", "add", "agent-mail", "--env", `AGENT_MAIL_PORT=${AGENT_MAIL_PORT}`, "--", bunPath, ...commandArgs]);
    else if (!enabled && state.codex === "owned") await execute("codex", ["mcp", "remove", "agent-mail"]);
    if (enabled && state.claude === "missing") await execute("claude", ["mcp", "add", "--scope", "user", "agent-mail", "--env", `AGENT_MAIL_PORT=${AGENT_MAIL_PORT}`, "--", bunPath, ...commandArgs]);
    else if (!enabled && state.claude === "owned") await execute("claude", ["mcp", "remove", "--scope", "user", "agent-mail"]);
    for (const hooks of state.hooks) {
      const updated = updatedHooks(hooks, enabled);
      if (updated !== undefined) atomicWrite(hooks.path, updated, hooks.snapshot);
    }
    await check();
  };
  return { enabled, preflight, check, apply };
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkConfig } from "./types.ts";
export interface ManagedSession {
  call(tool: string, args: unknown): Promise<unknown>;
  close(): Promise<void>;
}
export type SlackConfig = NonNullable<WorkConfig["slack"]>;
export const SLACK_APP = "asdk_app_69a1d78e929881919bba0dbda1f6436d";
export const SLACK_TOOLS = [
  "slack.slack_search_public_and_private",
  "slack.slack_read_thread",
];
const failure = () => new Error("Slack managed read unavailable or unverified");
export function verifySlackTools(
  tools: Record<string, any>,
  cfg: SlackConfig,
): void {
  for (const name of SLACK_TOOLS) {
    const t = tools[name],
      owner = t?._meta?.link_owner_profile;
    if (
      t?.annotations?.readOnlyHint !== true ||
      t?.annotations?.destructiveHint !== false ||
      t?._meta?.connector_id !== SLACK_APP ||
      owner?.email?.toLowerCase() !== cfg.email.toLowerCase() ||
      owner?.id !== `${cfg.workspace}:${cfg.user}`
    )
      throw failure();
  }
}
export function managedPayload(result: any): unknown {
  if (result?.isError) throw failure();
  if (result?.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  if (result?.content?.length === 1 && result.content[0].type === "text") {
    try {
      return JSON.parse(result.content[0].text);
    } catch {
      /* fail closed */
    }
  }
  throw failure();
}
function managedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    ["HOME", "PATH", "LANG", "TMPDIR", "USER", "CODEX_HOME"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  );
}
export async function verifyChatGPTLogin(path: string): Promise<void> {
  const env = managedEnvironment();
  const login = Bun.spawn([path, "login", "status"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const loginTimer = setTimeout(() => login.kill("SIGKILL"), 5000);
  try {
    let length = 0;
    const bounded = async (stream: ReadableStream<Uint8Array>) => {
      let output = "";
      for await (const chunk of stream) {
        length += chunk.length;
        if (length > 4096) {
          login.kill("SIGKILL");
          throw failure();
        }
        output += new TextDecoder().decode(chunk);
      }
      return output;
    };
    const output = (
      await Promise.all([bounded(login.stdout), bounded(login.stderr)])
    ).join("\n");
    if ((await login.exited) !== 0 || !/Logged in using ChatGPT/i.test(output))
      throw failure();
  } finally {
    clearTimeout(loginTimer);
  }
}
function openReadOnlyRpc(cfg: SlackConfig) {
  const env = managedEnvironment();
  const work = mkdtempSync(join(tmpdir(), "work-slack-"));
  const child = Bun.spawn(
    [
      cfg.codexPath,
      "--enable",
      "apps",
      ...[
        "plugins",
        "shell_tool",
        "multi_agent",
        "computer_use",
        "browser_use",
        "image_generation",
      ].flatMap((k) => ["--disable", k]),
      "app-server",
      "--stdio",
      "-c",
      "mcp_servers={}",
      "-c",
      "apps._default.enabled=false",
      "-c",
      `apps.${SLACK_APP}.enabled=true`,
      "-c",
      `apps.${SLACK_APP}.default_tools_enabled=false`,
    ],
    {
      env,
      cwd: work,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    },
  );
  let next = 0,
    closed = false,
    size = 0;
  const waiting = new Map<
    number,
    { resolve(v: any): void; reject(e: Error): void }
  >();
  const kill = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const stop = () => {
    closed = true;
    kill();
    for (const p of waiting.values()) p.reject(failure());
    waiting.clear();
  };
  const timer = setTimeout(stop, 120_000);
  const send = (value: unknown) =>
    child.stdin.write(JSON.stringify(value) + "\n");
  const read = (async () => {
    let pending = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of child.stdout) {
        size += chunk.length;
        if (size > 8_000_000) throw failure();
        pending += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = pending.indexOf("\n")) >= 0) {
          const message = JSON.parse(pending.slice(0, i));
          pending = pending.slice(i + 1);
          if (message.method) {
            if (message.id !== undefined)
              send({
                id: message.id,
                error: { code: -32601, message: "Read-only collector" },
              });
            continue;
          }
          const waiter = waiting.get(message.id);
          if (waiter) {
            waiting.delete(message.id);
            if (message.error) waiter.reject(failure());
            else waiter.resolve(message.result);
          }
        }
      }
    } catch {
      /* sanitized below */
    }
    if (!closed) stop();
  })();
  const errors = (async () => {
    for await (const chunk of child.stderr) {
      size += chunk.length;
      if (size > 8_000_000) {
        stop();
        break;
      }
    }
  })();
  const request = (method: string, params: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      if (closed) return reject(failure());
      const id = ++next;
      waiting.set(id, { resolve, reject });
      send({ id, method, params });
    });
  const close = async () => {
    stop();
    clearTimeout(timer);
    await Promise.race([
      Promise.allSettled([read, errors, child.exited]),
      Bun.sleep(2000),
    ]);
    rmSync(work, { recursive: true, force: true });
  };
  return { request, close, work };
}
export async function openManagedSession(
  cfg: SlackConfig,
): Promise<ManagedSession> {
  await verifyChatGPTLogin(cfg.codexPath);
  const { request, close, work } = openReadOnlyRpc(cfg);
  try {
    await request("initialize", {
      clientInfo: { name: "work-slack-collector", version: "1" },
      capabilities: { experimentalApi: true },
    });
    const thread = await request("thread/start", {
      ephemeral: true,
      cwd: work,
      sandbox: "read-only",
      approvalPolicy: "never",
      config: {
        "features.shell_tool": false,
        "features.multi_agent": false,
        "features.plugins": false,
      },
    });
    const threadId = thread?.thread?.id;
    if (typeof threadId !== "string") throw failure();
    const inventory = await request("mcpServerStatus/list", {
      threadId,
      serverName: "codex_apps",
      detail: "toolsAndAuthOnly",
      limit: 1,
    });
    verifySlackTools(
      inventory?.data?.find((s: any) => s.name === "codex_apps")?.tools ?? {},
      cfg,
    );
    return {
      async call(tool, args) {
        if (!SLACK_TOOLS.includes(tool)) throw failure();
        return managedPayload(
          await request("mcpServer/tool/call", {
            threadId,
            server: "codex_apps",
            tool,
            arguments: args,
          }),
        );
      },
      close,
    };
  } catch {
    await close();
    throw failure();
  }
}

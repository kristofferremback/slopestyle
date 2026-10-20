import { verifyChatGPTLogin } from "./managed-apps.ts";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkStore } from "./store.ts";
import type { Json, WorkConfig, WorkRun } from "./types.ts";

interface Turn {
  threadId: string;
  commandId: string;
  messageId: string;
  text: string;
  runtimeMode: string;
  interactionMode: string;
  createdAt: string;
  modelSelection: {
    instanceId: string;
    model: string;
    options: { id: string; value: string }[];
  };
}
interface Client {
  readThread(): Promise<{
    status: string;
    lifecycle?: string;
    thread?: {
      id: string;
      projectId: string;
      snoozedUntil: string | null;
      runtimeMode: string;
      interactionMode: string;
      modelSelection: Turn["modelSelection"];
    };
  }>;
  startTurn(request: Turn): Promise<{ sequence: number }>;
}
export async function deliverT3(
  config: WorkConfig,
  store: WorkStore,
  run: WorkRun,
): Promise<boolean> {
  if (!config.t3) throw new Error("T3 is not configured");
  try {
    const cfg = config.t3;
    const raw = await Bun.file(cfg.configPath).json();
    const wake = raw?.t3Wake;
    if (
      !wake ||
      typeof wake.baseDir !== "string" ||
      !isAbsolute(wake.baseDir) ||
      typeof wake.appPath !== "string" ||
      !isAbsolute(wake.appPath)
    )
      throw new Error();
    const module = await import(pathToFileURL(cfg.modulePath).href);
    if (typeof module.withT3Client !== "function") throw new Error();
    await verifyChatGPTLogin(config.slack?.codexPath ?? "codex");
    return await module.withT3Client(
      {
        baseDir: wake.baseDir,
        appPath: wake.appPath,
        threadId: cfg.threadId,
        projectId: cfg.projectId,
      },
      async (client: Client) => {
        const result = await client.readThread();
        const thread = result.thread;
        if (
          result.status !== "found" ||
          !thread ||
          thread.id !== cfg.threadId ||
          thread.projectId !== cfg.projectId ||
          thread.modelSelection?.instanceId !== "codex"
        )
          throw new Error();
        if (
          result.lifecycle === "busy" ||
          (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > Date.now())
        )
          return false;
        if (
          ![
            "approval-required",
            "auto-accept-edits",
            "auto",
            "full-access",
          ].includes(thread.runtimeMode) ||
          !["default", "plan"].includes(thread.interactionMode)
        )
          throw new Error();
        let request = store.delivery(run.id) as unknown as Turn | null;
        if (!request) {
          const id = `slopestyle-work:${run.id}`;
          request = {
            threadId: cfg.threadId,
            commandId: id,
            messageId: id,
            text: run.prompt.text,
            createdAt: new Date().toISOString(),
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            modelSelection: thread.modelSelection,
          };
          request = store.saveDelivery(
            run.id,
            request as unknown as Json,
          ) as unknown as Turn;
        }
        if (request.threadId !== cfg.threadId) throw new Error();
        const receipt = await client.startTurn(request);
        if (!Number.isSafeInteger(receipt?.sequence)) throw new Error();
        return true;
      },
    );
  } catch {
    throw new Error("T3 delivery unavailable or unverified");
  }
}

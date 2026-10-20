#!/usr/bin/env bun
import { resolve } from "node:path";
import homepage from "./work/index.html";
import { collectGithub, collectSlack } from "./lib/work/collect.ts";
import { loadWorkConfig } from "./lib/work/config.ts";
import { workPort } from "./lib/work/port.ts";
import { loadPrompt } from "./lib/work/prompts.ts";
import { createWorkRuntime, prepareWorkRun } from "./lib/work/runtime.ts";
import { createWorkServer, workStatus } from "./lib/work/server.ts";
import {
  manageService,
  serviceActions,
  type ServiceAction,
} from "./lib/work/service.ts";
import { WorkStore } from "./lib/work/store.ts";
import type { RunType } from "./lib/work/types.ts";

function usage(): void {
  console.log(`Usage: slopestyle-work COMMAND --config /absolute/private/config.json [--port N]
  serve                   Collect independently and serve the local API
  poll                    Collect once, without waking T3
  status                  Print durable state and source health
  prompts TYPE            Read current Markdown and workflow bundle
  prepare TYPE            Snapshot a run without dispatching
  complete ID             Explicitly complete a dispatched run and acknowledge its changes
  follow CHANNEL TS       Follow a Slack thread
  unfollow CHANNEL TS     Stop following a Slack thread
  service install|refresh|status|uninstall
Types: morning, pr-triage, slack-follow-up.
Default port comes from slopestyle-ports show/claim --app slopestyle-work.`);
}
async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  let configPath: string | undefined;
  let port: number | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--config" || arg === "--port") {
      const value = args[++index];
      if (!value) throw new Error("Missing option value");
      if (arg === "--config") configPath = resolve(value);
      else {
        port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error("Invalid port");
      }
    } else if (arg.startsWith("-")) throw new Error("Unknown option");
    else positional.push(arg);
  }
  const counts: Record<string, number> = {
    serve: 0,
    poll: 0,
    status: 0,
    prompts: 1,
    prepare: 1,
    complete: 1,
    follow: 2,
    unfollow: 2,
    service: 1,
  };
  if (counts[command] === undefined || positional.length !== counts[command])
    throw new Error("Invalid command arguments");
  if (port !== undefined && command !== "serve")
    throw new Error("--port is only valid with serve");
  if (command === "service") {
    if (!(serviceActions as readonly string[]).includes(positional[0]))
      throw new Error("Invalid service action");
    const home = process.env.HOME;
    if (!home) throw new Error("HOME is required");
    await manageService(positional[0] as ServiceAction, home, configPath);
    return;
  }
  if (!configPath) throw new Error("--config is required");
  const config = await loadWorkConfig(configPath);
  const store = new WorkStore(config.statePath);
  let serving = false;
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  const type = () => {
    if (!["morning", "pr-triage", "slack-follow-up"].includes(positional[0]))
      throw new Error("Invalid prompt type");
    return positional[0] as RunType;
  };
  try {
    if (command === "poll") {
      await Promise.all([
        collectGithub(store, config),
        collectSlack(store, config),
      ]);
      print(workStatus(store));
    } else if (command === "status") print(workStatus(store));
    else if (command === "prompts")
      print(await loadPrompt(config.promptRoot, config.skillRoot, type()));
    else if (command === "prepare")
      print(
        await prepareWorkRun(
          store,
          config,
          type(),
          `http://127.0.0.1:${workPort()}`,
        ),
      );
    else if (command === "complete") print(store.completeRun(positional[0]));
    else if (command === "follow" || command === "unfollow") {
      if (command === "follow") store.follow(positional[0], positional[1]);
      else store.unfollow(positional[0], positional[1]);
      print(store.followed());
    } else if (command === "serve") {
      const selectedPort = port ?? workPort();
      const runtime = createWorkRuntime({
        store,
        config,
        apiUrl: `http://127.0.0.1:${selectedPort}`,
      });
      const server = createWorkServer({
        store,
        config,
        port: selectedPort,
        homepage,
        refresh: runtime.refresh,
        runtimeStatus: runtime.status,
        prepare: runtime.prepare,
      });
      serving = true;
      runtime.start();
      console.log(
        `slopestyle-work listening at http://127.0.0.1:${server.port}/`,
      );
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await server.stop();
        await runtime.stop();
        store.close();
      };
      process.once("SIGINT", () => void stop());
      process.once("SIGTERM", () => void stop());
    }
  } finally {
    if (!serving) store.close();
  }
}
try {
  await main();
} catch {
  console.error(
    "Work command failed. Check command arguments, private configuration, and local source availability.",
  );
  process.exitCode = 1;
}

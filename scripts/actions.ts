#!/usr/bin/env bun

import { resolve } from "node:path";
import { runOrThrow } from "./lib/core.ts";
import { manageUserService, type ServiceAction, serviceActions } from "./lib/user-service.ts";
import { defaultConfigPath, loadActionsConfig } from "./lib/actions/config.ts";
import { createGithubClient } from "./lib/actions/github.ts";
import { createActionsServer, createPoller } from "./lib/actions/server.ts";
import { servicePort } from "./lib/service-port.ts";
import homepage from "./actions/index.html";

function usage(exitCode: number, message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: slopestyle-actions <command> [options]

Commands:
  serve [--port N] [--config PATH]
      Poll GitHub Actions for the configured pipelines and serve the page on
      127.0.0.1. Without --port the port comes from "slopestyle-ports claim actions".
  snapshot [--config PATH]
      Poll once and print the JSON the page renders.
  service install|refresh|status|uninstall
      Keep "serve" running in the login session as a macOS LaunchAgent or a
      systemd user service, with the default config. The installer refreshes
      it after every sync.

Defaults:
  --config  $HOME/.local/state/slopestyle/actions.json

The config names one repository and its pipelines, each a display name and a
workflow file: {"repo": "owner/name", "pipelines": [{"name": "Dev", "workflow": "deploy.yaml"}]}.
Requests use the token from "gh auth token".`);
  process.exit(exitCode);
}

const home = process.env.HOME;
if (!home) throw new Error("HOME is required.");

const args = process.argv.slice(2);
const command = args.shift();
if (command === "service") {
  const action = args[0];
  if (args.length !== 1 || !(serviceActions as readonly string[]).includes(action)) usage(2, "service needs exactly one of install, refresh, status, or uninstall");
  // A service started without a valid config would only restart and fail, so install refuses one.
  if (action === "install") config(defaultConfigPath(home));
  manageUserService("actions", action as ServiceAction, home);
  process.exit(0);
}
const options = { port: undefined as number | undefined, config: defaultConfigPath(home) };
for (let index = 0; index < args.length; index += 1) {
  const value = () => {
    const next = args[++index];
    if (next === undefined) usage(2, `${args[index - 1]} needs a value`);
    return next;
  };
  switch (args[index]) {
    case "--port":
      options.port = Number(value());
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) usage(2, "--port must be an integer from 0 to 65535");
      break;
    case "--config":
      options.config = resolve(value());
      break;
    case "-h":
    case "--help":
      usage(0);
      break;
    default:
      usage(2, `Unknown argument: ${args[index]}`);
  }
}

function config(path = options.config) {
  try {
    return loadActionsConfig(path);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

function githubClient() {
  const token = runOrThrow(["gh", "auth", "token"], { quiet: true }).stdout.trim();
  if (!token) throw new Error('"gh auth token" returned nothing. Run "gh auth login".');
  return createGithubClient({ token });
}

switch (command) {
  case "serve": {
    const loaded = config();
    const server = createActionsServer({ config: loaded, client: githubClient(), port: options.port ?? servicePort("slopestyle-actions", "actions"), homepage });
    console.log(`slopestyle-actions serving ${loaded.repo} at http://127.0.0.1:${server.port}/`);
    break;
  }
  case "snapshot": {
    try {
      console.log(JSON.stringify(await createPoller(config(), githubClient(), Infinity)(), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    break;
  }
  case undefined:
  case "-h":
  case "--help":
    usage(command === undefined ? 2 : 0);
    break;
  default:
    usage(2, `Unknown command: ${command}`);
}

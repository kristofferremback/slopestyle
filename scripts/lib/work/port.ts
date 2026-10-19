import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { stateRoot } from "../core.ts";
import { servicePort, type PortOptions } from "../service-port.ts";

export function workPort(options: PortOptions = {}): number {
  const cwd = options.cwd ?? resolve(stateRoot(options.env?.HOME ?? process.env.HOME ?? homedir()), "work-port");
  if (!options.cwd) mkdirSync(cwd, { recursive: true, mode: 0o700 });
  return servicePort("slopestyle-work", "work", { ...options, cwd });
}

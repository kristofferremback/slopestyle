import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { assert, stateRoot, writeAtomic } from "../core.ts";
import { manageUserService, serviceInstalled as installed, servicePaths as paths, type ServiceAction } from "../user-service.ts";
import { loadWorkConfig } from "./config.ts";
export { serviceActions, type ServiceAction } from "../user-service.ts";
export const servicePaths = (home: string) => paths("work", home);
export const serviceInstalled = (home: string) => installed("work", home);
export const serviceConfigPath = (home: string) => resolve(stateRoot(home), "work-service-config-path");

// Persist only the config location. The private configuration stays user-owned.
export async function manageService(action: ServiceAction, home: string, configPath?: string): Promise<void> {
  const pointer = serviceConfigPath(home);
  if (action === "status" || action === "uninstall") {
    manageUserService("work", action, home);
    if (action === "uninstall") rmSync(pointer, { force: true });
    return;
  }
  if (action === "refresh" && !serviceInstalled(home)) return;
  const selected = configPath ?? (existsSync(pointer) ? readFileSync(pointer, "utf8") : undefined);
  assert(selected && isAbsolute(selected), "Install the work service with --config /absolute/private/config.json; refresh requires its saved path or --config.");
  await loadWorkConfig(selected);
  manageUserService("work", action, home, ["serve", "--config", selected]);
  mkdirSync(stateRoot(home), { recursive: true, mode: 0o700 });
  writeAtomic(pointer, selected, 0o600);
}

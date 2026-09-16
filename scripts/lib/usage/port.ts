import { resolve } from "node:path";
import { repoRoot, runOrThrow } from "../core.ts";

interface PortsService {
  name: string;
  port: number;
}

export interface PortOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

// The usage server's port from slopestyle-ports. A restart keeps the lease it
// already holds instead of claiming again: claim refuses while any port in the
// block is live, and the server's own Tailscale route keeps its port live.
export function usagePort(options: PortOptions = {}): number {
  const cli = (command: string, ...args: string[]): unknown => {
    const result = runOrThrow([process.execPath, resolve(repoRoot, "scripts/ports.ts"), command, "--app", "slopestyle-usage", "--format", "json", ...args], { cwd: options.cwd ?? repoRoot, env: options.env, quiet: true });
    return JSON.parse(result.stdout);
  };
  const shown = cli("show") as { entries: { services: PortsService[] }[] };
  const held = shown.entries.flatMap((entry) => entry.services).find((service) => service.name === "usage");
  if (held) return held.port;
  const claimed = cli("claim", "usage") as { services: PortsService[] };
  const port = claimed.services.find((service) => service.name === "usage")?.port;
  if (!Number.isInteger(port)) throw new Error(`slopestyle-ports did not return a port for usage: ${JSON.stringify(claimed)}`);
  return port!;
}

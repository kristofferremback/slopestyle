import { resolve } from "node:path";
import { repoRoot, runOrThrow } from "./core.ts";

interface PortsService {
  name: string;
  port: number;
}

export interface PortOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

// A service port from slopestyle-ports. A restart keeps the lease it
// already holds instead of claiming again: claim refuses while any port in the
// block is live, and the server's own Tailscale route keeps its port live.
export function servicePort(
  app: string,
  name: string,
  options: PortOptions = {},
): number {
  const cli = (command: string, ...args: string[]): unknown => {
    const result = runOrThrow(
      [
        process.execPath,
        resolve(repoRoot, "scripts/ports.ts"),
        command,
        "--app",
        app,
        "--format",
        "json",
        ...args,
      ],
      { cwd: options.cwd ?? repoRoot, env: options.env, quiet: true },
    );
    return JSON.parse(result.stdout);
  };
  const shown = cli("show") as { entries: { services: PortsService[] }[] };
  const held = shown.entries
    .flatMap((entry) => entry.services)
    .find((service) => service.name === name);
  if (held) return held.port;
  const claimed = cli("claim", name) as { services: PortsService[] };
  const port = claimed.services.find((service) => service.name === name)?.port;
  if (!Number.isInteger(port))
    throw new Error(
      `slopestyle-ports did not return a port for ${name}: ${JSON.stringify(claimed)}`,
    );
  return port!;
}

import { servicePort, type PortOptions } from "../service-port.ts";
export type { PortOptions } from "../service-port.ts";

export function usagePort(options: PortOptions = {}): number {
  return servicePort("slopestyle-usage", "usage", options);
}

import { privateServicePort, type PortOptions } from "../service-port.ts";

export function workPort(options: PortOptions = {}): number {
  return privateServicePort("slopestyle-work", "work", options);
}

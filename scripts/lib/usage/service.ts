import { manageUserService, serviceInstalled as installed, servicePaths as paths, type ServiceAction } from "../user-service.ts";
export { serviceActions, type ServiceAction } from "../user-service.ts";
export const servicePaths = (home: string) => paths("usage", home);
export const serviceInstalled = (home: string) => installed("usage", home);
export function manageService(action: ServiceAction, home: string): void {
  manageUserService("usage", action, home);
}

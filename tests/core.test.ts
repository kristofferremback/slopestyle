import { expect, test } from "bun:test";
import { targetRoot } from "../scripts/lib/core.ts";

test("should install Hermes skills under HERMES_HOME when set, else ~/.hermes", () => {
  expect(targetRoot("/home/kris", "hermes", "/srv/hermes")).toBe("/srv/hermes/skills");
  expect(targetRoot("/home/kris", "hermes", undefined)).toBe("/home/kris/.hermes/skills");
  expect(targetRoot("/home/kris", "hermes", "")).toBe("/home/kris/.hermes/skills");
});

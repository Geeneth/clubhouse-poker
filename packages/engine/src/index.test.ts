import { expect, test } from "vitest";
import { ENGINE_NAME } from "./index";

test("engine package loads", () => {
  expect(ENGINE_NAME).toBe("clubhouse-engine");
});

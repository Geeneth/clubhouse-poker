import { expect, test } from "vitest";
import { SERVER_NAME } from "./index";

test("server package loads and can import the engine", () => {
  expect(SERVER_NAME).toContain("clubhouse-engine");
});

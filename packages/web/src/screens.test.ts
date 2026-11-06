import { expect, test } from "vitest";
import { SCREEN_TITLES } from "./screens";

test("web app has a title for the table and the controller", () => {
  expect(Object.keys(SCREEN_TITLES)).toEqual(["table", "controller"]);
});

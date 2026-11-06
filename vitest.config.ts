import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The locked folder may be empty until Geeneth adds tests.
    passWithNoTests: true,
    projects: [
      "packages/*",
      { test: { name: "locked", root: "tests/locked", include: ["**/*.test.ts"] } },
    ],
  },
});

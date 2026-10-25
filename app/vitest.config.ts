import { defineConfig } from "vitest/config";

// Convex function tests (convex-test). The Expo app itself has no unit tests.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});

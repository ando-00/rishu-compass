import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["engine/**/*.test.ts", "shared/**/*.test.ts", "worker/**/*.test.ts", "evals/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: false,
  },
});

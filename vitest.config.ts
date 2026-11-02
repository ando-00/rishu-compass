import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["engine/**/*.test.ts", "shared/**/*.test.ts", "worker/**/*.test.ts", "evals/**/*.test.ts", "src/**/*.test.ts", "scripts/**/*.test.mjs"],
    passWithNoTests: false,
    // 全学生を再計算するテストは単独で4秒台かかる。並列や監査の負荷で5秒の既定を超えて落ちないようにする
    testTimeout: 30000,
  },
});

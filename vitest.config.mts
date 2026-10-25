import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{unit,handlers,contract}/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    isolate: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "lcov"],
    },
  },
});

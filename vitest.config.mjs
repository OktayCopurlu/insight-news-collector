import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs"],
    globals: true,
    watch: false,
    clearMocks: true,
    hookTimeout: 30000,
  },
});

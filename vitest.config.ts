import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    environmentOptions: {
      jsdom: {
        url: "http://localhost:3000",
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/**",
        ".next/**",
        "**/*.d.ts",
        "**/*.config.*",
        "**/instrumentation.ts",
        "scripts/**",
        "website/**",
        "hooks-library/**",
        "__tests__/**",
        // Drizzle schema definitions — pure table declarations, nothing callable to unit test
        "lib/db/schema.ts",
        // Database initialisation & migration bootstrap — requires a real SQLite file
        "lib/db/index.ts",
        // shadcn/Radix UI primitives — third-party component wrappers, not application logic
        "components/ui/**",
      ],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

import { defineConfig } from "vitest/config";

// Keep generated/build output outside test discovery across Vitest versions.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });

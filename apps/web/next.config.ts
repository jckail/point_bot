import type { NextConfig } from "next";
import path from "node:path";

/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
import "./src/env";

const config: NextConfig = {
  reactStrictMode: true,
  // Produces a minimal server bundle in .next/standalone for the Docker image.
  output: "standalone",
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ["@pointup/core", "@pointup/api-client"],
  // Monorepo root, so standalone output traces workspace dependencies.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
};

export default config;

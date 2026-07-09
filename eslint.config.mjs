// @ts-check
import { defineConfig, globalIgnores } from "eslint/config";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "**/dist/**",
    "infra/cdk.out/**",
    "packages/core/drizzle/**",
    "apps/web/next-env.d.ts",
  ]),
  ...coreWebVitals,
  ...typescript,
  {
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
]);
